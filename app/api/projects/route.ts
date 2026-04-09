import { NextRequest, NextResponse } from "next/server";
import { auth0 } from "@/lib/auth0";
import { getDb, resolveUserPlan } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { checkRateLimit } from "@/lib/rate-limit";
import { sendWebhook } from "@/lib/webhook";
import { projectActionSchema, parseOrError } from "@/lib/validations";

export const dynamic = "force-dynamic";

function getIp(req: NextRequest): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}

const PLAN_AGENT_LIMITS: Record<string, number> = {
  starter: 2,
  growth: 10,
  scale: 999,
  enterprise: 999,
};

const AGENT_PLANS: Record<string, Record<string, object>> = {
  en: {
    email_marketing: {
      plan: "Build prospect email list from project contacts, create personalized templates, configure follow-up sequences, and launch newsletter. Depends on Lead Prospecting for ICP data.",
      tasks: [
        { name: "Build prospect email list", status: "in_progress" },
        { name: "Create email templates (cold, follow-up, newsletter)", status: "pending" },
        { name: "Configure sending schedule & limits", status: "pending" },
        { name: "Set up tracking (opens, clicks, replies)", status: "pending" },
        { name: "Launch outreach campaign", status: "pending" },
      ],
      blockers: [],
    },
    seo_content: {
      plan: "Audit existing website SEO, research high-value keywords, create content calendar, and produce optimized blog posts.",
      tasks: [
        { name: "Crawl website & audit current SEO health", status: "in_progress" },
        { name: "Keyword research (50+ target keywords)", status: "pending" },
        { name: "Competitor content analysis", status: "pending" },
        { name: "Create monthly content calendar", status: "pending" },
        { name: "Write first 3 SEO-optimized blog posts", status: "pending" },
        { name: "Set up rank tracking & analytics", status: "pending" },
      ],
      blockers: ["Need website URL for site audit"],
    },
    lead_prospecting: {
      plan: "Define ideal customer profile, build lead database from multiple sources, score and qualify leads, deliver enriched lead lists.",
      tasks: [
        { name: "Define ICP and qualification criteria", status: "in_progress" },
        { name: "Verify available data sources", status: "pending" },
        { name: "Build initial lead list", status: "pending" },
        { name: "Enrich leads with company & contact data", status: "pending" },
        { name: "Score and prioritize leads", status: "pending" },
        { name: "Deliver qualified lead report", status: "pending" },
      ],
      blockers: ["Need ideal customer profile (industry, company size, title)"],
    },
    social_media: {
      plan: "Set up brand social profiles, create content strategy, schedule posts, and engage with target audience on X/Twitter and LinkedIn.",
      tasks: [
        { name: "Audit existing social presence", status: "in_progress" },
        { name: "Create brand voice & content guidelines", status: "pending" },
        { name: "Build 2-week content queue (posts, threads)", status: "pending" },
        { name: "Set up scheduling tool integration", status: "pending" },
        { name: "Launch engagement campaign (likes, replies, follows)", status: "pending" },
        { name: "Track follower growth & engagement metrics", status: "pending" },
      ],
      blockers: ["Need X/Twitter API credentials configured"],
    },
    product_manager: {
      plan: "Monitor website health, analyze user behavior, track conversion funnels, and identify optimization opportunities.",
      tasks: [
        { name: "Set up website monitoring (uptime, speed)", status: "in_progress" },
        { name: "Install analytics tracking", status: "pending" },
        { name: "Map conversion funnels", status: "pending" },
        { name: "Run initial UX audit", status: "pending" },
        { name: "Identify top 5 conversion blockers", status: "pending" },
        { name: "Create optimization roadmap", status: "pending" },
      ],
      blockers: ["Need website URL"],
    },
    sales_followup: {
      plan: "Integrate with CRM, set up lead nurture sequences, automate follow-up reminders, and track deal pipeline.",
      tasks: [
        { name: "Connect to CRM (HubSpot, Salesforce, etc.)", status: "pending" },
        { name: "Import existing leads & deals", status: "pending" },
        { name: "Create follow-up email sequences", status: "pending" },
        { name: "Set up automated reminders", status: "pending" },
        { name: "Configure deal stage tracking", status: "pending" },
        { name: "Launch follow-up email campaign", status: "pending" },
      ],
      blockers: ["Need CRM API credentials", "Need current sales pipeline data"],
    },
    orchestrator: {
      plan: "Coordinate all agents across projects. Analyze reports, identify cross-agent synergies, generate market intelligence, auto-optimize workflows, and produce weekly operations digests.",
      tasks: [
        { name: "Analyze agent ecosystem & collect reports", status: "in_progress" },
        { name: "Generate cross-agent optimization recommendations", status: "pending" },
        { name: "Market intelligence & content strategy", status: "pending" },
        { name: "Auto-coordinate agents (reset periodic tasks, flag blockers)", status: "pending" },
        { name: "Generate weekly operations digest", status: "pending" },
      ],
      blockers: [],
    },
  },
  zh: {
    email_marketing: {
      plan: "构建潜客邮件列表，创建个性化模板，配置跟进序列，并发布通讯。依赖潜在客户挖掘的 ICP 数据。",
      tasks: [
        { name: "构建潜在客户邮件列表", status: "in_progress" },
        { name: "创建邮件模板（冷邮件、跟进、通讯）", status: "pending" },
        { name: "配置发送计划和限制", status: "pending" },
        { name: "设置跟踪（打开率、点击率、回复率）", status: "pending" },
        { name: "发起营销活动", status: "pending" },
      ],
      blockers: [],
    },
    seo_content: {
      plan: "\u5ba1\u8ba1\u73b0\u6709\u7f51\u7ad9 SEO\uff0c\u7814\u7a76\u9ad8\u4ef7\u503c\u5173\u952e\u8bcd\uff0c\u521b\u5efa\u5185\u5bb9\u65e5\u5386\uff0c\u5e76\u64b0\u5199\u4f18\u5316\u535a\u5ba2\u6587\u7ae0\u3002",
      tasks: [
        { name: "\u722c\u53d6\u7f51\u7ad9\u5e76\u5ba1\u8ba1\u5f53\u524d SEO \u72b6\u6001", status: "in_progress" },
        { name: "\u5173\u952e\u8bcd\u7814\u7a76\uff0850+ \u76ee\u6807\u5173\u952e\u8bcd\uff09", status: "pending" },
        { name: "\u7ade\u4e89\u5bf9\u624b\u5185\u5bb9\u5206\u6790", status: "pending" },
        { name: "\u521b\u5efa\u6708\u5ea6\u5185\u5bb9\u65e5\u5386", status: "pending" },
        { name: "\u64b0\u5199\u524d 3 \u7bc7 SEO \u4f18\u5316\u535a\u5ba2\u6587\u7ae0", status: "pending" },
        { name: "\u8bbe\u7f6e\u6392\u540d\u8ddf\u8e2a\u548c\u5206\u6790", status: "pending" },
      ],
      blockers: ["\u9700\u8981\u7f51\u7ad9 URL \u8fdb\u884c\u7ad9\u70b9\u5ba1\u8ba1"],
    },
    lead_prospecting: {
      plan: "\u5b9a\u4e49\u7406\u60f3\u5ba2\u6237\u753b\u50cf\uff0c\u4ece\u591a\u4e2a\u6765\u6e90\u6784\u5efa\u6f5c\u5ba2\u6570\u636e\u5e93\uff0c\u8bc4\u5206\u548c\u7b5b\u9009\u6f5c\u5ba2\uff0c\u4ea4\u4ed8\u4e30\u5bcc\u7684\u6f5c\u5ba2\u5217\u8868\u3002",
      tasks: [
        { name: "\u5b9a\u4e49\u7406\u60f3\u5ba2\u6237\u753b\u50cf\u548c\u7b5b\u9009\u6807\u51c6", status: "in_progress" },
        { name: "\u8bbe\u7f6e\u6570\u636e\u6e90\uff08LinkedIn\u3001Apollo \u7b49\uff09", status: "pending" },
        { name: "构建初始潜在客户列表", status: "pending" },
        { name: "丰富潜在客户公司和联系人数据", status: "pending" },
        { name: "评分和优先排序潜在客户", status: "pending" },
        { name: "交付合格潜在客户报告", status: "pending" },
      ],
      blockers: ["\u9700\u8981\u7406\u60f3\u5ba2\u6237\u753b\u50cf\uff08\u884c\u4e1a\u3001\u516c\u53f8\u89c4\u6a21\u3001\u804c\u4f4d\uff09"],
    },
    social_media: {
      plan: "\u8bbe\u7f6e\u54c1\u724c\u793e\u4ea4\u8d26\u53f7\uff0c\u521b\u5efa\u5185\u5bb9\u7b56\u7565\uff0c\u5b89\u6392\u53d1\u5e03\uff0c\u5e76\u5728 X/Twitter \u548c LinkedIn \u4e0a\u4e0e\u76ee\u6807\u53d7\u4f17\u4e92\u52a8\u3002",
      tasks: [
        { name: "\u5ba1\u8ba1\u73b0\u6709\u793e\u4ea4\u5a92\u4f53\u8868\u73b0", status: "in_progress" },
        { name: "\u521b\u5efa\u54c1\u724c\u58f0\u97f3\u548c\u5185\u5bb9\u6307\u5357", status: "pending" },
        { name: "\u6784\u5efa 2 \u5468\u5185\u5bb9\u961f\u5217\uff08\u5e16\u5b50\u3001\u4e3b\u9898\uff09", status: "pending" },
        { name: "\u8bbe\u7f6e\u5b9a\u65f6\u53d1\u5e03\u5de5\u5177\u96c6\u6210", status: "pending" },
        { name: "\u53d1\u8d77\u4e92\u52a8\u6d3b\u52a8\uff08\u70b9\u8d5e\u3001\u56de\u590d\u3001\u5173\u6ce8\uff09", status: "pending" },
        { name: "\u8ddf\u8e2a\u7c89\u4e1d\u589e\u957f\u548c\u4e92\u52a8\u6307\u6807", status: "pending" },
      ],
      blockers: ["\u9700\u8981 X/Twitter API \u51ed\u8bc1"],
    },
    product_manager: {
      plan: "\u76d1\u63a7\u7f51\u7ad9\u5065\u5eb7\uff0c\u5206\u6790\u7528\u6237\u884c\u4e3a\uff0c\u8ddf\u8e2a\u8f6c\u5316\u6f0f\u6597\uff0c\u5e76\u8bc6\u522b\u4f18\u5316\u673a\u4f1a\u3002",
      tasks: [
        { name: "\u8bbe\u7f6e\u7f51\u7ad9\u76d1\u63a7\uff08\u8fd0\u884c\u65f6\u95f4\u3001\u901f\u5ea6\uff09", status: "in_progress" },
        { name: "\u5b89\u88c5\u5206\u6790\u8ddf\u8e2a", status: "pending" },
        { name: "\u6620\u5c04\u8f6c\u5316\u6f0f\u6597", status: "pending" },
        { name: "\u8fdb\u884c\u521d\u59cb UX \u5ba1\u8ba1", status: "pending" },
        { name: "\u8bc6\u522b\u524d 5 \u4e2a\u8f6c\u5316\u963b\u585e\u9879", status: "pending" },
        { name: "\u521b\u5efa\u4f18\u5316\u8def\u7ebf\u56fe", status: "pending" },
      ],
      blockers: ["\u9700\u8981\u7f51\u7ad9 URL"],
    },
    sales_followup: {
      plan: "集成 CRM，设置客户跟进邮件序列，自动化跟进提醒，并跟踪交易管道。",
      tasks: [
        { name: "\u8fde\u63a5 CRM\uff08HubSpot\u3001Salesforce \u7b49\uff09", status: "pending" },
        { name: "导入现有潜在客户和交易", status: "pending" },
        { name: "\u521b\u5efa\u8ddf\u8fdb\u90ae\u4ef6\u5e8f\u5217", status: "pending" },
        { name: "\u8bbe\u7f6e\u81ea\u52a8\u63d0\u9192", status: "pending" },
        { name: "\u914d\u7f6e\u4ea4\u6613\u9636\u6bb5\u8ddf\u8e2a", status: "pending" },
        { name: "发起跟进邮件活动", status: "pending" },
      ],
      blockers: ["\u9700\u8981 CRM API \u51ed\u8bc1", "\u9700\u8981\u5f53\u524d\u9500\u552e\u7ba1\u9053\u6570\u636e"],
    },
    orchestrator: {
      plan: "协调所有项目的智能体。分析报告、识别跨智能体协同机会、生成市场情报、自动优化工作流程，并生成每周运营摘要。",
      tasks: [
        { name: "分析智能体生态系统并收集报告", status: "in_progress" },
        { name: "生成跨智能体优化建议", status: "pending" },
        { name: "市场情报与内容策略", status: "pending" },
        { name: "自动协调智能体（重置周期任务、标记阻塞）", status: "pending" },
        { name: "生成每周运营摘要", status: "pending" },
      ],
      blockers: [],
    },
  },
};

