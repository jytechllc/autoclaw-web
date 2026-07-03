import { NextRequest, NextResponse } from "next/server";
import { auth0 } from "@/lib/auth0";
import { getDb } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { checkRateLimit } from "@/lib/rate-limit";
import { fetchCampaignDetail, fetchSearchTerms } from "@/lib/google-ads";
import { resolveOrgId } from "@/lib/credits";
import { chatWithAI } from "@/lib/ai";
import {
  buildRecommendationsPrompt,
  selectWastefulTerms,
  RECOMMENDATION_CATEGORIES,
  RECOMMENDATION_PRIORITIES,
  type CampaignSnapshot,
  type Recommendation,
  type RecommendationCategory,
  type RecommendationPriority,
} from "./prompt";

export const dynamic = "force-dynamic";

function getIp(req: NextRequest): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}

function clip(s: string, max: number): string {
  const t = s.trim();
  return t.length <= max ? t : t.slice(0, max).trim();
}

/** Sum a numeric field over a slice of the daily-metrics array. */
function sumSlice(
  daily: Array<{ clicks: number; costMicros: number; conversions: number }>,
  from: number,
  to: number,
  key: "clicks" | "costMicros" | "conversions",
): number {
  return daily.slice(from, to).reduce((acc, d) => acc + (Number(d[key]) || 0), 0);
}

