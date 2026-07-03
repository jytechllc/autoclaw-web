import { describe, it, expect } from "vitest";
import {
  validateAssetGroupInput,
  validateBidStrategyInput,
  allowedBidStrategies,
  channelSupportsNegativeKeywords,
  validateConversionActionInput,
  validateAdScheduleInput,
  channelSupportsAdSchedule,
  validateDeviceModifiers,
  channelSupportsDeviceModifiers,
  type CreateAssetGroupInput,
  type CreateConversionActionInput,
} from "./google-ads";

/**
 * Validation tests for PMAX asset group input.
 * Scaffolds the contract enforced before PR #18b's createAssetGroup()
 * actually calls Google Ads.
 *
 * Refs: KAN-53
 */

function validInput(overrides: Partial<CreateAssetGroupInput["assets"]> = {}): CreateAssetGroupInput {
  return {
    campaignResourceName: "customers/1234567890/campaigns/9876543210",
    name: "Spring Sale 2026",
    assets: {
      headlines: ["Buy now", "Save big today", "Free shipping"],
      longHeadlines: ["Up to 50% off our entire spring collection"],
      descriptions: [
        "Limited time offer on top brands.",
        "Shop our spring collection with free shipping on orders over $50.",
      ],
      businessName: "Acme Co",
      finalUrl: "https://acme.example.com/spring",
      marketingImageUrls: ["https://cdn.example.com/landscape.jpg"],
      squareMarketingImageUrls: ["https://cdn.example.com/square.jpg"],
      ...overrides,
    },
  };
}

describe("validateAssetGroupInput — happy path", () => {
  it("accepts a minimally valid input", () => {
    const result = validateAssetGroupInput(validInput());
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });
});

describe("validateAssetGroupInput — name + campaign", () => {
  it("rejects missing name", () => {
    const result = validateAssetGroupInput({ ...validInput(), name: "" });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("name is required"))).toBe(true);
  });

  it("rejects bad campaignResourceName", () => {
    const result = validateAssetGroupInput({ ...validInput(), campaignResourceName: "not-a-resource" });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("campaignResourceName"))).toBe(true);
  });
});

describe("validateAssetGroupInput — headlines", () => {
  it("rejects fewer than 3 headlines", () => {
    const result = validateAssetGroupInput(validInput({ headlines: ["A", "B"] }));
    expect(result.errors.some((e) => e.includes("Headlines: at least 3"))).toBe(true);
  });

  it("rejects more than 15 headlines", () => {
    const result = validateAssetGroupInput(validInput({ headlines: Array(16).fill("x") }));
    expect(result.errors.some((e) => e.includes("at most 15"))).toBe(true);
  });

  it("rejects a headline over 30 chars", () => {
    const result = validateAssetGroupInput(
      validInput({ headlines: ["ok", "ok2", "x".repeat(31)] })
    );
    expect(result.errors.some((e) => e.includes("1-30 characters"))).toBe(true);
  });
});

describe("validateAssetGroupInput — descriptions", () => {
  it("rejects fewer than 2 descriptions", () => {
    const result = validateAssetGroupInput(validInput({ descriptions: ["only one"] }));
    expect(result.errors.some((e) => e.includes("at least 2 required"))).toBe(true);
  });

  it("rejects when no description ≤60 chars (short slot missing)", () => {
    const result = validateAssetGroupInput(
      validInput({
        descriptions: ["x".repeat(61), "y".repeat(80)],
      })
    );
    expect(result.errors.some((e) => e.includes("short description slot"))).toBe(true);
  });

  it("rejects a description over 90 chars", () => {
    const result = validateAssetGroupInput(
      validInput({ descriptions: ["short ok", "x".repeat(91)] })
    );
    expect(result.errors.some((e) => e.includes("1-90 characters"))).toBe(true);
  });
});

describe("validateAssetGroupInput — business name + final URL", () => {
  it("rejects empty business name", () => {
    const result = validateAssetGroupInput(validInput({ businessName: "" }));
    expect(result.errors.some((e) => e.includes("Business name is required"))).toBe(true);
  });

  it("rejects business name > 25 chars", () => {
    const result = validateAssetGroupInput(validInput({ businessName: "x".repeat(26) }));
    expect(result.errors.some((e) => e.includes("≤25 characters"))).toBe(true);
  });

  it("rejects non-http final URL", () => {
    const result = validateAssetGroupInput(validInput({ finalUrl: "javascript:alert(1)" }));
    expect(result.errors.some((e) => e.includes("Final URL"))).toBe(true);
  });
});

