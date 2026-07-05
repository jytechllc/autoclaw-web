import { describe, expect, it } from "vitest";
import { diffScan, renderReport, type HFModel } from "./oss-monitor";

const NOW = Date.parse("2026-07-05T12:00:00Z");
const TODAY = "2026-07-05";

const model = (id: string, createdAt: string, extra: Partial<HFModel> = {}): HFModel => ({
  id,
  likes: 10,
  downloads: 100,
  pipeline_tag: "text-generation",
  createdAt,
  ...extra,
});

describe("diffScan", () => {
  it("baseline scan marks everything seen but only reports last-7-day releases", () => {
    const orgModels = [
      model("org/new-model", "2026-07-02T00:00:00Z"),
      model("org/old-model", "2025-01-01T00:00:00Z"),
    ];
    const { result, seen } = diffScan(orgModels, [], {}, [], TODAY, NOW);

    expect(result.isBaseline).toBe(true);
    expect(result.newReleases.map((m) => m.id)).toEqual(["org/new-model"]);
    expect(seen).toEqual({ "org/new-model": TODAY, "org/old-model": TODAY });
    // No previous trending snapshot → no "entered trending" noise.
    expect(result.trendingEnters).toEqual([]);
  });

  it("incremental scan reports only unseen models and new trending entries", () => {
    const prevSeen = { "org/known": "2026-07-01" };
    const orgModels = [model("org/known", "2026-06-30T00:00:00Z"), model("org/fresh", "2026-07-04T00:00:00Z")];
    const trending = [model("t/stays", "2026-06-01T00:00:00Z"), model("t/enters", "2026-06-20T00:00:00Z")];

    const { result, seen } = diffScan(orgModels, trending, prevSeen, ["t/stays"], TODAY, NOW);

    expect(result.isBaseline).toBe(false);
    expect(result.newReleases.map((m) => m.id)).toEqual(["org/fresh"]);
    expect(result.trendingEnters.map((m) => m.id)).toEqual(["t/enters"]);
    expect(seen["org/fresh"]).toBe(TODAY);
    expect(seen["org/known"]).toBe("2026-07-01"); // first-seen date preserved
  });
});

describe("renderReport", () => {
  it("renders sections and the AI summary when present", () => {
    const { result } = diffScan([model("org/fresh", "2026-07-04T00:00:00Z")], [], { "org/x": "2026-01-01" }, [], TODAY, NOW);
    const md = renderReport(result, TODAY, "- 测试摘要");

    expect(md).toContain(`# OSS Model Watch — ${TODAY}`);
    expect(md).toContain("分析摘要");
    expect(md).toContain("[org/fresh](https://huggingface.co/org/fresh)");
    expect(md).not.toContain("baseline");
  });
});