// POST — generate AI optimization recommendations for one campaign.
// AI-backed and it writes an audit row, so POST (not GET). No DB mutation.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ip = getIp(req);
  // AI calls are expensive — keep the limit tight (matches ad-copy/generate).
  if (!checkRateLimit(ip, { limit: 10, windowMs: 60_000 })) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  const session = await auth0.getSession();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const campaignId = Number(id);
  if (!Number.isFinite(campaignId)) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  const body = await req.json().catch(() => ({}));
  const locale = String(body.locale || "en").trim();

  const sql = getDb();
  const userEmail = session.user.email as string;
  const users = await sql`SELECT id FROM users WHERE email = ${userEmail}`;
  if (users.length === 0) return NextResponse.json({ error: "User not found" }, { status: 404 });
  const userId = users[0].id as number;

  const requestedOrgId = body.orgId ? Number(body.orgId) : undefined;
  const orgId = await resolveOrgId(sql, userId, requestedOrgId);
  if (!orgId) return NextResponse.json({ error: "No organization found" }, { status: 400 });

  // Campaign must belong to the requesting org.
  const rows = await sql`
    SELECT id, platform_campaign_id, campaign_name, channel, daily_budget, currency, status,
           total_budget_cents, spent_cents
    FROM campaigns
    WHERE id = ${campaignId} AND org_id = ${orgId} AND platform = 'google'
  `;
  if (rows.length === 0) return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
  const c = rows[0];

  // Pull live 30-day metrics + structure from Google Ads.
  let detail;
  try {
    detail = await fetchCampaignDetail(c.platform_campaign_id as string);
  } catch (e) {
    return NextResponse.json(
      { error: `Failed to load campaign metrics: ${e instanceof Error ? e.message : String(e)}` },
      { status: 502 },
    );
  }

  const daily = detail.dailyMetrics || [];
  const clicks = detail.metrics.clicks || 0;
  const impressions = detail.metrics.impressions || 0;
  const cost = (detail.metrics.costMicros || 0) / 1_000_000;
  const conversions = detail.metrics.conversions || 0;

  const snapshot: CampaignSnapshot = {
    name: (c.campaign_name as string) || detail.name,
    channel: (c.channel as string) || detail.channelType,
    status: (c.status as string) || detail.status,
    currency: (c.currency as string) || "USD",
    dailyBudget: Number(c.daily_budget || 0),
    totalBudget: Number(c.total_budget_cents || 0) / 100,
    spent: Number(c.spent_cents || 0) / 100,
    impressions,
    clicks,
    cost,
    conversions,
    // Compute from raw counts so we don't depend on the API's ctr/cpc unit.
    ctr: impressions > 0 ? (clicks / impressions) * 100 : 0,
    avgCpc: clicks > 0 ? cost / clicks : 0,
    optimizationScore: detail.optimizationScore,
    adGroupCount: detail.adGroups?.length || 0,
    keywordCount: detail.keywords?.length || 0,
    adCount: detail.ads?.length || 0,
    locationCount: detail.locations?.length || 0,
    audienceCount: detail.audiences?.length || 0,
    hasAssetGroups: (detail.assetGroups?.length || 0) > 0,
    // dailyMetrics is oldest→newest with 30 entries; last 7 vs prior 7.
    recentClicks: sumSlice(daily, daily.length - 7, daily.length, "clicks"),
    priorClicks: sumSlice(daily, daily.length - 14, daily.length - 7, "clicks"),
    recentCost: sumSlice(daily, daily.length - 7, daily.length, "costMicros") / 1_000_000,
    priorCost: sumSlice(daily, daily.length - 14, daily.length - 7, "costMicros") / 1_000_000,
    recentConversions: sumSlice(daily, daily.length - 7, daily.length, "conversions"),
    priorConversions: sumSlice(daily, daily.length - 14, daily.length - 7, "conversions"),
  };

  // SEARCH campaigns: surface money-burning search terms so KEYWORD advice
  // can name real offenders. Best-effort — the report must not block recs.
  if ((snapshot.channel || "").toUpperCase() === "SEARCH") {
    try {
      const terms = await fetchSearchTerms(c.platform_campaign_id as string, 100);
      snapshot.wastefulTerms = selectWastefulTerms(terms, 5);
    } catch {
      /* search_term_view can be slow/unavailable — proceed without it */
    }
  }

  const { system, user } = buildRecommendationsPrompt(snapshot, locale);

  let aiResponse;
  try {
    aiResponse = await chatWithAI(
      [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      1200,
    );
  } catch (e) {
    return NextResponse.json(
      { error: `AI call failed: ${e instanceof Error ? e.message : String(e)}` },
      { status: 502 },
    );
  }

  const raw = (aiResponse?.content || "").trim();
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    return NextResponse.json({ error: "AI did not return valid JSON", raw }, { status: 502 });
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonMatch[0]);
  } catch {
    return NextResponse.json({ error: "Failed to parse AI JSON", raw }, { status: 502 });
  }

  const list = (parsed as { recommendations?: unknown }).recommendations;
  if (!Array.isArray(list)) {
    return NextResponse.json({ error: "AI response missing recommendations array", raw }, { status: 502 });
  }

  const categories = RECOMMENDATION_CATEGORIES as readonly string[];
  const priorities = RECOMMENDATION_PRIORITIES as readonly string[];

  const recommendations: Recommendation[] = list
    .map((r): Recommendation | null => {
      if (!r || typeof r !== "object") return null;
      const o = r as Record<string, unknown>;
      const cat = String(o.category || "").toUpperCase();
      const pri = String(o.priority || "").toUpperCase();
      const title = clip(String(o.title || ""), 60);
      const rationale = clip(String(o.rationale || ""), 240);
      const action = clip(String(o.action || ""), 160);
      if (!title || !action) return null;
      return {
        category: (categories.includes(cat) ? cat : "TARGETING") as RecommendationCategory,
        priority: (priorities.includes(pri) ? pri : "MEDIUM") as RecommendationPriority,
        title,
        rationale,
        action,
        metric: o.metric ? clip(String(o.metric), 40) : undefined,
      };
    })
    .filter((r): r is Recommendation => r !== null);

  if (recommendations.length === 0) {
    return NextResponse.json({ error: "AI returned no usable recommendations", raw }, { status: 502 });
  }

  // Stable priority ordering (HIGH → MEDIUM → LOW) regardless of model output order.
  const rank: Record<RecommendationPriority, number> = { HIGH: 0, MEDIUM: 1, LOW: 2 };
  recommendations.sort((a, b) => rank[a.priority] - rank[b.priority]);

  logAudit({
    userId,
    userEmail,
    action: "google_ads.recommendations",
    resourceType: "campaign",
    resourceId: campaignId,
    details: { count: recommendations.length, provider: aiResponse?.provider, model: aiResponse?.model },
    ipAddress: ip,
  });

  return NextResponse.json({
    success: true,
    campaignId,
    generatedAt: new Date().toISOString(),
    recommendations,
    provider: aiResponse?.provider,
    model: aiResponse?.model,
  });
}
