import { NextRequest, NextResponse } from "next/server";
import { auth0 } from "@/lib/auth0";
import { getDb } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { checkRateLimit } from "@/lib/rate-limit";
import {
  listConversionActions,
  createConversionAction,
  CONVERSION_ACTION_CATEGORIES,
  CONVERSION_COUNTING_TYPES,
  type ConversionActionCategory,
  type ConversionCountingType,
} from "@/lib/google-ads";
import { resolveOrgId } from "@/lib/credits";
import { isReadOnlyUserId } from "@/lib/roles-server";

export const dynamic = "force-dynamic";

function getIp(req: NextRequest): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}

/** Resolve the caller's user + org or return an error response.
 *  Conversion actions are account-level (shared customer), but we still
 *  require an authenticated org member — same trust boundary as diagnose. */
async function requireOrgMember(
  body: Record<string, unknown> | null,
  orgIdParam?: string | null
): Promise<{ error: NextResponse } | { userId: number; userEmail: string; orgId: number }> {
  const session = await auth0.getSession();
  if (!session?.user?.email) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };

  const sql = getDb();
  const userEmail = session.user.email as string;
  const users = await sql`SELECT id FROM users WHERE email = ${userEmail}`;
  if (users.length === 0) return { error: NextResponse.json({ error: "User not found" }, { status: 404 }) };
  const userId = users[0].id as number;

  const requestedOrgId = body?.orgId ? Number(body.orgId) : orgIdParam ? Number(orgIdParam) : undefined;
  const orgId = await resolveOrgId(sql, userId, requestedOrgId);
  if (!orgId) return { error: NextResponse.json({ error: "No organization found" }, { status: 400 }) };

  return { userId, userEmail, orgId };
}

/** GET — list all non-removed conversion actions (with gtag snippets). */
export async function GET(req: NextRequest) {
  if (!checkRateLimit(getIp(req), { limit: 30, windowMs: 60_000 })) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }
  const auth = await requireOrgMember(null, req.nextUrl.searchParams.get("org_id"));
  if ("error" in auth) return auth.error;

  try {
    const actions = await listConversionActions();
    return NextResponse.json({ actions });
  } catch (e) {
    return NextResponse.json(
      { error: `Failed to list conversion actions: ${e instanceof Error ? e.message : String(e)}` },
      { status: 502 }
    );
  }
}

/** POST — create a WEBPAGE conversion action.
 *  Body: { name, category, countingType, defaultValue?, clickLookbackDays?, orgId? } */
export async function POST(req: NextRequest) {
  const ip = getIp(req);
  if (!checkRateLimit(ip, { limit: 10, windowMs: 60_000 })) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  const body = await req.json().catch(() => ({}));
  const auth = await requireOrgMember(body);
  if ("error" in auth) return auth.error;
  const { userId, userEmail } = auth;
  if (await isReadOnlyUserId(getDb(), userId)) {
    return NextResponse.json({ error: "Read-only account — writes are disabled" }, { status: 403 });
  }

  const name = String(body.name || "").trim();
  const category = String(body.category || "").toUpperCase() as ConversionActionCategory;
  const countingType = String(body.countingType || "ONE_PER_CLICK").toUpperCase() as ConversionCountingType;
  if (!CONVERSION_ACTION_CATEGORIES.includes(category)) {
    return NextResponse.json({ error: `category must be one of: ${CONVERSION_ACTION_CATEGORIES.join(", ")}` }, { status: 400 });
  }
  if (!CONVERSION_COUNTING_TYPES.includes(countingType)) {
    return NextResponse.json({ error: `countingType must be one of: ${CONVERSION_COUNTING_TYPES.join(", ")}` }, { status: 400 });
  }
  const defaultValueUsd = body.defaultValue !== undefined && body.defaultValue !== null && body.defaultValue !== ""
    ? Number(body.defaultValue)
    : undefined;
  const clickLookbackDays = body.clickLookbackDays !== undefined && body.clickLookbackDays !== null && body.clickLookbackDays !== ""
    ? Number(body.clickLookbackDays)
    : undefined;

  const result = await createConversionAction({ name, category, countingType, defaultValueUsd, clickLookbackDays });
  if (!result.action) {
    return NextResponse.json({ error: "Failed to create conversion action", details: result.error }, { status: 502 });
  }

  logAudit({
    userId, userEmail,
    action: "google_ads.create_campaign",
    resourceType: "conversion_action", resourceId: Number(result.action.id) || undefined,
    details: { sub_action: "create_conversion_action", name, category, countingType, defaultValueUsd, clickLookbackDays },
    ipAddress: ip,
  });

  return NextResponse.json({ success: true, action: result.action });
}
