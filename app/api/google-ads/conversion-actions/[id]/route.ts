import { NextRequest, NextResponse } from "next/server";
import { auth0 } from "@/lib/auth0";
import { getDb } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { checkRateLimit } from "@/lib/rate-limit";
import { setConversionActionStatus } from "@/lib/google-ads";
import { resolveOrgId } from "@/lib/credits";

export const dynamic = "force-dynamic";

function getIp(req: NextRequest): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}

const VALID_STATUSES = new Set(["ENABLED", "PAUSED", "REMOVED"]);

/** PATCH — change a conversion action's status.
 *  Body: { status: "ENABLED" | "PAUSED" | "REMOVED", orgId? } */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ip = getIp(req);
  if (!checkRateLimit(ip, { limit: 30, windowMs: 60_000 })) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }
  const session = await auth0.getSession();
  if (!session?.user?.email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const actionId = Number(id);
  if (!Number.isFinite(actionId) || actionId <= 0) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  const body = await req.json().catch(() => ({}));
  const status = String(body.status || "").toUpperCase();
  if (!VALID_STATUSES.has(status)) {
    return NextResponse.json({ error: "status must be one of: ENABLED, PAUSED, REMOVED" }, { status: 400 });
  }

  const sql = getDb();
  const userEmail = session.user.email as string;
  const users = await sql`SELECT id FROM users WHERE email = ${userEmail}`;
  if (users.length === 0) return NextResponse.json({ error: "User not found" }, { status: 404 });
  const userId = users[0].id as number;

  const requestedOrgId = body.orgId ? Number(body.orgId) : undefined;
  const orgId = await resolveOrgId(sql, userId, requestedOrgId);
  if (!orgId) return NextResponse.json({ error: "No organization found" }, { status: 400 });

  const customerId = process.env.GOOGLE_ADS_CUSTOMER_ID || "";
  const resourceName = `customers/${customerId}/conversionActions/${actionId}`;
  const result = await setConversionActionStatus(resourceName, status as "ENABLED" | "PAUSED" | "REMOVED");
  if (!result.success) {
    return NextResponse.json({ error: "Failed to update conversion action", details: result.error }, { status: 502 });
  }

  logAudit({
    userId, userEmail,
    action: "google_ads.create_campaign",
    resourceType: "conversion_action", resourceId: actionId,
    details: { sub_action: "set_conversion_action_status", status },
    ipAddress: ip,
  });

  return NextResponse.json({ success: true, status });
}
