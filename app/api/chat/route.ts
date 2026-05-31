export const maxDuration = 300; // Vercel Pro allows up to 300s — needed for Apify multi-step orchestration

import { NextRequest, NextResponse } from "next/server";
import { auth0 } from "@/lib/auth0";
import { getDb } from "@/lib/db";
import { chatWithTools, ByokKeys, type ToolTurnMessage, type ContentBlock } from "@/lib/ai";
import { TOOL_SCHEMAS } from "./tool-schemas";
import { checkInput, checkToolCall, checkOutput, SAFETY_SYSTEM_PROMPT } from "@/lib/guardrails";
import { decrypt, encrypt } from "@/lib/crypto";
import { prospectDomain, prospectMultipleDomains, type LeadEnrichKeys } from "@/lib/leads";
import { searchKnowledgeBase, buildRagContext } from "@/lib/rag";
import {
  AVAILABLE_AGENTS, AGENT_PLANS, BYOK_SERVICES,
  DAILY_LIMIT_CENTS, COST_PER_M, TOOL_LABELS,
  getAgentLimit, matchAgentTypes, extractProjectInfo,
  nextStepsHint, formatLeadTable,
  buildSystemPrompt, TOOL_SYSTEM_PROMPT_EXTENSION,
} from "./constants";
import { executeTool, type ToolContext } from "./tools";

export const dynamic = "force-dynamic";

