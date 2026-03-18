import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

const CRON_SECRET = process.env.CRON_SECRET;
const BREVO_API_KEY = process.env.BREVO_API_KEY;
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://app.autoclaw.com";

/* ── retention windows (days) ─────────────────────────────── */
const RETENTION = {
  chat_messages: 180,
  agent_reports: 90,
  failed_posts: 30,
  failed_videos: 14,
  hard_bounce_contacts: 90,
} as const;

/* reminder offsets: how many days *before* deletion to warn */
const REMINDER_OFFSETS = [30, 7, 2] as const; // 30d, 7d, 48h

/* ── helpers ──────────────────────────────────────────────── */
const DAY_MS = 24 * 60 * 60 * 1000;

function cutoff(days: number) {
  return new Date(Date.now() - days * DAY_MS).toISOString();
}

async function sendBrevoEmail(to: string, subject: string, html: string) {
  if (!BREVO_API_KEY) return false;
  try {
    const res = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: { "api-key": BREVO_API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({
        sender: { name: "AutoClaw", email: "noreply@autoclaw.com" },
        to: [{ email: to }],
        subject,
        htmlContent: html,
      }),
    });
    return res.ok || res.status === 201;
  } catch {
    return false;
  }
}

/* ── email templates ──────────────────────────────────────── */
function buildReminderEmail(
  userName: string,
  daysLeft: number,
  items: { category: string; count: number; retentionDays: number }[],
) {
  const urgency =
    daysLeft <= 2 ? "#dc2626" : daysLeft <= 7 ? "#f59e0b" : "#3b82f6";
  const urgencyLabel =
    daysLeft <= 2 ? "URGENT" : daysLeft <= 7 ? "Reminder" : "Notice";

  const itemRows = items
    .map(
      (i) => `
      <tr>
        <td style="padding:8px 12px;border-bottom:1px solid #f3f4f6">${i.category}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #f3f4f6;text-align:center;font-weight:600">${i.count}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #f3f4f6;text-align:center">${i.retentionDays} days</td>
      </tr>`,
    )
    .join("");

  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f9fafb">
  <div style="max-width:600px;margin:0 auto;padding:20px">
    <div style="background:white;border-radius:8px;border:1px solid #e5e7eb;overflow:hidden">
      <!-- Header -->
      <div style="background:${urgency};padding:16px 24px;color:white">
        <h2 style="margin:0;font-size:18px">${urgencyLabel}: Data scheduled for deletion in ${daysLeft} day${daysLeft > 1 ? "s" : ""}</h2>
      </div>
      <!-- Body -->
      <div style="padding:24px">
        <p style="margin:0 0 16px;color:#374151">Hi ${userName || "there"},</p>
        <p style="margin:0 0 16px;color:#374151">
          The following data in your AutoClaw account has reached its retention period and will be
          <strong>permanently deleted in ${daysLeft} day${daysLeft > 1 ? "s" : ""}</strong>:
        </p>
        <table style="width:100%;border-collapse:collapse;margin:16px 0;font-size:14px">
          <thead>
            <tr style="background:#f9fafb">
              <th style="padding:8px 12px;text-align:left;border-bottom:2px solid #e5e7eb">Category</th>
              <th style="padding:8px 12px;text-align:center;border-bottom:2px solid #e5e7eb">Records</th>
              <th style="padding:8px 12px;text-align:center;border-bottom:2px solid #e5e7eb">Retention</th>
            </tr>
          </thead>
          <tbody>${itemRows}</tbody>
        </table>
        <p style="margin:16px 0;color:#374151">
          If you need to export or back up this data, please do so before the deletion date.
        </p>
        <a href="${APP_URL}/dashboard/settings"
           style="display:inline-block;background:#dc2626;color:white;padding:10px 20px;border-radius:6px;text-decoration:none;font-weight:500;font-size:14px">
          Review in Settings
        </a>
        <p style="margin:16px 0 0;color:#6b7280;font-size:13px">
          This is an automated message from AutoClaw's data retention policy.
          You can manage your data in <a href="${APP_URL}/dashboard/settings" style="color:#dc2626">Settings</a>.
        </p>
      </div>
    </div>
  </div>
</body>
</html>`;
}

/* ── main handler ─────────────────────────────────────────── */

/**
 * Daily cleanup — data hygiene + pre-deletion reminders.
 * Runs daily at 3:30 AM via GitHub Actions.
 *
 * Phase 1: Send email reminders at 30d / 7d / 48h before deletion
 * Phase 2: Delete data past retention window
 */
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  if (CRON_SECRET && authHeader !== `Bearer ${CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sql = getDb();
  const results: Record<string, number> = {};
  const reminders: Record<string, number> = {};

  /* ═══════════════════════════════════════════════════════════
   * PHASE 1 — Pre-deletion reminders (30d, 7d, 48h)
   * ═══════════════════════════════════════════════════════════ */
  for (const daysBeforeDeletion of REMINDER_OFFSETS) {
    // For each retention category, find users who have data that will be
    // deleted in exactly `daysBeforeDeletion` days (±12h window to avoid
    // duplicates since this runs daily)
    const windowStart = (days: number) =>
      new Date(Date.now() - (days - daysBeforeDeletion) * DAY_MS - 12 * 60 * 60 * 1000).toISOString();
    const windowEnd = (days: number) =>
      new Date(Date.now() - (days - daysBeforeDeletion) * DAY_MS + 12 * 60 * 60 * 1000).toISOString();

    // Collect per-user pending deletions across categories
    const userItems: Record<number, { email: string; name: string; items: { category: string; count: number; retentionDays: number }[] }> = {};

    // Chat messages approaching 180-day cutoff
    const chatRows = await sql`
      SELECT u.id as user_id, u.email, u.name, COUNT(*)::int as cnt
      FROM chat_messages cm
      JOIN users u ON cm.user_id = u.id
      WHERE cm.created_at BETWEEN ${windowStart(RETENTION.chat_messages)} AND ${windowEnd(RETENTION.chat_messages)}
      GROUP BY u.id, u.email, u.name
      HAVING COUNT(*) > 0
    `;
    for (const r of chatRows) {
      if (!userItems[r.user_id]) userItems[r.user_id] = { email: r.email, name: r.name || "", items: [] };
      userItems[r.user_id].items.push({ category: "Chat Messages", count: r.cnt, retentionDays: RETENTION.chat_messages });
    }

    // Agent reports approaching 90-day cutoff
    const reportRows = await sql`
      SELECT u.id as user_id, u.email, u.name, COUNT(*)::int as cnt
      FROM agent_reports ar
      JOIN projects p ON ar.project_id = p.id
      JOIN users u ON p.user_id = u.id
      WHERE ar.created_at BETWEEN ${windowStart(RETENTION.agent_reports)} AND ${windowEnd(RETENTION.agent_reports)}
      GROUP BY u.id, u.email, u.name
      HAVING COUNT(*) > 0
    `;
    for (const r of reportRows) {
      if (!userItems[r.user_id]) userItems[r.user_id] = { email: r.email, name: r.name || "", items: [] };
      userItems[r.user_id].items.push({ category: "Agent Reports", count: r.cnt, retentionDays: RETENTION.agent_reports });
    }

    // Hard-bounced contacts approaching 90-day cutoff
    try {
      const bounceRows = await sql`
        SELECT u.id as user_id, u.email, u.name, COUNT(*)::int as cnt
        FROM contacts c
        JOIN users u ON c.user_id = u.id
        WHERE c.hard_bounces > 3
          AND c.created_at BETWEEN ${windowStart(RETENTION.hard_bounce_contacts)} AND ${windowEnd(RETENTION.hard_bounce_contacts)}
        GROUP BY u.id, u.email, u.name
        HAVING COUNT(*) > 0
      `;
      for (const r of bounceRows) {
        if (!userItems[r.user_id]) userItems[r.user_id] = { email: r.email, name: r.name || "", items: [] };
        userItems[r.user_id].items.push({ category: "Hard-bounced Contacts", count: r.cnt, retentionDays: RETENTION.hard_bounce_contacts });
      }
    } catch { /* contacts table may not have hard_bounces column */ }

    // Send reminder emails
    let sentCount = 0;
    for (const [, user] of Object.entries(userItems)) {
      if (user.items.length === 0) continue;
      const subject = daysBeforeDeletion <= 2
        ? `⚠️ URGENT: Your AutoClaw data will be deleted in ${daysBeforeDeletion} days`
        : `AutoClaw: Data deletion reminder — ${daysBeforeDeletion} days remaining`;
      const html = buildReminderEmail(user.name, daysBeforeDeletion, user.items);
      const sent = await sendBrevoEmail(user.email, subject, html);
      if (sent) sentCount++;
    }
    reminders[`${daysBeforeDeletion}d_emails_sent`] = sentCount;
  }

  /* ═══════════════════════════════════════════════════════════
   * PHASE 2 — Actual deletion (past retention window)
   * ═══════════════════════════════════════════════════════════ */

  // 1. Chat messages — 180 days retention
  const chatDeleted = await sql`
    DELETE FROM chat_messages WHERE created_at < ${cutoff(RETENTION.chat_messages)} RETURNING id
  `;
  results.chat_messages_deleted = chatDeleted.length;

  // 2. Agent reports — 90 days retention
  const reportsDeleted = await sql`
    DELETE FROM agent_reports WHERE created_at < ${cutoff(RETENTION.agent_reports)} RETURNING id
  `;
  results.agent_reports_deleted = reportsDeleted.length;

  // 3. Failed/cancelled x_posts — 30 days
  try {
    const postsDeleted = await sql`
      DELETE FROM x_posts
      WHERE status IN ('failed', 'cancelled') AND created_at < ${cutoff(RETENTION.failed_posts)}
      RETURNING id
    `;
    results.x_posts_failed_deleted = postsDeleted.length;
  } catch {
    results.x_posts_failed_deleted = -1;
  }

  // 4. Failed generated_videos — 14 days
  try {
    const videosDeleted = await sql`
      DELETE FROM generated_videos
      WHERE status = 'failed' AND created_at < ${cutoff(RETENTION.failed_videos)}
      RETURNING id
    `;
    results.generated_videos_failed_deleted = videosDeleted.length;
  } catch {
    results.generated_videos_failed_deleted = -1;
  }

  // 5. Orphaned kb_chunks (parent document deleted)
  try {
    const orphanedChunks = await sql`
      DELETE FROM kb_chunks WHERE document_id NOT IN (SELECT id FROM kb_documents) RETURNING id
    `;
    results.orphaned_kb_chunks_deleted = orphanedChunks.length;
  } catch {
    results.orphaned_kb_chunks_deleted = -1;
  }

  // 6. Hard-bounced contacts — 90 days
  try {
    const bouncedDeleted = await sql`
      DELETE FROM contacts
      WHERE hard_bounces > 3 AND created_at < ${cutoff(RETENTION.hard_bounce_contacts)}
      RETURNING id
    `;
    results.hard_bounced_contacts_deleted = bouncedDeleted.length;
  } catch {
    results.hard_bounced_contacts_deleted = -1;
  }

  return NextResponse.json({
    ok: true,
    timestamp: new Date().toISOString(),
    retention: RETENTION,
    reminders,
    deletions: results,
  });
}
