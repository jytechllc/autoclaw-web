import { NextRequest, NextResponse } from "next/server";
import { auth0 } from "@/lib/auth0";
import { getDb } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { checkRateLimit } from "@/lib/rate-limit";
import { resolveOrgId } from "@/lib/credits";
import { isReadOnlyUserId } from "@/lib/roles-server";

export const dynamic = "force-dynamic";

function getIp(req: NextRequest): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}

async function loadUserOrg(requestedOrgIdRaw: unknown) {
  const session = await auth0.getSession();
  if (!session?.user?.email) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  const sql = getDb();
  const userEmail = session.user.email as string;
  const users = await sql`SELECT id FROM users WHERE email = ${userEmail}`;
  if (users.length === 0) return { error: NextResponse.json({ error: "User not found" }, { status: 404 }) };
  const userId = users[0].id as number;
  const requestedOrgId = requestedOrgIdRaw ? Number(requestedOrgIdRaw) : undefined;
  const orgId = await resolveOrgId(sql, userId, requestedOrgId);
  if (!orgId) return { error: NextResponse.json({ error: "No organization found" }, { status: 400 }) };
  return { sql, userId, userEmail, orgId };
}

// Two org-level email preferences share this route:
//   kind "weekly" (default) → weekly_ads_digest   (the Monday report)
//   kind "alerts"           → ads_alert_emails    (anomaly alert emails)
const KIND_COLUMNS = {
  weekly: "weekly_ads_digest",
  alerts: "ads_alert_emails",
} as const;
type PrefKind = keyof typeof KIND_COLUMNS;

function parseKind(raw: unknown): PrefKind {
  return raw === "alerts" ? "alerts" : "weekly";
}

// GET — current preference for the org. Query: ?kind=weekly|alerts
export async function GET(req: NextRequest) {
  if (!checkRateLimit(getIp(req), { limit: 60, windowMs: 60_000 })) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }
  const loaded = await loadUserOrg(req.nextUrl.searchParams.get("orgId") || undefined);
  if ("error" in loaded) return loaded.error;
  const { sql, orgId } = loaded;
  const kind = parseKind(req.nextUrl.searchParams.get("kind"));

  try {
    const rows = kind === "alerts"
      ? await sql`SELECT COALESCE(ads_alert_emails, TRUE) AS enabled FROM organizations WHERE id = ${orgId}`
      : await sql`SELECT COALESCE(weekly_ads_digest, TRUE) AS enabled FROM organizations WHERE id = ${orgId}`;
    return NextResponse.json({ success: true, kind, enabled: rows.length > 0 ? Boolean(rows[0].enabled) : true });
  } catch {
    // Column may not exist yet on a fresh deployment — default is on.
    return NextResponse.json({ success: true, kind, enabled: true });
  }
}

// POST — set it. Body: { enabled: boolean, kind?: "weekly"|"alerts", orgId? }
export async function POST(req: NextRequest) {
  const ip = getIp(req);
  if (!checkRateLimit(ip, { limit: 30, windowMs: 60_000 })) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }
  const body = await req.json().catch(() => ({}));
  if (typeof body.enabled !== "boolean") {
    return NextResponse.json({ error: "enabled must be a boolean" }, { status: 400 });
  }
  const kind = parseKind(body.kind);

  const loaded = await loadUserOrg(body.orgId);
  if ("error" in loaded) return loaded.error;
  const { sql, userId, userEmail, orgId } = loaded;

  if (await isReadOnlyUserId(sql, userId)) {
    return NextResponse.json({ error: "Read-only account — writes are disabled" }, { status: 403 });
  }

  // Self-heal the column (same statements as the crons / schema.sql).
  if (kind === "alerts") {
    await sql`ALTER TABLE organizations ADD COLUMN IF NOT EXISTS ads_alert_emails BOOLEAN DEFAULT TRUE`;
    await sql`UPDATE organizations SET ads_alert_emails = ${body.enabled} WHERE id = ${orgId}`;
  } else {
    await sql`ALTER TABLE organizations ADD COLUMN IF NOT EXISTS weekly_ads_digest BOOLEAN DEFAULT TRUE`;
    await sql`UPDATE organizations SET weekly_ads_digest = ${body.enabled} WHERE id = ${orgId}`;
  }

  logAudit({
    userId, userEmail,
    action: "google_ads.create_campaign",
    resourceType: "digest_preference", resourceId: orgId,
    details: { sub_action: kind === "alerts" ? "set_alert_emails" : "set_weekly_digest", enabled: body.enabled },
    ipAddress: ip,
  });

  return NextResponse.json({ success: true, kind, enabled: body.enabled });
}
