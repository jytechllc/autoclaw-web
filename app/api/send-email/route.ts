import { NextRequest, NextResponse } from "next/server";
import { auth0 } from "@/lib/auth0";
import { getDb } from "@/lib/db";
import { decrypt } from "@/lib/crypto";
import nodemailer from "nodemailer";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

interface SendRequest {
  to: string;
  toName?: string;
  subject: string;
  html: string;
  from?: string;
  fromName?: string;
  provider?: "auto" | "smtp" | "brevo" | "sendgrid";
}

export async function POST(req: NextRequest) {
  try {
    const session = await auth0.getSession();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const sql = getDb();
    const email = session.user.email as string;
    const users = await sql`SELECT id FROM users WHERE email = ${email}`;
    if (users.length === 0) return NextResponse.json({ error: "User not found" }, { status: 404 });
    const userId = users[0].id as number;

    // Load all email-related keys from BYOK (user + org) — needed for all send methods
    const keyRows = await sql`
      SELECT service, api_key FROM (
        SELECT service, api_key, 0 as p FROM user_api_keys
          WHERE service IN ('brevo', 'sendgrid', 'smtp_host', 'smtp_port', 'smtp_user', 'smtp_pass', 'smtp_from')
          AND user_id = ${userId}
        UNION ALL
        SELECT ok.service, ok.api_key, 1 as p FROM org_api_keys ok
          WHERE ok.service IN ('brevo', 'sendgrid', 'smtp_host', 'smtp_port', 'smtp_user', 'smtp_pass', 'smtp_from')
          AND ok.org_id IN (SELECT org_id FROM organization_members WHERE user_id = ${userId})
      ) combined ORDER BY service, p
    `;
    const keys: Record<string, string> = {};
    for (const row of keyRows) {
      const svc = row.service as string;
      if (keys[svc]) continue;
      try { keys[svc] = decrypt(row.api_key as string); } catch { keys[svc] = row.api_key as string; }
    }

    const rawBody = await req.json();

    // Handle template-based actions (test / send_to_group)
    if (rawBody.action === "test" || rawBody.action === "send_to_group") {
      const templateId = rawBody.template_id;
      if (!templateId) return NextResponse.json({ error: "template_id required" }, { status: 400 });

      const tplRows = await sql`SELECT subject, body_html FROM email_templates WHERE id = ${templateId} AND user_id = ${userId}`;
      if (tplRows.length === 0) return NextResponse.json({ error: "Template not found" }, { status: 404 });
      const tpl = tplRows[0];

      if (rawBody.action === "test") {
        const toEmail = rawBody.to_email;
        if (!toEmail) return NextResponse.json({ error: "to_email required" }, { status: 400 });
        rawBody.to = toEmail;
        rawBody.subject = `[TEST] ${tpl.subject}`;
        rawBody.html = tpl.body_html as string;
      }

      if (rawBody.action === "send_to_group") {
        const groupId = rawBody.group_id;
        if (!groupId) return NextResponse.json({ error: "group_id required" }, { status: 400 });

        const members = await sql`
          SELECT c.email, c.first_name, c.last_name, c.company
          FROM contacts c
          JOIN contact_group_members gm ON gm.contact_id = c.id
          WHERE gm.group_id = ${groupId} AND c.email IS NOT NULL AND c.email != ''
        `;
        if (members.length === 0) return NextResponse.json({ error: "No contacts in this group" }, { status: 400 });

        // Send to each member (reuse the send logic below via recursion-like approach)
        let sent = 0;
        let failed = 0;
        for (const m of members) {
          try {
            const subject = (tpl.subject as string)
              .replace(/\{\{firstName\}\}/gi, (m.first_name as string) || "")
              .replace(/\{\{company\}\}/gi, (m.company as string) || "");
            const html = (tpl.body_html as string)
              .replace(/\{\{firstName\}\}/gi, (m.first_name as string) || "there")
              .replace(/\{\{lastName\}\}/gi, (m.last_name as string) || "")
              .replace(/\{\{company\}\}/gi, (m.company as string) || "your company");

            // Quick inline send via Brevo (most common)
            const brevoKey = keys.brevo || process.env.BREVO_API_KEY || "";
            if (brevoKey) {
              const res = await fetch("https://api.brevo.com/v3/smtp/email", {
                method: "POST",
                headers: { "api-key": brevoKey, "Content-Type": "application/json" },
                body: JSON.stringify({
                  sender: { email: email, name: session.user.name || "Marketing" },
                  to: [{ email: m.email as string }],
                  subject,
                  htmlContent: html,
                }),
              });
              if (res.ok || res.status === 202) sent++;
              else failed++;
            }
          } catch { failed++; }
        }
        return NextResponse.json({ success: true, sent, failed, total: members.length });
      }
    }

    const body = rawBody as SendRequest;
    if (!body.to || !body.subject || !body.html) {
      return NextResponse.json({ error: "to, subject, and html are required" }, { status: 400 });
    }

    // Also check env vars as fallback
    const brevoKey = keys.brevo || process.env.BREVO_API_KEY || "";
    const sendgridKey = keys.sendgrid || process.env.SENDGRID_API_KEY || "";
    const smtpHost = keys.smtp_host || "";
    const smtpPort = keys.smtp_port || "587";
    const smtpUser = keys.smtp_user || "";
    const smtpPass = keys.smtp_pass || "";
    const smtpFrom = keys.smtp_from || body.from || smtpUser || email;

    const provider = body.provider || "auto";
    const fromEmail = body.from || smtpFrom || email;
    const fromName = body.fromName || session.user.name as string || "";

    let messageId: string | undefined;
    let usedProvider = "";

    // Auto: try SMTP first (user's own email), then Brevo, then SendGrid
    const trySmtp = (provider === "auto" || provider === "smtp") && smtpHost && smtpUser && smtpPass;
    const tryBrevo = (provider === "auto" || provider === "brevo") && brevoKey;
    const trySendgrid = (provider === "auto" || provider === "sendgrid") && sendgridKey;

    if (trySmtp) {
      try {
        const transporter = nodemailer.createTransport({
          host: smtpHost,
          port: Number(smtpPort),
          secure: Number(smtpPort) === 465,
          auth: { user: smtpUser, pass: smtpPass },
        });
        const result = await transporter.sendMail({
          from: fromName ? `${fromName} <${fromEmail}>` : fromEmail,
          to: body.toName ? `${body.toName} <${body.to}>` : body.to,
          subject: body.subject,
          html: body.html,
        });
        messageId = result.messageId;
        usedProvider = "smtp";
      } catch (e) {
        if (provider === "smtp") {
          return NextResponse.json({ error: `SMTP failed: ${e instanceof Error ? e.message : e}` }, { status: 500 });
        }
        // Auto mode: fall through to next provider
      }
    }

    if (!usedProvider && tryBrevo) {
      try {
        const res = await fetch("https://api.brevo.com/v3/smtp/email", {
          method: "POST",
          headers: { "api-key": brevoKey, "Content-Type": "application/json" },
          body: JSON.stringify({
            sender: { name: fromName, email: fromEmail },
            to: [{ email: body.to, name: body.toName }],
            subject: body.subject,
            htmlContent: body.html,
          }),
        });
        if (res.ok) {
          const data = await res.json() as { messageId?: string };
          messageId = data.messageId;
          usedProvider = "brevo";
        } else if (provider === "brevo") {
          const err = await res.text();
          return NextResponse.json({ error: `Brevo failed: ${err.substring(0, 200)}` }, { status: 500 });
        }
      } catch (e) {
        if (provider === "brevo") {
          return NextResponse.json({ error: `Brevo failed: ${e instanceof Error ? e.message : e}` }, { status: 500 });
        }
      }
    }

    if (!usedProvider && trySendgrid) {
      try {
        const res = await fetch("https://api.sendgrid.com/v3/mail/send", {
          method: "POST",
          headers: { Authorization: `Bearer ${sendgridKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            personalizations: [{ to: [{ email: body.to, name: body.toName }] }],
            from: { email: fromEmail, name: fromName },
            subject: body.subject,
            content: [{ type: "text/html", value: body.html }],
          }),
        });
        if (res.ok || res.status === 202) {
          messageId = res.headers.get("x-message-id") || undefined;
          usedProvider = "sendgrid";
        } else if (provider === "sendgrid") {
          const err = await res.text();
          return NextResponse.json({ error: `SendGrid failed: ${err.substring(0, 200)}` }, { status: 500 });
        }
      } catch (e) {
        if (provider === "sendgrid") {
          return NextResponse.json({ error: `SendGrid failed: ${e instanceof Error ? e.message : e}` }, { status: 500 });
        }
      }
    }

    if (!usedProvider) {
      return NextResponse.json({ error: "No email provider configured. Add SMTP, Brevo, or SendGrid in Settings > API Keys." }, { status: 400 });
    }

    // Log to email_logs
    try {
      await sql`INSERT INTO email_logs (user_id, recipient_email, recipient_name, sender_email, sender_name, subject, body_html, message_id, provider, status)
        VALUES (${userId}, ${body.to}, ${body.toName || null}, ${fromEmail}, ${fromName || null}, ${body.subject}, ${body.html}, ${messageId || null}, ${usedProvider}, 'requests')`;
    } catch { /* non-critical */ }

    return NextResponse.json({ success: true, provider: usedProvider, messageId });
  } catch (err) {
    console.error("[POST /api/send-email]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
