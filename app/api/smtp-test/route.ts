import { NextResponse } from "next/server";
import { auth0 } from "@/lib/auth0";
import { getDb } from "@/lib/db";
import { decrypt } from "@/lib/crypto";
import nodemailer from "nodemailer";

export const dynamic = "force-dynamic";

export async function POST() {
  try {
  const session = await auth0.getSession();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const email = session.user.email as string;
  const sql = getDb();

  const users = await sql`SELECT id FROM users WHERE email = ${email}`;
  if (users.length === 0) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  const userId = users[0].id;

  // Get SMTP keys
  const keyRows = await sql`
    SELECT service, api_key FROM user_api_keys
    WHERE user_id = ${userId} AND service IN ('smtp_host', 'smtp_port', 'smtp_user', 'smtp_pass', 'smtp_from')
  `;

  const keys: Record<string, string> = {};
  for (const row of keyRows) {
    try {
      keys[row.service as string] = decrypt(row.api_key as string);
    } catch {
      keys[row.service as string] = row.api_key as string;
    }
  }

  const host = keys.smtp_host;
  const port = keys.smtp_port || "587";
  const user = keys.smtp_user;
  const pass = keys.smtp_pass;
  const from = keys.smtp_from || user || email;

  if (!host || !user || !pass) {
    return NextResponse.json({ error: "SMTP not configured. Please set Host, Username, and Password." }, { status: 400 });
  }

  try {
    const transporter = nodemailer.createTransport({
      host,
      port: Number(port),
      secure: Number(port) === 465,
      auth: { user, pass },
      connectionTimeout: 10000,
    });

    await transporter.sendMail({
      from: `AutoClaw Test <${from}>`,
      to: email,
      subject: "AutoClaw SMTP Test - Success!",
      html: `
        <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px">
          <h2 style="color:#991b1b">SMTP Test Successful</h2>
          <p>Your SMTP configuration is working correctly.</p>
          <table style="font-size:14px;color:#555;margin:16px 0">
            <tr><td style="padding:4px 12px 4px 0;font-weight:600">Host:</td><td>${host}</td></tr>
            <tr><td style="padding:4px 12px 4px 0;font-weight:600">Port:</td><td>${port}</td></tr>
            <tr><td style="padding:4px 12px 4px 0;font-weight:600">From:</td><td>${from}</td></tr>
          </table>
          <p style="color:#9ca3af;font-size:12px">Sent by AutoClaw at ${new Date().toISOString()}</p>
        </div>
      `,
    });

    return NextResponse.json({ success: true, message: `Test email sent to ${email}` });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[smtp-test] SMTP error:", message);
    return NextResponse.json({ error: `SMTP error: ${message}` }, { status: 500 });
  }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[smtp-test] Unexpected error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
