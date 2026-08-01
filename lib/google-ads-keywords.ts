// Keyword Planner integration (KeywordPlanIdeaService.GenerateKeywordIdeas).
//
// Why: our AI-generated keywords come from a language model's intuition — no
// search volume, no CPC. This module attaches Google's REAL numbers so a
// first-time owner sees "this keyword gets ~8,100 searches/month at roughly
// $2.10 a click" instead of taking the AI's word for it. (Competitive gap #1
// vs the brief-to-launch agents — see local_doc/行业对标.)
//
// Uses the same shared-customer credentials as the rest of lib/google-ads.ts.

import { getAccessToken, adsHeaders } from "@/lib/google-ads";

const GOOGLE_ADS_API_VERSION = "v23"; // keep in lockstep with lib/google-ads.ts

/** Google Ads language constant ids for the locales the product ships in. */
export const LANGUAGE_CONSTANTS: Record<string, string> = {
  en: "1000",
  zh: "1017", // Chinese (simplified)
  "zh-TW": "1018", // Chinese (traditional)
  ko: "1012",
};

export function languageConstantForLocale(locale: string): string {
  return LANGUAGE_CONSTANTS[locale] ?? LANGUAGE_CONSTANTS.en;
}

export interface KeywordIdea {
  text: string;
  /** Average monthly searches over the last 12 months (Google's number). */
  avgMonthlySearches: number;
  /** LOW | MEDIUM | HIGH | UNSPECIFIED — Google's competition bucket. */
  competition: string;
  /** Top-of-page bid range in USD (converted from micros). */
  lowTopOfPageBidUsd: number;
  highTopOfPageBidUsd: number;
}

export function bidMicrosToUsd(micros: unknown): number {
  const n = Number(micros);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.round((n / 1_000_000) * 100) / 100;
}

/** "8100" → "8.1K", "1200000" → "1.2M" — compact volume for small UI chips. */
export function formatSearchVolume(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "0";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(n % 1_000 === 0 ? 0 : 1)}K`;
  return String(n);
}

interface RawIdeaResult {
  text?: string;
  keywordIdeaMetrics?: {
    avgMonthlySearches?: string | number;
    competition?: string;
    lowTopOfPageBidMicros?: string | number;
    highTopOfPageBidMicros?: string | number;
  };
}

/** Normalize one REST result row. Exported for tests. Pure. */
export function parseIdeaResult(raw: RawIdeaResult): KeywordIdea | null {
  const text = String(raw.text || "").trim();
  if (!text) return null;
  const m = raw.keywordIdeaMetrics || {};
  return {
    text,
    avgMonthlySearches: Math.max(0, Number(m.avgMonthlySearches) || 0),
    competition: String(m.competition || "UNSPECIFIED"),
    lowTopOfPageBidUsd: bidMicrosToUsd(m.lowTopOfPageBidMicros),
    highTopOfPageBidUsd: bidMicrosToUsd(m.highTopOfPageBidMicros),
  };
}

export interface GenerateKeywordIdeasInput {
  /** Seed keywords (≤20 per Google's limit). Provide these and/or pageUrl. */
  keywords?: string[];
  /** Landing page URL seed — Google extracts themes from the page. */
  pageUrl?: string;
  /** Country criterion ids, e.g. ["2840"]. Defaults to US. */
  geoTargetIds?: string[];
  /** UI locale — mapped to a Google language constant. */
  locale?: string;
  /** Max ideas to return (Google caps a page at 1000; we default small). */
  limit?: number;
}

export async function generateKeywordIdeas(input: GenerateKeywordIdeasInput): Promise<KeywordIdea[]> {
  const customerId = process.env.GOOGLE_ADS_CUSTOMER_ID;
  if (!customerId) throw new Error("GOOGLE_ADS_CUSTOMER_ID not configured");

  const seedKeywords = (input.keywords || []).map((k) => k.trim()).filter(Boolean).slice(0, 20);
  const pageUrl = (input.pageUrl || "").trim();
  if (seedKeywords.length === 0 && !pageUrl) {
    throw new Error("generateKeywordIdeas needs seed keywords or a page URL");
  }

  const body: Record<string, unknown> = {
    language: `languageConstants/${languageConstantForLocale(input.locale || "en")}`,
    geoTargetConstants: (input.geoTargetIds?.length ? input.geoTargetIds : ["2840"]).map(
      (id) => `geoTargetConstants/${id}`,
    ),
    keywordPlanNetwork: "GOOGLE_SEARCH",
    pageSize: Math.min(Math.max(input.limit ?? 50, 1), 200),
  };
  if (seedKeywords.length > 0 && pageUrl) {
    body.keywordAndUrlSeed = { keywords: seedKeywords, url: pageUrl };
  } else if (seedKeywords.length > 0) {
    body.keywordSeed = { keywords: seedKeywords };
  } else {
    body.urlSeed = { url: pageUrl };
  }

  const accessToken = await getAccessToken();
  const res = await fetch(
    `https://googleads.googleapis.com/${GOOGLE_ADS_API_VERSION}/customers/${customerId}:generateKeywordIdeas`,
    { method: "POST", headers: adsHeaders(accessToken), body: JSON.stringify(body) },
  );
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`generateKeywordIdeas failed: HTTP ${res.status} ${text.slice(0, 500)}`);
  }
  let parsed: { results?: RawIdeaResult[] };
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("generateKeywordIdeas returned non-JSON");
  }
  return (parsed.results || [])
    .map(parseIdeaResult)
    .filter((k): k is KeywordIdea => k !== null);
}

/** Attach real metrics to AI-generated keywords by normalized text match.
 *  Keywords Google has no data for keep metrics undefined (UI shows "—").
 *  Pure — unit-tested. */
export function annotateKeywords<T extends { text: string }>(
  aiKeywords: T[],
  ideas: KeywordIdea[],
): Array<T & { metrics?: KeywordIdea }> {
  const byText = new Map(ideas.map((i) => [i.text.toLowerCase().replace(/\s+/g, " ").trim(), i]));
  return aiKeywords.map((k) => {
    const metrics = byText.get(k.text.toLowerCase().replace(/\s+/g, " ").trim());
    return metrics ? { ...k, metrics } : { ...k };
  });
}
