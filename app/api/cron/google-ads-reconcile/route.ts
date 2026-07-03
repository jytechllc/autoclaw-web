import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { reconcileOrgSpend, syncOrgGoogleAdsSpend, orderOrgsForCron } from "@/lib/google-ads-sync";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const CRON_SECRET = process.env.CRON_SECRET;

// Stop starting new orgs once this much of maxDuration has elapsed, leaving
// headroom for the in-flight org + response serialization (audit D-10).
const TIME_BUDGET_MS = (maxDuration - 30) * 1000;

/**
 * Daily: re-sync Google Ads spend, then reconcile our ledger so any drift
 * (missed spend deductions, stuck reserves) is detected and corrected.
 * Time-budgeted with day-seeded rotation — see google-ads-sync/route.ts.
 */
export async function GET(req: NextRequest) {
  const startedAt = Date.now();
  const authHeader = req.headers.get("authorization");
  if (CRON_SECRET && authHeader !== `Bearer ${CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sql = getDb();
  // Include orgs with any Google campaign (open or closed) so reconcile catches drift on closed ones too.
  const orgs = await sql`
    SELECT DISTINCT org_id FROM campaigns WHERE platform = 'google'
  `;
  const daySeed = Math.floor(Date.now() / 86_400_000);
  const orgIds = orderOrgsForCron(orgs.map((r) => r.org_id as number), daySeed);

  const results = [];
  const skippedOrgIds: number[] = [];
  for (const orgId of orgIds) {
    if (Date.now() - startedAt > TIME_BUDGET_MS) {
      skippedOrgIds.push(orgId);
      continue;
    }
    try {
      const sync = await syncOrgGoogleAdsSpend(sql, orgId);
      const reconcile = await reconcileOrgSpend(sql, orgId);
      results.push({ orgId, sync, reconcile });
    } catch (e) {
      results.push({ orgId, error: e instanceof Error ? e.message : String(e) });
    }
  }

  if (skippedOrgIds.length > 0) {
    console.warn(`[google-ads-reconcile] time budget hit: skipped ${skippedOrgIds.length}/${orgIds.length} orgs (${skippedOrgIds.join(", ")})`);
  }

  return NextResponse.json({
    success: true,
    orgsProcessed: orgIds.length - skippedOrgIds.length,
    orgsSkipped: skippedOrgIds.length,
    skippedOrgIds: skippedOrgIds.length > 0 ? skippedOrgIds : undefined,
    elapsedMs: Date.now() - startedAt,
    results,
    timestamp: new Date().toISOString(),
  });
}
