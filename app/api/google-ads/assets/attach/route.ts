import { NextRequest, NextResponse } from "next/server";
import { auth0 } from "@/lib/auth0";
import { getDb } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { checkRateLimit } from "@/lib/rate-limit";
import { attachAssetToCampaign, channelSupportsTextExtensions } from "@/lib/google-ads";
import { resolveOrgId } from "@/lib/credits";
import { isReadOnlyUserId } from "@/lib/roles-server";

export const dynamic = "force-dynamic";

function getIp(req: NextRequest): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}

/** POST — attach an existing account asset to one of the org's campaigns.
 *  Body: { assetResourceName, campaignId, orgId? } */
export async function POST(req: NextRequest) {
  const ip = getIp(req);
  if (!checkRateLimit(ip, { limit: 30, windowMs: 60_000 })) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }
  const session = await auth0.getSession();
  if (!session?.user?.email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const assetResourceName = String(body.assetResourceName || "").trim();
  const campaignId = Number(body.campaignId);
  if (!/^customers\/\d+\/assets\/\d+$/.test(assetResourceName)) {
    return NextResponse.json({ error: "Invalid assetResourceName" }, { status: 400 });
  }
  if (!Number.isFinite(campaignId)) {
    return NextResponse.json({ error: "campaignId required" }, { status: 400 });
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
  if (!channelSupportsTextExtensions(String(rows[0].channel || ""))) {
    return NextResponse.json(
      { error: `Assets cannot be attached to ${rows[0].channel || "this"} campaigns` },
      { status: 400 }
    );
  }
  // Asset must live under the same customer as the campaign.
  const campaignCustomer = String(rows[0].platform_campaign_id).split("/").slice(0, 2).join("/");
  if (!assetResourceName.startsWith(`${campaignCustomer}/assets/`)) {
    return NextResponse.json({ error: "Asset does not belong to this campaign's customer" }, { status: 403 });
  }

  const result = await attachAssetToCampaign(rows[0].platform_campaign_id as string, assetResourceName);
  if (!result.success) {
    return NextResponse.json({ error: "Failed to attach asset", details: result.error }, { status: 502 });
  }

  logAudit({
    userId, userEmail,
    action: "google_ads.create_campaign",
    resourceType: "asset_attach", resourceId: campaignId,
    details: { sub_action: "attach_asset", assetResourceName, alreadyAttached: !!result.alreadyAttached },
    ipAddress: ip,
  });

  return NextResponse.json({ success: true, alreadyAttached: !!result.alreadyAttached });
}
