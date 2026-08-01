import { describe, it, expect } from "vitest";
import { composeWeeklyDigestEmail, escapeHtml, type WeeklyDigestInput } from "./google-ads-weekly-email";

function baseInput(overrides: Partial<WeeklyDigestInput> = {}): WeeklyDigestInput {
  return {
    orgName: "Acme Noodles",
    locale: "en",
    balance: 250,
    campaigns: [
      { name: "Spring Sale", status: "ENABLED", spend: 120.5, clicks: 300, impressions: 10_000, conversions: 12 },
      { name: "Brand", status: "PAUSED", spend: 30, clicks: 80, impressions: 4_000, conversions: 3 },
    ],
    recommendations: [{ campaignName: "Spring Sale", priority: "HIGH", title: "Raise daily budget" }],
    baseUrl: "https://app.autoclaw.ai/",
    ...overrides,
  };
}

describe("escapeHtml", () => {
  it("escapes the five specials", () => {
    expect(escapeHtml(`<b>"A&B's"</b>`)).toBe("&lt;b&gt;&quot;A&amp;B&#39;s&quot;&lt;/b&gt;");
  });
});

describe("composeWeeklyDigestEmail", () => {
  it("totals spend/conversions into the subject", () => {
    const { subject } = composeWeeklyDigestEmail(baseInput());
    expect(subject).toContain("$150.50");
    expect(subject).toContain("15 conversions");
    expect(subject).toContain("Acme Noodles");
  });

  it("renders zh subject and labels when locale is zh", () => {
    const { subject, html } = composeWeeklyDigestEmail(baseInput({ locale: "zh" }));
    expect(subject).toContain("本周谷歌广告战报");
    expect(html).toContain("一键同意");
    expect(html).toContain("/zh/dashboard/google-ads");
  });

  it("sorts campaign rows by spend (highest first)", () => {
    const { html } = composeWeeklyDigestEmail(baseInput());
    expect(html.indexOf("Spring Sale")).toBeLessThan(html.indexOf("Brand"));
  });

  it("escapes HTML in names and recommendation titles", () => {
    const { html } = composeWeeklyDigestEmail(
      baseInput({
        campaigns: [{ name: "<script>alert(1)</script>", status: "ENABLED", spend: 5, clicks: 1, impressions: 10, conversions: 0 }],
        recommendations: [{ campaignName: "X", priority: "HIGH", title: `<img src=x onerror="pwn">` }],
      }),
    );
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<img src=x");
  });

  it("shows the no-spend message instead of the table when spend is zero", () => {
    const { html } = composeWeeklyDigestEmail(
      baseInput({
        campaigns: [{ name: "Idle", status: "PAUSED", spend: 0, clicks: 0, impressions: 0, conversions: 0 }],
        recommendations: [],
      }),
    );
    expect(html).toContain("No spend this week");
    expect(html).not.toContain("<th");
  });

  it("hides the balance KPI when balance is null and caps recommendations at 5", () => {
    const recs = Array.from({ length: 8 }, (_, i) => ({ campaignName: `C${i}`, priority: "MEDIUM", title: `T${i}` }));
    const { html } = composeWeeklyDigestEmail(baseInput({ balance: null, recommendations: recs }));
    expect(html).not.toContain("Ad credits remaining");
    expect(html).toContain("T4");
    expect(html).not.toContain("T5");
  });

  it("normalizes the dashboard URL (no double slash)", () => {
    const { html } = composeWeeklyDigestEmail(baseInput({ baseUrl: "https://app.autoclaw.ai/" }));
    expect(html).toContain("https://app.autoclaw.ai/en/dashboard/google-ads");
    expect(html).not.toContain("ai//en");
  });
});

describe("alerts box", () => {
  it("renders pre-phrased alert lines in a red box, capped at 6, escaped", () => {
    const { html } = composeWeeklyDigestEmail({
      orgName: "Test Org",
      locale: "zh",
      balance: 10,
      campaigns: [],
      recommendations: [],
      alertLines: ["警报一 <b>x</b>", "警报二", "3", "4", "5", "6", "7"],
      baseUrl: "https://x.test",
    });
    expect(html).toContain("本周警报");
    expect(html).toContain("警报一 &lt;b&gt;x&lt;/b&gt;");
    expect(html).not.toContain("<b>x</b>");
    expect((html.match(/<li style="margin:4px 0">/g) || []).length).toBe(6);
  });

  it("omits the box when there are no alerts", () => {
    const { html } = composeWeeklyDigestEmail({
      orgName: "Test Org", locale: "en", balance: null,
      campaigns: [], recommendations: [], baseUrl: "https://x.test",
    });
    expect(html).not.toContain("Alerts this week");
  });
});

