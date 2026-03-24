import { NeonQueryFunction } from "@neondatabase/serverless";
import { chatWithAI, ByokKeys } from "@/lib/ai";
import { prospectDomain, prospectMultipleDomains, searchCompanies, searchGoogleApify, crawlWebsiteApify, searchLeadsApify, searchGoogleMaps, searchLeadFinder, enrichCompanyDomains, getApolloDailyBudget, type Lead, type LeadEnrichKeys } from "@/lib/leads";
import { formatLeadTable, nextStepsHint, type ProjectRow } from "./constants";

export interface ToolContext {
  sql: NeonQueryFunction<false, false>;
  userId: number;
  userPlan: string;
  projects: ProjectRow[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  agents: any[];
  project_id: string | null;
  byok: ByokKeys;
  selectedModel: string;
  apifyToken: string;
  brevoApiKey: string;
  sendgridApiKey: string;
  enrichKeys: LeadEnrichKeys;
  sendStep: (key: string) => void;
}

export async function executeTool(
  toolName: string,
  toolParams: Record<string, unknown>,
  toolSummary: string,
  ctx: ToolContext,
): Promise<string> {
  const { sql, userId, userPlan, projects, project_id, byok, selectedModel, apifyToken, brevoApiKey, sendgridApiKey, sendStep } = ctx;
  const isPaid = userPlan !== "starter";

  switch (toolName) {
    case "search_companies":
      return handleSearchCompanies(toolParams, toolSummary, ctx);
    case "prospect_domain":
      return handleProspectDomain(toolParams, toolSummary, isPaid, ctx);
    case "prospect_multi":
      return handleProspectMulti(toolParams, toolSummary, ctx.enrichKeys);
    case "search_google":
      return handleSearchGoogle(toolParams, toolSummary, ctx);
    case "crawl_website":
      return handleCrawlWebsite(toolParams, apifyToken, byok);
    case "search_leads":
      return handleSearchLeads(toolParams, toolSummary, ctx);
    case "search_google_maps":
      return handleSearchGoogleMaps(toolParams, toolSummary, ctx);
    case "search_lead_finder":
      return handleSearchLeadFinder(toolParams, toolSummary, ctx);
    case "enrich_domains":
      return handleEnrichDomains(toolParams, toolSummary, ctx);
    case "save_contacts":
      return handleSaveContacts(toolParams, sql, userId, projects, project_id);
    case "enrich_contacts":
      return handleEnrichContacts(toolParams, ctx);
    case "send_email":
      return handleSendEmail(toolParams, sql, userId, project_id, projects, byok, selectedModel, brevoApiKey, sendgridApiKey);
    default:
      return "";
  }
}

async function handleSearchCompanies(toolParams: Record<string, unknown>, toolSummary: string, ctx: ToolContext): Promise<string> {
  const companies = await searchCompanies({
    keywords: toolParams.keywords as string,
    industry: toolParams.industry as string,
    location: toolParams.location as string,
    titles: toolParams.titles as string[],
    limit: Math.min((toolParams.limit as number) || 10, 20),
  });

  if (companies.length === 0) {
    return `No companies found matching the criteria. The search may be too specific, or the Apollo API key may not be configured.\n\nTry:\n- Broadening your search terms\n- Activating the **Lead Prospecting** agent for deeper, automated research`;
  }

  const isPaid = ctx.userPlan !== "starter";
  const displayCompanies = isPaid ? companies : companies.slice(0, 5);
  const companyRows = displayCompanies.map((c) => {
    const contacts = c.contacts.length > 0
      ? c.contacts.map((ct) => `${ct.firstName} ${ct.lastName} (${ct.position}) — ${ct.email}${ct.phone ? ` | ${ct.phone}` : ""}`).join("; ")
      : "—";
    return `| ${c.name} | ${c.domain || "—"} | ${c.industry || "—"} | ${c.location || "—"} | ${c.employeeCount || "—"} | ${contacts} |`;
  }).join("\n");

  let result = `**${toolSummary}**\n\nFound **${companies.length}** companies:\n\n| Company | Domain | Industry | Location | Employees | Key Contacts |\n|---------|--------|----------|----------|-----------|---------------|\n${companyRows}`;

  if (!isPaid && companies.length > 5) {
    result += `\n\n_Showing 5 of ${companies.length} results. Upgrade to **Growth** or **Scale** to see all results._`;
  }

  const projectList = ctx.projects.map((p) => `**${p.name}** (ID: ${p.id})`).join(", ");
  result += `\n\n---\n**Next steps:**\n- Save these contacts: **"save contacts to project [name]"**${projectList ? `\n- Your projects: ${projectList}` : ""}\n- Search specific domains: **"find leads for ${displayCompanies[0]?.domain || "example.com"}"**\n- Deeper research: **"activate lead prospecting"**`;
  return result;
}

async function handleProspectDomain(toolParams: Record<string, unknown>, toolSummary: string, isPaid: boolean, ctx: ToolContext): Promise<string> {
  const domain = toolParams.domain as string;
  if (!domain) return "";
  const result = await prospectDomain(domain, ctx.enrichKeys, { skipBrevo: true, onStep: ctx.sendStep });

  // Fallback: supplement with user's own contacts database
  let contactsCount = 0;
  if (result.leads.length < 5) {
    ctx.sendStep("enrich_contacts_db");
    try {
      const domainPattern = `%@${domain}`;
      const rows = await ctx.sql`
        SELECT email, first_name, last_name, company, position, phone, source
        FROM contacts
        WHERE user_id = ${ctx.userId} AND email ILIKE ${domainPattern}
        LIMIT 20
      `;
      const existingEmails = new Set(result.leads.map((l) => l.email.toLowerCase()));
      for (const row of rows) {
        const email = (row.email as string).toLowerCase();
        if (!existingEmails.has(email)) {
          result.leads.push({
            email,
            firstName: (row.first_name as string) || "",
            lastName: (row.last_name as string) || "",
            company: (row.company as string) || domain,
            position: (row.position as string) || "",
            phone: (row.phone as string) || undefined,
            source: "contacts" as const,
            confidence: undefined,
            verified: true,
          });
          contactsCount++;
        }
      }
    } catch { /* ignore contacts lookup failure */ }
  }

  if (result.leads.length === 0) {
    return `**Lead search: ${domain}**\n\nNo public contacts found for this domain.`;
  }
  const displayLeads = isPaid ? result.leads : result.leads.slice(0, 10);
  const leadTable = formatLeadTable(displayLeads);
  const sources = `Apollo: ${result.apolloCount}, Hunter: ${result.hunterCount}, Snov: ${result.snovCount}${contactsCount > 0 ? `, Contacts: ${contactsCount}` : ""}`;
  return `**Lead search: ${domain}**\n\nFound **${result.leads.length}** contacts (${sources})\n\n| Email | Name | Phone | Position | Source |\n|-------|------|-------|----------|--------|\n${leadTable}`;
}

async function handleProspectMulti(toolParams: Record<string, unknown>, toolSummary: string, enrichKeys?: LeadEnrichKeys): Promise<string> {
  const domains = (toolParams.domains as string[]) || [];
  if (domains.length === 0) return "";
  const result = await prospectMultipleDomains(domains.slice(0, 5), enrichKeys);
  const parts: string[] = [`**Lead search across ${result.results.length} domains**\n`];
  for (const r of result.results) {
    const leadList = r.leads.slice(0, 5).map((l) => {
      const name = [l.firstName, l.lastName].filter(Boolean).join(" ");
      return `  - ${l.email}${name ? ` (${name})` : ""}${l.position ? ` — ${l.position}` : ""}${l.phone ? ` | ${l.phone}` : ""}`;
    }).join("\n");
    parts.push(`**${r.domain}** — ${r.leads.length} contacts\n${leadList}`);
  }
  parts.push(`\n**Total: ${result.totalLeads} leads found, ${result.totalImported} imported to CRM.**`);
  return parts.join("\n\n");
}

async function handleSearchGoogle(toolParams: Record<string, unknown>, toolSummary: string, ctx: ToolContext): Promise<string> {
  const { apifyToken, byok } = ctx;
  const tavilyKey = byok.tavily;
  const firecrawlKey = byok.firecrawl || process.env.FIRECRAWL_API_KEY || "";
  if (!apifyToken && !tavilyKey && !firecrawlKey) {
    return "**Search not configured.** Please add a Tavily API key (free, 1000/mo) or Firecrawl key in Settings > API Keys.";
  }
  const queries = (toolParams.queries as string[]) || [];
  if (queries.length === 0) return "Please provide at least one search query.";
  try {
    const searchResult = await searchGoogleApify(apifyToken, queries.slice(0, 5), tavilyKey);
    let enriched = "";

    // Enrich top search result URLs with Firecrawl for deeper content
    if (firecrawlKey && searchResult.length > 50) {
      const urlMatches = searchResult.match(/https?:\/\/[^\s)]+/g) || [];
      const uniqueUrls = [...new Set(urlMatches)].slice(0, 2);
      for (const u of uniqueUrls) {
        try {
          const content = await crawlWithFirecrawl(firecrawlKey, u);
          enriched += `\n\n---\n**Deep content from ${u}:**\n${content.substring(0, 1500)}`;
        } catch { /* skip */ }
      }
    }

    return `**${toolSummary || "Web Search Results"}**\n\n${searchResult}${enriched}`;
  } catch (err) {
    // If search fails but Firecrawl is available, try direct crawl on query as URL
    if (firecrawlKey && queries[0]?.match(/^https?:\/\//)) {
      try {
        const content = await crawlWithFirecrawl(firecrawlKey, queries[0]);
        return `**${toolSummary || "Web Content"}**\n\n${content.substring(0, 4000)}`;
      } catch { /* fall through */ }
    }
    return `Web search failed: ${err instanceof Error ? err.message : "Unknown error"}. Please try again.`;
  }
}

async function crawlWithFirecrawl(apiKey: string, url: string): Promise<string> {
  const res = await fetch("https://api.firecrawl.dev/v1/scrape", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ url, formats: ["markdown"] }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Firecrawl error ${res.status}: ${text.substring(0, 200)}`);
  }
  const data = (await res.json()) as { success?: boolean; data?: { markdown?: string; metadata?: { title?: string; description?: string } } };
  if (!data.success || !data.data?.markdown) throw new Error("Firecrawl returned no content");
  const md = data.data.markdown;
  const title = data.data.metadata?.title || "";
  const desc = data.data.metadata?.description || "";
  return `${title ? `**${title}**\n` : ""}${desc ? `${desc}\n\n` : ""}${md}`;
}

async function handleCrawlWebsite(toolParams: Record<string, unknown>, apifyToken: string, byok: ByokKeys): Promise<string> {
  const firecrawlKey = byok.firecrawl || process.env.FIRECRAWL_API_KEY || "";
  const url = toolParams.url as string;
  if (!url) return "Please provide a URL to crawl.";

  // Try Firecrawl first (better JS rendering, markdown output)
  if (firecrawlKey) {
    try {
      const content = await crawlWithFirecrawl(firecrawlKey, url);
      return `**Website content from ${url}** *(via Firecrawl)*\n\n${content.substring(0, 4000)}`;
    } catch (err) {
      // Fall through to Apify
      if (!apifyToken) {
        return `Website crawl failed: ${err instanceof Error ? err.message : "Unknown error"}`;
      }
    }
  }

  // Fallback to Apify
  if (apifyToken) {
    try {
      const content = await crawlWebsiteApify(apifyToken, url);
      return `**Website content from ${url}** *(via Apify)*\n\n${content.substring(0, 3000)}`;
    } catch (err) {
      return `Website crawl failed: ${err instanceof Error ? err.message : "Unknown error"}. The site may be blocking crawlers.`;
    }
  }

  // Direct fetch as last resort
  try {
    const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (compatible; AutoClaw/1.0)" }, redirect: "follow" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const html = await res.text();
    const titleMatch = html.match(/<title[^>]*>(.*?)<\/title>/i);
    const body = html.replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<style[\s\S]*?<\/style>/gi, "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
    return `**Website content from ${url}** *(direct fetch)*\n\n${titleMatch?.[1] ? `**${titleMatch[1].trim()}**\n\n` : ""}${body.substring(0, 3000)}`;
  } catch (err) {
    return `Website crawl failed: ${err instanceof Error ? err.message : "Unknown error"}. Please add a Firecrawl API key (free 500 pages/mo) or Apify token in Settings > API Keys.`;
  }
}

async function handleSearchLeads(toolParams: Record<string, unknown>, toolSummary: string, ctx: ToolContext): Promise<string> {
  const { apifyToken, sendStep, userPlan, projects, byok, selectedModel } = ctx;
  const tavilyKey = byok.tavily || process.env.TAVILY_API_KEY || "";
  const apolloKey = ctx.enrichKeys.apollo;
  const apolloPlan = ctx.enrichKeys.plans?.apollo;
  const apolloIsPaid = apolloKey && (!apolloPlan || apolloPlan !== "free");
  const isPaid = userPlan !== "starter";

  let leads: Lead[] = [];

  // Step 1: Apollo direct search (primary — free search, no credits consumed)
  if (apolloKey && apolloIsPaid) {
    try {
      sendStep("search_leads");
      const searchBody: Record<string, unknown> = { per_page: 50 };
      if (toolParams.keywords) searchBody.q_keywords = (toolParams.keywords as string[]).join(" ");
      if (toolParams.job_titles) searchBody.person_titles = toolParams.job_titles;
      if (toolParams.locations) searchBody.person_locations = toolParams.locations;
      if (toolParams.industries) searchBody.q_keywords = ((searchBody.q_keywords as string) || "") + " " + (toolParams.industries as string[]).join(" ");
      if (toolParams.company_size) searchBody.organization_num_employees_ranges = toolParams.company_size;

      const res = await fetch("https://api.apollo.io/v1/mixed_people/api_search", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Api-Key": apolloKey },
        body: JSON.stringify(searchBody),
      });
      if (res.ok) {
        const data = await res.json();
        const people = (data.people || []) as Record<string, unknown>[];
        console.log(`[tools] Apollo search returned ${people.length} people`);

        // Reveal with budget-aware limit (costs 1 email credit + 1 mobile credit each)
        const { perCall, dailyBudget, daysLeft } = getApolloDailyBudget(75);
        const revealLimit = Math.min(people.length, perCall);
        console.log(`[tools] Apollo reveal budget: ${perCall}/call, ${dailyBudget}/day, ${daysLeft} days left`);
        for (const p of people.slice(0, revealLimit)) {
          const personId = p.id as string;
          if (!personId) continue;
          try {
            const revealRes = await fetch("https://api.apollo.io/v1/people/match", {
              method: "POST",
              headers: { "Content-Type": "application/json", "X-Api-Key": apolloKey },
              body: JSON.stringify({ id: personId, reveal_personal_emails: false, reveal_phone_number: true }),
            });
            if (revealRes.ok) {
              const rd = await revealRes.json();
              const person = rd.person || rd;
              if (person && !rd.error) {
                const email = (person.email as string) || "";
                const firstName = (person.first_name as string) || "";
                if (email || firstName) {
                  const phones = person.phone_numbers as Array<{ sanitized_number?: string }> | undefined;
                  leads.push({
                    email,
                    firstName,
                    lastName: (person.last_name as string) || "",
                    company: (person.organization_name as string) || "",
                    position: (person.title as string) || "",
                    phone: phones?.[0]?.sanitized_number || undefined,
                    source: "apollo" as const,
                    verified: Boolean(email),
                    linkedinUrl: (person.linkedin_url as string) || undefined,
                  });
                }
              }
            }
          } catch { /* skip individual reveal */ }
        }
        console.log(`[tools] Apollo revealed ${leads.length}/${revealLimit} contacts`);
      }
    } catch (err) {
      console.warn(`[tools] Apollo search failed: ${err instanceof Error ? err.message : err}`);
    }
  }

  // Step 2: Apify lead search fallback (if Apollo didn't find enough)
  if (leads.length < 5 && apifyToken) {
    try {
      const apifyLeads = await searchLeadsApify(apifyToken, {
        keywords: toolParams.keywords as string[],
        job_titles: toolParams.job_titles as string[],
        industries: toolParams.industries as string[],
      });
      // Dedupe
      const existing = new Set(leads.map(l => l.email.toLowerCase()));
      for (const l of apifyLeads) {
        if (!existing.has(l.email.toLowerCase())) leads.push(l);
      }
    } catch (err) {
      console.warn(`[tools] Apify lead search failed: ${err instanceof Error ? err.message : err}`);
    }

    // Fallback 2a: Try lead_finder
    if (leads.length < 5) {
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
            leads = lfLeads;
          }
        } catch { /* lead finder fallback failed */ }
      }
    }
  }

  // Return Apify/LeadFinder results if found
  if (leads.length > 0) {
    const displayLeads = isPaid ? leads : leads.slice(0, 10);
    const hasLinkedIn = leads.some((l) => l.linkedinUrl);
    const leadTable = formatLeadTable(displayLeads, hasLinkedIn ? "lead_finder" : "standard");
    let result = `**${toolSummary || "Lead Search"}**\n\nFound **${leads.length}** contacts.\n\n${hasLinkedIn ? "| Name | Email | Phone | Title | Company | LinkedIn |\n|------|-------|-------|-------|---------|----------|" : "| Email | Name | Phone | Position | Source |\n|-------|------|-------|----------|--------|"}\n${leadTable}`;
    if (!isPaid && leads.length > 10) {
      result += `\n\n_Showing 10 of ${leads.length} results. Upgrade to **Growth** or **Scale** to see all results._`;
    }
    const projectList = projects.map((p) => `**${p.name}** (ID: ${p.id})`).join(", ");
    result += `\n\n---\n**Next steps:**\n- Save these contacts: **"save contacts to project [name]"**${projectList ? `\n- Your projects: ${projectList}` : ""}\n- Enrich data: **"enrich contacts"**`;
    return result;
  }

  // Step 2: Tavily/Google search → AI extract domains → prospect contacts
  const fallbackKeywords = [...(toolParams.keywords as string[] || []), ...(toolParams.industries as string[] || [])];
  if (fallbackKeywords.length === 0) {
    return `**${toolSummary || "Lead Search"}**\n\nNo leads or companies found.\n\nTry:\n- Broadening your keywords\n- Using **search_google** to research the industry first`;
  }

  try {
    sendStep("fallback_google");
    const googleQueries = fallbackKeywords.slice(0, 2).map(k => `top ${k} companies Europe list`);
    googleQueries.push(fallbackKeywords.join(" ") + " manufacturers suppliers directory");
    const googleResults = await searchGoogleApify(apifyToken, googleQueries, tavilyKey);

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
      sendStep("fallback_prospect");
      const domainResults: { domain: string; leads: Lead[] }[] = [];
      for (const domain of extractedDomains.slice(0, 3)) {
        try {
          const { leads: domLeads } = await prospectDomain(domain, ctx.enrichKeys, { skipBrevo: true, onStep: ctx.sendStep });
          if (domLeads.length > 0) domainResults.push({ domain, leads: domLeads });
        } catch { /* skip */ }
      }

      if (domainResults.length > 0) {
        const allFoundLeads = domainResults.flatMap(r => r.leads);
        const leadTable = allFoundLeads.slice(0, 20).map(l => {
          const name = [l.firstName, l.lastName].filter(Boolean).join(" ") || "—";
          return `| ${l.email} | ${name} | ${l.company || "—"} | ${l.position || "—"} |`;
        }).join("\n");

        let result = `**${toolSummary || "Search Results"}**\n\nFound ${extractedDomains.length} company domains → prospected contacts.\n\n**Discovered companies:** ${extractedDomains.join(", ")}\n\nFound **${allFoundLeads.length}** contacts:\n\n| Email | Name | Company | Position |\n|-------|------|---------|----------|\n${leadTable}`;
        result += nextStepsHint(projects);
        return result;
      }
      return `**${toolSummary || "Search Results"}**\n\nFound these companies: **${extractedDomains.join(", ")}**, but no public contacts were found.\n\nTry:\n- Search specific domains: "find contacts at ${extractedDomains[0]}"\n- Activate **Lead Prospecting** agent for deeper research`;
    }
    return `**${toolSummary || "Search Results"}**\n\nNo relevant company domains found.\n\nTry:\n- Broadening your keywords\n- Using **search_google** to research the industry first`;
  } catch {
    return `**${toolSummary || "Lead Search"}**\n\nSearch failed. Try broadening your keywords or job titles.`;
  }
}

async function handleSearchGoogleMaps(toolParams: Record<string, unknown>, toolSummary: string, ctx: ToolContext): Promise<string> {
  const { apifyToken, sendStep, projects, enrichKeys, userPlan, byok } = ctx;
  const isPaid = userPlan !== "starter";
  const query = toolParams.query as string;
  const maxResults = (toolParams.max_results as number) || 10;

  let results: { name: string; website: string; phone: string; address: string; category: string }[] = [];
  const tavilyKey = byok.tavily || process.env.TAVILY_API_KEY || "";

  // Primary: Tavily web search (fast, reliable)
  if (tavilyKey) {
    sendStep("search_google");
    try {
      const searchResult = await searchGoogleApify(apifyToken, [`${query} businesses companies`, `${query} directory list`], tavilyKey);
      const urlRegex = /\(([^)]+)\)/g;
      const titleRegex = /\*\*([^*]+)\*\*/g;
      let match;
      while ((match = titleRegex.exec(searchResult)) !== null) {
        const title = match[1];
        const urlMatch = urlRegex.exec(searchResult);
        const url = urlMatch ? urlMatch[1] : "";
        if (title && !title.includes("Search:")) {
          results.push({ name: title, website: url, phone: "", address: "", category: "" });
        }
      }
    } catch (err) {
      console.warn(`[tools] Tavily search failed: ${err instanceof Error ? err.message : err}`);
    }
  }

  // Fallback: Apify Google Maps (slower, but returns phone/address/category)
  if (results.length === 0 && apifyToken) {
    try {
      sendStep("search_google_maps");
      results = await searchGoogleMaps(apifyToken, query, maxResults);
    } catch (err) {
      console.warn(`[tools] Google Maps Apify failed: ${err instanceof Error ? err.message : err}`);
    }
  }

  if (!tavilyKey && !apifyToken) {
    return "**Search not configured.** Please add a Tavily API key (free, 1000/mo) or Apify token in Settings > API Keys.";
  }

  try {
    if (results.length === 0) {
      return `**Google Maps search: "${query}"**\n\nNo businesses found. Try broadening your search terms or checking the location.`;
    }

    const rows = results.map((r) =>
      `| ${r.name || "—"} | ${r.website || "—"} | ${r.phone || "—"} | ${r.address || "—"} | ${r.category || "—"} |`
    ).join("\n");

    let result = `**${toolSummary || "Google Maps Search"}**\n\nFound **${results.length}** businesses:\n\n| Company | Website | Phone | Address | Category |\n|---------|---------|-------|---------|----------|\n${rows}`;

    // Auto-enrich: extract domains from results and find decision-maker contacts
    const hasEnrichKeys = enrichKeys.hunter || enrichKeys.apollo || enrichKeys.snovId;
    const domains = results
      .filter((r) => r.website)
      .map((r) => { try { return new URL(r.website).hostname.replace(/^www\./, ""); } catch { return ""; } })
      .filter((d) => d && d.includes("."));
    const uniqueDomains = [...new Set(domains)].slice(0, 2); // Limit to 2 to stay within subrequest limits

    if (uniqueDomains.length > 0 && hasEnrichKeys) {
      sendStep("enrich_domains");
      const allLeads: Lead[] = [];
      for (const domain of uniqueDomains) {
        try {
          const { leads } = await prospectDomain(domain, enrichKeys, { skipBrevo: true, onStep: sendStep });
          allLeads.push(...leads);
        } catch { /* skip failed domains */ }
      }

      if (allLeads.length > 0) {
        const displayLeads = isPaid ? allLeads : allLeads.slice(0, 15);
        const leadTable = displayLeads.map((l) => {
          const name = [l.firstName, l.lastName].filter(Boolean).join(" ") || "—";
          return `| ${l.email} | ${name} | ${l.phone || "—"} | ${l.company || "—"} | ${l.position || "—"} | ${l.source} |`;
        }).join("\n");

        result += `\n\n---\n\n**Decision Maker Contacts (${allLeads.length} found):**\n\n| Email | Name | Phone | Company | Position | Source |\n|-------|------|-------|---------|----------|--------|\n${leadTable}`;

        if (!isPaid && allLeads.length > 15) {
          result += `\n\n_Showing 15 of ${allLeads.length} contacts. Upgrade to see all._`;
        }
      }
    }

    const projectList = projects.map((p) => `**${p.name}** (ID: ${p.id})`).join(", ");
    result += `\n\n---\n**Next steps:**\n- Save these contacts: **"save contacts to project [name]"**${projectList ? `\n- Your projects: ${projectList}` : ""}`;
    if (!hasEnrichKeys) {
      result += `\n- **Add API keys** for richer results: "add my key xxx to hunter" or "add my key xxx to apollo"`;
    }
    return result;
  } catch (err) {
    return `Google Maps search failed: ${err instanceof Error ? err.message : "Unknown error"}. Please try again.`;
  }
}

async function handleSearchLeadFinder(toolParams: Record<string, unknown>, toolSummary: string, ctx: ToolContext): Promise<string> {
  const { apifyToken, sendStep, userPlan, projects } = ctx;
  if (!apifyToken) {
    return "**Apify API key not configured.** Please add your Apify API token in Settings > API Keys (service: apify), or ask your admin to set the APIFY_API_TOKEN environment variable.";
  }
  const isPaid = userPlan !== "starter";
  try {
    sendStep("search_lead_finder");
    const leads = await searchLeadFinder(apifyToken, {
      jobTitles: (toolParams.job_titles as string[]) || [],
      locations: (toolParams.locations as string[]) || [],
      industries: (toolParams.industries as string[]) || [],
    });

    if (leads.length === 0) {
      return `**${toolSummary || "Lead Finder Search"}**\n\nNo leads found matching the criteria. Try:\n- Broadening job titles or locations\n- Using **search_leads** with keywords\n- Using **search_google_maps** to find companies first`;
    }

    const displayLeads = isPaid ? leads : leads.slice(0, 10);
    const leadTable = formatLeadTable(displayLeads, "lead_finder");

    let result = `**${toolSummary || "Lead Finder Search"}**\n\nFound **${leads.length}** contacts:\n\n| Name | Email | Phone | Title | Company | LinkedIn |\n|------|-------|-------|-------|---------|----------|\n${leadTable}`;
    if (!isPaid && leads.length > 10) {
      result += `\n\n_Showing 10 of ${leads.length} results. Upgrade to **Growth** or **Scale** to see all results._`;
    }
    const projectList = projects.map((p) => `**${p.name}** (ID: ${p.id})`).join(", ");
    result += `\n\n---\n**Next steps:**\n- Save these contacts: **"save contacts to project [name]"**${projectList ? `\n- Your projects: ${projectList}` : ""}\n- Enrich data: **"enrich contacts"**`;
    return result;
  } catch (err) {
    return `Lead Finder search failed: ${err instanceof Error ? err.message : "Unknown error"}. Please try again.`;
  }
}

async function handleEnrichDomains(toolParams: Record<string, unknown>, toolSummary: string, ctx: ToolContext): Promise<string> {
  const { apifyToken, sendStep, projects } = ctx;
  if (!apifyToken) {
    return "**Apify API key not configured.** Please add your Apify API token in Settings > API Keys (service: apify), or ask your admin to set the APIFY_API_TOKEN environment variable.";
  }
  try {
    sendStep("enrich_domains");
    const domains = (toolParams.domains as string[]) || [];
    if (domains.length === 0) return "Please provide at least one domain to enrich.";

    const results = await enrichCompanyDomains(apifyToken, domains);
    if (results.length === 0) {
      return `**Domain Enrichment**\n\nNo enrichment data found for the provided domains. The domains may be unreachable or too small.`;
    }

    const parts: string[] = [`**${toolSummary || "Domain Enrichment"}**\n\nEnriched **${results.length}** domains:\n`];
    for (const r of results) {
      parts.push(`### ${r.domain}`);
      parts.push(`- **Emails found:** ${r.emails.length > 0 ? r.emails.join(", ") : "None"}`);
      parts.push(`- **Phones:** ${r.phones.length > 0 ? r.phones.join(", ") : "None"}`);
      parts.push(`- **Email pattern:** ${r.emailPattern || "Unknown"}`);
      parts.push(`- **Score:** ${r.score} | **Grade:** ${r.grade || "N/A"}`);
      parts.push("");
    }

