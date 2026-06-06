#!/usr/bin/env node
/**
 * Generate & schedule AutoClaw Shenzhen cold outreach campaign.
 *
 * For each Shenzhen contact:
 *   - Uses Claude Haiku (Bedrock) to write a personalized email
 *   - Schedules initial send spread over 7 days (~31/day)
 *   - Schedules follow-up 1 at initial+3 days (if no reply)
 *   - Schedules follow-up 2 at initial+7 days (if no reply)
 *
 * Stores everything in:
 *   workflows → workflow_runs → scheduled_emails
 *
 * Usage: node --experimental-strip-types scripts/generate-campaign-emails.mjs
 */
import { readFileSync } from "fs";
import { neon } from "@neondatabase/serverless";
import { decrypt } from "../lib/crypto.ts";
import { BedrockRuntimeClient, InvokeModelCommand } from "@aws-sdk/client-bedrock-runtime";

const env = {};
for (const l of readFileSync(".env.local", "utf8").split("\n")) {
  const m = l.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "").trim();
}
process.env.ENCRYPTION_KEY = env.ENCRYPTION_KEY;
process.env.ENCRYPTION_SALT = env.ENCRYPTION_SALT;

const sql = neon(env.DATABASE_URL);

const bedrock = new BedrockRuntimeClient({
  region: env.AWS_BEDROCK_REGION || "us-east-1",
  credentials: {
    accessKeyId: env.AWS_ACCESS_KEY_ID,
    secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
  },
});

const MODEL_ID = "us.anthropic.claude-sonnet-4-6";
const PROJECT_ID = 27;
const WORKFLOW_NAME = "AutoClaw Shenzhen Cold Outreach 2026-06";

const SIGNATURE = `
Collin Liu
商务拓展总监 · Sienovo AutoClaw
微信：xinmai002leo | 电话：15019201125
https://autoclaw.jytech.us`.trim();

// ── Segment → pain point context ─────────────────────────────────────────────
function getSegmentContext(tags) {
  if (tags.includes("sz-crossborder-ecom") || tags.includes("sz-futian-trade")) {
    return {
      segment: "跨境电商/亚马逊卖家",
      painPoint: "平台依赖重、流量越来越贵、独立站引流难、海外新客户开发成本高",
      prediction: "需要建立独立于平台的海外客户获取能力，找到愿意复购的B端买家，减少对亚马逊等平台的依赖",
    };
  }
  if (tags.includes("sz-marketing")) {
    return {
      segment: "营销/广告决策人",
      painPoint: "国内获客成本上升，出海营销预算难以衡量ROI，找不到精准的海外目标客户",
      prediction: "需要数据驱动的海外市场拓展方案，能精准找到有采购意向的海外买家，而不是泛投广告",
    };
  }
  if (tags.includes("sz-nanshan-tech")) {
    return {
      segment: "科技/AI/SaaS 企业",
      painPoint: "产品力不差但海外知名度低，B2B销售周期长，进入欧美市场缺乏资源和渠道",
      prediction: "需要在目标市场的采购决策链条中建立存在感，在潜在客户开始评估供应商之前就进入他们的视野",
    };
  }
  // default: hardware/LED/manufacturing
  return {
    segment: "硬件/制造/出口企业",
    painPoint: "展会成本高转化低，平台同质化竞争激烈，真正有采购能力的欧美买家很难通过传统渠道触达",
    prediction: "需要绕过中间环节，直接触达有真实采购需求的海外工业买家和分销商，从低价询盘客户转向优质长期客户",
  };
}

