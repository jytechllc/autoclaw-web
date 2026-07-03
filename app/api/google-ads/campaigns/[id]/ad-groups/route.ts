import { NextRequest, NextResponse } from "next/server";
import { auth0 } from "@/lib/auth0";
import { getDb } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { checkRateLimit } from "@/lib/rate-limit";
import { createAdGroup } from "@/lib/google-ads";
import { resolveOrgId } from "@/lib/credits";
import { isReadOnlyUserId } from "@/lib/roles-server";

export const dynamic = "force-dynamic";

function getIp(req: NextRequest): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ip = getIp(req);
  if (!checkRateLimit(ip, { limit: 30, windowMs: 60_000 })) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  const session = await auth0.getSession();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const campaignId = Number(id);
  if (!Number.isFinite(campaignId)) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  const body = await req.json().catch(() => ({}));
  const name = String(body.name || "").trim();
  const cpcBidUsd = Number(body.cpcBidUsd);

  if (!name) return NextResponse.json({ error: "name is required" }, { status: 400 });
  if (!Number.isFinite(cpcBidUsd) || cpcBidUsd <= 0) {
    return NextResponse.json({ error: "cpcBidUsd must be > 0" }, { status: 400 });
  }

  const sql = getDb();
  const userEmail = session.user.email as string;
  const users = await sql`SELECT id FROM users WHERE email = ${userEmail}`;
  if (users.length === 0) return NextResponse.json({ error: "User not found" }, { status: 404 });
  const userId = users[0].id as number;
  if (await isReadOnlyUserId(sql, userId)) {
    return NextResponse.json({ error: "Read-only account — writes are disabled" }, { status: 403 });
  }

  const requestedOrgId = body.orgId ? Number(body.orgId) : undefined;
  const orgId = await resolveOrgId(sql, userId, requestedOrgId);
  if (!orgId) return NextResponse.json({ error: "No organization found" }, { status: 400 });

  const rows = await sql`
    SELECT platform_campaign_id, campaign_name, channel, closed
    FROM campaigns
    WHERE id = ${campaignId} AND org_id = ${orgId} AND platform = 'google'
  `;
  if (rows.length === 0) return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
  const c = rows[0];
  if (c.closed) return NextResponse.json({ error: "Campaign is closed" }, { status: 409 });

  const result = await createAdGroup({
    campaignResourceName: c.platform_campaign_id as string,
    name,
    channel: (c.channel || "SEARCH") as "SEARCH" | "DISPLAY" | "SHOPPING" | "VIDEO",
    cpcBidUsd,
  });

  if (!result.resourceName) {
    return NextResponse.json({ error: "Failed to create ad group", details: result.error }, { status: 502 });
  }

  logAudit({
    userId, userEmail,
    action: "google_ads.create_campaign",
    resourceType: "ad_group", resourceId: campaignId,
    details: { sub_action: "create_ad_group", name, cpcBidUsd, resourceName: result.resourceName },
    ipAddress: ip,
  });

  return NextResponse.json({ success: true, resourceName: result.resourceName });
}
