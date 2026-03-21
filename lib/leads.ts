const HUNTER_API_KEY = process.env.HUNTER_API_KEY;
const SNOV_API_ID = process.env.SNOV_API_ID;
const SNOV_API_SECRET = process.env.SNOV_API_SECRET;
const APOLLO_API_KEY = process.env.APOLLO_API_KEY;
const BREVO_API_KEY = process.env.BREVO_API_KEY;

/** Optional BYOK keys for lead enrichment — override env vars when provided */
export interface LeadEnrichKeys {
  hunter?: string;
  apollo?: string;
  snovId?: string;
  snovSecret?: string;
}

const BREVO_LIST_ID = 8; // MedTravel Leads list

export interface Lead {
  email: string;
  firstName: string;
  lastName: string;
  company: string;
  position: string;
  phone?: string;
  source: "hunter" | "snov" | "apollo" | "apify" | "contacts";
  confidence?: number;
  verified?: boolean;
  linkedinUrl?: string;
}

interface EnrichResult { leads: Lead[]; error?: string }

async function searchHunter(domain: string, byokKey?: string): Promise<EnrichResult> {
  const key = byokKey || HUNTER_API_KEY;
  if (!key) { console.log("[enrichment] Hunter: no key configured"); return { leads: [] }; }
  const res = await fetch(
    `https://api.hunter.io/v2/domain-search?domain=${encodeURIComponent(domain)}&limit=10&api_key=${key}`
  );
  if (!res.ok) { const err = `HTTP ${res.status}`; console.warn(`[enrichment] Hunter failed for ${domain}: ${err}`); return { leads: [], error: err }; }
  const data = await res.json();
  const emails = data.data?.emails || [];
  return { leads: emails.map((e: Record<string, unknown>) => ({
    email: e.value as string,
    firstName: (e.first_name as string) || "",
    lastName: (e.last_name as string) || "",
    company: (data.data?.organization as string) || domain,
    position: (e.position as string) || "",
    phone: (e.phone_number as string) || undefined,
    source: "hunter" as const,
    confidence: e.confidence as number,
  })) };
}

async function getSnovToken(byokId?: string, byokSecret?: string): Promise<string | null> {
  const id = byokId || SNOV_API_ID;
  const secret = byokSecret || SNOV_API_SECRET;
  if (!id || !secret) { console.log("[enrichment] Snov: no credentials configured"); return null; }
  const res = await fetch("https://api.snov.io/v1/oauth/access_token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      grant_type: "client_credentials",
      client_id: id,
      client_secret: secret,
    }),
  });
  if (!res.ok) { console.warn(`[enrichment] Snov auth failed: HTTP ${res.status}`); return null; }
  const data = await res.json();
  if (!data.access_token) console.warn("[enrichment] Snov: no access_token in response");
  return data.access_token || null;
}

async function searchSnov(domain: string, byokId?: string, byokSecret?: string): Promise<EnrichResult> {
  const token = await getSnovToken(byokId, byokSecret);
  if (!token) return { leads: [], error: "Auth failed" };
  const res = await fetch(
    `https://api.snov.io/v2/domain-emails-with-info?access_token=${token}&domain=${encodeURIComponent(domain)}&type=all&limit=10`
  );
  if (!res.ok) { const err = `HTTP ${res.status}`; console.warn(`[enrichment] Snov failed for ${domain}: ${err}`); return { leads: [], error: err }; }
  const data = await res.json();
  if (data.errors) { const err = JSON.stringify(data.errors); console.warn(`[enrichment] Snov error for ${domain}: ${err}`); return { leads: [], error: err.substring(0, 100) }; }
  const emails = data.data || [];
  return { leads: emails.map((e: Record<string, unknown>) => ({
    email: (e.email as string) || "",
    firstName: "",
    lastName: "",
    company: domain,
    position: "",
    source: "snov" as const,
    verified: e.status === "verified",
  })) };
}

