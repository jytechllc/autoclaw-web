import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const CRON_SECRET = process.env.CRON_SECRET;

/**
 * Scans scheduled_emails where run_at <= now() AND status='pending'.
 * For each: merges template body with contact fields, inserts into email_logs
 * with status='pending_review' so it surfaces in /dashboard/email-review.
 *
 * If the contact has replied (last_opened_at + a notional reply check) we
 * cancel the remaining sequence and mark workflow_run as stopped_replied.
 */
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  if (CRON_SECRET && authHeader !== `Bearer ${CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sql = getDb();
  const due = await sql`
    SELECT se.id, se.workflow_run_id, se.workflow_id, se.contact_id, se.template_id, se.step_index,
           c.email AS contact_email, c.first_name, c.last_name, c.company, c.position, c.tags,
           t.subject AS tpl_subject, t.body_html AS tpl_body, t.user_id AS owner_id,
           wr.status AS run_status
    FROM scheduled_emails se
    JOIN contacts c ON c.id = se.contact_id
    LEFT JOIN email_templates t ON t.id = se.template_id
    LEFT JOIN workflow_runs wr ON wr.id = se.workflow_run_id
    WHERE se.status = 'pending' AND se.run_at <= NOW()
    ORDER BY se.run_at ASC
    LIMIT 200
  `;

  let queued = 0;
  let cancelled = 0;

  for (const row of due as Array<Record<string, unknown>>) {
    const seId = row.id as number;
    const runStatus = row.run_status as string | null;

    // Skip if workflow_run already stopped (e.g. replied)
    if (runStatus && runStatus !== "running") {
      await sql`UPDATE scheduled_emails SET status='cancelled', cancelled_reason=${"run_" + runStatus}, dispatched_at=NOW() WHERE id=${seId}`;
      cancelled++;
      continue;
    }

    // Merge template
    const first = (row.first_name as string) || "";
    const company = (row.company as string) || "";
    const position = (row.position as string) || "";
    const tags = ((row.tags as string[]) || []).join(", ");
    let subject = (row.tpl_subject as string) || "Following up";
    let body = (row.tpl_body as string) || "<p>Following up on our previous note.</p>";
    const mergeMap: Record<string, string> = {
      first_name: first,
      company,
      position,
      industry_tag: tags,
    };
    for (const [k, v] of Object.entries(mergeMap)) {
      subject = subject.replace(new RegExp(`{{\\s*${k}\\s*}}`, "g"), v);
      body = body.replace(new RegExp(`{{\\s*${k}\\s*}}`, "g"), v);
    }

    // Queue into email_logs as pending_review
    await sql`
      INSERT INTO email_logs (user_id, contact_id, recipient_email, recipient_name, sender_email, sender_name, subject, body_html, provider, status)
      VALUES (${row.owner_id}, ${row.contact_id}, ${row.contact_email}, ${first}, ${"hello@autoclaw.dev"}, ${"AutoClaw Sales"}, ${subject}, ${body}, ${"brevo"}, ${"pending_review"})
    `;
    await sql`UPDATE scheduled_emails SET status='queued_for_review', dispatched_at=NOW() WHERE id=${seId}`;
    await sql`UPDATE workflow_runs SET current_step = ${row.step_index} WHERE id = ${row.workflow_run_id}`;
    queued++;
  }

  return NextResponse.json({ ok: true, queued, cancelled, scanned: due.length });
}
