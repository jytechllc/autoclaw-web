import { describe, it, expect } from "vitest";
import { isDigestStale, selectCampaignsForDigest, type DigestCandidate } from "./digest";

const NOW = new Date("2026-07-03T05:15:00Z");

function hoursAgo(h: number): string {
  return new Date(NOW.getTime() - h * 3_600_000).toISOString();
}

function candidate(overrides: Partial<DigestCandidate> = {}): DigestCandidate {
  return { id: 1, status: "ENABLED", closed: false, spentCents: 1000, generatedAt: null, ...overrides };
}

describe("isDigestStale", () => {
  it("null / unparseable timestamps are stale", () => {
    expect(isDigestStale(null, NOW)).toBe(true);
    expect(isDigestStale("not a date", NOW)).toBe(true);
  });

  it("respects the age threshold on both sides", () => {
    expect(isDigestStale(hoursAgo(19), NOW, 20)).toBe(false);
    expect(isDigestStale(hoursAgo(21), NOW, 20)).toBe(true);
  });

  it("accepts Date objects", () => {
    expect(isDigestStale(new Date(NOW.getTime() - 25 * 3_600_000), NOW, 20)).toBe(true);
    expect(isDigestStale(new Date(NOW.getTime() - 1 * 3_600_000), NOW, 20)).toBe(false);
  });
});

describe("selectCampaignsForDigest", () => {
  it("keeps only ENABLED, not-closed campaigns with stale digests", () => {
    const rows: DigestCandidate[] = [
      candidate({ id: 1 }), // eligible: never generated
      candidate({ id: 2, status: "PAUSED" }), // paused → out
      candidate({ id: 3, closed: true }), // closed → out
      candidate({ id: 4, generatedAt: hoursAgo(2) }), // fresh → out
      candidate({ id: 5, generatedAt: hoursAgo(30) }), // stale → in
    ];
    expect(selectCampaignsForDigest(rows, NOW)).toEqual([1, 5]);
  });

  it("orders by spend (highest first) and caps at maxPerOrg", () => {
    const rows: DigestCandidate[] = [
      candidate({ id: 1, spentCents: 100 }),
      candidate({ id: 2, spentCents: 900 }),
      candidate({ id: 3, spentCents: 500 }),
      candidate({ id: 4, spentCents: 700 }),
    ];
    expect(selectCampaignsForDigest(rows, NOW, { maxPerOrg: 2 })).toEqual([2, 4]);
  });

  it("status matching is case-insensitive and null-safe", () => {
    const rows: DigestCandidate[] = [
      candidate({ id: 1, status: "enabled" }),
      candidate({ id: 2, status: null }),
    ];
    expect(selectCampaignsForDigest(rows, NOW)).toEqual([1]);
  });

  it("honors a custom maxAgeHours", () => {
    const rows: DigestCandidate[] = [candidate({ id: 1, generatedAt: hoursAgo(5) })];
    expect(selectCampaignsForDigest(rows, NOW, { maxAgeHours: 4 })).toEqual([1]);
    expect(selectCampaignsForDigest(rows, NOW, { maxAgeHours: 6 })).toEqual([]);
  });

  it("empty input and zero cap are safe", () => {
    expect(selectCampaignsForDigest([], NOW)).toEqual([]);
    expect(selectCampaignsForDigest([candidate()], NOW, { maxPerOrg: 0 })).toEqual([]);
  });
});