    const projectList = projects.map((p) => `**${p.name}** (ID: ${p.id})`).join(", ");
    parts.push(`\n---\n**Next steps:**\n- Save these contacts: **"save contacts to project [name]"**${projectList ? `\n- Your projects: ${projectList}` : ""}\n- Find more contacts: **"find leads for ${domains[0]}"**`);
    return parts.join("\n");
  } catch (err) {
    return `Domain enrichment failed: ${err instanceof Error ? err.message : "Unknown error"}. Please try again.`;
  }
}

async function handleSaveContacts(
  toolParams: Record<string, unknown>,
  sql: NeonQueryFunction<false, false>,
  userId: number,
  projects: ProjectRow[],
  project_id: string | null,
): Promise<string> {
  const projectName = toolParams.project_name as string | undefined;
  const rawProjectId = toolParams.project_id;
  let targetProject: ProjectRow | undefined;

  if (projectName) {
    targetProject = projects.find((p) => (p.name as string).toLowerCase() === projectName.toLowerCase())
      || projects.find((p) => (p.name as string).toLowerCase().includes(projectName.toLowerCase()));
  } else if (rawProjectId) {
    const asNum = typeof rawProjectId === "number" ? rawProjectId : parseInt(String(rawProjectId), 10);
    if (!isNaN(asNum)) {
      targetProject = projects.find((p) => p.id === asNum);
    } else {
      // AI passed project name as project_id — do name match
      const nameStr = String(rawProjectId).toLowerCase();
      targetProject = projects.find((p) => (p.name as string).toLowerCase() === nameStr)
        || projects.find((p) => (p.name as string).toLowerCase().includes(nameStr));
    }
  }
  if (!targetProject && project_id) {
    targetProject = projects.find((p) => p.id === project_id);
  }

  if (!targetProject) {
    const writableProjects = projects.filter((p) => p.access_role !== "reader");
    const projectList = writableProjects.map((p) => `- **${p.name}**`).join("\n");
    return projectList
      ? `Please specify which project to save to:\n\n${projectList}\n\nSay: **"save contacts to project [name]"**`
      : "No projects found. Please create a project first.";
  }
  if (targetProject.access_role === "reader") {
    return `You have **read-only** access to project **${targetProject.name}**. Please ask the project owner or org admin to grant you editor access.`;
  }

  const recentMessages = await sql`
    SELECT content FROM chat_messages
    WHERE user_id = ${userId} AND role = 'assistant'
    ORDER BY created_at DESC LIMIT 10
  `;

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
    emailsToSave = requestedEmails.filter((e) => foundEmails.has(e.toLowerCase()));
    if (emailsToSave.length === 0) emailsToSave = requestedEmails;
  } else if (fromLastSearch) {
    emailsToSave = Array.from(foundEmails);
  }

  if (emailsToSave.length === 0) {
    return "No contacts found to save. Run a search first, then ask me to save the results.";
  }

  let savedCount = 0;
  for (const email of emailsToSave) {
    try {
      await sql`INSERT INTO contacts (user_id, project_id, email, source, source_detail)
        VALUES (${userId}, ${targetProject.id}, ${email}, 'chat', 'Chat: manual save')
        ON CONFLICT (user_id, email) DO NOTHING`;
      savedCount++;
    } catch { /* skip */ }
  }
  return `**${savedCount}** contacts saved to project **${targetProject.name}**.`;
}