async function searchApollo(domain: string, byokKey?: string): Promise<EnrichResult> {
  const key = byokKey || APOLLO_API_KEY;
  if (!key) { console.log("[enrichment] Apollo: no key configured"); return { leads: [] }; }
  try {
    // Try paid API first (mixed_people/search)
    const res = await fetch("https://api.apollo.io/v1/mixed_people/search", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Api-Key": key },
      body: JSON.stringify({ q_organization_domains: domain, per_page: 10 }),
    });
    const data = await res.json();

    if (res.ok && !data.error && data.people?.length > 0) {
      const people = data.people as Record<string, unknown>[];
      console.log(`[enrichment] Apollo search returned ${people.length} people for ${domain}`);
      return { leads: people.map((p) => {
        const phones = p.phone_numbers as Array<{ sanitized_number?: string }> | undefined;
        const phone = phones?.[0]?.sanitized_number || undefined;
        return {
          email: (p.email as string) || "",
          firstName: (p.first_name as string) || "",
          lastName: (p.last_name as string) || "",
          company: (p.organization_name as string) || domain,
          position: (p.title as string) || "",
          phone,
          source: "apollo" as const,
          verified: Boolean(p.email),
        };
      }).filter((l: Lead) => l.email) };
    }

    // Paid API unavailable — fallback to organizations/enrich (free plan compatible)
    console.warn(`[enrichment] Apollo search unavailable (${data.error || `HTTP ${res.status}`}), trying organizations/enrich for ${domain}`);
    const enrichRes = await fetch(`https://api.apollo.io/v1/organizations/enrich?domain=${encodeURIComponent(domain)}`, {
      headers: { "X-Api-Key": key },
    });
    if (!enrichRes.ok) { const err = `HTTP ${enrichRes.status}`; console.warn(`[enrichment] Apollo org/enrich failed: ${err}`); return { leads: [], error: `search: ${data.error || res.status}, enrich: ${err}` }; }
    const enrichData = await enrichRes.json();
    if (enrichData.error) { console.warn(`[enrichment] Apollo org/enrich error: ${enrichData.error}`); return { leads: [], error: enrichData.error }; }

    const org = enrichData.organization;
    if (!org) return { leads: [], error: "No org data" };

    // organizations/enrich returns company info but not individual contacts
    // Extract whatever contact info is available (phone, generic emails, etc.)
    const leads: Lead[] = [];
    const orgName = (org.name as string) || domain;
    const phone = (org.primary_phone as Record<string, string>)?.sanitized_number || (org.phone as string) || undefined;

    // Some orgs have a publicly listed email pattern or generic contact
    const publicEmails: string[] = [];
    if (org.publicly_traded_exchange) {
      // For public companies, try common patterns
      const cleanDomain = domain.replace(/^www\./, "");
      publicEmails.push(`info@${cleanDomain}`, `contact@${cleanDomain}`);
    }

    if (publicEmails.length > 0 || phone) {
      leads.push({
        email: publicEmails[0] || "",
        firstName: "",
        lastName: "",
        company: orgName,
        position: "General Contact",
        phone,
        source: "apollo" as const,
        verified: false,
      });
    }

    console.log(`[enrichment] Apollo org/enrich for ${domain}: ${orgName}, phone=${phone || "none"}, leads=${leads.length}`);
    return { leads, error: leads.length === 0 ? "Free plan: org info only, no contacts" : undefined };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error(`[enrichment] Apollo error for ${domain}:`, errMsg);
    return { leads: [], error: errMsg };
  }
}

/**
 * Search Apollo for companies/people by keyword, industry, location, etc.
 * This is different from searchApollo() which searches by domain.
 * Used by chat tool-calling for open-ended business research queries.
 */
export interface CompanyResult {
  name: string;
  domain: string;
  industry: string;
  location: string;
  employeeCount: number;
  description: string;
  contacts: Lead[];
}

