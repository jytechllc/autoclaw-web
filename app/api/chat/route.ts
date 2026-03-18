import { NextRequest, NextResponse } from "next/server";
import { auth0 } from "@/lib/auth0";
import { getDb, resolveUserPlan } from "@/lib/db";
import { chatWithAI, ByokKeys } from "@/lib/ai";
import { decrypt, encrypt } from "@/lib/crypto";
import { prospectDomain, prospectMultipleDomains, searchCompanies, searchGoogleApify, crawlWebsiteApify, searchLeadsApify, searchGoogleMaps, searchLeadFinder, enrichCompanyDomains, type Lead } from "@/lib/leads";
import { searchKnowledgeBase, buildRagContext } from "@/lib/rag";

export const dynamic = "force-dynamic";

const AVAILABLE_AGENTS = [
  { type: "email_marketing", label: "Email Marketing", desc: "Cold outreach, follow-ups, newsletters" },
  { type: "seo_content", label: "SEO & Content", desc: "Blog posts, keyword optimization" },
  { type: "lead_prospecting", label: "Lead Prospecting", desc: "Find qualified B2B leads" },
  { type: "social_media", label: "Social Media", desc: "X/Twitter, LinkedIn automation" },
  { type: "product_manager", label: "Product Manager", desc: "Website health, conversion tracking" },
  { type: "sales_followup", label: "Sales Follow-up", desc: "CRM updates, lead nurturing" },
];

