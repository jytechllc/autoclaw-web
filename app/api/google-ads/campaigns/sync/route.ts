import { NextRequest, NextResponse } from "next/server";
import { auth0 } from "@/lib/auth0";
import { getDb } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { checkRateLimit } from "@/lib/rate-limit";
import { syncOrgGoogleAdsSpend } from "@/lib/google-ads-sync";
import { resolveOrgId } from "@/lib/credits";
import { isReadOnlyUserId } from "@/lib/roles-server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function getIp(req: NextRequest): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}

export async function POST(req: NextRequest) {
  const ip = getIp(req);
  if (!checkRateLimit(ip, { limit: 6, windowMs: 60_000 })) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }
  const session = await auth0.getSession();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sql = getDb();
  const users = await sql`SELECT id FROM users WHERE email = ${session.user.email as string}`;
  if (users.length === 0) return NextResponse.json({ error: "User not found" }, { status: 404 });
  const userId = users[0].id as number;
  if (await isReadOnlyUserId(sql, userId)) {
    return NextResponse.json({ error: "Read-only account — writes are disabled" }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const requestedOrgId = body.orgId ? Number(body.orgId) : undefined;
  const orgId = await resolveOrgId(sql, userId, requestedOrgId);
  if (!orgId) return NextResponse.json({ error: "No organization found" }, { status: 400 });

  const summary = await syncOrgGoogleAdsSpend(sql, orgId);

  logAudit({
    userId, userEmail: session.user.email as string,
    action: "google_ads.create_campaign",
    resourceType: "sync",
    details: { sub_action: "manual_sync", ...summary },
    ipAddress: ip,
  });

  return NextResponse.json({ success: true, ...summary });
}
