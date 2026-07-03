import { NextRequest, NextResponse } from "next/server";
import { auth0 } from "@/lib/auth0";
import { getDb } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { checkRateLimit } from "@/lib/rate-limit";
import {
  createCampaignCallouts,
  createCampaignStructuredSnippet,
  createCampaignCallAsset,
  createCampaignPromotion,
  createCampaignPriceAsset,
  removeCampaignExtensionAsset,
  channelSupportsTextExtensions,
  STRUCTURED_SNIPPET_HEADERS,
  type StructuredSnippetHeader,
  type PromotionInput,
  type PriceAssetInput,
  type PriceOfferingInput,
} from "@/lib/google-ads";
import { resolveOrgId } from "@/lib/credits";
import { isReadOnlyUserId } from "@/lib/roles-server";

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
  if (!channelSupportsTextExtensions(String(rows[0].channel || ""))) {
    return { error: NextResponse.json({ error: `Extensions are not supported for ${rows[0].channel || "this"} campaigns` }, { status: 400 }) };
  }

  return { campaign: rows[0] as unknown as CampaignRow, campaignId, userId, userEmail };
}

/** POST — add callouts, a structured snippet, a call, or a promotion extension.
 *  Body (callouts):  { kind: "callout", texts: string[], orgId? }
 *  Body (snippet):   { kind: "snippet", header, values: string[], orgId? }
 *  Body (call):      { kind: "call", countryCode, phoneNumber, orgId? }
 *  Body (promotion): { kind: "promotion", promotionTarget, percentOff | moneyAmountOff,
 *                      currencyCode?, promotionCode?, ordersOverAmount?, occasion?,
 *                      redemptionStartDate?, redemptionEndDate?, languageCode?, finalUrl, orgId? }
 *  Body (price):     { kind: "price", type, priceQualifier?, currencyCode?, languageCode?,
 *                      offerings: Array<{ header, description, price, unit?, finalUrl }>, orgId? } */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ip = getIp(req);
  if (!checkRateLimit(ip, { limit: 30, windowMs: 60_000 })) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  const body = await req.json().catch(() => ({}));
  const kind = String(body.kind || "");
  if (kind !== "callout" && kind !== "snippet" && kind !== "call" && kind !== "promotion" && kind !== "price") {
    return NextResponse.json({ error: 'kind must be "callout", "snippet", "call", "promotion", or "price"' }, { status: 400 });
  }

  const loaded = await loadCampaign(params, body);
  if ("error" in loaded) return loaded.error;
  const { campaign, campaignId, userId, userEmail } = loaded;

  let created = 0;
  let details: unknown;
  if (kind === "callout") {
    const texts = (Array.isArray(body.texts) ? body.texts : []).map((t: unknown) => String(t || "").trim()).filter(Boolean);
    if (texts.length === 0) return NextResponse.json({ error: "At least 1 callout text required" }, { status: 400 });
    const result = await createCampaignCallouts(campaign.platform_campaign_id, texts);
    created = result.created;
    details = result.error;
  } else if (kind === "call") {
    const result = await createCampaignCallAsset(campaign.platform_campaign_id, {
      countryCode: String(body.countryCode || ""),
      phoneNumber: String(body.phoneNumber || ""),
    });
    created = result.created;
    details = result.error;
  } else if (kind === "promotion") {
    const input: PromotionInput = {
      promotionTarget: String(body.promotionTarget || ""),
      percentOff: body.percentOff !== undefined && body.percentOff !== null && body.percentOff !== "" ? Number(body.percentOff) : undefined,
      moneyAmountOff: body.moneyAmountOff !== undefined && body.moneyAmountOff !== null && body.moneyAmountOff !== "" ? Number(body.moneyAmountOff) : undefined,
      currencyCode: body.currencyCode ? String(body.currencyCode) : undefined,
      promotionCode: body.promotionCode ? String(body.promotionCode) : undefined,
      ordersOverAmount: body.ordersOverAmount ? Number(body.ordersOverAmount) : undefined,
      languageCode: body.languageCode ? String(body.languageCode) : undefined,
      occasion: body.occasion ? String(body.occasion) : undefined,
      redemptionStartDate: body.redemptionStartDate ? String(body.redemptionStartDate) : undefined,
      redemptionEndDate: body.redemptionEndDate ? String(body.redemptionEndDate) : undefined,
      finalUrl: String(body.finalUrl || ""),
    };
    const result = await createCampaignPromotion(campaign.platform_campaign_id, input);
    created = result.created;
    details = result.error;
  } else if (kind === "price") {
    const rawOfferings = Array.isArray(body.offerings) ? body.offerings : [];
    const offerings: PriceOfferingInput[] = rawOfferings.map((o: unknown) => {
      const obj = (o && typeof o === "object" ? o : {}) as Record<string, unknown>;
      return {
        header: String(obj.header || "").trim(),
        description: String(obj.description || "").trim(),
        price: Number(obj.price),
        unit: obj.unit ? String(obj.unit) : undefined,
        finalUrl: String(obj.finalUrl || "").trim(),
      };
    });
    const input: PriceAssetInput = {
      type: String(body.type || ""),
      priceQualifier: body.priceQualifier ? String(body.priceQualifier) : undefined,
      currencyCode: body.currencyCode ? String(body.currencyCode) : undefined,
      languageCode: body.languageCode ? String(body.languageCode) : undefined,
      offerings,
    };
    const result = await createCampaignPriceAsset(campaign.platform_campaign_id, input);
    created = result.created;
    details = result.error;
  } else {
    const header = String(body.header || "") as StructuredSnippetHeader;
    if (!STRUCTURED_SNIPPET_HEADERS.includes(header)) {
      return NextResponse.json({ error: `header must be one of: ${STRUCTURED_SNIPPET_HEADERS.join(", ")}` }, { status: 400 });
    }
    const values = (Array.isArray(body.values) ? body.values : []).map((v: unknown) => String(v || "").trim()).filter(Boolean);
    const result = await createCampaignStructuredSnippet(campaign.platform_campaign_id, { header, values });
    created = result.created;
    details = result.error;
  }

  if (created === 0) {
    return NextResponse.json({ error: `Failed to create ${kind}`, details }, { status: 502 });
  }

  logAudit({
    userId, userEmail,
    action: "google_ads.create_campaign",
    resourceType: "extension", resourceId: campaignId,
    details: { sub_action: `create_${kind}`, created },
    ipAddress: ip,
  });

  return NextResponse.json({ success: true, created });
}

/** DELETE — detach one callout / snippet. Body: { resourceName, orgId? } */
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

  const result = await removeCampaignExtensionAsset(resourceName);
  if (!result.success) {
    return NextResponse.json({ error: "Failed to remove extension", details: result.error }, { status: 502 });
  }

  logAudit({
    userId, userEmail,
    action: "google_ads.create_campaign",
    resourceType: "extension", resourceId: campaignId,
    details: { sub_action: "remove_extension", resourceName },
    ipAddress: ip,
  });

  return NextResponse.json({ success: true });
}
