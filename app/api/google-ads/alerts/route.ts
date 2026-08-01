import { NextRequest, NextResponse } from "next/server";
import { requireOrg } from "@/lib/google-ads-auth";

export const dynamic = "force-dynamic";

/** GET — recent anomaly alerts for the caller's org (last 72h, newest first).
 *  Produced by the google-ads-monitor cron; surfaced as the dashboard banner
 *  and forwarded to the desktop shell as native notifications. Pure read —
 *  read-only accounts may see alerts too. */
export async function GET(req: NextRequest) {
  const auth = await requireOrg(req, {
    limit: 60,
    requestedOrgId: req.nextUrl.searchParams.get("orgId") || undefined,
  });
  if ("response" in auth) return auth.response;
  const { sql, orgId } = auth;

  let rows;
  try {
    rows = await sql`
      SELECT a.id, a.campaign_id, a.kind, a.severity, a.numbers, a.created_at,
             c.campaign_name
      FROM google_ads_alerts a
      LEFT JOIN campaigns c ON c.id = a.campaign_id
      WHERE a.org_id = ${orgId} AND a.created_at > NOW() - INTERVAL '72 hours'
      ORDER BY a.created_at DESC
      LIMIT 20
    `;
  } catch {
    // Table appears with the first monitor run — same as "no alerts".
    return NextResponse.json({ success: true, alerts: [] });
  }

  return NextResponse.json({
    success: true,
    alerts: rows.map((r) => ({
      id: Number(r.id),
      campaignId: Number(r.campaign_id),
      campaignName: String(r.campaign_name || ""),
      kind: String(r.kind),
      severity: String(r.severity),
      numbers: r.numbers ?? {},
      createdAt: r.created_at,
    })),
  });
}
