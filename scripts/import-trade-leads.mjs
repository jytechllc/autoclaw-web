#!/usr/bin/env node
/**
 * Import customs trade-data leads (exporters + importers) into contacts.
 *
 * Input: JSON produced from 全球贸易大数据 xls exports —
 *   { exporters: [{name,country,shipments,totalUsd,lastDate,product}], importers: [...] }
 * Exporters (cross-border merchants) are AutoClaw's own prospects; importers
 * (verified buyers) feed client campaigns. Both are enriched via Apollo
 * (company-name search → email reveal) and upserted into contacts with
 * trade-data tags. Email reveals are capped by MAX_REVEALS (credit guard).
 *
 * Usage: node scripts/import-trade-leads.mjs [leads.json]
 *        MAX_REVEALS=40 node scripts/import-trade-leads.mjs
 */
import { readFileSync } from "fs";
import { neon } from "@neondatabase/serverless";

const env = {};
for (const l of readFileSync(".env.local", "utf8").split("\n")) {
  const m = l.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "").trim();
}
const sql = neon(env.DATABASE_URL);
const KEY = env.APOLLO_API_KEY;
if (!KEY) { console.error("APOLLO_API_KEY missing in .env.local"); process.exit(1); }

const PROJECT_ID = 27;
const OWNER_USER_ID = 1;
const MAX_REVEALS = Number(process.env.MAX_REVEALS || 40);
const INPUT = process.argv[2] || "../autoclaw-docs/trade-leads-adp-2026-07.json";

// Freight forwarders / couriers in the exporter column are not merchants.
const LOGISTICS = /DHL|FEDEX|UPS |LOGISTIC|FORWARD|EXPRESS|SHIPPING|FREIGHT|CARGO|COURIER|TRANSPORT|BOLLORE|KUEHNE|DSV |EXPEDITOR/i;

const EXPORTER_TITLES = ["CEO", "Founder", "General Manager", "Owner", "Export Manager", "Overseas Sales Director", "International Business Manager", "Marketing Director"];
const IMPORTER_TITLES = ["Procurement Manager", "Purchasing Manager", "Supply Chain Director", "IT Director", "CTO", "Head of Procurement"];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Customs records carry legal entity names ("X INDIA PRIVATE LIMITED",
// "Y CO.,LTD.") that Apollo won't match verbatim — strip suffixes/geo noise.
function cleanOrgName(name) {
  return name
    .replace(/\b(PRIVATE|PVT\.?|LIMITED|LTD\.?|CO\.?,?\s*LTD\.?|CORP\.?|CORPORATION|INC\.?|LLC|GMBH|S\.?A\.?C?\.?|PTE\.?|CO\.?)\b/gi, " ")
    .replace(/\b(INDIA|SINGAPORE|PHILIPPINES|MEXICO|PERU|USA|CHINA)\b/gi, " ")
    .replace(/[.,()]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function searchPeople(orgName, titles) {
  const r = await fetch("https://api.apollo.io/v1/mixed_people/api_search", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Api-Key": KEY },
    body: JSON.stringify({ per_page: 5, q_organization_name: orgName, person_titles: titles }),
  });
  if (!r.ok) return { people: [], error: (await r.json().catch(() => ({}))).error || `HTTP ${r.status}` };
  return await r.json();
}

async function revealEmail(personId) {
  const r = await fetch("https://api.apollo.io/v1/people/match", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Api-Key": KEY },
    body: JSON.stringify({ id: personId, reveal_personal_emails: true }),
  });
  if (!r.ok) return null;
  return (await r.json()).person || null;
}

async function upsertContact({ email, firstName, lastName, company, position, industry, linkedinUrl, tags }) {
  const existing = await sql`SELECT id FROM contacts WHERE email = ${email}`;
  if (existing.length) return { existed: true };
  await sql`
    INSERT INTO contacts (user_id, project_id, email, first_name, last_name, company, position, industry, linkedin_url, source, source_detail, tags)
    VALUES (${OWNER_USER_ID}, ${PROJECT_ID}, ${email}, ${firstName || ""}, ${lastName || ""}, ${company || ""}, ${position || ""}, ${industry || null}, ${linkedinUrl || null}, 'apollo', ${tags.join(",")}, ${tags})
  `;
  return { existed: false };
}

const data = JSON.parse(readFileSync(INPUT, "utf8"));
// Exporters first (our own funnel), by shipment count; verify the org matched
// by Apollo before spending a reveal credit.
const queue = [
  ...data.exporters.map((c) => ({ ...c, side: "trade-exporter", titles: EXPORTER_TITLES, extraTags: ["autoclaw-prospect"] })),
  ...data.importers.map((c) => ({ ...c, side: "trade-importer", titles: IMPORTER_TITLES, extraTags: [] })),
].filter((c) => !LOGISTICS.test(c.name));

console.log(`trade-leads import: ${queue.length} companies (after logistics filter), reveal cap ${MAX_REVEALS}\n`);

const seen = new Set((await sql`SELECT email FROM contacts`).map((r) => r.email));
let reveals = 0, saved = 0, existed = 0, noMatch = 0, creditLimit = false;

for (const c of queue) {
  if (creditLimit || reveals >= MAX_REVEALS) break;
  const cleaned = cleanOrgName(c.name);
  if (!cleaned) { noMatch++; continue; }
  const { people = [], error } = await searchPeople(cleaned, c.titles);
  await sleep(200);
  if (error) { console.log(`  ⚠️ ${c.name.slice(0, 40)}: ${error}`); if (/credit|limit/i.test(String(error))) creditLimit = true; continue; }

  // Accept when the Apollo org shares the cleaned name's first word (brand).
  const brand = cleaned.toLowerCase().split(/\s+/)[0];
  const candidates = people.filter((p) => p.id && p.organization?.name &&
    p.organization.name.toLowerCase().includes(brand));
  if (!candidates.length) { noMatch++; continue; }

  for (const p of candidates.slice(0, 2)) {
    if (reveals >= MAX_REVEALS) break;
    reveals++;
    const rev = await revealEmail(p.id);
    await sleep(200);
    if (rev?.error && /credit|limit/i.test(String(rev.error))) { creditLimit = true; break; }
    const email = rev?.email;
    if (!email || seen.has(email)) { email && existed++; continue; }
    seen.add(email);
    await upsertContact({
      email,
      firstName: rev.first_name || p.first_name || "",
      lastName: rev.last_name || "",
      company: rev.organization_name || p.organization?.name || c.name,
      position: rev.title || p.title || "",
      industry: rev.organization?.industry || "",
      linkedinUrl: rev.linkedin_url || null,
      tags: ["trade-data", c.product, c.side, `shipments:${c.shipments}`, ...c.extraTags],
    });
    saved++;
    console.log(`  ✓ [${c.side}] ${c.name.slice(0, 36)} → ${rev.title || "?"} <${email}>`);
  }
}

console.log(`\nDone. saved=${saved} existed/skip=${existed} noApolloMatch=${noMatch} reveals=${reveals} creditLimit=${creditLimit}`);