export async function searchCompanies(opts: {
  keywords?: string;
  industry?: string;
  location?: string;
  titles?: string[];
  limit?: number;
}): Promise<CompanyResult[]> {
  if (!APOLLO_API_KEY) return [];
  const limit = opts.limit || 10;

  try {
    // Step 1: Search organizations
    const orgBody: Record<string, unknown> = {
      per_page: limit,
      page: 1,
    };
    if (opts.keywords) orgBody.q_organization_keyword_tags = [opts.keywords];
    if (opts.industry) orgBody.organization_industry_tag_ids = [opts.industry];
    if (opts.location) orgBody.organization_locations = [opts.location];

    const orgRes = await fetch("https://api.apollo.io/v1/mixed_companies/search", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Api-Key": APOLLO_API_KEY },
      body: JSON.stringify(orgBody),
    });

    if (!orgRes.ok) return [];
    const orgData = await orgRes.json();
    const organizations = orgData.organizations || orgData.accounts || [];

    const results: CompanyResult[] = [];
    for (const org of organizations.slice(0, limit)) {
      const company: CompanyResult = {
        name: (org.name as string) || "",
        domain: (org.primary_domain as string) || (org.domain as string) || "",
        industry: (org.industry as string) || "",
        location: [org.city, org.state, org.country].filter(Boolean).join(", ") || "",
        employeeCount: (org.estimated_num_employees as number) || 0,
        description: ((org.short_description || org.seo_description || "") as string).slice(0, 200),
        contacts: [],
      };

      // Step 2: Get key contacts for each company
      if (company.domain) {
        try {
          const peopleBody: Record<string, unknown> = {
            q_organization_domains: company.domain,
            per_page: 3,
          };
          if (opts.titles && opts.titles.length > 0) {
            peopleBody.person_titles = opts.titles;
          }

          const peopleRes = await fetch("https://api.apollo.io/v1/mixed_people/search", {
            method: "POST",
            headers: { "Content-Type": "application/json", "X-Api-Key": APOLLO_API_KEY },
            body: JSON.stringify(peopleBody),
          });

          if (peopleRes.ok) {
            const peopleData = await peopleRes.json();
            company.contacts = (peopleData.people || []).map((p: Record<string, unknown>) => ({
              email: (p.email as string) || "",
              firstName: (p.first_name as string) || "",
              lastName: (p.last_name as string) || "",
              company: company.name,
              position: (p.title as string) || "",
              source: "apollo" as const,
              verified: Boolean(p.email),
            })).filter((l: Lead) => l.email);
          }
        } catch {
          // Skip contact lookup failures
        }
      }

      results.push(company);
    }

    return results;
  } catch {
    return [];
  }
}

function dedupeLeads(...leadSources: Lead[][]): Lead[] {
  const seen = new Set<string>();
  const result: Lead[] = [];
  // Sources are in priority order: Apollo (richest data), Hunter, Snov
  for (const leads of leadSources) {
    for (const lead of leads) {
      const key = lead.email.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        result.push(lead);
      }
    }
  }
  return result;
}

async function importToBrevo(leads: Lead[]): Promise<number> {
  if (!BREVO_API_KEY || leads.length === 0) return 0;
  let imported = 0;
  for (const lead of leads) {
    const body = JSON.stringify({
      email: lead.email,
      attributes: {
        FIRSTNAME: lead.firstName,
        LASTNAME: lead.lastName,
        COMPANY: lead.company,
        JOB_TITLE: lead.position,
      },
      listIds: [BREVO_LIST_ID],
      updateEnabled: true,
    });
    try {
      const res = await fetch("https://api.brevo.com/v3/contacts", {
        method: "POST",
        headers: { "api-key": BREVO_API_KEY, "Content-Type": "application/json" },
        body,
      });
      if (res.ok || res.status === 204) {
        imported++;
      } else {
        const err = await res.text();
        if (err.includes("duplicate") || err.includes("already")) imported++;
      }
    } catch {
      // skip failed contacts
    }
  }
  return imported;
}

