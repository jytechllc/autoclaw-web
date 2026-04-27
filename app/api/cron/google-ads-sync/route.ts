import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { syncOrgGoogleAdsSpend } from "@/lib/google-ads-sync";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const CRON_SECRET = process.env.CRON_SECRET;

/**
 * Hourly: for each org with active Google Ads campaigns, sync spend → auto-close at cap.
 */
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  if (CRON_SECRET && authHeader !== `Bearer ${CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sql = getDb();
  const orgs = await sql`
    SELECT DISTINCT org_id FROM campaigns WHERE platform = 'google' AND closed = false
  `;

  const summaries = [];
  for (const row of orgs) {
    const orgId = row.org_id as number;
    try {
      const summary = await syncOrgGoogleAdsSpend(sql, orgId);
      summaries.push(summary);
    } catch (e) {
      summaries.push({ orgId, error: e instanceof Error ? e.message : String(e) });
    }
  }

  return NextResponse.json({
    success: true,
    orgsProcessed: orgs.length,
    summaries,
    timestamp: new Date().toISOString(),
  });
}
