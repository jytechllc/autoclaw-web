export const AVAILABLE_AGENTS = [
  { type: "email_marketing", label: "Email Marketing", desc: "Cold outreach, follow-ups, newsletters" },
  { type: "seo_content", label: "SEO & Content", desc: "Blog posts, keyword optimization" },
  { type: "lead_prospecting", label: "Lead Prospecting", desc: "Find qualified B2B leads" },
  { type: "social_media", label: "Social Media", desc: "X/Twitter, LinkedIn automation" },
  { type: "product_manager", label: "Product Manager", desc: "Website health, conversion tracking" },
  { type: "sales_followup", label: "Sales Follow-up", desc: "CRM updates, lead nurturing" },
];

export const AGENT_PLANS: Record<string, { plan: string; tasks: { name: string; status: string }[]; blockers: string[] }> = {
  email_marketing: {
    plan: "Build prospect email list from project contacts, create personalized templates, configure follow-up sequences, and launch newsletter. Depends on Lead Prospecting for ICP data.",
    tasks: [
      { name: "Build prospect email list from existing contacts", status: "in_progress" },
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
      { name: "Keyword research", status: "pending" },
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

const PLAN_AGENT_LIMITS: Record<string, number> = {
  starter: 999,
  growth: 999,
  scale: 999,
  enterprise: 999,
};

export function getAgentLimit(plan: string): number {
  return PLAN_AGENT_LIMITS[plan] || 999;
}

export function matchAgentTypes(msg: string): string[] {
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

export function extractProjectInfo(msg: string): { name: string; website: string; description: string } | null {
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

  if (!website) {
    const urlMatch = msg.match(/https?:\/\/[^\s]+/);
    if (urlMatch) website = urlMatch[0];
  }

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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ProjectRow = Record<string, any>;

export function nextStepsHint(projects: ProjectRow[]) {
  const writableProjects = projects.filter((p) => p.access_role !== "reader");
  const projectList = writableProjects.map((p) => `**${p.name}**`).join(", ");
  const readOnlyProjects = projects.filter((p) => p.access_role === "reader");
  let hint = `\n\n---\n**Next steps:**\n- Save these contacts: **"save contacts to project [name]"**`;
  if (projectList) hint += `\n- Available projects: ${projectList}`;
  if (readOnlyProjects.length > 0) hint += `\n- Read-only: ${readOnlyProjects.map(p => p.name).join(", ")}`;
  hint += `\n- Enrich data: **"enrich contacts"**`;
  return hint;
}

export function formatLeadTable(leads: { email: string; firstName?: string; lastName?: string; position?: string; phone?: string; source?: string; company?: string; confidence?: number; verified?: boolean; linkedinUrl?: string }[], format: "standard" | "lead_finder" = "standard") {
  if (format === "lead_finder") {
    return leads.map((l) => {
      const name = [l.firstName, l.lastName].filter(Boolean).join(" ") || "—";
      return `| ${name} | ${l.email || "—"} | ${l.phone || "—"} | ${l.position || "—"} | ${l.company || "—"} | ${l.linkedinUrl || "—"} |`;
    }).join("\n");
  }
  return leads.map((l) => {
    const name = [l.firstName, l.lastName].filter(Boolean).join(" ") || "—";
    const badge = l.verified ? " [verified]" : l.confidence && l.confidence > 80 ? ` [${l.confidence}%]` : "";
    return `| ${l.email} | ${name} | ${l.phone || "—"} | ${l.position || "—"} | ${l.source || "—"}${badge} |`;
  }).join("\n");
}

export const BYOK_SERVICES: Record<string, string> = {
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
  snov_id: "snov_id",
  snov_secret: "snov_secret",
  snov: "snov_id",
  tavily: "tavily",
  firecrawl: "firecrawl",
  xai: "xai",
  z_ai: "xai",
  grok: "xai",
  pdl: "pdl",
  "people_data_labs": "pdl",
  vercel: "vercel",
  "twitter_api_key": "twitter_api_key",
  "twitter_api_secret": "twitter_api_secret",
  "twitter_access_token": "twitter_access_token",
  "twitter_access_token_secret": "twitter_access_token_secret",
  "worker_url": "worker_url",
  "worker_secret": "worker_secret",
  "cloudflare": "worker_url",
};

export const DAILY_LIMIT_CENTS: Record<string, number> = {
  starter: 100,
  growth: 5000,
  scale: 50000,
  enterprise: 0,
};

export const COST_PER_M: Record<string, { input: number; output: number }> = {
  cerebras: { input: 0, output: 0 },
  nvidia: { input: 0, output: 0 },
  google: { input: 10, output: 40 },
  openai: { input: 15, output: 60 },
  anthropic: { input: 300, output: 1500 },
};

export const TOOL_LABELS: Record<string, Record<string, string>> = {
  en: { search_leads: "Searching for leads...", search_google: "Searching Google...", crawl_website: "Crawling website...", search_companies: "Searching companies via Apollo...", prospect_domain: "Looking up domain contacts...", prospect_multi: "Searching multiple domains...", save_contacts: "Saving contacts...", enrich_contacts: "Enriching contact data...", send_email: "Sending email...", fallback_google: "No direct results. Trying Google Search fallback...", fallback_prospect: "Found companies. Looking up contacts...", fallback_lead_finder: "Trying Lead Finder fallback...", saving: "Saving contacts to project...", search_google_maps: "Searching Google Maps...", search_lead_finder: "Finding leads by title and location...", enrich_domains: "Enriching company domains...", analyzing: "Analyzing results and searching for leads...", orchestrating: "Planning next step...", enrich_contacts_db: "Searching your contacts database...", done: "Done!" },
  zh: { search_leads: "正在搜索潜在客户...", search_google: "正在搜索 Google...", crawl_website: "正在爬取网站内容...", search_companies: "正在通过 Apollo 搜索公司...", prospect_domain: "正在查找域名联系人...", prospect_multi: "正在搜索多个域名...", save_contacts: "正在保存联系人...", enrich_contacts: "正在丰富联系人数据...", send_email: "正在发送邮件...", fallback_google: "直接搜索无结果，正在尝试 Google 搜索...", fallback_prospect: "已发现公司，正在查找联系人...", fallback_lead_finder: "正在尝试 Lead Finder 备选搜索...", saving: "正在保存联系人到项目...", search_google_maps: "正在搜索 Google 地图...", search_lead_finder: "正在按职位和地区搜索联系人...", enrich_domains: "正在丰富公司域名数据...", analyzing: "正在分析结果并搜索潜在客户...", orchestrating: "正在规划下一步...", enrich_contacts_db: "正在搜索您的联系人库...", done: "完成！" },
  "zh-TW": { search_leads: "正在搜尋潛在客戶...", search_google: "正在搜尋 Google...", crawl_website: "正在爬取網站內容...", search_companies: "正在透過 Apollo 搜尋公司...", prospect_domain: "正在查找網域聯絡人...", prospect_multi: "正在搜尋多個網域...", save_contacts: "正在儲存聯絡人...", enrich_contacts: "正在豐富聯絡人資料...", send_email: "正在發送郵件...", fallback_google: "直接搜尋無結果，正在嘗試 Google 搜尋...", fallback_prospect: "已發現公司，正在查找聯絡人...", fallback_lead_finder: "正在嘗試 Lead Finder 備選搜尋...", saving: "正在儲存聯絡人到專案...", search_google_maps: "正在搜尋 Google 地圖...", search_lead_finder: "正在按職位和地區搜尋聯絡人...", enrich_domains: "正在豐富公司網域資料...", analyzing: "正在分析結果並搜尋潛在客戶...", orchestrating: "正在規劃下一步...", enrich_contacts_db: "正在搜尋您的聯絡人庫...", done: "完成！" },
  fr: { search_leads: "Recherche de prospects...", search_google: "Recherche sur Google...", crawl_website: "Exploration du site web...", search_companies: "Recherche d'entreprises via Apollo...", prospect_domain: "Recherche de contacts du domaine...", prospect_multi: "Recherche sur plusieurs domaines...", save_contacts: "Sauvegarde des contacts...", enrich_contacts: "Enrichissement des contacts...", send_email: "Envoi de l'e-mail...", fallback_google: "Aucun résultat direct. Recherche Google en cours...", fallback_prospect: "Entreprises trouvées. Recherche de contacts...", fallback_lead_finder: "Essai du Lead Finder en secours...", saving: "Sauvegarde des contacts dans le projet...", search_google_maps: "Recherche sur Google Maps...", search_lead_finder: "Recherche de contacts par titre et localisation...", enrich_domains: "Enrichissement des domaines...", analyzing: "Analyse des résultats et recherche de prospects...", orchestrating: "Planification de l'étape suivante...", enrich_contacts_db: "Recherche dans votre base de contacts...", done: "Terminé !" },
};

export function buildSystemPrompt(opts: {
  projects: ProjectRow[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  agents: any[];
  userPlan: string;
  agentLimit: number;
  ragContext: string;
  locale: string;
}): string {
  const { projects, agents, userPlan, agentLimit, ragContext, locale } = opts;
  return `You are AutoClaw, an AI marketing automation assistant built by JY Tech. You help users manage their marketing projects and AI agents. Respond in the same language the user uses (Chinese if they write in Chinese, English if English, etc.).

## About AutoClaw
AutoClaw is an AI-powered marketing automation platform that deploys autonomous "AI Employees" to handle entire marketing operations 24/7. It is built and supported by JY Tech.

## Platform Capabilities
AutoClaw provides the following AI marketing agents that users can activate for their projects:
${AVAILABLE_AGENTS.map((a) => `- **${a.label}** — ${a.desc}`).join("\n")}

### What each agent can do in detail:
- **Email Marketing**: Send cold outreach emails, automated follow-up sequences (day 3, 7, 14), newsletters. Integrates with Brevo/SendGrid for sending. Syncs prospect lists from project contacts. Always use actual contact counts from the project — never invent numbers.
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
- Projects: ${projects.length > 0 ? projects.map((p) => `"${p.name}"${p.website ? ` (${p.website})` : ""}${p.description ? ` — ${(p.description as string).slice(0, 120)}` : ""}`).join("\n  - ") : "none"}
- Active agents: ${agents.length > 0 ? agents.map((a) => `${a.agent_type} on ${a.project_name} [${a.status}]`).join(", ") : "none"}
- Plan: ${userPlan} (${agentLimit} agent limit)

## IMPORTANT: Context-aware behavior
When the user says generic things like "帮我找客户", "find me customers", "help me find leads" WITHOUT specifying a domain or industry:
1. **Look at their projects above** — use the project name, website, and description to understand what their business does
2. If they have exactly ONE project, assume they want customers for THAT business and **act immediately**:
   - If the project has a description → you already know the business, directly search for relevant leads
   - If the project has only a website and no description → crawl the website to understand the business
3. If they have MULTIPLE projects, ask which project they want to find customers for
4. If they have NO projects, ask them to describe their business first
5. **Be decisive** — prefer action over asking. If you have project context, call a search tool directly. Do NOT ask "需要我开始吗？" when you have enough information to proceed.

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
}

export const TOOL_SYSTEM_PROMPT_EXTENSION = `\n
## Tool Calling — Orchestrator Mode
You are an orchestrator agent. You can call tools **one at a time in a loop**. After each tool executes, you will receive the result and decide what to do next — call another tool or provide a final answer.

**How it works:**
1. You call a tool → the system executes it and returns the result
2. You see the result and decide: call another tool OR respond with final text
3. This loop continues until you respond without a tool_call block (max 5 steps)

**Key rules:**
- When the user's request requires multiple steps, just start with the FIRST step. You will get to continue after each step.
- Do NOT try to plan or explain all steps upfront — just execute the first tool.
- Do NOT repeat a tool that already returned results.
- Do NOT ask the user for confirmation between steps — just proceed.

**Recommended tool chains for "find customers" requests:**
- Research → Search → Enrich: crawl_website → search_google_maps → enrich_domains (get decision-maker emails)
- Direct search → Enrich: search_google_maps → enrich_domains (extract domains from results, find contacts)
- By title: search_lead_finder (often sufficient on its own, already returns contacts)
- By industry: search_leads (already returns contacts)

**When to enrich:** After search_google_maps returns companies with websites, ALWAYS follow up with enrich_domains to find decision-maker email contacts. This is a critical step — companies without contacts are not actionable leads.

When the user asks a question that requires searching for companies, leads, suppliers, factories, or any business entities, you MUST use a tool instead of giving a generic answer.

Available tools (ordered by priority — prefer Apify tools for searching):

### PRIMARY SEARCH TOOLS (use these first):
1. **search_lead_finder** — Find people by job title, location, and industry (BEST for "find Sales Directors in European energy companies")
   Parameters: { "job_titles": ["string"], "locations": ["string"], "industries": ["string"] }
   Use when: user asks to find people/contacts by title in a region or industry.

2. **search_google_maps** — Search for businesses/companies by category and location on Google Maps
   Parameters: { "query": "string", "max_results": number }
   Use when: user asks to find companies, factories, stores, installers, or businesses in a location.

3. **search_leads** — Search for leads/contacts by industry keywords and job titles (general purpose lead search)
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
- When user asks to "find/search/list companies/leads/contacts" → use search_leads
- "enrich these domains" → enrich_domains
- When user asks to "research/google/look up" → use search_google
- When user asks to "check/crawl/analyze a website" → use crawl_website
- Only use search_companies (Apollo) if user explicitly mentions Apollo or if Apify tools are not available

### CRITICAL: "Find customers FOR a business" pattern
When a user says "帮我找客户", "find me customers", "帮 xxx.com 找客户", or similar:

**Case 1: User provides a URL/domain** (e.g., "帮 usproglove.com 找客户")
→ Start with crawl_website to understand the business. After you see the crawl result, you'll automatically get to call a search tool next.

**Case 2: User says "帮我找客户" with NO domain** (generic request)
→ Check the user's projects in the "Current user context" section above.
- If user has a project with description: you already know the business. Call a search tool directly (search_google_maps or search_lead_finder).
- If user has a project with website but no description: start with crawl_website. You'll search for leads in the next step.
- If user has multiple projects: ask which project, do NOT call any tool.
- If user has no projects: ask them to describe their business, do NOT call any tool.

**CRITICAL RULE — NEVER ask for confirmation, NEVER propose a plan, NEVER list steps. JUST EXECUTE:**
- When the user mentions ANY business/company/lead search request, you MUST respond with ONLY a tool_call block. No other text.
- Do NOT say "I suggest...", "You can...", "Would you like...", "Let me help you with...". Just call the tool.
- Do NOT explain what tools are available. Do NOT show example commands. Just execute.
- If the user confirmed a previously proposed plan (e.g., "好的", "yes", "开始"), CALL the tool now.
- Remember: you can chain multiple tools across steps. Just start with the first one.

You MUST respond with ONLY this JSON block (no other text before or after):
\`\`\`tool_call
{"tool": "tool_name", "params": {...}, "summary": "brief description of what you're searching for"}
\`\`\`

Only respond with normal text if the user is asking a general question that does NOT require searching.

Examples of when to call tools:
- "欧洲储能工厂和安装商" → search_google_maps with query="energy storage companies installers Europe"
- "Find Sales Directors at European energy companies" → search_lead_finder with job_titles=["Sales Director"], locations=["Europe"], industries=["Energy Storage"]
- "Enrich sonnen.de and fluence.com" → enrich_domains with domains=["sonnen.de","fluence.com"]
- "Find solar panel manufacturers in Germany" → search_google_maps with query="solar panel manufacturers Germany"
- "EV charging installers in France" → search_google_maps with query="EV charging installers France"
- "Find contacts at tesla.com" → prospect_domain with domain="tesla.com"
- "搜索一下特斯拉最新新闻" → search_google with queries=["Tesla latest news 2026"]
- "帮我了解一下 unincore.com 这家公司" → crawl_website with url="https://unincore.com"
- "帮 usproglove.com 找客户" → crawl_website with url="https://usproglove.com" (understand the business first, then suggest search strategies)
- "help acme.com find customers" → crawl_website with url="https://acme.com" (understand the business first)
- "帮我找客户" (user has 1 project: "USProGlove — industrial wearable scanners") → search_google_maps with query="industrial wearable barcode scanner distributors" (use project context, search directly!)
- "帮我找客户" (user has 1 project with website but no description) → crawl_website first (orchestrator will continue to search after)
- "帮我找客户" (user has no projects) → do NOT call tool, ask user to describe their business
- "好的/yes/开始" (user confirming a previous plan) → call the tool now based on conversation history
- "通过Apify找储能行业的销售总监" → search_leads with keywords=["energy storage"], job_titles=["Sales Director","VP Sales"]
- "Find CTOs at fintech companies" → search_leads with keywords=["fintech"], job_titles=["CTO","Chief Technology Officer"]
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
