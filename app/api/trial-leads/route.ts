import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { randomBytes } from "crypto";

export const dynamic = "force-dynamic";

const APOLLO_API_KEY = process.env.APOLLO_API_KEY;
const CEREBRAS_API_KEY = process.env.CEREBRAS_API_KEY;
const RATE_LIMIT = 5; // per IP per hour

function getIp(req: NextRequest): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}

function maskEmail(email: string): string {
  if (!email) return "***@***.com";
  const [local, domain] = email.split("@");
  if (!domain) return "***@***.com";
  return `${local[0]}***@${domain}`;
}

function maskLastName(name: string): string {
  if (!name || name.length <= 1) return "**";
  return name[0] + "*".repeat(name.length - 1);
}

async function checkRateLimit(sql: ReturnType<typeof getDb>, ip: string): Promise<boolean> {
  const since = new Date(Date.now() - 3600_000).toISOString();
  const rows = await sql`
    SELECT COUNT(*)::int as cnt FROM trial_lead_sessions
    WHERE ip = ${ip} AND created_at >= ${since}
  `;
  return (rows[0]?.cnt as number) < RATE_LIMIT;
}

// Fetch website and extract business context
async function fetchWebsiteContext(url: string): Promise<string> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "AutoClaw-Trial/1.0" },
      redirect: "follow",
    });
    if (!res.ok) return "";
    const html = await res.text();
    const titleMatch = html.match(/<title[^>]*>(.*?)<\/title>/i);
    const metaMatch = html.match(/<meta\s+name=["']description["'][^>]*content=["']([^"]*?)["']/i);
    const bodyText = html
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<[^>]*>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .substring(0, 2000);
    const title = titleMatch?.[1]?.trim() || "";
    const desc = metaMatch?.[1]?.trim() || "";
    return `Title: ${title}\nDescription: ${desc}\nContent: ${bodyText}`;
  } catch {
    return "";
  }
}

// Use AI to analyze website and generate Apollo search criteria
async function analyzeForBuyers(websiteContext: string, query: string): Promise<{ titles: string[]; companies: string[] }> {
  const prompt = `You are a B2B sales expert. A business wants to sell a product/service. Your job is to identify potential BUYER companies — companies that would PURCHASE or RESELL this product.

${websiteContext ? `Their website content:\n${websiteContext}\n` : ""}
${query ? `What they sell: ${query}` : ""}

Think step by step:
1. What is the product/service being sold?
2. Who are the BUYERS? (retailers, distributors, wholesalers, or end-user businesses that need this product)
3. What job titles make purchasing decisions for this type of product?

Return a JSON object with:
- "titles": array of 3-5 job titles of PURCHASING decision makers at buyer companies, e.g. ["Procurement Manager", "Category Buyer", "Store Owner"]
- "companies": array of 5-8 REAL companies that would BUY/RESELL this product. For example:
  - If selling shoes → shoe retailers/distributors like ["Foot Locker", "DSW", "Zappos", "Nordstrom"]
  - If selling gloves → medical/industrial distributors like ["McKesson", "Henry Schein", "Grainger"]
  - If selling e-bikes → bike shops/retailers/distributors like ["Trek Bicycle", "REI", "Best Buy", "Rad Power Bikes"]

DO NOT include:
- Logistics companies (UPS, FedEx, DHL)
- E-commerce platforms (Amazon, Alibaba, eBay) unless the product is specifically for e-commerce
- Payment/finance companies
- Unrelated businesses

Focus on companies that would actually USE or RESELL this specific product in their operations.
For industrial/technical products, recommend: manufacturers, system integrators, OEMs, engineering firms.
For consumer products, recommend: retailers, distributors, wholesalers in that specific category.

Return ONLY the JSON object.`;

  try {
    const res = await fetch("https://api.cerebras.ai/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${CEREBRAS_API_KEY}` },
      body: JSON.stringify({
        model: "qwen-3-235b-a22b-instruct-2507",
        messages: [{ role: "user", content: prompt }],
        max_tokens: 500,
      }),
    });
    if (!res.ok) throw new Error("AI request failed");
    const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const content = data.choices?.[0]?.message?.content || "";
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        titles: Array.isArray(parsed.titles) ? parsed.titles : [],
        companies: Array.isArray(parsed.companies) ? parsed.companies : [],
      };
    }
  } catch { /* fall through */ }
  return { titles: [], companies: [] };
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const query = (body.query || "").trim();
    if (!query || query.length < 3 || query.length > 500) {
      return NextResponse.json({ error: "Query must be 3-500 characters" }, { status: 400 });
    }

    if (!APOLLO_API_KEY) {
      return NextResponse.json({ error: "Service unavailable" }, { status: 503 });
    }

    const sql = getDb();

    // Ensure table exists
    await sql`
      CREATE TABLE IF NOT EXISTS trial_lead_sessions (
        id SERIAL PRIMARY KEY,
        session_token VARCHAR(64) UNIQUE NOT NULL,
        query TEXT NOT NULL,
        leads JSONB NOT NULL DEFAULT '[]',
        ip VARCHAR(45),
        claimed_by INTEGER REFERENCES users(id),
        created_at TIMESTAMP DEFAULT NOW(),
        expires_at TIMESTAMP DEFAULT NOW() + INTERVAL '24 hours'
      )
    `;

    const ip = getIp(req);
    if (!(await checkRateLimit(sql, ip))) {
      return NextResponse.json({ error: "rate_limited" }, { status: 429 });
    }

    // Detect if query is a URL/domain
    const isUrl = /^https?:\/\/|^[a-z0-9][-a-z0-9]*\.[a-z]{2,}/i.test(query);

    // Step 1: Understand what the business sells
    let websiteContext = "";

    if (isUrl) {
      const url = query.startsWith("http") ? query : `https://${query}`;
      websiteContext = await fetchWebsiteContext(url);
    }

    // Step 2: Use AI to figure out who would BUY from this business
    let targetTitles: string[] = [];
    let targetCompanies: string[] = [];
    if (CEREBRAS_API_KEY && (websiteContext || query)) {
      const analysis = await analyzeForBuyers(websiteContext, query);
      targetTitles = analysis.titles;
      targetCompanies = analysis.companies;
    }

    // Step 3: Search Apollo for potential BUYERS at target companies
    interface FullLead { firstName: string; lastName: string; email: string; company: string; position: string; linkedinUrl: string }
    let fullLeads: FullLead[] = [];

    // Search each target company for decision makers
    const companiesToSearch = targetCompanies.length > 0 ? targetCompanies : [query];
    for (const companyName of companiesToSearch.slice(0, 5)) {
      if (fullLeads.length >= 15) break;
      try {
        const searchBody: Record<string, unknown> = {
          per_page: 5,
          q_organization_name: companyName,
        };
        if (targetTitles.length > 0) {
          searchBody.person_titles = targetTitles;
        }

        const res = await fetch("https://api.apollo.io/v1/mixed_people/api_search", {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Api-Key": APOLLO_API_KEY },
          body: JSON.stringify(searchBody),
        });
        if (res.ok) {
          const data = (await res.json()) as { people?: Record<string, unknown>[] };
          for (const p of (data.people || []).slice(0, 5)) {
            fullLeads.push({
              firstName: (p.first_name as string) || "",
              lastName: (p.last_name as string) || "",
              email: (p.email as string) || "",
              company: (p.organization_name as string) || companyName,
              position: (p.title as string) || "",
              linkedinUrl: (p.linkedin_url as string) || "",
            });
          }
        }
      } catch { /* skip this company */ }
    }

    // Fallback: search existing contacts DB
    if (fullLeads.length === 0) {
      try {
        const searchTerm = query;
        const rows = await sql`
          SELECT DISTINCT ON (email) first_name, last_name, email, company, position, linkedin_url
          FROM contacts
          WHERE (is_public = true OR source IN ('apollo', 'hunter', 'snov'))
          AND (
            company ILIKE ${'%' + searchTerm + '%'}
            OR position ILIKE ${'%' + searchTerm + '%'}
            OR industry ILIKE ${'%' + searchTerm + '%'}
          )
          LIMIT 15
        `;
        fullLeads = rows.map((r) => ({
          firstName: (r.first_name as string) || "",
          lastName: (r.last_name as string) || "",
          email: (r.email as string) || "",
          company: (r.company as string) || "",
          position: (r.position as string) || "",
          linkedinUrl: (r.linkedin_url as string) || "",
        }));
      } catch { /* DB search failed */ }
    }

    if (fullLeads.length === 0) {
      return NextResponse.json({ leads: [], sessionToken: null });
    }

    const maskedLeads = fullLeads.map((l) => ({
      firstName: l.firstName,
      lastName: maskLastName(l.lastName),
      email: maskEmail(l.email),
      company: l.company,
      position: l.position,
    }));

    // Store session
    const sessionToken = randomBytes(24).toString("hex");
    await sql`
      INSERT INTO trial_lead_sessions (session_token, query, leads, ip)
      VALUES (${sessionToken}, ${query}, ${JSON.stringify(fullLeads)}, ${ip})
    `;

    return NextResponse.json({
      leads: maskedLeads,
      sessionToken,
      total: fullLeads.length,
      context: targetCompanies.length > 0 ? targetCompanies.join(", ") : undefined,
    });
  } catch (err) {
    console.error("[POST /api/trial-leads]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