describe("validateAssetGroupInput — images", () => {
  it("rejects when no landscape marketing image", () => {
    const result = validateAssetGroupInput(validInput({ marketingImageUrls: [] }));
    expect(result.errors.some((e) => e.includes("landscape 1.91:1"))).toBe(true);
  });

  it("rejects when no square marketing image", () => {
    const result = validateAssetGroupInput(validInput({ squareMarketingImageUrls: [] }));
    expect(result.errors.some((e) => e.includes("Square marketing images"))).toBe(true);
  });
});

describe("validateAssetGroupInput — accumulates multiple errors", () => {
  it("returns all errors at once, not just the first", () => {
    const result = validateAssetGroupInput({
      campaignResourceName: "bad",
      name: "",
      assets: {
        headlines: [],
        longHeadlines: [],
        descriptions: [],
        businessName: "",
        finalUrl: "",
        marketingImageUrls: [],
        squareMarketingImageUrls: [],
      },
    });
    expect(result.valid).toBe(false);
    // Expect at least 8 distinct errors (one per field family)
    expect(result.errors.length).toBeGreaterThanOrEqual(8);
  });
});

// ---------------------------------------------------------------------------
// validateBidStrategyInput (PR #3)
// ---------------------------------------------------------------------------

describe("validateBidStrategyInput — type + channel rules", () => {
  it("accepts MANUAL_CPC for SEARCH", () => {
    const result = validateBidStrategyInput("SEARCH", { type: "MANUAL_CPC" });
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("rejects an unknown type", () => {
    const result = validateBidStrategyInput("SEARCH", { type: "TARGET_IMPRESSION_SHARE" as never });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("type must be one of"))).toBe(true);
  });

  it("rejects MANUAL_CPC for VIDEO", () => {
    const result = validateBidStrategyInput("VIDEO", { type: "MANUAL_CPC" });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("not supported for VIDEO"))).toBe(true);
  });

  it("rejects MANUAL_CPC for PERFORMANCE_MAX", () => {
    const result = validateBidStrategyInput("PERFORMANCE_MAX", { type: "MANUAL_CPC" });
    expect(result.valid).toBe(false);
  });

  it("accepts TARGET_ROAS for PERFORMANCE_MAX", () => {
    const result = validateBidStrategyInput("PERFORMANCE_MAX", { type: "TARGET_ROAS", targetRoas: 4 });
    expect(result.valid).toBe(true);
  });

  it("falls back to allowing all strategies for unknown channels", () => {
    const result = validateBidStrategyInput("", { type: "MAXIMIZE_CLICKS" });
    expect(result.valid).toBe(true);
  });
});

describe("validateBidStrategyInput — targets", () => {
  it("requires targetCpaUsd for TARGET_CPA", () => {
    const result = validateBidStrategyInput("SEARCH", { type: "TARGET_CPA" });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("targetCpaUsd is required"))).toBe(true);
  });

  it("rejects targetCpaUsd <= 0", () => {
    const result = validateBidStrategyInput("SEARCH", { type: "TARGET_CPA", targetCpaUsd: 0 });
    expect(result.valid).toBe(false);
  });

  it("accepts a valid TARGET_CPA", () => {
    const result = validateBidStrategyInput("SEARCH", { type: "TARGET_CPA", targetCpaUsd: 12.5 });
    expect(result.valid).toBe(true);
  });

  it("requires targetRoas for TARGET_ROAS", () => {
    const result = validateBidStrategyInput("SEARCH", { type: "TARGET_ROAS" });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("targetRoas is required"))).toBe(true);
  });

  it("rejects targetRoas above Google's 1000 limit", () => {
    const result = validateBidStrategyInput("SEARCH", { type: "TARGET_ROAS", targetRoas: 1001 });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("≤1000"))).toBe(true);
  });

  it("rejects a target passed with the wrong type", () => {
    const cpaOnWrongType = validateBidStrategyInput("SEARCH", { type: "MAXIMIZE_CONVERSIONS", targetCpaUsd: 10 });
    expect(cpaOnWrongType.valid).toBe(false);
    expect(cpaOnWrongType.errors.some((e) => e.includes("only valid with type TARGET_CPA"))).toBe(true);

    const roasOnWrongType = validateBidStrategyInput("SEARCH", { type: "MANUAL_CPC", targetRoas: 4 });
    expect(roasOnWrongType.valid).toBe(false);
    expect(roasOnWrongType.errors.some((e) => e.includes("only valid with type TARGET_ROAS"))).toBe(true);
  });
});

