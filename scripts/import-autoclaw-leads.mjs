#!/usr/bin/env node
/**
 * Batch search potential AutoClaw customers via Apollo and import to contacts.
 * Targets: Chinese companies that could benefit from AI-powered overseas ad placement.
 * Stores results in project 27 (AutoClaw), org 5 (JY Tech LLC).
 *
 * Usage: node --experimental-strip-types scripts/import-autoclaw-leads.mjs
 */
import { readFileSync } from "fs";
import { neon } from "@neondatabase/serverless";
import { decrypt } from "../lib/crypto.ts";

const env = {};
for (const l of readFileSync(".env.local", "utf8").split("\n")) {
  const m = l.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "").trim();
}
process.env.ENCRYPTION_KEY = env.ENCRYPTION_KEY;
process.env.ENCRYPTION_SALT = env.ENCRYPTION_SALT;

const sql = neon(env.DATABASE_URL);
const [keyRow] = await sql`SELECT api_key FROM org_api_keys WHERE org_id=9 AND service='apollo'`;
let APOLLO_KEY;
try { APOLLO_KEY = decrypt(keyRow.api_key); } catch { APOLLO_KEY = keyRow.api_key; }

const PROJECT_ID = 27;   // AutoClaw
const ORG_ID = 5;        // JY Tech LLC
const OWNER_USER_ID = 1; // weij0201@gmail.com

// ── Target segments ──────────────────────────────────────────────────────────
// AutoClaw value prop: AI-powered Google/Meta overseas ad management for
// Chinese companies expanding globally — transparent 5% fee, WeChat/Alipay payment.
// Best fit: export manufacturers, cross-border e-commerce, B2B trading companies,
// any Chinese company currently spending on overseas ads.
const SEGMENTS = [
  // 深圳 — 电子硬件出口 (highest spend on Google/Meta ads)
  { city: "Shenzhen, Guangdong, China", titles: ["CEO","Founder","General Manager","Owner","Export Manager","Overseas Sales Director","Digital Marketing Manager","Marketing Director"], tag: "electronics-shenzhen" },
  // 广州 — 机械/建材/服装出口
  { city: "Guangzhou, Guangdong, China", titles: ["CEO","Founder","General Manager","Owner","Export Director","International Sales Director","Overseas Business Manager"], tag: "guangzhou-export" },
  // 义乌 — 跨境电商小商品
  { city: "Yiwu, Zhejiang, China", titles: ["CEO","Owner","Founder","Managing Director","Cross-border E-commerce Manager","Overseas Marketing Manager"], tag: "yiwu-crossborder" },
  // 杭州 — 跨境电商/DTC品牌
  { city: "Hangzhou, Zhejiang, China", titles: ["CEO","Founder","CMO","Overseas Marketing Director","Growth Manager","Digital Marketing Director","E-commerce Director"], tag: "hangzhou-dtc" },
  // 东莞 — 制造业出口
  { city: "Dongguan, Guangdong, China", titles: ["CEO","General Manager","Owner","Founder","Export Sales Manager","Overseas Business Director"], tag: "dongguan-manufacturing" },
  // 上海 — 综合出口/B2B SaaS
  { city: "Shanghai, China", titles: ["CEO","Founder","CMO","Marketing Director","Overseas Business Director","International Sales Director","Head of Growth"], tag: "shanghai-intl" },
  // 北京 — 科技/AI 企业出海
  { city: "Beijing, China", titles: ["CEO","Founder","CMO","Head of International Business","Overseas Marketing Director","Growth Director"], tag: "beijing-tech" },
  // 宁波 — 外贸/供应链
  { city: "Ningbo, Zhejiang, China", titles: ["CEO","Owner","General Manager","Export Director","International Business Manager"], tag: "ningbo-trade" },
];

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function searchPeople(city, titles, page = 1) {
  const r = await fetch("https://api.apollo.io/v1/mixed_people/api_search", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Api-Key": APOLLO_KEY },
    body: JSON.stringify({ per_page: 25, page, person_locations: [city], person_titles: titles }),
  });
  if (!r.ok) { const e = await r.json(); return { people: [], error: e.error }; }
  return await r.json();
}

