import { NextRequest, NextResponse } from "next/server";
import { auth0 } from "@/lib/auth0";
import { getDb } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { checkRateLimit } from "@/lib/rate-limit";
import {
  setAudienceBidModifiers,
  channelSupportsAudienceModifiers,
  type AudienceModifierInput,
} from "@/lib/google-ads";
import { resolveOrgId } from "@/lib/credits";
import { isReadOnlyUserId } from "@/lib/roles-server";

export const dynamic = "force-dynamic";

function getIp(req: NextRequest): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}

/** POST — adjust bid modifiers on the campaign's existing demographic
 *  (age/gender/parental/income) ad-group criteria.
 *  Body: { modifiers: Array<{ criterionResourceName, percent }>, orgId? }
 *  percent 0 resets to no adjustment. Update-only: never creates/removes
 *  targeting. Campaign membership is verified by GAQL inside the lib call
 *  (ad_group_criterion resource names carry the ad-group id, not the
 *  campaign id, so a prefix check alone can't prove ownership). */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ip = getIp(req);
  if (!checkRateLimit(ip, { limit: 30, windowMs: 60_000 })) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }
  const session = await auth0.getSession();
  if (!session?.user?.email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const campaignId = Number(id);
  if (!Number.isFinite(campaignId)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

  const body = await req.json().catch(() => ({}));
  const rawModifiers = Array.isArray(body.modifiers) ? body.modifiers : [];
  const modifiers: AudienceModifierInput[] = rawModifiers.map((m: unknown) => {
    const obj = (m && typeof m === "object" ? m : {}) as { criterionResourceName?: unknown; percent?: unknown };
    return {
      criterionResourceName: String(obj.criterionResourceName || "").trim(),
      percent: Number(obj.percent ?? 0),
    };
  });
  if (modifiers.length === 0) {
    return NextResponse.json({ error: "At least 1 modifier required" }, { status: 400 });
  }

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
    SELECT platform_campaign_id, channel, closed FROM campaigns
    WHERE id = ${campaignId} AND org_id = ${orgId} AND platform = 'google'
  `;
  if (rows.length === 0) return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
  if (rows[0].closed) return NextResponse.json({ error: "Campaign is closed" }, { status: 409 });
  if (!channelSupportsAudienceModifiers(String(rows[0].channel || ""))) {
    return NextResponse.json(
      { error: `Demographic bid adjustments are not supported for ${rows[0].channel || "this"} campaigns` },
      { status: 400 }
    );
  }
  // Prefix check: right customer at least; campaign membership proven in lib.
  const campaignCustomer = String(rows[0].platform_campaign_id).split("/").slice(0, 2).join("/");
  for (const m of modifiers) {
    if (!m.criterionResourceName.startsWith(`${campaignCustomer}/adGroupCriteria/`)) {
      return NextResponse.json({ error: "criterionResourceName does not belong to this campaign's customer" }, { status: 403 });
    }
  }

  const result = await setAudienceBidModifiers(rows[0].platform_campaign_id as string, modifiers);
  if (!result.success) {
    return NextResponse.json({ error: "Failed to update demographic bid adjustments", details: result.error }, { status: 502 });
  }

  logAudit({
    userId, userEmail,
    action: "google_ads.create_campaign",
    resourceType: "audience_modifier", resourceId: campaignId,
    details: { sub_action: "set_audience_modifiers", criteria: modifiers.length },
    ipAddress: ip,
  });

  return NextResponse.json({ success: true, updated: result.updated });
}
