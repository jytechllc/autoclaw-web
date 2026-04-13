import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { checkRateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

function getIp(req: NextRequest): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}

// GET: Public job listings by org slug
export async function GET(req: NextRequest) {
  const ip = getIp(req);
  if (!checkRateLimit(ip, { limit: 60, windowMs: 60_000 })) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  const sql = getDb();

  // List all companies with open positions
  const listAll = req.nextUrl.searchParams.get("list");
  if (listAll) {
    const companies = await sql`
      SELECT o.name, o.slug, COUNT(rp.id)::int as open_positions
      FROM organizations o
      JOIN recruiting_positions rp ON rp.org_id = o.id AND rp.status = 'open'
      WHERE o.slug IS NOT NULL AND o.slug != ''
      GROUP BY o.id, o.name, o.slug
      HAVING COUNT(rp.id) > 0
      ORDER BY COUNT(rp.id) DESC, o.name
    `;
    return NextResponse.json({ companies });
  }

  const slug = req.nextUrl.searchParams.get("slug");
  if (!slug) {
    return NextResponse.json({ error: "slug parameter required" }, { status: 400 });
  }

  // Find org by slug
  const orgs = await sql`SELECT id, name FROM organizations WHERE slug = ${slug}`;
  if (orgs.length === 0) {
    return NextResponse.json({ error: "Organization not found" }, { status: 404 });
  }

  const org = orgs[0];
  const orgId = org.id as number;

  // Ensure views column exists
  await sql`ALTER TABLE recruiting_positions ADD COLUMN IF NOT EXISTS views INTEGER DEFAULT 0`;

  // Get open positions for this org
  const positions = await sql`
    SELECT id, title, description, department, location, salary_min, salary_max, salary_type, required_skills, visa_sponsorship, created_at
    FROM recruiting_positions
    WHERE org_id = ${orgId} AND status = 'open'
    ORDER BY created_at DESC
  `;

  // Increment views for all positions on this page
  if (positions.length > 0) {
    const posIds = positions.map((p) => p.id as number);
    await sql`UPDATE recruiting_positions SET views = COALESCE(views, 0) + 1 WHERE id = ANY(${posIds})`;
  }

  return NextResponse.json({
    org: { name: org.name, slug },
    positions,
  });
}

// POST: Submit an application (no auth required)
export async function POST(req: NextRequest) {
  const ip = getIp(req);
  if (!checkRateLimit(ip, { limit: 10, windowMs: 60_000 })) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  const body = await req.json();
  const { slug, position_id, first_name, last_name, email, phone, resume_url, linkedin_url, cover_letter } = body;

  if (!slug || !position_id || !first_name || !email) {
    return NextResponse.json({ error: "slug, position_id, first_name, and email are required" }, { status: 400 });
  }

  const sql = getDb();

  // Verify org and position
  const orgs = await sql`SELECT id FROM organizations WHERE slug = ${slug}`;
  if (orgs.length === 0) {
    return NextResponse.json({ error: "Organization not found" }, { status: 404 });
  }

  const orgId = orgs[0].id as number;
  const positions = await sql`
    SELECT id, user_id FROM recruiting_positions WHERE id = ${position_id} AND org_id = ${orgId} AND status = 'open'
  `;
  if (positions.length === 0) {
    return NextResponse.json({ error: "Position not found or closed" }, { status: 404 });
  }

  const positionUserId = positions[0].user_id as number;

  // Check for duplicate application
  const existing = await sql`
    SELECT id FROM recruiting_candidates
    WHERE user_id = ${positionUserId} AND email = ${email} AND position_id = ${position_id}
  `;
  if (existing.length > 0) {
    return NextResponse.json({ error: "You have already applied for this position" }, { status: 409 });
  }

  // Create candidate record
  const result = await sql`
    INSERT INTO recruiting_candidates (user_id, position_id, first_name, last_name, email, phone, resume_url, linkedin_url, notes, source, status)
    VALUES (${positionUserId}, ${position_id}, ${first_name}, ${last_name || null}, ${email}, ${phone || null}, ${resume_url || null}, ${linkedin_url || null}, ${cover_letter || null}, 'job_board', 'new')
    RETURNING id
  `;

  return NextResponse.json({ message: "Application submitted", candidate_id: result[0].id });
}
