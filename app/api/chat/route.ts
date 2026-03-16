import { NextRequest, NextResponse } from "next/server";
import { auth0 } from "@/lib/auth0";
import { getDb, resolveUserPlan } from "@/lib/db";
import { chatWithAI, ByokKeys } from "@/lib/ai";
import { decrypt, encrypt } from "@/lib/crypto";
import { prospectDomain, prospectMultipleDomains } from "@/lib/leads";
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
      { name: "Build prospect email list (500+ contacts)", status: "pending" },
      { name: "Create email templates (cold, follow-up, newsletter)", status: "pending" },
      { name: "Configure sending schedule & limits", status: "pending" },
      { name: "Set up tracking (opens, clicks, replies)", status: "pending" },
      { name: "Launch first outreach campaign", status: "pending" },
    ],
    blockers: ["Need SMTP/email service credentials (SendGrid, Mailgun, etc.)", "Need target audience definition or ICP document"],
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
      { name: "Build initial lead list (200+ leads)", status: "pending" },
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
    blockers: ["Need X/Twitter API credentials", "Need LinkedIn page admin access"],
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
      { name: "Launch first nurture campaign", status: "pending" },
    ],
    blockers: ["Need CRM API credentials", "Need current sales pipeline data"],
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
  const { message, project_id, model: selectedModel } = await req.json();

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

  // Fetch user BYOK AI keys
  const byokRows = await sql`
    SELECT service, api_key FROM user_api_keys
    WHERE user_id = ${userId} AND service IN ('openai', 'anthropic', 'google', 'alibaba', 'cerebras')
  `;
  const byok: ByokKeys = {};
  for (const row of byokRows) {
    try {
      const key = decrypt(row.api_key as string);
      if (row.service === "openai") byok.openai = key;
      else if (row.service === "anthropic") byok.anthropic = key;
      else if (row.service === "google") byok.google = key;
      else if (row.service === "alibaba") byok.alibaba = key;
      else if (row.service === "cerebras") byok.cerebras = key;
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

  // Load context
  const projects = await sql`SELECT id, name, website, description FROM projects WHERE user_id = ${userId}`;
  const agents = await sql`
    SELECT aa.id, aa.agent_type, aa.status, aa.config, aa.project_id, p.name as project_name
    FROM agent_assignments aa
    JOIN projects p ON aa.project_id = p.id
    WHERE p.user_id = ${userId}
  `;

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

    // Save leads to paid user's project database
    async function saveLeadsToProject(leads: { email: string; firstName: string; lastName: string; company: string; position: string; source: string; confidence?: number; verified?: boolean }[], domain: string) {
      if (!isPaid || !targetProject) return;
      for (const l of leads) {
        try {
          await sql`INSERT INTO leads (project_id, user_id, email, first_name, last_name, company, position, source, domain, confidence, verified)
            VALUES (${targetProject.id}, ${userId}, ${l.email}, ${l.firstName}, ${l.lastName}, ${l.company}, ${l.position}, ${l.source}, ${domain}, ${l.confidence || null}, ${l.verified || false})
            ON CONFLICT (project_id, email) DO NOTHING`;
        } catch { /* skip duplicates */ }
      }
    }

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

          // Save to paid user's project
          await saveLeadsToProject(result.leads, domains[0]);

          reply = `**Lead search: ${domains[0]}**\n\nFound **${result.leads.length}** contacts (Apollo: ${result.apolloCount}, Hunter: ${result.hunterCount}, Snov: ${result.snovCount})\n\n| Email | Name | Position | Source |\n|-------|------|----------|--------|\n${leadTable}`;
          if (!isPaid && result.leads.length > 10) {
            reply += `\n\n_Showing 10 of ${result.leads.length} results. Upgrade to **Growth** or **Scale** to see all contacts and save to your database._`;
          }
          if (isPaid && targetProject) {
            reply += `\n\n**${result.leads.length}** contacts saved to project **${targetProject.name}**.`;
          }
          reply += `\n**${result.imported}** contacts imported to CRM.`;
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
          parts.push(`**${r.domain}** — ${r.leads.length} contacts, ${r.imported} imported\n${leadList}`);
          await saveLeadsToProject(r.leads, r.domain);
        }
        parts.push(`\n**Total: ${result.totalLeads} leads found, ${result.totalImported} imported to CRM.**`);
        if (isPaid && targetProject) {
          parts.push(`All contacts saved to project **${targetProject.name}**.`);
        } else if (!isPaid) {
          parts.push(`_Upgrade to **Growth** or **Scale** to see all contacts and save to your database._`);
        }
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

    const systemPrompt = `You are AutoClaw, an AI marketing automation assistant. You help users manage their marketing projects and agents. Respond in the same language the user uses (Chinese if they write in Chinese, English if English).

Current user context:
- Projects: ${projects.length > 0 ? projects.map((p) => `"${p.name}"${p.website ? ` (${p.website})` : ""}`).join(", ") : "none"}
- Active agents: ${agents.length > 0 ? agents.map((a) => `${a.agent_type} on ${a.project_name} [${a.status}]`).join(", ") : "none"}
- Plan: ${userPlan} (${agentLimit} agent limit)

Available agents: ${AVAILABLE_AGENTS.map((a) => `${a.label} (${a.desc})`).join(", ")}

You can help with:
- Creating projects (user describes their business, you guide them)
- Activating/deactivating agents
- Finding leads/customers for a domain (e.g. "find leads for example.com" or "找客户 example.com")
- Configuring agents by providing website URL, API keys, etc. to resolve blockers
- Checking agent status and reports
- Renaming/deleting projects

For actionable requests, guide the user to use specific commands. For example:
- "create project [name]" or describe a business to auto-create
- "activate [agent]" or "activate all"
- "find leads for example.com" to prospect leads
- "my website is https://example.com" to configure agents and resolve blockers
- "rename [old] to [new]"

${ragContext ? ragContext + "\nUse the knowledge base context above to inform your answers when relevant.\n" : ""}${projects.length === 0 ? "The user has no projects yet. Help them create one by asking about their business, or answer their question directly." : ""}
Keep responses concise and helpful. Use markdown formatting.`;

    try {
      const aiResult = await chatWithAI([
        { role: "system", content: systemPrompt },
        { role: "user", content: message },
      ], 500, byok, selectedModel);
      reply = aiResult.content;

      // Record token usage
      if (aiResult.usage) {
        sql`INSERT INTO token_usage (project_id, user_id, provider, model, prompt_tokens, completion_tokens, total_tokens, source)
            VALUES (${project_id || null}, ${userId}, ${aiResult.provider}, ${aiResult.model}, ${aiResult.usage.prompt_tokens}, ${aiResult.usage.completion_tokens}, ${aiResult.usage.total_tokens}, 'chat')`.catch(() => {});
      }
    } catch {
      reply = `I can help you with:\n\n- **Create a project** — "Create a new project called [name]"\n- **Rename a project** — "Rename demo to autoclaw-marketing"\n- **Delete a project** — "Delete project demo"\n- **Activate agents** — "Activate email marketing and SEO"\n- **Check status** — "Show me agent status"\n- **Pause agents** — "Pause email marketing"\n- **List projects** — "Show my projects"\n\nWhat would you like to do?`;
    }
  }

  // Save agent reply
  await sql`INSERT INTO chat_messages (user_id, project_id, role, content, agent_type) VALUES (${userId}, ${project_id || null}, 'assistant', ${reply}, 'autoclaw')`;

  return NextResponse.json({ reply });
}
