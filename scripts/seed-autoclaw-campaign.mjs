#!/usr/bin/env node
/**
 * Dogfood campaign: use AutoClaw to find AutoClaw's own customers.
 *
 * Creates (idempotent) in the AutoClaw DB, scoped to a given user:
 *   1) a contact GROUP   — the ICP target list bucket
 *   2) an email TEMPLATE — cold-outreach copy for AutoClaw's ICP (merge tags)
 *
 * It does NOT send. After running: import ICP contacts (CSV or the
 * autoclaw-data-scraper Apollo engine) → add to the group → /api/send-email
 * action=send_to_group → approve in Email Review (human-gated) → Brevo sends.
 *
 * Usage:  node scripts/seed-autoclaw-campaign.mjs <owner-email>
 * Env:    DATABASE_URL (auto-loaded from .env.local / .env)
 *
 * SAFETY: real sending is human-approved in the UI. Mind sender verification,
 * warmup (no in-app cap yet), unsubscribe + anti-spam compliance before blasting.
 */
import { neon } from "@neondatabase/serverless";
import { readFileSync } from "fs";

const ownerEmail = process.argv[2];
if (!ownerEmail) {
  console.error("Usage: node scripts/seed-autoclaw-campaign.mjs <owner-email>");
  process.exit(1);
}
if (!process.env.DATABASE_URL) {
  for (const f of [".env.local", ".env"]) {
    try {
      const m = readFileSync(f, "utf8").match(/^DATABASE_URL=(.*)$/m);
      if (m) { process.env.DATABASE_URL = m[1].replace(/^["']|["']$/g, "").trim(); break; }
    } catch {}
  }
}
if (!process.env.DATABASE_URL) { console.error("DATABASE_URL not found"); process.exit(1); }
const sql = neon(process.env.DATABASE_URL);

const GROUP_NAME = "AutoClaw 自荐 · ICP（SMB 广告主）";
const TEMPLATE_NAME = "AutoClaw 拉客 · 冷启动开发信";
const SUBJECT = "{{firstName}}, run Google Ads in 5 minutes — AI writes the copy";
const BODY_HTML = `<p>Hi {{firstName}},</p>
<p>Running ads for {{company}} usually means an agency taking 10–20%, or wrestling the Google Ads UI yourself.</p>
<p><strong>AutoClaw</strong> is one platform + one pre-paid balance that does it for you:</p>
<ul>
  <li>Paste a landing-page URL → <strong>AI writes launch-ready ad copy</strong></li>
  <li>Live Google Ads campaign in <strong>~5 minutes</strong> — you never touch the ads UI</li>
  <li><strong>Hard budget caps</strong> (auto-pause before overspend) + a <strong>5% platform fee</strong> (vs 10–20% agencies)</li>
</ul>
<p>Built by founders, for founders. Worth a 15-min look?</p>
<p><a href="{{calendarLink}}">Grab a time →</a></p>
<p>— {{senderName}}, AutoClaw</p>
<p style="font-size:12px;color:#888">Not relevant? Reply "no" and I won't follow up.</p>`;

const [user] = await sql`SELECT id, email FROM users WHERE email = ${ownerEmail}`;
if (!user) { console.error(`User not found: ${ownerEmail}`); process.exit(1); }
const uid = user.id;

// 1) Group (upsert by user_id + name)
let [g] = await sql`SELECT id FROM contact_groups WHERE user_id = ${uid} AND name = ${GROUP_NAME}`;
if (!g) [g] = await sql`INSERT INTO contact_groups (user_id, name, color, description)
  VALUES (${uid}, ${GROUP_NAME}, '#1E2761', 'AutoClaw dogfood: SMB advertisers / agencies / solo founders running Google/Meta ads') RETURNING id`;
console.log(`group: ${g.id} (${GROUP_NAME})`);

// 2) Template (upsert by user_id + name)
let [t] = await sql`SELECT id FROM email_templates WHERE user_id = ${uid} AND name = ${TEMPLATE_NAME}`;
if (t) {
  await sql`UPDATE email_templates SET subject = ${SUBJECT}, body_html = ${BODY_HTML}, category = 'cold_outreach', language = 'en', updated_at = NOW() WHERE id = ${t.id}`;
} else {
  [t] = await sql`INSERT INTO email_templates (user_id, name, subject, body_html, language, category)
    VALUES (${uid}, ${TEMPLATE_NAME}, ${SUBJECT}, ${BODY_HTML}, 'en', 'cold_outreach') RETURNING id`;
}
console.log(`template: ${t.id} (${TEMPLATE_NAME})`);

console.log(`\n✅ Campaign assets ready for ${ownerEmail} (user ${uid}).`);
console.log(`Next:
  1. Import ICP contacts → add to group ${g.id}
     (CSV via /api/contacts action=import_csv, or source via autoclaw-data-scraper Apollo
      with AutoClaw's ICP: SMB owners / solo founders / agencies running Google/Meta ads).
  2. POST /api/send-email { action:"send_to_group", template_id:${t.id}, group_id:${g.id} }
     → queues as pending_review.
  3. Approve in Email Review (human-gated) → Brevo sends. Mind sender verification + warmup + unsubscribe.`);
