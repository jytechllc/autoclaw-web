import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { generateOutreachEmail, STEP_BY_INDEX } from "@/lib/email-gen";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const CRON_SECRET = process.env.CRON_SECRET;
const BREVO_API_KEY = process.env.BREVO_API_KEY || "";

// Generate a few per run (each does an AI call). Cron runs every 5 min, so this
// sustains ~100+ emails/hour — plenty for a staggered multi-day campaign while
// staying well under the function time limit.
const BATCH = 8;

/**
 * AI-employee email dispatcher (NO templates).
 *
 * For each due scheduled_email:
 *   - skips if the contact already engaged (opened/clicked a prior email)
 *   - generates the email FRESH via AI (lib/email-gen) based on the contact
 *     and sequence step — every email is uniquely written
 *   - sends via Brevo, logs to email_logs, advances the workflow_run
 */
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  if (CRON_SECRET && authHeader !== `Bearer ${CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sql = getDb();

  // Brevo key (org 5 = JY Tech LLC) for sending
  let brevoKey = BREVO_API_KEY;
  if (!brevoKey) {
    try {
      const { decrypt } = await import("@/lib/crypto");
      const [k] = await sql`SELECT api_key FROM org_api_keys WHERE org_id=5 AND service='brevo' LIMIT 1`;
      if (k) brevoKey = decrypt(k.api_key as string);
    } catch { /* fall through */ }
  }

  const due = await sql`
    SELECT se.id, se.workflow_run_id, se.step_index, se.contact_id,
           se.sender_email, se.sender_name,
           c.email AS contact_email, c.first_name, c.last_name,
           c.company, c.position, c.tags,
           wr.status AS run_status
    FROM scheduled_emails se
    JOIN contacts c ON c.id = se.contact_id
    LEFT JOIN workflow_runs wr ON wr.id = se.workflow_run_id
    WHERE se.status = 'pending' AND se.run_at <= NOW()
    ORDER BY se.run_at ASC
    LIMIT ${BATCH}
  `;

  let sent = 0, cancelled = 0, skipped = 0, failed = 0;

  for (const row of due as Array<Record<string, unknown>>) {
    const seId = row.id as number;
    const runStatus = row.run_status as string | null;
    const stepIndex = row.step_index as number;

    // Cancel remaining steps if the workflow_run was stopped (e.g. replied)
    if (runStatus && runStatus !== "running") {
      await sql`UPDATE scheduled_emails SET status='cancelled', cancelled_reason=${"run_" + runStatus}, dispatched_at=NOW() WHERE id=${seId}`;
      cancelled++;
      continue;
    }

    // Skip follow-ups if the contact already engaged with a prior email
    if (stepIndex > 0) {
      const [engaged] = await sql`
        SELECT 1 FROM email_logs
        WHERE contact_id = ${row.contact_id} AND status IN ('opened','clicks','clicked')
        LIMIT 1
      `;
      if (engaged) {
        await sql`UPDATE scheduled_emails SET status='cancelled', cancelled_reason='contact_engaged', dispatched_at=NOW() WHERE id=${seId}`;
        skipped++;
        continue;
      }
    }

    const recipientEmail = row.contact_email as string;
    const recipientName = (row.first_name as string) || "";
    const senderEmail = (row.sender_email as string) || "leo.liu@jytech.us";
    const senderName = (row.sender_name as string) || "Leo Liu @ AutoClaw";
    const step = STEP_BY_INDEX[stepIndex] || "initial";

    try {
      // Generate this email fresh — no templates
      const { subject, body } = await generateOutreachEmail(
        {
          first_name: row.first_name as string,
          last_name: row.last_name as string,
          company: row.company as string,
          position: row.position as string,
          tags: (row.tags as string[]) || [],
        },
        step,
      );

      if (!brevoKey) throw new Error("No Brevo key configured");

      const htmlBody = body.replace(/\n/g, "<br>");
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
        VALUES (1, ${row.contact_id}, ${recipientEmail}, ${recipientName}, ${senderEmail}, ${senderName}, ${subject}, ${body}, ${String(data.messageId || "")}, 'brevo', 'requests')
      `;
      await sql`UPDATE scheduled_emails SET status='sent', subject=${subject}, body_html=${body}, dispatched_at=NOW() WHERE id=${seId}`;
      await sql`UPDATE workflow_runs SET current_step=${stepIndex}, updated_at=NOW() WHERE id=${row.workflow_run_id}`;
      sent++;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await sql`UPDATE scheduled_emails SET status='failed', cancelled_reason=${msg.slice(0, 200)} WHERE id=${seId}`;
      failed++;
    }
  }

  return NextResponse.json({ ok: true, sent, cancelled, skipped, failed, scanned: due.length });
}
