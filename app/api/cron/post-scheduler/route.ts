import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { decrypt } from "@/lib/crypto";
import { TwitterApi } from "twitter-api-v2";

export const dynamic = "force-dynamic";

const CRON_SECRET = process.env.CRON_SECRET;

async function getUserXCredentials(userId: number) {
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
    appKey: keyMap.twitter_api_key,
    appSecret: keyMap.twitter_api_secret,
    accessToken: keyMap.twitter_access_token,
    accessSecret: keyMap.twitter_access_token_secret,
  };
}

async function postTweet(creds: { appKey: string; appSecret: string; accessToken: string; accessSecret: string }, content: string, mediaUrl?: string | null) {
  const client = new TwitterApi(creds).readWrite;

  if (mediaUrl) {
    const mediaRes = await fetch(mediaUrl);
    if (mediaRes.ok) {
      const buf = Buffer.from(await mediaRes.arrayBuffer());
      const contentType = mediaRes.headers.get("content-type") || "image/jpeg";
      const mediaId = await client.v1.uploadMedia(buf, { mimeType: contentType as "image/jpeg" | "image/png" | "image/webp" });
      const result = await client.v2.tweet({ text: content, media: { media_ids: [mediaId] } });
      return result.data.id;
    }
  }

  const result = await client.v2.tweet(content);
  return result.data.id;
}

// GET: Process scheduled and recurring posts
export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization");
  if (!CRON_SECRET || auth !== `Bearer ${CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sql = getDb();
  const now = new Date().toISOString();
  let scheduledPosted = 0;
  let recurringPosted = 0;
  const errors: string[] = [];

  // 1. Process scheduled one-time posts
  try {
    const scheduledPosts = await sql`
      SELECT * FROM x_posts
      WHERE status = 'scheduled' AND scheduled_at <= ${now}
      ORDER BY scheduled_at ASC
      LIMIT 20
    `;

    for (const post of scheduledPosts) {
      try {
        const creds = await getUserXCredentials(post.user_id);
        if (!creds) {
          await sql`UPDATE x_posts SET status = 'failed', error = 'X API keys not configured' WHERE id = ${post.id}`;
          continue;
        }
        const tweetId = await postTweet(creds, post.content, post.media_url);
        await sql`UPDATE x_posts SET status = 'posted', tweet_id = ${tweetId}, posted_at = NOW() WHERE id = ${post.id}`;
        scheduledPosted++;
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        await sql`UPDATE x_posts SET status = 'failed', error = ${errMsg} WHERE id = ${post.id}`;
        errors.push(`scheduled#${post.id}: ${errMsg}`);
      }
    }
  } catch (err) {
    errors.push(`scheduled-query: ${err instanceof Error ? err.message : String(err)}`);
  }

  // 2. Process recurring tasks
  try {
    // Check if recurring tasks table exists
    const tableExists = await sql`
      SELECT 1 FROM information_schema.tables WHERE table_name = 'x_recurring_tasks' LIMIT 1
    `;
    if (tableExists.length > 0) {
      const recurringTasks = await sql`
        SELECT * FROM x_recurring_tasks
        WHERE status = 'active' AND next_post_at <= ${now}
        ORDER BY next_post_at ASC
        LIMIT 20
      `;

      for (const task of recurringTasks) {
        try {
          const creds = await getUserXCredentials(task.user_id);
          if (!creds) {
            errors.push(`recurring#${task.id}: X API keys not configured`);
            continue;
          }

          const tweetId = await postTweet(creds, task.content, task.media_url);

          // Calculate next post time
          const bestTimes: string[] = task.best_post_times || [];
          const postsPerWeek = task.posts_per_week || 3;
          const daysBetweenPosts = Math.max(1, Math.round(7 / postsPerWeek));

          const nextPost = new Date();
          nextPost.setDate(nextPost.getDate() + daysBetweenPosts);

          if (bestTimes.length > 0) {
            // Rotate through best times
            const lastPostedIdx = task.last_posted_at
              ? Math.floor((new Date(task.last_posted_at).getTime() / 86400000) % bestTimes.length)
              : 0;
            const nextTimeIdx = (lastPostedIdx + 1) % bestTimes.length;
            const timeStr = bestTimes[nextTimeIdx];
            const match = timeStr.match(/(\d+):(\d+)\s*(AM|PM)?/i);
            if (match) {
              let hours = parseInt(match[1]);
              const minutes = parseInt(match[2]);
              if (match[3]?.toUpperCase() === "PM" && hours !== 12) hours += 12;
              if (match[3]?.toUpperCase() === "AM" && hours === 12) hours = 0;
              nextPost.setHours(hours, minutes, 0, 0);
            }
          } else {
            nextPost.setHours(9, 0, 0, 0);
          }

          // Also save to x_posts for history
          await sql`
            INSERT INTO x_posts (user_id, content, media_url, tweet_id, status, posted_at)
            VALUES (${task.user_id}, ${task.content}, ${task.media_url || null}, ${tweetId}, 'posted', NOW())
          `;

          await sql`
            UPDATE x_recurring_tasks SET
              last_posted_at = NOW(),
              next_post_at = ${nextPost.toISOString()},
              updated_at = NOW()
            WHERE id = ${task.id}
          `;

          recurringPosted++;
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          errors.push(`recurring#${task.id}: ${errMsg}`);
        }
      }
    }
  } catch (err) {
    errors.push(`recurring-query: ${err instanceof Error ? err.message : String(err)}`);
  }

  return NextResponse.json({
    ok: true,
    scheduledPosted,
    recurringPosted,
    errors: errors.length > 0 ? errors : undefined,
  });
}
