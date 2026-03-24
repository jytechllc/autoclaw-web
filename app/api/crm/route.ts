import { NextRequest, NextResponse } from "next/server";
import { auth0 } from "@/lib/auth0";
import { getDb } from "@/lib/db";
import { checkRateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

function getIp(req: NextRequest): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}

async function ensureTasksTable() {
  const sql = getDb();
  await sql`
    CREATE TABLE IF NOT EXISTS crm_tasks (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
      title VARCHAR(255) NOT NULL,
      description TEXT,
      status VARCHAR(20) DEFAULT 'todo' CHECK (status IN ('todo', 'in_progress', 'done')),
      priority VARCHAR(10) DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high')),
      assignee VARCHAR(255),
      due_date DATE,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )
  `;
}

async function getUserId(sql: ReturnType<typeof getDb>, email: string) {
  const users = await sql`SELECT id FROM users WHERE email = ${email}`;
  return users.length > 0 ? users[0].id : null;
}

async function getVisibleUserIds(sql: ReturnType<typeof getDb>, userId: number) {
  const orgMembers = await sql`
    SELECT om2.user_id FROM organization_members om1
    JOIN organization_members om2 ON om1.org_id = om2.org_id
    WHERE om1.user_id = ${userId}
  `;
  return [userId, ...orgMembers.map((m) => m.user_id)].filter((v, i, a) => a.indexOf(v) === i);
}

