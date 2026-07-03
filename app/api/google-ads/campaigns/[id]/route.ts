import { NextRequest, NextResponse } from "next/server";
import { auth0 } from "@/lib/auth0";
import { getDb } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { checkRateLimit } from "@/lib/rate-limit";
import { setCampaignStatus, fetchCampaignDetail, renameCampaign, setCampaignDailyBudget, setCampaignSchedule, adsSearchStream } from "@/lib/google-ads";
import { isReadOnlyUserId } from "@/lib/roles-server";
import { resolveOrgId, releaseReserve, reserveForCampaign, applyPlatformMarkup, InsufficientCreditsError } from "@/lib/credits";

export const dynamic = "force-dynamic";

function getIp(req: NextRequest): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!checkRateLimit(getIp(req), { limit: 60, windowMs: 60_000 })) {
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

  const sql = getDb();
  const users = await sql`SELECT id FROM users WHERE email = ${session.user.email as string}`;
  if (users.length === 0) return NextResponse.json({ error: "User not found" }, { status: 404 });
  const userId = users[0].id as number;

  const requestedOrgId = req.nextUrl.searchParams.get("org_id");
  const orgId = await resolveOrgId(sql, userId, requestedOrgId ? Number(requestedOrgId) : undefined);
  if (!orgId) return NextResponse.json({ error: "No organization found" }, { status: 400 });

  const rows = await sql`
    SELECT c.id, c.platform_campaign_id, c.campaign_name, c.channel, c.daily_budget, c.currency, c.status,
           c.total_budget_cents, c.reserved_cents, c.spent_cents, c.closed, c.created_at, c.updated_at,
           c.project_id, p.name AS project_name, p.website AS project_website
    FROM campaigns c
    LEFT JOIN projects p ON p.id = c.project_id
    WHERE c.id = ${campaignId} AND c.org_id = ${orgId} AND c.platform = 'google'
  `;
  if (rows.length === 0) return NextResponse.json({ error: "Campaign not found" }, { status: 404 });

  let detail = null;
  let detailError = null;
  try {
    detail = await fetchCampaignDetail(rows[0].platform_campaign_id as string);
  } catch (e) {
    detailError = e instanceof Error ? e.message : String(e);
  }

  const customerId = process.env.GOOGLE_ADS_CUSTOMER_ID || "";
  const campaignNumericId = String(rows[0].platform_campaign_id || "").split("/").pop() || "";
  const googleAdsUrl = customerId && campaignNumericId
    ? `https://ads.google.com/aw/campaigns?__c=${customerId}&campaignId=${campaignNumericId}`
    : null;

  return NextResponse.json({ campaign: rows[0], detail, detailError, googleAdsUrl });
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
  const action = String(body.action || "");
  const validActions = ["pause", "enable", "close", "rename", "set_total_budget", "set_daily_budget", "set_schedule", "set_project"];
  if (!validActions.includes(action)) {
    return NextResponse.json({ error: `action must be one of: ${validActions.join(", ")}` }, { status: 400 });
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

  // Look up the campaign — must belong to the requesting org
  const rows = await sql`
    SELECT id, platform_campaign_id, campaign_name, status, total_budget_cents, spent_cents, reserved_cents, closed
    FROM campaigns
    WHERE id = ${campaignId} AND org_id = ${orgId} AND platform = 'google'
  `;
  if (rows.length === 0) return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
  const c = rows[0];

  const orgPlanRow = await sql`SELECT plan FROM organizations WHERE id = ${orgId}`;
  const orgPlan = (orgPlanRow[0]?.plan as string | null | undefined) ?? null;

  if (c.closed) {
    return NextResponse.json({ error: "Campaign already closed" }, { status: 409 });
  }

  if (action === "rename") {
    const newName = String(body.name || "").trim();
    if (!newName) return NextResponse.json({ error: "name is required" }, { status: 400 });
    if (newName.length > 255) return NextResponse.json({ error: "name too long (max 255)" }, { status: 400 });

    const result = await renameCampaign(c.platform_campaign_id as string, newName);
    if (!result.success) {
      return NextResponse.json({ error: "Google Ads rename failed", details: result.error }, { status: 502 });
    }
    await sql`UPDATE campaigns SET campaign_name = ${newName}, updated_at = NOW() WHERE id = ${campaignId}`;
    logAudit({
      userId, userEmail,
      action: "google_ads.create_campaign",
      resourceType: "campaign", resourceId: campaignId,
      details: { sub_action: "rename", oldName: c.campaign_name, newName }, ipAddress: ip,
    });
    return NextResponse.json({ success: true, name: newName });
  }

  if (action === "set_total_budget") {
    // DB-only: adjust the AutoClaw cap. Reserve more from balance OR release back.
    const newTotalBudget = Number(body.totalBudget);
    if (!Number.isFinite(newTotalBudget) || newTotalBudget <= 0) {
      return NextResponse.json({ error: "totalBudget must be > 0" }, { status: 400 });
    }
    const newCapCents = Math.round(newTotalBudget * 100);
    const currentCapCents = Number(c.total_budget_cents || 0);
    const spentCents = Number(c.spent_cents || 0);
    if (newCapCents < spentCents) {
      return NextResponse.json({
        error: "New cap is below already-spent amount",
        spentCents, newCapCents,
      }, { status: 400 });
    }
    const delta = newCapCents - currentCapCents;
    if (delta > 0) {
      // Reserve more (pool side is markup of Google-side delta)
      try {
        await reserveForCampaign(sql, orgId, applyPlatformMarkup(delta, orgPlan), c.campaign_name as string);
      } catch (e) {
        if (e instanceof InsufficientCreditsError) {
          return NextResponse.json({
            error: "Insufficient credits to raise the cap.",
            balanceCents: e.balanceCents,
            requestedCents: e.requestedCents,
          }, { status: 402 });
        }
        return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
      }
    } else if (delta < 0) {
      // Release some back to balance (markup of the Google-side reduction)
      await releaseReserve(sql, orgId, applyPlatformMarkup(-delta, orgPlan), campaignId, `Lower cap for ${c.campaign_name}`);
    }
    const newReserved = Math.max(newCapCents - spentCents, 0);
    await sql`
      UPDATE campaigns
      SET total_budget_cents = ${newCapCents}, reserved_cents = ${newReserved}, updated_at = NOW()
      WHERE id = ${campaignId}
    `;

    // Hard limit safeguard: ensure Google's daily budget can't possibly exceed the new total cap.
    // implied_daily = remaining_cap / remaining_days. If current daily > implied, push it down on Google.
    let dailyAdjusted: { from: number; to: number } | null = null;
    try {
      type EndRow = { campaign: { endDate?: string } };
      const endRows = await adsSearchStream(
        process.env.GOOGLE_ADS_CUSTOMER_ID || "",
        `SELECT campaign.end_date FROM campaign WHERE campaign.id = ${(c.platform_campaign_id as string).split("/").pop()}`
      ) as EndRow[];
      const endDateStr = endRows[0]?.campaign?.endDate;
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const endDate = endDateStr ? new Date(endDateStr) : new Date(today.getTime() + 30 * 86_400_000);
      const remainingDays = Math.max(Math.ceil((endDate.getTime() - today.getTime()) / 86_400_000), 1);
      const remainingCapCents = Math.max(newCapCents - spentCents, 0);
      const impliedDaily = remainingCapCents / 100 / remainingDays;
      const currentDaily = Number(c.daily_budget || 0);
      // Floor at 1¢ — Google rejects 0; tiny budget signals "all but stopped" without violating API constraints.
      const newDaily = Math.max(Math.round(impliedDaily * 100) / 100, 0.01);
      if (currentDaily > impliedDaily && newDaily < currentDaily) {
        const result = await setCampaignDailyBudget(c.platform_campaign_id as string, newDaily);
        if (result.success) {
          await sql`UPDATE campaigns SET daily_budget = ${newDaily}, updated_at = NOW() WHERE id = ${campaignId}`;
          dailyAdjusted = { from: currentDaily, to: newDaily };
        }
      }
    } catch {
      // Safeguard is best-effort — surface but don't fail the cap update.
    }

    logAudit({
      userId, userEmail,
      action: "google_ads.create_campaign",
      resourceType: "campaign", resourceId: campaignId,
      details: { sub_action: "set_total_budget", oldCap: currentCapCents, newCap: newCapCents, delta, dailyAdjusted },
      ipAddress: ip,
    });
    return NextResponse.json({ success: true, totalBudgetCents: newCapCents, reservedCents: newReserved, dailyAdjusted });
  }

  if (action === "set_daily_budget") {
    const newDailyBudget = Number(body.dailyBudget);
    if (!Number.isFinite(newDailyBudget) || newDailyBudget <= 0) {
      return NextResponse.json({ error: "dailyBudget must be > 0" }, { status: 400 });
    }
    const result = await setCampaignDailyBudget(c.platform_campaign_id as string, newDailyBudget);
    if (!result.success) {
      return NextResponse.json({ error: "Failed to update daily budget", details: result.error }, { status: 502 });
    }
    await sql`UPDATE campaigns SET daily_budget = ${newDailyBudget}, updated_at = NOW() WHERE id = ${campaignId}`;
    logAudit({
      userId, userEmail,
      action: "google_ads.create_campaign",
      resourceType: "campaign", resourceId: campaignId,
      details: { sub_action: "set_daily_budget", newDailyBudget },
      ipAddress: ip,
    });
    return NextResponse.json({ success: true, dailyBudget: newDailyBudget });
  }

  if (action === "set_schedule") {
    const startDate = body.startDate ? String(body.startDate) : null;
    const endDate = body.endDate ? String(body.endDate) : null;
    const datePattern = /^\d{4}-\d{2}-\d{2}$/;
    if (startDate !== null && !datePattern.test(startDate)) {
      return NextResponse.json({ error: "startDate must be YYYY-MM-DD" }, { status: 400 });
    }
    if (endDate !== null && !datePattern.test(endDate)) {
      return NextResponse.json({ error: "endDate must be YYYY-MM-DD" }, { status: 400 });
    }
    const result = await setCampaignSchedule(c.platform_campaign_id as string, startDate, endDate);
    if (!result.success) {
      return NextResponse.json({ error: "Failed to update schedule", details: result.error }, { status: 502 });
    }
    logAudit({
      userId, userEmail,
      action: "google_ads.create_campaign",
      resourceType: "campaign", resourceId: campaignId,
      details: { sub_action: "set_schedule", startDate, endDate },
      ipAddress: ip,
    });
    return NextResponse.json({ success: true, startDate, endDate });
  }

  if (action === "set_project") {
    // Reassign the campaign's owner project. null clears the assignment.
    const requestedProjectId = body.projectId === null ? null : Number(body.projectId);
    if (requestedProjectId !== null && (!Number.isFinite(requestedProjectId) || requestedProjectId <= 0)) {
      return NextResponse.json({ error: "projectId must be a positive integer or null" }, { status: 400 });
    }
    if (requestedProjectId !== null) {
      const projectRows = await sql`SELECT id FROM projects WHERE id = ${requestedProjectId} AND org_id = ${orgId}`;
      if (projectRows.length === 0) {
        return NextResponse.json({ error: "projectId does not belong to this organization" }, { status: 400 });
      }
    }
    await sql`UPDATE campaigns SET project_id = ${requestedProjectId}, updated_at = NOW() WHERE id = ${campaignId}`;
    logAudit({
      userId, userEmail,
      action: "google_ads.create_campaign",
      resourceType: "campaign", resourceId: campaignId,
      details: { sub_action: "set_project", projectId: requestedProjectId }, ipAddress: ip,
    });
    return NextResponse.json({ success: true, projectId: requestedProjectId });
  }

  if (action === "pause" || action === "enable") {
    const newStatus = action === "pause" ? "PAUSED" : "ENABLED";
    const result = await setCampaignStatus(c.platform_campaign_id as string, newStatus);
    if (!result.success) {
      return NextResponse.json({ error: "Google Ads update failed", details: result.error }, { status: 502 });
    }
    await sql`UPDATE campaigns SET status = ${newStatus}, updated_at = NOW() WHERE id = ${campaignId}`;
    logAudit({
      userId, userEmail,
      action: "google_ads.create_campaign",
      resourceType: "campaign", resourceId: campaignId,
      details: { sub_action: action, newStatus }, ipAddress: ip,
    });
    return NextResponse.json({ success: true, status: newStatus });
  }

  // action === "close": pause in Google Ads + mark closed + release unspent reserve
  const pauseRes = await setCampaignStatus(c.platform_campaign_id as string, "PAUSED");
  if (!pauseRes.success) {
    return NextResponse.json({ error: "Google Ads pause failed", details: pauseRes.error }, { status: 502 });
  }

  const reserved = Number(c.reserved_cents || 0);
  if (reserved > 0) {
    await releaseReserve(sql, orgId, applyPlatformMarkup(reserved, orgPlan), campaignId, `Closed: ${c.campaign_name}`);
  }
  await sql`
    UPDATE campaigns SET status = 'PAUSED', closed = true, reserved_cents = 0, updated_at = NOW()
    WHERE id = ${campaignId}
  `;
  logAudit({
    userId, userEmail,
    action: "google_ads.release",
    resourceType: "campaign", resourceId: campaignId,
    details: { releasedCents: reserved, name: c.campaign_name }, ipAddress: ip,
  });

  return NextResponse.json({ success: true, closed: true, releasedCents: reserved });
}
