// Shared recommendation-generation pipeline, callable from both the
// user-facing POST route and the nightly digest cron. Builds the campaign
// snapshot from DB + live Google Ads metrics, runs the LLM, and returns
// sanitized, priority-sorted recommendations. No auth, no HTTP — callers
// own authorization and persistence.

import { fetchCampaignDetail, fetchSearchTerms } from "@/lib/google-ads";
import { chatWithAI } from "@/lib/ai";
import type { getDb } from "@/lib/db";
import {
  buildRecommendationsPrompt,
  selectWastefulTerms,
  sanitizeAutoAction,
  RECOMMENDATION_CATEGORIES,
  RECOMMENDATION_PRIORITIES,
  type CampaignSnapshot,
  type Recommendation,
  type RecommendationCategory,
  type RecommendationPriority,
} from "./prompt";

/** The campaigns-table columns the pipeline needs. */
export interface CampaignRecRow {
  id: number | string;
  platform_campaign_id: string;
  campaign_name: string | null;
  channel: string | null;
  daily_budget: number | string | null;
  currency: string | null;
  status: string | null;
  total_budget_cents: number | string | null;
  spent_cents: number | string | null;
}

export class RecommendationGenerationError extends Error {
  constructor(message: string, public readonly stage: "metrics" | "ai" | "parse") {
    super(message);
    this.name = "RecommendationGenerationError";
  }
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

export interface GeneratedRecommendations {
  recommendations: Recommendation[];
  provider?: string;
  model?: string;
}

/** Upsert the latest digest for a campaign (latest-only; history is in the audit log). */
export async function persistDigest(
  sql: ReturnType<typeof getDb>,
  campaignId: number,
  orgId: number,
  source: "cron" | "manual",
  recommendations: unknown,
  provider?: string,
  model?: string,
): Promise<void> {
  await sql`
    INSERT INTO campaign_recommendations (campaign_id, org_id, source, recommendations, provider, model, generated_at)
    VALUES (${campaignId}, ${orgId}, ${source}, ${JSON.stringify(recommendations)}::jsonb, ${provider || null}, ${model || null}, NOW())
    ON CONFLICT (campaign_id) DO UPDATE SET
      org_id = EXCLUDED.org_id,
      source = EXCLUDED.source,
      recommendations = EXCLUDED.recommendations,
      provider = EXCLUDED.provider,
      model = EXCLUDED.model,
      generated_at = NOW()
  `;
}

export async function generateCampaignRecommendations(
  c: CampaignRecRow,
  locale: string,
): Promise<GeneratedRecommendations> {
  // Pull live 30-day metrics + structure from Google Ads.
  let detail;
  try {
    detail = await fetchCampaignDetail(c.platform_campaign_id);
  } catch (e) {
    throw new RecommendationGenerationError(
      `Failed to load campaign metrics: ${e instanceof Error ? e.message : String(e)}`,
      "metrics",
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
      const terms = await fetchSearchTerms(c.platform_campaign_id, 100);
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
    throw new RecommendationGenerationError(
      `AI call failed: ${e instanceof Error ? e.message : String(e)}`,
      "ai",
    );
  }

  const raw = (aiResponse?.content || "").trim();
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new RecommendationGenerationError("AI did not return valid JSON", "parse");
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonMatch[0]);
  } catch {
    throw new RecommendationGenerationError("Failed to parse AI JSON", "parse");
  }

  const list = (parsed as { recommendations?: unknown }).recommendations;
  if (!Array.isArray(list)) {
    throw new RecommendationGenerationError("AI response missing recommendations array", "parse");
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
        autoAction: sanitizeAutoAction(o.autoAction, snapshot.dailyBudget) ?? undefined,
      };
    })
    .filter((r): r is Recommendation => r !== null);

  if (recommendations.length === 0) {
    throw new RecommendationGenerationError("AI returned no usable recommendations", "parse");
  }

  // Stable priority ordering (HIGH → MEDIUM → LOW) regardless of model output order.
  const rank: Record<RecommendationPriority, number> = { HIGH: 0, MEDIUM: 1, LOW: 2 };
  recommendations.sort((a, b) => rank[a.priority] - rank[b.priority]);

  return { recommendations, provider: aiResponse?.provider, model: aiResponse?.model };
}