async function handleEnrichContacts(toolParams: Record<string, unknown>, ctx: ToolContext): Promise<string> {
  const { sql, userId, project_id, projects, byok, selectedModel } = ctx;

  // Resolve project_id: accept integer ID or project name string
  let enrichProjectId: unknown = null;
  const rawProjectId = toolParams.project_id;
  if (rawProjectId) {
    const asNum = typeof rawProjectId === "number" ? rawProjectId : parseInt(String(rawProjectId), 10);
    if (!isNaN(asNum)) {
      enrichProjectId = asNum;
    } else {
      // Treat as project name — fuzzy match
      const nameStr = String(rawProjectId).toLowerCase();
      const matched = projects.find((p) => (p.name as string).toLowerCase() === nameStr)
        || projects.find((p) => (p.name as string).toLowerCase().includes(nameStr));
      if (matched) enrichProjectId = matched.id;
    }
  }
  if (!enrichProjectId) {
    enrichProjectId = project_id || (projects.length > 0 ? projects[projects.length - 1].id : null);
  }
  if (!enrichProjectId) return "No project found. Please create a project first.";

  const limit = Math.min((toolParams.limit as number) || 20, 50);
  const contacts = await sql`
    SELECT id, email, first_name, last_name, company, position, tags, notes
    FROM contacts
    WHERE user_id = ${userId} AND project_id = ${enrichProjectId} AND emails_sent = 0
    ORDER BY created_at DESC
    LIMIT ${limit}
  `;

  if (contacts.length === 0) {
    return "No contacts to enrich. All contacts have already been processed or the project has no contacts.";
  }

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

    if (enrichResult.usage) {
      sql`INSERT INTO token_usage (project_id, user_id, provider, model, prompt_tokens, completion_tokens, total_tokens, source)
          VALUES (${enrichProjectId}, ${userId}, ${enrichResult.provider}, ${enrichResult.model}, ${enrichResult.usage.prompt_tokens}, ${enrichResult.usage.completion_tokens}, ${enrichResult.usage.total_tokens}, 'chat_enrich')`.catch(() => {});
    }

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
      let result = `**Enrichment complete!** Updated **${enrichedCount}** of ${contacts.length} contacts with seniority, department, industry, and priority data.`;
      const summaryRows = enrichments.slice(0, 10).map((e) =>
        `| ${e.email} | ${e.seniority} | ${e.department} | ${e.industry} | ${e.priority} |`
      ).join("\n");
      result += `\n\n| Email | Seniority | Department | Industry | Priority |\n|-------|-----------|------------|----------|----------|\n${summaryRows}`;
      return result;
    }
    return "Enrichment failed: could not parse AI response. Please try again.";
  } catch (err) {
    return `Enrichment failed: ${err instanceof Error ? err.message : "Unknown error"}`;
  }
}