// GET: list user's projects with agent counts
export async function GET(req: NextRequest) {
  const ip = getIp(req);
  if (!checkRateLimit(ip, { limit: 30, windowMs: 60_000 })) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  const session = await auth0.getSession();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sql = getDb();
  const email = session.user.email as string;

  const users = await sql`SELECT id, plan, role FROM users WHERE email = ${email}`;
  if (users.length === 0) {
    return NextResponse.json({ projects: [], plan: "starter", agentLimit: 2, totalAgents: 0 });
  }

  const userId = users[0].id;
  const plan = await resolveUserPlan(sql, userId, (users[0].plan as string) || "starter", email);
  const role = (users[0].role as string) || "user";
  const agentLimit = PLAN_AGENT_LIMITS[plan] || 2;
  const isAdmin = role === "admin";

  // Extract email domain for domain-based project sharing (enterprise feature)
  const emailDomain = email.split("@")[1] || "";
  const projects = isAdmin
    ? await sql`SELECT id, name, website, description, ga_property_id, domain, org_id, contact_name, contact_email, contact_phone, created_at FROM projects ORDER BY created_at DESC`
    : await sql`SELECT id, name, website, description, ga_property_id, domain, org_id, contact_name, contact_email, contact_phone, created_at FROM projects WHERE user_id = ${userId} OR id IN (SELECT project_id FROM project_members WHERE user_id = ${userId}) OR (domain IS NOT NULL AND domain != '' AND domain = ${emailDomain}) OR org_id IN (SELECT org_id FROM organization_members WHERE user_id = ${userId}) ORDER BY created_at DESC`;
  const projectIds = projects.map((p) => p.id);
  const totalAgents = isAdmin
    ? await sql`SELECT COUNT(*)::int as count FROM agent_assignments`
    : projectIds.length > 0
      ? await sql`SELECT COUNT(*)::int as count FROM agent_assignments WHERE project_id = ANY(${projectIds})`
      : [{ count: 0 }];

  // Load agent assignments for each project
  const agents = projectIds.length > 0
    ? await sql`SELECT aa.id, aa.project_id, aa.agent_type, aa.status, aa.config, p.name as project_name FROM agent_assignments aa JOIN projects p ON aa.project_id = p.id WHERE aa.project_id = ANY(${projectIds}) ORDER BY aa.created_at`
    : [];

  return NextResponse.json({
    projects,
    agents,
    plan,
    role,
    agentLimit,
    totalAgents: totalAgents[0].count,
  });
}

