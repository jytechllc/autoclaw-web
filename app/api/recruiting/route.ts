import { NextRequest, NextResponse } from "next/server";
import { auth0 } from "@/lib/auth0";
import { getDb, resolveUserPlan } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { checkRateLimit } from "@/lib/rate-limit";
import { recruitingActionSchema, parseOrError } from "@/lib/validations";
import { chatWithAI } from "@/lib/ai";
import { searchKnowledgeBase, buildRagContext } from "@/lib/rag";

export const dynamic = "force-dynamic";

function getIp(req: NextRequest): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}

async function ensureRecruitingTables() {
  const sql = getDb();
  await sql`
    CREATE TABLE IF NOT EXISTS recruiting_positions (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      org_id INTEGER,
      title VARCHAR(255) NOT NULL,
      description TEXT,
      department VARCHAR(100),
      location VARCHAR(255),
      salary_min INTEGER,
      salary_max INTEGER,
      required_skills TEXT,
      status VARCHAR(20) DEFAULT 'draft' CHECK (status IN ('draft', 'open', 'closed')),
      salary_type VARCHAR(20) DEFAULT 'yearly' CHECK (salary_type IN ('hourly', 'monthly', 'yearly')),
      visa_sponsorship BOOLEAN DEFAULT false,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )
  `;
  // Ensure columns exist on older tables
  await sql`ALTER TABLE recruiting_positions ADD COLUMN IF NOT EXISTS visa_sponsorship BOOLEAN DEFAULT false`;
  await sql`ALTER TABLE recruiting_positions ADD COLUMN IF NOT EXISTS salary_type VARCHAR(20) DEFAULT 'yearly'`;
  await sql`ALTER TABLE recruiting_positions ADD COLUMN IF NOT EXISTS seats INTEGER DEFAULT 1`;
  await sql`
    CREATE TABLE IF NOT EXISTS recruiting_candidates (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      position_id INTEGER REFERENCES recruiting_positions(id) ON DELETE SET NULL,
      first_name VARCHAR(100) NOT NULL,
      last_name VARCHAR(100),
      email VARCHAR(255),
      phone VARCHAR(50),
      resume_url VARCHAR(500),
      linkedin_url VARCHAR(500),
      skills TEXT,
      experience TEXT,
      current_company VARCHAR(255),
      status VARCHAR(20) DEFAULT 'new' CHECK (status IN ('new', 'screening', 'interview', 'offer', 'hired', 'rejected')),
      source VARCHAR(50) DEFAULT 'manual' CHECK (source IN ('manual', 'linkedin', 'referral', 'job_board')),
      tags TEXT,
      notes TEXT,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS recruiting_interviews (
      id SERIAL PRIMARY KEY,
      candidate_id INTEGER REFERENCES recruiting_candidates(id) ON DELETE CASCADE,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      interviewer VARCHAR(255) NOT NULL,
      scheduled_at TIMESTAMP NOT NULL,
      duration_minutes INTEGER DEFAULT 60,
      feedback TEXT,
      rating INTEGER CHECK (rating >= 1 AND rating <= 5),
      created_at TIMESTAMP DEFAULT NOW()
    )
  `;
}

async function getUserId(sql: ReturnType<typeof getDb>, email: string) {
  const users = await sql`SELECT id FROM users WHERE email = ${email}`;
  return users.length > 0 ? (users[0].id as number) : null;
}

async function getVisibleUserIds(sql: ReturnType<typeof getDb>, userId: number) {
  const orgMembers = await sql`
    SELECT om2.user_id FROM organization_members om1
    JOIN organization_members om2 ON om1.org_id = om2.org_id
    WHERE om1.user_id = ${userId}
  `;
  return [userId, ...orgMembers.map((m) => m.user_id as number)].filter((v, i, a) => a.indexOf(v) === i);
}

async function getUserOrgId(sql: ReturnType<typeof getDb>, userId: number): Promise<number | null> {
  const rows = await sql`SELECT org_id FROM organization_members WHERE user_id = ${userId} LIMIT 1`;
  return rows.length > 0 ? (rows[0].org_id as number) : null;
}

