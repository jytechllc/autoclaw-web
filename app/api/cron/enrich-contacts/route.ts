import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

const CRON_SECRET = process.env.CRON_SECRET;
const APOLLO_API_KEY = process.env.APOLLO_API_KEY;
const HUNTER_API_KEY = process.env.HUNTER_API_KEY;
const BATCH_SIZE = 20;

interface EnrichResult {
  email: string;
  firstName?: string;
  lastName?: string;
  company?: string;
  position?: string;
  phone?: string;
  linkedinUrl?: string;
  industry?: string;
  companySize?: string;
  companyRevenue?: string;
  isPublic?: boolean;
  companyDomain?: string;
}

async function enrichViaApollo(email: string): Promise<EnrichResult | null> {
  if (!APOLLO_API_KEY) return null;
  try {
    const res = await fetch("https://api.apollo.io/v1/people/match", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Api-Key": APOLLO_API_KEY,
      },
      body: JSON.stringify({ email }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const person = data.person;
    if (!person) return null;
    const org = person.organization || {};
    return {
      email,
      firstName: person.first_name || undefined,
      lastName: person.last_name || undefined,
      company: person.organization_name || org.name || undefined,
      position: person.title || undefined,
      phone: person.phone_number || undefined,
      linkedinUrl: person.linkedin_url || undefined,
      industry: org.industry || undefined,
      companySize: formatCompanySize(org.estimated_num_employees),
      companyRevenue: formatRevenue(org.annual_revenue, org.annual_revenue_printed),
      isPublic: org.publicly_traded_exchange ? true : undefined,
      companyDomain: org.primary_domain || org.website_url || undefined,
    };
  } catch {
    return null;
  }
}

function formatCompanySize(employees: number | undefined): string | undefined {
  if (!employees) return undefined;
  if (employees <= 10) return "1-10";
  if (employees <= 50) return "11-50";
  if (employees <= 200) return "51-200";
  if (employees <= 500) return "201-500";
  if (employees <= 1000) return "501-1000";
  if (employees <= 5000) return "1001-5000";
  if (employees <= 10000) return "5001-10000";
  return "10000+";
}

function formatRevenue(raw: number | undefined, printed: string | undefined): string | undefined {
  if (printed) return printed;
  if (!raw) return undefined;
  if (raw >= 1_000_000_000) return `$${(raw / 1_000_000_000).toFixed(1)}B`;
  if (raw >= 1_000_000) return `$${(raw / 1_000_000).toFixed(0)}M`;
  if (raw >= 1_000) return `$${(raw / 1_000).toFixed(0)}K`;
  return `$${raw}`;
}

async function enrichViaHunter(email: string): Promise<EnrichResult | null> {
  if (!HUNTER_API_KEY) return null;
  try {
    const res = await fetch(
      `https://api.hunter.io/v2/email-finder?email=${encodeURIComponent(email)}&api_key=${HUNTER_API_KEY}`
    );
    if (!res.ok) return null;
    const data = await res.json();
    const d = data.data;
    if (!d) return null;
    return {
      email,
      firstName: d.first_name || undefined,
      lastName: d.last_name || undefined,
      company: d.company || undefined,
      position: d.position || undefined,
      phone: d.phone_number || undefined,
      linkedinUrl: d.linkedin || undefined,
    };
  } catch {
    return null;
  }
}

function mergeEnrichment(
  ...results: (EnrichResult | null)[]
): EnrichResult | null {
  const valid = results.filter(Boolean) as EnrichResult[];
  if (valid.length === 0) return null;
  const merged: EnrichResult = { email: valid[0].email };
  for (const r of valid) {
    if (!merged.firstName && r.firstName) merged.firstName = r.firstName;
    if (!merged.lastName && r.lastName) merged.lastName = r.lastName;
    if (!merged.company && r.company) merged.company = r.company;
    if (!merged.position && r.position) merged.position = r.position;
    if (!merged.phone && r.phone) merged.phone = r.phone;
    if (!merged.linkedinUrl && r.linkedinUrl) merged.linkedinUrl = r.linkedinUrl;
    if (!merged.industry && r.industry) merged.industry = r.industry;
    if (!merged.companySize && r.companySize) merged.companySize = r.companySize;
    if (!merged.companyRevenue && r.companyRevenue) merged.companyRevenue = r.companyRevenue;
    if (merged.isPublic === undefined && r.isPublic !== undefined) merged.isPublic = r.isPublic;
    if (!merged.companyDomain && r.companyDomain) merged.companyDomain = r.companyDomain;
  }
  return merged;
}

/**
 * Enrich contacts with missing company/position/industry data using Apollo & Hunter APIs.
 * Also fetches company-level data: industry, size, revenue, public status.
 * Processes up to BATCH_SIZE contacts per run to respect API rate limits.
 * Runs daily via GitHub Actions cron or manual dispatch.
 */
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  if (CRON_SECRET && authHeader !== `Bearer ${CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sql = getDb();

  // Find contacts missing key fields, prioritize recently created
  const contacts = await sql`
    SELECT id, email, first_name, last_name, company, position, phone, notes, industry, company_size
    FROM contacts
    WHERE (company IS NULL OR company = '' OR position IS NULL OR position = '' OR industry IS NULL)
      AND email IS NOT NULL AND email != ''
      AND (notes IS NULL OR notes NOT LIKE '%[enrich-attempted]%')
    ORDER BY created_at DESC
    LIMIT ${BATCH_SIZE}
  `;

  if (contacts.length === 0) {
    return NextResponse.json({ ok: true, message: "No contacts to enrich", enriched: 0, skipped: 0 });
  }

  let enriched = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (const contact of contacts) {
    const email = contact.email as string;
    try {
      const [apolloResult, hunterResult] = await Promise.all([
        enrichViaApollo(email),
        enrichViaHunter(email),
      ]);

      // Apollo first (richer data), Hunter as fallback
      const merged = mergeEnrichment(apolloResult, hunterResult);

      if (!merged || (!merged.company && !merged.position && !merged.phone && !merged.industry)) {
        await sql`
          UPDATE contacts
          SET notes = COALESCE(notes, '') || ' [enrich-attempted]',
              updated_at = NOW()
          WHERE id = ${contact.id}
        `;
        skipped++;
        continue;
      }

      await sql`
        UPDATE contacts
        SET
          first_name = CASE WHEN first_name IS NULL OR first_name = '' THEN ${merged.firstName || null} ELSE first_name END,
          last_name = CASE WHEN last_name IS NULL OR last_name = '' THEN ${merged.lastName || null} ELSE last_name END,
          company = CASE WHEN company IS NULL OR company = '' THEN ${merged.company || null} ELSE company END,
          position = CASE WHEN position IS NULL OR position = '' THEN ${merged.position || null} ELSE position END,
          phone = CASE WHEN phone IS NULL OR phone = '' THEN ${merged.phone || null} ELSE phone END,
          linkedin_url = CASE WHEN linkedin_url IS NULL OR linkedin_url = '' THEN ${merged.linkedinUrl || null} ELSE linkedin_url END,
          industry = CASE WHEN industry IS NULL OR industry = '' THEN ${merged.industry || null} ELSE industry END,
          company_size = CASE WHEN company_size IS NULL OR company_size = '' THEN ${merged.companySize || null} ELSE company_size END,
          company_revenue = CASE WHEN company_revenue IS NULL OR company_revenue = '' THEN ${merged.companyRevenue || null} ELSE company_revenue END,
          is_public = CASE WHEN is_public IS NULL THEN ${merged.isPublic ?? null} ELSE is_public END,
          company_domain = CASE WHEN company_domain IS NULL OR company_domain = '' THEN ${merged.companyDomain || null} ELSE company_domain END,
          notes = COALESCE(notes, '') || ' [enriched:apollo+hunter]',
          source_detail = CASE WHEN source_detail IS NULL OR source_detail = '' THEN 'enriched' ELSE source_detail END,
          updated_at = NOW()
        WHERE id = ${contact.id}
      `;
      enriched++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      errors.push(`${email}: ${msg}`);
    }
  }

  return NextResponse.json({
    ok: true,
    total_processed: contacts.length,
    enriched,
    skipped,
    errors: errors.length > 0 ? errors : undefined,
  });
}
