// Prompt template + shared types for the Google Ads AI optimization
// recommendations endpoint. Kept in its own module so the route stays thin and
// the prompt can be tuned / unit-tested in isolation.
// See docs/google-ads-audit.md — PR #2.

export const RECOMMENDATION_CATEGORIES = [
  "BUDGET",
  "BID",
  "KEYWORD",
  "AD_STRENGTH",
  "AUDIENCE",
  "TARGETING",
] as const;

export type RecommendationCategory = (typeof RECOMMENDATION_CATEGORIES)[number];

export const RECOMMENDATION_PRIORITIES = ["HIGH", "MEDIUM", "LOW"] as const;
export type RecommendationPriority = (typeof RECOMMENDATION_PRIORITIES)[number];

export interface Recommendation {
  category: RecommendationCategory;
  priority: RecommendationPriority;
  title: string;
  rationale: string;
  /** Concrete next step the user can take. */
  action: string;
  /** Optional metric this recommendation is expected to move (e.g. "CTR", "CPA"). */
  metric?: string;
}

/** Compact numeric snapshot fed to the model — derived from CampaignDetail + DB row. */
export interface CampaignSnapshot {
  name: string;
  channel: string;
  status: string;
  currency: string;
  dailyBudget: number;
  /** AutoClaw-side lifetime cap and spend, in whole currency units. */
  totalBudget: number;
  spent: number;
  // 30-day rollup
  impressions: number;
  clicks: number;
  cost: number;
  conversions: number;
  ctr: number;          // percent, e.g. 3.2
  avgCpc: number;       // currency units
  optimizationScore?: number; // 0..1
  adGroupCount: number;
  keywordCount: number;
  adCount: number;
  locationCount: number;
  audienceCount: number;
  hasAssetGroups: boolean;
  // light trend signal: last 7d vs the prior 7d
  recentClicks: number;
  priorClicks: number;
  recentCost: number;
  priorCost: number;
  recentConversions: number;
  priorConversions: number;
}

function pct(n: number): string {
  return `${n.toFixed(2)}%`;
}

function money(n: number, currency: string): string {
  return `${currency} ${n.toFixed(2)}`;
}

function trend(recent: number, prior: number): string {
  if (prior === 0 && recent === 0) return "flat";
  if (prior === 0) return "new activity";
  const change = ((recent - prior) / prior) * 100;
  const dir = change >= 0 ? "+" : "";
  return `${dir}${change.toFixed(0)}% vs prior 7d`;
}

export function buildRecommendationsPrompt(
  s: CampaignSnapshot,
  locale: string,
): { system: string; user: string } {
  const targetLanguage = locale.startsWith("zh")
    ? "Chinese"
    : locale.startsWith("ko")
      ? "Korean"
      : "English";

  const system = `You are a senior Google Ads strategist. Analyze one campaign's 30-day performance and return a ranked list of concrete optimization recommendations.

Output ONLY a single valid JSON object — no commentary, no code fences — of the exact shape:
{ "recommendations": [ { "category": "...", "priority": "...", "title": "...", "rationale": "...", "action": "...", "metric": "..." } ] }

Rules:
- category MUST be one of: ${RECOMMENDATION_CATEGORIES.join(", ")}.
- priority MUST be one of: ${RECOMMENDATION_PRIORITIES.join(", ")}. Order the array from most to least impactful (HIGH first).
- Return 3-6 recommendations. Do not pad with generic advice — every item must reference this campaign's actual numbers.
- title ≤ 60 chars. rationale ≤ 240 chars, cites the specific metric that motivates it. action ≤ 160 chars, a single concrete step.
- metric (optional) is the KPI the change should move (e.g. "CTR", "CPA", "Conversions", "CPC").
- Base advice ONLY on the data given. If conversion tracking looks absent (0 conversions with meaningful clicks), recommend setting up conversion tracking rather than guessing at CPA.
- Never invent competitor data, auction insights, or numbers not provided.
- Write titles, rationale and action in ${targetLanguage}.`;

  const user = `Campaign snapshot (last 30 days unless noted):
- Name: ${s.name}
- Channel: ${s.channel}   Status: ${s.status}
- Daily budget: ${money(s.dailyBudget, s.currency)}
- Lifetime cap / spent (AutoClaw): ${money(s.totalBudget, s.currency)} / ${money(s.spent, s.currency)}
- Optimization score: ${s.optimizationScore != null ? pct(s.optimizationScore * 100) : "n/a"}

Performance (30d):
- Impressions: ${s.impressions}
- Clicks: ${s.clicks}   CTR: ${pct(s.ctr)}
- Cost: ${money(s.cost, s.currency)}   Avg CPC: ${money(s.avgCpc, s.currency)}
- Conversions: ${s.conversions}

Trend (last 7d vs prior 7d):
- Clicks: ${trend(s.recentClicks, s.priorClicks)}
- Cost: ${trend(s.recentCost, s.priorCost)}
- Conversions: ${trend(s.recentConversions, s.priorConversions)}

Structure:
- Ad groups: ${s.adGroupCount}${s.hasAssetGroups ? " (Performance Max asset groups present)" : ""}
- Keywords: ${s.keywordCount}
- Ads: ${s.adCount}
- Locations targeted: ${s.locationCount}
- Audience signals: ${s.audienceCount}

Generate the JSON now.`;

  return { system, user };
}
