#!/usr/bin/env node
/**
 * Deep Shenzhen lead import for AutoClaw.
 * Covers sub-districts + industry segments for the highest-density
 * Chinese overseas advertiser cluster.
 *
 * Usage: node --experimental-strip-types scripts/import-shenzhen-leads.mjs
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
let KEY; try { KEY = decrypt(keyRow.api_key); } catch { KEY = keyRow.api_key; }

const PROJECT_ID = 27;
const ORG_ID = 5;
const OWNER_USER_ID = 1;

// ── Segments: sub-district × industry × decision-maker titles ────────────────
const SEGMENTS = [
  // 南山 — 科技/AI/SaaS 出海
  {
    label: "南山 科技/AI/SaaS",
    city: "Nanshan District, Shenzhen, China",
    titles: ["CEO","Founder","Co-Founder","CMO","Head of Overseas","International Business Director","Growth Director","Digital Marketing Director"],
    tag: "sz-nanshan-tech",
  },
  // 南山 — 智能硬件 (DJI, ROYOLE 等同区企业)
  {
    label: "南山 智能硬件/IoT",
    city: "Nanshan District, Shenzhen, China",
    titles: ["CEO","Founder","General Manager","Owner","Export Manager","Overseas Sales Director","Product Director"],
    tag: "sz-nanshan-hardware",
  },
  // 福田 — 外贸/跨境/贸易公司
  {
    label: "福田 外贸/跨境电商",
    city: "Futian District, Shenzhen, China",
    titles: ["CEO","Owner","General Manager","Founder","Export Director","Cross-border E-commerce Manager","Amazon Seller","Overseas Marketing Manager"],
    tag: "sz-futian-trade",
  },
  // 宝安 — 制造/电子元器件出口
  {
    label: "宝安 制造/电子",
    city: "Bao'an District, Shenzhen, China",
    titles: ["CEO","Owner","General Manager","Founder","Factory Director","Export Sales Manager","International Business Manager"],
    tag: "sz-baoan-manufacturing",
  },
  // 龙华/龙岗 — 消费电子/LED/电源
  {
    label: "龙华/龙岗 消费电子/LED",
    city: "Longhua District, Shenzhen, China",
    titles: ["CEO","Owner","Founder","General Manager","Overseas Sales Director","Export Manager"],
    tag: "sz-longhua-electronics",
  },
  // 深圳整体 — CEO/创始人 (宽泛捞取)
  {
    label: "深圳 CEO/创始人 (宽泛)",
    city: "Shenzhen, Guangdong, China",
    titles: ["CEO","Founder","Co-Founder","Managing Director"],
    tag: "sz-ceo-founder",
  },
  // 深圳 — 营销/广告投放决策人
  {
    label: "深圳 Marketing/广告决策人",
    city: "Shenzhen, Guangdong, China",
    titles: ["CMO","Marketing Director","Digital Marketing Manager","Overseas Marketing Director","Head of Marketing","VP Marketing","Growth Hacker","Performance Marketing Manager"],
    tag: "sz-marketing",
  },
  // 深圳 — 亚马逊/独立站卖家
  {
    label: "深圳 跨境电商/亚马逊",
    city: "Shenzhen, Guangdong, China",
    titles: ["Amazon FBA Seller","E-commerce Director","Cross-border E-commerce Manager","Head of Amazon","Independent Site Owner","DTC Brand Founder","Shopify Store Owner"],
    tag: "sz-crossborder-ecom",
  },
  // 深圳 — LED/电源/充电器 (高广告投放行业)
  {
    label: "深圳 LED/电源/充电器",
    city: "Shenzhen, Guangdong, China",
    titles: ["CEO","Owner","General Manager","Export Manager","International Sales Director"],
    tag: "sz-led-power",
  },
];

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function searchPeople(city, titles, page = 1) {
  const r = await fetch("https://api.apollo.io/v1/mixed_people/api_search", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Api-Key": KEY },
    body: JSON.stringify({ per_page: 25, page, person_locations: [city], person_titles: titles }),
  });
  if (!r.ok) { const e = await r.json(); return { people: [], error: e.error }; }
  return await r.json();
}

async function revealEmail(personId) {
  const r = await fetch("https://api.apollo.io/v1/people/match", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Api-Key": KEY },
    body: JSON.stringify({ id: personId, reveal_personal_emails: true }),
  });
  if (!r.ok) return null;
  const d = await r.json();
  return d.person || null;
}

async function upsertContact({ email, firstName, lastName, company, position, industry, linkedinUrl, tags }) {
  if (!email) return null;
  const existing = await sql`SELECT id FROM contacts WHERE email = ${email}`;
  if (existing.length) return { id: existing[0].id, existed: true };
  const [row] = await sql`
    INSERT INTO contacts (user_id, project_id, email, first_name, last_name, company, position, industry, linkedin_url, source, source_detail, tags)
    VALUES (${OWNER_USER_ID}, ${PROJECT_ID}, ${email}, ${firstName || ""}, ${lastName || ""}, ${company || ""}, ${position || ""}, ${industry || null}, ${linkedinUrl || null}, 'apollo', ${tags.join(",")}, ${tags})
    RETURNING id
  `;
  return { id: row.id, existed: false };
}

// ── Main ─────────────────────────────────────────────────────────────────────
const existing = await sql`SELECT email FROM contacts`;
const seenEmails = new Set(existing.map(r => r.email));
console.log(`\n🏙️  Shenzhen deep import — DB已有: ${seenEmails.size} contacts\n`);

let saved = 0, skipped = 0, noEmail = 0, creditLimit = false;

for (const seg of SEGMENTS) {
  if (creditLimit) break;
  console.log(`\n【${seg.label}】`);

  for (let page = 1; page <= 4 && !creditLimit; page++) {
    const { people = [], error } = await searchPeople(seg.city, seg.titles, page);
    if (error) { console.log(`  ⚠️  ${error}`); break; }
    if (!people.length) break;

    const candidates = people.filter(p => p.has_email && p.id && p.organization?.name);
    console.log(`  p${page}: ${people.length}条 → ${candidates.length}个有邮箱+公司`);

    for (const p of candidates) {
      if (creditLimit) break;
      await sleep(150);

      const revealed = await revealEmail(p.id);
      if (!revealed?.email) { noEmail++; continue; }

      if (revealed.error?.includes?.("credit") || revealed.error?.includes?.("limit")) {
        console.log("  💳 Credit exhausted — stopping"); creditLimit = true; break;
      }

      const email = revealed.email;
      if (seenEmails.has(email)) { skipped++; continue; }
      seenEmails.add(email);

      const result = await upsertContact({
        email,
        firstName:   revealed.first_name || p.first_name || "",
        lastName:    revealed.last_name || "",
        company:     revealed.organization_name || p.organization?.name || "",
        position:    revealed.title || p.title || "",
        industry:    revealed.organization?.industry || "",
        linkedinUrl: revealed.linkedin_url || null,
        tags:        [seg.tag, "autoclaw-prospect", "shenzhen"],
      });

      if (result?.existed) { skipped++; }
      else if (result) {
        saved++;
        console.log(`  ✅ ${revealed.first_name} ${revealed.last_name || ""} <${email}> | ${revealed.organization_name || p.organization?.name}`);
      }
    }
    await sleep(400);
  }
}

console.log(`\n${"─".repeat(60)}`);
console.log(`✅ 完成 — 新增: ${saved} | 重复: ${skipped} | 无邮箱: ${noEmail}`);
const [total] = await sql`SELECT COUNT(*)::int n FROM contacts WHERE project_id = ${PROJECT_ID} AND 'shenzhen' = ANY(tags)`;
console.log(`📊 AutoClaw project 深圳联系人总数: ${total.n}`);
