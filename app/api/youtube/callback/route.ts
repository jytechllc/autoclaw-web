import { NextRequest, NextResponse } from "next/server";
import { auth0 } from "@/lib/auth0";
import { getDb } from "@/lib/db";
import { ensureYouTubeTables, fetchChannelInfo } from "@/lib/youtube";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  const error = req.nextUrl.searchParams.get("error");

  if (error) {
    return NextResponse.redirect(
      new URL(`/en/dashboard/youtube?youtube_error=${error}`, req.url)
    );
  }
  if (!code) {
    return NextResponse.redirect(
      new URL("/en/dashboard/youtube?youtube_error=no_code", req.url)
    );
  }

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return NextResponse.redirect(
      new URL("/en/dashboard/youtube?youtube_error=missing_config", req.url)
    );
  }

  try {
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        code,
        grant_type: "authorization_code",
        redirect_uri: `${req.nextUrl.origin}/api/youtube/callback`,
      }),
    });
    const tokenData = await tokenRes.json();

    if (!tokenData.access_token) {
      console.error("YouTube token error:", tokenData);
      return NextResponse.redirect(
        new URL(
          `/en/dashboard/youtube?youtube_error=${tokenData.error || "token_failed"}`,
          req.url
        )
      );
    }

    const session = await auth0.getSession();
    if (!session) {
      return NextResponse.redirect(
        new URL("/en/dashboard/youtube?youtube_error=no_session", req.url)
      );
    }

    await ensureYouTubeTables();
    const sql = getDb();
    const users = await sql`SELECT id FROM users WHERE auth0_id = ${session.user.sub} LIMIT 1`;
    if (users.length === 0) {
      return NextResponse.redirect(
        new URL("/en/dashboard/youtube?youtube_error=no_user", req.url)
      );
    }
    const userId = users[0].id;

    const channel = await fetchChannelInfo(tokenData.access_token);
    const expiresAt = new Date(Date.now() + (tokenData.expires_in || 3600) * 1000);

    await sql`
      INSERT INTO youtube_tokens
        (user_id, channel_id, channel_title, access_token, refresh_token, expires_at, scope)
      VALUES
        (${userId}, ${channel?.id || null}, ${channel?.title || null},
         ${tokenData.access_token}, ${tokenData.refresh_token || null},
         ${expiresAt}, ${tokenData.scope || ""})
      ON CONFLICT (user_id) DO UPDATE SET
        channel_id = EXCLUDED.channel_id,
        channel_title = EXCLUDED.channel_title,
        access_token = EXCLUDED.access_token,
        refresh_token = COALESCE(EXCLUDED.refresh_token, youtube_tokens.refresh_token),
        expires_at = EXCLUDED.expires_at,
        scope = EXCLUDED.scope,
        updated_at = NOW()
    `;

    return NextResponse.redirect(
      new URL("/en/dashboard/youtube?youtube_success=true", req.url)
    );
  } catch (err) {
    console.error("YouTube callback error:", err);
    return NextResponse.redirect(
      new URL("/en/dashboard/youtube?youtube_error=server_error", req.url)
    );
  }
}
