import { NextRequest, NextResponse } from "next/server";
import { logAudit } from "@/lib/audit";
import {
  addCampaignNegativeKeywords,
  removeCampaignNegativeKeyword,
  channelSupportsNegativeKeywords,
  type KeywordMatchType,
} from "@/lib/google-ads";
import { requireCampaign } from "@/lib/google-ads-auth";

export const dynamic = "force-dynamic";

const VALID_MATCH = new Set<KeywordMatchType>(["BROAD", "PHRASE", "EXACT"]);

/** POST — add campaign-level negative keywords.
 *  Body: { keywords: Array<string | { text, matchType }>, orgId? } */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const body = await req.json().catch(() => ({}));
  const auth = await requireCampaign(req, params, {
    limit: 30,
    write: true,
    requestedOrgId: body.orgId,
  });
  if ("response" in auth) return auth.response;
  const { campaign, campaignId, userId, userEmail, ip } = auth;

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
  const body = await req.json().catch(() => ({}));
  const auth = await requireCampaign(req, params, {
    limit: 30,
    write: true,
    requestedOrgId: body.orgId,
  });
  if ("response" in auth) return auth.response;
  const { campaign, campaignId, userId, userEmail, ip } = auth;

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
