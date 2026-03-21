import { NextRequest, NextResponse } from "next/server";
import { auth0 } from "@/lib/auth0";
import { getDb } from "@/lib/db";
import { decrypt } from "@/lib/crypto";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const session = await auth0.getSession();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const sql = getDb();
    const email = session.user.email as string;
    const users = await sql`SELECT id FROM users WHERE email = ${email}`;
    if (users.length === 0) return NextResponse.json({ events: [] });
    const userId = users[0].id as number;

    const limit = Math.min(Number(req.nextUrl.searchParams.get("limit") || "50"), 100);
    const offset = Number(req.nextUrl.searchParams.get("offset") || "0");
    const eventFilter = req.nextUrl.searchParams.get("event") || "";
    const search = (req.nextUrl.searchParams.get("q") || "").trim();

    // Resolve Brevo key: personal → org → env
    let brevoKey = process.env.BREVO_API_KEY || "";
    try {
      const keyRows = await sql`
        SELECT api_key FROM (
          SELECT api_key, 0 as priority FROM user_api_keys WHERE user_id = ${userId} AND service = 'brevo'
          UNION ALL
          SELECT ok.api_key, 1 as priority FROM org_api_keys ok
            WHERE ok.service = 'brevo' AND ok.org_id IN (SELECT org_id FROM organization_members WHERE user_id = ${userId})
        ) combined ORDER BY priority LIMIT 1
      `;
      if (keyRows.length > 0) {
        try {
          const decrypted = decrypt(keyRows[0].api_key as string);
          if (decrypted.startsWith("xkeysib-")) brevoKey = decrypted;
        } catch { /* use env key */ }
      }
    } catch { /* ignore */ }

    if (!brevoKey) {
      return NextResponse.json({ error: "No Brevo API key configured" }, { status: 400 });
    }

    // Try local email_logs first, fallback to Brevo API
    let events: { date: string; event: string; email: string; subject: string; messageId: string; from: string; body?: string }[] = [];

    try {
      const searchFilter = search ? `%${search}%` : "";
      const localLogs = await sql`
        SELECT recipient_email, subject, status, message_id, sender_email, body_html, created_at
        FROM email_logs
        WHERE (
          user_id = ${userId}
          OR user_id IN (SELECT om2.user_id FROM organization_members om1 JOIN organization_members om2 ON om1.org_id = om2.org_id WHERE om1.user_id = ${userId})
          OR project_id IN (
            SELECT DISTINCT p.id FROM projects p
            LEFT JOIN project_members pm ON pm.project_id = p.id
            WHERE p.user_id = ${userId}
              OR pm.user_id = ${userId}
              OR p.org_id IN (SELECT org_id FROM organization_members WHERE user_id = ${userId})
          )
          OR (user_id IS NULL AND project_id IS NULL)
        )
        ${search ? sql`AND (recipient_email ILIKE ${searchFilter} OR subject ILIKE ${searchFilter} OR sender_email ILIKE ${searchFilter})` : sql``}
        ${eventFilter ? sql`AND status = ${eventFilter}` : sql``}
        ORDER BY created_at DESC
        LIMIT ${limit} OFFSET ${offset}
      `;
      if (localLogs.length > 0) {
        events = localLogs.map((l) => ({
          date: (l.created_at as string) || "",
          event: (l.status as string) || "sent",
          email: (l.recipient_email as string) || "",
          subject: (l.subject as string) || "",
          messageId: (l.message_id as string) || "",
          from: (l.sender_email as string) || "",
          body: (l.body_html as string) || undefined,
        }));
        return NextResponse.json({ events, total: events.length, source: "local" });
      }
    } catch { /* table may not exist yet, fall through to Brevo */ }

    // Fallback: Brevo API
    let url = `https://api.brevo.com/v3/smtp/statistics/events?limit=${limit}&offset=${offset}&sort=desc`;
    if (eventFilter) url += `&event=${eventFilter}`;

    const res = await fetch(url, {
      headers: { "api-key": brevoKey, accept: "application/json" },
    });

    if (!res.ok) {
      const err = await res.text();
      return NextResponse.json({ error: `Brevo API error: ${err.substring(0, 200)}` }, { status: res.status });
    }

    const data = await res.json();
    const rawEvents = (data.events || []) as Record<string, unknown>[];

    // Aggregate events by email+subject → one row per email with best status
    const statusPriority: Record<string, number> = { clicked: 5, opened: 4, delivered: 3, requests: 2, softBounce: 1, error: 0, hardBounce: 0 };
    const emailMap = new Map<string, { date: string; event: string; email: string; subject: string; messageId: string; from: string; priority: number }>();

    for (const e of rawEvents) {
      const key = `${e.email}::${e.messageId || e.subject}`;
      const priority = statusPriority[e.event as string] ?? 1;
      const existing = emailMap.get(key);
      if (!existing || priority > existing.priority) {
        emailMap.set(key, {
          date: (e.date as string) || "",
          event: (e.event as string) || "",
          email: (e.email as string) || "",
          subject: (e.subject as string) || "",
          messageId: (e.messageId as string) || "",
          from: (e.from as string) || "",
          priority,
        });
      }
    }

    events = [...emailMap.values()]
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
      .map(({ priority: _, ...rest }) => rest);

    return NextResponse.json({ events, total: events.length, source: "brevo" });
  } catch (err) {
    console.error("[GET /api/email-history]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