const AGENT_PLANS: Record<string, { plan: string; tasks: { name: string; status: string }[]; blockers: string[] }> = {
  email_marketing: {
    plan: "Set up cold outreach campaign with personalized templates, build prospect email list, configure follow-up sequences, and launch newsletter.",
    tasks: [
      { name: "Research target audience & ICP", status: "in_progress" },
      { name: "Build prospect email list", status: "pending" },
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
    blockers: ["Need ideal customer profile (industry, company size, title)", "Need LinkedIn Sales Navigator or Apollo.io access"],
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
};

function matchAgentTypes(msg: string): string[] {
  const lower = msg.toLowerCase();
  const matched: string[] = [];
  for (const a of AVAILABLE_AGENTS) {
    if (
      lower.includes(a.type.replace(/_/g, " ")) ||
      lower.includes(a.label.toLowerCase()) ||
      (a.type === "email_marketing" && (lower.includes("email") || lower.includes("outreach") || lower.includes("newsletter"))) ||
      (a.type === "seo_content" && (lower.includes("seo") || lower.includes("blog") || lower.includes("content"))) ||
      (a.type === "lead_prospecting" && (lower.includes("lead") || lower.includes("prospect"))) ||
      (a.type === "social_media" && (lower.includes("social") || lower.includes("twitter") || lower.includes("linkedin"))) ||
      (a.type === "product_manager" && (lower.includes("product manager") || lower.includes("website health") || lower.includes("conversion"))) ||
      (a.type === "sales_followup" && (lower.includes("sales") || lower.includes("crm") || lower.includes("nurtur")))
    ) {
      matched.push(a.type);
    }
  }
  return matched;
}

const PLAN_AGENT_LIMITS: Record<string, number> = {
  starter: 999,
  growth: 999,
  scale: 999,
  enterprise: 999,
};

function getAgentLimit(plan: string): number {
  return PLAN_AGENT_LIMITS[plan] || 999;
}

function extractProjectInfo(msg: string): { name: string; website: string; description: string } | null {
  // Try to extract structured info from natural language
  const lines = msg.split(/\n/);
  let name = "";
  let website = "";
  let description = msg;

  for (const line of lines) {
    const lower = line.toLowerCase().trim();
    if (lower.startsWith("name:") || lower.startsWith("company:") || lower.startsWith("product:")) {
      name = line.split(":").slice(1).join(":").trim();
    } else if (lower.startsWith("website:") || lower.startsWith("url:") || lower.startsWith("site:")) {
      website = line.split(":").slice(1).join(":").trim();
    } else if (lower.startsWith("description:") || lower.startsWith("desc:") || lower.startsWith("about:")) {
      description = line.split(":").slice(1).join(":").trim();
    }
  }

  // Try to extract URL from message
  if (!website) {
    const urlMatch = msg.match(/https?:\/\/[^\s]+/);
    if (urlMatch) website = urlMatch[0];
  }

  // Try to extract a name from common patterns
  if (!name) {
    const namePatterns = [
      /(?:called?|named?|name is|company is|product is|brand is)\s+["']?([^"'\n,]+)/i,
      /(?:create|add|new)\s+(?:a\s+)?(?:new\s+)?project\s+(?:called?|named?|for)?\s*["']?([^"'\n,]+)/i,
      /(?:I run|I have|we have|we run|I own)\s+(?:an?\s+)?([^.!?\n]+)/i,
    ];
    for (const pattern of namePatterns) {
      const match = msg.match(pattern);
      if (match) {
        name = match[1].trim().slice(0, 100);
        break;
      }
    }
  }

  if (name) {
    return { name, website, description };
  }
  return null;
}

// GET: load chat history
export async function GET(req: NextRequest) {
  const session = await auth0.getSession();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sql = getDb();
  const email = session.user.email as string;

  const users = await sql`SELECT id FROM users WHERE email = ${email}`;
  if (users.length === 0) {
    return NextResponse.json({ messages: [] });
  }

  const projectId = req.nextUrl.searchParams.get("project_id");
  const messages = projectId
    ? await sql`SELECT id, role, content, agent_type, created_at FROM chat_messages WHERE user_id = ${users[0].id} AND project_id = ${parseInt(projectId)} ORDER BY created_at ASC LIMIT 100`
    : await sql`SELECT id, role, content, agent_type, created_at FROM chat_messages WHERE user_id = ${users[0].id} ORDER BY created_at ASC LIMIT 100`;

  return NextResponse.json({ messages });
}

// POST: send a message and execute actions
export async function POST(req: NextRequest) {
  const session = await auth0.getSession();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sql = getDb();
  const email = session.user.email as string;
  const { message, project_id, model: selectedModel, locale: reqLocale } = await req.json();
  const locale = (reqLocale as string) || "en";

  if (!message) {
    return NextResponse.json({ error: "Message required" }, { status: 400 });
  }

  // Find or create user
  let users = await sql`SELECT id, plan FROM users WHERE email = ${email}`;
  if (users.length === 0) {
    users = await sql`INSERT INTO users (email, name, auth0_id) VALUES (${email}, ${(session.user.name as string) || ""}, ${session.user.sub as string}) RETURNING id, plan`;
  }
  const userId = users[0].id;
  const userPlan = await resolveUserPlan(sql, userId, (users[0].plan as string) || "starter", email);
  const agentLimit = getAgentLimit(userPlan);

  // Fetch user BYOK AI keys + service keys (apify, brevo, sendgrid)
  const byokRows = await sql`
    SELECT service, api_key FROM user_api_keys
    WHERE user_id = ${userId} AND service IN ('openai', 'anthropic', 'google', 'alibaba', 'cerebras', 'apify', 'brevo', 'sendgrid')
  `;
  const byok: ByokKeys = {};
  let apifyToken = process.env.APIFY_API_TOKEN || "";
  let brevoApiKey = process.env.BREVO_API_KEY || "";
  let sendgridApiKey = process.env.SENDGRID_API_KEY || "";
  for (const row of byokRows) {
    try {
      const key = decrypt(row.api_key as string);
      if (row.service === "openai") byok.openai = key;
      else if (row.service === "anthropic") byok.anthropic = key;
      else if (row.service === "google") byok.google = key;
      else if (row.service === "alibaba") byok.alibaba = key;
      else if (row.service === "cerebras") byok.cerebras = key;
      else if (row.service === "apify") apifyToken = key;
      else if (row.service === "brevo") brevoApiKey = key;
      else if (row.service === "sendgrid") sendgridApiKey = key;
    } catch {
      // Skip keys that fail to decrypt
    }
  }

  // Daily spending limit for Starter plan ($1/day)
  const DAILY_LIMIT_CENTS: Record<string, number> = {
    starter: 100,   // $1.00
    growth: 5000,    // $50.00
    scale: 50000,    // $500.00
    enterprise: 0,   // unlimited
  };
  const dailyLimitCents = DAILY_LIMIT_CENTS[userPlan] || 100;

  if (dailyLimitCents > 0) {
    // Cost per 1M tokens (in cents) by provider — approximate
    const COST_PER_M: Record<string, { input: number; output: number }> = {
      cerebras: { input: 0, output: 0 },          // Cerebras free tier
      nvidia: { input: 0, output: 0 },            // NVIDIA free tier
      google: { input: 10, output: 40 },           // Gemini Flash
      openai: { input: 15, output: 60 },           // GPT-4o-mini (BYOK)
      anthropic: { input: 300, output: 1500 },     // Claude Sonnet (BYOK)
    };

    const todayUsage = await sql`
      SELECT provider, SUM(prompt_tokens)::int as prompt_tokens, SUM(completion_tokens)::int as completion_tokens
      FROM token_usage
      WHERE user_id = ${userId} AND source = 'chat' AND created_at::date = CURRENT_DATE
      GROUP BY provider
    `;

    let totalSpendCents = 0;
    for (const row of todayUsage) {
      const cost = COST_PER_M[row.provider as string] || COST_PER_M.google;
      totalSpendCents += ((row.prompt_tokens as number) * cost.input + (row.completion_tokens as number) * cost.output) / 1_000_000;
    }

    if (totalSpendCents >= dailyLimitCents) {
      const reply = userPlan === "starter"
        ? `You've reached your **$1.00 daily chat limit** on the Starter plan. Upgrade to Growth ($49/mo) for a higher limit, or bring your own AI key (BYOK) in Settings to use your own quota.`
        : `You've reached your daily chat limit. Please try again tomorrow or upgrade your plan.`;
      await sql`INSERT INTO chat_messages (user_id, project_id, role, content, agent_type) VALUES (${userId}, ${project_id || null}, 'assistant', ${reply}, 'autoclaw')`;
      return NextResponse.json({ reply });
    }
  }

  // Save user message (redact API keys from stored content)
  const redactedMessage = message.replace(
    /(?:add|set)\s+(?:my\s+)?key\s+(\S+)\s+(?:to|for)\s+/i,
    (match: string, key: string) => match.replace(key, key.slice(0, 4) + "***")
  ).replace(
    /(?:add|set)\s+(?:my\s+)?\S+\s+key\s+(\S+)/i,
    (match: string, key: string) => match.replace(key, key.slice(0, 4) + "***")
  );
  await sql`INSERT INTO chat_messages (user_id, project_id, role, content) VALUES (${userId}, ${project_id || null}, 'user', ${redactedMessage})`;

  // Load context — include own projects + org projects + project_members projects
  const emailDomain = email.split("@")[1] || "";
  const projects = await sql`
    SELECT DISTINCT p.id, p.name, p.website, p.description,
      CASE
        WHEN p.user_id = ${userId} THEN 'owner'
        WHEN pm.role IS NOT NULL THEN pm.role
        ELSE 'editor'
      END as access_role
    FROM projects p
    LEFT JOIN project_members pm ON pm.project_id = p.id AND pm.user_id = ${userId}
    WHERE p.user_id = ${userId}
      OR p.id IN (SELECT project_id FROM project_members WHERE user_id = ${userId})
      OR (p.domain IS NOT NULL AND p.domain != '' AND p.domain = ${emailDomain})
      OR p.org_id IN (SELECT org_id FROM organization_members WHERE user_id = ${userId})
    ORDER BY p.created_at DESC
  `;
  const projectIds = projects.map((p) => p.id);
  const agents = projectIds.length > 0
    ? await sql`
      SELECT aa.id, aa.agent_type, aa.status, aa.config, aa.project_id, p.name as project_name
      FROM agent_assignments aa
      JOIN projects p ON aa.project_id = p.id
      WHERE aa.project_id = ANY(${projectIds})
    `
    : [];

  // Next steps prompt helper — show projects with access roles
  const nextStepsHint = () => {
    const writableProjects = projects.filter((p) => p.access_role !== "reader");
    const projectList = writableProjects.map((p) => `**${p.name}**`).join(", ");
    const readOnlyProjects = projects.filter((p) => p.access_role === "reader");
    let hint = `\n\n---\n**Next steps:**\n- Save these contacts: **"save contacts to project [name]"**`;
    if (projectList) hint += `\n- Available projects: ${projectList}`;
    if (readOnlyProjects.length > 0) hint += `\n- Read-only: ${readOnlyProjects.map(p => p.name).join(", ")}`;
    hint += `\n- Enrich data: **"enrich contacts"**`;
    return hint;
  };

  // Get last assistant message for context
  const lastAssistantMsg = await sql`SELECT content FROM chat_messages WHERE user_id = ${userId} AND role = 'assistant' ORDER BY created_at DESC LIMIT 1`;
  const lastReply = lastAssistantMsg.length > 0 ? (lastAssistantMsg[0].content as string).toLowerCase() : "";

  let reply: string;
  const lowerMsg = message.toLowerCase();
  const isAffirmative = /^(yes|yeah|yep|sure|ok|okay|please|do it|go ahead|y|let's go|let's do it|absolutely|of course)\b/i.test(message.trim());

  // === CONTEXT: Handle affirmative responses based on last assistant message ===
  if (isAffirmative && lastReply.includes("would you like to assign agents") || isAffirmative && lastReply.includes("would you like to activate") || isAffirmative && lastReply.includes("which agents would you like to activate")) {
    // User said yes to assigning agents — activate all (within plan limit)
    if (projects.length > 0) {
      const targetProject = projects[projects.length - 1];
      const totalAgents = agents.length;
      const existingAgents = agents.filter((a) => a.project_id === targetProject.id).map((a) => a.agent_type);
      const newAgents = AVAILABLE_AGENTS.filter((a) => !existingAgents.includes(a.type));
      const slotsAvailable = agentLimit - totalAgents;
      const agentsToAdd = newAgents.slice(0, Math.max(0, slotsAvailable));

      if (slotsAvailable <= 0) {
        reply = `You've reached the **${agentLimit} agent limit** on your **${userPlan}** plan. Upgrade to add more agents:\n\n- **Growth** ($49/mo) — up to 10 agents\n- **Scale** ($149/mo) — unlimited agents`;
      } else {
        for (const agent of agentsToAdd) {
          const config = AGENT_PLANS[agent.type] || {};
          await sql`INSERT INTO agent_assignments (project_id, agent_type, status, config) VALUES (${targetProject.id}, ${agent.type}, 'active', ${JSON.stringify(config)})`;
        }

        const labels = agentsToAdd.map((a) => a.label);
        reply = `Activated for **${targetProject.name}**:\n${labels.map((l) => `- ${l}`).join("\n")}`;
        if (agentsToAdd.length < newAgents.length) {
          const skippedLabels = newAgents.slice(agentsToAdd.length).map((a) => a.label);
          reply += `\n\nCouldn't activate ${skippedLabels.join(", ")} — **${userPlan}** plan limit is ${agentLimit} agents. Upgrade to add more.`;
        }
        reply += `\n\nCheck the **Agents** tab for plans, execution progress, and blockers.`;
      }
    } else {
      reply = `You need a project first. Tell me about your business and I'll create one.`;
    }
  }
  // === ACTION: Configure agent / resolve blockers ===
  else if (
    agents.length > 0 && (
      lowerMsg.includes("website is") || lowerMsg.includes("网站是") || lowerMsg.includes("url is") ||
      lowerMsg.includes("my website") || lowerMsg.includes("我的网站") ||
      lowerMsg.includes("配置") || lowerMsg.includes("configure") ||
      lowerMsg.includes("set website") || lowerMsg.includes("set url") ||
      (message.match(/https?:\/\/[^\s]+/) && (lowerMsg.includes("website") || lowerMsg.includes("网站") || lowerMsg.includes("site")))
    )
  ) {
    const urlMatch = message.match(/https?:\/\/[^\s]+/);
    const resolvedBlockers: string[] = [];
    const updatedAgents: string[] = [];

    if (urlMatch) {
      const websiteUrl = urlMatch[0];
      // Update project website if not set
      if (projects.length > 0) {
        const targetProject = projects[projects.length - 1];
        if (!targetProject.website) {
          await sql`UPDATE projects SET website = ${websiteUrl} WHERE id = ${targetProject.id} AND user_id = ${userId}`;
        }
      }

      // Resolve blockers in all agents that need a website URL
      for (const agent of agents) {
        const config = agent.config as { plan?: string; tasks?: { name: string; status: string }[]; blockers?: string[] } | null;
        if (!config?.blockers) continue;

        const newBlockers = config.blockers.filter((b: string) =>
          !b.toLowerCase().includes("website url") && !b.toLowerCase().includes("website") && !b.toLowerCase().includes("need website")
        );
        if (newBlockers.length < config.blockers.length) {
          // Also advance first "in_progress" task to "completed" and next "pending" to "in_progress"
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

          const updatedConfig = { ...config, blockers: newBlockers, tasks, website: websiteUrl };
          await sql`UPDATE agent_assignments SET config = ${JSON.stringify(updatedConfig)} WHERE id = ${agent.id}`;
          const label = AVAILABLE_AGENTS.find((a) => a.type === agent.agent_type)?.label || agent.agent_type;
          updatedAgents.push(label);
          resolvedBlockers.push(`"Need website URL" resolved for **${label}**`);
        }
      }
    }

    if (resolvedBlockers.length > 0) {
      reply = `Website configured! Updated agents:\n\n${resolvedBlockers.map((b) => `- ${b}`).join("\n")}\n\nCheck the **Agents** tab to see updated progress.`;
    } else if (urlMatch) {
      reply = `Website URL saved. No agent blockers were resolved — your agents may not have pending website-related blockers.`;
    } else {
      reply = `Please provide a website URL. For example:\n\n"My website is https://example.com"\n"配置网站 https://medtravel.jytech.us"`;
    }
  }
  // === ACTION: Rename project ===
  else if (lowerMsg.includes("rename")) {
    // Match patterns like "rename X to Y", "rename project X to Y", "rename demo to autoclaw"
    const renameMatch = message.match(/rename\s+(?:project\s+)?["']?(.+?)["']?\s+to\s+["']?(.+?)["']?\s*$/i);
    if (renameMatch && projects.length > 0) {
      const oldName = renameMatch[1].trim();
      const newName = renameMatch[2].trim();
      const project = projects.find((p) => p.name.toLowerCase() === oldName.toLowerCase())
        || projects.find((p) => p.name.toLowerCase().includes(oldName.toLowerCase()));
      if (project) {
        await sql`UPDATE projects SET name = ${newName} WHERE id = ${project.id} AND user_id = ${userId}`;
        reply = `Renamed project **"${oldName}"** to **"${newName}"**.`;
      } else {
        const projectList = projects.map((p) => `- ${p.name}`).join("\n");
        reply = `Couldn't find a project called "${oldName}". Your projects:\n\n${projectList}\n\nTry: "rename [old name] to [new name]"`;
      }
    } else if (projects.length === 0) {
      reply = `You don't have any projects to rename yet.`;
    } else {
      reply = `To rename a project, say: "rename [old name] to [new name]"\n\nExample: "rename demo to autoclaw-marketing"`;
    }
  }
  // === ACTION: Delete project ===
  else if (lowerMsg.includes("delete project") || lowerMsg.includes("remove project")) {
    const deleteMatch = message.match(/(?:delete|remove)\s+project\s+["']?(.+?)["']?\s*$/i);
    if (deleteMatch && projects.length > 0) {
      const targetName = deleteMatch[1].trim();
      const project = projects.find((p) => p.name.toLowerCase() === targetName.toLowerCase())
        || projects.find((p) => p.name.toLowerCase().includes(targetName.toLowerCase()));
      if (project) {
        await sql`DELETE FROM agent_assignments WHERE project_id = ${project.id}`;
        await sql`DELETE FROM chat_messages WHERE project_id = ${project.id}`;
        await sql`DELETE FROM projects WHERE id = ${project.id} AND user_id = ${userId}`;
        reply = `Deleted project **"${project.name}"** and all its agent assignments.`;
      } else {
        const projectList = projects.map((p) => `- ${p.name}`).join("\n");
        reply = `Couldn't find a project called "${targetName}". Your projects:\n\n${projectList}`;
      }
    } else if (projects.length === 0) {
      reply = `You don't have any projects to delete.`;
    } else {
      const projectList = projects.map((p) => `- ${p.name}`).join("\n");
      reply = `Which project would you like to delete? Your projects:\n\n${projectList}\n\nSay: "delete project [name]"`;
    }
  }
  // === ACTION: Create project ===
  else if (lowerMsg.includes("create project") || lowerMsg.includes("new project") || lowerMsg.includes("add project") || (lowerMsg.includes("create a") && lowerMsg.includes("project"))) {
    const info = extractProjectInfo(message);
    if (info) {
      const newProject = await sql`INSERT INTO projects (user_id, name, website, description) VALUES (${userId}, ${info.name}, ${info.website}, ${info.description}) RETURNING id, name`;
      if (projects.length === 0) {
        reply = `I've created your project **"${newProject[0].name}"**.\n\nNow let's set up your marketing agents. Available agents:\n\n${AVAILABLE_AGENTS.map((a) => `- **${a.label}** — ${a.desc}`).join("\n")}\n\nWhich agents would you like to activate? You can say "activate all" or pick specific ones like "email marketing and SEO".`;
      } else {
        reply = `Created new project **"${newProject[0].name}"**. Would you like to assign agents to it?`;
      }
    } else {
      reply = `To create a new project, tell me:\n1. **Name** of your product/company\n2. **Website URL** (optional)\n3. **Brief description**\n\nOr just describe your business.`;
    }
  }
  // === ACTION: Activate/assign agents ===
  else if (lowerMsg.includes("activate") || lowerMsg.includes("assign") || lowerMsg.includes("enable") || lowerMsg.includes("start agent") || lowerMsg.includes("add agent")) {
    if (projects.length === 0) {
      reply = `You need a project first before activating agents. Tell me about your business and I'll create one.`;
    } else {
      const targetProject = project_id
        ? projects.find((p) => p.id === project_id) || projects[projects.length - 1]
        : projects[projects.length - 1];

      const activateAll = lowerMsg.includes("all");
      const matchedTypes = activateAll
        ? AVAILABLE_AGENTS.map((a) => a.type)
        : matchAgentTypes(message);

      if (matchedTypes.length === 0) {
        reply = `I couldn't identify which agents you'd like to activate. Available agents:\n\n${AVAILABLE_AGENTS.map((a) => `- **${a.label}** — ${a.desc}`).join("\n")}\n\nPlease specify which ones, or say "activate all".`;
      } else {
        const totalAgents = agents.length;
        const slotsAvailable = agentLimit - totalAgents;
        const existingAgents = agents
          .filter((a) => a.project_id === targetProject.id)
          .map((a) => a.agent_type);

        const newAgents = matchedTypes.filter((t) => !existingAgents.includes(t));
        const skipped = matchedTypes.filter((t) => existingAgents.includes(t));
        const agentsToAdd = newAgents.slice(0, Math.max(0, slotsAvailable));
        const blocked = newAgents.slice(Math.max(0, slotsAvailable));

        if (slotsAvailable <= 0 && newAgents.length > 0) {
          reply = `You've reached the **${agentLimit} agent limit** on your **${userPlan}** plan. Upgrade to add more:\n\n- **Growth** ($49/mo) — up to 10 agents\n- **Scale** ($149/mo) — unlimited agents`;
        } else {
          for (const agentType of agentsToAdd) {
            const config = AGENT_PLANS[agentType] || {};
            await sql`INSERT INTO agent_assignments (project_id, agent_type, status, config) VALUES (${targetProject.id}, ${agentType}, 'active', ${JSON.stringify(config)})`;
          }

          const activatedLabels = agentsToAdd.map((t) => AVAILABLE_AGENTS.find((a) => a.type === t)?.label || t);
          const skippedLabels = skipped.map((t) => AVAILABLE_AGENTS.find((a) => a.type === t)?.label || t);
          const blockedLabels = blocked.map((t) => AVAILABLE_AGENTS.find((a) => a.type === t)?.label || t);

          let parts: string[] = [];
          if (activatedLabels.length > 0) {
            parts.push(`Activated for **${targetProject.name}**:\n${activatedLabels.map((l) => `- ${l}`).join("\n")}`);
          }
          if (skippedLabels.length > 0) {
            parts.push(`Already active: ${skippedLabels.join(", ")}`);
          }
          if (blockedLabels.length > 0) {
            parts.push(`Could not activate ${blockedLabels.join(", ")} — **${userPlan}** plan limit is ${agentLimit} agents. Upgrade for more.`);
          }
          parts.push(`\nCheck the **Agents** tab for execution plans, progress, and blockers.`);
          reply = parts.join("\n\n");
        }
      }
    }
  }
  // === ACTION: Deactivate/pause/remove agents ===
  else if (lowerMsg.includes("deactivate") || lowerMsg.includes("pause") || lowerMsg.includes("stop agent") || lowerMsg.includes("remove agent") || lowerMsg.includes("disable")) {
    const matchedTypes = matchAgentTypes(message);
    const deactivateAll = lowerMsg.includes("all");

    if (agents.length === 0) {
      reply = `You don't have any active agents to deactivate.`;
    } else if (deactivateAll) {
      await sql`UPDATE agent_assignments SET status = 'paused' WHERE project_id IN (SELECT id FROM projects WHERE user_id = ${userId}) AND status = 'active'`;
      reply = `All agents have been paused. You can reactivate them anytime by saying "activate all".`;
    } else if (matchedTypes.length > 0) {
      for (const agentType of matchedTypes) {
        await sql`UPDATE agent_assignments SET status = 'paused' WHERE project_id IN (SELECT id FROM projects WHERE user_id = ${userId}) AND agent_type = ${agentType} AND status = 'active'`;
      }
      const labels = matchedTypes.map((t) => AVAILABLE_AGENTS.find((a) => a.type === t)?.label || t);
      reply = `Paused: ${labels.join(", ")}. You can reactivate them anytime.`;
    } else {
      reply = `Which agents would you like to pause?\n\n${agents.filter((a) => a.status === "active").map((a) =>`- **${a.agent_type}** (${a.project_name})`).join("\n")}`;
    }
  }
  // === ACTION: Status/report ===
  else if (lowerMsg.includes("status") || lowerMsg.includes("report") || lowerMsg.includes("how are") || lowerMsg.includes("what's running") || lowerMsg.includes("show agent")) {
    if (agents.length === 0 && projects.length === 0) {
      reply = `You don't have any projects or agents set up yet. Tell me about your business to get started!`;
    } else if (agents.length === 0) {
      reply = `You have ${projects.length} project(s) but no agents assigned yet. Would you like me to activate agents? Available:\n\n${AVAILABLE_AGENTS.map((a) => `- **${a.label}** — ${a.desc}`).join("\n")}\n\nSay "activate all" or pick specific ones.`;
    } else {
      const activeAgents = agents.filter((a) => a.status === "active");
      const pausedAgents = agents.filter((a) => a.status === "paused");

      let parts: string[] = [];
      if (activeAgents.length > 0) {
        parts.push(`**Active agents:**\n${activeAgents.map((a) =>`- ${a.agent_type} (${a.project_name})`).join("\n")}`);
      }
      if (pausedAgents.length > 0) {
        parts.push(`**Paused agents:**\n${pausedAgents.map((a) =>`- ${a.agent_type} (${a.project_name})`).join("\n")}`);
      }
      parts.push(`\nCheck the **Agents** tab for detailed reports.`);
      reply = parts.join("\n\n");
    }
  }
  // === ACTION: List projects ===
  else if (lowerMsg.includes("project") || lowerMsg.includes("my project")) {
    if (projects.length === 0) {
      reply = `You don't have any projects yet. Tell me about your business and I'll create one.`;
    } else {
      const projectList = projects.map((p) =>
        `- **${p.name}**${p.website ? ` (${p.website})` : ""}${p.description ? ` — ${p.description.slice(0, 80)}` : ""}`
      ).join("\n");
      reply = `Your projects:\n\n${projectList}\n\nSay "create project" to add another, or ask about agent status.`;
    }
  }
  // === ACTION: List available agents ===
  else if (lowerMsg.includes("agent") || lowerMsg.includes("marketing") || lowerMsg.includes("what can you") || lowerMsg.includes("help")) {
    reply = `Available AI marketing agents:\n\n${AVAILABLE_AGENTS.map((a) => `- **${a.label}** — ${a.desc}`).join("\n")}\n\n`;
    if (projects.length > 0) {
      reply += `Say "activate [agent name]" or "activate all" to assign agents to your project **${projects[projects.length - 1].name}**.`;
    } else {
      reply += `First, tell me about your business so I can create a project, then we'll activate agents.`;
    }
  }
  // === ACTION: Find leads / prospect domains ===
  else if (lowerMsg.includes("find leads") || lowerMsg.includes("prospect") || lowerMsg.includes("search domain") || lowerMsg.includes("find contacts") || lowerMsg.includes("find emails") || lowerMsg.includes("找客户") || lowerMsg.includes("找联系人") || lowerMsg.includes("搜索客户") || lowerMsg.includes("客户") && (lowerMsg.includes(".com") || lowerMsg.includes(".io") || lowerMsg.includes(".org") || lowerMsg.includes(".co") || lowerMsg.includes(".us")) || (lowerMsg.includes("look up") && (lowerMsg.includes(".com") || lowerMsg.includes(".io") || lowerMsg.includes(".org") || lowerMsg.includes(".co")))) {
    // All users can search — results auto-imported to our CRM
    const domainPattern = /([a-zA-Z0-9-]+\.[a-zA-Z]{2,}(?:\.[a-zA-Z]{2,})?)/g;
    const domains = [...message.matchAll(domainPattern)].map((m) => m[1]).filter((d) => d.includes(".") && !d.startsWith("http"));

    const isPaid = userPlan !== "starter";
    const targetProject = projects.length > 0 ? (project_id ? projects.find((p) => p.id === project_id) || projects[projects.length - 1] : projects[projects.length - 1]) : null;

    if (domains.length === 0) {
      reply = `Please provide one or more domains to search. Examples:\n\n- "Find leads for stripe.com"\n- "Prospect hubspot.com, intercom.com, calendly.com"\n- "Search domain bumrungrad.com"`;
    } else if (domains.length === 1) {
      try {
        const result = await prospectDomain(domains[0]);

        if (result.leads.length === 0) {
          reply = `**Lead search: ${domains[0]}**\n\nNo public contacts found for this domain. This can happen when:\n- The domain has few public-facing employees\n- Email addresses are well-protected\n- It's a small or personal website\n\nTry searching for **competitor or target customer domains** instead. For example, if you're in medical tourism, try:\n- "find leads for bumrungrad.com"\n- "find leads for mercy.com, clevelandclinic.org"`;
        } else {
          const displayLeads = isPaid ? result.leads : result.leads.slice(0, 10);
          const leadTable = displayLeads.map((l) => {
            const name = [l.firstName, l.lastName].filter(Boolean).join(" ") || "—";
            const badge = l.verified ? " [verified]" : l.confidence && l.confidence > 80 ? ` [${l.confidence}%]` : "";
            return `| ${l.email} | ${name} | ${l.position || "—"} | ${l.source}${badge} |`;
          }).join("\n");

          reply = `**Lead search: ${domains[0]}**\n\nFound **${result.leads.length}** contacts (Apollo: ${result.apolloCount}, Hunter: ${result.hunterCount}, Snov: ${result.snovCount})\n\n| Email | Name | Position | Source |\n|-------|------|----------|--------|\n${leadTable}`;
          if (!isPaid && result.leads.length > 10) {
            reply += `\n\n_Showing 10 of ${result.leads.length} results. Upgrade to **Growth** or **Scale** to see all contacts._`;
          }
          reply += nextStepsHint();
        }
      } catch {
        reply = `Error searching ${domains[0]}. Please try again later.`;
      }
    } else {
      try {
        const result = await prospectMultipleDomains(domains.slice(0, 5));
        const parts: string[] = [`**Lead search across ${result.results.length} domains**\n`];
        for (const r of result.results) {
          const displayLeads = isPaid ? r.leads : r.leads.slice(0, 3);
          const leadList = displayLeads.map((l) => {
            const name = [l.firstName, l.lastName].filter(Boolean).join(" ");
            return `  - ${l.email}${name ? ` (${name})` : ""}${l.position ? ` — ${l.position}` : ""}`;
          }).join("\n");
          parts.push(`**${r.domain}** — ${r.leads.length} contacts\n${leadList}`);
        }
        parts.push(`\n**Total: ${result.totalLeads} leads found.**`);
        parts.push(nextStepsHint());
        reply = parts.join("\n\n");
      } catch {
        reply = `Error searching domains. Please try again later.`;
      }
    }
  }
  // === ACTION: Add BYOK key via chat ===
  else if (
    lowerMsg.includes("add my key") || lowerMsg.includes("add key") ||
    lowerMsg.includes("set my key") || lowerMsg.includes("set key") ||
    lowerMsg.includes("添加密钥") || lowerMsg.includes("设置密钥")
  ) {
    const BYOK_SERVICES: Record<string, string> = {
      clawhub: "clawhub",
      openai: "openai",
      anthropic: "anthropic",
      google: "google",
      alibaba: "alibaba",
      qwen: "alibaba",
      dashscope: "alibaba",
      brevo: "brevo",
      apollo: "apollo",
      hunter: "hunter",
      vercel: "vercel",
      "twitter_api_key": "twitter_api_key",
      "twitter_api_secret": "twitter_api_secret",
      "twitter_access_token": "twitter_access_token",
      "twitter_access_token_secret": "twitter_access_token_secret",
      "worker_url": "worker_url",
      "worker_secret": "worker_secret",
      "cloudflare": "worker_url",
    };

    // Match: "add my key sk_xxx to openai" or "add key clh_xxx to clawhub"
    const keyMatch = message.match(/(?:add|set)\s+(?:my\s+)?key\s+(\S+)\s+(?:to|for)\s+(\S+)/i);
    // Also match: "add my openai key sk_xxx"
    const altMatch = !keyMatch ? message.match(/(?:add|set)\s+(?:my\s+)?(\S+)\s+key\s+(\S+)/i) : null;

    let apiKey: string | null = null;
    let serviceName: string | null = null;

    if (keyMatch) {
      apiKey = keyMatch[1];
      serviceName = keyMatch[2].toLowerCase();
    } else if (altMatch) {
      serviceName = altMatch[1].toLowerCase();
      apiKey = altMatch[2];
    }

    if (apiKey && serviceName && BYOK_SERVICES[serviceName]) {
      const service = BYOK_SERVICES[serviceName];
      const encryptedKey = encrypt(apiKey);
      await sql`INSERT INTO user_api_keys (user_id, service, api_key)
        VALUES (${userId}, ${service}, ${encryptedKey})
        ON CONFLICT (user_id, service) DO UPDATE SET api_key = ${encryptedKey}, updated_at = NOW()`;
      const maskedKey = apiKey.slice(0, 4) + "..." + apiKey.slice(-4);
      reply = `Your **${serviceName}** API key (\`${maskedKey}\`) has been saved securely. It's now available for use across your agents and chat.`;
    } else if (serviceName && !BYOK_SERVICES[serviceName]) {
      reply = `**${serviceName}** is not a supported BYOK service. Supported services:\n\n${Object.keys(BYOK_SERVICES).map((s) => `- **${s}**`).join("\n")}\n\nExample: "add my key clh_xxx to clawhub"`;
    } else {
      reply = `To add an API key, use this format:\n\n\`add my key <your-key> to <service>\`\n\nSupported services: ${Object.keys(BYOK_SERVICES).join(", ")}\n\nExample: "add my key clh_abc123 to clawhub"`;
    }
  }
  // === DEFAULT: AI-powered response ===
  else {
    // Try to auto-create project from description if none exist
    if (projects.length === 0 && message.length > 10) {
      const info = extractProjectInfo(message);
      if (info) {
        const newProject = await sql`INSERT INTO projects (user_id, name, website, description) VALUES (${userId}, ${info.name}, ${info.website}, ${info.description}) RETURNING id, name`;
        reply = `I've created your project **"${newProject[0].name}"**.\n\nLet's set up your marketing agents! Available:\n\n${AVAILABLE_AGENTS.map((a) => `- **${a.label}** — ${a.desc}`).join("\n")}\n\nSay "activate all" or pick specific agents like "email marketing and SEO".`;

        await sql`INSERT INTO chat_messages (user_id, project_id, role, content, agent_type) VALUES (${userId}, ${project_id || null}, 'assistant', ${reply}, 'autoclaw')`;
        return NextResponse.json({ reply });
      }
    }

    // RAG: search knowledge base for relevant context
    let ragContext = "";
    try {
      const orgRows = await sql`SELECT org_id FROM organization_members WHERE user_id = ${userId} LIMIT 1`;
      const userOrgId = orgRows.length > 0 ? (orgRows[0].org_id as number) : undefined;
      const ragResults = await searchKnowledgeBase(sql, message, {
        userId,
        orgId: userOrgId,
        projectId: project_id ? parseInt(project_id) : undefined,
        topK: 3,
        byokKeys: byok,
      });
      ragContext = buildRagContext(ragResults);
    } catch {
      // RAG unavailable (no embeddings or no pgvector), skip silently
    }

    const systemPrompt = `You are AutoClaw, an AI marketing automation assistant built by JY Tech. You help users manage their marketing projects and AI agents. Respond in the same language the user uses (Chinese if they write in Chinese, English if English, etc.).

## About AutoClaw
AutoClaw is an AI-powered marketing automation platform that deploys autonomous "AI Employees" to handle entire marketing operations 24/7. It is built and supported by JY Tech.

## Platform Capabilities
AutoClaw provides the following AI marketing agents that users can activate for their projects:
${AVAILABLE_AGENTS.map((a) => `- **${a.label}** — ${a.desc}`).join("\n")}

### What each agent can do in detail:
- **Email Marketing**: Send cold outreach emails, automated follow-up sequences (day 3, 7, 14), newsletters. Integrates with Brevo for sending. Can build prospect lists and personalize emails at scale.
- **SEO & Content**: Full SEO audits, keyword research, competitor analysis, write SEO-optimized blog posts, track rankings. Can publish content directly to user's website.
- **Lead Prospecting**: Find B2B leads using Hunter.io, Snov.io, Apollo.io. Scrape industry directories, Google Maps, LinkedIn. Enrich contacts with company data. Import to CRM. Great for finding suppliers, factories, distributors, installers, partners in any industry or region.
- **Social Media**: Manage X/Twitter and LinkedIn accounts. Create content calendars, schedule posts, engage with audiences, track follower growth.
- **Product Manager**: Monitor website uptime and speed, analyze user behavior, map conversion funnels, identify UX issues, create optimization roadmaps.
- **Sales Follow-up**: CRM integration (HubSpot, Salesforce, Twenty), automated follow-up reminders, deal pipeline tracking, lead nurture sequences.

## Important: When users ask business research questions
When users ask questions that involve finding companies, suppliers, factories, distributors, installers, partners, or any type of business contacts (e.g., "欧洲储能工厂和安装商列表", "find solar panel manufacturers in Germany", "list of EV charging station installers in France"), you should:
1. **Acknowledge** their question and briefly explain what they're looking for.
2. **Recommend using AutoClaw's Lead Prospecting agent** — explain that this agent can automatically search multiple data sources (Hunter.io, Google Maps, industry directories, LinkedIn) to find and compile the exact list they need, with contact details, company info, and enrichment data.
3. **Guide them step by step**:
   - If they don't have a project yet: suggest creating one (e.g., "create project European Energy Storage")
   - If they have a project but no Lead Prospecting agent: suggest activating it (e.g., "activate lead prospecting")
   - If they already have Lead Prospecting active: suggest using the find leads command (e.g., "find leads for [relevant domain]") or explain that the agent will automatically search based on their ICP.
4. **Also mention other relevant agents** — e.g., Email Marketing for outreach to the found leads, SEO for market research content.

Do NOT just provide a generic AI answer to business research questions. Instead, always connect the answer back to AutoClaw's capabilities and guide the user to use the platform's agents to accomplish their goal.

## Platform Documentation & Features
- **Docs page** (/docs): Guides for Google Analytics integration, organization setup, agent configuration, API integrations (Brevo, CRM, Social).
- **Enterprise Plan** (/docs/enterprise-diagram): For enterprise clients, JY Tech provides dedicated support — monitoring performance and operations, and can be invited to client-specific projects to help them grow.
- **Knowledge Base** (/dashboard/knowledge-base): Users can upload documents (PDFs, URLs, text) that the AI uses for context-aware responses (RAG).
- **API Keys** (/dashboard/api-keys): Users can bring their own AI keys (OpenAI, Anthropic, Google, etc.) for enhanced chat responses.
- **Partners** (/partners): View AutoClaw's partner ecosystem.

## Current user context
- Projects: ${projects.length > 0 ? projects.map((p) => `"${p.name}"${p.website ? ` (${p.website})` : ""}`).join(", ") : "none"}
- Active agents: ${agents.length > 0 ? agents.map((a) => `${a.agent_type} on ${a.project_name} [${a.status}]`).join(", ") : "none"}
- Plan: ${userPlan} (${agentLimit} agent limit)

## Available chat commands
Guide users to use these specific commands:
- "create project [name]" or describe a business to auto-create
- "activate [agent]" or "activate all" to enable agents
- "find leads for example.com" or "找客户 example.com" to prospect leads
- "prospect domain1.com, domain2.com" to search multiple companies
- "my website is https://example.com" to configure agents and resolve blockers
- "rename [old] to [new]" to rename projects
- "status" or "report" to check agent progress
- "add my key xxx to openai" to configure BYOK AI keys

${ragContext ? ragContext + "\nUse the knowledge base context above to inform your answers when relevant.\n" : ""}${projects.length === 0 ? "The user has no projects yet. Help them create one by asking about their business, or answer their question directly. Always connect back to how AutoClaw's agents can help.\n" : ""}
Keep responses concise and helpful. Use markdown formatting. Always be proactive in suggesting relevant AutoClaw capabilities.
${locale === "zh" ? "IMPORTANT: You MUST respond entirely in Simplified Chinese (简体中文)." : locale === "zh-TW" ? "IMPORTANT: You MUST respond entirely in Traditional Chinese (繁體中文)." : locale === "fr" ? "IMPORTANT: You MUST respond entirely in French (Français)." : ""}`;

    try {
      // === Tool-calling system: two-pass approach ===
      // Pass 1: Ask AI to decide if a tool should be called
      const toolSystemPrompt = systemPrompt + `\n
## Tool Calling
You have access to tools that can execute real searches and actions. When the user asks a question that requires searching for companies, leads, suppliers, factories, or any business entities, you MUST use a tool instead of giving a generic answer.

Available tools (ordered by priority — prefer Apify tools for searching):

### PRIMARY SEARCH TOOLS (use these first):
1. **search_lead_finder** — Find people by job title, location, and industry (BEST for "find Sales Directors in European energy companies")
   Parameters: { "job_titles": ["string"], "locations": ["string"], "industries": ["string"] }
   Use when: user asks to find people/contacts by title in a region or industry.

2. **search_google_maps** — Search for businesses/companies by category and location on Google Maps
   Parameters: { "query": "string", "max_results": number }
   Use when: user asks to find companies, factories, stores, installers, or businesses in a location.

3. **search_leads_apify** — Search for leads/contacts by industry keywords and job titles (general purpose lead search)
   Parameters: { "keywords": ["string"], "job_titles": ["string"], "industries": ["string"] }
   Use when: user asks to find companies, factories, suppliers, installers, distributors, leads, contacts, or partners in any industry/region.

4. **search_google** — Search Google for company/industry information
   Parameters: { "queries": ["string"] }
   Use when: user wants to research a company, industry trends, market info, or gather public information

3. **crawl_website** — Crawl and extract content from a website (supports JS-rendered SPAs)
   Parameters: { "url": "string" }
   Use when: user wants to analyze a website, extract product/service info, or research a specific company

### DOMAIN-SPECIFIC TOOLS:
4. **prospect_domain** — Find contacts at a specific company domain
   Parameters: { "domain": "string" }
   Use when: user provides a specific company domain (e.g. "find contacts at tesla.com")

5. **prospect_multi** — Search contacts across multiple domains
   Parameters: { "domains": ["string"] }
   Use when: user provides multiple domains to search

6. **search_companies** — Search for companies using Apollo.io (NOTE: requires Apollo paid plan for search, free plan only supports enrichment)
   Parameters: { "keywords": "string", "industry": "string", "location": "string", "titles": ["string"], "limit": number }
   Use when: user explicitly asks to use Apollo, or as a fallback if Apify is not available

### ACTION TOOLS:
9. **enrich_domains** — Enrich company domains with email patterns, contacts, and quality scores
   Parameters: { "domains": ["string"] }
   Use when: user wants to enrich/analyze company domains to find email patterns and contact info

10. **save_contacts** — Save search results to a specific project's contact list
   Parameters: { "project_name": "string", "from_last_search": true } or { "project_name": "string", "emails": ["string"] }
   Use when: user wants to save contacts. ALWAYS include project_name — ask the user which project if not specified.

8. **enrich_contacts** — Enrich prospect data with seniority, department, industry analysis
   Parameters: { "project_id": number, "limit": number }
   Use when: user wants to enrich existing contacts with AI-generated insights

9. **send_email** — Send an email to a contact via Brevo/SendGrid
   Parameters: { "to": "string", "subject": "string", "body": "string" } or { "to": ["string"], "template": "cold_outreach" }
   Use when: user wants to send an email to a prospect

IMPORTANT ROUTING RULES:
- "find people/contacts by title in a region" → search_lead_finder
- "find companies/factories/stores in a location" → search_google_maps
- When user asks to "find/search/list companies/leads/contacts" → use search_leads_apify
- "enrich these domains" → enrich_domains
- When user asks to "research/google/look up" → use search_google
- When user asks to "check/crawl/analyze a website" → use crawl_website
- Only use search_companies (Apollo) if user explicitly mentions Apollo or if Apify tools are not available

If you determine a tool should be called, respond with ONLY a JSON block in this exact format (no other text):
\`\`\`tool_call
{"tool": "tool_name", "params": {...}, "summary": "brief description of what you're searching for"}
\`\`\`

If no tool is needed, respond normally with helpful text.

Examples of when to call tools:
- "欧洲储能工厂和安装商" → search_google_maps with query="energy storage companies installers Europe"
- "Find Sales Directors at European energy companies" → search_lead_finder with job_titles=["Sales Director"], locations=["Europe"], industries=["Energy Storage"]
- "Enrich sonnen.de and fluence.com" → enrich_domains with domains=["sonnen.de","fluence.com"]
- "Find solar panel manufacturers in Germany" → search_google_maps with query="solar panel manufacturers Germany"
- "EV charging installers in France" → search_google_maps with query="EV charging installers France"
- "Find contacts at tesla.com" → prospect_domain with domain="tesla.com"
- "搜索一下特斯拉最新新闻" → search_google with queries=["Tesla latest news 2026"]
- "帮我了解一下 unincore.com 这家公司" → crawl_website with url="https://unincore.com"
- "通过Apify找储能行业的销售总监" → search_leads_apify with keywords=["energy storage"], job_titles=["Sales Director","VP Sales"]
- "Find CTOs at fintech companies" → search_leads_apify with keywords=["fintech"], job_titles=["CTO","Chief Technology Officer"]
- "把刚才搜到的联系人保存到 Unincore 项目" → save_contacts with project_name="Unincore", from_last_search=true
- "丰富一下我的潜在客户数据" → enrich_contacts with limit=20
- "给 john@acme.com 发一封介绍邮件" → send_email with to="john@acme.com", subject="...", body="..."
- "保存上次搜索的联系人" → save_contacts with from_last_search=true
- "Save those contacts" → save_contacts with from_last_search=true
- "丰富我项目中的联系人数据" → enrich_contacts with project_id (auto-detected)
- "Enrich my contacts" → enrich_contacts
- "给 john@example.com 发一封冷邮件" → send_email with to="john@example.com", subject and body generated
- "Send cold outreach to these leads" → send_email with to=[emails], template="cold_outreach"
`;

      const pass1Result = await chatWithAI([
        { role: "system", content: toolSystemPrompt },
        { role: "user", content: message },
      ], 800, byok, selectedModel);

      // Record token usage for pass 1
      if (pass1Result.usage) {
        sql`INSERT INTO token_usage (project_id, user_id, provider, model, prompt_tokens, completion_tokens, total_tokens, source)
            VALUES (${project_id || null}, ${userId}, ${pass1Result.provider}, ${pass1Result.model}, ${pass1Result.usage.prompt_tokens}, ${pass1Result.usage.completion_tokens}, ${pass1Result.usage.total_tokens}, 'chat')`.catch(() => {});
      }

      // Check if AI wants to call a tool
      const toolCallMatch = pass1Result.content.match(/```tool_call\s*\n?([\s\S]*?)\n?```/);

      if (toolCallMatch) {
        // Tool call detected — switch to SSE streaming for progress updates
        const TOOL_LABELS: Record<string, Record<string, string>> = {
          en: { search_leads_apify: "Searching for leads via Apify...", search_google: "Searching Google...", crawl_website: "Crawling website...", search_companies: "Searching companies via Apollo...", prospect_domain: "Looking up domain contacts...", prospect_multi: "Searching multiple domains...", save_contacts: "Saving contacts...", enrich_contacts: "Enriching contact data...", send_email: "Sending email...", fallback_google: "No direct results. Trying Google Search fallback...", fallback_prospect: "Found companies. Looking up contacts...", fallback_lead_finder: "Trying Lead Finder fallback...", saving: "Saving contacts to project...", search_google_maps: "Searching Google Maps...", search_lead_finder: "Finding leads by title and location...", enrich_domains: "Enriching company domains...", done: "Done!" },
          zh: { search_leads_apify: "正在通过 Apify 搜索潜在客户...", search_google: "正在搜索 Google...", crawl_website: "正在爬取网站内容...", search_companies: "正在通过 Apollo 搜索公司...", prospect_domain: "正在查找域名联系人...", prospect_multi: "正在搜索多个域名...", save_contacts: "正在保存联系人...", enrich_contacts: "正在丰富联系人数据...", send_email: "正在发送邮件...", fallback_google: "直接搜索无结果，正在尝试 Google 搜索...", fallback_prospect: "已发现公司，正在查找联系人...", fallback_lead_finder: "正在尝试 Lead Finder 备选搜索...", saving: "正在保存联系人到项目...", search_google_maps: "正在搜索 Google 地图...", search_lead_finder: "正在按职位和地区搜索联系人...", enrich_domains: "正在丰富公司域名数据...", done: "完成！" },
          "zh-TW": { search_leads_apify: "正在透過 Apify 搜尋潛在客戶...", search_google: "正在搜尋 Google...", crawl_website: "正在爬取網站內容...", search_companies: "正在透過 Apollo 搜尋公司...", prospect_domain: "正在查找網域聯絡人...", prospect_multi: "正在搜尋多個網域...", save_contacts: "正在儲存聯絡人...", enrich_contacts: "正在豐富聯絡人資料...", send_email: "正在發送郵件...", fallback_google: "直接搜尋無結果，正在嘗試 Google 搜尋...", fallback_prospect: "已發現公司，正在查找聯絡人...", fallback_lead_finder: "正在嘗試 Lead Finder 備選搜尋...", saving: "正在儲存聯絡人到專案...", search_google_maps: "正在搜尋 Google 地圖...", search_lead_finder: "正在按職位和地區搜尋聯絡人...", enrich_domains: "正在豐富公司網域資料...", done: "完成！" },
          fr: { search_leads_apify: "Recherche de prospects via Apify...", search_google: "Recherche sur Google...", crawl_website: "Exploration du site web...", search_companies: "Recherche d'entreprises via Apollo...", prospect_domain: "Recherche de contacts du domaine...", prospect_multi: "Recherche sur plusieurs domaines...", save_contacts: "Sauvegarde des contacts...", enrich_contacts: "Enrichissement des contacts...", send_email: "Envoi de l'e-mail...", fallback_google: "Aucun résultat direct. Recherche Google en cours...", fallback_prospect: "Entreprises trouvées. Recherche de contacts...", fallback_lead_finder: "Essai du Lead Finder en secours...", saving: "Sauvegarde des contacts dans le projet...", search_google_maps: "Recherche sur Google Maps...", search_lead_finder: "Recherche de contacts par titre et localisation...", enrich_domains: "Enrichissement des domaines...", done: "Terminé !" },
        };
        const tLabels = TOOL_LABELS[locale] || TOOL_LABELS.en;

        const encoder = new TextEncoder();
        const stream = new ReadableStream({
          async start(controller) {
            const sendStep = (key: string) => {
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "step", message: tLabels[key] || key })}\n\n`));
            };
            const sendDone = (reply: string) => {
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "done", reply })}\n\n`));
            };

            try {
        const toolCall = JSON.parse(toolCallMatch[1].trim());
        const toolName = toolCall.tool as string;
        const toolParams = toolCall.params || {};
        const toolSummary = (toolCall.summary as string) || "";
        sendStep(toolName);

          let toolResult = "";

          if (toolName === "search_companies") {
            const companies = await searchCompanies({
              keywords: toolParams.keywords,
              industry: toolParams.industry,
              location: toolParams.location,
              titles: toolParams.titles,
              limit: Math.min(toolParams.limit || 10, 20),
            });

            if (companies.length === 0) {
              toolResult = `No companies found matching the criteria. The search may be too specific, or the Apollo API key may not be configured.\n\nTry:\n- Broadening your search terms\n- Activating the **Lead Prospecting** agent for deeper, automated research`;
            } else {
              const isPaid = userPlan !== "starter";
              const displayCompanies = isPaid ? companies : companies.slice(0, 5);
              const companyRows = displayCompanies.map((c) => {
                const contacts = c.contacts.length > 0
                  ? c.contacts.map((ct) => `${ct.firstName} ${ct.lastName} (${ct.position}) — ${ct.email}`).join("; ")
                  : "—";
                return `| ${c.name} | ${c.domain || "—"} | ${c.industry || "—"} | ${c.location || "—"} | ${c.employeeCount || "—"} | ${contacts} |`;
              }).join("\n");

              toolResult = `**${toolSummary}**\n\nFound **${companies.length}** companies:\n\n| Company | Domain | Industry | Location | Employees | Key Contacts |\n|---------|--------|----------|----------|-----------|---------------|\n${companyRows}`;

              if (!isPaid && companies.length > 5) {
                toolResult += `\n\n_Showing 5 of ${companies.length} results. Upgrade to **Growth** or **Scale** to see all results._`;
              }

              // Prompt next steps instead of auto-saving
              const projectList = projects.map((p) => `**${p.name}** (ID: ${p.id})`).join(", ");
              toolResult += `\n\n---\n**Next steps:**\n- Save these contacts: **"save contacts to project [name]"**${projectList ? `\n- Your projects: ${projectList}` : ""}\n- Search specific domains: **"find leads for ${displayCompanies[0]?.domain || "example.com"}"**\n- Deeper research: **"activate lead prospecting"**`;
            }
          } else if (toolName === "prospect_domain") {
            const domain = toolParams.domain as string;
            if (domain) {
              const result = await prospectDomain(domain);
              if (result.leads.length === 0) {
                toolResult = `**Lead search: ${domain}**\n\nNo public contacts found for this domain.`;
              } else {
                const isPaid = userPlan !== "starter";
                const displayLeads = isPaid ? result.leads : result.leads.slice(0, 10);
                const leadTable = displayLeads.map((l) => {
                  const name = [l.firstName, l.lastName].filter(Boolean).join(" ") || "—";
                  return `| ${l.email} | ${name} | ${l.position || "—"} | ${l.source} |`;
                }).join("\n");
                toolResult = `**Lead search: ${domain}**\n\nFound **${result.leads.length}** contacts (Apollo: ${result.apolloCount}, Hunter: ${result.hunterCount}, Snov: ${result.snovCount})\n\n| Email | Name | Position | Source |\n|-------|------|----------|--------|\n${leadTable}`;
              }
            }
          } else if (toolName === "prospect_multi") {
            const domains = (toolParams.domains as string[]) || [];
            if (domains.length > 0) {
              const result = await prospectMultipleDomains(domains.slice(0, 5));
              const parts: string[] = [`**Lead search across ${result.results.length} domains**\n`];
              for (const r of result.results) {
                const leadList = r.leads.slice(0, 5).map((l) => {
                  const name = [l.firstName, l.lastName].filter(Boolean).join(" ");
                  return `  - ${l.email}${name ? ` (${name})` : ""}${l.position ? ` — ${l.position}` : ""}`;
                }).join("\n");
                parts.push(`**${r.domain}** — ${r.leads.length} contacts\n${leadList}`);
              }
              parts.push(`\n**Total: ${result.totalLeads} leads found, ${result.totalImported} imported to CRM.**`);
              toolResult = parts.join("\n\n");
            }
          } else if (toolName === "search_google") {
            // Tool 4: Google Search via Apify
            if (!apifyToken) {
              toolResult = "**Apify API key not configured.** Please add your Apify API token in Settings > API Keys (service: apify), or ask your admin to set the APIFY_API_TOKEN environment variable.";
            } else {
              const queries = (toolParams.queries as string[]) || [];
              if (queries.length === 0) {
                toolResult = "Please provide at least one search query.";
              } else {
                try {
                  const searchResult = await searchGoogleApify(apifyToken, queries.slice(0, 5));
                  toolResult = `**${toolSummary || "Google Search Results"}**\n\n${searchResult}`;
                } catch (err) {
                  toolResult = `Google search failed: ${err instanceof Error ? err.message : "Unknown error"}. Please try again.`;
                }
              }
            }
          } else if (toolName === "crawl_website") {
            // Tool 5: Website Crawler via Apify
            if (!apifyToken) {
              toolResult = "**Apify API key not configured.** Please add your Apify API token in Settings > API Keys (service: apify), or ask your admin to set the APIFY_API_TOKEN environment variable.";
            } else {
              const url = toolParams.url as string;
              if (!url) {
                toolResult = "Please provide a URL to crawl.";
              } else {
                try {
                  const content = await crawlWebsiteApify(apifyToken, url);
                  toolResult = `**Website content from ${url}**\n\n${content.substring(0, 3000)}`;
                } catch (err) {
                  toolResult = `Website crawl failed: ${err instanceof Error ? err.message : "Unknown error"}. The site may be blocking crawlers.`;
                }
              }
            }
          } else if (toolName === "search_leads_apify") {
            // Tool 6: Lead Search via Apify leads-finder
            if (!apifyToken) {
              toolResult = "**Apify API key not configured.** Please add your Apify API token in Settings > API Keys (service: apify), or ask your admin to set the APIFY_API_TOKEN environment variable.";
            } else {
              try {
                const leads = await searchLeadsApify(apifyToken, {
                  keywords: toolParams.keywords as string[],
                  job_titles: toolParams.job_titles as string[],
                  industries: toolParams.industries as string[],
                });

                if (leads.length === 0) {
                  // Fallback 1: Try search_lead_finder (crawlerbros) if job_titles provided
                  const fallbackJobTitles = toolParams.job_titles as string[] | undefined;
                  if (fallbackJobTitles && fallbackJobTitles.length > 0) {
                    try {
                      sendStep("fallback_lead_finder");
                      const lfLeads = await searchLeadFinder(apifyToken, {
                        jobTitles: fallbackJobTitles,
                        locations: (toolParams.keywords as string[]) || [],
                        industries: (toolParams.industries as string[]) || [],
                      });
                      if (lfLeads.length > 0) {
                        const isPaidLf = userPlan !== "starter";
                        const displayLeadsLf = isPaidLf ? lfLeads : lfLeads.slice(0, 10);
                        const leadTableLf = displayLeadsLf.map((l) => {
                          const name = [l.firstName, l.lastName].filter(Boolean).join(" ") || "—";
                          return `| ${name} | ${l.email || "—"} | ${l.position || "—"} | ${l.company || "—"} | ${l.linkedinUrl || "—"} |`;
                        }).join("\n");

                        toolResult = `**${toolSummary || "Lead Search (via Lead Finder fallback)"}**\n\n_Direct lead search returned no results. Fallback: Lead Finder found ${lfLeads.length} contacts._\n\n| Name | Email | Title | Company | LinkedIn |\n|------|-------|-------|---------|----------|\n${leadTableLf}`;

                        if (!isPaidLf && lfLeads.length > 10) {
                          toolResult += `\n\n_Showing 10 of ${lfLeads.length} results. Upgrade to **Growth** or **Scale** to see all results._`;
                        }

                        const projectListLfFb = projects.map((p) => `**${p.name}** (ID: ${p.id})`).join(", ");
                        toolResult += `\n\n---\n**Next steps:**\n- Save these contacts: **"save contacts to project [name]"**${projectListLfFb ? `\n- Your projects: ${projectListLfFb}` : ""}\n- Enrich data: **"enrich contacts"**`;
                      }
                    } catch { /* lead finder fallback failed, continue to Google fallback */ }
                  }

                  // Fallback 2: Google Search → AI extract company domains → prospect via Hunter/Apollo/Snov
                  if (!toolResult) {
                  const fallbackKeywords = [...(toolParams.keywords as string[] || []), ...(toolParams.industries as string[] || [])];
                  if (fallbackKeywords.length > 0) {
                    try {
                      sendStep("fallback_google");
                      const googleQueries = fallbackKeywords.slice(0, 2).map(k => `top ${k} companies Europe list`);
                      googleQueries.push(fallbackKeywords.join(" ") + " manufacturers suppliers directory");
                      const googleResults = await searchGoogleApify(apifyToken, googleQueries);

                      // Use AI to extract real company domains from Google results
                      sendStep("fallback_prospect");
                      const extractPrompt = `From the following Google search results, extract REAL company website domains (e.g. "sonnen.de", "fluence.com").
Only include actual company domains, NOT social media, news sites, directories, or generic sites.

Search results:
${googleResults.substring(0, 2000)}

Return a JSON array of domains, e.g. ["sonnen.de", "fluence.com", "byd.com"]
Return ONLY the JSON array, nothing else.`;
                      let extractedDomains: string[] = [];
                      try {
                        const extractResult = await chatWithAI([
                          { role: "system", content: "You are a data extraction assistant. Return ONLY valid JSON arrays." },
                          { role: "user", content: extractPrompt },
                        ], 300, byok, selectedModel);
                        const jsonMatch = extractResult.content.match(/\[[\s\S]*\]/);
                        if (jsonMatch) {
                          extractedDomains = (JSON.parse(jsonMatch[0]) as string[])
                            .filter(d => typeof d === "string" && d.includes(".") && d.length > 3 && d.length < 50)
                            .slice(0, 8);
                        }
                      } catch { /* extraction failed */ }

                      if (extractedDomains.length > 0) {
                        // Prospect the discovered domains
                        sendStep("fallback_prospect");
                        const domainResults: { domain: string; leads: Lead[] }[] = [];
                        for (const domain of extractedDomains.slice(0, 3)) {
                          try {
                            const { leads: domLeads } = await prospectDomain(domain);
                            if (domLeads.length > 0) domainResults.push({ domain, leads: domLeads });
                          } catch { /* skip */ }
                        }

                        if (domainResults.length > 0) {
                          const allFoundLeads = domainResults.flatMap(r => r.leads);
                          const leadTable = allFoundLeads.slice(0, 20).map(l => {
                            const name = [l.firstName, l.lastName].filter(Boolean).join(" ") || "—";
                            return `| ${l.email} | ${name} | ${l.company || "—"} | ${l.position || "—"} |`;
                          }).join("\n");

                          toolResult = `**${toolSummary || "Search Results"}**\n\n_Direct lead search returned no results. Fallback: Google Search → found ${extractedDomains.length} company domains → prospected contacts._\n\n**Discovered companies:** ${extractedDomains.join(", ")}\n\nFound **${allFoundLeads.length}** contacts:\n\n| Email | Name | Company | Position |\n|-------|------|---------|----------|\n${leadTable}`;

                          toolResult += nextStepsHint();
                        } else {
                          toolResult = `**${toolSummary || "Search Results"}**\n\nDirect lead search returned no results. Google Search found these companies: **${extractedDomains.join(", ")}**, but no public contacts were found.\n\nTry:\n- Search specific domains: "find contacts at ${extractedDomains[0]}"\n- Activate **Lead Prospecting** agent for deeper research`;
                        }
                      } else {
                        toolResult = `**${toolSummary || "Search Results"}**\n\nNo leads or companies found. Google Search also returned no relevant company domains.\n\nTry:\n- Broadening your keywords\n- Using **search_google** to research the industry first`;
                      }
                    } catch {
                      toolResult = `**${toolSummary || "Apify Lead Search"}**\n\nNo leads found, and Google fallback also failed. Try broadening your keywords or job titles.`;
                    }
                  } else {
                    toolResult = `**${toolSummary || "Apify Lead Search"}**\n\nNo leads found. Try providing more specific keywords or job titles.`;
                  }
                  } // end if (!toolResult)
                } else {
                  const isPaid = userPlan !== "starter";
                  const displayLeads = isPaid ? leads : leads.slice(0, 10);
                  const leadTable = displayLeads.map((l) => {
                    const name = [l.firstName, l.lastName].filter(Boolean).join(" ") || "—";
                    return `| ${l.email} | ${name} | ${l.company || "—"} | ${l.position || "—"} |`;
                  }).join("\n");

                  toolResult = `**${toolSummary || "Apify Lead Search"}**\n\nFound **${leads.length}** contacts:\n\n| Email | Name | Company | Position |\n|-------|------|---------|----------|\n${leadTable}`;

                  if (!isPaid && leads.length > 10) {
                    toolResult += `\n\n_Showing 10 of ${leads.length} results. Upgrade to **Growth** or **Scale** to see all results._`;
                  }

                  // Prompt next steps instead of auto-saving
                  const projectListApify = projects.map((p) => `**${p.name}** (ID: ${p.id})`).join(", ");
                  toolResult += `\n\n---\n**Next steps:**\n- Save these contacts: **"save contacts to project [name]"**${projectListApify ? `\n- Your projects: ${projectListApify}` : ""}\n- Enrich data: **"enrich contacts"**`;
                }
              } catch (err) {
                toolResult = `Apify lead search failed: ${err instanceof Error ? err.message : "Unknown error"}. Please try again.`;
              }
            }
          } else if (toolName === "search_google_maps") {
            // Tool: Google Maps search via Apify
            if (!apifyToken) {
              toolResult = "**Apify API key not configured.** Please add your Apify API token in Settings > API Keys (service: apify), or ask your admin to set the APIFY_API_TOKEN environment variable.";
            } else {
              try {
                sendStep("search_google_maps");
                const query = toolParams.query as string;
                const maxResults = (toolParams.max_results as number) || 10;
                const results = await searchGoogleMaps(apifyToken, query, maxResults);

                if (results.length === 0) {
                  toolResult = `**Google Maps search: "${query}"**\n\nNo businesses found. Try broadening your search terms or checking the location.`;
                } else {
                  const rows = results.map((r) =>
                    `| ${r.name || "—"} | ${r.website || "—"} | ${r.phone || "—"} | ${r.address || "—"} | ${r.category || "—"} |`
                  ).join("\n");

                  toolResult = `**${toolSummary || "Google Maps Search"}**\n\nFound **${results.length}** businesses:\n\n| Company | Website | Phone | Address | Category |\n|---------|---------|-------|---------|----------|\n${rows}`;

                  // Prompt next steps (NO auto-save)
                  const projectListGm = projects.map((p) => `**${p.name}** (ID: ${p.id})`).join(", ");
                  toolResult += `\n\n---\n**Next steps:**\n- Save these contacts: **"save contacts to project [name]"**${projectListGm ? `\n- Your projects: ${projectListGm}` : ""}\n- Enrich domains: **"enrich domains ${results.filter(r => r.website).slice(0, 2).map(r => { try { return new URL(r.website).hostname; } catch { return r.website; } }).join(", ")}"**\n- Search specific domains: **"find leads for [domain]"**`;
                }
              } catch (err) {
                toolResult = `Google Maps search failed: ${err instanceof Error ? err.message : "Unknown error"}. Please try again.`;
              }
            }
          } else if (toolName === "search_lead_finder") {
            // Tool: Lead Finder via Apify crawlerbros~lead-finder
            if (!apifyToken) {
              toolResult = "**Apify API key not configured.** Please add your Apify API token in Settings > API Keys (service: apify), or ask your admin to set the APIFY_API_TOKEN environment variable.";
            } else {
              try {
                sendStep("search_lead_finder");
                const leads = await searchLeadFinder(apifyToken, {
                  jobTitles: (toolParams.job_titles as string[]) || [],
                  locations: (toolParams.locations as string[]) || [],
                  industries: (toolParams.industries as string[]) || [],
                });

                if (leads.length === 0) {
                  toolResult = `**${toolSummary || "Lead Finder Search"}**\n\nNo leads found matching the criteria. Try:\n- Broadening job titles or locations\n- Using **search_leads_apify** with keywords\n- Using **search_google_maps** to find companies first`;
                } else {
                  const isPaid = userPlan !== "starter";
                  const displayLeads = isPaid ? leads : leads.slice(0, 10);
                  const leadTable = displayLeads.map((l) => {
                    const name = [l.firstName, l.lastName].filter(Boolean).join(" ") || "—";
                    return `| ${name} | ${l.email || "—"} | ${l.position || "—"} | ${l.company || "—"} | ${l.linkedinUrl || "—"} |`;
                  }).join("\n");

                  toolResult = `**${toolSummary || "Lead Finder Search"}**\n\nFound **${leads.length}** contacts:\n\n| Name | Email | Title | Company | LinkedIn |\n|------|-------|-------|---------|----------|\n${leadTable}`;

                  if (!isPaid && leads.length > 10) {
                    toolResult += `\n\n_Showing 10 of ${leads.length} results. Upgrade to **Growth** or **Scale** to see all results._`;
                  }

                  // Prompt next steps (NO auto-save)
                  const projectListLf = projects.map((p) => `**${p.name}** (ID: ${p.id})`).join(", ");
                  toolResult += `\n\n---\n**Next steps:**\n- Save these contacts: **"save contacts to project [name]"**${projectListLf ? `\n- Your projects: ${projectListLf}` : ""}\n- Enrich data: **"enrich contacts"**`;
                }
              } catch (err) {
                toolResult = `Lead Finder search failed: ${err instanceof Error ? err.message : "Unknown error"}. Please try again.`;
              }
            }
          } else if (toolName === "enrich_domains") {
            // Tool: Enrich company domains via Apify ryanclinton~b2b-lead-gen-suite
            if (!apifyToken) {
              toolResult = "**Apify API key not configured.** Please add your Apify API token in Settings > API Keys (service: apify), or ask your admin to set the APIFY_API_TOKEN environment variable.";
            } else {
              try {
                sendStep("enrich_domains");
                const domains = (toolParams.domains as string[]) || [];
                if (domains.length === 0) {
                  toolResult = "Please provide at least one domain to enrich.";
                } else {
                  const results = await enrichCompanyDomains(apifyToken, domains);

                  if (results.length === 0) {
                    toolResult = `**Domain Enrichment**\n\nNo enrichment data found for the provided domains. The domains may be unreachable or too small.`;
                  } else {
                    const parts: string[] = [`**${toolSummary || "Domain Enrichment"}**\n\nEnriched **${results.length}** domains:\n`];
                    for (const r of results) {
                      parts.push(`### ${r.domain}`);
                      parts.push(`- **Emails found:** ${r.emails.length > 0 ? r.emails.join(", ") : "None"}`);
                      parts.push(`- **Phones:** ${r.phones.length > 0 ? r.phones.join(", ") : "None"}`);
                      parts.push(`- **Email pattern:** ${r.emailPattern || "Unknown"}`);
                      parts.push(`- **Score:** ${r.score} | **Grade:** ${r.grade || "N/A"}`);
                      parts.push("");
                    }

                    toolResult = parts.join("\n");

                    // Prompt next steps (NO auto-save)
                    const projectListEd = projects.map((p) => `**${p.name}** (ID: ${p.id})`).join(", ");
                    toolResult += `\n---\n**Next steps:**\n- Save these contacts: **"save contacts to project [name]"**${projectListEd ? `\n- Your projects: ${projectListEd}` : ""}\n- Find more contacts: **"find leads for ${domains[0]}"**`;
                  }
                }
              } catch (err) {
                toolResult = `Domain enrichment failed: ${err instanceof Error ? err.message : "Unknown error"}. Please try again.`;
              }
            }
          } else if (toolName === "save_contacts") {
            // Tool 7: Save contacts — requires explicit project selection + write access
            const projectName = toolParams.project_name as string | undefined;
            const projectIdParam = toolParams.project_id as number | undefined;
            let targetProject: typeof projects[0] | undefined;

            if (projectName) {
              targetProject = projects.find((p) => (p.name as string).toLowerCase() === projectName.toLowerCase());
            } else if (projectIdParam) {
              targetProject = projects.find((p) => p.id === projectIdParam);
            } else if (project_id) {
              targetProject = projects.find((p) => p.id === project_id);
            }

            if (!targetProject) {
              const writableProjects = projects.filter((p) => p.access_role !== "reader");
              const projectList = writableProjects.map((p) => `- **${p.name}**`).join("\n");
              toolResult = projectList
                ? `Please specify which project to save to:\n\n${projectList}\n\nSay: **"save contacts to project [name]"**`
                : "No projects found. Please create a project first.";
            } else if (targetProject.access_role === "reader") {
              toolResult = `You have **read-only** access to project **${targetProject.name}**. Please ask the project owner or org admin to grant you editor access.`;
            } else {
              // Look at recent chat messages to find the last tool result with contacts
              const recentMessages = await sql`
                SELECT content FROM chat_messages
                WHERE user_id = ${userId} AND role = 'assistant'
                ORDER BY created_at DESC LIMIT 10
              `;

              // Extract emails from recent messages using regex
              const emailRegex = /[\w.+-]+@[\w-]+\.[\w.]+/g;
              const foundEmails = new Set<string>();
              for (const msg of recentMessages) {
                const matches = (msg.content as string).match(emailRegex);
                if (matches) {
                  for (const em of matches) foundEmails.add(em.toLowerCase());
                }
              }

              const requestedEmails = toolParams.emails as string[] | undefined;
              const fromLastSearch = toolParams.from_last_search as boolean;

              let emailsToSave: string[] = [];
              if (requestedEmails && requestedEmails.length > 0) {
                // Save only specified emails that exist in recent results
                emailsToSave = requestedEmails.filter((e) => foundEmails.has(e.toLowerCase()));
                if (emailsToSave.length === 0) emailsToSave = requestedEmails; // Save anyway if user specified them
              } else if (fromLastSearch) {
                emailsToSave = Array.from(foundEmails);
              }

              if (emailsToSave.length === 0) {
                toolResult = "No contacts found to save. Run a search first, then ask me to save the results.";
              } else {
                let savedCount = 0;
                for (const email of emailsToSave) {
                  try {
                    await sql`INSERT INTO contacts (user_id, project_id, email, source, source_detail)
                      VALUES (${userId}, ${targetProject.id}, ${email}, 'chat', 'Chat: manual save')
                      ON CONFLICT (user_id, email) DO NOTHING`;
                    savedCount++;
                  } catch { /* skip */ }
                }
                toolResult = `**${savedCount}** contacts saved to project **${targetProject.name}**.`;
              }
            }
          } else if (toolName === "enrich_contacts") {
            // Tool 8: Enrich contacts with AI-generated insights
            const enrichProjectId = (toolParams.project_id as number) || project_id || (projects.length > 0 ? projects[projects.length - 1].id : null);
            if (!enrichProjectId) {
              toolResult = "No project found. Please create a project first.";
            } else {
              const limit = Math.min((toolParams.limit as number) || 20, 50);
              const contacts = await sql`
                SELECT id, email, first_name, last_name, company, position, tags, notes
                FROM contacts
                WHERE user_id = ${userId} AND project_id = ${enrichProjectId} AND emails_sent = 0
                ORDER BY created_at DESC
                LIMIT ${limit}
              `;

              if (contacts.length === 0) {
                toolResult = "No contacts to enrich. All contacts have already been processed or the project has no contacts.";
              } else {
                const contactSummary = contacts.map((c) =>
                  `${c.first_name || ""} ${c.last_name || ""} | ${c.email} | ${c.company || ""} | ${c.position || ""}`
                ).join("\n");

                const enrichPrompt = `Analyze these business contacts and for each one, provide:
- seniority: (C-Level, VP, Director, Manager, Staff, Unknown)
- department: (Sales, Marketing, Engineering, Operations, Finance, HR, Executive, Unknown)
- industry: best guess of their company's industry
- priority: (high, medium, low) based on their likely decision-making power

Contacts:
${contactSummary}

Respond with a JSON array: [{"email": "...", "seniority": "...", "department": "...", "industry": "...", "priority": "..."}]`;

                try {
                  const enrichResult = await chatWithAI([
                    { role: "system", content: "You are a B2B sales intelligence analyst. Return ONLY valid JSON." },
                    { role: "user", content: enrichPrompt },
                  ], 2000, byok, selectedModel);

                  // Record token usage for enrichment
                  if (enrichResult.usage) {
                    sql`INSERT INTO token_usage (project_id, user_id, provider, model, prompt_tokens, completion_tokens, total_tokens, source)
                        VALUES (${enrichProjectId}, ${userId}, ${enrichResult.provider}, ${enrichResult.model}, ${enrichResult.usage.prompt_tokens}, ${enrichResult.usage.completion_tokens}, ${enrichResult.usage.total_tokens}, 'chat_enrich')`.catch(() => {});
                  }

                  // Parse enrichment JSON from AI response
                  const jsonMatch = enrichResult.content.match(/\[[\s\S]*\]/);
                  if (jsonMatch) {
                    const enrichments = JSON.parse(jsonMatch[0]) as { email: string; seniority: string; department: string; industry: string; priority: string }[];
                    let enrichedCount = 0;
                    for (const e of enrichments) {
                      const tags = JSON.stringify({ seniority: e.seniority, department: e.department, industry: e.industry, priority: e.priority });
                      try {
                        await sql`UPDATE contacts SET tags = ${tags}, notes = ${'AI enriched: ' + e.seniority + ' ' + e.department + ' (' + e.priority + ' priority)'}
                          WHERE user_id = ${userId} AND email = ${e.email}`;
                        enrichedCount++;
                      } catch { /* skip */ }
                    }
                    toolResult = `**Enrichment complete!** Updated **${enrichedCount}** of ${contacts.length} contacts with seniority, department, industry, and priority data.`;

                    // Show summary table
                    const summaryRows = enrichments.slice(0, 10).map((e) =>
                      `| ${e.email} | ${e.seniority} | ${e.department} | ${e.industry} | ${e.priority} |`
                    ).join("\n");
                    toolResult += `\n\n| Email | Seniority | Department | Industry | Priority |\n|-------|-----------|------------|----------|----------|\n${summaryRows}`;
                  } else {
                    toolResult = "Enrichment failed: could not parse AI response. Please try again.";
                  }
                } catch (err) {
                  toolResult = `Enrichment failed: ${err instanceof Error ? err.message : "Unknown error"}`;
                }
              }
            }
          } else if (toolName === "send_email") {
            // Tool 9: Send email via Brevo or SendGrid
            const to = toolParams.to as string | string[];
            const subject = toolParams.subject as string;
            const body = toolParams.body as string;
            const template = toolParams.template as string | undefined;

            if (!brevoApiKey && !sendgridApiKey) {
              toolResult = "**No email service configured.** Please add your Brevo or SendGrid API key in Settings > API Keys.";
            } else if (!to) {
              toolResult = "Please specify a recipient email address.";
            } else {
              const recipients = Array.isArray(to) ? to : [to];
              let sentCount = 0;
              const errors: string[] = [];

              // If template requested, generate email content via AI
              let emailSubject = subject;
              let emailBody = body;
              if (template === "cold_outreach" && (!emailSubject || !emailBody)) {
                // Load project context for personalization
                const currentProject = project_id ? projects.find((p) => p.id === project_id) : projects[projects.length - 1];
                const templatePrompt = `Generate a professional cold outreach email for B2B sales prospecting.
Project: ${currentProject?.name || "AutoClaw"}
Description: ${currentProject?.description || "Marketing automation platform"}

Write a concise, professional cold email with:
- A compelling subject line
- Personalized opening
- Clear value proposition
- Soft call to action

Return as JSON: {"subject": "...", "body": "..."}`;

                try {
                  const templateResult = await chatWithAI([
                    { role: "system", content: "You are an expert cold email copywriter. Return ONLY valid JSON." },
                    { role: "user", content: templatePrompt },
                  ], 500, byok, selectedModel);

                  const templateJson = templateResult.content.match(/\{[\s\S]*\}/);
                  if (templateJson) {
                    const parsed = JSON.parse(templateJson[0]) as { subject: string; body: string };
                    emailSubject = emailSubject || parsed.subject;
                    emailBody = emailBody || parsed.body;
                  }
                } catch {
                  // Use fallback
                  emailSubject = emailSubject || "Quick question about your business";
                  emailBody = emailBody || "Hi, I wanted to reach out about a potential collaboration opportunity.";
                }
              }

              if (!emailSubject || !emailBody) {
                toolResult = "Please provide a subject and body for the email, or use template='cold_outreach' to auto-generate.";
              } else {
                for (const recipient of recipients.slice(0, 10)) {
                  try {
                    if (brevoApiKey) {
                      // Send via Brevo
                      const res = await fetch("https://api.brevo.com/v3/smtp/email", {
                        method: "POST",
                        headers: { "api-key": brevoApiKey, "Content-Type": "application/json" },
                        body: JSON.stringify({
                          sender: { name: "AutoClaw", email: "noreply@autoclaw.com" },
                          to: [{ email: recipient }],
                          subject: emailSubject,
                          htmlContent: `<p>${emailBody.replace(/\n/g, "<br>")}</p>`,
                        }),
                      });
                      if (res.ok || res.status === 201) sentCount++;
                      else errors.push(`${recipient}: Brevo error ${res.status}`);
                    } else if (sendgridApiKey) {
                      // Send via SendGrid
                      const res = await fetch("https://api.sendgrid.com/v3/mail/send", {
                        method: "POST",
                        headers: { Authorization: `Bearer ${sendgridApiKey}`, "Content-Type": "application/json" },
                        body: JSON.stringify({
                          personalizations: [{ to: [{ email: recipient }] }],
                          from: { email: "noreply@autoclaw.com", name: "AutoClaw" },
                          subject: emailSubject,
                          content: [{ type: "text/html", value: `<p>${emailBody.replace(/\n/g, "<br>")}</p>` }],
                        }),
                      });
                      if (res.ok || res.status === 202) sentCount++;
                      else errors.push(`${recipient}: SendGrid error ${res.status}`);
                    }

                    // Update contacts.emails_sent and log to email_logs
                    sql`UPDATE contacts SET emails_sent = emails_sent + 1 WHERE user_id = ${userId} AND email = ${recipient}`.catch(() => {});
                    sql`INSERT INTO email_logs (user_id, project_id, to_email, subject, status)
                        VALUES (${userId}, ${project_id || null}, ${recipient}, ${emailSubject}, 'sent')`.catch(() => {});
                  } catch (err) {
                    errors.push(`${recipient}: ${err instanceof Error ? err.message : "Unknown error"}`);
                  }
                }

                toolResult = `**Email sent!** ${sentCount}/${recipients.length} emails delivered successfully.`;
                if (errors.length > 0) {
                  toolResult += `\n\nErrors:\n${errors.map((e) => `- ${e}`).join("\n")}`;
                }
              }
            }
          }

          sendStep("done");
          reply = toolResult || pass1Result.content.replace(/```tool_call[\s\S]*?```/, "").trim() || "I couldn't execute that search. Please try rephrasing your request.";
        } catch {
          reply = pass1Result.content.replace(/```tool_call[\s\S]*?```/, "").trim() || pass1Result.content;
        }

        // Save and stream final reply
        await sql`INSERT INTO chat_messages (user_id, project_id, role, content, agent_type) VALUES (${userId}, ${project_id || null}, 'assistant', ${reply}, 'autoclaw')`;
        sendDone(reply);
        controller.close();
          },
        });

        return new Response(stream, {
          headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" },
        });

      } else {
        // No tool call — use the AI response directly
        reply = pass1Result.content;
      }
    } catch {
      reply = `I can help you with:\n\n- **Create a project** — "Create a new project called [name]"\n- **Rename a project** — "Rename demo to autoclaw-marketing"\n- **Delete a project** — "Delete project demo"\n- **Activate agents** — "Activate email marketing and SEO"\n- **Check status** — "Show me agent status"\n- **Pause agents** — "Pause email marketing"\n- **List projects** — "Show my projects"\n\nWhat would you like to do?`;
    }
  }

  // Save agent reply (non-SSE path)
  await sql`INSERT INTO chat_messages (user_id, project_id, role, content, agent_type) VALUES (${userId}, ${project_id || null}, 'assistant', ${reply}, 'autoclaw')`;

  return NextResponse.json({ reply });
}
