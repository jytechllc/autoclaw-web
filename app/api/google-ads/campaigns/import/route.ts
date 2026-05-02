import { NextRequest, NextResponse } from "next/server";
import { auth0 } from "@/lib/auth0";
import { getDb } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { checkRateLimit } from "@/lib/rate-limit";
import { listAllCampaigns } from "@/lib/google-ads";
import {
  resolveOrgId,
  reserveForCampaign,
  attachReserveReference,
  applyPlatformMarkup,
  InsufficientCreditsError,
} from "@/lib/credits";

export const dynamic = "force-dynamic";

function getIp(req: NextRequest): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}

export async function POST(req: NextRequest) {
  const ip = getIp(req);
  if (!checkRateLimit(ip, { limit: 10, windowMs: 60_000 })) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }
  const session = await auth0.getSession();
  if (!session?.user?.email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const resourceName = String(body.resourceName || "").trim();
  const totalBudget = Number(body.totalBudget);

  if (!resourceName.startsWith("customers/")) {
    return NextResponse.json({ error: "Invalid resourceName" }, { status: 400 });
  }
  if (!Number.isFinite(totalBudget) || totalBudget <= 0) {
    return NextResponse.json({ error: "totalBudget must be > 0" }, { status: 400 });
  }

  const sql = getDb();
  const userEmail = session.user.email as string;
  const users = await sql`SELECT id FROM users WHERE email = ${userEmail}`;
  if (users.length === 0) return NextResponse.json({ error: "User not found" }, { status: 401 });
  const userId = users[0].id as number;

  const requestedOrgId = body.orgId ? Number(body.orgId) : undefined;
  const orgId = await resolveOrgId(sql, userId, requestedOrgId);
  if (!orgId) return NextResponse.json({ error: "No organization found" }, { status: 400 });

  // Already imported?
  const existing = await sql`
    SELECT id FROM campaigns WHERE platform = 'google' AND platform_campaign_id = ${resourceName}
  `;
  if (existing.length > 0) {
    return NextResponse.json({ error: "Campaign already imported" }, { status: 409 });
  }

  // Find the campaign on Google Ads side to copy metadata
  let googleCampaigns;
  try {
    googleCampaigns = await listAllCampaigns();
  } catch (e) {
    return NextResponse.json({ error: "Failed to verify campaign on Google Ads", details: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
  const target = googleCampaigns.find((c) => c.resourceName === resourceName);
  if (!target) {
    return NextResponse.json({ error: "Campaign not found on Google Ads" }, { status: 404 });
  }

  // Reserve credits — same flow as create_campaign
  const totalBudgetCents = Math.round(totalBudget * 100);
  const initialSpentCents = Math.round(target.metrics.costMicros / 10_000);
  if (initialSpentCents >= totalBudgetCents) {
    return NextResponse.json({
      error: "Existing spend already exceeds your proposed cap. Increase the cap.",
      existingSpentCents: initialSpentCents,
      requestedCapCents: totalBudgetCents,
    }, { status: 400 });
  }

  // Only reserve for the REMAINING Google-side budget (cap minus already-spent), then mark up to platform-side.
  // Reserving the full cap would over-bill the user for ad spend that happened before import.
  const orgPlanRow = await sql`SELECT plan FROM organizations WHERE id = ${orgId}`;
  const orgPlan = (orgPlanRow[0]?.plan as string | null | undefined) ?? null;
  const remainingGoogleCents = Math.max(totalBudgetCents - initialSpentCents, 0);
  const reservedPlatformCents = applyPlatformMarkup(remainingGoogleCents, orgPlan);
  try {
    await reserveForCampaign(sql, orgId, reservedPlatformCents, target.name);
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

  // Persist
  const customerId = process.env.GOOGLE_ADS_CUSTOMER_ID || "";
  const adAccountRows = await sql`
    SELECT id FROM ad_accounts
    WHERE org_id = ${orgId} AND platform = 'google' AND account_id = ${customerId}
  `;
  let adAccountId: number | null = adAccountRows.length > 0 ? (adAccountRows[0].id as number) : null;
  if (!adAccountId) {
    const inserted = await sql`
      INSERT INTO ad_accounts (org_id, platform, account_id, account_name, created_by)
      VALUES (${orgId}, 'google', ${customerId}, ${'Google Ads ' + customerId}, ${userId})
      RETURNING id
    `;
    adAccountId = inserted[0]?.id as number;
  }

  const reservedCents = Math.max(totalBudgetCents - initialSpentCents, 0);
  const inserted = await sql`
    INSERT INTO campaigns
      (org_id, ad_account_id, platform, platform_campaign_id, campaign_name, channel,
       daily_budget, status, created_by, total_budget_cents, reserved_cents, spent_cents, closed)
    VALUES
      (${orgId}, ${adAccountId}, 'google', ${target.resourceName}, ${target.name}, ${target.channelType || "SEARCH"},
       ${0}, ${target.status || "PAUSED"}, ${userId},
       ${totalBudgetCents}, ${reservedCents}, ${initialSpentCents}, false)
    RETURNING id
  `;
  const campaignId = inserted[0].id as number;

  await attachReserveReference(sql, orgId, campaignId, reservedPlatformCents);

  logAudit({
    userId, userEmail,
    action: "google_ads.create_campaign",
    resourceType: "campaign",
    resourceId: campaignId,
    details: { sub_action: "import", name: target.name, channel: target.channelType, totalBudget, initialSpentCents },
    ipAddress: ip,
  });

  return NextResponse.json({
    success: true,
    campaignId,
    name: target.name,
    channel: target.channelType,
    initialSpentCents,
    totalBudgetCents,
  });
}
