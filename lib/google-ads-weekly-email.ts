// Pure composition of the weekly Google Ads digest email. No I/O — the cron
// gathers data and sends; this module only turns numbers into subject + HTML,
// so the whole email can be unit-tested. Bilingual (en/zh) via a simple
// label table — the digest goes to org owners, most of whom are Chinese SMBs,
// but the platform default stays English.

export type DigestLocale = "en" | "zh";

export interface WeeklyCampaignRow {
  name: string;
  status: string;
  /** last-7-days figures (USD for spend) */
  spend: number;
  clicks: number;
  impressions: number;
  conversions: number;
}

export interface WeeklyRecommendationRow {
  campaignName: string;
  priority: string;
  title: string;
}

export interface WeeklyDigestInput {
  orgName: string;
  locale?: DigestLocale;
  /** remaining ad-credits balance in USD (null = unknown / hide) */
  balance: number | null;
  campaigns: WeeklyCampaignRow[];
  /** top stored AI recommendations (no LLM calls at send time) */
  recommendations: WeeklyRecommendationRow[];
  /** absolute base URL of the app, e.g. https://app.autoclaw.ai */
  baseUrl: string;
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function usd(n: number): string {
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

const LABELS = {
  en: {
    subject: (org: string, spend: string, conv: number) =>
      `Your Google Ads week: ${spend} spent, ${conv} conversions — ${org}`,
    heading: "Your Google Ads — last 7 days",
    totalSpend: "Spend",
    clicks: "Clicks",
    impressions: "Impressions",
    conversions: "Conversions",
    balance: "Ad credits remaining",
    campaigns: "Campaigns",
    campaign: "Campaign",
    status: "Status",
    noSpend: "No spend this week — your campaigns are paused or just warming up.",
    recs: "AI recommendations waiting for your approval",
    recsHint: "Open the campaign and tap “Approve & Apply” — AutoClaw does the rest.",
    cta: "Open dashboard",
    footer: "You receive this weekly summary because you own this AutoClaw organization.",
  },
  zh: {
    subject: (org: string, spend: string, conv: number) =>
      `本周谷歌广告战报：花费 ${spend}，转化 ${conv} 个 — ${org}`,
    heading: "谷歌广告 — 最近 7 天",
    totalSpend: "花费",
    clicks: "点击",
    impressions: "曝光",
    conversions: "转化",
    balance: "广告资金余额",
    campaigns: "广告系列",
    campaign: "广告系列",
    status: "状态",
    noSpend: "本周没有花费——广告系列处于暂停或刚起步。",
    recs: "AI 建议正在等你一键同意",
    recsHint: "打开广告系列，点“同意并应用”，剩下的 AutoClaw 帮你搞定。",
    cta: "打开控制台",
    footer: "你收到这封周报是因为你是该 AutoClaw 组织的所有者。",
  },
} as const;

export interface ComposedDigest {
  subject: string;
  html: string;
}

/** Build subject + HTML for one org's weekly digest. Pure. */
export function composeWeeklyDigestEmail(input: WeeklyDigestInput): ComposedDigest {
  const L = LABELS[input.locale === "zh" ? "zh" : "en"];
  const totals = input.campaigns.reduce(
    (acc, c) => ({
      spend: acc.spend + c.spend,
      clicks: acc.clicks + c.clicks,
      impressions: acc.impressions + c.impressions,
      conversions: acc.conversions + c.conversions,
    }),
    { spend: 0, clicks: 0, impressions: 0, conversions: 0 },
  );

  const subject = L.subject(input.orgName, usd(totals.spend), Math.round(totals.conversions));

  const kpi = (label: string, value: string) => `
    <td style="padding:10px 14px;border:1px solid #eee;border-radius:8px">
      <div style="font-size:11px;color:#888">${escapeHtml(label)}</div>
      <div style="font-size:20px;font-weight:700;color:#111">${escapeHtml(value)}</div>
    </td>`;

  const campaignRows = input.campaigns
    .slice()
    .sort((a, b) => b.spend - a.spend)
    .map(
      (c) => `
      <tr>
        <td style="padding:6px 8px;border-bottom:1px solid #f3f3f3">${escapeHtml(c.name)}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #f3f3f3;color:#888">${escapeHtml(c.status)}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #f3f3f3;text-align:right">${escapeHtml(usd(c.spend))}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #f3f3f3;text-align:right">${c.clicks.toLocaleString()}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #f3f3f3;text-align:right">${Math.round(c.conversions)}</td>
      </tr>`,
    )
    .join("");

  const recItems = input.recommendations
    .slice(0, 5)
    .map(
      (r) => `
      <li style="margin:4px 0">
        <span style="display:inline-block;padding:1px 8px;border-radius:99px;font-size:11px;background:${r.priority === "HIGH" ? "#fee2e2" : "#fef3c7"};color:${r.priority === "HIGH" ? "#991b1b" : "#92400e"}">${escapeHtml(r.priority)}</span>
        <strong>${escapeHtml(r.campaignName)}</strong>: ${escapeHtml(r.title)}
      </li>`,
    )
    .join("");

  const dashboardUrl = `${input.baseUrl.replace(/\/$/, "")}/${input.locale === "zh" ? "zh" : "en"}/dashboard/google-ads`;

  const html = `
<div style="font-family:-apple-system,'Segoe UI',Roboto,'PingFang SC','Microsoft YaHei',sans-serif;max-width:640px;margin:0 auto;color:#111">
  <div style="border-bottom:3px solid #991b1b;padding:16px 0 10px">
    <div style="font-size:18px;font-weight:700">🦞 AutoClaw · ${escapeHtml(L.heading)}</div>
    <div style="font-size:12px;color:#888">${escapeHtml(input.orgName)}</div>
  </div>

  <table style="width:100%;border-collapse:separate;border-spacing:6px;margin:14px 0"><tr>
    ${kpi(L.totalSpend, usd(totals.spend))}
    ${kpi(L.clicks, totals.clicks.toLocaleString())}
    ${kpi(L.impressions, totals.impressions.toLocaleString())}
    ${kpi(L.conversions, String(Math.round(totals.conversions)))}
    ${input.balance !== null ? kpi(L.balance, usd(input.balance)) : ""}
  </tr></table>

  ${
    totals.spend === 0
      ? `<p style="font-size:13px;color:#666">${escapeHtml(L.noSpend)}</p>`
      : `
  <div style="font-size:13px;font-weight:600;margin:10px 0 4px">${escapeHtml(L.campaigns)}</div>
  <table style="width:100%;border-collapse:collapse;font-size:12px">
    <tr style="color:#888;text-align:left">
      <th style="padding:6px 8px">${escapeHtml(L.campaign)}</th>
      <th style="padding:6px 8px">${escapeHtml(L.status)}</th>
      <th style="padding:6px 8px;text-align:right">${escapeHtml(L.totalSpend)}</th>
      <th style="padding:6px 8px;text-align:right">${escapeHtml(L.clicks)}</th>
      <th style="padding:6px 8px;text-align:right">${escapeHtml(L.conversions)}</th>
    </tr>
    ${campaignRows}
  </table>`
  }

  ${
    recItems
      ? `
  <div style="margin-top:18px;padding:12px;border:1px solid #e9d5ff;background:#faf5ff;border-radius:10px">
    <div style="font-size:13px;font-weight:600">✨ ${escapeHtml(L.recs)}</div>
    <ul style="padding-left:16px;font-size:12px;margin:8px 0">${recItems}</ul>
    <div style="font-size:11px;color:#888">${escapeHtml(L.recsHint)}</div>
  </div>`
      : ""
  }

  <div style="margin:20px 0">
    <a href="${escapeHtml(dashboardUrl)}" style="background:#991b1b;color:#fff;padding:10px 18px;border-radius:8px;font-size:13px;text-decoration:none">${escapeHtml(L.cta)} →</a>
  </div>

  <div style="font-size:11px;color:#aaa;border-top:1px solid #eee;padding-top:10px">${escapeHtml(L.footer)}</div>
</div>`.trim();

  return { subject, html };
}
