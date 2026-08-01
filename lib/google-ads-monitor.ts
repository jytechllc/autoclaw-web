// Campaign anomaly detection (competitive gap #2 — "the tool that watches
// your account"). Pure detection over per-day metric rows so every rule is
// unit-testable; fetching lives in one thin GAQL helper.
//
// Three rules, tuned for small-budget owners (thresholds exported so the
// cron/tests can reason about them):
//   SPEND_SPIKE        — yesterday cost ≥ SPIKE_MULTIPLIER × trailing avg
//                        (and above an absolute floor, so a $0.30 day
//                        following $0.10 days doesn't page anyone).
//   ZERO_IMPRESSIONS   — an ENABLED campaign that served fine all week
//                        suddenly served nothing yesterday: usually policy
//                        disapproval, billing failure, or bid collapse.
//   CONVERSIONS_DROPPED— clicks kept flowing but conversions went to zero:
//                        usually a broken conversion tag, not a market shift.

import { adsSearchStream } from "@/lib/google-ads";

export const SPIKE_MULTIPLIER = 2.5;
export const SPIKE_MIN_USD = 5;
export const ZERO_IMPR_MIN_TRAILING_AVG = 50;
export const CONV_DROP_MIN_TRAILING = 5;
export const CONV_DROP_MIN_CLICKS = 20;
/** Account-level: this many clicks across all campaigns with zero conversions
 *  ever recorded → the conversion tag probably was never installed right.
 *  (The per-campaign CONVERSIONS_DROPPED rule can't catch this: it requires
 *  trailing conversions, which a never-working tag never produces.) */
export const ACCOUNT_CONV_MIN_CLICKS = 100;

export interface DailyMetricRow {
  /** YYYY-MM-DD */
  date: string;
  costMicros: number;
  impressions: number;
  clicks: number;
  conversions: number;
}

export type AlertKind =
  | "SPEND_SPIKE"
  | "ZERO_IMPRESSIONS"
  | "CONVERSIONS_DROPPED"
  | "CONVERSION_TRACKING_SILENT";

export interface CampaignAlert {
  kind: AlertKind;
  severity: "HIGH" | "MEDIUM";
  campaignResource: string;
  /** Raw numbers for the email/UI layer to phrase in the user's language. */
  numbers: Record<string, number>;
}

function usd(micros: number): number {
  return Math.round((micros / 1_000_000) * 100) / 100;
}

/** One plain-language line per alert — shared by the monitor emails, the
 *  weekly digest, and anywhere else alerts get phrased server-side. Pure. */
export function alertLine(
  kind: AlertKind,
  campaignName: string,
  n: Record<string, number>,
  locale: "en" | "zh",
): string {
  const c = campaignName;
  if (locale === "zh") {
    switch (kind) {
      case "SPEND_SPIKE": return `⚠️ 「${c}」昨天花了 $${n.yesterdayUsd},是平时($${n.trailingAvgUsd}/天)的 ${n.multiple} 倍。`;
      case "ZERO_IMPRESSIONS": return `🚨 「${c}」昨天 0 曝光(平时约 ${n.trailingAvgImpressions}/天)。请检查广告审核状态和付款方式。`;
      case "CONVERSIONS_DROPPED": return `⚠️ 「${c}」昨天有 ${n.yesterdayClicks} 次点击但 0 转化(过去一周有 ${n.trailingConversions} 个)。转化跟踪代码可能坏了。`;
      case "CONVERSION_TRACKING_SILENT": return `🚨 本周有 ${n.clicks} 次点击但一个转化都没记录到——转化跟踪代码很可能没装好。`;
    }
  }
  switch (kind) {
    case "SPEND_SPIKE": return `⚠️ "${c}" spent $${n.yesterdayUsd} yesterday — ${n.multiple}× its usual $${n.trailingAvgUsd}/day.`;
    case "ZERO_IMPRESSIONS": return `🚨 "${c}" served 0 impressions yesterday (usually ~${n.trailingAvgImpressions}/day). Check ad approval and billing.`;
    case "CONVERSIONS_DROPPED": return `⚠️ "${c}" got ${n.yesterdayClicks} clicks yesterday but 0 conversions (past week: ${n.trailingConversions}). Your conversion tag may be broken.`;
    case "CONVERSION_TRACKING_SILENT": return `🚨 ${n.clicks} clicks this week but not a single conversion recorded — your conversion tracking tag is probably not installed correctly.`;
  }
}

/** Analyze one campaign's daily rows (ascending by date; last row = the day
 *  under inspection — callers pass "up to yesterday"). Pure. */
