import { describe, it, expect } from "vitest";
import {
  analyzeCampaign,
  isoDaysAgo,
  SPIKE_MULTIPLIER,
  SPIKE_MIN_USD,
  type DailyMetricRow,
} from "./google-ads-monitor";

function day(date: string, over: Partial<DailyMetricRow> = {}): DailyMetricRow {
  return { date, costMicros: 0, impressions: 0, clicks: 0, conversions: 0, ...over };
}

/** 7 calm trailing days + one "yesterday" under inspection. */
function week(overYesterday: Partial<DailyMetricRow>, overTrailing: Partial<DailyMetricRow> = {}): DailyMetricRow[] {
  const rows: DailyMetricRow[] = [];
  for (let i = 8; i >= 2; i -= 1) rows.push(day(isoDaysAgo(i), overTrailing));
  rows.push(day(isoDaysAgo(1), overYesterday));
  return rows;
}

describe("analyzeCampaign", () => {
  it("stays silent on calm data", () => {
    const rows = week(
      { costMicros: 5_000_000, impressions: 900, clicks: 40, conversions: 2 },
      { costMicros: 5_000_000, impressions: 1000, clicks: 45, conversions: 2 },
    );
    expect(analyzeCampaign("c/1", "ENABLED", rows)).toEqual([]);
  });

  it("flags a spend spike above multiplier AND absolute floor", () => {
    const rows = week(
      { costMicros: 20_000_000, impressions: 1000, clicks: 40, conversions: 1 }, // $20 vs $5 avg = 4x
      { costMicros: 5_000_000, impressions: 1000, clicks: 40, conversions: 1 },
    );
    const alerts = analyzeCampaign("c/1", "ENABLED", rows);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].kind).toBe("SPEND_SPIKE");
    expect(alerts[0].numbers.yesterdayUsd).toBe(20);
    expect(alerts[0].numbers.multiple).toBeGreaterThanOrEqual(SPIKE_MULTIPLIER);
  });

  it("ignores spikes below the absolute floor (tiny budgets)", () => {
    const rows = week(
      { costMicros: 1_000_000 }, // $1 — 10x the trailing $0.10 but under SPIKE_MIN_USD
      { costMicros: 100_000 },
    );
    expect(SPIKE_MIN_USD).toBeGreaterThan(1);
    expect(analyzeCampaign("c/1", "ENABLED", rows)).toEqual([]);
  });

  it("flags zero impressions only for ENABLED campaigns that used to serve", () => {
    const trailing = { impressions: 800, costMicros: 3_000_000, clicks: 30 };
    const rowsEnabled = week({ impressions: 0 }, trailing);
    const enabled = analyzeCampaign("c/1", "ENABLED", rowsEnabled);
    expect(enabled.map((a) => a.kind)).toContain("ZERO_IMPRESSIONS");
    // Paused campaigns are expected to serve nothing.
    expect(analyzeCampaign("c/1", "PAUSED", rowsEnabled)).toEqual([]);
    // Never really served → nothing anomalous.
    const rowsQuiet = week({ impressions: 0 }, { impressions: 3 });
    expect(analyzeCampaign("c/1", "ENABLED", rowsQuiet)).toEqual([]);
  });

  it("flags conversions dropping to zero while clicks keep flowing", () => {
    const rows = week(
      { conversions: 0, clicks: 50, impressions: 1000, costMicros: 4_000_000 },
      { conversions: 2, clicks: 50, impressions: 1000, costMicros: 4_000_000 },
    );
    const alerts = analyzeCampaign("c/1", "ENABLED", rows);
    expect(alerts.map((a) => a.kind)).toContain("CONVERSIONS_DROPPED");
    const drop = alerts.find((a) => a.kind === "CONVERSIONS_DROPPED")!;
    expect(drop.numbers.trailingConversions).toBe(14);
    expect(drop.severity).toBe("MEDIUM");
  });

  it("needs at least 4 days of history", () => {
    const rows = [day(isoDaysAgo(3)), day(isoDaysAgo(2)), day(isoDaysAgo(1), { costMicros: 99_000_000 })];
    expect(analyzeCampaign("c/1", "ENABLED", rows)).toEqual([]);
  });
});

describe("isoDaysAgo", () => {
  it("returns YYYY-MM-DD and is monotonic", () => {
    expect(isoDaysAgo(1)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(isoDaysAgo(2) < isoDaysAgo(1)).toBe(true);
  });
});
