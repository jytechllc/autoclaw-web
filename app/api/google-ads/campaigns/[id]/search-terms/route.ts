import { NextRequest, NextResponse } from "next/server";
import { auth0 } from "@/lib/auth0";
import { getDb } from "@/lib/db";
import { checkRateLimit } from "@/lib/rate-limit";
import { fetchSearchTerms } from "@/lib/google-ads";
import { resolveOrgId } from "@/lib/credits";

export const dynamic = "force-dynamic";

function getIp(req: NextRequest): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}

/** GET — last-30-days search terms for a SEARCH campaign (read-only;
 *  closed campaigns allowed — historical data stays useful). */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!checkRateLimit(getIp(req), { limit: 30, windowMs: 60_000 })) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }
  const session = await auth0.getSession();
  if (!session?.user?.email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const campaignId = Number(id);
  if (!Number.isFinite(campaignId)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

  const sql = getDb();
  const users = await sql`SELECT id FROM users WHERE email = ${session.user.email as string}`;
  if (users.length === 0) return NextResponse.json({ error: "User not found" }, { status: 404 });
  const userId = users[0].id as number;

  const requestedOrgId = req.nextUrl.searchParams.get("org_id");
  const orgId = await resolveOrgId(sql, userId, requestedOrgId ? Number(requestedOrgId) : undefined);
  if (!orgId) return NextResponse.json({ error: "No organization found" }, { status: 400 });

  const rows = await sql`
    SELECT platform_campaign_id, channel FROM campaigns
    WHERE id = ${campaignId} AND org_id = ${orgId} AND platform = 'google'
  `;
  if (rows.length === 0) return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
  if (rows[0].channel !== "SEARCH") {
    return NextResponse.json({ error: "Search terms are only available for SEARCH campaigns" }, { status: 400 });
  }

  try {
    const terms = await fetchSearchTerms(rows[0].platform_campaign_id as string, 100);
    return NextResponse.json({ terms });
  } catch (e) {
    return NextResponse.json(
      { error: `Failed to load search terms: ${e instanceof Error ? e.message : String(e)}` },
      { status: 502 }
    );
  }
}
