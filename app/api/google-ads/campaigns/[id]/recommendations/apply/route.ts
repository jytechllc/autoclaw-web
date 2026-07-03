import { NextRequest, NextResponse } from "next/server";
import { auth0 } from "@/lib/auth0";
import { getDb } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { checkRateLimit } from "@/lib/rate-limit";
import {
  setCampaignDailyBudget,
  setCampaignBidStrategy,
  setCampaignStatus,
  addCampaignNegativeKeywords,
  channelSupportsNegativeKeywords,
  type BidStrategyType,
  type KeywordMatchType,
} from "@/lib/google-ads";
import { resolveOrgId } from "@/lib/credits";
import { isReadOnlyUserId } from "@/lib/roles-server";
import { sanitizeAutoAction, type AutoAction } from "../prompt";

export const dynamic = "force-dynamic";

function getIp(req: NextRequest): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}

/** POST — one-click apply of an AI recommendation's autoAction.
 *  Body: { action: AutoAction, orgId? }
 *
 *  Server-side re-validation is independent of generation-time sanitizing:
 *  the client payload is NEVER trusted. Guardrails: whitelisted kinds only,
 *  daily-budget moves capped at ±50% of the CURRENT value (re-checked here
 *  against the DB, not against whatever the model saw), ≤10 negatives. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ip = getIp(req);
  if (!checkRateLimit(ip, { limit: 20, windowMs: 60_000 })) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }
  const session = await auth0.getSession();
  if (!session?.user?.email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const campaignId = Number(id);
  if (!Number.isFinite(campaignId)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

  const body = await req.json().catch(() => ({}));

  const sql = getDb();
  const userEmail = session.user.email as string;
  const users = await sql`SELECT id FROM users WHERE email = ${userEmail}`;
  if (users.length === 0) return NextResponse.json({ error: "User not found" }, { status: 404 });
  const userId = users[0].id as number;
  if (await isReadOnlyUserId(sql, userId)) {
    return NextResponse.json({ error: "Read-only account — writes are disabled" }, { status: 403 });
  }

  const requestedOrgId = body.orgId ? Number(body.orgId) : undefined;
  const orgId = await resolveOrgId(sql, userId, requestedOrgId);
  if (!orgId) return NextResponse.json({ error: "No organization found" }, { status: 400 });

  const rows = await sql`
    SELECT platform_campaign_id, campaign_name, channel, daily_budget, closed FROM campaigns
    WHERE id = ${campaignId} AND org_id = ${orgId} AND platform = 'google'
  `;
  if (rows.length === 0) return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
  if (rows[0].closed) return NextResponse.json({ error: "Campaign is closed" }, { status: 409 });
  const c = rows[0];
  const currentDaily = Number(c.daily_budget || 0);

  // Re-sanitize against CURRENT DB state — independent of what the model saw.
  const action: AutoAction | null = sanitizeAutoAction(body.action, currentDaily);
  if (!action) {
    return NextResponse.json({ error: "Invalid or out-of-guardrail action" }, { status: 400 });
  }

  let result: { success: boolean; detail?: unknown } = { success: false };

  if (action.kind === "SET_DAILY_BUDGET") {
    const dailyBudget = Number(action.params.dailyBudget);
    const res = await setCampaignDailyBudget(c.platform_campaign_id as string, dailyBudget);
    if (res.success) {
      await sql`UPDATE campaigns SET daily_budget = ${dailyBudget}, updated_at = NOW() WHERE id = ${campaignId}`;
      result = { success: true, detail: { from: currentDaily, to: dailyBudget } };
    } else {
      result = { success: false, detail: res.error };
    }
  } else if (action.kind === "SET_BID_STRATEGY") {
    const res = await setCampaignBidStrategy(c.platform_campaign_id as string, {
      type: String(action.params.type) as BidStrategyType,
      targetCpaUsd: action.params.targetCpa !== undefined ? Number(action.params.targetCpa) : undefined,
      targetRoas: action.params.targetRoas !== undefined ? Number(action.params.targetRoas) : undefined,
    });
    result = { success: res.success, detail: res.error };
  } else if (action.kind === "ADD_NEGATIVE_KEYWORDS") {
    if (!channelSupportsNegativeKeywords(String(c.channel || ""))) {
      return NextResponse.json({ error: `Negative keywords are not supported for ${c.channel || "this"} campaigns` }, { status: 400 });
    }
    const keywords = (action.params.keywords as Array<{ text: string; matchType: string }>).map((k) => ({
      text: k.text,
      matchType: k.matchType as KeywordMatchType,
    }));
    const res = await addCampaignNegativeKeywords(c.platform_campaign_id as string, keywords);
    result = { success: res.created > 0 || res.errors.length === 0, detail: { created: res.created, duplicatesIgnored: res.duplicatesIgnored.length, errors: res.errors } };
  } else if (action.kind === "PAUSE_CAMPAIGN") {
    const res = await setCampaignStatus(c.platform_campaign_id as string, "PAUSED");
    if (res.success) {
      await sql`UPDATE campaigns SET status = 'PAUSED', updated_at = NOW() WHERE id = ${campaignId}`;
    }
    result = { success: res.success, detail: res.error };
  }

  if (!result.success) {
    return NextResponse.json({ error: "Failed to apply recommendation", details: result.detail }, { status: 502 });
  }

  logAudit({
    userId, userEmail,
    action: "google_ads.recommendations",
    resourceType: "campaign", resourceId: campaignId,
    details: { sub_action: "apply_recommendation", kind: action.kind, params: action.params, detail: result.detail },
    ipAddress: ip,
  });

  return NextResponse.json({ success: true, kind: action.kind, detail: result.detail });
}