describe("allowedBidStrategies", () => {
  it("returns the restricted set for VIDEO", () => {
    expect(allowedBidStrategies("VIDEO")).toEqual(["MAXIMIZE_CONVERSIONS", "TARGET_CPA"]);
  });

  it("returns all six for SEARCH", () => {
    expect(allowedBidStrategies("SEARCH")).toHaveLength(6);
  });
});

// ---------------------------------------------------------------------------
// validateConversionActionInput (PR #4a)
// ---------------------------------------------------------------------------

function validConversionInput(overrides: Partial<CreateConversionActionInput> = {}): CreateConversionActionInput {
  return {
    name: "Sign-up (website)",
    category: "SIGNUP",
    countingType: "ONE_PER_CLICK",
    ...overrides,
  };
}

describe("validateConversionActionInput", () => {
  it("accepts a minimally valid input", () => {
    const result = validateConversionActionInput(validConversionInput());
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("accepts a purchase with default value and lookback", () => {
    const result = validateConversionActionInput(validConversionInput({
      category: "PURCHASE", countingType: "MANY_PER_CLICK", defaultValueUsd: 49.99, clickLookbackDays: 30,
    }));
    expect(result.valid).toBe(true);
  });

  it("rejects empty name", () => {
    const result = validateConversionActionInput(validConversionInput({ name: "  " }));
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("name is required"))).toBe(true);
  });

  it("rejects name over 100 chars", () => {
    const result = validateConversionActionInput(validConversionInput({ name: "x".repeat(101) }));
    expect(result.valid).toBe(false);
  });

  it("rejects unknown category", () => {
    const result = validateConversionActionInput(validConversionInput({ category: "STORE_VISIT" as never }));
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("category must be one of"))).toBe(true);
  });

  it("rejects unknown counting type", () => {
    const result = validateConversionActionInput(validConversionInput({ countingType: "EVERY_TIME" as never }));
    expect(result.valid).toBe(false);
  });

  it("rejects negative default value", () => {
    const result = validateConversionActionInput(validConversionInput({ defaultValueUsd: -1 }));
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("defaultValueUsd"))).toBe(true);
  });

  it("rejects out-of-range lookback windows", () => {
    for (const days of [0, 91, 2.5]) {
      const result = validateConversionActionInput(validConversionInput({ clickLookbackDays: days }));
      expect(result.valid).toBe(false);
    }
  });

  it("accepts boundary lookback windows 1 and 90", () => {
    for (const days of [1, 90]) {
      const result = validateConversionActionInput(validConversionInput({ clickLookbackDays: days }));
      expect(result.valid).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// validateAdScheduleInput (day parting)
// ---------------------------------------------------------------------------

describe("validateAdScheduleInput", () => {
  it("accepts an empty list (run at all times)", () => {
    expect(validateAdScheduleInput([]).valid).toBe(true);
  });

  it("accepts Mon-Fri business hours", () => {
    const days = ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY"] as const;
    const schedules = days.map((d) => ({ dayOfWeek: d, startHour: 9, endHour: 18 }));
    const result = validateAdScheduleInput(schedules);
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("accepts multiple non-overlapping intervals on one day", () => {
    const result = validateAdScheduleInput([
      { dayOfWeek: "MONDAY", startHour: 9, endHour: 12 },
      { dayOfWeek: "MONDAY", startHour: 14, endHour: 18 },
    ]);
    expect(result.valid).toBe(true);
  });

  it("accepts back-to-back intervals (end == next start)", () => {
    const result = validateAdScheduleInput([
      { dayOfWeek: "MONDAY", startHour: 9, endHour: 12 },
      { dayOfWeek: "MONDAY", startHour: 12, endHour: 18 },
    ]);
    expect(result.valid).toBe(true);
  });

  it("rejects an unknown day", () => {
    const result = validateAdScheduleInput([{ dayOfWeek: "FUNDAY" as never, startHour: 9, endHour: 18 }]);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("dayOfWeek"))).toBe(true);
  });

  it("rejects endHour <= startHour", () => {
    for (const [s, e] of [[18, 9], [9, 9]] as const) {
      const result = validateAdScheduleInput([{ dayOfWeek: "MONDAY", startHour: s, endHour: e }]);
      expect(result.valid).toBe(false);
    }
  });

  it("rejects out-of-range and fractional hours", () => {
    expect(validateAdScheduleInput([{ dayOfWeek: "MONDAY", startHour: -1, endHour: 5 }]).valid).toBe(false);
    expect(validateAdScheduleInput([{ dayOfWeek: "MONDAY", startHour: 0, endHour: 25 }]).valid).toBe(false);
    expect(validateAdScheduleInput([{ dayOfWeek: "MONDAY", startHour: 9.5, endHour: 18 }]).valid).toBe(false);
  });

  it("rejects overlapping intervals on the same day", () => {
    const result = validateAdScheduleInput([
      { dayOfWeek: "MONDAY", startHour: 9, endHour: 14 },
      { dayOfWeek: "MONDAY", startHour: 13, endHour: 18 },
    ]);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("overlap"))).toBe(true);
  });

  it("rejects more than 6 intervals on one day", () => {
    const schedules = Array.from({ length: 7 }, (_, i) => ({
      dayOfWeek: "MONDAY" as const, startHour: i * 2, endHour: i * 2 + 1,
    }));
    const result = validateAdScheduleInput(schedules);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("at most 6"))).toBe(true);
  });
});