async function generateEmail(contact, type = "initial") {
  const ctx = getSegmentContext(contact.tags || []);
  const name = contact.first_name || "您";
  const company = contact.company || "贵公司";
  const position = contact.position || "";

  let prompt;
  if (type === "initial") {
    prompt = `你是 Sienovo AutoClaw 的商务拓展总监 Collin Liu，正在给深圳出海企业写一封个性化的冷邮件（中文）。

联系人信息：
- 姓名：${name}
- 公司：${company}
- 职位：${position}
- 行业类型：${ctx.segment}

写作要求：
1. 第一句点明"我们找到了你"——说明为什么联系这家公司，体现我们了解他们的业务
2. 第二段预测他们的推广痛点：${ctx.painPoint}
3. 第三段说明 AutoClaw 的价值：Sienovo AutoClaw 是出海营销 AI 平台——我们知道你的产品，也知道海外哪些企业在需要——帮你精准对接，不是撒网广告，是真实采购商的直接连接
4. 预测他们最需要解决的：${ctx.prediction}
5. 以一个开放性问题结尾引发回复（问他们目前海外拓展的挑战或现状）
6. 语气：专业但不生硬，简洁，不超过200字正文

严格规则：
- 不要在正文里写任何联系方式（微信号、电话、邮箱、网址）——这些只会出现在后面的签名档里
- 不要编造任何数据、客户名称或承诺
- 不要写主题行，不要写签名，不要写"此致敬礼"之类的结尾

只输出邮件正文，中文。`;
  } else if (type === "followup1") {
    prompt = `你是 Sienovo AutoClaw 的 Collin Liu，3天前给 ${name}（${company}，${position}）发了第一封邮件介绍我们的出海营销 AI 服务，对方没有回复。

写一封简短的跟进邮件（中文，不超过100字）：
- 不要重复太多第一封的内容
- 换一个角度：提一个具体的价值点或数据（比如帮同类企业找到多少海外采购商，或节省多少营销成本）
- 轻松的语气，不施压
- 结尾问一个简单的是/否问题

严格规则：
- 不要在正文里写任何联系方式（微信号、电话、邮箱、网址）——只在签名档出现
- 数据要含糊化（用"部分客户""不少企业"，不要编造精确数字如"200+""70%"）
- 不要写主题行，不要写签名

只输出邮件正文，中文。`;
  } else {
    prompt = `你是 Sienovo AutoClaw 的 Collin Liu，之前给 ${name}（${company}）发了两封邮件介绍出海营销 AI 服务，对方都没回复。

写最后一封邮件（中文，不超过80字）：
- 简单说"这是最后一次打扰"
- 提到"欢迎随时加微信聊"，但【不要写出任何具体微信号/电话/网址】——联系方式只在签名档出现
- 语气轻松，不强迫

严格规则：
- 正文绝对不能出现任何联系方式（微信号、电话、邮箱、网址）
- 不要写主题行，不要写签名

只输出邮件正文，中文。`;
  }

  const body = JSON.stringify({
    anthropic_version: "bedrock-2023-05-31",
    max_tokens: 800,
    messages: [{ role: "user", content: prompt }],
  });

  const res = await bedrock.send(new InvokeModelCommand({
    modelId: MODEL_ID,
    contentType: "application/json",
    accept: "application/json",
    body: Buffer.from(body),
  }));

  const data = JSON.parse(new TextDecoder().decode(res.body));
  return data.content?.[0]?.text?.trim() || "";
}

function getSubject(contact, type = "initial") {
  const company = contact.company || "贵公司";
  const tags = contact.tags || [];
  const ctx = getSegmentContext(tags);

  if (type === "initial") {
    if (tags.includes("sz-crossborder-ecom")) return `${company}的下一步增长，我们有一些想法`;
    if (tags.includes("sz-nanshan-tech")) return `${company}进入海外市场——我们有一些数据想分享`;
    if (tags.includes("sz-marketing")) return `${company}的海外获客，可以更精准`;
    return `${company}的海外客户，我们帮你找`;
  }
  if (type === "followup1") return `Re: ${company} — 补充一个数据点`;
  return `Re: ${company} — 最后一次联系`;
}

