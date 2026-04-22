import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve("/Users/wlin/dev/autoclaw/autoclaw-web");
const ENV_PATH = resolve(ROOT, ".env.production");
const LEADS_CSV = resolve(ROOT, "docs/sales/us-priority-leads.csv");
const CONTACTS_CSV = resolve(ROOT, "docs/sales/first-outreach-contacts.csv");
const LOG_JSON = resolve(ROOT, "docs/sales/first-outreach-log.json");

const MODE = process.env.MODE || "initial";
const SEND = process.env.SEND === "1";
const LIMIT = Number(process.env.LIMIT || "5");

function getSender(env) {
  return {
    name: process.env.FROM_NAME || env.OUTREACH_FROM_NAME || "JYTech US",
    email: process.env.FROM_EMAIL || env.OUTREACH_FROM_EMAIL || "jay.lin@jytech.us",
  };
}

function getReplyTo() {
  const email = process.env.REPLY_TO_EMAIL || "jytech202307@gmail.com";
  const name = process.env.REPLY_TO_NAME || "JYTech US";
  return { email, name };
}

function getBusinessPhone() {
  return process.env.BUSINESS_PHONE || "+1 415-518-2187";
}

function parseEnvFile(path) {
  const text = readFileSync(path, "utf8");
  const result = {};
  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const idx = line.indexOf("=");
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    let value = line.slice(idx + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    result[key] = value;
  }
  return result;
}

function parseCsv(path) {
  const text = readFileSync(path, "utf8").trim();
  const [headerLine, ...rows] = text.split("\n");
  const headers = headerLine.split(",");
  return rows.map((row) => {
    const parts = row.split(",");
    const obj = {};
    headers.forEach((header, i) => {
      obj[header] = parts[i] || "";
    });
    return obj;
  });
}

function toCsv(rows) {
  if (!rows.length) return "";
  const headers = Object.keys(rows[0]);
  const escape = (value) => {
    const s = String(value ?? "");
    if (s.includes(",") || s.includes('"') || s.includes("\n")) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  };
  return [
    headers.join(","),
    ...rows.map((row) => headers.map((header) => escape(row[header])).join(",")),
  ].join("\n");
}

function loadLog() {
  if (!existsSync(LOG_JSON)) return [];
  try {
    return JSON.parse(readFileSync(LOG_JSON, "utf8"));
  } catch {
    return [];
  }
}

function saveLog(entries) {
  writeFileSync(LOG_JSON, `${JSON.stringify(entries, null, 2)}\n`);
}

function daysFromNow(days) {
  return new Date(Date.now() + days * 86400000).toISOString();
}

function stripWww(domain) {
  return String(domain || "").replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "");
}

async function apolloSearchPeople(apiKey, domain, titles) {
  const searchRes = await fetch("https://api.apollo.io/v1/mixed_people/api_search", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Api-Key": apiKey },
    body: JSON.stringify({
      q_organization_domains: domain,
      person_titles: titles,
      per_page: 5,
    }),
  });
  if (!searchRes.ok) {
    return [];
  }
  const searchData = await searchRes.json();
  const people = Array.isArray(searchData.people) ? searchData.people : [];
  const enriched = [];
  for (const person of people.slice(0, 3)) {
    if (!person?.id) continue;
    try {
      const matchRes = await fetch("https://api.apollo.io/v1/people/match", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Api-Key": apiKey },
        body: JSON.stringify({ id: person.id, reveal_personal_emails: false, reveal_phone_number: false }),
      });
      if (!matchRes.ok) continue;
      const matchData = await matchRes.json();
      const p = matchData.person || matchData;
      if (!p?.email) continue;
      enriched.push({
        firstName: p.first_name || "",
        lastName: p.last_name || "",
        title: p.title || "",
        email: p.email || "",
        linkedinUrl: p.linkedin_url || "",
      });
    } catch {
      // Skip individual failures.
    }
  }
  return enriched;
}

async function hunterSearchDomain(apiKey, domain) {
  const res = await fetch(`https://api.hunter.io/v2/domain-search?domain=${encodeURIComponent(domain)}&limit=5&api_key=${apiKey}`);
  if (!res.ok) return [];
  const data = await res.json();
  const emails = data?.data?.emails || [];
  return emails
    .filter((item) => item.value)
    .map((item) => ({
      firstName: item.first_name || "",
      lastName: item.last_name || "",
      title: item.position || "",
      email: item.value || "",
      linkedinUrl: "",
    }));
}

function buildSubject(lead) {
  return `quick idea for ${lead.company}'s outbound team`;
}

function buildHtml(lead, sender) {
  const firstName = lead.firstName || "there";
  const phone = getBusinessPhone();
  return `
    <p>Hi ${firstName},</p>
    <p>I noticed ${lead.company} is actively investing in outbound pipeline and sales execution.</p>
    <p>AutoClaw helps B2B teams build pipeline with:</p>
    <ul>
      <li>target account list generation</li>
      <li>contact enrichment</li>
      <li>cold email workflow setup</li>
      <li>follow-up automation</li>
    </ul>
    <p>If useful, I can send over a small sample lead pack tailored to ${lead.company}'s market so you can judge fit quickly.</p>
    <p>Worth sending a sample?</p>
    <p>Best,<br/>${sender.name}<br/>AutoClaw<br/><a href="https://autoclaw.jytech.us">autoclaw.jytech.us</a><br/>${phone}</p>
  `.trim();
}

