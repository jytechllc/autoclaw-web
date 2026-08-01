import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { orderOrgsForCron } from "@/lib/google-ads-sync";
import {
  fetchDailyMetrics,
  analyzeCampaign,
  analyzeAccountConversions,
  alertLine,
  type CampaignAlert,
  type DailyMetricRow,
} from "@/lib/google-ads-monitor";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const CRON_SECRET = process.env.CRON_SECRET;
const TIME_BUDGET_MS = (maxDuration - 30) * 1000;

/** Suppress a repeat of the same (campaign, kind) alert for this long. */
const DEDUPE_HOURS = 48;

// Per-alert phrasing lives in lib/google-ads-monitor (alertLine) — shared
// with the weekly digest. Only the email chrome stays here.
const MAIL_STRINGS: Record<string, { subject: string; intro: string; cta: string }> = {
  en: {
    subject: "AutoClaw alert: something needs your attention in Google Ads",
    intro: "We watch your campaigns every day. Yesterday these needed a look:",
    cta: "Open AutoClaw",
  },
  zh: {
    subject: "AutoClaw 提醒:你的谷歌广告需要看一眼",
    intro: "我们每天帮你盯着广告。昨天这些情况需要你注意:",
    cta: "打开 AutoClaw",
  },
};

/**
 * Twice daily: pull yesterday-vs-trailing-week metrics for every open
 * campaign, run the anomaly rules, store new alerts (48h dedupe per
 * campaign+kind), and email each org's owner a plain-language summary.
 * Same transport (Brevo), auth, and time-budget patterns as the weekly digest.
 */
