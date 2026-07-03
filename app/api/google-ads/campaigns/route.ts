import { NextRequest, NextResponse } from "next/server";
import { auth0 } from "@/lib/auth0";
import { getDb } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { checkRateLimit } from "@/lib/rate-limit";
import { createCampaign } from "@/lib/google-ads";
import { isReadOnlyUserId } from "@/lib/roles-server";
import {
  reserveForCampaign,
  attachReserveReference,
  applyPlatformMarkup,
  releaseReserve,
  InsufficientCreditsError,
  resolveOrgId,
} from "@/lib/credits";

export const dynamic = "force-dynamic";

function getIp(req: NextRequest): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}

// Schema for ad_accounts, campaigns, ad_credits, ad_credit_transactions
// is declared in lib/schema.sql (runtime table-creation helpers were removed
// after the schema lift; see docs/google-ads-audit.md D-2).

async function getUserId(sql: ReturnType<typeof getDb>, email: string): Promise<number | null> {
  const rows = await sql`SELECT id FROM users WHERE email = ${email}`;
  return rows.length > 0 ? (rows[0].id as number) : null;
}

async function ensureGoogleAdAccount(sql: ReturnType<typeof getDb>, orgId: number, userId: number, customerId: string): Promise<number | null> {
  const existing = await sql`
    SELECT id FROM ad_accounts
    WHERE org_id = ${orgId} AND platform = 'google' AND account_id = ${customerId}
  `;
  if (existing.length > 0) return existing[0].id as number;

  const inserted = await sql`
    INSERT INTO ad_accounts (org_id, platform, account_id, account_name, created_by)
    VALUES (${orgId}, 'google', ${customerId}, ${'Google Ads ' + customerId}, ${userId})
    RETURNING id
  `;
  return inserted[0]?.id as number || null;
}

// GET: list campaigns for user's org (from DB)
export async function GET(req: NextRequest) {
  if (!checkRateLimit(getIp(req), { limit: 60, windowMs: 60_000 })) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  const session = await auth0.getSession();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sql = getDb();

  const userId = await getUserId(sql, session.user.email as string);
  if (!userId) return NextResponse.json({ campaigns: [] });

  const requestedOrgId = req.nextUrl.searchParams.get("org_id");
  const orgId = await resolveOrgId(sql, userId, requestedOrgId ? Number(requestedOrgId) : undefined);
  if (!orgId) return NextResponse.json({ campaigns: [] });

  const rows = await sql`
    SELECT c.id, c.platform_campaign_id, c.campaign_name, c.channel, c.daily_budget, c.currency, c.status,
           c.total_budget_cents, c.reserved_cents, c.spent_cents, c.closed, c.created_at,
           c.project_id, p.name AS project_name, p.website AS project_website
    FROM campaigns c
    LEFT JOIN projects p ON p.id = c.project_id
    WHERE c.org_id = ${orgId} AND c.platform = 'google'
    ORDER BY c.created_at DESC
  `;
  return NextResponse.json({ campaigns: rows, orgId });
}

