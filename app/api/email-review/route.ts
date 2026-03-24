import { NextRequest, NextResponse } from "next/server";
import { auth0 } from "@/lib/auth0";
import { getDb } from "@/lib/db";
import { decrypt } from "@/lib/crypto";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// GET: list pending_review emails for the current user
export async function GET(req: NextRequest) {
  const session = await auth0.getSession();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const sql = getDb();
  const email = session.user.email as string;
  const users = await sql`SELECT id FROM users WHERE email = ${email}`;
  if (users.length === 0) return NextResponse.json({ emails: [] });
  const userId = users[0].id as number;

  const projectId = req.nextUrl.searchParams.get("project_id");

  const emails = projectId
    ? await sql`
        SELECT id, project_id, contact_id, recipient_email, recipient_name, sender_email, sender_name, subject, body_html, provider, created_at
        FROM email_logs WHERE user_id = ${userId} AND status = 'pending_review' AND project_id = ${parseInt(projectId)}
        ORDER BY created_at DESC
      `
    : await sql`
        SELECT id, project_id, contact_id, recipient_email, recipient_name, sender_email, sender_name, subject, body_html, provider, created_at
        FROM email_logs WHERE user_id = ${userId} AND status = 'pending_review'
        ORDER BY created_at DESC
      `;

  return NextResponse.json({ emails });
}

// POST: approve, reject, or edit pending emails
export async function POST(req: NextRequest) {
  const session = await auth0.getSession();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const sql = getDb();
  const email = session.user.email as string;
  const users = await sql`SELECT id FROM users WHERE email = ${email}`;
  if (users.length === 0) return NextResponse.json({ error: "User not found" }, { status: 404 });
  const userId = users[0].id as number;

  const body = await req.json();
  const { action } = body;

  // Approve: send the emails
  if (action === "approve") {
    const ids: number[] = body.ids;
    if (!ids?.length) return NextResponse.json({ error: "ids required" }, { status: 400 });

    // Fetch pending emails owned by this user
    const pending = await sql`
      SELECT id, recipient_email, recipient_name, sender_email, sender_name, subject, body_html, provider
      FROM email_logs WHERE id = ANY(${ids}) AND user_id = ${userId} AND status = 'pending_review'
    `;
    if (pending.length === 0) return NextResponse.json({ error: "No pending emails found" }, { status: 404 });

    // Load BYOK keys
    const keyRows = await sql`
      SELECT service, api_key FROM (
        SELECT service, api_key, 0 as p FROM user_api_keys
          WHERE service IN ('brevo', 'sendgrid') AND user_id = ${userId}
        UNION ALL
        SELECT ok.service, ok.api_key, 1 as p FROM org_api_keys ok
          WHERE ok.service IN ('brevo', 'sendgrid')
          AND ok.org_id IN (SELECT org_id FROM organization_members WHERE user_id = ${userId})
      ) combined ORDER BY service, p
    `;
    const keys: Record<string, string> = {};
    for (const row of keyRows) {
      const svc = row.service as string;
      if (keys[svc]) continue;
      try { keys[svc] = decrypt(row.api_key as string); } catch { keys[svc] = row.api_key as string; }
    }
    const brevoKey = keys.brevo || process.env.BREVO_API_KEY || "";
    const sendgridKey = keys.sendgrid || process.env.SENDGRID_API_KEY || "";

    let sent = 0;
    let failed = 0;

    for (const em of pending) {
      const provider = (em.provider as string) || "brevo";
      let sendOk = false;
      let messageId: string | undefined;

      try {
        if (brevoKey && provider === "brevo") {
          const res = await fetch("https://api.brevo.com/v3/smtp/email", {
            method: "POST",
            headers: { "api-key": brevoKey, "Content-Type": "application/json" },
            body: JSON.stringify({
              sender: { name: em.sender_name || "Marketing", email: em.sender_email },
              to: [{ email: em.recipient_email, name: em.recipient_name || undefined }],
              subject: em.subject,
              htmlContent: em.body_html,
            }),
          });
          if (res.ok) {
            const data = await res.json() as { messageId?: string };
            messageId = data.messageId;
            sendOk = true;
          }
        } else if (sendgridKey && provider === "sendgrid") {
          const res = await fetch("https://api.sendgrid.com/v3/mail/send", {
            method: "POST",
            headers: { Authorization: `Bearer ${sendgridKey}`, "Content-Type": "application/json" },
            body: JSON.stringify({
              personalizations: [{ to: [{ email: em.recipient_email, name: em.recipient_name || undefined }] }],
              from: { email: em.sender_email, name: em.sender_name || "Marketing" },
              subject: em.subject,
              content: [{ type: "text/html", value: em.body_html }],
            }),
          });
          if (res.ok || res.status === 202) {
            messageId = res.headers.get("x-message-id") || undefined;
            sendOk = true;
          }
        }
      } catch { /* send failed */ }

      const newStatus = sendOk ? "sent" : "error";
      await sql`UPDATE email_logs SET status = ${newStatus}, message_id = ${messageId || null} WHERE id = ${em.id}`;

      // Update contact emails_sent count
      if (sendOk && em.contact_id) {
        try { await sql`UPDATE contacts SET emails_sent = emails_sent + 1 WHERE id = ${em.contact_id}`; } catch { /* skip */ }
      }

      if (sendOk) sent++; else failed++;
    }

    return NextResponse.json({ approved: true, sent, failed, total: pending.length });
  }

  // Reject: delete or mark as rejected
  if (action === "reject") {
    const ids: number[] = body.ids;
    if (!ids?.length) return NextResponse.json({ error: "ids required" }, { status: 400 });
    await sql`DELETE FROM email_logs WHERE id = ANY(${ids}) AND user_id = ${userId} AND status = 'pending_review'`;
    return NextResponse.json({ rejected: true, count: ids.length });
  }

  // Edit: update subject/body of a pending email
  if (action === "edit") {
    const { id, subject, body_html } = body;
    if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
    const rows = await sql`SELECT id FROM email_logs WHERE id = ${id} AND user_id = ${userId} AND status = 'pending_review'`;
    if (rows.length === 0) return NextResponse.json({ error: "Email not found or not pending" }, { status: 404 });
    await sql`
      UPDATE email_logs
      SET subject = COALESCE(${subject || null}, subject), body_html = COALESCE(${body_html || null}, body_html)
      WHERE id = ${id}
    `;
    return NextResponse.json({ updated: true });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
