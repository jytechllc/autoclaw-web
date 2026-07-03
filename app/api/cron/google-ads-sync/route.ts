import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { syncOrgGoogleAdsSpend, orderOrgsForCron } from "@/lib/google-ads-sync";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const CRON_SECRET = process.env.CRON_SECRET;

// Stop starting new orgs once this much of maxDuration has elapsed, leaving
// headroom for the in-flight org + response serialization (audit D-10).
const TIME_BUDGET_MS = (maxDuration - 30) * 1000;

/**
 * Hourly: for each org with active Google Ads campaigns, sync spend → auto-close at cap.
 * Time-budgeted: if the org list outgrows the budget, the tail is skipped and
 * reported; the rotation seed (hour) ensures a different tail next run.
 */
export async function GET(req: NextRequest) {
  const startedAt = Date.now();
  const authHeader = req.headers.get("authorization");
  if (CRON_SECRET && authHeader !== `Bearer ${CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sql = getDb();
  const orgs = await sql`
    SELECT DISTINCT org_id FROM campaigns WHERE platform = 'google' AND closed = false
  `;
  const hourSeed = Math.floor(Date.now() / 3_600_000);
  const orgIds = orderOrgsForCron(orgs.map((r) => r.org_id as number), hourSeed);

  const summaries = [];
  const skippedOrgIds: number[] = [];
  for (const orgId of orgIds) {
    if (Date.now() - startedAt > TIME_BUDGET_MS) {
      skippedOrgIds.push(orgId);
      continue;
    }
    try {
      const summary = await syncOrgGoogleAdsSpend(sql, orgId);
      summaries.push(summary);
    } catch (e) {
      summaries.push({ orgId, error: e instanceof Error ? e.message : String(e) });
    }
  }

  if (skippedOrgIds.length > 0) {
    console.warn(`[google-ads-sync] time budget hit: skipped ${skippedOrgIds.length}/${orgIds.length} orgs (${skippedOrgIds.join(", ")})`);
  }

  return NextResponse.json({
    success: true,
    orgsProcessed: orgIds.length - skippedOrgIds.length,
    orgsSkipped: skippedOrgIds.length,
    skippedOrgIds: skippedOrgIds.length > 0 ? skippedOrgIds : undefined,
    elapsedMs: Date.now() - startedAt,
    summaries,
    timestamp: new Date().toISOString(),
  });
}