export function analyzeCampaign(
  campaignResource: string,
  status: string,
  daily: DailyMetricRow[],
): CampaignAlert[] {
  if (daily.length < 4) return []; // not enough history to call anything anomalous
  const yesterday = daily[daily.length - 1];
  const trailing = daily.slice(0, -1);
  const avg = (pick: (r: DailyMetricRow) => number) =>
    trailing.reduce((a, r) => a + pick(r), 0) / trailing.length;

  const alerts: CampaignAlert[] = [];

  const avgCost = avg((r) => r.costMicros);
  const yCost = yesterday.costMicros;
  if (yCost >= avgCost * SPIKE_MULTIPLIER && usd(yCost) >= SPIKE_MIN_USD && avgCost > 0) {
    alerts.push({
      kind: "SPEND_SPIKE",
      severity: "HIGH",
      campaignResource,
      numbers: { yesterdayUsd: usd(yCost), trailingAvgUsd: usd(avgCost), multiple: Math.round((yCost / avgCost) * 10) / 10 },
    });
  }

  const avgImpr = avg((r) => r.impressions);
  if (status === "ENABLED" && yesterday.impressions === 0 && avgImpr >= ZERO_IMPR_MIN_TRAILING_AVG) {
    alerts.push({
      kind: "ZERO_IMPRESSIONS",
      severity: "HIGH",
      campaignResource,
      numbers: { trailingAvgImpressions: Math.round(avgImpr) },
    });
  }

  const trailingConv = trailing.reduce((a, r) => a + r.conversions, 0);
  if (trailingConv >= CONV_DROP_MIN_TRAILING && yesterday.conversions === 0 && yesterday.clicks >= CONV_DROP_MIN_CLICKS) {
    alerts.push({
      kind: "CONVERSIONS_DROPPED",
      severity: "MEDIUM",
      campaignResource,
      numbers: { trailingConversions: trailingConv, yesterdayClicks: yesterday.clicks },
    });
  }

  return alerts;
}

/** Account-level health: plenty of clicks across the org's campaigns but not
 *  a single conversion in the whole window → the tag likely never worked.
 *  Returns one org-scoped alert (campaignResource "" = account). Pure. */
export function analyzeAccountConversions(allSeries: DailyMetricRow[][]): CampaignAlert | null {
  let clicks = 0;
  let conversions = 0;
  for (const series of allSeries) {
    for (const r of series) {
      clicks += r.clicks;
      conversions += r.conversions;
    }
  }
  if (clicks >= ACCOUNT_CONV_MIN_CLICKS && conversions === 0) {
    return {
      kind: "CONVERSION_TRACKING_SILENT",
      severity: "MEDIUM",
      campaignResource: "",
      numbers: { clicks },
    };
  }
  return null;
}

/** Per-campaign per-day metrics for the last N days (excluding today, whose
 *  numbers are still moving). One GAQL round-trip for all campaigns. */
export async function fetchDailyMetrics(
  resourceNames: string[],
  days = 8,
): Promise<Map<string, DailyMetricRow[]>> {
  const customerId = process.env.GOOGLE_ADS_CUSTOMER_ID;
  if (!customerId) throw new Error("GOOGLE_ADS_CUSTOMER_ID not configured");
  if (resourceNames.length === 0) return new Map();

  const filter = resourceNames.map((r) => `'${r.replace(/'/g, "''")}'`).join(",");
  const query = `
    SELECT campaign.resource_name, segments.date, metrics.cost_micros,
           metrics.impressions, metrics.clicks, metrics.conversions
    FROM campaign
    WHERE segments.date BETWEEN '${isoDaysAgo(days)}' AND '${isoDaysAgo(1)}'
      AND campaign.resource_name IN (${filter})
  `.trim();

  type Row = {
    campaign: { resourceName: string };
    segments: { date: string };
    metrics: { costMicros?: string; impressions?: string; clicks?: string; conversions?: number };
  };
  const rows = (await adsSearchStream(customerId, query)) as Row[];

  const byCampaign = new Map<string, DailyMetricRow[]>();
  for (const r of rows) {
    const list = byCampaign.get(r.campaign.resourceName) ?? [];
    list.push({
      date: r.segments.date,
      costMicros: Number(r.metrics.costMicros) || 0,
      impressions: Number(r.metrics.impressions) || 0,
      clicks: Number(r.metrics.clicks) || 0,
      conversions: Number(r.metrics.conversions) || 0,
    });
    byCampaign.set(r.campaign.resourceName, list);
  }
  for (const list of byCampaign.values()) list.sort((a, b) => a.date.localeCompare(b.date));
  return byCampaign;
}

/** YYYY-MM-DD for N days before today (UTC). Exported for tests. */
export function isoDaysAgo(n: number): string {
  const d = new Date(Date.now() - n * 86_400_000);
  return d.toISOString().slice(0, 10);
}