// Safety net: strip only CONCRETE fabricated contact values from the AI body
// (a wechat ID, phone number, url, email). Generic phrases like "欢迎加微信聊"
// are kept — the real contact details live in the signature.
function sanitizeBody(body) {
  return body
    // Remove explicit wechat/vx IDs:  微信号：xxx / 微信:xxx / wechat: xxx / vx：xxx
    .replace(/(微信号?|wechat|vx|weixin)\s*[:：]\s*[A-Za-z0-9_\-]+/gi, "微信")
    // Remove bolded fake IDs like **collinliu_autoclaw**
    .replace(/\*\*[A-Za-z0-9_]{4,}\*\*/g, "")
    // Remove URLs (signature adds the real one)
    .replace(/https?:\/\/\S+/gi, "")
    // Remove emails
    .replace(/[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}/g, "")
    // Remove phone-like digit runs (7+ digits)
    .replace(/\+?\d[\d\s\-]{6,}\d/g, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function wrapEmail(body, signature) {
  return `${sanitizeBody(body)}\n\n${signature}`;
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ── Main ─────────────────────────────────────────────────────────────────────
// Get all Shenzhen contacts for this campaign
const contacts = await sql`
  SELECT id, first_name, last_name, email, company, position, tags
  FROM contacts
  WHERE project_id = ${PROJECT_ID}
    AND 'shenzhen' = ANY(tags)
    AND email IS NOT NULL AND email != ''
  ORDER BY created_at
`;
console.log(`\n🚀 Generating emails for ${contacts.length} Shenzhen contacts\n`);

// Create or get workflow
let [workflow] = await sql`SELECT id FROM workflows WHERE name = ${WORKFLOW_NAME} LIMIT 1`;
if (!workflow) {
  [workflow] = await sql`
    INSERT INTO workflows (user_id, project_id, name, description, status, definition)
    VALUES (1, ${PROJECT_ID}, ${WORKFLOW_NAME},
      'AutoClaw Shenzhen cold outreach: initial → +3d followup → +7d followup',
      'active',
      '{"steps":[{"kind":"send_email","delay_seconds":0},{"kind":"wait","delay_seconds":259200},{"kind":"send_email"},{"kind":"wait","delay_seconds":345600},{"kind":"send_email"}]}'::jsonb)
    RETURNING id
  `;
  console.log(`✅ Workflow created: ${workflow.id}`);
}

// Spread initial sends over 7 days, ~31/day, starting tomorrow 9am CST
const BATCH_SIZE = Math.ceil(contacts.length / 7);
const START_DATE = new Date();
START_DATE.setDate(START_DATE.getDate() + 1);
START_DATE.setHours(1, 0, 0, 0); // 09:00 CST = 01:00 UTC

let generated = 0, skipped = 0;

for (let i = 0; i < contacts.length; i++) {
  const contact = contacts[i];

  // Skip if already has a workflow_run for this campaign
  const existing = await sql`
    SELECT id FROM workflow_runs WHERE workflow_id = ${workflow.id} AND contact_id = ${contact.id}
  `;
  if (existing.length) { skipped++; continue; }

  // Stagger within the day (spread across 8 working hours)
  const dayIndex = Math.floor(i / BATCH_SIZE);
  const withinDay = i % BATCH_SIZE;
  const minutesOffset = Math.floor((withinDay / BATCH_SIZE) * 480); // 0-480 min (8h)
  const initialRunAt = new Date(START_DATE);
  initialRunAt.setDate(initialRunAt.getDate() + dayIndex);
  initialRunAt.setMinutes(initialRunAt.getMinutes() + minutesOffset);

  const followup1At = new Date(initialRunAt.getTime() + 3 * 24 * 60 * 60 * 1000);
  const followup2At = new Date(initialRunAt.getTime() + 7 * 24 * 60 * 60 * 1000);

  // Generate all 3 emails via Claude
  process.stdout.write(`  [${i + 1}/${contacts.length}] ${contact.first_name} @ ${contact.company} ... `);
  await sleep(300); // rate limit

  let initial, followup1, followup2;
  try {
    initial = await generateEmail(contact, "initial");
    followup1 = await generateEmail(contact, "followup1");
    followup2 = await generateEmail(contact, "followup2");
  } catch (e) {
    console.log(`❌ AI error: ${e.message?.slice(0, 60)}`);
    continue;
  }

  // Create workflow_run (idempotent)
  const [run] = await sql`
    INSERT INTO workflow_runs (workflow_id, contact_id, current_step, status)
    VALUES (${workflow.id}, ${contact.id}, 0, 'running')
    ON CONFLICT (workflow_id, contact_id) DO UPDATE SET status='running'
    RETURNING id
  `;

  // Schedule all 3 emails (idempotent)
  for (const [stepIndex, runAt, type] of [
    [0, initialRunAt, "initial"],
    [2, followup1At, "followup1"],
    [4, followup2At, "followup2"],
  ]) {
    const body = type === "initial" ? initial : type === "followup1" ? followup1 : followup2;
    await sql`
      INSERT INTO scheduled_emails
        (workflow_run_id, workflow_id, contact_id, step_index, run_at, status,
         subject, body_html, sender_email, sender_name, recipient_email, recipient_name)
      VALUES
        (${run.id}, ${workflow.id}, ${contact.id}, ${stepIndex}, ${runAt.toISOString()}, 'pending',
         ${getSubject(contact, type)}, ${wrapEmail(body, SIGNATURE)},
         'leo.liu@jytech.us', 'Leo Liu @ AutoClaw',
         ${contact.email}, ${contact.first_name || ""})
      ON CONFLICT (workflow_run_id, step_index) DO NOTHING
    `;
  }

  generated++;
  console.log(`✅ Day ${dayIndex + 1} @ ${initialRunAt.toISOString().slice(0, 16)}`);
}

console.log(`\n${"─".repeat(60)}`);
console.log(`✅ Done — generated: ${generated} × 3 emails = ${generated * 3} scheduled | skipped: ${skipped}`);
const [total] = await sql`SELECT COUNT(*)::int n FROM scheduled_emails WHERE workflow_id = ${workflow.id}`;
console.log(`📬 Total scheduled_emails: ${total.n}`);