export async function prospectDomain(domain: string, enrichKeys?: LeadEnrichKeys, options?: { skipBrevo?: boolean; onStep?: (key: string) => void }): Promise<{
  leads: Lead[];
  imported: number;
  hunterCount: number;
  snovCount: number;
  apolloCount: number;
}> {
  const step = options?.onStep || (() => {});
  // Only call providers that have keys configured (saves subrequests)
  const calls: Promise<EnrichResult>[] = [];
  const providers: string[] = [];
  const hasApollo = enrichKeys?.apollo || APOLLO_API_KEY;
  const hasHunter = enrichKeys?.hunter || HUNTER_API_KEY;
  const hasSnov = (enrichKeys?.snovId || SNOV_API_ID) && (enrichKeys?.snovSecret || SNOV_API_SECRET);
  console.log(`[enrichment] prospectDomain(${domain}) — Apollo:${!!hasApollo} Hunter:${!!hasHunter} Snov:${!!hasSnov} (byok: apollo=${!!enrichKeys?.apollo} hunter=${!!enrichKeys?.hunter} snov=${!!enrichKeys?.snovId})`);

  if (hasApollo) { calls.push(searchApollo(domain, enrichKeys?.apollo)); providers.push("apollo"); }
  if (hasHunter) { calls.push(searchHunter(domain, enrichKeys?.hunter)); providers.push("hunter"); }
  if (hasSnov) { calls.push(searchSnov(domain, enrichKeys?.snovId, enrichKeys?.snovSecret)); providers.push("snov"); }

  if (providers.length > 0) step("enrich_providers:" + providers.join(","));

  const results = await Promise.all(calls);
  const apolloResult = hasApollo ? results.shift() || { leads: [] } : { leads: [] };
  const hunterResult = hasHunter ? results.shift() || { leads: [] } : { leads: [] };
  const snovResult = hasSnov ? results.shift() || { leads: [] } : { leads: [] };
  const apolloLeads = apolloResult.leads;
  const hunterLeads = hunterResult.leads;
  const snovLeads = snovResult.leads;

  console.log(`[enrichment] prospectDomain(${domain}) results — Apollo:${apolloLeads.length}${apolloResult.error ? ` (${apolloResult.error})` : ""} Hunter:${hunterLeads.length}${hunterResult.error ? ` (${hunterResult.error})` : ""} Snov:${snovLeads.length}${snovResult.error ? ` (${snovResult.error})` : ""}`);

  // Report per-provider results (include errors)
  const parts: string[] = [];
  if (hasApollo) parts.push(`Apollo: ${apolloLeads.length}${apolloResult.error ? ` ⚠${apolloResult.error}` : ""}`);
  if (hasHunter) parts.push(`Hunter: ${hunterLeads.length}${hunterResult.error ? ` ⚠${hunterResult.error}` : ""}`);
  if (hasSnov) parts.push(`Snov: ${snovLeads.length}${snovResult.error ? ` ⚠${snovResult.error}` : ""}`);
  if (parts.length > 0) step("enrich_results:" + parts.join(", "));

  const leads = dedupeLeads(apolloLeads, hunterLeads, snovLeads);
  // Skip Brevo import during chat tool execution to reduce subrequests
  const imported = options?.skipBrevo ? 0 : await importToBrevo(leads);
  return {
    leads,
    imported,
    apolloCount: apolloLeads.length,
    hunterCount: hunterLeads.length,
    snovCount: snovLeads.length,
  };
}

export async function prospectMultipleDomains(domains: string[], enrichKeys?: LeadEnrichKeys): Promise<{
  totalLeads: number;
  totalImported: number;
  results: { domain: string; leads: Lead[]; imported: number }[];
}> {
  const results: { domain: string; leads: Lead[]; imported: number }[] = [];
  let totalLeads = 0;
  let totalImported = 0;

  for (const domain of domains) {
    const { leads, imported } = await prospectDomain(domain, enrichKeys, { skipBrevo: true });
    results.push({ domain, leads, imported });
    totalLeads += leads.length;
    totalImported += imported;
  }

  return { totalLeads, totalImported, results };
}

// ---- Apify-based functions ----

/**
 * Helper: Run an Apify actor and return the dataset items.
 */
/**
 * Start an Apify actor, wait up to `waitForFinish` seconds.
 * Vercel Pro maxDuration=300s, so individual Apify calls can wait up to ~60s.
 * Keep each call ≤ 60s to leave room for multi-step orchestration.
 */
