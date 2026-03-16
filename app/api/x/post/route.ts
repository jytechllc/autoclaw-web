import { NextRequest, NextResponse } from "next/server";
import { auth0 } from "@/lib/auth0";
import { getDb } from "@/lib/db";
import { checkRateLimit } from "@/lib/rate-limit";
import { decrypt } from "@/lib/crypto";
import { TwitterApi } from "twitter-api-v2";

export const dynamic = "force-dynamic";

function getIp(req: NextRequest): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}

interface XCredentials {
  apiKey: string;
  apiSecret: string;
  accessToken: string;
  accessTokenSecret: string;
}

async function getUserXCredentials(userId: number): Promise<XCredentials | null> {
  const sql = getDb();
  const keys = await sql`
    SELECT service, api_key FROM user_api_keys
    WHERE user_id = ${userId} AND service IN ('twitter_api_key', 'twitter_api_secret', 'twitter_access_token', 'twitter_access_token_secret')
  `;

  const keyMap: Record<string, string> = {};
  for (const k of keys) {
    keyMap[k.service] = decrypt(k.api_key);
  }

  if (!keyMap.twitter_api_key || !keyMap.twitter_api_secret || !keyMap.twitter_access_token || !keyMap.twitter_access_token_secret) {
    return null;
  }

  return {
    apiKey: keyMap.twitter_api_key,
    apiSecret: keyMap.twitter_api_secret,
    accessToken: keyMap.twitter_access_token,
    accessTokenSecret: keyMap.twitter_access_token_secret,
  };
}

function createXClient(creds: XCredentials) {
  return new TwitterApi({
    appKey: creds.apiKey,
    appSecret: creds.apiSecret,
    accessToken: creds.accessToken,
    accessSecret: creds.accessTokenSecret,
  });
}

async function ensureXPostsTable() {
  const sql = getDb();
  await sql`
    CREATE TABLE IF NOT EXISTS x_posts (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      content TEXT NOT NULL,
      media_url TEXT,
      tweet_id VARCHAR(255),
      status VARCHAR(50) DEFAULT 'draft',
      scheduled_at TIMESTAMP,
      posted_at TIMESTAMP,
      error TEXT,
      impressions INTEGER,
      likes INTEGER,
      retweets INTEGER,
      replies INTEGER,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )
  `;
}

// POST: Create and optionally post a tweet
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
  const users = await sql`SELECT id FROM users WHERE auth0_id = ${sub} LIMIT 1`;
  if (users.length === 0) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  const userId = users[0].id;
  const creds = await getUserXCredentials(userId);
  if (!creds) {
    return NextResponse.json(
      { error: "X (Twitter) API keys not configured. Add them in Settings." },
      { status: 400 }
    );
  }

  const body = await req.json();
  const { content, mediaUrl, postImmediately = true, scheduledAt } = body;

  if (!content || content.length === 0) {
    return NextResponse.json({ error: "content is required" }, { status: 400 });
  }

  if (content.length > 280) {
    return NextResponse.json({ error: "Tweet content exceeds 280 characters" }, { status: 400 });
  }

  await ensureXPostsTable();

  // If scheduling for later, just save to DB
  if (!postImmediately && scheduledAt) {
    await sql`
      INSERT INTO x_posts (user_id, content, media_url, status, scheduled_at)
      VALUES (${userId}, ${content}, ${mediaUrl || null}, 'scheduled', ${scheduledAt})
    `;
    return NextResponse.json({ success: true, message: "Post scheduled" });
  }

  // Post immediately
  try {
    const client = createXClient(creds);
    const rwClient = client.readWrite;
    let tweetId: string;

    if (mediaUrl) {
      // Download media and upload to Twitter
      const mediaRes = await fetch(mediaUrl);
      if (!mediaRes.ok) {
        return NextResponse.json({ error: "Failed to fetch media from URL" }, { status: 400 });
      }
      const mediaBuffer = Buffer.from(await mediaRes.arrayBuffer());
      const contentType = mediaRes.headers.get("content-type") || "image/jpeg";

      const mediaId = await rwClient.v1.uploadMedia(mediaBuffer, {
        mimeType: contentType as "image/jpeg" | "image/png" | "image/webp",
      });

      const result = await rwClient.v2.tweet({
        text: content,
        media: { media_ids: [mediaId] },
      });
      tweetId = result.data.id;
    } else {
      const result = await rwClient.v2.tweet(content);
      tweetId = result.data.id;
    }

    // Save to DB
    await sql`
      INSERT INTO x_posts (user_id, content, media_url, tweet_id, status, posted_at)
      VALUES (${userId}, ${content}, ${mediaUrl || null}, ${tweetId}, 'posted', NOW())
    `;

    return NextResponse.json({ success: true, tweetId });
  } catch (err) {
    console.error("X post error:", err);
    const errMsg = err instanceof Error ? err.message : "Failed to post tweet";

    // Save failed attempt
    try {
      await sql`
        INSERT INTO x_posts (user_id, content, media_url, status, error)
        VALUES (${userId}, ${content}, ${mediaUrl || null}, 'failed', ${errMsg})
      `;
    } catch (dbErr) {
      console.warn("Failed to save error record:", dbErr);
    }

    return NextResponse.json({ error: errMsg }, { status: 502 });
  }
}