// POST: create a new campaign
export async function POST(req: NextRequest) {
  const ip = getIp(req);
  if (!checkRateLimit(ip, { limit: 30, windowMs: 60_000 })) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  const session = await auth0.getSession();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const name = String(body.name || "").trim();
  const dailyBudget = Number(body.dailyBudget);
  const totalBudget = Number(body.totalBudget);
  const channel = String(body.channel || "SEARCH").toUpperCase();
  const projectIdInput = body.projectId !== undefined && body.projectId !== null
    ? Number(body.projectId)
    : null;

  if (!name) return NextResponse.json({ error: "name is required" }, { status: 400 });
  if (!Number.isFinite(dailyBudget) || dailyBudget <= 0) {
    return NextResponse.json({ error: "dailyBudget must be > 0" }, { status: 400 });
  }
  if (!Number.isFinite(totalBudget) || totalBudget <= 0) {
    return NextResponse.json({ error: "totalBudget must be > 0" }, { status: 400 });
  }
  if (totalBudget < dailyBudget) {
    return NextResponse.json({ error: "totalBudget must be >= dailyBudget" }, { status: 400 });
  }
  if (!["SEARCH", "DISPLAY", "SHOPPING", "VIDEO", "PERFORMANCE_MAX"].includes(channel)) {
    return NextResponse.json({ error: "channel must be SEARCH, DISPLAY, SHOPPING, VIDEO, or PERFORMANCE_MAX" }, { status: 400 });
  }

  const customerId = process.env.GOOGLE_ADS_CUSTOMER_ID;
  if (!customerId) {
    return NextResponse.json({ error: "GOOGLE_ADS_CUSTOMER_ID not configured" }, { status: 500 });
  }

  const sql = getDb();

  const userEmail = session.user.email as string;
  const userId = await getUserId(sql, userEmail);
  if (!userId) return NextResponse.json({ error: "User not found" }, { status: 401 });
  if (await isReadOnlyUserId(sql, userId)) {
    return NextResponse.json({ error: "Read-only account — writes are disabled" }, { status: 403 });
  }

  const requestedOrgId = body.orgId ? Number(body.orgId) : undefined;
  const orgId = await resolveOrgId(sql, userId, requestedOrgId);
  if (!orgId) return NextResponse.json({ error: requestedOrgId ? "Forbidden — not a member of that org" : "No organization found" }, { status: 400 });

  // Owner project — must belong to the same org if supplied. Nullable: callers
  // without a project picker yet (legacy UI) keep working.
  let projectId: number | null = null;
  if (projectIdInput !== null && Number.isFinite(projectIdInput) && projectIdInput > 0) {
    const projectRows = await sql`SELECT id FROM projects WHERE id = ${projectIdInput} AND org_id = ${orgId}`;
    if (projectRows.length === 0) {
      return NextResponse.json({ error: "projectId does not belong to this organization" }, { status: 400 });
    }
    projectId = Number(projectRows[0].id);
  }

  // Reserve credits BEFORE calling Google Ads — protect platform funds.
  // totalBudgetCents is the Google-side cap; pool reserves the marked-up amount.
  const orgPlanRow = await sql`SELECT plan FROM organizations WHERE id = ${orgId}`;
  const orgPlan = (orgPlanRow[0]?.plan as string | null | undefined) ?? null;
  const totalBudgetCents = Math.round(totalBudget * 100);
  const reservedPlatformCents = applyPlatformMarkup(totalBudgetCents, orgPlan);
  try {
    await reserveForCampaign(sql, orgId, reservedPlatformCents, name);
  } catch (e) {
    if (e instanceof InsufficientCreditsError) {
      return NextResponse.json({
        error: "Insufficient credits. Please top up first.",
        balanceCents: e.balanceCents,
        requestedCents: e.requestedCents,
      }, { status: 402 });
    }
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }

  let result;
  try {
    result = await createCampaign({
      name,
      dailyBudget,
      channel: channel as "SEARCH" | "DISPLAY" | "SHOPPING" | "VIDEO" | "PERFORMANCE_MAX",
      locationIds: Array.isArray(body.locationIds) ? body.locationIds.map(String) : undefined,
    });
  } catch (e) {
    // Google Ads call threw — release reservation
    await releaseReserve(sql, orgId, reservedPlatformCents, 0, `Reverted: Google Ads error for ${name}`);
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }

  if (!result.campaign) {
    // Google Ads returned no resource — release reservation
    await releaseReserve(sql, orgId, reservedPlatformCents, 0, `Reverted: Failed to create ${name}`);
    return NextResponse.json({ error: "Failed to create campaign", result }, { status: 502 });
  }

  // Persist campaign
  const adAccountId = await ensureGoogleAdAccount(sql, orgId, userId, customerId);
  const inserted = await sql`
    INSERT INTO campaigns
      (org_id, project_id, ad_account_id, platform, platform_campaign_id, campaign_name, channel,
       daily_budget, status, created_by, total_budget_cents, reserved_cents, spent_cents, closed)
    VALUES
      (${orgId}, ${projectId}, ${adAccountId}, 'google', ${result.campaign}, ${name}, ${channel},
       ${dailyBudget}, 'PAUSED', ${userId}, ${totalBudgetCents}, ${totalBudgetCents}, 0, false)
    ON CONFLICT (platform, platform_campaign_id)
    DO UPDATE SET campaign_name = EXCLUDED.campaign_name, project_id = EXCLUDED.project_id, updated_at = NOW()
    RETURNING id
  `;
  const campaignId = inserted[0].id as number;

  // Tie reservation transaction to the campaign id
  await attachReserveReference(sql, orgId, campaignId, reservedPlatformCents);

  logAudit({
    userId,
    userEmail,
    action: "google_ads.create_campaign",
    resourceType: "campaign",
    resourceId: campaignId,
    details: { name, dailyBudget, totalBudget, channel, resourceName: result.campaign },
    ipAddress: ip,
  });

  return NextResponse.json({
    success: true,
    campaignId,
    campaignName: name,
    resourceName: result.campaign,
    status: "PAUSED",
    dailyBudget,
    totalBudget,
    created: result,
    // Surface partial-failure errors (e.g. ad group / ad / keywords step failed but campaign exists)
    warnings: result.errors.length > 0 ? result.errors : undefined,
  });
}
