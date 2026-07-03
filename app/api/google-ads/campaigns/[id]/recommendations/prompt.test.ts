import { describe, it, expect } from "vitest";
import {
  selectWastefulTerms,
  buildRecommendationsPrompt,
  sanitizeAutoAction,
  type CampaignSnapshot,
} from "./prompt";

describe("sanitizeAutoAction", () => {
  it("accepts a budget change within ±50% of current", () => {
    expect(sanitizeAutoAction({ kind: "SET_DAILY_BUDGET", params: { dailyBudget: 12 } }, 10)).toEqual({
      kind: "SET_DAILY_BUDGET", params: { dailyBudget: 12 },
    });
  });

  it("rejects budget moves beyond the ±50% guardrail", () => {
    expect(sanitizeAutoAction({ kind: "SET_DAILY_BUDGET", params: { dailyBudget: 16 } }, 10)).toBeNull();  // +60%
    expect(sanitizeAutoAction({ kind: "SET_DAILY_BUDGET", params: { dailyBudget: 4 } }, 10)).toBeNull();   // -60%
    expect(sanitizeAutoAction({ kind: "SET_DAILY_BUDGET", params: { dailyBudget: 0 } }, 10)).toBeNull();
    expect(sanitizeAutoAction({ kind: "SET_DAILY_BUDGET", params: { dailyBudget: -5 } }, 10)).toBeNull();
  });

  it("accepts valid bid strategies and requires targets when applicable", () => {
    expect(sanitizeAutoAction({ kind: "SET_BID_STRATEGY", params: { type: "MAXIMIZE_CONVERSIONS" } }, 10)).toMatchObject({ kind: "SET_BID_STRATEGY" });
    expect(sanitizeAutoAction({ kind: "SET_BID_STRATEGY", params: { type: "TARGET_CPA", targetCpa: 5 } }, 10)).toMatchObject({ params: { type: "TARGET_CPA", targetCpa: 5 } });
    expect(sanitizeAutoAction({ kind: "SET_BID_STRATEGY", params: { type: "TARGET_CPA" } }, 10)).toBeNull();
    expect(sanitizeAutoAction({ kind: "SET_BID_STRATEGY", params: { type: "YOLO" } }, 10)).toBeNull();
  });

  it("clamps negative keywords to 10 valid entries, defaults to EXACT", () => {
    const result = sanitizeAutoAction({
      kind: "ADD_NEGATIVE_KEYWORDS",
      params: { keywords: [...Array.from({ length: 12 }, (_, i) => `kw ${i}`), "", "x".repeat(81)] },
    }, 10);
    expect(result).not.toBeNull();
    const kws = (result!.params.keywords as Array<{ text: string; matchType: string }>);
    expect(kws).toHaveLength(10);
    expect(kws[0].matchType).toBe("EXACT");
  });

  it("rejects unknown kinds and garbage", () => {
    expect(sanitizeAutoAction({ kind: "DELETE_ACCOUNT", params: {} }, 10)).toBeNull();
    expect(sanitizeAutoAction(null, 10)).toBeNull();
    expect(sanitizeAutoAction("PAUSE_CAMPAIGN", 10)).toBeNull();
    expect(sanitizeAutoAction({ kind: "ADD_NEGATIVE_KEYWORDS", params: { keywords: [] } }, 10)).toBeNull();
  });

  it("passes PAUSE_CAMPAIGN through with empty params", () => {
    expect(sanitizeAutoAction({ kind: "PAUSE_CAMPAIGN", params: { sneaky: 1 } }, 10)).toEqual({ kind: "PAUSE_CAMPAIGN", params: {} });
  });
});

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
