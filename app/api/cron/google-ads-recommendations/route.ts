import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { orderOrgsForCron } from "@/lib/google-ads-sync";
import {
  generateCampaignRecommendations,
  persistDigest,
  type CampaignRecRow,
} from "@/app/api/google-ads/campaigns/[id]/recommendations/generate";
import {
  selectCampaignsForDigest,
  type DigestCandidate,
} from "@/app/api/google-ads/campaigns/[id]/recommendations/digest";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const CRON_SECRET = process.env.CRON_SECRET;

// Stop starting new orgs once this much of maxDuration has elapsed, leaving
// headroom for the in-flight LLM call + response serialization (audit D-10).
const TIME_BUDGET_MS = (maxDuration - 45) * 1000;

// Cost bounds: LLM calls per org and per whole run.
const MAX_CAMPAIGNS_PER_ORG = 3;
const MAX_LLM_CALLS_PER_RUN = 25;
// Digests younger than this are fresh — skip (daily cron with drift headroom).
const MAX_DIGEST_AGE_HOURS = 20;

/**
 * Daily: for each org, refresh the AI recommendation digest of its highest-
 * spend ENABLED campaigns. The owner opens the campaign and sees analysis
 * that is already waiting, with one-click apply — the "AI keeps watching,
 * you just approve" half of the product directive.
 *
 * Idempotent + self-healing: creates its own table if missing (the repo has
 * no migration runner; cron-owned CREATE TABLE IF NOT EXISTS is the
 * established pattern — runs a handful of times per day, not per request).
 */
export async function GET(req: NextRequest) {
  const startedAt = Date.now();
  const authHeader = req.headers.get("authorization");
  if (CRON_SECRET && authHeader !== `Bearer ${CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sql = getDb();

  // Self-heal schema (mirrors lib/schema.sql — keep in sync).
  await sql`
    CREATE TABLE IF NOT EXISTS campaign_recommendations (
      id SERIAL PRIMARY KEY,
      campaign_id INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
      org_id INTEGER NOT NULL,
      source VARCHAR(10) NOT NULL DEFAULT 'cron',
      recommendations JSONB NOT NULL,
      provider VARCHAR(40),
      model VARCHAR(80),
      generated_at TIMESTAMP DEFAULT NOW(),
      UNIQUE(campaign_id)
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS idx_campaign_recommendations_org ON campaign_recommendations(org_id)`;

  const orgs = await sql`
    SELECT DISTINCT org_id FROM campaigns WHERE platform = 'google' AND closed = false
  `;
  const daySeed = Math.floor(Date.now() / 86_400_000);
  const orgIds = orderOrgsForCron(orgs.map((r) => r.org_id as number), daySeed);

  const now = new Date();
  let generatedCount = 0;
  let skippedFresh = 0;
  let llmCalls = 0;
  const errors: Array<{ campaignId: number; error: string }> = [];
  const skippedOrgIds: number[] = [];

  for (const orgId of orgIds) {
    if (Date.now() - startedAt > TIME_BUDGET_MS || llmCalls >= MAX_LLM_CALLS_PER_RUN) {
      skippedOrgIds.push(orgId);
      continue;
    }

    // Campaigns + their current digest age in one query.
    const rows = await sql`
      SELECT c.id, c.platform_campaign_id, c.campaign_name, c.channel, c.daily_budget,
             c.currency, c.status, c.total_budget_cents, c.spent_cents, c.closed,
             cr.generated_at AS digest_generated_at
      FROM campaigns c
      LEFT JOIN campaign_recommendations cr ON cr.campaign_id = c.id
      WHERE c.org_id = ${orgId} AND c.platform = 'google' AND c.closed = false
    `;

    const candidates: DigestCandidate[] = rows.map((r) => ({
      id: Number(r.id),
      status: (r.status as string) || null,
      closed: Boolean(r.closed),
      spentCents: Number(r.spent_cents || 0),
      generatedAt: (r.digest_generated_at as Date | null) ?? null,
    }));
    const pickedIds = selectCampaignsForDigest(candidates, now, {
      maxPerOrg: MAX_CAMPAIGNS_PER_ORG,
      maxAgeHours: MAX_DIGEST_AGE_HOURS,
    });
    skippedFresh += candidates.filter(
      (c) => !c.closed && String(c.status || "").toUpperCase() === "ENABLED",
    ).length - pickedIds.length;

    for (const campaignId of pickedIds) {
      if (Date.now() - startedAt > TIME_BUDGET_MS || llmCalls >= MAX_LLM_CALLS_PER_RUN) break;
      const row = rows.find((r) => Number(r.id) === campaignId);
      if (!row) continue;
      llmCalls += 1;
      try {
        const generated = await generateCampaignRecommendations(row as unknown as CampaignRecRow, "en");
        await persistDigest(sql, campaignId, orgId, "cron", generated.recommendations, generated.provider, generated.model);
        generatedCount += 1;
      } catch (e) {
        errors.push({ campaignId, error: e instanceof Error ? e.message : String(e) });
      }
    }
  }

  if (skippedOrgIds.length > 0) {
    console.warn(
      `[google-ads-recommendations] budget hit: skipped ${skippedOrgIds.length}/${orgIds.length} orgs (${skippedOrgIds.join(", ")})`,
    );
  }

  return NextResponse.json({
    success: true,
    orgsProcessed: orgIds.length - skippedOrgIds.length,
    orgsSkipped: skippedOrgIds.length,
    skippedOrgIds: skippedOrgIds.length > 0 ? skippedOrgIds : undefined,
    generated: generatedCount,
    skippedFresh,
    llmCalls,
    errors: errors.length > 0 ? errors : undefined,
    elapsedMs: Date.now() - startedAt,
    timestamp: new Date().toISOString(),
  });
}