async function runApifyActor<T = Record<string, unknown>>(
  apiToken: string,
  actorId: string,
  input: Record<string, unknown>,
  opts: { waitForFinish?: number; itemsLimit?: number; memoryMbytes?: number } = {},
): Promise<T[]> {
  const waitSec = opts.waitForFinish ?? 60;
  const memoryMbytes = opts.memoryMbytes ?? 256;
  const startRes = await fetch(
    `https://api.apify.com/v2/acts/${actorId}/runs?token=${apiToken}&waitForFinish=${waitSec}&memory=${memoryMbytes}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    },
  );
  if (!startRes.ok) {
    const text = await startRes.text().catch(() => "");
    throw new Error(`Apify ${actorId} start error ${startRes.status}: ${text.substring(0, 200)}`);
  }
  const runData = (await startRes.json()) as {
    data?: { id?: string; status?: string; defaultDatasetId?: string; statusMessage?: string };
  };
  const run = runData.data;
  if (!run?.id) throw new Error(`Apify ${actorId}: no run ID returned`);

  let datasetId = run.defaultDatasetId;

  if (run.status === "FAILED" || run.status === "ABORTED") {
    throw new Error(`Apify ${actorId} run ${run.status}: ${String(run.statusMessage || "unknown").substring(0, 200)}`);
  }

  if (run.status !== "SUCCEEDED") {
    // Actor didn't finish within waitForFinish — return empty rather than block further
    console.warn(`[apify] ${actorId} status=${run.status} after ${waitSec}s wait, returning empty`);
    return [];
  }

  if (!datasetId) throw new Error(`Apify ${actorId}: no dataset ID`);

  const limit = opts.itemsLimit ?? 200;
  const itemsRes = await fetch(
    `https://api.apify.com/v2/datasets/${datasetId}/items?token=${apiToken}&limit=${limit}`,
  );
  if (!itemsRes.ok) {
    throw new Error(`Apify ${actorId} dataset error ${itemsRes.status}`);
  }
  return (await itemsRes.json()) as T[];
}

/**
 * Search Google via Apify google-search-scraper.
 * Returns formatted text of search results.
 */
export async function searchGoogleApify(apiToken: string, queries: string[]): Promise<string> {
  const items = await runApifyActor<{
    searchQuery?: { term?: string };
    organicResults?: { title?: string; description?: string; url?: string }[];
  }>(apiToken, "apify~google-search-scraper", {
    queries: queries.join("\n"),
    maxPagesPerQuery: 1,
    resultsPerPage: 5,
    languageCode: "",
  }, { waitForFinish: 60, itemsLimit: 5 });

  const parts: string[] = [];
  for (const item of items) {
    if (item.searchQuery?.term) parts.push(`\n[Search: ${item.searchQuery.term}]`);
    for (const r of (item.organicResults || []).slice(0, 5)) {
      parts.push(`- **${r.title || ""}** (${r.url || ""}): ${r.description || ""}`);
    }
  }
  return parts.join("\n").substring(0, 3000) || "No search results found.";
}

/**
 * Crawl a website using Apify website-content-crawler with Playwright (JS rendering).
 * Returns extracted text content.
 */
export async function crawlWebsiteApify(apiToken: string, url: string): Promise<string> {
  const items = await runApifyActor<{
    url?: string;
    text?: string;
    metadata?: { title?: string; description?: string };
  }>(apiToken, "apify~website-content-crawler", {
    startUrls: [{ url }],
    maxCrawlDepth: 0,
    maxCrawlPages: 3,
    crawlerType: "playwright:firefox",
  }, { waitForFinish: 60, itemsLimit: 5 });

  const parts: string[] = [];
  for (const item of items) {
    if (item.metadata?.title) parts.push(`Title: ${item.metadata.title}`);
    if (item.metadata?.description) parts.push(`Description: ${item.metadata.description}`);
    if (item.text) parts.push(item.text.substring(0, 1500));
  }
  return parts.join("\n").substring(0, 3000) || "No content extracted from the website.";
}

/**
 * Search for leads using Apify leads-finder (code_crafter~leads-finder).
 * Returns Lead[] array.
 */
