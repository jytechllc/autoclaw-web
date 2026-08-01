import { NextRequest, NextResponse } from "next/server";
import { logAudit } from "@/lib/audit";
import {
  setCampaignDailyBudget,
  setCampaignBidStrategy,
  setCampaignStatus,
  addCampaignNegativeKeywords,
  channelSupportsNegativeKeywords,
  type BidStrategyType,
  type KeywordMatchType,
} from "@/lib/google-ads";
import { requireCampaign } from "@/lib/google-ads-auth";
import { sanitizeAutoAction, type AutoAction } from "../prompt";

export const dynamic = "force-dynamic";

/** POST — one-click apply of an AI recommendation's autoAction.
 *  Body: { action: AutoAction, orgId? }
 *
 *  Server-side re-validation is independent of generation-time sanitizing:
 *  the client payload is NEVER trusted. Guardrails: whitelisted kinds only,
 *  daily-budget moves capped at ±50% of the CURRENT value (re-checked here
 *  against the DB, not against whatever the model saw), ≤10 negatives. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const body = await req.json().catch(() => ({}));

  const auth = await requireCampaign(req, params, {
    limit: 20,
    write: true,
    requestedOrgId: body.orgId,
  });
  if ("response" in auth) return auth.response;
  const { campaign: c, campaignId, userId, userEmail, ip, sql } = auth;
  const currentDaily = Number(c.daily_budget || 0);

  // Re-sanitize against CURRENT DB state — independent of what the model saw.
  const action: AutoAction | null = sanitizeAutoAction(body.action, currentDaily);
  if (!action) {
    return NextResponse.json({ error: "Invalid or out-of-guardrail action" }, { status: 400 });
  }

  let result: { success: boolean; detail?: unknown } = { success: false };

  if (action.kind === "SET_DAILY_BUDGET") {
    const dailyBudget = Number(action.params.dailyBudget);
    const res = await setCampaignDailyBudget(c.platform_campaign_id, dailyBudget);
    if (res.success) {
      await sql`UPDATE campaigns SET daily_budget = ${dailyBudget}, updated_at = NOW() WHERE id = ${campaignId}`;
      result = { success: true, detail: { from: currentDaily, to: dailyBudget } };
    } else {
      result = { success: false, detail: res.error };
    }
  } else if (action.kind === "SET_BID_STRATEGY") {
    const res = await setCampaignBidStrategy(c.platform_campaign_id, {
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
    const res = await addCampaignNegativeKeywords(c.platform_campaign_id, keywords);
    result = { success: res.created > 0 || res.errors.length === 0, detail: { created: res.created, duplicatesIgnored: res.duplicatesIgnored.length, errors: res.errors } };
  } else if (action.kind === "PAUSE_CAMPAIGN") {
    const res = await setCampaignStatus(c.platform_campaign_id, "PAUSED");
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
