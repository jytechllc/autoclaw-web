// Send the full long-tail nitrile follow-up sequence (6 templates) to one
// recipient via Brevo, with a small pause between sends. Compresses the
// 3/7/30/90/365-day cadence into a few seconds for demo purposes.
//
// Usage:
//   npx tsx scripts/send-sequence.ts 3404928516@qq.com
//   BREVO_SENDER=you@example.com npx tsx scripts/send-sequence.ts <to>

import { Client } from "pg";

const SEQUENCE = [
  { name: "Nitrile — first touch",        stage: "Stage 1 — first touch (Day 0)" },
  { name: "Nitrile — 3 day follow-up",    stage: "Stage 2 — Day 3 follow-up" },
  { name: "Nitrile — 7 day follow-up",    stage: "Stage 3 — Day 7 follow-up" },
  { name: "Nitrile — 30 day follow-up",   stage: "Stage 4 — Day 30 follow-up" },
  { name: "Nitrile — 90 day follow-up",   stage: "Stage 5 — Day 90 follow-up" },
  { name: "Nitrile — annual check-in",    stage: "Stage 6 — Day 365 annual check-in" },
];

async function main() {
  const recipient = process.argv[2];
  if (!recipient) throw new Error("Usage: send-sequence.ts <recipient_email>");
  const senderEmail = process.env.BREVO_SENDER || "mengchunjiang741112@gmail.com";
  const senderName = process.env.BREVO_SENDER_NAME || "AutoClaw Sales (Mengchun)";
  const brevoKey = process.env.BREVO_API_KEY;
  if (!brevoKey) throw new Error("BREVO_API_KEY not set");
  const pauseMs = Number(process.env.PAUSE_MS || 4000);

  const dbUrl = process.env.DATABASE_URL || "postgres://autoclaw:autoclaw@localhost:5433/autoclaw";
  const client = new Client({ connectionString: dbUrl });
  await client.connect();

  // Pull all 6 templates once
  const tpls: Record<string, { subject: string; body_html: string }> = {};
  for (const s of SEQUENCE) {
    const { rows } = await client.query(
      "SELECT subject, body_html FROM email_templates WHERE name = $1 LIMIT 1",
      [s.name],
    );
    if (!rows.length) throw new Error(`Template not found: ${s.name}`);
    tpls[s.name] = rows[0];
  }
  await client.end();

  const merge: Record<string, string> = {
    first_name: "Demo Buyer",
    company: "QQ Test Co.",
    position: "Procurement Manager",
    industry_tag: "auto detailing / clinic",
  };

  console.log(`[seq] sending ${SEQUENCE.length} emails to ${recipient} from ${senderEmail} (${pauseMs}ms apart)`);

  let i = 0;
  for (const step of SEQUENCE) {
    i++;
    const tpl = tpls[step.name];
    let subject = tpl.subject;
    let body = tpl.body_html;
    for (const [k, v] of Object.entries(merge)) {
      subject = subject.replace(new RegExp(`{{\\s*${k}\\s*}}`, "g"), v);
      body = body.replace(new RegExp(`{{\\s*${k}\\s*}}`, "g"), v);
    }
    // Stage banner so the QQ inbox visually shows the funnel
    body =
      `<div style="background:#f1f5f9;border-left:4px solid #2563eb;padding:8px 12px;margin-bottom:14px;font-size:12px;color:#475569">` +
      `<b>AutoClaw demo</b> • ${step.stage} • ${i}/${SEQUENCE.length}` +
      `</div>` + body +
      `<hr><p style="color:#888;font-size:11px">Sent via AutoClaw local demo • ${new Date().toISOString()}</p>`;

    const res = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: { "api-key": brevoKey, "Content-Type": "application/json", accept: "application/json" },
      body: JSON.stringify({
        sender: { email: senderEmail, name: senderName },
        to: [{ email: recipient, name: merge.first_name }],
        subject: `[${i}/6] ${subject}`,
        htmlContent: body,
      }),
    });
    const text = await res.text();
    console.log(`[seq ${i}/6] ${step.stage} — Brevo ${res.status}: ${text.slice(0, 120)}`);
    if (!res.ok) { process.exitCode = 1; break; }
    if (i < SEQUENCE.length) await new Promise((r) => setTimeout(r, pauseMs));
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
