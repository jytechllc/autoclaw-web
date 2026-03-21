import { NextRequest, NextResponse } from "next/server";
import { auth0 } from "@/lib/auth0";
import { getDb } from "@/lib/db";
import { decrypt } from "@/lib/crypto";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const session = await auth0.getSession();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const uuid = req.nextUrl.searchParams.get("uuid");
    if (!uuid) return NextResponse.json({ error: "uuid required" }, { status: 400 });

    const sql = getDb();
    const email = session.user.email as string;
    const users = await sql`SELECT id FROM users WHERE email = ${email}`;
    if (users.length === 0) return NextResponse.json({ error: "User not found" }, { status: 404 });
    const userId = users[0].id as number;

    // Resolve Brevo key
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
        try { const d = decrypt(keyRows[0].api_key as string); if (d.startsWith("xkeysib-")) brevoKey = d; } catch { /* env fallback */ }
      }
    } catch { /* ignore */ }

    if (!brevoKey) return NextResponse.json({ error: "No Brevo key" }, { status: 400 });

    const recipientEmail = req.nextUrl.searchParams.get("email") || "";

    // Step 0: Check local email_logs first (has body_html)
    try {
      const localLog = await sql`
        SELECT recipient_email, sender_email, sender_name, subject, body_html, created_at
        FROM email_logs
        WHERE (message_id = ${uuid} OR recipient_email = ${recipientEmail})
          AND body_html IS NOT NULL AND body_html != ''
        ORDER BY created_at DESC LIMIT 1
      `;
      if (localLog.length > 0 && localLog[0].body_html) {
        return NextResponse.json({
          subject: localLog[0].subject || "",
          from: `${localLog[0].sender_name || ""} <${localLog[0].sender_email || ""}>`,
          to: localLog[0].recipient_email || "",
          date: localLog[0].created_at || "",
          body: localLog[0].body_html as string,
        });
      }
    } catch { /* table may not exist, continue to Brevo */ }

    // Step 1: Get email details (uuid) via Brevo API
    const listRes = await fetch(`https://api.brevo.com/v3/smtp/emails?email=${encodeURIComponent(recipientEmail || uuid)}&messageId=${encodeURIComponent(uuid)}&limit=1`, {
      headers: { "api-key": brevoKey, accept: "application/json" },
    });
    let realUuid = uuid;
    if (listRes.ok) {
      const listData = await listRes.json();
      const found = (listData.transactionalEmails || [])[0];
      if (found?.uuid) realUuid = found.uuid;
    }

    // Step 2: Get email content by uuid
    const res = await fetch(`https://api.brevo.com/v3/smtp/emails/${realUuid}`, {
      headers: { "api-key": brevoKey, accept: "application/json" },
    });

    if (!res.ok) return NextResponse.json({ error: `Brevo: ${res.status}` }, { status: res.status });

    const data = await res.json();
    let body = data.body || "";

    // Brevo free plan returns "Mail content not available" — try to get template from agent task
    if (!body || body === "Mail content not available") {
      try {
        // Search for email template across all user/org agents
        const templateRows = await sql`
          SELECT config FROM agent_assignments
          WHERE agent_type IN ('email_marketing', 'email')
            AND config->'tasks'->2->>'result' IS NOT NULL
            AND config->'tasks'->2->>'result' != ''
            AND project_id IN (
              SELECT DISTINCT p.id FROM projects p
              LEFT JOIN project_members pm ON pm.project_id = p.id
              WHERE p.user_id = ${userId}
                OR pm.user_id = ${userId}
                OR p.org_id IN (SELECT org_id FROM organization_members WHERE user_id = ${userId})
            )
          ORDER BY created_at DESC LIMIT 1
        `;
        if (templateRows.length > 0) {
          const config = templateRows[0].config as { tasks?: { result?: string }[] };
          // Check task 2 (template) and task 5 (sent report with details)
          const templateResult = config?.tasks?.[2]?.result || "";
          const sentReport = config?.tasks?.[5]?.result || "";
          const displayContent = sentReport || templateResult;
          if (displayContent) {
            body = `<div style="padding:8px;background:#f9fafb;border-radius:8px;margin-bottom:12px;font-size:12px;color:#6b7280">` +
              (recipientEmail ? `<b>To:</b> ${recipientEmail}<br>` : "") +
              `<b>Subject:</b> ${data.subject || ""}<br>` +
              `<b>Note:</b> Showing email template (Brevo free plan does not store sent content)</div>` +
              `<div>${displayContent.replace(/\n/g, "<br>")}</div>`;
          }
        }
      } catch { /* ignore */ }
      if (!body || body === "Mail content not available") {
        body = `<p style="color:#9ca3af">Mail content not available on Brevo free plan. Upgrade to Starter ($9/mo) to view sent email content.</p>`;
      }
    }

    return NextResponse.json({
      subject: data.subject || "",
      from: data.from || data.email || "",
      to: recipientEmail || data.email || "",
      date: data.date || "",
      body,
    });
  } catch (err) {
    console.error("[email-content]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