export async function searchLeadsApify(
  apiToken: string,
  opts: { keywords?: string[]; job_titles?: string[]; industries?: string[] },
): Promise<Lead[]> {
  const input: Record<string, unknown> = { maxItems: 100 };
  if (opts.keywords && opts.keywords.length > 0) input.company_keywords = opts.keywords;
  if (opts.job_titles && opts.job_titles.length > 0) input.person_titles = opts.job_titles;
  if (opts.industries && opts.industries.length > 0) input.company_keywords = [
    ...(input.company_keywords as string[] || []),
    ...opts.industries,
  ];

  const items = await runApifyActor<Record<string, unknown>>(
    apiToken, "code_crafter~leads-finder", input, { waitForFinish: 60, itemsLimit: 200 },
  );

  return items
    .filter((p) => p.email)
    .map((p) => ({
      email: String(p.email),
      firstName: String(p.first_name || p.firstName || ""),
      lastName: String(p.last_name || p.lastName || ""),
      company: String(p.company_name || p.organization || ""),
      position: String(p.title || p.job_title || ""),
      source: "apify" as const,
      confidence: 80,
      verified: false,
    }));
}

/**
 * Search Google Maps for businesses/companies via Apify compass~crawler-google-places.
 */
export async function searchGoogleMaps(
  apiToken: string,
  query: string,
  maxResults = 10,
): Promise<{ name: string; website: string; phone: string; address: string; category: string }[]> {
  const items = await runApifyActor<Record<string, unknown>>(
    apiToken,
    "compass~crawler-google-places",
    {
      searchStringsArray: [query],
      maxCrawledPlacesPerSearch: maxResults,
      language: "en",
    },
    { waitForFinish: 60, itemsLimit: maxResults, memoryMbytes: 512 },
  );

  return items.map((item) => ({
    name: String(item.title || ""),
    website: String(item.website || ""),
    phone: String(item.phone || ""),
    address: String(item.address || ""),
    category: String(item.categoryName || ""),
  }));
}

/**
 * Search for leads by job title, location, and industry via Apify crawlerbros~lead-finder.
 */
export async function searchLeadFinder(
  apiToken: string,
  opts: { jobTitles: string[]; locations: string[]; industries: string[]; maxResults?: number },
): Promise<Lead[]> {
  const items = await runApifyActor<Record<string, unknown>>(
    apiToken,
    "crawlerbros~lead-finder",
    {
      jobTitles: opts.jobTitles,
      locations: opts.locations,
      industries: opts.industries,
      maxResults: opts.maxResults || 20,
    },
    { waitForFinish: 45, itemsLimit: 200 },
  );

  return items
    .filter((item) => item.email || item.full_name)
    .map((item) => {
      const fullName = String(item.full_name || "");
      const nameParts = fullName.trim().split(/\s+/);
      const firstName = nameParts[0] || "";
      const lastName = nameParts.slice(1).join(" ") || "";
      return {
        email: String(item.email || ""),
        firstName,
        lastName,
        company: String(item.company_name || ""),
        position: String(item.title || ""),
        phone: item.phone ? String(item.phone) : item.phone_number ? String(item.phone_number) : undefined,
        source: "apify" as const,
        confidence: 75,
        verified: false,
        linkedinUrl: item.linkedin_url ? String(item.linkedin_url) : undefined,
      };
    });
}

/**
 * Enrich company domains with email patterns, contacts, and quality scores
 * via Apify ryanclinton~b2b-lead-gen-suite.
 */
export async function enrichCompanyDomains(
  apiToken: string,
  domains: string[],
): Promise<{ domain: string; emails: string[]; phones: string[]; emailPattern: string; score: number; grade: string }[]> {
  const urls = domains.map((d) => (d.startsWith("http") ? d : "https://" + d));
  const items = await runApifyActor<Record<string, unknown>>(
    apiToken,
    "ryanclinton~b2b-lead-gen-suite",
    { urls },
    { waitForFinish: 45, itemsLimit: 200 },
  );

  return items.map((item) => ({
    domain: String(item.domain || item.url || ""),
    emails: Array.isArray(item.emails) ? item.emails.map(String) : [],
    phones: Array.isArray(item.phones) ? item.phones.map(String) : [],
    emailPattern: String(item.emailPattern || item.email_pattern || ""),
    score: Number(item.score || item.quality_score || 0),
    grade: String(item.grade || item.quality_grade || ""),
  }));
}
