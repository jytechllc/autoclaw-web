import { NextRequest, NextResponse } from "next/server";
import { auth0 } from "@/lib/auth0";
import { getDb } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { checkRateLimit } from "@/lib/rate-limit";
import {
  createCampaignSitelinks,
  removeCampaignSitelink,
  channelSupportsSitelinks,
  type SitelinkInput,
} from "@/lib/google-ads";
import { resolveOrgId } from "@/lib/credits";

export const dynamic = "force-dynamic";

function getIp(req: NextRequest): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}

type CampaignRow = { platform_campaign_id: string; channel: string | null; closed: boolean };

async function loadCampaign(
  params: Promise<{ id: string }>,
  body: Record<string, unknown>
): Promise<
  | { error: NextResponse }
  | { campaign: CampaignRow; campaignId: number; userId: number; userEmail: string }
> {
  const session = await auth0.getSession();
  if (!session?.user?.email) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };

  const { id } = await params;
  const campaignId = Number(id);
  if (!Number.isFinite(campaignId)) return { error: NextResponse.json({ error: "Invalid id" }, { status: 400 }) };

  const sql = getDb();
  const userEmail = session.user.email as string;
  const users = await sql`SELECT id FROM users WHERE email = ${userEmail}`;
  if (users.length === 0) return { error: NextResponse.json({ error: "User not found" }, { status: 404 }) };
  const userId = users[0].id as number;

  const requestedOrgId = body.orgId ? Number(body.orgId) : undefined;
  const orgId = await resolveOrgId(sql, userId, requestedOrgId);
  if (!orgId) return { error: NextResponse.json({ error: "No organization found" }, { status: 400 }) };

  const rows = await sql`
    SELECT platform_campaign_id, channel, closed FROM campaigns
    WHERE id = ${campaignId} AND org_id = ${orgId} AND platform = 'google'
  `;
  if (rows.length === 0) return { error: NextResponse.json({ error: "Campaign not found" }, { status: 404 }) };
  if (rows[0].closed) return { error: NextResponse.json({ error: "Campaign is closed" }, { status: 409 }) };
  if (!channelSupportsSitelinks(String(rows[0].channel || ""))) {
    return { error: NextResponse.json({ error: `Sitelinks are not supported for ${rows[0].channel || "this"} campaigns` }, { status: 400 }) };
  }

  return { campaign: rows[0] as unknown as CampaignRow, campaignId, userId, userEmail };
}

/** POST — add sitelinks to the campaign.
 *  Body: { sitelinks: Array<{ linkText, finalUrl, description1?, description2? }>, orgId? } */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ip = getIp(req);
  if (!checkRateLimit(ip, { limit: 30, windowMs: 60_000 })) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  const body = await req.json().catch(() => ({}));
  const loaded = await loadCampaign(params, body);
  if ("error" in loaded) return loaded.error;
  const { campaign, campaignId, userId, userEmail } = loaded;

  const rawSitelinks = Array.isArray(body.sitelinks) ? body.sitelinks : [];
  const sitelinks: SitelinkInput[] = rawSitelinks.map((s: unknown) => {
    const obj = (s && typeof s === "object" ? s : {}) as Record<string, unknown>;
    return {
      linkText: String(obj.linkText || "").trim(),
      finalUrl: String(obj.finalUrl || "").trim(),
      description1: obj.description1 ? String(obj.description1).trim() : undefined,
      description2: obj.description2 ? String(obj.description2).trim() : undefined,
    };
  });
  if (sitelinks.length === 0) {
    return NextResponse.json({ error: "At least 1 sitelink required" }, { status: 400 });
  }

  const result = await createCampaignSitelinks(campaign.platform_campaign_id, sitelinks);
  if (result.created === 0) {
    return NextResponse.json({ error: "Failed to create sitelinks", details: result.errors }, { status: 502 });
  }

  logAudit({
    userId, userEmail,
    action: "google_ads.create_campaign",
    resourceType: "sitelink", resourceId: campaignId,
    details: { sub_action: "create_sitelinks", requested: sitelinks.length, created: result.created, errors: result.errors.length },
    ipAddress: ip,
  });

  return NextResponse.json({ success: true, created: result.created, errors: result.errors });
}

/** DELETE — detach one sitelink from the campaign.
 *  Body: { resourceName, orgId? } — the campaign_asset link resource name. */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ip = getIp(req);
  if (!checkRateLimit(ip, { limit: 30, windowMs: 60_000 })) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  const body = await req.json().catch(() => ({}));
  const loaded = await loadCampaign(params, body);
  if ("error" in loaded) return loaded.error;
  const { campaign, campaignId, userId, userEmail } = loaded;

  const resourceName = String(body.resourceName || "").trim();
  const campaignCustomer = String(campaign.platform_campaign_id).split("/").slice(0, 2).join("/");
  if (!resourceName.startsWith(`${campaignCustomer}/campaignAssets/`)) {
    return NextResponse.json({ error: "resourceName does not belong to this campaign's customer" }, { status: 403 });
  }
  const numericCampaignId = String(campaign.platform_campaign_id).split("/").pop() || "";
  const linkId = resourceName.split("/").pop() || "";
  if (!linkId.startsWith(`${numericCampaignId}~`)) {
    return NextResponse.json({ error: "resourceName does not belong to this campaign" }, { status: 403 });
  }

  const result = await removeCampaignSitelink(resourceName);
  if (!result.success) {
    return NextResponse.json({ error: "Failed to remove sitelink", details: result.error }, { status: 502 });
  }

  logAudit({
    userId, userEmail,
    action: "google_ads.create_campaign",
    resourceType: "sitelink", resourceId: campaignId,
    details: { sub_action: "remove_sitelink", resourceName },
    ipAddress: ip,
  });

  return NextResponse.json({ success: true });
}
