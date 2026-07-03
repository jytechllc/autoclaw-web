import { NextRequest, NextResponse } from "next/server";
import { auth0 } from "@/lib/auth0";
import { getDb } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { checkRateLimit } from "@/lib/rate-limit";
import {
  addCampaignNegativeKeywords,
  removeCampaignNegativeKeyword,
  channelSupportsNegativeKeywords,
  type KeywordMatchType,
} from "@/lib/google-ads";
import { resolveOrgId } from "@/lib/credits";
import { isReadOnlyUserId } from "@/lib/roles-server";

export const dynamic = "force-dynamic";

function getIp(req: NextRequest): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}

const VALID_MATCH = new Set<KeywordMatchType>(["BROAD", "PHRASE", "EXACT"]);

type CampaignRow = { platform_campaign_id: string; channel: string | null; closed: boolean };

async function loadCampaign(
  req: NextRequest,
  params: Promise<{ id: string }>,
  body: Record<string, unknown>
): Promise<
  | { error: NextResponse }
  | { campaign: CampaignRow; campaignId: number; userId: number; userEmail: string; orgId: number }
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
  if (await isReadOnlyUserId(sql, userId)) {
    return { error: NextResponse.json({ error: "Read-only account — writes are disabled" }, { status: 403 }) };
  }

  const requestedOrgId = body.orgId ? Number(body.orgId) : undefined;
  const orgId = await resolveOrgId(sql, userId, requestedOrgId);
  if (!orgId) return { error: NextResponse.json({ error: "No organization found" }, { status: 400 }) };

  const rows = await sql`
    SELECT platform_campaign_id, channel, closed FROM campaigns
    WHERE id = ${campaignId} AND org_id = ${orgId} AND platform = 'google'
  `;
  if (rows.length === 0) return { error: NextResponse.json({ error: "Campaign not found" }, { status: 404 }) };
  if (rows[0].closed) return { error: NextResponse.json({ error: "Campaign is closed" }, { status: 409 }) };

  return { campaign: rows[0] as unknown as CampaignRow, campaignId, userId, userEmail, orgId };
}

/** POST — add campaign-level negative keywords.
 *  Body: { keywords: Array<string | { text, matchType }>, orgId? } */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ip = getIp(req);
  if (!checkRateLimit(ip, { limit: 30, windowMs: 60_000 })) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  const body = await req.json().catch(() => ({}));
  const loaded = await loadCampaign(req, params, body);
  if ("error" in loaded) return loaded.error;
  const { campaign, campaignId, userId, userEmail } = loaded;

  if (!channelSupportsNegativeKeywords(String(campaign.channel || ""))) {
    return NextResponse.json(
      { error: `Negative keywords are not supported for ${campaign.channel || "this"} campaigns` },
      { status: 400 }
    );
  }

  const rawKeywords = Array.isArray(body.keywords) ? body.keywords : [];
  const keywords = rawKeywords
    .map((k: unknown) => {
      if (typeof k === "string") return { text: k.trim(), matchType: "BROAD" as KeywordMatchType };
      if (k && typeof k === "object") {
        const obj = k as { text?: unknown; matchType?: unknown };
        const matchType = String(obj.matchType || "BROAD").toUpperCase() as KeywordMatchType;
        return { text: String(obj.text || "").trim(), matchType: VALID_MATCH.has(matchType) ? matchType : ("BROAD" as KeywordMatchType) };
      }
      return { text: "", matchType: "BROAD" as KeywordMatchType };
    })
    .filter((k: { text: string }) => k.text.length > 0 && k.text.length <= 80);

  if (keywords.length === 0) {
    return NextResponse.json({ error: "At least 1 valid keyword required (≤80 chars each)" }, { status: 400 });
  }
  if (keywords.length > 200) {
    return NextResponse.json({ error: "Up to 200 keywords per request" }, { status: 400 });
  }

  const result = await addCampaignNegativeKeywords(campaign.platform_campaign_id, keywords);

  logAudit({
    userId, userEmail,
    action: "google_ads.create_campaign",
    resourceType: "negative_keyword", resourceId: campaignId,
    details: {
      sub_action: "add_negative_keywords",
      requested: keywords.length,
      created: result.created,
      duplicatesIgnored: result.duplicatesIgnored.length,
      errors: result.errors.length,
    },
    ipAddress: ip,
  });

  return NextResponse.json({
    success: result.errors.length === 0 || result.created > 0,
    created: result.created,
    resourceNames: result.resourceNames,
    duplicatesIgnored: result.duplicatesIgnored,
    errors: result.errors,
  });
}

/** DELETE — remove one negative keyword criterion.
 *  Body: { resourceName, orgId? } */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ip = getIp(req);
  if (!checkRateLimit(ip, { limit: 30, windowMs: 60_000 })) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  const body = await req.json().catch(() => ({}));
  const loaded = await loadCampaign(req, params, body);
  if ("error" in loaded) return loaded.error;
  const { campaign, campaignId, userId, userEmail } = loaded;

  const resourceName = String(body.resourceName || "").trim();
  // Criterion must live under the same customer as this campaign.
  const campaignCustomer = String(campaign.platform_campaign_id).split("/").slice(0, 2).join("/");
  if (!resourceName.startsWith(`${campaignCustomer}/campaignCriteria/`)) {
    return NextResponse.json({ error: "resourceName does not belong to this campaign's customer" }, { status: 403 });
  }
  // ...and reference this campaign's numeric id (criterion ids are `{campaignId}~{criterionId}`).
  const numericCampaignId = String(campaign.platform_campaign_id).split("/").pop() || "";
  const criterionId = resourceName.split("/").pop() || "";
  if (!criterionId.startsWith(`${numericCampaignId}~`)) {
    return NextResponse.json({ error: "resourceName does not belong to this campaign" }, { status: 403 });
  }

  const result = await removeCampaignNegativeKeyword(resourceName);
  if (!result.success) {
    return NextResponse.json({ error: "Failed to remove negative keyword", details: result.error }, { status: 502 });
  }

  logAudit({
    userId, userEmail,
    action: "google_ads.create_campaign",
    resourceType: "negative_keyword", resourceId: campaignId,
    details: { sub_action: "remove_negative_keyword", resourceName },
    ipAddress: ip,
  });

  return NextResponse.json({ success: true });
}
