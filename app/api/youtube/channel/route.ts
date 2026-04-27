import { NextRequest, NextResponse } from "next/server";
import { auth0 } from "@/lib/auth0";
import { getDb } from "@/lib/db";
import { ensureYouTubeTables, fetchChannelInfo, getValidAccessToken, getYouTubeAuthUrl } from "@/lib/youtube";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const session = await auth0.getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  await ensureYouTubeTables();
  const sql = getDb();
  const users = await sql`SELECT id FROM users WHERE auth0_id = ${session.user.sub} LIMIT 1`;
  if (users.length === 0) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }
  const userId = users[0].id;

  const tokenInfo = await getValidAccessToken(userId);
  const authConfigured = Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
  const authUrl = authConfigured
    ? getYouTubeAuthUrl(req.nextUrl.origin, "autoclaw-youtube")
    : null;

  if (!tokenInfo) {
    return NextResponse.json({ connected: false, authUrl, authConfigured });
  }

  const channel = await fetchChannelInfo(tokenInfo.accessToken);
  // Persist any updates to channel title (in case user renamed channel)
  if (channel) {
    await sql`
      UPDATE youtube_tokens
      SET channel_id = ${channel.id}, channel_title = ${channel.title}, updated_at = NOW()
      WHERE user_id = ${userId}
    `;
  }

  return NextResponse.json({
    connected: true,
    authUrl,
    channel,
  });
}

export async function DELETE() {
  const session = await auth0.getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const sql = getDb();
  const users = await sql`SELECT id FROM users WHERE auth0_id = ${session.user.sub} LIMIT 1`;
  if (users.length === 0) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }
  await sql`DELETE FROM youtube_tokens WHERE user_id = ${users[0].id}`;
  return NextResponse.json({ success: true });
}