async function handleSendEmail(
  toolParams: Record<string, unknown>,
  sql: NeonQueryFunction<false, false>,
  userId: number,
  project_id: string | null,
  projects: ProjectRow[],
  byok: ByokKeys,
  selectedModel: string,
  brevoApiKey: string,
  sendgridApiKey: string,
): Promise<string> {
  const to = toolParams.to as string | string[];
  const subject = toolParams.subject as string;
  const body = toolParams.body as string;
  const template = toolParams.template as string | undefined;

  if (!brevoApiKey && !sendgridApiKey) {
    return "**No email service configured.** Please add your Brevo or SendGrid API key in Settings > API Keys.";
  }
  if (!to) return "Please specify a recipient email address.";

  const recipients = Array.isArray(to) ? to : [to];

  let emailSubject = subject;
  let emailBody = body;
  if (template === "cold_outreach" && (!emailSubject || !emailBody)) {
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
      emailSubject = emailSubject || "Quick question about your business";
      emailBody = emailBody || "Hi, I wanted to reach out about a potential collaboration opportunity.";
    }
  }

  if (!emailSubject || !emailBody) {
    return "Please provide a subject and body for the email, or use template='cold_outreach' to auto-generate.";
  }

  let sentCount = 0;
  const errors: string[] = [];

  for (const recipient of recipients.slice(0, 10)) {
    try {
      if (brevoApiKey) {
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

      sql`UPDATE contacts SET emails_sent = emails_sent + 1 WHERE user_id = ${userId} AND email = ${recipient}`.catch(() => {});
      sql`INSERT INTO email_logs (user_id, project_id, to_email, subject, status)
          VALUES (${userId}, ${project_id || null}, ${recipient}, ${emailSubject}, 'sent')`.catch(() => {});
    } catch (err) {
      errors.push(`${recipient}: ${err instanceof Error ? err.message : "Unknown error"}`);
    }
  }

  let result = `**Email sent!** ${sentCount}/${recipients.length} emails delivered successfully.`;
  if (errors.length > 0) {
    result += `\n\nErrors:\n${errors.map((e) => `- ${e}`).join("\n")}`;
  }
  return result;
}