describe("channelSupportsAdSchedule", () => {
  it("allows SEARCH / DISPLAY / SHOPPING / VIDEO, rejects PMax and Demand Gen", () => {
    for (const ch of ["SEARCH", "DISPLAY", "SHOPPING", "VIDEO"]) {
      expect(channelSupportsAdSchedule(ch)).toBe(true);
    }
    expect(channelSupportsAdSchedule("PERFORMANCE_MAX")).toBe(false);
    expect(channelSupportsAdSchedule("DEMAND_GEN")).toBe(false);
    expect(channelSupportsAdSchedule("")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// validateDeviceModifiers (device bid adjustments)
// ---------------------------------------------------------------------------

describe("validateDeviceModifiers", () => {
  it("accepts an empty list (default bids)", () => {
    expect(validateDeviceModifiers([]).valid).toBe(true);
  });

  it("accepts typical adjustments", () => {
    const result = validateDeviceModifiers([
      { device: "MOBILE", percent: 20 },
      { device: "DESKTOP", percent: 0 },
      { device: "TABLET", percent: -50 },
    ]);
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("accepts boundary percents -90 and 900", () => {
    expect(validateDeviceModifiers([{ device: "MOBILE", percent: -90 }]).valid).toBe(true);
    expect(validateDeviceModifiers([{ device: "MOBILE", percent: 900 }]).valid).toBe(true);
  });

  it("accepts an exclusion (percent ignored)", () => {
    const result = validateDeviceModifiers([
      { device: "TABLET", percent: 9999, exclude: true },
      { device: "MOBILE", percent: 10 },
    ]);
    expect(result.valid).toBe(true);
  });

  it("rejects unknown devices", () => {
    const result = validateDeviceModifiers([{ device: "SMART_FRIDGE" as never, percent: 10 }]);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("device must be one of"))).toBe(true);
  });

  it("rejects duplicate devices", () => {
    const result = validateDeviceModifiers([
      { device: "MOBILE", percent: 10 },
      { device: "MOBILE", percent: 20 },
    ]);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("duplicate"))).toBe(true);
  });

  it("rejects out-of-range percents", () => {
    expect(validateDeviceModifiers([{ device: "MOBILE", percent: -91 }]).valid).toBe(false);
    expect(validateDeviceModifiers([{ device: "MOBILE", percent: 901 }]).valid).toBe(false);
    expect(validateDeviceModifiers([{ device: "MOBILE", percent: NaN }]).valid).toBe(false);
  });

  it("rejects excluding every device", () => {
    const result = validateDeviceModifiers([
      { device: "MOBILE", percent: 0, exclude: true },
      { device: "DESKTOP", percent: 0, exclude: true },
      { device: "TABLET", percent: 0, exclude: true },
    ]);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("At least one device"))).toBe(true);
  });
});

describe("channelSupportsDeviceModifiers", () => {
  it("allows SEARCH / DISPLAY / SHOPPING, rejects VIDEO / PMax / Demand Gen", () => {
    for (const ch of ["SEARCH", "DISPLAY", "SHOPPING"]) {
      expect(channelSupportsDeviceModifiers(ch)).toBe(true);
    }
    for (const ch of ["VIDEO", "PERFORMANCE_MAX", "DEMAND_GEN", ""]) {
      expect(channelSupportsDeviceModifiers(ch)).toBe(false);
    }
  });
});

describe("channelSupportsNegativeKeywords", () => {
  it("allows SEARCH / DISPLAY / SHOPPING / VIDEO", () => {
    for (const ch of ["SEARCH", "DISPLAY", "SHOPPING", "VIDEO"]) {
      expect(channelSupportsNegativeKeywords(ch)).toBe(true);
    }
  });

  it("rejects PERFORMANCE_MAX and unknown channels", () => {
    expect(channelSupportsNegativeKeywords("PERFORMANCE_MAX")).toBe(false);
    expect(channelSupportsNegativeKeywords("")).toBe(false);
  });
});
