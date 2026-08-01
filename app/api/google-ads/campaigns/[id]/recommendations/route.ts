import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { requireCampaign } from "@/lib/google-ads-auth";
import {
  generateCampaignRecommendations,
  persistDigest,
  RecommendationGenerationError,
} from "./generate";

export const dynamic = "force-dynamic";

// GET — return the latest stored digest (cron- or manually generated).
// Pure read: read-only accounts may see it too, and closed campaigns keep
// their history visible.
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireCampaign(req, params, {
    limit: 60,
    requestedOrgId: req.nextUrl.searchParams.get("orgId") || undefined,
    allowClosed: true,
  });
  if ("response" in auth) return auth.response;
  const { campaignId } = auth;

  const sql = getDb();
  let rows;
  try {
    rows = await sql`
      SELECT recommendations, source, provider, model, generated_at
      FROM campaign_recommendations WHERE campaign_id = ${campaignId}
    `;
  } catch {
    // Table may not exist yet on a fresh deployment — same as "no digest".
    return NextResponse.json({ success: true, digest: null });
  }
  if (rows.length === 0) return NextResponse.json({ success: true, digest: null });

  const r = rows[0];
  return NextResponse.json({
    success: true,
    digest: {
      recommendations: r.recommendations,
      source: r.source,
      provider: r.provider,
      model: r.model,
      generatedAt: r.generated_at,
    },
  });
}

// POST — generate AI optimization recommendations for one campaign.
// AI-backed and it writes an audit row, so POST (not GET-generate).
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const body = await req.json().catch(() => ({}));
  const locale = String(body.locale || "en").trim();

  // Tight AI-call limit (matches ad-copy/generate). Closed campaigns may
  // still be analyzed — the digest is advisory, not a mutation.
  const auth = await requireCampaign(req, params, {
    limit: 10,
    write: true,
    requestedOrgId: body.orgId,
    allowClosed: true,
  });
  if ("response" in auth) return auth.response;
  const { campaign, campaignId, userId, userEmail, orgId, ip, sql } = auth;

  let generated;
  try {
    generated = await generateCampaignRecommendations(campaign, locale);
  } catch (e) {
    if (e instanceof RecommendationGenerationError) {
      return NextResponse.json({ error: e.message }, { status: 502 });
    }
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }

  // Persist as the latest digest so it survives reloads and shows up like a
  // cron one. Best-effort — persistence failure must not eat the response.
  try {
    await persistDigest(sql, campaignId, orgId, "manual", generated.recommendations, generated.provider, generated.model);
  } catch (e) {
    console.warn(`[recommendations] persist failed for campaign ${campaignId}: ${e instanceof Error ? e.message : String(e)}`);
  }

  logAudit({
    userId,
    userEmail,
    action: "google_ads.recommendations",
    resourceType: "campaign",
    resourceId: campaignId,
    details: { count: generated.recommendations.length, provider: generated.provider, model: generated.model },
    ipAddress: ip,
  });

  return NextResponse.json({
    success: true,
    campaignId,
    generatedAt: new Date().toISOString(),
    recommendations: generated.recommendations,
    provider: generated.provider,
    model: generated.model,
  });
}