// GET: load chat history
export async function GET(req: NextRequest) {
  try {
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
    const conversationId = req.nextUrl.searchParams.get("conversation_id");

    let messages;
    if (conversationId) {
      messages = await sql`SELECT id, role, content, agent_type, model, created_at FROM chat_messages WHERE user_id = ${users[0].id} AND conversation_id = ${conversationId} ORDER BY created_at ASC LIMIT 100`;
    } else if (projectId) {
      messages = await sql`SELECT id, role, content, agent_type, model, created_at FROM chat_messages WHERE user_id = ${users[0].id} AND project_id = ${projectId} AND conversation_id IS NULL ORDER BY created_at ASC LIMIT 100`;
    } else {
      messages = await sql`SELECT id, role, content, agent_type, model, created_at FROM chat_messages WHERE user_id = ${users[0].id} AND project_id IS NULL AND conversation_id IS NULL ORDER BY created_at ASC LIMIT 100`;
    }

    // Include tool execution history for the conversation
    let toolExecutions: unknown[] = [];
    if (conversationId) {
      toolExecutions = await sql`
        SELECT id, tool_name, tool_params, status, result_summary, error_message, duration_ms, created_at
        FROM tool_executions
        WHERE user_id = ${users[0].id} AND conversation_id = ${conversationId}
        ORDER BY created_at ASC
      `;
    }

    return NextResponse.json({ messages, toolExecutions });
  } catch (err) {
    console.error("[GET /api/chat]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await auth0.getSession();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const sql = getDb();
    const email = session.user.email as string;

    let body: { message?: string; project_id?: string; conversation_id?: string; model?: string; locale?: string };
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
    }

    const { message, project_id, conversation_id, model: selectedModel, locale: reqLocale } = body;
    const locale = (reqLocale as string) || "en";
    const convId = conversation_id ? parseInt(conversation_id) : null;

    if (!message || typeof message !== "string") {
      return NextResponse.json({ error: "Message required" }, { status: 400 });
    }

    // Guardrails: block prompt-injection / jailbreak attempts before any processing
    const inputGuard = checkInput(message);
    if (inputGuard.blocked) {
      return NextResponse.json({
        reply: "I can't help with that request. Let's keep things focused on your marketing work — try rephrasing what you'd like to do.",
      });
    }

    // Find or create user
    let users = await sql`SELECT id, plan FROM users WHERE email = ${email}`;
    if (users.length === 0) {
      users = await sql`INSERT INTO users (email, name, auth0_id) VALUES (${email}, ${(session.user.name as string) || ""}, ${session.user.sub as string}) RETURNING id, plan`;
    }
    const userId = users[0].id;
    const userPlan = (users[0].plan as string) || "starter";
    const agentLimit = getAgentLimit(userPlan);

    // Redact API keys from stored content
    const redactedMessage = message.replace(
      /(?:add|set)\s+(?:my\s+)?key\s+(\S+)\s+(?:to|for)\s+/i,
      (match: string, key: string) => match.replace(key, key.slice(0, 4) + "***")
    ).replace(
      /(?:add|set)\s+(?:my\s+)?\S+\s+key\s+(\S+)/i,
      (match: string, key: string) => match.replace(key, key.slice(0, 4) + "***")
    );

    const emailDomain = email.split("@")[1] || "";

    // === SINGLE TRANSACTION: batch all setup queries into 1 HTTP request ===
    // Note: history query varies by filter, so pick the right one for the transaction
    const historyQuery = convId
      ? sql`SELECT role, content FROM chat_messages WHERE user_id = ${userId} AND conversation_id = ${convId} ORDER BY created_at DESC LIMIT 6`
      : project_id
        ? sql`SELECT role, content FROM chat_messages WHERE user_id = ${userId} AND project_id = ${project_id} AND conversation_id IS NULL ORDER BY created_at DESC LIMIT 6`
        : sql`SELECT role, content FROM chat_messages WHERE user_id = ${userId} AND project_id IS NULL AND conversation_id IS NULL ORDER BY created_at DESC LIMIT 6`;

    const [byokRows, todayUsage, , projects, recentHistory] = await sql.transaction([
      sql`SELECT DISTINCT ON (service) service, api_key, label FROM (
          SELECT service, api_key, label, user_id, 0 as priority FROM user_api_keys
            WHERE service IN ('openai', 'anthropic', 'google', 'alibaba', 'cerebras', 'apify', 'tavily', 'pdl', 'brevo', 'sendgrid', 'hunter', 'apollo', 'snov_id', 'snov_secret')
            AND (user_id = ${userId} OR user_id IN (
              SELECT om2.user_id FROM organization_members om1
              JOIN organization_members om2 ON om1.org_id = om2.org_id
              WHERE om1.user_id = ${userId} AND om2.role = 'admin'
            ))
          UNION ALL
          SELECT ok.service, ok.api_key, ok.label, 0 as user_id, 1 as priority FROM org_api_keys ok
            WHERE ok.service IN ('openai', 'anthropic', 'google', 'alibaba', 'cerebras', 'apify', 'tavily', 'pdl', 'brevo', 'sendgrid', 'hunter', 'apollo', 'snov_id', 'snov_secret')
            AND ok.org_id IN (SELECT org_id FROM organization_members WHERE user_id = ${userId})
        ) combined
        ORDER BY service, priority, CASE WHEN user_id = ${userId} THEN 0 ELSE 1 END`,
      sql`SELECT provider, SUM(prompt_tokens)::int as prompt_tokens, SUM(completion_tokens)::int as completion_tokens
        FROM token_usage WHERE user_id = ${userId} AND source = 'chat' AND created_at::date = CURRENT_DATE GROUP BY provider`,
      sql`INSERT INTO chat_messages (user_id, project_id, conversation_id, role, content) VALUES (${userId}, ${project_id || null}, ${convId}, 'user', ${redactedMessage})`,
      sql`SELECT DISTINCT p.id, p.name, p.website, p.description, p.created_at,
        CASE WHEN p.user_id = ${userId} THEN 'owner' WHEN pm.role IS NOT NULL THEN pm.role ELSE 'editor' END as access_role
        FROM projects p LEFT JOIN project_members pm ON pm.project_id = p.id AND pm.user_id = ${userId}
        WHERE p.user_id = ${userId}
          OR p.id IN (SELECT project_id FROM project_members WHERE user_id = ${userId})
          OR (p.domain IS NOT NULL AND p.domain != '' AND p.domain = ${emailDomain})
          OR p.org_id IN (SELECT org_id FROM organization_members WHERE user_id = ${userId})
        ORDER BY p.created_at DESC`,
      historyQuery,
    ]);
    // conversation update deferred to final transaction

    // Parse BYOK keys and plan tiers
    const byok: ByokKeys = {};
    const enrichPlans: Record<string, string> = {};
    let apifyToken = process.env.APIFY_API_TOKEN || "";
    let brevoApiKey = process.env.BREVO_API_KEY || "";
    let sendgridApiKey = process.env.SENDGRID_API_KEY || "";
    let hunterKey = "";
    let apolloKey = "";
    let snovId = "";
    let snovSecret = "";
    for (const row of byokRows) {
      try {
        const key = decrypt(row.api_key as string);
        const label = (row.label as string) || "";
        if (row.service === "openai") byok.openai = key;
        else if (row.service === "anthropic") byok.anthropic = key;
        else if (row.service === "google") byok.google = key;
        else if (row.service === "alibaba") byok.alibaba = key;
        else if (row.service === "cerebras") byok.cerebras = key;
        else if (row.service === "apify") apifyToken = key;
        else if (row.service === "tavily") byok.tavily = key;
        else if (row.service === "firecrawl") byok.firecrawl = key;
        else if (row.service === "pdl") byok.pdl = key;
        else if (row.service === "brevo") brevoApiKey = key;
        else if (row.service === "sendgrid") sendgridApiKey = key;
        else if (row.service === "hunter") hunterKey = key;
        else if (row.service === "apollo") apolloKey = key;
        else if (row.service === "snov_id") snovId = key;
        else if (row.service === "snov_secret") snovSecret = key;
        // Extract plan tier from label (format: "plan:free", "plan:basic", etc.)
        if (label.startsWith("plan:")) {
          enrichPlans[row.service as string] = label.slice(5);
        }
      } catch { /* skip */ }
    }
    console.log(`[chat] BYOK keys loaded: apollo=${apolloKey ? "yes" : "no"} plan=${enrichPlans.apollo || "none"} tavily=${byok.tavily ? "yes" : "no"} hunter=${hunterKey ? "yes" : "no"} apify=${apifyToken ? "yes" : "no"}`);

    let usedModel: string | undefined;

    // Daily spending limit check (uses data already fetched in transaction)
    const dailyLimitCents = DAILY_LIMIT_CENTS[userPlan] || 100;
    if (dailyLimitCents > 0) {
      let totalSpendCents = 0;
      for (const row of todayUsage) {
        const cost = COST_PER_M[row.provider as string] || COST_PER_M.google;
        totalSpendCents += ((row.prompt_tokens as number) * cost.input + (row.completion_tokens as number) * cost.output) / 1_000_000;
      }
      if (totalSpendCents >= dailyLimitCents) {
        const reply = userPlan === "starter"
          ? `You've reached your **$1.00 daily chat limit** on the Starter plan. Upgrade to Growth ($79/mo) for a higher limit, or bring your own AI key (BYOK) in Settings to use your own quota.`
          : `You've reached your daily chat limit. Please try again tomorrow or upgrade your plan.`;
        await sql`INSERT INTO chat_messages (user_id, project_id, conversation_id, role, content, agent_type, model) VALUES (${userId}, ${project_id || null}, ${convId}, 'assistant', ${reply}, 'autoclaw', ${usedModel || null})`;
        return NextResponse.json({ reply });
      }
    }

    // Load agents (depends on project IDs from transaction, so separate query)
    const projectIds = projects.map((p) => p.id);
    const agents = projectIds.length > 0
      ? await sql`SELECT aa.id, aa.agent_type, aa.status, aa.config, aa.project_id, p.name as project_name
          FROM agent_assignments aa JOIN projects p ON aa.project_id = p.id
          WHERE aa.project_id = ANY(${projectIds})`
      : [];
    const lastAssistantMsg = recentHistory.find(m => m.role === "assistant");
    const lastReply = lastAssistantMsg ? (lastAssistantMsg.content as string).toLowerCase() : "";

    let reply: string;
    const pendingUsage: { provider: string; model: string; prompt: number; completion: number; total: number }[] = [];
    const lowerMsg = message.toLowerCase();
    const isAffirmative = /^(yes|yeah|yep|sure|ok|okay|please|do it|go ahead|y|let's go|let's do it|absolutely|of course|好的|好|可以|开始|行|嗯|是的|没问题|来吧|开始吧)\b/i.test(message.trim());

    // Detect if user is confirming a previously proposed search/find plan
    const isSearchPlanConfirmation = isAffirmative && (
      lastReply.includes("需要我开始") || lastReply.includes("可以开始吗") ||
      lastReply.includes("shall i") || lastReply.includes("should i start") ||
      lastReply.includes("want me to") || lastReply.includes("ready to") ||
      lastReply.includes("我计划") || lastReply.includes("i plan to") ||
      (lastReply.includes("找客户") || lastReply.includes("find customer") || lastReply.includes("find lead") || lastReply.includes("search"))
        && (lastReply.includes("?") || lastReply.includes("？"))
    );

    // === CONTEXT: Handle affirmative responses — agent activation ===
    // (skip if this is a search plan confirmation — those fall through to DEFAULT AI)
    if (!isSearchPlanConfirmation && (isAffirmative && lastReply.includes("would you like to assign agents") || isAffirmative && lastReply.includes("would you like to activate") || isAffirmative && lastReply.includes("which agents would you like to activate"))) {
      if (projects.length > 0) {
        const targetProject = projects[projects.length - 1];
        const totalAgents = agents.length;
        const existingAgents = agents.filter((a) => a.project_id === targetProject.id).map((a) => a.agent_type);
        const newAgents = AVAILABLE_AGENTS.filter((a) => !existingAgents.includes(a.type));
        const slotsAvailable = agentLimit - totalAgents;
        const agentsToAdd = newAgents.slice(0, Math.max(0, slotsAvailable));

        if (slotsAvailable <= 0) {
          reply = `You've reached the **${agentLimit} agent limit** on your **${userPlan}** plan. Upgrade to add more agents:\n\n- **Growth** ($99/mo) — up to 10 agents\n- **Scale** ($299/mo) — unlimited agents`;
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

      if (urlMatch) {
        const websiteUrl = urlMatch[0];
        if (projects.length > 0) {
          const targetProject = projects[projects.length - 1];
          if (!targetProject.website) {
            await sql`UPDATE projects SET website = ${websiteUrl} WHERE id = ${targetProject.id} AND user_id = ${userId}`;
          }
        }

        for (const agent of agents) {
          const config = agent.config as { plan?: string; tasks?: { name: string; status: string }[]; blockers?: string[] } | null;
          if (!config?.blockers) continue;

          const newBlockers = config.blockers.filter((b: string) =>
            !b.toLowerCase().includes("website url") && !b.toLowerCase().includes("website") && !b.toLowerCase().includes("need website")
          );
          if (newBlockers.length < config.blockers.length) {
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
          const existingAgents = agents.filter((a) => a.project_id === targetProject.id).map((a) => a.agent_type);
          const newAgents = matchedTypes.filter((t) => !existingAgents.includes(t));
          const skipped = matchedTypes.filter((t) => existingAgents.includes(t));
          const agentsToAdd = newAgents.slice(0, Math.max(0, slotsAvailable));
          const blocked = newAgents.slice(Math.max(0, slotsAvailable));

          if (slotsAvailable <= 0 && newAgents.length > 0) {
            reply = `You've reached the **${agentLimit} agent limit** on your **${userPlan}** plan. Upgrade to add more:\n\n- **Growth** ($99/mo) — up to 10 agents\n- **Scale** ($299/mo) — unlimited agents`;
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
    else if ((lowerMsg.includes("project") || lowerMsg.includes("my project")) && !lowerMsg.includes("save") && !lowerMsg.includes("保存")) {
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
    // "帮我找客户" / "帮 xxx 找客户" / "find customers for xxx" → fall through to AI (context-aware)
    // "find contacts at xxx.com" / "find leads for xxx.com" = find contacts AT a domain → direct prospect
    else if (
      !lowerMsg.match(/帮.*(我|.+)找客户/) && !lowerMsg.match(/(find|help).*(me|my|us)\s+(customers|clients|leads)/i) && !lowerMsg.match(/for\s+\S+\.\S+\s+find\s+(customers|clients)/) &&
      (lowerMsg.includes("find leads") || lowerMsg.includes("prospect") || lowerMsg.includes("search domain") || lowerMsg.includes("find contacts") || lowerMsg.includes("find emails") || lowerMsg.includes("找联系人") || lowerMsg.includes("搜索客户") ||
      lowerMsg.includes("客户") && (lowerMsg.includes(".com") || lowerMsg.includes(".io") || lowerMsg.includes(".org") || lowerMsg.includes(".co") || lowerMsg.includes(".us")) ||
      (lowerMsg.includes("look up") && (lowerMsg.includes(".com") || lowerMsg.includes(".io") || lowerMsg.includes(".org") || lowerMsg.includes(".co"))))
    ) {
      const domainPattern = /([a-zA-Z0-9-]+\.[a-zA-Z]{2,}(?:\.[a-zA-Z]{2,})?)/g;
      const domains = [...message.matchAll(domainPattern)].map((m) => m[1]).filter((d) => d.includes(".") && !d.startsWith("http"));
      const isPaid = userPlan !== "starter";

      if (domains.length === 0) {
        reply = `Please provide one or more domains to search. Examples:\n\n- "Find leads for stripe.com"\n- "Prospect hubspot.com, intercom.com, calendly.com"\n- "Search domain bumrungrad.com"`;
      } else if (domains.length === 1) {
        try {
          const domain = domains[0];
          const directEnrichKeys: LeadEnrichKeys = { hunter: hunterKey || undefined, apollo: apolloKey || undefined, snovId: snovId || undefined, snovSecret: snovSecret || undefined, pdl: byok.pdl || undefined, plans: Object.keys(enrichPlans).length > 0 ? enrichPlans : undefined };
          const result = await prospectDomain(domain, directEnrichKeys, { skipBrevo: true });

          // Record enrichment usage
          for (const s of result.stats) {
            sql`INSERT INTO enrichment_usage (user_id, provider, domain, results_count, status, error_message)
              VALUES (${userId}, ${s.provider}, ${domain}, ${s.count}, ${s.error ? (s.error.includes("429") || s.error.includes("exceeded") ? "quota_exceeded" : "error") : "ok"}, ${s.error || null})
            `.catch(() => {});
          }

          // Supplement with user's contacts database
          let contactsCount = 0;
          try {
            const domainPattern = `%@${domain}`;
            const contactRows = await sql`
              SELECT email, first_name, last_name, company, position, phone
              FROM contacts WHERE user_id = ${userId} AND email ILIKE ${domainPattern} LIMIT 20
            `;
            const existingEmails = new Set(result.leads.map((l: { email: string }) => l.email.toLowerCase()));
            for (const row of contactRows) {
              const email = (row.email as string).toLowerCase();
              if (!existingEmails.has(email)) {
                result.leads.push({
                  email,
                  firstName: (row.first_name as string) || "",
                  lastName: (row.last_name as string) || "",
                  company: (row.company as string) || domain,
                  position: (row.position as string) || "",
                  phone: (row.phone as string) || undefined,
                  source: "contacts" as "hunter",
                  verified: true,
                });
                contactsCount++;
              }
            }
          } catch { /* ignore contacts lookup */ }

          // Search knowledge base for relevant info about the domain
          let kbContext = "";
          try {
            const kbResults = await searchKnowledgeBase(sql, domain, { userId, topK: 3 });
            if (kbResults.length > 0) {
              kbContext = `\n\n---\n**From your knowledge base:**\n` + kbResults.map((r: { title?: string; content: string }) =>
                `- **${r.title || "Note"}**: ${r.content.substring(0, 200)}${r.content.length > 200 ? "..." : ""}`
              ).join("\n");
            }
          } catch { /* ignore KB lookup */ }

          if (result.leads.length === 0) {
            reply = `**Lead search: ${domain}**\n\nNo public contacts found for this domain. This can happen when:\n- The domain has few public-facing employees\n- Email addresses are well-protected\n- It's a small or personal website\n\nTry searching for **competitor or target customer domains** instead.${kbContext}`;
          } else {
            const sources = `Apollo: ${result.apolloCount}, Hunter: ${result.hunterCount}, Snov: ${result.snovCount}${contactsCount > 0 ? `, Contacts: ${contactsCount}` : ""}`;
            const displayLeads = isPaid ? result.leads : result.leads.slice(0, 10);
            const leadTable = formatLeadTable(displayLeads);
            reply = `**Lead search: ${domain}**\n\nFound **${result.leads.length}** contacts (${sources})\n\n| Email | Name | Phone | Position | Source |\n|-------|------|-------|----------|--------|\n${leadTable}`;
            if (!isPaid && result.leads.length > 10) {
              reply += `\n\n_Showing 10 of ${result.leads.length} results. Upgrade to **Growth** or **Scale** to see all contacts._`;
            }
            reply += kbContext;
            reply += nextStepsHint(projects);
          }
        } catch {
          reply = `Error searching ${domains[0]}. Please try again later.`;
        }
      } else {
        try {
          const multiEnrichKeys: LeadEnrichKeys = { hunter: hunterKey || undefined, apollo: apolloKey || undefined, snovId: snovId || undefined, snovSecret: snovSecret || undefined, pdl: byok.pdl || undefined, plans: Object.keys(enrichPlans).length > 0 ? enrichPlans : undefined };
          const result = await prospectMultipleDomains(domains.slice(0, 5), multiEnrichKeys);
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
          parts.push(nextStepsHint(projects));
          reply = parts.join("\n\n");
        } catch {
          reply = `Error searching domains. Please try again later.`;
        }
      }
    }
    // === ACTION: Save contacts to project ===
    else if (
      lowerMsg.includes("save contacts") || lowerMsg.includes("save leads") ||
      lowerMsg.includes("保存联系人") || lowerMsg.includes("保存客户") ||
      (lowerMsg.includes("save") && lowerMsg.includes("to project"))
    ) {
      // Extract project name from message
      const projectNameMatch = message.match(/(?:to project|to\s+)[""]?([^"""]+?)[""]?\s*$/i)
        || message.match(/(?:保存.*到|保存到)\s*[""]?(.+?)[""]?\s*(?:项目)?\s*$/);
      const projectName = projectNameMatch?.[1]?.trim();

      const enrichKeys: LeadEnrichKeys = { hunter: hunterKey || undefined, apollo: apolloKey || undefined, snovId: snovId || undefined, snovSecret: snovSecret || undefined, pdl: byok.pdl || undefined, plans: Object.keys(enrichPlans).length > 0 ? enrichPlans : undefined };
      const toolCtx: ToolContext = {
        sql, userId, userPlan, projects, agents, project_id: project_id || null,
        byok, selectedModel: selectedModel || "", apifyToken, brevoApiKey, sendgridApiKey, enrichKeys, sendStep: () => {},
      };
      reply = await executeTool("save_contacts", {
        project_name: projectName || undefined,
        from_last_search: true,
      }, "Save contacts", toolCtx);
    }
    // === ACTION: Add BYOK key via chat ===
    else if (
      lowerMsg.includes("add my key") || lowerMsg.includes("add key") ||
      lowerMsg.includes("set my key") || lowerMsg.includes("set key") ||
      lowerMsg.includes("添加密钥") || lowerMsg.includes("设置密钥")
    ) {
      const keyMatch = message.match(/(?:add|set)\s+(?:my\s+)?key\s+(\S+)\s+(?:to|for)\s+(\S+)/i);
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

          await sql`INSERT INTO chat_messages (user_id, project_id, conversation_id, role, content, agent_type, model) VALUES (${userId}, ${project_id || null}, ${convId}, 'assistant', ${reply}, 'autoclaw', ${usedModel || null})`;
          return NextResponse.json({ reply });
        }
      }

      // RAG: search knowledge base
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
        // RAG unavailable, skip
      }

      const systemPrompt = buildSystemPrompt({ projects, agents, userPlan, agentLimit, ragContext, locale });
      const toolSystemPrompt = systemPrompt + SAFETY_SYSTEM_PROMPT + TOOL_SYSTEM_PROMPT_EXTENSION;

      try {
        // Build conversation messages with recent history for context
        const chatMessages: { role: "system" | "user" | "assistant"; content: string }[] = [
          { role: "system", content: toolSystemPrompt },
        ];
        // Include recent history (reversed to chronological order) so AI knows what was discussed
        const historyForContext = recentHistory.slice().reverse();
        for (const msg of historyForContext) {
          // Skip the current user message (it's the last one we just saved)
          if (msg.role === "user" && msg.content === redactedMessage) continue;
          chatMessages.push({ role: msg.role as "user" | "assistant", content: (msg.content as string).slice(0, 500) });
        }
        chatMessages.push({ role: "user", content: message });

        // Build tool-turn messages (text-only history + current user message)
        const turnMessages: ToolTurnMessage[] = chatMessages
          .filter((m) => m.role !== "system")
          .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));

        const pass1Start = Date.now();
        const pass1 = await chatWithTools(toolSystemPrompt, turnMessages, TOOL_SCHEMAS, 800, byok, selectedModel);
        usedModel = `${pass1.provider}/${pass1.model}`;
        const pass1Ms = Date.now() - pass1Start;

        // Collect token usage to batch-insert at the end (avoids per-step subrequests)
        if (pass1.usage) {
          pendingUsage.push({ provider: pass1.provider, model: pass1.model, prompt: pass1.usage.prompt_tokens, completion: pass1.usage.completion_tokens, total: pass1.usage.total_tokens });
        }

        // === ORCHESTRATOR LOOP: AI decides tools via native function calling, executes, reviews, continues ===
        const hasTools = pass1.toolUses.length > 0;

        if (hasTools) {
          const tLabels = TOOL_LABELS[locale] || TOOL_LABELS.en;
          const encoder = new TextEncoder();
          const stream = new ReadableStream({
            async start(controller) {
              const enrichProviderLabels: Record<string, Record<string, string>> = {
                en: { apollo: "Enriching via Apollo...", hunter: "Enriching via Hunter...", snov: "Enriching via Snov..." },
                zh: { apollo: "正在通过 Apollo 增强...", hunter: "正在通过 Hunter 增强...", snov: "正在通过 Snov 增强..." },
                "zh-TW": { apollo: "正在透過 Apollo 增強...", hunter: "正在透過 Hunter 增強...", snov: "正在透過 Snov 增強..." },
                fr: { apollo: "Enrichissement via Apollo...", hunter: "Enrichissement via Hunter...", snov: "Enrichissement via Snov..." },
              };
              const enrichResultLabels: Record<string, string> = {
                en: "Enrichment results", zh: "增强结果", "zh-TW": "增強結果", fr: "Résultats d'enrichissement",
              };
              const eProv = enrichProviderLabels[locale] || enrichProviderLabels.en;
              const eResLabel = enrichResultLabels[locale] || enrichResultLabels.en;

              const sendStep = (key: string) => {
                addTrace("step", key);
                if (key.startsWith("enrich_providers:")) {
                  const providers = key.slice(17).split(",");
                  const msg = providers.map((p) => eProv[p] || p).join(" ");
                  controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "step", message: msg })}\n\n`));
                } else if (key.startsWith("enrich_results:")) {
                  controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "step", message: `${eResLabel}: ${key.slice(15)}` })}\n\n`));
                } else {
                  controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "step", message: tLabels[key] || key })}\n\n`));
                }
              };
              const sendError = (toolLabel: string, errorMsg: string) => {
                controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "step_error", tool: toolLabel, error: errorMsg })}\n\n`));
              };
              const sendWarning = (msg: string) => {
                controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "warning", message: msg })}\n\n`));
              };
              const isDev = process.env.NODE_ENV === "development";
              const debugTrace: { ts: number; event: string; detail?: string; ms?: number }[] = [];
              const traceStart = Date.now();
              const addTrace = (event: string, detail?: string) => {
                debugTrace.push({ ts: Date.now() - traceStart, event, detail });
              };
              addTrace("start", `user=${email} plan=${userPlan} model=${selectedModel || "auto"}`);
              addTrace("pass1_ai", `model=${pass1.model} provider=${pass1.provider} tokens=${pass1.usage?.total_tokens || 0} ms=${pass1Ms} has_tool=${hasTools}`);
              if (pass1.fallbackWarning) sendWarning("⚠️ Native tools unavailable, using text-protocol fallback");

              const sendDone = (finalReply: string, model?: string) => {
                addTrace("done", `total=${Date.now() - traceStart}ms`);
                // Summarize token usage and cost
                const totalTokens = pendingUsage.reduce((s, u) => s + u.total, 0);
                const totalPrompt = pendingUsage.reduce((s, u) => s + u.prompt, 0);
                const totalCompletion = pendingUsage.reduce((s, u) => s + u.completion, 0);
                const costMap: Record<string, { input: number; output: number }> = {
                  cerebras: { input: 0, output: 0 }, nvidia: { input: 0, output: 0 },
                  google: { input: 0.05, output: 0.05 }, openai: { input: 12.5, output: 50 },
                  anthropic: { input: 15, output: 75 },
                };
                const estCost = pendingUsage.reduce((s, u) => {
                  const c = costMap[u.provider] || { input: 0, output: 0 };
                  return s + (u.prompt * c.input + u.completion * c.output) / 1_000_000;
                }, 0);
                const usage = { totalTokens, promptTokens: totalPrompt, completionTokens: totalCompletion, estCost: Math.round(estCost * 10000) / 10000, calls: pendingUsage.length };
                const payload: Record<string, unknown> = { type: "done", reply: finalReply, model, usage };
                if (isDev) payload.debug = debugTrace;
                controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
              };

              const enrichKeys: LeadEnrichKeys = { hunter: hunterKey || undefined, apollo: apolloKey || undefined, snovId: snovId || undefined, snovSecret: snovSecret || undefined, pdl: byok.pdl || undefined, plans: Object.keys(enrichPlans).length > 0 ? enrichPlans : undefined };
              const toolCtx: ToolContext = {
                sql, userId, userPlan, projects, agents, project_id: project_id || null,
                byok, selectedModel: selectedModel || "", apifyToken, brevoApiKey, sendgridApiKey, enrichKeys, sendStep,
              };

              // Structured orchestrator: native tool_use blocks instead of text parsing
              const MAX_STEPS = 8;
              let current = pass1;
              let finalReply = "";
              const toolResultParts: string[] = []; // collect all tool outputs for the final reply
              const executedKeys = new Set<string>(); // de-dupe identical tool calls to prevent loops

              try {
                for (let step = 0; step < MAX_STEPS; step++) {
                  if (current.toolUses.length === 0) {
                    // AI decided no more tools needed — use its text as the final summary
                    const aiText = current.text.trim();
                    if (aiText && step > 0) {
                      finalReply = toolResultParts.join("\n\n---\n\n") + "\n\n---\n\n" + aiText;
                    } else if (toolResultParts.length > 0) {
                      finalReply = toolResultParts.join("\n\n---\n\n");
                    } else {
                      finalReply = aiText || "I couldn't execute that request. Please try rephrasing.";
                    }
                    break;
                  }

                  // Record the assistant turn (text + tool_use blocks) for the next round
                  const assistantBlocks: ContentBlock[] = [];
                  if (current.text.trim()) assistantBlocks.push({ type: "text", text: current.text });
                  for (const tu of current.toolUses) assistantBlocks.push({ type: "tool_use", id: tu.id, name: tu.name, input: tu.input });
                  turnMessages.push({ role: "assistant", content: assistantBlocks });

                  // Execute each requested tool (native tool use can request several at once)
                  const resultBlocks: ContentBlock[] = [];
                  for (const tu of current.toolUses) {
                    let toolResult = "";
                    let toolError: string | null = null;
                    const dedupeKey = `${tu.name}:${JSON.stringify(tu.input)}`;

                    if (executedKeys.has(dedupeKey)) {
                      toolError = "Already executed with identical parameters — skipped to avoid a loop.";
                    } else {
                      executedKeys.add(dedupeKey);
                      const policy = checkToolCall(tu.name, tu.input); // guardrails: allow-list + high-risk checks
                      if (!policy.allowed) {
                        toolError = policy.reason || "Blocked by guardrails.";
                        sendError(tLabels[tu.name] || tu.name, toolError);
                      } else {
                        sendStep(tu.name);
                        const toolStart = Date.now();
                        addTrace("tool_start", `${tu.name} params=${JSON.stringify(tu.input).substring(0, 200)}`);
                        try {
                          toolResult = await executeTool(tu.name, tu.input, "", toolCtx);
                          addTrace("tool_done", `${tu.name} result_len=${toolResult.length} ms=${Date.now() - toolStart}`);
                        } catch (toolErr) {
                          toolError = toolErr instanceof Error ? toolErr.message : "Tool execution failed";
                          addTrace("tool_error", `${tu.name} error=${toolError} ms=${Date.now() - toolStart}`);
                          sendError(tLabels[tu.name] || tu.name, toolError);
                        }
                      }
                    }

                    if (toolError) {
                      toolResultParts.push(`**${tu.name}** — Error: ${toolError}`);
                    } else if (toolResult && toolResult.length > 10) {
                      toolResultParts.push(toolResult);
                    }
                    resultBlocks.push({ type: "tool_result", tool_use_id: tu.id, content: toolError ? `Error: ${toolError}` : (toolResult || "No results found.").substring(0, 3000) });
                  }
                  turnMessages.push({ role: "user", content: resultBlocks });

                  // Ask the AI for the next step
                  sendStep("orchestrating");
                  const aiStart = Date.now();
                  current = await chatWithTools(toolSystemPrompt, turnMessages, TOOL_SCHEMAS, 800, byok, selectedModel);
                  addTrace("ai_call", `model=${current.model} provider=${current.provider} tokens=${current.usage?.total_tokens || 0} ms=${Date.now() - aiStart}`);

                  if (current.fallbackWarning) {
                    sendWarning(current.fallbackWarning.includes("429") ? "⚠️ AI quota exceeded, switched to backup model" : "⚠️ AI service issue, switched to backup model");
                  }
                  if (current.usage) {
                    pendingUsage.push({ provider: current.provider, model: current.model, prompt: current.usage.prompt_tokens, completion: current.usage.completion_tokens, total: current.usage.total_tokens });
                  }
                }

                // Safety: if loop exhausted, use what we have
                if (!finalReply) {
                  finalReply = toolResultParts.length > 0
                    ? toolResultParts.join("\n\n---\n\n")
                    : (current.text.trim() || "Search completed.");
                }
              } catch (err) {
                console.error("[Orchestrator error]", err instanceof Error ? err.message : err);
                finalReply = toolResultParts.length > 0
                  ? toolResultParts.join("\n\n---\n\n")
                  : (pass1.text.trim() || "Search encountered an error. Please try again.");
              }

              reply = checkOutput(finalReply).text;
              sendStep("done");

              // Batch: save reply + all pending token usage in 1 transaction
              const txnQueries = [
                sql`INSERT INTO chat_messages (user_id, project_id, conversation_id, role, content, agent_type, model) VALUES (${userId}, ${project_id || null}, ${convId}, 'assistant', ${reply}, 'autoclaw', ${usedModel || null})`,
              ];
              for (const u of pendingUsage) {
                txnQueries.push(sql`INSERT INTO token_usage (project_id, user_id, provider, model, prompt_tokens, completion_tokens, total_tokens, source) VALUES (${project_id || null}, ${userId}, ${u.provider}, ${u.model}, ${u.prompt}, ${u.completion}, ${u.total}, 'chat')`);
              }
              await sql.transaction(txnQueries);

              sendDone(reply, usedModel);
              controller.close();
            },
          });

          return new Response(stream, {
            headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" },
          });
        } else {
          // No tool call — use the AI response directly
          reply = checkOutput(pass1.text).text;
        }
      } catch (aiErr) {
        const errDetail = aiErr instanceof Error ? aiErr.message : String(aiErr);
        console.error("[AI chat error]", errDetail);
        // Show specific error to user so they can diagnose (rate limits, key issues, etc.)
        if (errDetail.includes("All AI providers failed")) {
          reply = `**AI service temporarily unavailable.**\n\n${errDetail.split("\n").map(l => `- ${l}`).join("\n")}\n\nThis is usually caused by rate limits (429) or invalid API keys. Try again in a moment, or check your API key configuration in Settings.`;
        } else {
          reply = `**Error:** ${errDetail.slice(0, 500)}\n\nPlease try again. If this persists, check your API key configuration in Settings.`;
        }
      }
    }

    // Save agent reply (non-SSE path) — guardrail: strip tool_call text + mask secrets
    const cleanReply = checkOutput(reply).text || reply;
    await sql`INSERT INTO chat_messages (user_id, project_id, conversation_id, role, content, agent_type) VALUES (${userId}, ${project_id || null}, ${convId}, 'assistant', ${cleanReply}, 'autoclaw')`;
    // Usage summary for non-SSE path
    const totalTokens = pendingUsage.reduce((s, u) => s + u.total, 0);
    const costMap: Record<string, { input: number; output: number }> = {
      cerebras: { input: 0, output: 0 }, nvidia: { input: 0, output: 0 },
      google: { input: 0.05, output: 0.05 }, openai: { input: 12.5, output: 50 },
      anthropic: { input: 15, output: 75 },
    };
    const estCost = pendingUsage.reduce((s, u) => {
      const c = costMap[u.provider] || { input: 0, output: 0 };
      return s + (u.prompt * c.input + u.completion * c.output) / 1_000_000;
    }, 0);
    const usage = { totalTokens, promptTokens: pendingUsage.reduce((s, u) => s + u.prompt, 0), completionTokens: pendingUsage.reduce((s, u) => s + u.completion, 0), estCost: Math.round(estCost * 10000) / 10000, calls: pendingUsage.length };
    return NextResponse.json({ reply: cleanReply, model: usedModel, usage });

  } catch (err) {
    console.error("[POST /api/chat]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