// GET: Check connection status or list post history
export async function GET(req: NextRequest) {
  const session = await auth0.getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sql = getDb();
  const sub = session.user.sub;
  const users = await sql`SELECT id FROM users WHERE auth0_id = ${sub} LIMIT 1`;
  if (users.length === 0) {
    return NextResponse.json({ connected: false });
  }

  const userId = users[0].id;

  const creds = await getUserXCredentials(userId);

  // Fetch recent tweets from X timeline
  const recentTweets = req.nextUrl.searchParams.get("recentTweets");
  if (recentTweets === "true") {
    if (!creds) {
      return NextResponse.json({ error: "X API keys not configured" }, { status: 400 });
    }
    try {
      const client = createXClient(creds);
      const me = await client.v2.me();
      const timeline = await client.v2.userTimeline(me.data.id, {
        max_results: 10,
        "tweet.fields": ["created_at", "public_metrics", "entities"],
        "media.fields": ["url", "preview_image_url"],
        expansions: ["attachments.media_keys"],
      });

      const tweets = (timeline.data.data || []).map((tweet) => {
        const media = timeline.includes?.media?.filter((m) =>
          tweet.attachments?.media_keys?.includes(m.media_key)
        );
        return {
          id: tweet.id,
          text: tweet.text,
          createdAt: tweet.created_at,
          metrics: tweet.public_metrics,
          mediaUrl: media?.[0]?.url || media?.[0]?.preview_image_url || null,
        };
      });

      return NextResponse.json({ tweets });
    } catch (err) {
      console.error("X recent tweets error:", err);
      return NextResponse.json({ error: "Failed to fetch recent tweets" }, { status: 502 });
    }
  }

  // Check connection
  const listPosts = req.nextUrl.searchParams.get("listPosts");
  if (listPosts !== "true") {
    if (!creds) {
      return NextResponse.json({ connected: false });
    }

    try {
      const client = createXClient(creds);
      const me = await client.v2.me();
      return NextResponse.json({
        connected: true,
        username: me.data.username,
        name: me.data.name,
        id: me.data.id,
      });
    } catch (err) {
      console.error("X credential check error:", err);
      return NextResponse.json({ connected: false, error: "Invalid credentials" });
    }
  }

  // List post history
  await ensureXPostsTable();
  const posts = await sql`
    SELECT id, content, media_url, tweet_id, status, scheduled_at, posted_at, error, impressions, likes, retweets, replies, created_at
    FROM x_posts WHERE user_id = ${userId}
    ORDER BY created_at DESC LIMIT 50
  `;

  return NextResponse.json({ posts });
}

// DELETE: Delete a scheduled post
export async function DELETE(req: NextRequest) {
  const session = await auth0.getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sql = getDb();
  const sub = session.user.sub;
  const users = await sql`SELECT id FROM users WHERE auth0_id = ${sub} LIMIT 1`;
  if (users.length === 0) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  const body = await req.json();
  const { postId } = body;
  if (!postId) {
    return NextResponse.json({ error: "postId is required" }, { status: 400 });
  }

  await sql`
    DELETE FROM x_posts WHERE id = ${postId} AND user_id = ${users[0].id} AND status IN ('draft', 'scheduled')
  `;

  return NextResponse.json({ success: true });
}
