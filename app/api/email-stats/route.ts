import { NextResponse } from "next/server";
import { auth0 } from "@/lib/auth0";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const session = await auth0.getSession();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const sql = getDb();
    const email = session.user.email as string;
    const users = await sql`SELECT id FROM users WHERE email = ${email}`;
    if (users.length === 0) return NextResponse.json({ daily: [], summary: {} });
    const userId = users[0].id as number;

    // Last 30 days daily stats
    const daily = await sql`
      SELECT stat_date, SUM(emails_sent)::int as sent, SUM(emails_opened)::int as opened,
        SUM(emails_clicked)::int as clicked, SUM(hard_bounces)::int as bounces, SUM(unique_opens)::int as unique_opens
      FROM email_daily_stats
      WHERE user_id = ${userId} AND stat_date >= CURRENT_DATE - INTERVAL '30 days'
      GROUP BY stat_date ORDER BY stat_date DESC
    `;

    // By day-of-week (Mon-Sun)
    const byDayOfWeek = await sql`
      SELECT EXTRACT(DOW FROM stat_date)::int as dow,
        SUM(emails_opened)::int as opened, SUM(emails_sent)::int as sent,
        COUNT(DISTINCT stat_date)::int as days
      FROM email_daily_stats
      WHERE user_id = ${userId} AND stat_date >= CURRENT_DATE - INTERVAL '90 days'
      GROUP BY dow ORDER BY dow
    `;

    // Overall summary
    const summary = await sql`
      SELECT SUM(emails_sent)::int as total_sent, SUM(emails_opened)::int as total_opened,
        SUM(emails_clicked)::int as total_clicked, SUM(hard_bounces)::int as total_bounces,
        SUM(unique_opens)::int as total_unique_opens
      FROM email_daily_stats
      WHERE user_id = ${userId}
    `;

    // Stats by subject (for template performance)
    const bySubject = await sql`
      SELECT subject,
        COUNT(*)::int as sent,
        COUNT(opened_at)::int as opened,
        COUNT(clicked_at)::int as clicked,
        COUNT(bounced_at)::int as bounced
      FROM email_logs
      WHERE user_id = ${userId} AND status != 'error'
      GROUP BY subject
      ORDER BY sent DESC
    `;

    return NextResponse.json({
      daily,
      byDayOfWeek: byDayOfWeek.map((r) => {
        const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
        return {
          day: dayNames[r.dow as number] || "?",
          dow: r.dow,
          opened: r.opened,
          sent: r.sent,
          avgOpened: (r.days as number) > 0 ? Math.round((r.opened as number) / (r.days as number)) : 0,
        };
      }),
      summary: summary[0] || {},
      bySubject,
    });
  } catch (err) {
    console.error("[GET /api/email-stats]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
