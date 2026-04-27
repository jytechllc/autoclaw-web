import { NextRequest, NextResponse } from "next/server";
import { auth0 } from "@/lib/auth0";
import { getDb } from "@/lib/db";
import { checkRateLimit } from "@/lib/rate-limit";
import { listAllCampaigns } from "@/lib/google-ads";
import { resolveOrgId } from "@/lib/credits";

export const dynamic = "force-dynamic";

function getIp(req: NextRequest): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}

/** Lists all Google Ads campaigns + flags which are already managed by AutoClaw. */
export async function GET(req: NextRequest) {
  if (!checkRateLimit(getIp(req), { limit: 10, windowMs: 60_000 })) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }
  const session = await auth0.getSession();
  if (!session?.user?.email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const sql = getDb();
  const users = await sql`SELECT id FROM users WHERE email = ${session.user.email as string}`;
  if (users.length === 0) return NextResponse.json({ error: "User not found" }, { status: 404 });
  const userId = users[0].id as number;

  const requestedOrgId = req.nextUrl.searchParams.get("org_id");
  const orgId = await resolveOrgId(sql, userId, requestedOrgId ? Number(requestedOrgId) : undefined);
  if (!orgId) return NextResponse.json({ error: "No organization found" }, { status: 400 });

  // Pull all campaigns from Google Ads
  let googleCampaigns;
  try {
    googleCampaigns = await listAllCampaigns();
  } catch (e) {
    return NextResponse.json({ error: "Failed to list Google Ads campaigns", details: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }

  // Get already-managed campaigns from DB (by resourceName) — across all orgs the user is in
  const orgRows = await sql`SELECT org_id FROM organization_members WHERE user_id = ${userId}`;
  const orgIds = orgRows.map((r) => r.org_id as number);
  const managedRows = orgIds.length > 0
    ? await sql`
        SELECT platform_campaign_id, org_id FROM campaigns
        WHERE platform = 'google' AND org_id = ANY(${orgIds})
      `
    : [];
  const managedByResource = new Map(
    managedRows.map((r) => [r.platform_campaign_id as string, r.org_id as number])
  );

  const enriched = googleCampaigns.map((c) => ({
    ...c,
    managed: managedByResource.has(c.resourceName),
    managedByOrgId: managedByResource.get(c.resourceName) || null,
  }));

  return NextResponse.json({ campaigns: enriched, orgId });
}
