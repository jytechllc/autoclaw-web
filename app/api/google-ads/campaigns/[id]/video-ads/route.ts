import { NextRequest, NextResponse } from "next/server";
import { auth0 } from "@/lib/auth0";
import { getDb } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { checkRateLimit } from "@/lib/rate-limit";
import { createVideoAd, extractYouTubeVideoId } from "@/lib/google-ads";
import { resolveOrgId } from "@/lib/credits";
import { isReadOnlyUserId } from "@/lib/roles-server";

export const dynamic = "force-dynamic";

function getIp(req: NextRequest): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}

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
  const adGroupResourceName = String(body.adGroupResourceName || "").trim();
  const youtubeUrl = String(body.youtubeUrl || "").trim();
  const headlines: string[] = Array.isArray(body.headlines) ? body.headlines.map(String).filter(Boolean) : [];
  const longHeadline = String(body.longHeadline || "").trim();
  const descriptions: string[] = Array.isArray(body.descriptions) ? body.descriptions.map(String).filter(Boolean) : [];
  const callToAction = body.callToAction ? String(body.callToAction).trim() : undefined;
  const finalUrl = String(body.finalUrl || "").trim();

  if (!adGroupResourceName.startsWith("customers/")) {
    return NextResponse.json({ error: "Invalid adGroupResourceName" }, { status: 400 });
  }
  const videoId = extractYouTubeVideoId(youtubeUrl);
  if (!videoId) return NextResponse.json({ error: "Invalid YouTube URL — could not extract video ID" }, { status: 400 });
  if (!longHeadline) return NextResponse.json({ error: "longHeadline is required (max 90 chars)" }, { status: 400 });
  if (descriptions.length < 1) return NextResponse.json({ error: "At least 1 description required" }, { status: 400 });
  if (!finalUrl || !/^https?:\/\//i.test(finalUrl)) {
    return NextResponse.json({ error: "Final URL must start with http:// or https://" }, { status: 400 });
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
  if (rows[0].channel !== "VIDEO") {
    return NextResponse.json({ error: "Video ads can only be created for VIDEO channel campaigns" }, { status: 400 });
  }

  const campaignCustomer = String(rows[0].platform_campaign_id).split("/").slice(0, 2).join("/");
  if (!adGroupResourceName.startsWith(campaignCustomer)) {
    return NextResponse.json({ error: "Ad group does not belong to this campaign's customer" }, { status: 403 });
  }

  const result = await createVideoAd({
    adGroupResourceName,
    youtubeVideoId: videoId,
    headlines,
    longHeadline,
    descriptions,
    callToAction,
    finalUrl,
  });

  if (!result.resourceName) {
    return NextResponse.json({ error: "Failed to create video ad", details: result.error }, { status: 502 });
  }

  logAudit({
    userId, userEmail,
    action: "google_ads.create_campaign",
    resourceType: "video_ad", resourceId: campaignId,
    details: { sub_action: "create_video_ad", adGroup: adGroupResourceName, youtubeVideoId: videoId, resourceName: result.resourceName },
    ipAddress: ip,
  });

  return NextResponse.json({ success: true, resourceName: result.resourceName, youtubeVideoId: videoId });
}
