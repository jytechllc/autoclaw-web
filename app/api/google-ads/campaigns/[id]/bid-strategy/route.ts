import { NextRequest, NextResponse } from "next/server";
import { logAudit } from "@/lib/audit";
import {
  setCampaignBidStrategy,
  BID_STRATEGY_TYPES,
  type BidStrategyType,
} from "@/lib/google-ads";
import { requireCampaign } from "@/lib/google-ads-auth";

export const dynamic = "force-dynamic";

/** POST — switch the campaign's bidding strategy.
 *  Body: { type, targetCpa?, targetRoas?, orgId? }
 *  targetCpa in USD (TARGET_CPA only); targetRoas as a ratio, e.g. 4 = 400% (TARGET_ROAS only). */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const body = await req.json().catch(() => ({}));
  const type = String(body.type || "").toUpperCase() as BidStrategyType;
  if (!BID_STRATEGY_TYPES.includes(type)) {
    return NextResponse.json({ error: `type must be one of: ${BID_STRATEGY_TYPES.join(", ")}` }, { status: 400 });
  }
  const targetCpa = body.targetCpa !== undefined ? Number(body.targetCpa) : undefined;
  const targetRoas = body.targetRoas !== undefined ? Number(body.targetRoas) : undefined;

  const auth = await requireCampaign(req, params, {
    limit: 30,
    write: true,
    requestedOrgId: body.orgId,
  });
  if ("response" in auth) return auth.response;
  const { campaign, campaignId, userId, userEmail, ip } = auth;

  const result = await setCampaignBidStrategy(campaign.platform_campaign_id, {
    type,
    targetCpaUsd: targetCpa,
    targetRoas,
  });
  if (!result.success) {
    return NextResponse.json({ error: "Failed to update bid strategy", details: result.error }, { status: 502 });
  }

  logAudit({
    userId, userEmail,
    action: "google_ads.create_campaign",
    resourceType: "campaign", resourceId: campaignId,
    details: { sub_action: "set_bid_strategy", type, targetCpa, targetRoas },
    ipAddress: ip,
  });

  return NextResponse.json({ success: true, type, targetCpa, targetRoas });
}
