import { describe, it, expect } from "vitest";
import {
  INDUSTRY_BENCHMARKS,
  findBenchmark,
  suggestBudget,
  industryLabel,
} from "./google-ads-benchmarks";

describe("google-ads-benchmarks", () => {
  it("every industry has sane, ordered tiers and full labels", () => {
    for (const b of INDUSTRY_BENCHMARKS) {
      expect(b.daily.starter).toBeGreaterThan(0);
      expect(b.daily.recommended).toBeGreaterThanOrEqual(b.daily.starter);
      expect(b.daily.aggressive).toBeGreaterThanOrEqual(b.daily.recommended);
      expect(b.avgCpcUsd).toBeGreaterThan(0);
      expect(b.label.en).toBeTruthy();
      expect(b.label.zh).toBeTruthy();
      expect(b.label["zh-TW"]).toBeTruthy();
      expect(b.label.ko).toBeTruthy();
    }
  });

  it("ids are unique and include the 'other' fallback", () => {
    const ids = INDUSTRY_BENCHMARKS.map((b) => b.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain("other");
  });

  it("suggestBudget uses the recommended tier and a 30-day cap", () => {
    const legal = suggestBudget("legal");
    expect(legal.dailyBudget).toBe(findBenchmark("legal")!.daily.recommended);
    expect(legal.totalBudget).toBe(legal.dailyBudget * 30);
    expect(legal.peerDailyMin).toBeLessThanOrEqual(legal.dailyBudget);
    expect(legal.peerDailyMax).toBeGreaterThanOrEqual(legal.dailyBudget);
  });

  it("unknown industry falls back to 'other'", () => {
    expect(suggestBudget("space-mining")).toEqual(suggestBudget("other"));
  });

  it("industryLabel resolves all four locales with en fallback", () => {
    const b = findBenchmark("restaurant")!;
    expect(industryLabel(b, "zh")).toBe("餐饮");
    expect(industryLabel(b, "zh-TW")).toBe("餐飲");
    expect(industryLabel(b, "ko")).toBe("요식업");
    expect(industryLabel(b, "en")).toBe("Restaurant / Food");
    expect(industryLabel(b, "fr")).toBe("Restaurant / Food");
  });
});
