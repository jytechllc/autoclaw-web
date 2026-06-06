import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const CRON_SECRET = process.env.CRON_SECRET;
const BREVO_API_KEY = process.env.BREVO_API_KEY || "";

/**
 * Scans scheduled_emails where run_at <= now() AND status='pending'.
 *
 * Two modes:
 *   1. Pre-generated (has body_html in scheduled_emails): send directly via Brevo.
 *   2. Template-based (has template_id): merge vars → queue as pending_review.
 *
 * Also cancels remaining steps if workflow_run was stopped (contact replied etc.)
 * and skips follow-up steps if the contact has already opened a previous email
 * (signals engagement — don't spam).
 */
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  if (CRON_SECRET && authHeader !== `Bearer ${CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sql = getDb();

  // Load Brevo org key for JY Tech LLC (org 5)
  let brevoKey = BREVO_API_KEY;
  if (!brevoKey) {
    try {
      const { decrypt } = await import("@/lib/crypto");
      const [k] = await sql`SELECT api_key FROM org_api_keys WHERE org_id=5 AND service='brevo' LIMIT 1`;
      if (k) brevoKey = decrypt(k.api_key as string);
    } catch { /* use env fallback */ }
  }

  const due = await sql`
    SELECT se.id, se.workflow_run_id, se.workflow_id, se.contact_id,
           se.template_id, se.step_index,
           se.subject, se.body_html AS pre_body,
           se.sender_email, se.sender_name,
           se.recipient_email, se.recipient_name,
           c.email AS contact_email, c.first_name, c.last_name,
           t.subject AS tpl_subject, t.body_html AS tpl_body, t.user_id AS owner_id,
           wr.status AS run_status
    FROM scheduled_emails se
    JOIN contacts c ON c.id = se.contact_id
    LEFT JOIN email_templates t ON t.id = se.template_id
    LEFT JOIN workflow_runs wr ON wr.id = se.workflow_run_id
    WHERE se.status = 'pending' AND se.run_at <= NOW()
    ORDER BY se.run_at ASC
    LIMIT 100
  `;

  let sent = 0, queued = 0, cancelled = 0, skipped = 0;

  for (const row of due as Array<Record<string, unknown>>) {
    const seId = row.id as number;
    const runStatus = row.run_status as string | null;

    // Cancel if workflow already stopped
    if (runStatus && runStatus !== "running") {
      await sql`UPDATE scheduled_emails SET status='cancelled', cancelled_reason=${"run_" + runStatus}, dispatched_at=NOW() WHERE id=${seId}`;
      cancelled++;
      continue;
    }

    // Skip follow-ups if contact already opened an email (engaged)
    const stepIndex = row.step_index as number;
    if (stepIndex > 0) {
      const [opened] = await sql`
        SELECT 1 FROM email_logs
        WHERE contact_id = ${row.contact_id} AND status IN ('opened','clicks','clicked')
        LIMIT 1
      `;
      if (opened) {
        await sql`UPDATE scheduled_emails SET status='cancelled', cancelled_reason='contact_engaged', dispatched_at=NOW() WHERE id=${seId}`;
        skipped++;
        continue;
      }
    }

    const pre_body = row.pre_body as string | null;
    const subject = (row.subject || row.tpl_subject || "出海营销方案探讨") as string;
    const recipientEmail = (row.recipient_email || row.contact_email) as string;
    const recipientName = (row.recipient_name || row.first_name || "") as string;
    const senderEmail = (row.sender_email || "leo.liu@jytech.us") as string;
    const senderName = (row.sender_name || "Leo Liu @ AutoClaw") as string;

    // Mode 1: pre-generated body → send directly via Brevo
    if (pre_body && brevoKey) {
      try {
        const htmlBody = pre_body.replace(/\n/g, "<br>");
        const res = await fetch("https://api.brevo.com/v3/smtp/email", {
          method: "POST",
          headers: { "api-key": brevoKey, "Content-Type": "application/json" },
          body: JSON.stringify({
            to: [{ email: recipientEmail, name: recipientName }],
            sender: { email: senderEmail, name: senderName },
            subject,
            htmlContent: `<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.6;color:#333;max-width:600px">${htmlBody}</div>`,
          }),
        });
        const data = await res.json() as Record<string, unknown>;
        if (!res.ok) throw new Error(String(data.message || res.status));

        await sql`
          INSERT INTO email_logs (user_id, contact_id, recipient_email, recipient_name, sender_email, sender_name, subject, body_html, message_id, provider, status)
          VALUES (1, ${row.contact_id}, ${recipientEmail}, ${recipientName}, ${senderEmail}, ${senderName}, ${subject}, ${pre_body}, ${String(data.messageId || "")}, 'brevo', 'requests')
        `;
        await sql`UPDATE scheduled_emails SET status='sent', dispatched_at=NOW() WHERE id=${seId}`;
        await sql`UPDATE workflow_runs SET current_step=${stepIndex} WHERE id=${row.workflow_run_id}`;
        sent++;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        await sql`UPDATE scheduled_emails SET status='failed', cancelled_reason=${msg.slice(0, 200)} WHERE id=${seId}`;
      }
      continue;
    }

    // Mode 2: template-based → merge vars → pending_review
    const first = (row.first_name as string) || "";
    const company = (row.company as string) || "";
    let tSubject = (row.tpl_subject as string) || subject;
    let body = (row.tpl_body as string) || "<p>Following up.</p>";
    for (const [k, v] of [["first_name", first], ["company", company]]) {
      tSubject = tSubject.replace(new RegExp(`{{\\s*${k}\\s*}}`, "g"), v);
      body = body.replace(new RegExp(`{{\\s*${k}\\s*}}`, "g"), v);
    }
    await sql`
      INSERT INTO email_logs (user_id, contact_id, recipient_email, recipient_name, sender_email, sender_name, subject, body_html, provider, status)
      VALUES (${row.owner_id || 1}, ${row.contact_id}, ${recipientEmail}, ${first}, ${senderEmail}, ${senderName}, ${tSubject}, ${body}, 'brevo', 'pending_review')
    `;
    await sql`UPDATE scheduled_emails SET status='queued_for_review', dispatched_at=NOW() WHERE id=${seId}`;
    await sql`UPDATE workflow_runs SET current_step=${stepIndex} WHERE id=${row.workflow_run_id}`;
    queued++;
  }

  return NextResponse.json({ ok: true, sent, queued, cancelled, skipped, scanned: due.length });
}