async function revealEmail(personId) {
  const r = await fetch("https://api.apollo.io/v1/people/match", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Api-Key": APOLLO_KEY },
    body: JSON.stringify({ id: personId, reveal_personal_emails: true }),
  });
  if (!r.ok) return null;
  const d = await r.json();
  return d.person || null;
}

async function upsertContact({ email, firstName, lastName, company, position, industry, linkedinUrl, tags }) {
  const existing = await sql`SELECT id FROM contacts WHERE email = ${email} AND project_id = ${PROJECT_ID}`;
  if (existing.length) return { id: existing[0].id, existed: true };
  const [row] = await sql`
    INSERT INTO contacts (user_id, project_id, email, first_name, last_name, company, position, industry, linkedin_url, source, source_detail, tags)
    VALUES (${OWNER_USER_ID}, ${PROJECT_ID}, ${email}, ${firstName||""}, ${lastName||""}, ${company||""}, ${position||""}, ${industry||null}, ${linkedinUrl||null}, 'apollo', ${tags.join(",")}, ${tags})
    RETURNING id
  `;
  return { id: row.id, existed: false };
}

// ── Main ─────────────────────────────────────────────────────────────────────
let totalSaved = 0, totalSkipped = 0, totalNoEmail = 0, creditLimit = false;
const seenEmails = new Set();

// Pre-load existing emails to avoid re-revealing already-stored contacts
const existing = await sql`SELECT email FROM contacts WHERE project_id = ${PROJECT_ID}`;
for (const r of existing) seenEmails.add(r.email);
console.log(`\n🚀 AutoClaw lead import — existing: ${seenEmails.size} contacts\n`);

for (const seg of SEGMENTS) {
  if (creditLimit) break;
  console.log(`\n📍 ${seg.city} [${seg.tag}]`);

  for (let page = 1; page <= 3 && !creditLimit; page++) {
    const { people = [], error } = await searchPeople(seg.city, seg.titles, page);
    if (error) { console.log(`  ⚠️  search error: ${error}`); break; }
    if (!people.length) break;

    const withEmail = people.filter(p => p.has_email && p.id);
    console.log(`  page ${page}: ${people.length} results, ${withEmail.length} with email`);

    for (const person of withEmail) {
      if (creditLimit) break;
      const orgName = person.organization?.name || "";
      if (!orgName) { totalNoEmail++; continue; } // skip if no company

      // Reveal email
      await sleep(200); // rate limit
      const revealed = await revealEmail(person.id);
      if (!revealed) { totalNoEmail++; continue; }

      const email = revealed.email;
      if (!email || seenEmails.has(email)) { totalSkipped++; continue; }

      // Check credit exhaustion signal
      if (revealed.error?.includes?.("credit") || revealed.error?.includes?.("limit")) {
        console.log("  💳 Credit limit reached — stopping");
        creditLimit = true; break;
      }

      seenEmails.add(email);
      const { existed } = await upsertContact({
        email,
        firstName:  revealed.first_name || person.first_name || "",
        lastName:   revealed.last_name || "",
        company:    revealed.organization_name || orgName,
        position:   revealed.title || person.title || "",
        industry:   revealed.organization?.industry || "",
        linkedinUrl: revealed.linkedin_url || person.linkedin_url || null,
        tags:       [seg.tag, "autoclaw-prospect", "china-export"],
      });
      if (existed) { totalSkipped++; }
      else {
        totalSaved++;
        console.log(`  ✅ ${revealed.first_name} ${revealed.last_name} <${email}> | ${orgName}`);
      }
    }
    await sleep(500);
  }
}

console.log(`\n${"─".repeat(60)}`);
console.log(`✅ Done — saved: ${totalSaved} | skipped/dup: ${totalSkipped} | no email: ${totalNoEmail}`);
const [total] = await sql`SELECT COUNT(*)::int n FROM contacts WHERE project_id = ${PROJECT_ID}`;
console.log(`📊 AutoClaw project total contacts: ${total.n}`);
