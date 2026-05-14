import { NextRequest, NextResponse } from "next/server";
import { auth0 } from "@/lib/auth0";
import { getDb } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { checkRateLimit } from "@/lib/rate-limit";
import { createCampaign } from "@/lib/google-ads";
import {
  ensureAdCreditsTables,
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

async function ensureAdsTables() {
  const sql = getDb();
  await sql`
    CREATE TABLE IF NOT EXISTS ad_accounts (
      id SERIAL PRIMARY KEY,
      org_id INTEGER REFERENCES organizations(id) ON DELETE CASCADE,
      platform VARCHAR(20) NOT NULL,
      account_id VARCHAR(100) NOT NULL,
      account_name VARCHAR(255),
      credentials JSONB,
      is_active BOOLEAN DEFAULT true,
      created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMP DEFAULT NOW(),
      UNIQUE(org_id, platform, account_id)
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS campaigns (
      id SERIAL PRIMARY KEY,
      org_id INTEGER REFERENCES organizations(id) ON DELETE CASCADE,
      ad_account_id INTEGER REFERENCES ad_accounts(id) ON DELETE SET NULL,
      platform VARCHAR(20) NOT NULL,
      platform_campaign_id VARCHAR(255),
      campaign_name VARCHAR(255) NOT NULL,
      channel VARCHAR(50),
      daily_budget NUMERIC(12, 2),
      currency VARCHAR(10) DEFAULT 'USD',
      status VARCHAR(20),
      metadata JSONB,
      created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW(),
      UNIQUE(platform, platform_campaign_id)
    )
  `;
  // Budget cap columns for credit reservation
  await sql`ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS total_budget_cents BIGINT DEFAULT 0`;
  await sql`ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS reserved_cents BIGINT DEFAULT 0`;
  await sql`ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS spent_cents BIGINT DEFAULT 0`;
  await sql`ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS closed BOOLEAN DEFAULT false`;
  // Owner project — per Epic 2 in autoclaw-business-architecture-design.
  // Nullable + ON DELETE SET NULL so deleting a project doesn't orphan campaigns;
  // they fall back to "no project" status until reassigned.
  await sql`ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL`;
  await sql`CREATE INDEX IF NOT EXISTS idx_campaigns_project_id ON campaigns(project_id) WHERE project_id IS NOT NULL`;
  await ensureAdCreditsTables(sql);
}

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
  await ensureAdsTables();

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
  if (!["SEARCH", "DISPLAY", "SHOPPING", "VIDEO"].includes(channel)) {
    return NextResponse.json({ error: "channel must be SEARCH, DISPLAY, SHOPPING, or VIDEO" }, { status: 400 });
  }

  const customerId = process.env.GOOGLE_ADS_CUSTOMER_ID;
  if (!customerId) {
    return NextResponse.json({ error: "GOOGLE_ADS_CUSTOMER_ID not configured" }, { status: 500 });
  }

  const sql = getDb();
  await ensureAdsTables();

  const userEmail = session.user.email as string;
  const userId = await getUserId(sql, userEmail);
  if (!userId) return NextResponse.json({ error: "User not found" }, { status: 401 });

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
      channel: channel as "SEARCH" | "DISPLAY" | "SHOPPING" | "VIDEO",
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