async function sendViaBrevo(apiKey, lead, sender, replyTo) {
  const res = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: { "api-key": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({
      sender,
      replyTo,
      to: [{ email: lead.email, name: [lead.firstName, lead.lastName].filter(Boolean).join(" ") || lead.company }],
      subject: buildSubject(lead),
      htmlContent: buildHtml(lead, sender),
    }),
  });
  if (!res.ok && res.status !== 202) {
    const body = await res.text();
    throw new Error(`Brevo send failed: HTTP ${res.status} ${body}`);
  }
  return true;
}

async function runInitial() {
  const env = parseEnvFile(ENV_PATH);
  const sender = getSender(env);
  const replyTo = getReplyTo();
  const rows = parseCsv(LEADS_CSV);
  const log = loadLog();
  const alreadySent = new Set(log.filter((entry) => entry.status && entry.status.startsWith("sent_")).map((entry) => entry.email));
  const titles = [
    "VP Sales",
    "Head of Sales",
    "Sales Director",
    "Revenue Operations",
    "Head of Growth",
    "Business Development Director",
  ];

  const contacts = [];
  for (const row of rows.slice(0, LIMIT)) {
    const domain = stripWww(row.website);
    let people = [];
    if (env.APOLLO_API_KEY) {
      people = await apolloSearchPeople(env.APOLLO_API_KEY, domain, titles);
    }
    if (people.length === 0 && env.HUNTER_API_KEY) {
      people = await hunterSearchDomain(env.HUNTER_API_KEY, domain);
    }
    for (const person of people.slice(0, 2)) {
      contacts.push({
        company: row.company,
        website: row.website,
        industry: row.industry,
        signal: row.signal,
        firstName: person.firstName,
        lastName: person.lastName,
        title: person.title,
        email: person.email,
        linkedinUrl: person.linkedinUrl,
        status: alreadySent.has(person.email) ? "sent_day0" : "ready",
        nextFollowUpAt: "",
      });
    }
  }

  if (contacts.length === 0) {
    console.log("No contacts found.");
    return;
  }

  if (!SEND) {
    writeFileSync(CONTACTS_CSV, `${toCsv(contacts)}\n`);
    console.log(`Saved ${contacts.length} contacts to ${CONTACTS_CSV}`);
    console.log("Dry run only. Set SEND=1 to send initial outreach.");
    return;
  }

  const pending = contacts.filter((lead) => !alreadySent.has(lead.email)).slice(0, LIMIT);
  let sent = 0;
  for (const lead of pending) {
    try {
      await sendViaBrevo(env.BREVO_API_KEY, lead, sender, replyTo);
      lead.status = "sent_day0";
      lead.nextFollowUpAt = daysFromNow(2);
      log.push({
        mode: "initial",
        company: lead.company,
        email: lead.email,
        subject: buildSubject(lead),
        sentAt: new Date().toISOString(),
        nextFollowUpAt: daysFromNow(2),
        status: "sent_day0",
      });
      sent += 1;
      console.log(`Sent initial outreach to ${lead.email}`);
    } catch (err) {
      log.push({
        mode: "initial",
        company: lead.company,
        email: lead.email,
        sentAt: new Date().toISOString(),
        status: "failed",
        error: err instanceof Error ? err.message : String(err),
      });
      console.log(`Failed sending to ${lead.email}`);
    }
  }
  writeFileSync(CONTACTS_CSV, `${toCsv(contacts)}\n`);
  console.log(`Saved ${contacts.length} contacts to ${CONTACTS_CSV}`);
  saveLog(log);
  console.log(`Initial outreach sent: ${sent}`);
}

async function runFollowUp() {
  const env = parseEnvFile(ENV_PATH);
  const sender = getSender(env);
  const replyTo = getReplyTo();
  const log = loadLog();
  const due = log.filter((entry) => entry.status === "sent_day0" && entry.nextFollowUpAt && new Date(entry.nextFollowUpAt) <= new Date());
  if (due.length === 0) {
    console.log("No follow-ups due.");
    return;
  }
  let sent = 0;
  for (const entry of due.slice(0, LIMIT)) {
    const phone = getBusinessPhone();
    const html = `
      <p>Hi,</p>
      <p>Following up in case outbound pipeline is still a priority.</p>
      <p>If useful, I can send a free sample lead pack based on your target market and show how the first 14-day setup would run.</p>
      <p>Best,<br/>${sender.name}<br/>AutoClaw<br/>${phone}</p>
    `.trim();
    try {
      const res = await fetch("https://api.brevo.com/v3/smtp/email", {
        method: "POST",
        headers: { "api-key": env.BREVO_API_KEY, "Content-Type": "application/json" },
        body: JSON.stringify({
          sender,
          replyTo,
          to: [{ email: entry.email }],
          subject: `Re: ${entry.subject}`,
          htmlContent: html,
        }),
      });
      if (!res.ok && res.status !== 202) {
        throw new Error(`Brevo follow-up failed: HTTP ${res.status}`);
      }
      entry.status = "sent_day2";
      entry.followUpSentAt = new Date().toISOString();
      entry.nextFollowUpAt = daysFromNow(3);
      sent += 1;
      console.log(`Sent follow-up to ${entry.email}`);
    } catch (err) {
      entry.error = err instanceof Error ? err.message : String(err);
      console.log(`Failed follow-up to ${entry.email}`);
    }
  }
  saveLog(log);
  console.log(`Follow-ups sent: ${sent}`);
}

if (MODE === "followup") {
  await runFollowUp();
} else {
  await runInitial();
}