// GET: returns contacts (paginated), companies (aggregated), tasks, and stats
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
  await ensureTasksTable();

  const email = session.user.email as string;
  const userId = await getUserId(sql, email);
  if (!userId) {
    return NextResponse.json({ contacts: [], companies: [], tasks: [], stats: { totalContacts: 0, totalCompanies: 0, totalEmailsSent: 0, responseRate: 0 } });
  }

  const visibleUserIds = await getVisibleUserIds(sql, userId);
  const tab = req.nextUrl.searchParams.get("tab") || "contacts";

  if (tab === "groups") {
    const groups = await sql`
      SELECT g.*, (SELECT COUNT(*)::int FROM contact_group_members WHERE group_id = g.id) as member_count,
        u.email as creator_email
      FROM contact_groups g
      LEFT JOIN users u ON g.user_id = u.id
      WHERE g.user_id = ANY(${visibleUserIds}::int[])
      ORDER BY g.created_at DESC
    `;
    return NextResponse.json({ groups });
  }

  if (tab === "group_members") {
    const groupId = req.nextUrl.searchParams.get("group_id");
    if (!groupId) return NextResponse.json({ error: "group_id required" }, { status: 400 });
    const members = await sql`
      SELECT c.* FROM contacts c
      JOIN contact_group_members gm ON gm.contact_id = c.id
      WHERE gm.group_id = ${Number(groupId)}
      ORDER BY c.first_name
    `;
    return NextResponse.json({ members });
  }

  if (tab === "contacts") {
    const search = req.nextUrl.searchParams.get("search") || "";
    const company = req.nextUrl.searchParams.get("company") || "";
    const source = req.nextUrl.searchParams.get("source") || "";
    const projectId = req.nextUrl.searchParams.get("project_id") || "";
    const page = Math.max(1, parseInt(req.nextUrl.searchParams.get("page") || "1"));
    const pageSize = 30;
    const offset = (page - 1) * pageSize;

    const like = search ? `%${search}%` : "";
    const companyLike = company ? `%${company}%` : "";

    const contacts = await sql`
      SELECT DISTINCT ON (email) * FROM contacts
      WHERE user_id = ANY(${visibleUserIds}::int[])
        ${search ? sql`AND (email ILIKE ${like} OR first_name ILIKE ${like} OR last_name ILIKE ${like} OR company ILIKE ${like})` : sql``}
        ${company ? sql`AND company ILIKE ${companyLike}` : sql``}
        ${source ? sql`AND source = ${source}` : sql``}
        ${projectId ? sql`AND project_id = ${Number(projectId)}` : sql``}
      ORDER BY email, updated_at DESC
      LIMIT ${pageSize} OFFSET ${offset}
    `;

    const totalRows = await sql`
      SELECT COUNT(DISTINCT email)::int as count FROM contacts
      WHERE user_id = ANY(${visibleUserIds}::int[])
        ${search ? sql`AND (email ILIKE ${like} OR first_name ILIKE ${like} OR last_name ILIKE ${like} OR company ILIKE ${like})` : sql``}
        ${company ? sql`AND company ILIKE ${companyLike}` : sql``}
        ${source ? sql`AND source = ${source}` : sql``}
        ${projectId ? sql`AND project_id = ${Number(projectId)}` : sql``}
    `;

    return NextResponse.json({
      contacts,
      total: totalRows[0].count,
      page,
      pageSize,
      totalPages: Math.ceil(totalRows[0].count / pageSize),
    });
  }

  if (tab === "companies") {
    const companies = await sql`
      SELECT
        company,
        SUBSTRING(email FROM POSITION('@' IN email) + 1) as domain,
        COUNT(DISTINCT email)::int as contact_count,
        COALESCE(SUM(emails_sent), 0)::int as total_emails_sent,
        COALESCE(SUM(emails_opened), 0)::int as total_emails_opened
      FROM contacts
      WHERE user_id = ANY(${visibleUserIds}::int[])
        AND company IS NOT NULL AND company != ''
      GROUP BY company, domain
      ORDER BY contact_count DESC
      LIMIT 200
    `;
    return NextResponse.json({ companies });
  }

  if (tab === "tasks") {
    // Show tasks from self + org members
    const tasks = await sql`
      SELECT t.*, u.email as creator_email
      FROM crm_tasks t
      LEFT JOIN users u ON t.user_id = u.id
      WHERE t.user_id = ANY(${visibleUserIds}::int[])
      ORDER BY
        CASE t.priority WHEN 'high' THEN 0 WHEN 'medium' THEN 1 WHEN 'low' THEN 2 END,
        t.due_date ASC NULLS LAST,
        t.created_at DESC
    `;
    return NextResponse.json({ tasks });
  }

  if (tab === "stats") {
    const stats = await sql`
      SELECT
        COUNT(DISTINCT email)::int as total_contacts,
        COUNT(DISTINCT CASE WHEN company IS NOT NULL AND company != '' THEN company END)::int as total_companies,
        COALESCE(SUM(emails_sent), 0)::int as total_emails_sent,
        COALESCE(SUM(emails_opened), 0)::int as total_emails_opened
      FROM contacts
      WHERE user_id = ANY(${visibleUserIds}::int[])
    `;
    const s = stats[0];
    const responseRate = s.total_emails_sent > 0 ? Math.round((s.total_emails_opened / s.total_emails_sent) * 100) : 0;
    return NextResponse.json({
      stats: {
        totalContacts: s.total_contacts,
        totalCompanies: s.total_companies,
        totalEmailsSent: s.total_emails_sent,
        responseRate,
      },
    });
  }

  if (tab === "company_contacts") {
    const companyName = req.nextUrl.searchParams.get("company_name") || "";
    const contacts = await sql`
      SELECT DISTINCT ON (email) * FROM contacts
      WHERE user_id = ANY(${visibleUserIds}::int[])
        AND company = ${companyName}
      ORDER BY email, updated_at DESC
    `;
    return NextResponse.json({ contacts });
  }

  return NextResponse.json({ error: "Unknown tab" }, { status: 400 });
}

