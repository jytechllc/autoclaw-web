// Single source of truth for AI-generated outreach emails.
// No templates — every email is generated fresh by the AI ("AI employee")
// from prompt logic, personalized per contact + sequence step.
//
// Used by:
//   - app/api/cron/dispatch-followups (generate at send time)
//   - scripts/* (campaign scheduling / previews)
import { chatWithAI, type ByokKeys } from "@/lib/ai";

export interface OutreachContact {
  first_name?: string | null;
  last_name?: string | null;
  company?: string | null;
  position?: string | null;
  tags?: string[] | null;
}

export type EmailStep = "initial" | "followup1" | "followup2";

export const SIGNATURE = [
  "Collin Liu",
  "商务拓展总监 · Sienovo AutoClaw",
  "微信：xinmai002leo | 电话：15019201125",
  "https://autoclaw.jytech.us",
].join("\n");

// Map a contact's segment tags → predicted overseas-marketing pain point.
export function getSegmentContext(tags: string[] = []) {
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
  return {
    segment: "硬件/制造/出口企业",
    painPoint: "展会成本高转化低，平台同质化竞争激烈，真正有采购能力的欧美买家很难通过传统渠道触达",
    prediction: "需要绕过中间环节，直接触达有真实采购需求的海外工业买家和分销商，从低价询盘客户转向优质长期客户",
  };
}

function buildPrompt(contact: OutreachContact, step: EmailStep): string {
  const ctx = getSegmentContext(contact.tags || []);
  const name = contact.first_name || "您";
  const company = contact.company || "贵公司";
  const position = contact.position || "";

  const COMMON_RULES = `严格规则：
- 不要在正文里写任何联系方式（微信号、电话、邮箱、网址）——这些只会出现在签名档里
- 不要编造任何精确数据、客户名称或承诺（要含糊化，用"部分客户""不少企业"）
- 不要写主题行，不要写签名，不要写"此致敬礼"之类的结尾
- 只输出邮件正文，中文`;

  if (step === "initial") {
    return `你是 Sienovo AutoClaw 的商务拓展总监 Collin Liu，正在给深圳出海企业写一封个性化的冷邮件（中文）。

联系人：${name}｜公司：${company}｜职位：${position}｜行业类型：${ctx.segment}

写作要求：
1. 第一句点明"我们找到了你"——说明为什么联系这家公司，体现我们了解他们的业务
2. 预测他们的推广痛点：${ctx.painPoint}
3. 说明 AutoClaw 的价值：Sienovo AutoClaw 是出海营销 AI 平台——我们知道你的产品，也知道海外哪些企业在需要——帮你精准对接真实采购商，不是撒网广告
4. 预测他们最需要解决的：${ctx.prediction}
5. 以一个开放性问题结尾引发回复
6. 专业但不生硬，简洁，正文不超过200字

${COMMON_RULES}`;
  }
  if (step === "followup1") {
    return `你是 Sienovo AutoClaw 的 Collin Liu，3天前给 ${name}（${company}，${position}）发了第一封邮件介绍出海营销 AI 服务，对方没回复。

写一封简短跟进邮件（中文，不超过100字）：
- 不要重复第一封内容
- 换角度：提一个含糊化的价值点（帮同类企业找到海外采购商、缩短开发周期等，不要精确数字）
- 轻松语气，不施压
- 结尾问一个简单的是/否问题

${COMMON_RULES}`;
  }
  return `你是 Sienovo AutoClaw 的 Collin Liu，之前给 ${name}（${company}）发了两封邮件介绍出海营销 AI 服务，对方都没回复。

写最后一封邮件（中文，不超过80字）：
- 简单说"这是最后一次打扰"
- 提到"欢迎随时加微信聊"，但【不要写出任何具体微信号/电话/网址】——联系方式只在签名档
- 语气轻松，不强迫

${COMMON_RULES}`;
}

// Safety net: strip only CONCRETE fabricated contact values from the AI body.
// Generic phrases like "欢迎加微信聊" are kept; real details live in the signature.
export function sanitizeBody(body: string): string {
  return body
    .replace(/(微信号?|wechat|vx|weixin)\s*[:：]\s*[A-Za-z0-9_\-]+/gi, "微信")
    .replace(/\*\*[A-Za-z0-9_]{4,}\*\*/g, "")
    .replace(/https?:\/\/\S+/gi, "")
    .replace(/[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}/g, "")
    .replace(/\+?\d[\d\s\-]{6,}\d/g, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// Subject line per step/segment.
export function getSubject(contact: OutreachContact, step: EmailStep): string {
  const company = contact.company || "贵公司";
  const tags = contact.tags || [];
  if (step === "initial") {
    if (tags.includes("sz-crossborder-ecom")) return `${company}的下一步增长，我们有一些想法`;
    if (tags.includes("sz-nanshan-tech")) return `${company}进入海外市场——我们有一些数据想分享`;
    if (tags.includes("sz-marketing")) return `${company}的海外获客，可以更精准`;
    return `${company}的海外客户，我们帮你找`;
  }
  if (step === "followup1") return `Re: ${company} — 补充一个想法`;
  return `Re: ${company} — 最后一次联系`;
}

/**
 * Generate a complete outreach email (body + signature) for a contact at a
 * given sequence step. Always AI-generated fresh — no templates.
 */
export async function generateOutreachEmail(
  contact: OutreachContact,
  step: EmailStep,
  byok?: ByokKeys,
): Promise<{ subject: string; body: string }> {
  const prompt = buildPrompt(contact, step);
  const resp = await chatWithAI(
    [{ role: "user", content: prompt }],
    800,
    byok,
    "bedrock/claude-sonnet", // Claude Sonnet 4.6 on Bedrock
  );
  const body = `${sanitizeBody(resp.content || "")}\n\n${SIGNATURE}`;
  return { subject: getSubject(contact, step), body };
}

export const STEP_BY_INDEX: Record<number, EmailStep> = {
  0: "initial",
  2: "followup1",
  4: "followup2",
};
