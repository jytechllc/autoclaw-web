import { describe, it, expect } from "vitest";
import {
  bidMicrosToUsd,
  formatSearchVolume,
  parseIdeaResult,
  annotateKeywords,
  languageConstantForLocale,
  type KeywordIdea,
} from "./google-ads-keywords";

describe("google-ads-keywords pure helpers", () => {
  it("bidMicrosToUsd converts and rounds to cents", () => {
    expect(bidMicrosToUsd(2_100_000)).toBe(2.1);
    expect(bidMicrosToUsd("1234567")).toBe(1.23);
    expect(bidMicrosToUsd(0)).toBe(0);
    expect(bidMicrosToUsd(undefined)).toBe(0);
    expect(bidMicrosToUsd("not-a-number")).toBe(0);
  });

  it("formatSearchVolume compacts large numbers", () => {
    expect(formatSearchVolume(0)).toBe("0");
    expect(formatSearchVolume(880)).toBe("880");
    expect(formatSearchVolume(8100)).toBe("8.1K");
    expect(formatSearchVolume(1000)).toBe("1K");
    expect(formatSearchVolume(1_200_000)).toBe("1.2M");
    expect(formatSearchVolume(-5)).toBe("0");
  });

  it("parseIdeaResult normalizes a REST row and rejects empty text", () => {
    expect(
      parseIdeaResult({
        text: "chinese restaurant flushing",
        keywordIdeaMetrics: {
          avgMonthlySearches: "8100",
          competition: "MEDIUM",
          lowTopOfPageBidMicros: "1500000",
          highTopOfPageBidMicros: "4200000",
        },
      }),
    ).toEqual({
      text: "chinese restaurant flushing",
      avgMonthlySearches: 8100,
      competition: "MEDIUM",
      lowTopOfPageBidUsd: 1.5,
      highTopOfPageBidUsd: 4.2,
    });
    expect(parseIdeaResult({ text: "  " })).toBeNull();
    expect(parseIdeaResult({ text: "bare", keywordIdeaMetrics: undefined })).toEqual({
      text: "bare",
      avgMonthlySearches: 0,
      competition: "UNSPECIFIED",
      lowTopOfPageBidUsd: 0,
      highTopOfPageBidUsd: 0,
    });
  });

  it("annotateKeywords matches case/whitespace-insensitively and leaves unknowns bare", () => {
    const ideas: KeywordIdea[] = [
      { text: "Google Ads  中文", avgMonthlySearches: 500, competition: "LOW", lowTopOfPageBidUsd: 1, highTopOfPageBidUsd: 2 },
    ];
    const out = annotateKeywords(
      [{ text: "google ads 中文" }, { text: "no data keyword" }],
      ideas,
    );
    expect(out[0].metrics?.avgMonthlySearches).toBe(500);
    expect(out[1].metrics).toBeUndefined();
  });

  it("languageConstantForLocale covers shipped locales with en fallback", () => {
    expect(languageConstantForLocale("en")).toBe("1000");
    expect(languageConstantForLocale("zh")).toBe("1017");
    expect(languageConstantForLocale("zh-TW")).toBe("1018");
    expect(languageConstantForLocale("ko")).toBe("1012");
    expect(languageConstantForLocale("fr")).toBe("1000");
  });
});