export async function GET(req: NextRequest) {
  const startedAt = Date.now();
  const authHeader = req.headers.get("authorization");
  if (CRON_SECRET && authHeader !== `Bearer ${CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sql = getDb();

  // Self-heal on fresh deployments — mirrors lib/schema.sql, keep in sync.
  await sql`
    CREATE TABLE IF NOT EXISTS google_ads_alerts (
      id SERIAL PRIMARY KEY,
      org_id INTEGER NOT NULL,
      campaign_id INTEGER NOT NULL,
      kind TEXT NOT NULL,
      severity TEXT NOT NULL,
      numbers JSONB NOT NULL DEFAULT '{}',
      notified BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS idx_google_ads_alerts_org ON google_ads_alerts(org_id, created_at DESC)`;
  await sql`ALTER TABLE organizations ADD COLUMN IF NOT EXISTS ads_alert_emails BOOLEAN DEFAULT TRUE`;

  const locale = (process.env.GOOGLE_ADS_DIGEST_LOCALE || "en").startsWith("zh") ? "zh" : "en";
  const S = MAIL_STRINGS[locale];

  // Brevo key: env first, org 5 stored key as fallback (mirrors weekly digest).
  let brevoKey = process.env.BREVO_API_KEY || "";
  if (!brevoKey) {
    try {
      const { decrypt } = await import("@/lib/crypto");
      const [k] = await sql`SELECT api_key FROM org_api_keys WHERE org_id=5 AND service='brevo' LIMIT 1`;
      if (k) brevoKey = decrypt(k.api_key as string);
    } catch {
      /* fall through — alerts still get stored, just not emailed */
    }
  }
  const baseUrl = process.env.AUTOCLAW_BASE_URL || process.env.AUTH0_BASE_URL || "https://autoclaw.ai";
  const senderEmail = process.env.DIGEST_SENDER_EMAIL || "leo.liu@jytech.us";

  // Open campaigns + owner emails in one pass.
  const rows = await sql`
    SELECT c.id, c.org_id, c.platform_campaign_id, c.campaign_name, c.status,
           o.name AS org_name, u.email AS owner_email,
           COALESCE(o.ads_alert_emails, TRUE) AS alert_emails_on
    FROM campaigns c
    JOIN organizations o ON o.id = c.org_id
    JOIN users u ON u.id = o.created_by
    WHERE c.platform = 'google' AND c.closed = false
  `;
  if (rows.length === 0) {
    return NextResponse.json({ success: true, alerts: 0, note: "no open campaigns" });
  }

  // Recent alerts → dedupe set "campaignId:kind".
  const recent = await sql`
    SELECT campaign_id, kind FROM google_ads_alerts
    WHERE created_at > NOW() - INTERVAL '1 hour' * ${DEDUPE_HOURS}
  `;
  const seen = new Set(recent.map((r) => `${r.campaign_id}:${r.kind}`));

  // One GAQL round-trip for all campaigns, then pure analysis per campaign.
  const daily = await fetchDailyMetrics(rows.map((r) => String(r.platform_campaign_id)));

  type OrgBucket = { orgName: string; email: string; emailsOn: boolean; lines: string[] };
  const byOrg = new Map<number, OrgBucket>();
  let stored = 0;

  const orgOrder = orderOrgsForCron([...new Set(rows.map((r) => Number(r.org_id)))], Math.floor(Date.now() / 3_600_000));
  const orgAllowed = new Set<number>();
  for (const orgId of orgOrder) {
    if (Date.now() - startedAt > TIME_BUDGET_MS) break;
    orgAllowed.add(orgId);
  }

  for (const r of rows) {
    const orgId = Number(r.org_id);
    if (!orgAllowed.has(orgId)) continue;
    const series = daily.get(String(r.platform_campaign_id)) ?? [];
    const alerts: CampaignAlert[] = analyzeCampaign(
      String(r.platform_campaign_id),
      String(r.status || ""),
      series,
    );
    for (const a of alerts) {
      const key = `${r.id}:${a.kind}`;
      if (seen.has(key)) continue;
      seen.add(key);
      await sql`
        INSERT INTO google_ads_alerts (org_id, campaign_id, kind, severity, numbers, notified)
        VALUES (${orgId}, ${Number(r.id)}, ${a.kind}, ${a.severity}, ${JSON.stringify(a.numbers)}, ${Boolean(brevoKey)})
      `;
      stored += 1;
      const bucket = byOrg.get(orgId) ?? { orgName: String(r.org_name || ""), email: String(r.owner_email || ""), emailsOn: Boolean(r.alert_emails_on), lines: [] };
      bucket.lines.push(alertLine(a.kind, String(r.campaign_name || r.platform_campaign_id), a.numbers, locale as "en" | "zh"));
      byOrg.set(orgId, bucket);
    }
  }

  // Account-level: tag-never-worked check per org (campaign_id 0 = account).
  const seriesByOrg = new Map<number, DailyMetricRow[][]>();
  for (const r of rows) {
    const orgId = Number(r.org_id);
    if (!orgAllowed.has(orgId)) continue;
    const list = seriesByOrg.get(orgId) ?? [];
    list.push(daily.get(String(r.platform_campaign_id)) ?? []);
    seriesByOrg.set(orgId, list);
  }
  for (const [orgId, allSeries] of seriesByOrg) {
    const acct = analyzeAccountConversions(allSeries);
    if (!acct) continue;
    const key = `org${orgId}:0:${acct.kind}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const sample = rows.find((r) => Number(r.org_id) === orgId)!;
    await sql`
      INSERT INTO google_ads_alerts (org_id, campaign_id, kind, severity, numbers, notified)
      VALUES (${orgId}, 0, ${acct.kind}, ${acct.severity}, ${JSON.stringify(acct.numbers)}, ${Boolean(brevoKey)})
    `;
    stored += 1;
    const bucket = byOrg.get(orgId) ?? { orgName: String(sample.org_name || ""), email: String(sample.owner_email || ""), emailsOn: Boolean(sample.alert_emails_on), lines: [] };
    bucket.lines.push(alertLine(acct.kind, "", acct.numbers, locale as "en" | "zh"));
    byOrg.set(orgId, bucket);
  }

  // Email each org that has fresh alerts.
  let sent = 0;
  const errors: Array<{ orgId: number; error: string }> = [];
  if (brevoKey) {
    for (const [orgId, bucket] of byOrg) {
      if (!bucket.email || bucket.lines.length === 0 || !bucket.emailsOn) continue;
      try {
        const html = `<p>${S.intro}</p><ul>${bucket.lines.map((l) => `<li>${l}</li>`).join("")}</ul><p><a href="${baseUrl}/${locale}/dashboard/google-ads">${S.cta}</a></p>`;
        const res = await fetch("https://api.brevo.com/v3/smtp/email", {
          method: "POST",
          headers: { "api-key": brevoKey, "Content-Type": "application/json" },
          body: JSON.stringify({
            sender: { email: senderEmail, name: "AutoClaw Alerts" },
            to: [{ email: bucket.email }],
            subject: S.subject,
            htmlContent: html,
          }),
        });
        if (!res.ok) throw new Error(`Brevo ${res.status}: ${(await res.text().catch(() => "")).slice(0, 200)}`);
        sent += 1;
      } catch (e) {
        errors.push({ orgId, error: e instanceof Error ? e.message : String(e) });
      }
    }
  }

  return NextResponse.json({
    success: true,
    campaignsChecked: rows.length,
    alertsStored: stored,
    emailsSent: sent,
    errors: errors.length > 0 ? errors : undefined,
    elapsedMs: Date.now() - startedAt,
    timestamp: new Date().toISOString(),
  });
}
