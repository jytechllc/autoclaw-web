import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

const CRON_SECRET = process.env.CRON_SECRET;

/**
 * Daily cleanup — consolidates all data hygiene tasks.
 * Runs daily at 3:30 AM via GitHub Actions.
 *
 * 1. chat_messages  — retain 180 days
 * 2. agent_reports   — retain 90 days
 * 3. x_posts         — remove failed/cancelled posts older than 30 days
 * 4. generated_videos — remove failed videos older than 14 days
 * 5. kb_chunks        — orphaned chunks (no parent document)
 * 6. contacts         — remove hard-bounced contacts older than 90 days
 */
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  if (CRON_SECRET && authHeader !== `Bearer ${CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sql = getDb();
  const results: Record<string, number> = {};

  // 1. Chat messages — 180 days retention
  const chatCutoff = new Date(Date.now() - 180 * 24 * 60 * 60 * 1000).toISOString();
  const chatDeleted = await sql`
    DELETE FROM chat_messages
    WHERE created_at < ${chatCutoff}
    RETURNING id
  `;
  results.chat_messages_deleted = chatDeleted.length;

  // 2. Agent reports — 90 days retention
  const reportCutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
  const reportsDeleted = await sql`
    DELETE FROM agent_reports
    WHERE created_at < ${reportCutoff}
    RETURNING id
  `;
  results.agent_reports_deleted = reportsDeleted.length;

  // 3. Failed/cancelled x_posts — 30 days
  const postCutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  try {
    const postsDeleted = await sql`
      DELETE FROM x_posts
      WHERE status IN ('failed', 'cancelled')
        AND created_at < ${postCutoff}
      RETURNING id
    `;
    results.x_posts_failed_deleted = postsDeleted.length;
  } catch {
    results.x_posts_failed_deleted = -1; // table may not exist
  }

  // 4. Failed generated_videos — 14 days
  const videoCutoff = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
  try {
    const videosDeleted = await sql`
      DELETE FROM generated_videos
      WHERE status = 'failed'
        AND created_at < ${videoCutoff}
      RETURNING id
    `;
    results.generated_videos_failed_deleted = videosDeleted.length;
  } catch {
    results.generated_videos_failed_deleted = -1;
  }

  // 5. Orphaned kb_chunks (parent document deleted)
  try {
    const orphanedChunks = await sql`
      DELETE FROM kb_chunks
      WHERE document_id NOT IN (SELECT id FROM kb_documents)
      RETURNING id
    `;
    results.orphaned_kb_chunks_deleted = orphanedChunks.length;
  } catch {
    results.orphaned_kb_chunks_deleted = -1;
  }

  // 6. Hard-bounced contacts — 90 days
  const bounceCutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
  try {
    const bouncedDeleted = await sql`
      DELETE FROM contacts
      WHERE hard_bounces > 3
        AND created_at < ${bounceCutoff}
      RETURNING id
    `;
    results.hard_bounced_contacts_deleted = bouncedDeleted.length;
  } catch {
    results.hard_bounced_contacts_deleted = -1;
  }

  return NextResponse.json({
    ok: true,
    timestamp: new Date().toISOString(),
    retention: {
      chat_messages_days: 180,
      agent_reports_days: 90,
      failed_posts_days: 30,
      failed_videos_days: 14,
      hard_bounce_threshold: 3,
    },
    results,
  });
}
