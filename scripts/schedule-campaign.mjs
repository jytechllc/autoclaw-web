#!/usr/bin/env node
/**
 * Schedule the AutoClaw Shenzhen cold-outreach campaign.
 *
 * Creates the workflow + per-contact scheduled_emails ROWS only — no email
 * bodies. The dispatch-followups cron generates each email FRESH via AI at
 * send time (lib/email-gen). No templates anywhere.
 *
 * Schedule per contact:
 *   step 0 (initial)   — spread over 7 days, staggered within working hours
 *   step 2 (followup1) — initial + 3 days
 *   step 4 (followup2) — initial + 7 days
 *
 * Usage: node --experimental-strip-types scripts/schedule-campaign.mjs
 */
import { readFileSync } from "fs";
import { neon } from "@neondatabase/serverless";

const env = {};
for (const l of readFileSync(".env.local", "utf8").split("\n")) {
  const m = l.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "").trim();
}
const sql = neon(env.DATABASE_URL);

const PROJECT_ID = 27;
const WORKFLOW_NAME = "AutoClaw Shenzhen Cold Outreach 2026-06";

// Get Shenzhen contacts
const contacts = await sql`
  SELECT id, first_name, company, tags
  FROM contacts
  WHERE project_id = ${PROJECT_ID} AND 'shenzhen' = ANY(tags)
    AND email IS NOT NULL AND email != ''
  ORDER BY created_at
`;
console.log(`\n📅 Scheduling campaign for ${contacts.length} Shenzhen contacts\n`);

// Workflow
let [workflow] = await sql`SELECT id FROM workflows WHERE name = ${WORKFLOW_NAME} LIMIT 1`;
if (!workflow) {
  [workflow] = await sql`
    INSERT INTO workflows (user_id, project_id, name, description, status, definition)
    VALUES (1, ${PROJECT_ID}, ${WORKFLOW_NAME},
      'AI-generated cold outreach: initial → +3d → +7d. No templates; dispatch generates each email fresh.',
      'active',
      '{"steps":[{"kind":"send_email"},{"kind":"wait","delay_seconds":259200},{"kind":"send_email"},{"kind":"wait","delay_seconds":345600},{"kind":"send_email"}]}'::jsonb)
    RETURNING id
  `;
  console.log(`✅ Workflow created: ${workflow.id}`);
} else {
  console.log(`ℹ️  Using existing workflow: ${workflow.id}`);
}

const BATCH_SIZE = Math.ceil(contacts.length / 7); // spread over 7 days
const START = new Date();
START.setUTCDate(START.getUTCDate() + 1);
START.setUTCHours(1, 0, 0, 0); // 09:00 CST

let scheduled = 0, skipped = 0;

for (let i = 0; i < contacts.length; i++) {
  const c = contacts[i];

  const [existing] = await sql`SELECT id FROM workflow_runs WHERE workflow_id=${workflow.id} AND contact_id=${c.id}`;
  if (existing) { skipped++; continue; }

  const dayIndex = Math.floor(i / BATCH_SIZE);
  const withinDay = i % BATCH_SIZE;
  const minutesOffset = Math.floor((withinDay / BATCH_SIZE) * 480); // spread across 8h
  const initialAt = new Date(START);
  initialAt.setUTCDate(initialAt.getUTCDate() + dayIndex);
  initialAt.setUTCMinutes(initialAt.getUTCMinutes() + minutesOffset);

  const f1At = new Date(initialAt.getTime() + 3 * 86400000);
  const f2At = new Date(initialAt.getTime() + 7 * 86400000);

  const [run] = await sql`
    INSERT INTO workflow_runs (workflow_id, contact_id, current_step, status)
    VALUES (${workflow.id}, ${c.id}, 0, 'running')
    ON CONFLICT (workflow_id, contact_id) DO UPDATE SET status='running'
    RETURNING id
  `;

  for (const [stepIndex, runAt] of [[0, initialAt], [2, f1At], [4, f2At]]) {
    await sql`
      INSERT INTO scheduled_emails
        (workflow_run_id, workflow_id, contact_id, step_index, run_at, status,
         sender_email, sender_name, recipient_email, recipient_name)
      VALUES
        (${run.id}, ${workflow.id}, ${c.id}, ${stepIndex}, ${runAt.toISOString()}, 'pending',
         'leo.liu@jytech.us', 'Leo Liu @ AutoClaw',
         (SELECT email FROM contacts WHERE id=${c.id}), ${c.first_name || ""})
      ON CONFLICT (workflow_run_id, step_index) DO NOTHING
    `;
  }
  scheduled++;
}

console.log(`\n${"─".repeat(60)}`);
console.log(`✅ Scheduled ${scheduled} contacts × 3 steps | skipped: ${skipped}`);
const [total] = await sql`SELECT COUNT(*)::int n FROM scheduled_emails WHERE workflow_id=${workflow.id}`;
const [day1] = await sql`SELECT COUNT(*)::int n FROM scheduled_emails WHERE workflow_id=${workflow.id} AND step_index=0 AND run_at < ${new Date(START.getTime() + 86400000).toISOString()}`;
console.log(`📬 Total scheduled_emails: ${total.n} | Day-1 initial sends: ${day1.n}`);
console.log(`📨 Dispatch cron generates + sends each fresh, ${BATCH_SIZE}/day spread`);
