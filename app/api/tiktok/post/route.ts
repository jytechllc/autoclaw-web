import { NextRequest, NextResponse } from "next/server";
import { auth0 } from "@/lib/auth0";
import { getDb } from "@/lib/db";
import { checkRateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

function getIp(req: NextRequest): string {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown"
  );
}

async function refreshTokenIfNeeded(
  userId: number
): Promise<{ accessToken: string; openId: string } | null> {
  const sql = getDb();
  const tokens = await sql`
    SELECT * FROM tiktok_tokens WHERE user_id = ${userId} LIMIT 1
  `;

  if (tokens.length === 0) return null;

  const token = tokens[0];

  // If token is still valid (with 5 min buffer), use it
  if (new Date(token.expires_at) > new Date(Date.now() + 5 * 60 * 1000)) {
    return { accessToken: token.access_token, openId: token.open_id };
  }

  // Refresh the token
  const clientKey = process.env.TIKTOK_CLIENT_KEY;
  const clientSecret = process.env.TIKTOK_CLIENT_SECRET;
  if (!clientKey || !clientSecret) return null;

  const res = await fetch("https://open.tiktokapis.com/v2/oauth/token/", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_key: clientKey,
      client_secret: clientSecret,
      grant_type: "refresh_token",
      refresh_token: token.refresh_token,
    }),
  });

  const data = await res.json();
  if (!data.access_token) return null;

  const expiresAt = new Date(Date.now() + data.expires_in * 1000);
  const refreshExpiresAt = new Date(
    Date.now() + data.refresh_expires_in * 1000
  );

  await sql`
    UPDATE tiktok_tokens SET
      access_token = ${data.access_token},
      refresh_token = ${data.refresh_token},
      expires_at = ${expiresAt},
      refresh_expires_at = ${refreshExpiresAt},
      updated_at = NOW()
    WHERE user_id = ${userId}
  `;

  return { accessToken: data.access_token, openId: token.open_id };
}

// POST: Publish a video to TikTok
export async function POST(req: NextRequest) {
  const ip = getIp(req);
  const allowed = checkRateLimit(ip, { limit: 10, windowMs: 60000 });
  if (!allowed) {
    return NextResponse.json({ error: "Rate limited" }, { status: 429 });
  }

  const session = await auth0.getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sql = getDb();
  const sub = session.user.sub;
  const users =
    await sql`SELECT id, role FROM users WHERE auth0_id = ${sub} LIMIT 1`;

  if (users.length === 0) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  const user = users[0];
  if (user.role !== "admin") {
    return NextResponse.json({ error: "Admin only" }, { status: 403 });
  }

  const body = await req.json();
  const { title, videoUrl, privacyLevel = "SELF_ONLY" } = body;

  if (!title || !videoUrl) {
    return NextResponse.json(
      { error: "title and videoUrl are required" },
      { status: 400 }
    );
  }

  const tokenInfo = await refreshTokenIfNeeded(user.id);
  if (!tokenInfo) {
    return NextResponse.json(
      {
        error: "TikTok not connected. Please authorize first.",
        authUrl: getTikTokAuthUrl(req),
      },
      { status: 400 }
    );
  }

  try {
    // Use PULL_FROM_URL to publish video from a public URL
    const initRes = await fetch(
      "https://open.tiktokapis.com/v2/post/publish/video/init/",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${tokenInfo.accessToken}`,
          "Content-Type": "application/json; charset=UTF-8",
        },
        body: JSON.stringify({
          post_info: {
            title,
            privacy_level: "SELF_ONLY",
            disable_duet: false,
            disable_comment: false,
            disable_stitch: false,
            brand_content_toggle: false,
            brand_organic_toggle: false,
          },
          source_info: {
            source: "PULL_FROM_URL",
            video_url: videoUrl,
          },
        }),
      }
    );

    const initData = await initRes.json();
    if (initData.error?.code && initData.error.code !== "ok") {
      return NextResponse.json(
        { error: "TikTok API error", details: initData.error },
        { status: 502 }
      );
    }

    return NextResponse.json({
      success: true,
      publishId: initData.data?.publish_id,
      message: "Video submitted to TikTok for processing",
    });
  } catch (err) {
    console.error("TikTok post error:", err);
    return NextResponse.json(
      { error: "Failed to post to TikTok" },
      { status: 500 }
    );
  }
}

// GET: Check TikTok connection status
export async function GET(req: NextRequest) {
  const session = await auth0.getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sql = getDb();
  const sub = session.user.sub;
  const users =
    await sql`SELECT id FROM users WHERE auth0_id = ${sub} LIMIT 1`;

  if (users.length === 0) {
    return NextResponse.json({ connected: false });
  }

  try {
    const tokens = await sql`
      SELECT open_id, expires_at, scope, updated_at FROM tiktok_tokens WHERE user_id = ${users[0].id} LIMIT 1
    `;

    if (tokens.length === 0) {
      return NextResponse.json({
        connected: false,
        authUrl: getTikTokAuthUrl(req),
      });
    }

    return NextResponse.json({
      connected: true,
      openId: tokens[0].open_id,
      expiresAt: tokens[0].expires_at,
      scope: tokens[0].scope,
    });
  } catch {
    // Table might not exist yet
    return NextResponse.json({
      connected: false,
      authUrl: getTikTokAuthUrl(req),
    });
  }
}

function getTikTokAuthUrl(req: NextRequest): string {
  const clientKey = process.env.TIKTOK_CLIENT_KEY || "";
  const redirectUri = `${req.nextUrl.origin}/api/tiktok/callback`;
  const scope = "user.info.basic,video.publish,video.upload";
  return `https://www.tiktok.com/v2/auth/authorize/?client_key=${clientKey}&scope=${scope}&response_type=code&redirect_uri=${encodeURIComponent(redirectUri)}&state=xpilot`;
}