// POST: create/update/delete tasks
export async function POST(req: NextRequest) {
  const ip = getIp(req);
  if (!checkRateLimit(ip, { limit: 60, windowMs: 60_000 })) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  const session = await auth0.getSession();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sql = getDb();
  await ensureTasksTable();

  const userEmail = session.user.email as string;
  let users = await sql`SELECT id FROM users WHERE email = ${userEmail}`;
  if (users.length === 0) {
    users = await sql`INSERT INTO users (email, name, auth0_id) VALUES (${userEmail}, ${(session.user.name as string) || ""}, ${session.user.sub as string}) RETURNING id`;
  }
  const userId = users[0].id as number;
  const visibleUserIds = await getVisibleUserIds(sql, userId);

  const body = await req.json();
  const { action } = body;

  if (action === "create_task") {
    const { title, description, status, priority, assignee, due_date, project_id } = body;
    if (!title) {
      return NextResponse.json({ error: "Title is required" }, { status: 400 });
    }
    const result = await sql`
      INSERT INTO crm_tasks (user_id, project_id, title, description, status, priority, assignee, due_date)
      VALUES (${userId}, ${project_id || null}, ${title}, ${description || null}, ${status || "todo"}, ${priority || "medium"}, ${assignee || null}, ${due_date || null})
      RETURNING *
    `;
    return NextResponse.json({ task: result[0] });
  }

  if (action === "update_task") {
    const { id, title, description, status, priority, assignee, due_date } = body;
    if (!id) return NextResponse.json({ error: "Task ID required" }, { status: 400 });
    const result = await sql`
      UPDATE crm_tasks SET
        title = COALESCE(${title || null}, title),
        description = ${description !== undefined ? description : null},
        status = COALESCE(${status || null}, status),
        priority = COALESCE(${priority || null}, priority),
        assignee = ${assignee !== undefined ? assignee : null},
        due_date = ${due_date !== undefined ? due_date : null},
        updated_at = NOW()
      WHERE id = ${id} AND user_id = ANY(${visibleUserIds}::int[])
      RETURNING *
    `;
    return NextResponse.json({ task: result[0] });
  }

  if (action === "delete_task") {
    const { id } = body;
    if (!id) return NextResponse.json({ error: "Task ID required" }, { status: 400 });
    await sql`DELETE FROM crm_tasks WHERE id = ${id} AND user_id = ANY(${visibleUserIds}::int[])`;
    return NextResponse.json({ success: true });
  }

  if (action === "move_task") {
    const { id, status } = body;
    if (!id || !status) return NextResponse.json({ error: "Task ID and status required" }, { status: 400 });
    if (!["todo", "in_progress", "done"].includes(status)) {
      return NextResponse.json({ error: "Invalid status" }, { status: 400 });
    }
    const result = await sql`
      UPDATE crm_tasks SET status = ${status}, updated_at = NOW()
      WHERE id = ${id} AND user_id = ANY(${visibleUserIds}::int[])
      RETURNING *
    `;
    return NextResponse.json({ task: result[0] });
  }

  if (action === "import_contacts") {
    const contacts = body.contacts as { email: string; firstName: string; lastName: string; company: string; position: string }[];
    const sourceDetail = (body.source_detail as string) || "Smart Import";
    if (!contacts?.length) return NextResponse.json({ error: "No contacts to import" }, { status: 400 });

    // Get or create a default project
    let projects = await sql`SELECT id FROM projects WHERE user_id = ${userId} ORDER BY created_at LIMIT 1`;
    if (projects.length === 0) {
      projects = await sql`INSERT INTO projects (user_id, name, description) VALUES (${userId}, 'My Project', 'Auto-created') RETURNING id`;
    }
    const projectId = projects[0].id as number;

    let imported = 0;
    for (const c of contacts) {
      if (!c.email) continue;
      try {
        await sql`
          INSERT INTO contacts (user_id, project_id, email, first_name, last_name, company, position, source, source_detail)
          VALUES (${userId}, ${projectId}, ${c.email.toLowerCase()}, ${c.firstName || ''}, ${c.lastName || ''}, ${c.company || ''}, ${c.position || ''}, 'manual', ${sourceDetail})
          ON CONFLICT (user_id, email) DO UPDATE SET
            first_name = COALESCE(NULLIF(${c.firstName || ''}, ''), contacts.first_name),
            last_name = COALESCE(NULLIF(${c.lastName || ''}, ''), contacts.last_name),
            company = COALESCE(NULLIF(${c.company || ''}, ''), contacts.company),
            position = COALESCE(NULLIF(${c.position || ''}, ''), contacts.position),
            updated_at = NOW()
        `;
        imported++;
      } catch { /* skip */ }
    }
    return NextResponse.json({ success: true, imported });
  }

  if (action === "create_group") {
    const { name, color, description } = body;
    if (!name) return NextResponse.json({ error: "Group name required" }, { status: 400 });
    const result = await sql`
      INSERT INTO contact_groups (user_id, name, color, description)
      VALUES (${userId}, ${name}, ${color || '#6b7280'}, ${description || null})
      RETURNING *
    `;
    return NextResponse.json({ group: result[0] });
  }

  if (action === "delete_group") {
    const { id } = body;
    if (!id) return NextResponse.json({ error: "Group ID required" }, { status: 400 });
    await sql`DELETE FROM contact_groups WHERE id = ${id} AND user_id = ANY(${visibleUserIds}::int[])`;
    return NextResponse.json({ success: true });
  }

  if (action === "add_to_group") {
    const { group_id, contact_ids } = body;
    if (!group_id || !contact_ids?.length) return NextResponse.json({ error: "group_id and contact_ids required" }, { status: 400 });
    let added = 0;
    for (const cid of contact_ids as number[]) {
      try {
        await sql`INSERT INTO contact_group_members (group_id, contact_id) VALUES (${group_id}, ${cid}) ON CONFLICT DO NOTHING`;
        added++;
      } catch { /* skip */ }
    }
    return NextResponse.json({ success: true, added });
  }

  if (action === "remove_from_group") {
    const { group_id, contact_id } = body;
    if (!group_id || !contact_id) return NextResponse.json({ error: "group_id and contact_id required" }, { status: 400 });
    await sql`DELETE FROM contact_group_members WHERE group_id = ${group_id} AND contact_id = ${contact_id}`;
    return NextResponse.json({ success: true });
  }

  if (action === "smart_parse") {
    const text = (body.text as string || "").trim();
    if (!text) return NextResponse.json({ error: "Text required" }, { status: 400 });

    const CEREBRAS_API_KEY = process.env.CEREBRAS_API_KEY;
    if (!CEREBRAS_API_KEY) return NextResponse.json({ error: "AI not configured" }, { status: 503 });

    const prompt = `Extract all contact information from the following text. The text may be in any format — email lists, business cards, spreadsheets, free-form text, "Name <email>" format, semicolon-separated, etc.

Text:
${text.substring(0, 3000)}

For each person found, extract:
- email (required — skip entries without email)
- firstName
- lastName
- company (from email domain if not explicit; include contacts from gmail/yahoo/etc too, just leave company empty)
- position/title (if available)

Return ONLY a JSON array: [{"email":"...","firstName":"...","lastName":"...","company":"...","position":"..."}]
Do NOT skip any email address. Include ALL emails found in the text.`;

    try {
      const res = await fetch("https://api.cerebras.ai/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${CEREBRAS_API_KEY}` },
        body: JSON.stringify({ model: "qwen-3-235b-a22b-instruct-2507", messages: [{ role: "user", content: prompt }], max_tokens: 3000 }),
      });
      if (res.ok) {
        const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
        const content = data.choices?.[0]?.message?.content || "";
        const jsonMatch = content.match(/\[[\s\S]*\]/);
        if (jsonMatch) {
          const contacts = JSON.parse(jsonMatch[0]) as { email: string; firstName: string; lastName: string; company: string; position: string }[];
          // Dedupe by email
          const seen = new Set<string>();
          const unique = contacts.filter((c) => {
            if (!c.email || seen.has(c.email.toLowerCase())) return false;
            seen.add(c.email.toLowerCase());
            return true;
          });
          return NextResponse.json({ contacts: unique });
        }
      }
    } catch { /* AI parse failed */ }

    return NextResponse.json({ contacts: [] });
  }

  if (action === "enrich_contacts") {
    const contacts = body.contacts as { email: string; firstName: string; lastName: string; company: string; position: string }[];
    if (!contacts?.length) return NextResponse.json({ error: "No contacts to enrich" }, { status: 400 });

    // Try Apollo people/match for each contact (uses BYOK or system key)
    const APOLLO_API_KEY = process.env.APOLLO_API_KEY;
    let apolloKey = APOLLO_API_KEY || "";

    // Load user/org Apollo key
    try {
      const { decrypt } = await import("@/lib/crypto");
      const rows = await sql`
        SELECT api_key FROM user_api_keys WHERE user_id = ${userId} AND service = 'apollo'
        UNION ALL
        SELECT ok.api_key FROM org_api_keys ok
          WHERE ok.service = 'apollo'
          AND ok.org_id IN (SELECT org_id FROM organization_members WHERE user_id = ${userId})
        LIMIT 1
      `;
      if (rows.length > 0) apolloKey = decrypt(rows[0].api_key as string);
    } catch { /* use system key */ }

    if (!apolloKey) {
      // Fallback to AI enrichment only
      const CEREBRAS_API_KEY = process.env.CEREBRAS_API_KEY;
      if (!CEREBRAS_API_KEY) return NextResponse.json({ enriched: contacts });

      const summary = contacts.map((c) => `${c.email} | ${c.firstName} ${c.lastName} | ${c.company} | ${c.position}`).join("\n");
      const prompt = `Enrich these contacts — fill in missing company, position/title, name fields based on email domain and public knowledge.

${summary}

Return ONLY a JSON array: [{"email":"...","firstName":"...","lastName":"...","company":"...","position":"..."}]`;

      try {
        const res = await fetch("https://api.cerebras.ai/v1/chat/completions", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${CEREBRAS_API_KEY}` },
          body: JSON.stringify({ model: "qwen-3-235b-a22b-instruct-2507", messages: [{ role: "user", content: prompt }], max_tokens: 3000 }),
        });
        if (res.ok) {
          const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
          const content = data.choices?.[0]?.message?.content || "";
          const jsonMatch = content.match(/\[[\s\S]*\]/);
          if (jsonMatch) {
            const enriched = JSON.parse(jsonMatch[0]) as typeof contacts;
            const enrichedMap = new Map(enriched.map((e) => [e.email.toLowerCase(), e]));
            const merged = contacts.map((c) => {
              const e = enrichedMap.get(c.email.toLowerCase());
              return e ? { ...c, firstName: e.firstName || c.firstName, lastName: e.lastName || c.lastName, company: e.company || c.company, position: e.position || c.position } : c;
            });
            return NextResponse.json({ enriched: merged });
          }
        }
      } catch { /* ignore */ }

      return NextResponse.json({ enriched: contacts });
    }

    // Apollo enrichment — match each contact
    const enriched = [...contacts];
    for (let i = 0; i < enriched.length && i < 20; i++) {
      const c = enriched[i];
      try {
        const matchBody: Record<string, string> = {};
        if (c.email) matchBody.email = c.email;
        else if (c.firstName && c.company) {
          matchBody.first_name = c.firstName;
          if (c.lastName) matchBody.last_name = c.lastName;
          matchBody.organization_name = c.company;
        } else continue;

        const res = await fetch("https://api.apollo.io/v1/people/match", {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Api-Key": apolloKey },
          body: JSON.stringify(matchBody),
        });
        if (!res.ok) break; // stop if credits exhausted
        const data = (await res.json()) as { person?: Record<string, unknown> };
        const p = data.person;
        if (p) {
          enriched[i] = {
            email: (p.email as string) || c.email,
            firstName: (p.first_name as string) || c.firstName,
            lastName: (p.last_name as string) || c.lastName,
            company: (p.organization_name as string) || c.company,
            position: (p.title as string) || c.position,
          };
        }
      } catch { break; }
    }

    return NextResponse.json({ enriched });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