// POST: create project or manage agents
export async function POST(req: NextRequest) {
  const ip = getIp(req);
  if (!checkRateLimit(ip, { limit: 60, windowMs: 60_000 })) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  const session = await auth0.getSession();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sql = getDb();
  const email = session.user.email as string;
  const rawBody = await req.json();
  const parsed = parseOrError(projectActionSchema, rawBody);
  if ("error" in parsed) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }
  const body = parsed.data;
  const { action } = body;

  let users = await sql`SELECT id, plan, role FROM users WHERE email = ${email}`;
  if (users.length === 0) {
    users = await sql`INSERT INTO users (email, name, auth0_id) VALUES (${email}, ${(session.user.name as string) || ""}, ${session.user.sub as string}) RETURNING id, plan, role`;
  }
  const userId = users[0].id;
  const plan = await resolveUserPlan(sql, userId, (users[0].plan as string) || "starter", email);
  const role = (users[0].role as string) || "user";
  const isAdmin = role === "admin";
  const agentLimit = isAdmin ? 999 : (PLAN_AGENT_LIMITS[plan] || 2);

  // Extract email domain for domain-based access checks
  const emailDomain = email.split("@")[1] || "";

  if (action === "create_project") {
    const { name, website, description, domain, ga_property_id } = body;
    if (!name) {
      return NextResponse.json({ error: "Project name is required" }, { status: 400 });
    }
    const project = await sql`INSERT INTO projects (user_id, name, website, description, domain, ga_property_id) VALUES (${userId}, ${name}, ${website || ""}, ${description || ""}, ${domain || null}, ${ga_property_id || null}) RETURNING id, name, website, description, domain, ga_property_id, created_at`;
    logAudit({ userId, userEmail: email, action: "project.create", resourceType: "project", resourceId: project[0].id as number, details: { name }, ipAddress: getIp(req) });
    sendWebhook("project.created", { project_id: project[0].id, name, website, description, domain, user_email: email });
    return NextResponse.json({ project: project[0] });
  }

  if (action === "activate_agent") {
    const { project_id, agent_type } = body;
    if (!project_id || !agent_type) {
      return NextResponse.json({ error: "project_id and agent_type required" }, { status: 400 });
    }
    // Verify project ownership (admin can access all)
    const proj = isAdmin
      ? await sql`SELECT id FROM projects WHERE id = ${project_id}`
      : await sql`SELECT id FROM projects WHERE id = ${project_id} AND (user_id = ${userId} OR id IN (SELECT project_id FROM project_members WHERE user_id = ${userId}) OR (domain IS NOT NULL AND domain != '' AND domain = ${emailDomain}) OR org_id IN (SELECT org_id FROM organization_members WHERE user_id = ${userId}))`;
    if (proj.length === 0) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }
    // Check limit
    const totalAgents = isAdmin
      ? await sql`SELECT COUNT(*)::int as count FROM agent_assignments`
      : await sql`SELECT COUNT(*)::int as count FROM agent_assignments aa JOIN projects p ON aa.project_id = p.id WHERE p.user_id = ${userId}`;
    if (totalAgents[0].count >= agentLimit) {
      return NextResponse.json({ error: `Agent limit reached (${agentLimit} on ${plan} plan). Upgrade to add more.` }, { status: 403 });
    }
    // Check duplicate
    const existing = await sql`SELECT id FROM agent_assignments WHERE project_id = ${project_id} AND agent_type = ${agent_type}`;
    if (existing.length > 0) {
      return NextResponse.json({ error: "Agent already assigned" }, { status: 409 });
    }
    const locale = body.locale === "zh" ? "zh" : "en";
    const localePlans = AGENT_PLANS[locale] || AGENT_PLANS.en;
    const config: Record<string, unknown> = { ...(localePlans[agent_type] || {}) };

    // Inject project metadata into agent config
    const projectMeta = await sql`SELECT website, description, name FROM projects WHERE id = ${project_id}`;
    if (projectMeta.length > 0) {
      if (projectMeta[0].website) config.website = projectMeta[0].website;
      if (projectMeta[0].description) config.project_description = projectMeta[0].description;
      if (projectMeta[0].name) config.project_name = projectMeta[0].name;
    }

    // Auto-resolve blockers if user already has the required BYOK keys
    if (config.blockers && Array.isArray(config.blockers) && config.blockers.length > 0) {
      const userKeys = await sql`SELECT service FROM user_api_keys WHERE user_id = ${userId}`;
      const keyServices = new Set(userKeys.map((k: Record<string, string>) => k.service));

      // Map blocker patterns to required BYOK services
      const blockerKeyMap: Record<string, string[]> = {
        "X/Twitter API": ["twitter_api_key", "twitter_api_secret", "twitter_access_token", "twitter_access_token_secret"],
        "Brevo": ["brevo"],
        "SendGrid": ["sendgrid"],
        "Apollo": ["apollo"],
        "Hunter": ["hunter"],
        "Snov": ["snov_api_id", "snov_api_secret"],
        "OpenAI": ["openai"],
        "Anthropic": ["anthropic"],
        "Google": ["google"],
        "Alibaba": ["alibaba"],
        "Qwen": ["alibaba"],
      };

      // ICP/audience blockers are auto-resolved — Task 0 generates ICP via AI
      const icpPattern = /target audience|ideal customer profile|ICP|理想客户|目标受众/i;
      // SMTP/email blockers can be resolved by either SendGrid or Brevo
      const emailPattern = /smtp|email.*service|邮件服务/i;
      // Website URL blockers auto-resolve if project has a website
      const websitePattern = /website url|网站\s*url|site audit|站点审计/i;

      config.blockers = (config.blockers as string[]).filter((blocker: string) => {
        // Auto-remove ICP blockers (handled by AI in task 0)
        if (icpPattern.test(blocker)) return false;

        // Auto-remove website blockers if project has a website configured
        if (websitePattern.test(blocker) && config.website) return false;

        // Auto-remove email/SMTP blockers if user has any email provider key
        if (emailPattern.test(blocker)) {
          return !(keyServices.has("sendgrid") || keyServices.has("brevo"));
        }

        for (const [pattern, requiredKeys] of Object.entries(blockerKeyMap)) {
          if (blocker.includes(pattern)) {
            return !requiredKeys.every((k) => keyServices.has(k));
          }
        }
        return true; // keep blockers that don't match any BYOK pattern
      });
    }

    await sql`INSERT INTO agent_assignments (project_id, agent_type, status, config) VALUES (${project_id}, ${agent_type}, 'active', ${JSON.stringify(config)})`;
    logAudit({ userId, userEmail: email, action: "agent.activate", resourceType: "agent", resourceId: project_id, details: { agent_type }, ipAddress: getIp(req) });
    sendWebhook("agent.activated", { project_id, agent_type, user_email: email, config });
    return NextResponse.json({ success: true });
  }

  if (action === "deactivate_agent") {
    const { agent_id } = body;
    // Verify ownership (admin can access all)
    const agent = isAdmin
      ? await sql`SELECT aa.id FROM agent_assignments aa WHERE aa.id = ${agent_id}`
      : await sql`SELECT aa.id FROM agent_assignments aa JOIN projects p ON aa.project_id = p.id WHERE aa.id = ${agent_id} AND (p.user_id = ${userId} OR p.id IN (SELECT project_id FROM project_members WHERE user_id = ${userId}) OR (p.domain IS NOT NULL AND p.domain != '' AND p.domain = ${emailDomain}) OR p.org_id IN (SELECT org_id FROM organization_members WHERE user_id = ${userId}))`;
    if (agent.length === 0) {
      return NextResponse.json({ error: "Agent not found" }, { status: 404 });
    }
    await sql`DELETE FROM agent_assignments WHERE id = ${agent_id}`;
    logAudit({ userId, userEmail: email, action: "agent.deactivate", resourceType: "agent", resourceId: agent_id, details: {}, ipAddress: getIp(req) });
    sendWebhook("agent.deactivated", { agent_id, user_email: email });
    return NextResponse.json({ success: true });
  }

  if (action === "resolve_blocker") {
    const { agent_id, blocker_index, value } = body;
    const agent = isAdmin
      ? await sql`SELECT aa.id, aa.config FROM agent_assignments aa WHERE aa.id = ${agent_id}`
      : await sql`SELECT aa.id, aa.config FROM agent_assignments aa JOIN projects p ON aa.project_id = p.id WHERE aa.id = ${agent_id} AND (p.user_id = ${userId} OR p.id IN (SELECT project_id FROM project_members WHERE user_id = ${userId}) OR (p.domain IS NOT NULL AND p.domain != '' AND p.domain = ${emailDomain}) OR p.org_id IN (SELECT org_id FROM organization_members WHERE user_id = ${userId}))`;
    if (agent.length === 0) {
      return NextResponse.json({ error: "Agent not found" }, { status: 404 });
    }
    const config = (agent[0].config as { plan?: string; tasks?: { name: string; status: string }[]; blockers?: string[] }) || {};
    const blockers = config.blockers || [];
    if (blocker_index < 0 || blocker_index >= blockers.length) {
      return NextResponse.json({ error: "Invalid blocker index" }, { status: 400 });
    }
    // Remove the blocker
    blockers.splice(blocker_index, 1);
    // Advance tasks: first in_progress -> completed, next pending -> in_progress
    const tasks = config.tasks || [];
    let advanced = false;
    for (let i = 0; i < tasks.length; i++) {
      if (tasks[i].status === "in_progress" && !advanced) {
        tasks[i].status = "completed";
        advanced = true;
      } else if (tasks[i].status === "pending" && advanced) {
        tasks[i].status = "in_progress";
        break;
      }
    }
    const updatedConfig = { ...config, blockers, tasks, ...(value ? { resolved_info: value } : {}) };
    await sql`UPDATE agent_assignments SET config = ${JSON.stringify(updatedConfig)} WHERE id = ${agent_id}`;
    logAudit({ userId, userEmail: email, action: "blocker.resolve", resourceType: "agent", resourceId: agent_id, details: { blocker_index }, ipAddress: getIp(req) });
    sendWebhook("blocker.resolved", { agent_id, blocker_index, user_email: email });
    return NextResponse.json({ success: true });
  }

  if (action === "update_agent_config") {
    const { agent_id, config: newConfig } = body;
    const agent = isAdmin
      ? await sql`SELECT aa.id, aa.config FROM agent_assignments aa WHERE aa.id = ${agent_id}`
      : await sql`SELECT aa.id, aa.config FROM agent_assignments aa JOIN projects p ON aa.project_id = p.id WHERE aa.id = ${agent_id} AND (p.user_id = ${userId} OR p.id IN (SELECT project_id FROM project_members WHERE user_id = ${userId}) OR (p.domain IS NOT NULL AND p.domain != '' AND p.domain = ${emailDomain}) OR p.org_id IN (SELECT org_id FROM organization_members WHERE user_id = ${userId}))`;
    if (agent.length === 0) {
      return NextResponse.json({ error: "Agent not found" }, { status: 404 });
    }
    const existingConfig = (agent[0].config as Record<string, unknown>) || {};
    const updatedConfig = { ...existingConfig, ...newConfig };
    await sql`UPDATE agent_assignments SET config = ${JSON.stringify(updatedConfig)} WHERE id = ${agent_id}`;
    logAudit({ userId, userEmail: email, action: "agent.config_update", resourceType: "agent", resourceId: agent_id, details: {}, ipAddress: getIp(req) });
    sendWebhook("agent.config_updated", { agent_id, user_email: email });
    return NextResponse.json({ success: true });
  }

  if (action === "update_project") {
    const { project_id, name, website, ga_property_id, description, domain, contact_name, contact_email, contact_phone } = body;
    const proj = isAdmin
      ? await sql`SELECT id FROM projects WHERE id = ${project_id}`
      : await sql`SELECT id FROM projects WHERE id = ${project_id} AND (user_id = ${userId} OR id IN (SELECT project_id FROM project_members WHERE user_id = ${userId}) OR (domain IS NOT NULL AND domain != '' AND domain = ${emailDomain}) OR org_id IN (SELECT org_id FROM organization_members WHERE user_id = ${userId}))`;
    if (proj.length === 0) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }
    await sql`UPDATE projects SET name = COALESCE(${name ?? null}, name), website = ${website ?? ""}, ga_property_id = ${ga_property_id ?? null}, description = ${description ?? ""}, domain = ${domain ?? null}, contact_name = ${contact_name ?? null}, contact_email = ${contact_email ?? null}, contact_phone = ${contact_phone ?? null} WHERE id = ${project_id}`;
    logAudit({ userId, userEmail: email, action: "project.update", resourceType: "project", resourceId: project_id, details: { name, website, ga_property_id }, ipAddress: getIp(req) });
    sendWebhook("project.updated", { project_id, name, website, ga_property_id, description, domain, contact_name, contact_email, contact_phone, user_email: email });
    return NextResponse.json({ success: true });
  }

  if (action === "delete_project") {
    const { project_id } = body;
    const proj = isAdmin
      ? await sql`SELECT id FROM projects WHERE id = ${project_id}`
      : await sql`SELECT id FROM projects WHERE id = ${project_id} AND (user_id = ${userId} OR id IN (SELECT project_id FROM project_members WHERE user_id = ${userId}) OR (domain IS NOT NULL AND domain != '' AND domain = ${emailDomain}) OR org_id IN (SELECT org_id FROM organization_members WHERE user_id = ${userId}))`;
    if (proj.length === 0) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }
    await sql`DELETE FROM agent_assignments WHERE project_id = ${project_id}`;
    await sql`DELETE FROM chat_messages WHERE project_id = ${project_id}`;
    await sql`DELETE FROM projects WHERE id = ${project_id}`;
    logAudit({ userId, userEmail: email, action: "project.delete", resourceType: "project", resourceId: project_id, details: {}, ipAddress: getIp(req) });
    sendWebhook("project.deleted", { project_id, user_email: email });
    return NextResponse.json({ success: true });
  }

  // Set project member role (owner or org admin only)
  if (action === "set_project_role") {
    const { project_id: pid, target_user_id, role: newRole } = body;
    if (!pid || !target_user_id || !["reader", "editor", "admin"].includes(newRole)) {
      return NextResponse.json({ error: "project_id, target_user_id, and role (reader/editor/admin) required" }, { status: 400 });
    }

    // Check caller is project owner or org admin
    const proj = await sql`SELECT user_id, org_id FROM projects WHERE id = ${pid}`;
    if (proj.length === 0) return NextResponse.json({ error: "Project not found" }, { status: 404 });
    const isOwner = proj[0].user_id === userId;
    const isOrgAdmin = proj[0].org_id ? (await sql`SELECT role FROM organization_members WHERE org_id = ${proj[0].org_id} AND user_id = ${userId}`)?.[0]?.role === "admin" : false;
    if (!isOwner && !isOrgAdmin && !isAdmin) {
      return NextResponse.json({ error: "Only project owner or org admin can set roles" }, { status: 403 });
    }

    await sql`
      INSERT INTO project_members (project_id, user_id, role) VALUES (${pid}, ${target_user_id}, ${newRole})
      ON CONFLICT (project_id, user_id) DO UPDATE SET role = ${newRole}
    `;
    logAudit({ userId, userEmail: email, action: "project.set_role", resourceType: "project", resourceId: pid, details: { target_user_id, role: newRole }, ipAddress: getIp(req) });
    return NextResponse.json({ success: true });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
