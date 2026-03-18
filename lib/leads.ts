const HUNTER_API_KEY = process.env.HUNTER_API_KEY;
const SNOV_API_ID = process.env.SNOV_API_ID;
const SNOV_API_SECRET = process.env.SNOV_API_SECRET;
const APOLLO_API_KEY = process.env.APOLLO_API_KEY;
const BREVO_API_KEY = process.env.BREVO_API_KEY;

const BREVO_LIST_ID = 8; // MedTravel Leads list

export interface Lead {
  email: string;
  firstName: string;
  lastName: string;
  company: string;
  position: string;
  source: "hunter" | "snov" | "apollo" | "apify";
  confidence?: number;
  verified?: boolean;
  linkedinUrl?: string;
}

async function searchHunter(domain: string): Promise<Lead[]> {
  if (!HUNTER_API_KEY) return [];
  const res = await fetch(
    `https://api.hunter.io/v2/domain-search?domain=${encodeURIComponent(domain)}&limit=10&api_key=${HUNTER_API_KEY}`
  );
  if (!res.ok) return [];
  const data = await res.json();
  const emails = data.data?.emails || [];
  return emails.map((e: Record<string, unknown>) => ({
    email: e.value as string,
    firstName: (e.first_name as string) || "",
    lastName: (e.last_name as string) || "",
    company: (data.data?.organization as string) || domain,
    position: (e.position as string) || "",
    source: "hunter" as const,
    confidence: e.confidence as number,
  }));
}

async function getSnovToken(): Promise<string | null> {
  if (!SNOV_API_ID || !SNOV_API_SECRET) return null;
  const res = await fetch("https://api.snov.io/v1/oauth/access_token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      grant_type: "client_credentials",
      client_id: SNOV_API_ID,
      client_secret: SNOV_API_SECRET,
    }),
  });
  if (!res.ok) return null;
  const data = await res.json();
  return data.access_token || null;
}

async function searchSnov(domain: string): Promise<Lead[]> {
  const token = await getSnovToken();
  if (!token) return [];
  const res = await fetch(
    `https://api.snov.io/v2/domain-emails-with-info?access_token=${token}&domain=${encodeURIComponent(domain)}&type=all&limit=10`
  );
  if (!res.ok) return [];
  const data = await res.json();
  const emails = data.data || [];
  return emails.map((e: Record<string, unknown>) => ({
    email: (e.email as string) || "",
    firstName: "",
    lastName: "",
    company: domain,
    position: "",
    source: "snov" as const,
    verified: e.status === "verified",
  }));
}

async function searchApollo(domain: string): Promise<Lead[]> {
  if (!APOLLO_API_KEY) return [];
  try {
    const res = await fetch("https://api.apollo.io/v1/mixed_people/search", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Api-Key": APOLLO_API_KEY },
      body: JSON.stringify({
        q_organization_domains: domain,
        per_page: 10,
      }),
    });
    if (!res.ok) return [];
    const data = await res.json();
    const people = data.people || [];
    return people.map((p: Record<string, unknown>) => ({
      email: (p.email as string) || "",
      firstName: (p.first_name as string) || "",
      lastName: (p.last_name as string) || "",
      company: (p.organization_name as string) || domain,
      position: (p.title as string) || "",
      source: "apollo" as const,
      verified: Boolean(p.email),
    })).filter((l: Lead) => l.email);
  } catch {
    return [];
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

export async function prospectDomain(domain: string): Promise<{
  leads: Lead[];
  imported: number;
  hunterCount: number;
  snovCount: number;
  apolloCount: number;
}> {
  const [apolloLeads, hunterLeads, snovLeads] = await Promise.all([
    searchApollo(domain),
    searchHunter(domain),
    searchSnov(domain),
  ]);
  // Apollo first (richest data), then Hunter, then Snov as fallback
  const leads = dedupeLeads(apolloLeads, hunterLeads, snovLeads);
  const imported = await importToBrevo(leads);
  return {
    leads,
    imported,
    apolloCount: apolloLeads.length,
    hunterCount: hunterLeads.length,
    snovCount: snovLeads.length,
  };
}

export async function prospectMultipleDomains(domains: string[]): Promise<{
  totalLeads: number;
  totalImported: number;
  results: { domain: string; leads: Lead[]; imported: number }[];
}> {
  const results: { domain: string; leads: Lead[]; imported: number }[] = [];
  let totalLeads = 0;
  let totalImported = 0;

  for (const domain of domains) {
    const { leads, imported } = await prospectDomain(domain);
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
async function runApifyActor<T = Record<string, unknown>>(
  apiToken: string,
  actorId: string,
  input: Record<string, unknown>,
  opts: { waitForFinish?: number; itemsLimit?: number } = {},
): Promise<T[]> {
  const waitSec = opts.waitForFinish ?? 60;
  const startRes = await fetch(
    `https://api.apify.com/v2/acts/${actorId}/runs?token=${apiToken}&waitForFinish=${waitSec}`,
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
    data?: { id?: string; status?: string; defaultDatasetId?: string };
  };
  const run = runData.data;
  if (!run?.id) throw new Error(`Apify ${actorId}: no run ID returned`);

  let datasetId = run.defaultDatasetId;

  if (run.status !== "SUCCEEDED" && run.status !== "FAILED") {
    const pollRes = await fetch(
      `https://api.apify.com/v2/actor-runs/${run.id}?token=${apiToken}&waitForFinish=${waitSec}`,
    );
    if (pollRes.ok) {
      const pollData = (await pollRes.json()) as {
        data?: { status?: string; defaultDatasetId?: string };
      };
      if (pollData.data?.status === "FAILED" || pollData.data?.status === "ABORTED") {
        throw new Error(`Apify ${actorId} run ${pollData.data.status}`);
      }
      datasetId = pollData.data?.defaultDatasetId || datasetId;
    }
  } else if (run.status === "FAILED") {
    throw new Error(`Apify ${actorId} run failed`);
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
  }, { waitForFinish: 120, itemsLimit: 5 });

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
    { waitForFinish: 120, itemsLimit: maxResults },
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
    { waitForFinish: 120, itemsLimit: 200 },
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
    { waitForFinish: 120, itemsLimit: 200 },
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
