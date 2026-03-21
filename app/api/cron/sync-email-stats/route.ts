import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { decrypt } from "@/lib/crypto";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const CRON_SECRET = process.env.CRON_SECRET;

/**
 * Cron: Sync email engagement stats from Brevo and record daily metrics.
 * Runs daily — fetches open/click events and aggregates by day.
 */
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  if (CRON_SECRET && authHeader !== `Bearer ${CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sql = getDb();

  try {
    // Ensure table exists
    await sql`
      CREATE TABLE IF NOT EXISTS email_daily_stats (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id),
        project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
        stat_date DATE NOT NULL DEFAULT CURRENT_DATE,
        emails_sent INTEGER DEFAULT 0,
        emails_opened INTEGER DEFAULT 0,
        emails_clicked INTEGER DEFAULT 0,
        hard_bounces INTEGER DEFAULT 0,
        soft_bounces INTEGER DEFAULT 0,
        unique_opens INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(user_id, project_id, stat_date)
      )
    `;

    // Resolve Brevo API key: env → user BYOK → org BYOK
    let BREVO_API_KEY = process.env.BREVO_API_KEY || "";
    if (!BREVO_API_KEY) {
      const brevoRows = await sql`
        SELECT api_key FROM (
          SELECT api_key, 0 as p FROM user_api_keys WHERE service = 'brevo'
          UNION ALL
          SELECT api_key, 1 as p FROM org_api_keys WHERE service = 'brevo'
        ) combined ORDER BY p LIMIT 1
      `;
      if (brevoRows.length > 0) {
        try { BREVO_API_KEY = decrypt(brevoRows[0].api_key as string); } catch { /* skip */ }
      }
    }

    if (!BREVO_API_KEY) {
      return NextResponse.json({ error: "No Brevo API key found (env, user, or org)" }, { status: 500 });
    }

    // Get all users who have sent emails (via contacts table)
    const usersWithEmail = await sql`
      SELECT DISTINCT c.user_id, c.project_id
      FROM contacts c
      WHERE c.emails_sent > 0 OR c.brevo_id IS NOT NULL
    `;

    let totalSynced = 0;
    let totalErrors = 0;

    for (const row of usersWithEmail) {
      const userId = row.user_id as number;
      const projectId = row.project_id as number | null;

      try {
        // Get contacts for this user/project that need stat sync
        const contacts = await sql`
          SELECT id, email, brevo_id FROM contacts
          WHERE user_id = ${userId}
            AND (brevo_id IS NOT NULL OR source = 'brevo')
            AND emails_sent > 0
          ORDER BY stats_synced_at ASC NULLS FIRST
          LIMIT 50
        `;

        // Daily aggregation counters
        const dailyStats: Record<string, { sent: number; opened: number; clicked: number; hardBounce: number; softBounce: number; uniqueOpens: Set<string> }> = {};

        for (const contact of contacts) {
          try {
            const res = await fetch(`https://api.brevo.com/v3/contacts/${encodeURIComponent(contact.email as string)}`, {
              headers: { "api-key": BREVO_API_KEY },
            });
            if (!res.ok) { totalErrors++; continue; }

            const data = await res.json() as {
              statistics?: { messagesSent?: { eventTime?: string; events?: { event: string; eventTime?: string }[] }[] }
            };

            let sent = 0, opened = 0, clicked = 0, hardBounce = 0, softBounce = 0;
            let lastOpened: string | null = null;

            for (const s of data.statistics?.messagesSent || []) {
              if (!s.eventTime) continue;
              sent++;
              const sentDate = s.eventTime.substring(0, 10); // YYYY-MM-DD

              if (!dailyStats[sentDate]) {
                dailyStats[sentDate] = { sent: 0, opened: 0, clicked: 0, hardBounce: 0, softBounce: 0, uniqueOpens: new Set() };
              }
              dailyStats[sentDate].sent++;

              for (const evt of s.events || []) {
                const evtDate = evt.eventTime?.substring(0, 10) || sentDate;
                if (!dailyStats[evtDate]) {
                  dailyStats[evtDate] = { sent: 0, opened: 0, clicked: 0, hardBounce: 0, softBounce: 0, uniqueOpens: new Set() };
                }

                if (evt.event === "opened") {
                  opened++;
                  dailyStats[evtDate].opened++;
                  dailyStats[evtDate].uniqueOpens.add(contact.email as string);
                  if (!lastOpened || (evt.eventTime && evt.eventTime > lastOpened)) lastOpened = evt.eventTime || null;
                }
                if (evt.event === "clicked") { clicked++; dailyStats[evtDate].clicked++; }
                if (evt.event === "hardBounce") { hardBounce++; dailyStats[evtDate].hardBounce++; }
                if (evt.event === "softBounce") { softBounce++; dailyStats[evtDate].softBounce++; }
              }
            }

            // Update contact-level stats
            await sql`
              UPDATE contacts SET
                emails_sent = ${sent}, emails_opened = ${opened}, emails_clicked = ${clicked},
                hard_bounces = ${hardBounce}, soft_bounces = ${softBounce},
                last_opened_at = ${lastOpened}, stats_synced_at = NOW()
              WHERE id = ${contact.id}
            `;
            totalSynced++;
          } catch { totalErrors++; }
        }

        // Upsert daily stats
        for (const [date, stats] of Object.entries(dailyStats)) {
          await sql`
            INSERT INTO email_daily_stats (user_id, project_id, stat_date, emails_sent, emails_opened, emails_clicked, hard_bounces, soft_bounces, unique_opens)
            VALUES (${userId}, ${projectId}, ${date}, ${stats.sent}, ${stats.opened}, ${stats.clicked}, ${stats.hardBounce}, ${stats.softBounce}, ${stats.uniqueOpens.size})
            ON CONFLICT (user_id, project_id, stat_date)
            DO UPDATE SET
              emails_sent = EXCLUDED.emails_sent,
              emails_opened = EXCLUDED.emails_opened,
              emails_clicked = EXCLUDED.emails_clicked,
              hard_bounces = EXCLUDED.hard_bounces,
              soft_bounces = EXCLUDED.soft_bounces,
              unique_opens = EXCLUDED.unique_opens
          `;
        }
      } catch { totalErrors++; }
    }

    return NextResponse.json({ synced: totalSynced, errors: totalErrors });
  } catch (err) {
    console.error("[sync-email-stats]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
