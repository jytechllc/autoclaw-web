import { NextRequest, NextResponse } from "next/server";
import { auth0 } from "@/lib/auth0";
import { getDb } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { checkRateLimit } from "@/lib/rate-limit";
import {
  setCampaignDeviceModifiers,
  channelSupportsDeviceModifiers,
  DEVICE_TYPES,
  type DeviceType,
  type DeviceModifierInput,
} from "@/lib/google-ads";
import { resolveOrgId } from "@/lib/credits";
import { isReadOnlyUserId } from "@/lib/roles-server";

export const dynamic = "force-dynamic";

function getIp(req: NextRequest): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}

/** POST — replace the campaign's device bid adjustments.
 *  Body: { modifiers: Array<{ device, percent, exclude? }>, orgId? }
 *  Empty modifiers array = default bids on all devices. */
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
  const rawModifiers = Array.isArray(body.modifiers) ? body.modifiers : null;
  if (!rawModifiers) {
    return NextResponse.json({ error: "modifiers array is required (empty = default bids)" }, { status: 400 });
  }
  const modifiers: DeviceModifierInput[] = rawModifiers.map((m: unknown) => {
    const obj = (m && typeof m === "object" ? m : {}) as { device?: unknown; percent?: unknown; exclude?: unknown };
    return {
      device: String(obj.device || "").toUpperCase() as DeviceType,
      percent: Number(obj.percent ?? 0),
      exclude: Boolean(obj.exclude),
    };
  });
  if (modifiers.some((m) => !DEVICE_TYPES.includes(m.device))) {
    return NextResponse.json({ error: `device must be one of: ${DEVICE_TYPES.join(", ")}` }, { status: 400 });
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
  if (!channelSupportsDeviceModifiers(String(rows[0].channel || ""))) {
    return NextResponse.json(
      { error: `Device bid adjustments are not supported for ${rows[0].channel || "this"} campaigns` },
      { status: 400 }
    );
  }

  const result = await setCampaignDeviceModifiers(rows[0].platform_campaign_id as string, modifiers);
  if (!result.success) {
    return NextResponse.json({ error: "Failed to update device bid adjustments", details: result.error }, { status: 502 });
  }

  logAudit({
    userId, userEmail,
    action: "google_ads.create_campaign",
    resourceType: "device_modifier", resourceId: campaignId,
    details: {
      sub_action: "set_device_modifiers",
      modifiers: modifiers.map((m) => `${m.device}:${m.exclude ? "exclude" : `${m.percent}%`}`),
    },
    ipAddress: ip,
  });

  return NextResponse.json({ success: true });
}
