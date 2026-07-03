import { describe, it, expect } from "vitest";
import {
  selectWastefulTerms,
  buildRecommendationsPrompt,
  type CampaignSnapshot,
} from "./prompt";

const term = (t: string, costMicros: number, conversions = 0, clicks = 1) => ({
  term: t, clicks, costMicros, conversions,
});

describe("selectWastefulTerms", () => {
  it("keeps only zero-conversion terms with spend, ranked by cost", () => {
    const result = selectWastefulTerms([
      term("cheap alternative", 5_000_000),
      term("crm software", 9_000_000, 2),   // converts — excluded
      term("free crm", 12_000_000),
      term("what is crm", 0),               // no spend — excluded
    ]);
    expect(result.map((w) => w.term)).toEqual(["free crm", "cheap alternative"]);
    expect(result[0].cost).toBe(12);
    expect(result[0].conversions).toBe(0);
  });

  it("applies the max cap", () => {
    const terms = Array.from({ length: 10 }, (_, i) => term(`t${i}`, (i + 1) * 1_000_000));
    expect(selectWastefulTerms(terms, 3)).toHaveLength(3);
  });

  it("returns empty for empty or all-converting input", () => {
    expect(selectWastefulTerms([])).toEqual([]);
    expect(selectWastefulTerms([term("good", 5_000_000, 1)])).toEqual([]);
  });
});

function snapshot(overrides: Partial<CampaignSnapshot> = {}): CampaignSnapshot {
  return {
    name: "Test Campaign",
    channel: "SEARCH",
    status: "ENABLED",
    currency: "USD",
    dailyBudget: 10,
    totalBudget: 300,
    spent: 50,
    impressions: 1000,
    clicks: 50,
    cost: 40,
    conversions: 2,
    ctr: 5,
    avgCpc: 0.8,
    adGroupCount: 1,
    keywordCount: 10,
    adCount: 2,
    locationCount: 1,
    audienceCount: 0,
    hasAssetGroups: false,
    recentClicks: 20, priorClicks: 15,
    recentCost: 15, priorCost: 12,
    recentConversions: 1, priorConversions: 1,
    ...overrides,
  };
}

describe("buildRecommendationsPrompt — wasteful terms", () => {
  it("includes wasteful terms and negative-keyword guidance when present", () => {
    const { system, user } = buildRecommendationsPrompt(
      snapshot({ wastefulTerms: [{ term: "free crm", clicks: 8, cost: 12, conversions: 0 }] }),
      "en"
    );
    expect(user).toContain("Wasteful search terms");
    expect(user).toContain('"free crm"');
    expect(user).toContain("USD 12.00");
    expect(system).toContain("negative keywords");
  });

  it("omits the section when absent or empty", () => {
    for (const s of [snapshot(), snapshot({ wastefulTerms: [] })]) {
      const { user } = buildRecommendationsPrompt(s, "en");
      expect(user).not.toContain("Wasteful search terms");
    }
  });
});
