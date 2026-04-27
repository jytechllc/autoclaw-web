import { getDb } from "@/lib/db";

export const YOUTUBE_SCOPES = [
  "https://www.googleapis.com/auth/youtube.readonly",
  "https://www.googleapis.com/auth/youtube.upload",
  "https://www.googleapis.com/auth/yt-analytics.readonly",
].join(" ");

export function getYouTubeAuthUrl(origin: string, state: string): string {
  const clientId = process.env.GOOGLE_CLIENT_ID || "";
  const redirectUri = `${origin}/api/youtube/callback`;
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: YOUTUBE_SCOPES,
    access_type: "offline",
    prompt: "consent",
    state,
    include_granted_scopes: "true",
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

export async function ensureYouTubeTables() {
  const sql = getDb();
  await sql`
    CREATE TABLE IF NOT EXISTS youtube_tokens (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE UNIQUE,
      channel_id VARCHAR(255),
      channel_title VARCHAR(255),
      access_token TEXT NOT NULL,
      refresh_token TEXT,
      expires_at TIMESTAMP NOT NULL,
      scope TEXT,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS youtube_uploads (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      title VARCHAR(500) NOT NULL,
      description TEXT,
      tags TEXT[] DEFAULT '{}',
      category_id VARCHAR(10) DEFAULT '22',
      privacy_status VARCHAR(20) DEFAULT 'public',
      publish_at TIMESTAMP,
      video_url TEXT NOT NULL,
      status VARCHAR(20) DEFAULT 'pending',
      youtube_video_id VARCHAR(50),
      error TEXT,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )
  `;
}

export interface YouTubeAccessToken {
  accessToken: string;
  channelId: string | null;
  channelTitle: string | null;
}

export async function getValidAccessToken(userId: number): Promise<YouTubeAccessToken | null> {
  const sql = getDb();
  const rows = await sql`SELECT * FROM youtube_tokens WHERE user_id = ${userId} LIMIT 1`;
  if (rows.length === 0) return null;
  const row = rows[0];

  // 5-minute buffer
  if (new Date(row.expires_at) > new Date(Date.now() + 5 * 60 * 1000)) {
    return {
      accessToken: row.access_token,
      channelId: row.channel_id,
      channelTitle: row.channel_title,
    };
  }

  if (!row.refresh_token) return null;
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: row.refresh_token,
      grant_type: "refresh_token",
    }),
  });
  const data = await res.json();
  if (!data.access_token) return null;

  const expiresAt = new Date(Date.now() + (data.expires_in || 3600) * 1000);
  await sql`
    UPDATE youtube_tokens
    SET access_token = ${data.access_token},
        expires_at = ${expiresAt},
        updated_at = NOW()
    WHERE user_id = ${userId}
  `;
  return {
    accessToken: data.access_token,
    channelId: row.channel_id,
    channelTitle: row.channel_title,
  };
}

export interface ChannelInfo {
  id: string;
  title: string;
  description: string;
  thumbnailUrl: string;
  subscriberCount: number;
  viewCount: number;
  videoCount: number;
}

export async function fetchChannelInfo(accessToken: string): Promise<ChannelInfo | null> {
  const res = await fetch(
    "https://www.googleapis.com/youtube/v3/channels?mine=true&part=snippet,statistics",
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  const data = await res.json();
  const item = data?.items?.[0];
  if (!item) return null;
  return {
    id: item.id,
    title: item.snippet?.title || "",
    description: item.snippet?.description || "",
    thumbnailUrl: item.snippet?.thumbnails?.medium?.url || item.snippet?.thumbnails?.default?.url || "",
    subscriberCount: parseInt(item.statistics?.subscriberCount || "0", 10),
    viewCount: parseInt(item.statistics?.viewCount || "0", 10),
    videoCount: parseInt(item.statistics?.videoCount || "0", 10),
  };
}
