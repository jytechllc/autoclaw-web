// One-shot: send a demo email via Brevo using the seeded "Nitrile — first touch"
// template, addressed to the env-provided recipient. Proves the end-to-end path
// (template render → Brevo send) without needing an Auth0 session in a browser.
//
// Usage:
//   npx tsx scripts/send-demo.ts mengchunjiang741112@gmail.com
//   (sender defaults to recipient — Brevo auto-verifies the account's own email)

import { Client } from "pg";

async function main() {
  const recipient = process.argv[2] || "mengchunjiang741112@gmail.com";
  const senderEmail = process.env.BREVO_SENDER || recipient;
  const senderName = process.env.BREVO_SENDER_NAME || "AutoClaw Demo";
  const brevoKey = process.env.BREVO_API_KEY;
  if (!brevoKey) throw new Error("BREVO_API_KEY not set");

  const dbUrl = process.env.DATABASE_URL || "postgres://autoclaw:autoclaw@localhost:5433/autoclaw";
  const client = new Client({ connectionString: dbUrl });
  await client.connect();
  const { rows } = await client.query(
    "SELECT subject, body_html FROM email_templates WHERE name = $1 LIMIT 1",
    ["Nitrile — first touch"],
  );
  await client.end();
  if (!rows.length) throw new Error("Template not found — run scripts/seed-demo.sql first");

  const firstName = recipient.split("@")[0].split(".")[0];
  const merge: Record<string, string> = {
    first_name: firstName.charAt(0).toUpperCase() + firstName.slice(1),
    company: "Your Company",
    position: "Procurement Manager",
    industry_tag: "auto detailing",
  };
  let subject = rows[0].subject as string;
  let body = rows[0].body_html as string;
  for (const [k, v] of Object.entries(merge)) {
    subject = subject.replace(new RegExp(`{{\\s*${k}\\s*}}`, "g"), v);
    body = body.replace(new RegExp(`{{\\s*${k}\\s*}}`, "g"), v);
  }
  body += `<hr><p style="color:#888;font-size:11px">Sent via AutoClaw local demo • ${new Date().toISOString()}</p>`;

  console.log(`[demo] sending to ${recipient} from ${senderEmail}`);
  console.log(`[demo] subject: ${subject}`);

  const res = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: { "api-key": brevoKey, "Content-Type": "application/json", accept: "application/json" },
    body: JSON.stringify({
      sender: { email: senderEmail, name: senderName },
      to: [{ email: recipient, name: merge.first_name }],
      subject,
      htmlContent: body,
    }),
  });
  const text = await res.text();
  console.log(`[demo] Brevo ${res.status}: ${text}`);
  if (!res.ok) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
