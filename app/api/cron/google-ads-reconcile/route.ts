import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { reconcileOrgSpend, syncOrgGoogleAdsSpend } from "@/lib/google-ads-sync";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const CRON_SECRET = process.env.CRON_SECRET;

/**
 * Daily: re-sync Google Ads spend, then reconcile our ledger so any drift
 * (missed spend deductions, stuck reserves) is detected and corrected.
 */
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  if (CRON_SECRET && authHeader !== `Bearer ${CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sql = getDb();
  // Include orgs with any Google campaign (open or closed) so reconcile catches drift on closed ones too.
  const orgs = await sql`
    SELECT DISTINCT org_id FROM campaigns WHERE platform = 'google'
  `;

  const results = [];
  for (const row of orgs) {
    const orgId = row.org_id as number;
    try {
      const sync = await syncOrgGoogleAdsSpend(sql, orgId);
      const reconcile = await reconcileOrgSpend(sql, orgId);
      results.push({ orgId, sync, reconcile });
    } catch (e) {
      results.push({ orgId, error: e instanceof Error ? e.message : String(e) });
    }
  }

  return NextResponse.json({
    success: true,
    orgsProcessed: orgs.length,
    results,
    timestamp: new Date().toISOString(),
  });
}
