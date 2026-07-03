import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { fetchCampaignSpend } from "@/lib/google-ads";
import { orderOrgsForCron } from "@/lib/google-ads-sync";
import {
  composeWeeklyDigestEmail,
  type DigestLocale,
  type WeeklyCampaignRow,
  type WeeklyRecommendationRow,
} from "@/lib/google-ads-weekly-email";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const CRON_SECRET = process.env.CRON_SECRET;
const TIME_BUDGET_MS = (maxDuration - 30) * 1000;

// Email language for the digest (platform-wide until orgs carry a locale).
const DIGEST_LOCALE: DigestLocale = process.env.GOOGLE_ADS_DIGEST_LOCALE === "zh" ? "zh" : "en";

/**
 * Weekly (Mon 06:00 UTC): email each org owner a 7-day Google Ads summary —
 * spend, clicks, conversions, remaining credits, and the stored AI
 * recommendations awaiting one-click approval. Zero LLM calls at send time
 * (recommendations come from the nightly digest table). Sends via Brevo,
 * same transport as the outreach dispatcher.
 */
export async function GET(req: NextRequest) {
  const startedAt = Date.now();
  const authHeader = req.headers.get("authorization");
  if (CRON_SECRET && authHeader !== `Bearer ${CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Brevo key: env first, org 5 (JY Tech LLC) stored key as fallback —
  // mirrors app/api/cron/dispatch-followups.
  const sql = getDb();
  let brevoKey = process.env.BREVO_API_KEY || "";
  if (!brevoKey) {
    try {
      const { decrypt } = await import("@/lib/crypto");
      const [k] = await sql`SELECT api_key FROM org_api_keys WHERE org_id=5 AND service='brevo' LIMIT 1`;
      if (k) brevoKey = decrypt(k.api_key as string);
    } catch {
      /* fall through */
    }
  }
  if (!brevoKey) {
    return NextResponse.json({ success: false, error: "No Brevo key configured — digest skipped" }, { status: 200 });
  }

  const baseUrl = process.env.AUTOCLAW_BASE_URL || process.env.AUTH0_BASE_URL || "https://autoclaw.ai";
  const senderEmail = process.env.DIGEST_SENDER_EMAIL || "leo.liu@jytech.us";
  const senderName = "AutoClaw Reports";

  // Self-heal the opt-out column (mirrors lib/schema.sql — keep in sync).
  await sql`ALTER TABLE organizations ADD COLUMN IF NOT EXISTS weekly_ads_digest BOOLEAN DEFAULT TRUE`;

  // Orgs with google campaigns + their owner's email — opted-out orgs excluded.
  const orgRows = await sql`
    SELECT DISTINCT o.id AS org_id, o.name AS org_name, u.email AS owner_email
    FROM campaigns c
    JOIN organizations o ON o.id = c.org_id
    JOIN users u ON u.id = o.created_by
    WHERE c.platform = 'google' AND c.closed = false
      AND COALESCE(o.weekly_ads_digest, TRUE) = TRUE
  `;
  const byOrg = new Map<number, { name: string; email: string }>();
  for (const r of orgRows) {
    if (r.owner_email) byOrg.set(Number(r.org_id), { name: String(r.org_name || ""), email: String(r.owner_email) });
  }
  const weekSeed = Math.floor(Date.now() / (7 * 86_400_000));
  const orgIds = orderOrgsForCron([...byOrg.keys()], weekSeed);

  let sent = 0;
  const errors: Array<{ orgId: number; error: string }> = [];
  const skippedOrgIds: number[] = [];

  for (const orgId of orgIds) {
    if (Date.now() - startedAt > TIME_BUDGET_MS) {
      skippedOrgIds.push(orgId);
      continue;
    }
    const org = byOrg.get(orgId);
    if (!org) continue;

    try {
      // Campaigns + stored AI recommendations in one pass.
      const campaigns = await sql`
        SELECT c.id, c.platform_campaign_id, c.campaign_name, c.status,
               cr.recommendations AS recs
        FROM campaigns c
        LEFT JOIN campaign_recommendations cr ON cr.campaign_id = c.id
        WHERE c.org_id = ${orgId} AND c.platform = 'google' AND c.closed = false
      `;
      if (campaigns.length === 0) continue;

      // One GAQL call for the whole org's 7-day metrics.
      const resourceNames = campaigns.map((c) => String(c.platform_campaign_id));
      const spend = await fetchCampaignSpend(resourceNames, "LAST_7_DAYS");
      const spendByResource = new Map(spend.map((s) => [s.resourceName, s]));

      const rows: WeeklyCampaignRow[] = campaigns.map((c) => {
        const s = spendByResource.get(String(c.platform_campaign_id));
        return {
          name: String(c.campaign_name || ""),
          status: String(c.status || ""),
          spend: (s?.costMicros || 0) / 1_000_000,
          clicks: s?.clicks || 0,
          impressions: s?.impressions || 0,
          conversions: s?.conversions || 0,
        };
      });

      const recommendations: WeeklyRecommendationRow[] = [];
      for (const c of campaigns) {
        const recs = c.recs as Array<{ priority?: string; title?: string; autoAction?: unknown }> | null;
        if (!Array.isArray(recs)) continue;
        for (const r of recs) {
          // Lead with actionable (one-click) items, HIGH priority first — the
          // sort below relies on priority; autoAction presence breaks ties.
          recommendations.push({
            campaignName: String(c.campaign_name || ""),
            priority: String(r.priority || "MEDIUM"),
            title: String(r.title || ""),
          });
        }
      }
      recommendations.sort((a, b) => (a.priority === "HIGH" ? 0 : 1) - (b.priority === "HIGH" ? 0 : 1));

      const balanceRows = await sql`SELECT balance_cents FROM ad_credits WHERE org_id = ${orgId}`;
      const balance = balanceRows.length > 0 ? Number(balanceRows[0].balance_cents || 0) / 100 : null;

      const { subject, html } = composeWeeklyDigestEmail({
        orgName: org.name,
        locale: DIGEST_LOCALE,
        balance,
        campaigns: rows,
        recommendations,
        baseUrl,
      });

      const res = await fetch("https://api.brevo.com/v3/smtp/email", {
        method: "POST",
        headers: { "api-key": brevoKey, "Content-Type": "application/json" },
        body: JSON.stringify({
          sender: { email: senderEmail, name: senderName },
          to: [{ email: org.email }],
          subject,
          htmlContent: html,
        }),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(`Brevo ${res.status}: ${body.slice(0, 200)}`);
      }
      sent += 1;
    } catch (e) {
      errors.push({ orgId, error: e instanceof Error ? e.message : String(e) });
    }
  }

  if (skippedOrgIds.length > 0) {
    console.warn(`[google-ads-weekly-email] time budget hit: skipped ${skippedOrgIds.length}/${orgIds.length} orgs`);
  }

  return NextResponse.json({
    success: true,
    sent,
    orgsSkipped: skippedOrgIds.length,
    errors: errors.length > 0 ? errors : undefined,
    elapsedMs: Date.now() - startedAt,
    timestamp: new Date().toISOString(),
  });
}
