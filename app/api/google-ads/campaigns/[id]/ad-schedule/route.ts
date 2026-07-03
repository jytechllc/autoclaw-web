import { NextRequest, NextResponse } from "next/server";
import { auth0 } from "@/lib/auth0";
import { getDb } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { checkRateLimit } from "@/lib/rate-limit";
import {
  setCampaignAdSchedule,
  channelSupportsAdSchedule,
  AD_SCHEDULE_DAYS,
  type AdScheduleDay,
  type AdScheduleInput,
} from "@/lib/google-ads";
import { resolveOrgId } from "@/lib/credits";
import { isReadOnlyUserId } from "@/lib/roles-server";

export const dynamic = "force-dynamic";

function getIp(req: NextRequest): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}

/** POST — replace the campaign's ad schedule (day parting).
 *  Body: { schedules: Array<{ dayOfWeek, startHour, endHour }>, orgId? }
 *  Empty schedules array = run at all times. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ip = getIp(req);
  if (!checkRateLimit(ip, { limit: 30, windowMs: 60_000 })) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }
  const session = await auth0.getSession();
  if (!session?.user?.email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const campaignId = Number(id);
  if (!Number.isFinite(campaignId)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

  const body = await req.json().catch(() => ({}));
  const rawSchedules = Array.isArray(body.schedules) ? body.schedules : null;
  if (!rawSchedules) {
    return NextResponse.json({ error: "schedules array is required (empty = run at all times)" }, { status: 400 });
  }
  const schedules: AdScheduleInput[] = rawSchedules.map((s: unknown) => {
    const obj = (s && typeof s === "object" ? s : {}) as { dayOfWeek?: unknown; startHour?: unknown; endHour?: unknown };
    return {
      dayOfWeek: String(obj.dayOfWeek || "").toUpperCase() as AdScheduleDay,
      startHour: Number(obj.startHour),
      endHour: Number(obj.endHour),
    };
  });
  if (schedules.some((s) => !AD_SCHEDULE_DAYS.includes(s.dayOfWeek))) {
    return NextResponse.json({ error: `dayOfWeek must be one of: ${AD_SCHEDULE_DAYS.join(", ")}` }, { status: 400 });
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
    SELECT platform_campaign_id, channel, closed FROM campaigns
    WHERE id = ${campaignId} AND org_id = ${orgId} AND platform = 'google'
  `;
  if (rows.length === 0) return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
  if (rows[0].closed) return NextResponse.json({ error: "Campaign is closed" }, { status: 409 });
  if (!channelSupportsAdSchedule(String(rows[0].channel || ""))) {
    return NextResponse.json(
      { error: `Ad schedules are not supported for ${rows[0].channel || "this"} campaigns` },
      { status: 400 }
    );
  }

  const result = await setCampaignAdSchedule(rows[0].platform_campaign_id as string, schedules);
  if (!result.success) {
    return NextResponse.json({ error: "Failed to update ad schedule", details: result.error }, { status: 502 });
  }

  logAudit({
    userId, userEmail,
    action: "google_ads.create_campaign",
    resourceType: "ad_schedule", resourceId: campaignId,
    details: { sub_action: "set_ad_schedule", intervals: schedules.length },
    ipAddress: ip,
  });

  return NextResponse.json({ success: true, intervals: schedules.length });
}