async function ensureOrgSlug() {
  const sql = getDb();
  await sql`ALTER TABLE organizations ADD COLUMN IF NOT EXISTS slug VARCHAR(100)`;
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_organizations_slug ON organizations(slug) WHERE slug IS NOT NULL`;
}

function generateSlug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80);
}

export async function GET(req: NextRequest) {
  const ip = getIp(req);
  if (!checkRateLimit(ip, { limit: 60, windowMs: 60_000 })) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  const session = await auth0.getSession();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sql = getDb();
  await ensureRecruitingTables();

  const email = session.user.email as string;
  const userId = await getUserId(sql, email);
  if (!userId) {
    return NextResponse.json({ candidates: [], positions: [], pipeline: {} });
  }

  // Plan gate: paid plans only
  const users = await sql`SELECT plan FROM users WHERE id = ${userId}`;
  const userPlan = await resolveUserPlan(sql, userId, (users[0]?.plan as string) || "starter", email);
  if (userPlan === "starter") {
    return NextResponse.json({ error: "Recruiting requires a paid plan" }, { status: 403 });
  }

  const visibleUserIds = await getVisibleUserIds(sql, userId);
  const tab = req.nextUrl.searchParams.get("tab") || "candidates";

  if (tab === "positions") {
    const positions = await sql`
      SELECT rp.*,
        (SELECT COUNT(*) FROM recruiting_candidates rc WHERE rc.position_id = rp.id) as candidate_count
      FROM recruiting_positions rp
      WHERE rp.user_id = ANY(${visibleUserIds})
      ORDER BY rp.created_at DESC
    `;
    return NextResponse.json({ positions });
  }

  if (tab === "pipeline") {
    const candidates = await sql`
      SELECT rc.*, rp.title as position_title
      FROM recruiting_candidates rc
      LEFT JOIN recruiting_positions rp ON rc.position_id = rp.id
      WHERE rc.user_id = ANY(${visibleUserIds})
      ORDER BY rc.updated_at DESC
    `;
    const pipeline: Record<string, typeof candidates> = { new: [], screening: [], interview: [], offer: [], hired: [], rejected: [] };
    for (const c of candidates) {
      const s = (c.status as string) || "new";
      if (pipeline[s]) pipeline[s].push(c);
    }
    return NextResponse.json({ pipeline });
  }

  if (tab === "interviews") {
    const candidateId = req.nextUrl.searchParams.get("candidate_id");
    if (!candidateId) {
      return NextResponse.json({ interviews: [] });
    }
    const interviews = await sql`
      SELECT ri.* FROM recruiting_interviews ri
      JOIN recruiting_candidates rc ON ri.candidate_id = rc.id
      WHERE ri.candidate_id = ${Number(candidateId)} AND rc.user_id = ANY(${visibleUserIds})
      ORDER BY ri.scheduled_at DESC
    `;
    return NextResponse.json({ interviews });
  }

  // Default: candidates tab
  const search = req.nextUrl.searchParams.get("search") || "";
  const statusFilter = req.nextUrl.searchParams.get("status") || "";
  const positionFilter = req.nextUrl.searchParams.get("position_id") || "";
  const sourceFilter = req.nextUrl.searchParams.get("source") || "";
  const page = Math.max(1, Number(req.nextUrl.searchParams.get("page")) || 1);
  const pageSize = 30;
  const offset = (page - 1) * pageSize;

  const searchFilter = search ? sql`AND (rc.first_name ILIKE ${"%" + search + "%"} OR rc.last_name ILIKE ${"%" + search + "%"} OR rc.email ILIKE ${"%" + search + "%"} OR rc.current_company ILIKE ${"%" + search + "%"})` : sql``;
  const statusFilterSql = statusFilter ? sql`AND rc.status = ${statusFilter}` : sql``;
  const positionFilterSql = positionFilter ? sql`AND rc.position_id = ${Number(positionFilter)}` : sql``;
  const sourceFilterSql = sourceFilter ? sql`AND rc.source = ${sourceFilter}` : sql``;

  const [candidates, countResult] = await Promise.all([
    sql`
      SELECT rc.*, rp.title as position_title
      FROM recruiting_candidates rc
      LEFT JOIN recruiting_positions rp ON rc.position_id = rp.id
      WHERE rc.user_id = ANY(${visibleUserIds})
      ${searchFilter} ${statusFilterSql} ${positionFilterSql} ${sourceFilterSql}
      ORDER BY rc.created_at DESC
      LIMIT ${pageSize} OFFSET ${offset}
    `,
    sql`
      SELECT COUNT(*)::int as total FROM recruiting_candidates rc
      WHERE rc.user_id = ANY(${visibleUserIds})
      ${searchFilter} ${statusFilterSql} ${positionFilterSql} ${sourceFilterSql}
    `,
  ]);

  const total = countResult[0].total as number;

  return NextResponse.json({
    candidates,
    total,
    page,
    pageSize,
    totalPages: Math.ceil(total / pageSize),
  });
}

export async function POST(req: NextRequest) {
  const ip = getIp(req);
  if (!checkRateLimit(ip, { limit: 30, windowMs: 60_000 })) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  const session = await auth0.getSession();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sql = getDb();
  await ensureRecruitingTables();

  const userEmail = session.user.email as string;
  const userId = await getUserId(sql, userEmail);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Plan gate: paid plans only
  const postUsers = await sql`SELECT plan FROM users WHERE id = ${userId}`;
  const postPlan = await resolveUserPlan(sql, userId, (postUsers[0]?.plan as string) || "starter", userEmail);
  if (postPlan === "starter") {
    return NextResponse.json({ error: "Recruiting requires a paid plan" }, { status: 403 });
  }

  const rawBody = await req.json();

  // ── AI Generate (before Zod validation) ──
  if (rawBody.action === "generate_positions") {
    const prompt = rawBody.prompt as string;
    const projectId = rawBody.project_id as number | undefined;
    if (!prompt) return NextResponse.json({ error: "Prompt is required" }, { status: 400 });

    // Gather project context
    let projectContext = "";
    if (projectId) {
      const proj = await sql`SELECT name, website, description FROM projects WHERE id = ${projectId}`;
      if (proj.length > 0) {
        projectContext = `\nCompany: ${proj[0].name}\nWebsite: ${proj[0].website || "N/A"}\nDescription: ${proj[0].description || "N/A"}\n`;
      }
    } else {
      const projects = await sql`SELECT name, website, description FROM projects WHERE user_id = ${userId} LIMIT 3`;
      for (const p of projects) {
        projectContext += `\nCompany: ${p.name}\nWebsite: ${p.website || "N/A"}\nDescription: ${p.description || "N/A"}\n`;
      }
    }

    // Search knowledge base for context
    let kbContext = "";
    try {
      const orgId = await getUserOrgId(sql, userId);
      const ragResults = await searchKnowledgeBase(sql, prompt, {
        userId, orgId: orgId || undefined, projectId, topK: 3,
      });
      kbContext = buildRagContext(ragResults, 2000);
    } catch { /* RAG unavailable */ }

    const systemPrompt = `You are a professional HR recruiter helping create job postings for a company.
Based on the company information and knowledge base context below, generate job postings as requested.

${projectContext}
${kbContext}

IMPORTANT: Return a JSON array of position objects. Each object must have these fields:
- title: Job title (string)
- description: Full job description in Markdown with sections: About the Role, Responsibilities, Requirements, Nice to Have, What We Offer (string)
- department: Department name (string or null)
- location: Work location (string or null)
- required_skills: Key skills comma-separated (string or null)
- salary_min: Minimum annual salary in USD (number or null)
- salary_max: Maximum annual salary in USD (number or null)
- visa_sponsorship: Whether the position offers H1B/visa sponsorship (boolean)
- compliance_notes: Any compliance warnings about the posting, e.g. minimum wage issues, missing required disclosures for the location (string or null)

IMPORTANT COMPLIANCE RULES:
- Salary MUST meet the local minimum wage laws for the specified location (e.g. California minimum wage is $16/hr = ~$33,280/year, San Francisco is $18.67/hr = ~$38,834/year)
- If the salary seems too low for the location, set a compliant salary and add a compliance_note explaining the adjustment
- Include pay transparency disclosures if required by the location's laws (e.g. California, New York, Colorado)

Return ONLY the JSON array, no other text.`;

    try {
      const aiResponse = await chatWithAI([
        { role: "system", content: systemPrompt },
        { role: "user", content: prompt },
      ], 4000);

      // Parse the AI response as JSON array
      const text = aiResponse.content.trim();
      const jsonMatch = text.match(/\[[\s\S]*\]/);
      if (!jsonMatch) {
        return NextResponse.json({ error: "AI did not return valid JSON", raw: text }, { status: 500 });
      }
      const generatedPositions = JSON.parse(jsonMatch[0]) as Array<Record<string, unknown>>;

      // Insert all generated positions
      const orgId = await getUserOrgId(sql, userId);
      const created = [];
      const complianceNotes: string[] = [];
      for (const pos of generatedPositions) {
        const result = await sql`
          INSERT INTO recruiting_positions (user_id, org_id, title, description, department, location, salary_min, salary_max, required_skills, status, visa_sponsorship)
          VALUES (${userId}, ${orgId}, ${(pos.title as string) || "Untitled"}, ${(pos.description as string) || null}, ${(pos.department as string) || null}, ${(pos.location as string) || null}, ${(pos.salary_min as number) || null}, ${(pos.salary_max as number) || null}, ${(pos.required_skills as string) || null}, 'open', ${(pos.visa_sponsorship as boolean) || false})
          RETURNING *
        `;
        created.push(result[0]);
        if (pos.compliance_notes) {
          complianceNotes.push(`${pos.title}: ${pos.compliance_notes}`);
        }
      }

      logAudit({ userId, userEmail, action: "recruiting.create_position", resourceType: "position", details: { prompt, count: created.length, ai_model: aiResponse.model }, ipAddress: ip });
      return NextResponse.json({ positions: created, ai_model: aiResponse.model, compliance_notes: complianceNotes.length > 0 ? complianceNotes : undefined });
    } catch (e) {
      return NextResponse.json({ error: "AI generation failed", details: e instanceof Error ? e.message : String(e) }, { status: 500 });
    }
  }

  // ── AI Rewrite Description ──
  if (rawBody.action === "rewrite_description") {
    const { title, description, department, location, salary_min, salary_max, salary_type, required_skills, visa_sponsorship } = rawBody as Record<string, unknown>;
    if (!title) return NextResponse.json({ error: "Title is required" }, { status: 400 });

    let projectContext = "";
    const projects = await sql`SELECT name, website, description FROM projects WHERE user_id = ${userId} LIMIT 1`;
    if (projects.length > 0) {
      projectContext = `Company: ${projects[0].name}\nWebsite: ${projects[0].website || "N/A"}\nDescription: ${projects[0].description || "N/A"}\n`;
    }

    let kbContext = "";
    try {
      const orgId = await getUserOrgId(sql, userId);
      const ragResults = await searchKnowledgeBase(sql, `${title} ${department || ""} ${required_skills || ""}`, {
        userId, orgId: orgId || undefined, topK: 3,
      });
      kbContext = buildRagContext(ragResults, 2000);
    } catch { /* RAG unavailable */ }

    const systemPrompt = `You are a professional HR copywriter. Rewrite the job description to be compelling, well-structured, and SEO-optimized.

${projectContext}
${kbContext}

Current position details:
- Title: ${title}
- Department: ${department || "N/A"}
- Location: ${location || "N/A"}
- Salary: $${salary_min || "?"} - $${salary_max || "?"} / ${salary_type || "yearly"}
- Required Skills: ${required_skills || "N/A"}
- Visa Sponsorship: ${visa_sponsorship ? "Yes" : "No"}

${description ? `Current description to improve:\n${description}` : "No existing description — write from scratch."}

Write a professional job description in Markdown with these sections:
## About the Role
## Responsibilities
## Requirements
## Nice to Have
## What We Offer

Make it engaging and include company context from the knowledge base. Keep salary and benefits realistic for the location.
Return ONLY the Markdown description, no other text.`;

    try {
      const aiResponse = await chatWithAI([
        { role: "system", content: systemPrompt },
        { role: "user", content: `Please ${description ? "rewrite and improve" : "write"} the job description for: ${title}` },
      ], 3000);

      return NextResponse.json({ description: aiResponse.content.trim(), ai_model: aiResponse.model });
    } catch (e) {
      return NextResponse.json({ error: "AI rewrite failed", details: e instanceof Error ? e.message : String(e) }, { status: 500 });
    }
  }

  // ── AI Compliance Check ──
  if (rawBody.action === "check_compliance") {
    const positionId = rawBody.position_id as number;
    if (!positionId) return NextResponse.json({ error: "position_id required" }, { status: 400 });

    const positions = await sql`SELECT * FROM recruiting_positions WHERE id = ${positionId}`;
    if (positions.length === 0) return NextResponse.json({ error: "Position not found" }, { status: 404 });
    const pos = positions[0];

    // Gather project context
    let projectContext = "";
    const projects = await sql`SELECT name, website, description FROM projects WHERE user_id = ${userId} LIMIT 1`;
    if (projects.length > 0) {
      projectContext = `Company: ${projects[0].name}\nWebsite: ${projects[0].website || "N/A"}\n`;
    }

    const systemPrompt = `You are an employment law compliance advisor. Review the following job posting for legal compliance issues.

${projectContext}

Job Posting:
- Title: ${pos.title}
- Location: ${pos.location || "Not specified"}
- Department: ${pos.department || "Not specified"}
- Salary Range: $${pos.salary_min || "?"} - $${pos.salary_max || "?"}
- Required Skills: ${pos.required_skills || "Not specified"}
- H1B/Visa Sponsorship: ${pos.visa_sponsorship ? "Yes" : "No"}
- Description:
${pos.description || "No description"}

Please check for:
1. **Minimum Wage Compliance**: Does the salary meet the local minimum wage? (e.g., Federal $7.25/hr, California $16/hr, San Francisco $18.67/hr, New York City $16/hr, Seattle $19.97/hr). Compare salary_min against annual full-time minimum for the location.
2. **Pay Transparency**: Does the posting comply with pay transparency laws? (Required in CA, NY, CO, WA, etc.)
3. **Discrimination**: Does the description contain potentially discriminatory language (age, gender, race, religion)?
4. **H1B Compliance**: If offering visa sponsorship, are there any issues?
5. **Missing Required Disclosures**: Any legally required information missing for the specified location?

Return a JSON object with:
- status: "compliant" | "warning" | "non_compliant"
- issues: Array of objects, each with:
  - severity: "error" | "warning" | "info"
  - category: string (e.g. "Minimum Wage", "Pay Transparency", "Discrimination")
  - message: string (describe the issue)
  - suggestion: string (what to change)
  - fix: object or null — if the issue can be auto-fixed, provide the exact field updates, e.g. { "salary_min": 38834 } or { "description": "...updated text..." } or { "visa_sponsorship": true }. Only include fields that need changing. Set to null if no auto-fix possible.
- summary: One-line summary in the user's language

Return ONLY the JSON object, no other text.`;

    try {
      const aiResponse = await chatWithAI([
        { role: "system", content: systemPrompt },
        { role: "user", content: "Please review this job posting for compliance." },
      ], 2000);

      const text = aiResponse.content.trim();
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        return NextResponse.json({ error: "AI did not return valid JSON", raw: text }, { status: 500 });
      }
      const result = JSON.parse(jsonMatch[0]);
      return NextResponse.json({ compliance: result, ai_model: aiResponse.model });
    } catch (e) {
      return NextResponse.json({ error: "Compliance check failed", details: e instanceof Error ? e.message : String(e) }, { status: 500 });
    }
  }

  // ── Org Slug Management ──
  if (rawBody.action === "set_slug") {
    const orgId = await getUserOrgId(sql, userId);
    if (!orgId) return NextResponse.json({ error: "No organization found" }, { status: 400 });
    await ensureOrgSlug();
    const slug = generateSlug(rawBody.slug as string || "");
    if (!slug) return NextResponse.json({ error: "Invalid slug" }, { status: 400 });
    try {
      await sql`UPDATE organizations SET slug = ${slug} WHERE id = ${orgId}`;
      return NextResponse.json({ slug });
    } catch {
      return NextResponse.json({ error: "Slug already taken" }, { status: 409 });
    }
  }

  if (rawBody.action === "get_careers_link") {
    const orgId = await getUserOrgId(sql, userId);
    if (!orgId) return NextResponse.json({ slug: null });
    await ensureOrgSlug();
    const rows = await sql`SELECT slug FROM organizations WHERE id = ${orgId}`;
    return NextResponse.json({ slug: rows[0]?.slug || null });
  }

  const parsed = parseOrError(recruitingActionSchema, rawBody);
  if ("error" in parsed) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  const body = parsed.data;
  const { action } = body;

  // ── Positions ──
  if (action === "create_position") {
    const orgId = await getUserOrgId(sql, userId);
    const result = await sql`
      INSERT INTO recruiting_positions (user_id, org_id, title, description, department, location, salary_min, salary_max, salary_type, required_skills, status, visa_sponsorship, seats)
      VALUES (${userId}, ${orgId}, ${body.title}, ${body.description || null}, ${body.department || null}, ${body.location || null}, ${body.salary_min || null}, ${body.salary_max || null}, ${body.salary_type || "yearly"}, ${body.required_skills || null}, ${body.status || "draft"}, ${body.visa_sponsorship ?? false}, ${body.seats || 1})
      RETURNING *
    `;
    logAudit({ userId, userEmail, action: "recruiting.create_position", resourceType: "position", resourceId: result[0].id as number, details: { title: body.title }, ipAddress: ip });
    return NextResponse.json({ position: result[0] });
  }

  if (action === "update_position") {
    const result = await sql`
      UPDATE recruiting_positions SET
        title = COALESCE(${body.title || null}, title),
        description = COALESCE(${body.description || null}, description),
        department = COALESCE(${body.department || null}, department),
        location = COALESCE(${body.location || null}, location),
        salary_min = COALESCE(${body.salary_min ?? null}, salary_min),
        salary_max = COALESCE(${body.salary_max ?? null}, salary_max),
        required_skills = COALESCE(${body.required_skills || null}, required_skills),
        salary_type = COALESCE(${body.salary_type || null}, salary_type),
        status = COALESCE(${body.status || null}, status),
        visa_sponsorship = COALESCE(${body.visa_sponsorship ?? null}, visa_sponsorship),
        seats = COALESCE(${body.seats ?? null}, seats),
        updated_at = NOW()
      WHERE id = ${body.id}
      RETURNING *
    `;
    logAudit({ userId, userEmail, action: "recruiting.update_position", resourceType: "position", resourceId: body.id, details: {}, ipAddress: ip });
    return NextResponse.json({ position: result[0] });
  }

  if (action === "delete_position") {
    await sql`DELETE FROM recruiting_positions WHERE id = ${body.id}`;
    logAudit({ userId, userEmail, action: "recruiting.delete_position", resourceType: "position", resourceId: body.id, details: {}, ipAddress: ip });
    return NextResponse.json({ message: "Position deleted" });
  }

  // ── Candidates ──
  if (action === "create_candidate") {
    const result = await sql`
      INSERT INTO recruiting_candidates (user_id, first_name, last_name, email, phone, resume_url, linkedin_url, skills, experience, current_company, position_id, source, tags, notes)
      VALUES (${userId}, ${body.first_name}, ${body.last_name || null}, ${body.email}, ${body.phone || null}, ${body.resume_url || null}, ${body.linkedin_url || null}, ${body.skills || null}, ${body.experience || null}, ${body.current_company || null}, ${body.position_id || null}, ${body.source || "manual"}, ${body.tags || null}, ${body.notes || null})
      RETURNING *
    `;
    logAudit({ userId, userEmail, action: "recruiting.create_candidate", resourceType: "candidate", resourceId: result[0].id as number, details: { email: body.email }, ipAddress: ip });
    return NextResponse.json({ candidate: result[0] });
  }

  if (action === "update_candidate") {
    const result = await sql`
      UPDATE recruiting_candidates SET
        first_name = COALESCE(${body.first_name || null}, first_name),
        last_name = COALESCE(${body.last_name || null}, last_name),
        email = COALESCE(${body.email || null}, email),
        phone = COALESCE(${body.phone || null}, phone),
        resume_url = COALESCE(${body.resume_url || null}, resume_url),
        linkedin_url = COALESCE(${body.linkedin_url || null}, linkedin_url),
        skills = COALESCE(${body.skills || null}, skills),
        experience = COALESCE(${body.experience || null}, experience),
        current_company = COALESCE(${body.current_company || null}, current_company),
        position_id = COALESCE(${body.position_id ?? null}, position_id),
        source = COALESCE(${body.source || null}, source),
        tags = COALESCE(${body.tags || null}, tags),
        notes = COALESCE(${body.notes || null}, notes),
        updated_at = NOW()
      WHERE id = ${body.id}
      RETURNING *
    `;
    logAudit({ userId, userEmail, action: "recruiting.update_candidate", resourceType: "candidate", resourceId: body.id, details: {}, ipAddress: ip });
    return NextResponse.json({ candidate: result[0] });
  }

  if (action === "move_candidate") {
    const result = await sql`
      UPDATE recruiting_candidates SET status = ${body.status}, updated_at = NOW()
      WHERE id = ${body.id}
      RETURNING *
    `;
    logAudit({ userId, userEmail, action: "recruiting.move_candidate", resourceType: "candidate", resourceId: body.id, details: { new_status: body.status }, ipAddress: ip });
    return NextResponse.json({ candidate: result[0] });
  }

  if (action === "delete_candidate") {
    await sql`DELETE FROM recruiting_candidates WHERE id = ${body.id}`;
    logAudit({ userId, userEmail, action: "recruiting.delete_candidate", resourceType: "candidate", resourceId: body.id, details: {}, ipAddress: ip });
    return NextResponse.json({ message: "Candidate deleted" });
  }

  // ── Interviews ──
  if (action === "create_interview") {
    const result = await sql`
      INSERT INTO recruiting_interviews (candidate_id, user_id, interviewer, scheduled_at, duration_minutes)
      VALUES (${body.candidate_id}, ${userId}, ${body.interviewer}, ${body.scheduled_at}, ${body.duration_minutes || 60})
      RETURNING *
    `;
    logAudit({ userId, userEmail, action: "recruiting.create_interview", resourceType: "interview", resourceId: result[0].id as number, details: { candidate_id: body.candidate_id }, ipAddress: ip });
    return NextResponse.json({ interview: result[0] });
  }

  if (action === "update_interview") {
    const result = await sql`
      UPDATE recruiting_interviews SET
        feedback = COALESCE(${body.feedback || null}, feedback),
        rating = COALESCE(${body.rating ?? null}, rating)
      WHERE id = ${body.id}
      RETURNING *
    `;
    logAudit({ userId, userEmail, action: "recruiting.update_interview", resourceType: "interview", resourceId: body.id, details: {}, ipAddress: ip });
    return NextResponse.json({ interview: result[0] });
  }

  if (action === "delete_interview") {
    await sql`DELETE FROM recruiting_interviews WHERE id = ${body.id}`;
    logAudit({ userId, userEmail, action: "recruiting.delete_interview", resourceType: "interview", resourceId: body.id, details: {}, ipAddress: ip });
    return NextResponse.json({ message: "Interview deleted" });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
