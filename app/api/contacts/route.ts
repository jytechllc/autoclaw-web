import { NextRequest, NextResponse } from "next/server";
import { auth0 } from "@/lib/auth0";
import { getDb } from "@/lib/db";
import { decrypt } from "@/lib/crypto";
import { checkRateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

function getIp(req: NextRequest): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}

async function ensureContactsTable() {
  const sql = getDb();
  await sql`
    CREATE TABLE IF NOT EXISTS contacts (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
      email VARCHAR(255) NOT NULL,
      first_name VARCHAR(255),
      last_name VARCHAR(255),
      company VARCHAR(255),
      position VARCHAR(255),
      phone VARCHAR(50),
      source VARCHAR(50) DEFAULT 'manual',
      tags TEXT[] DEFAULT '{}',
      notes TEXT,
      brevo_id BIGINT,
      emails_sent INTEGER DEFAULT 0,
      emails_opened INTEGER DEFAULT 0,
      emails_clicked INTEGER DEFAULT 0,
      hard_bounces INTEGER DEFAULT 0,
      soft_bounces INTEGER DEFAULT 0,
      last_opened_at TIMESTAMP,
      stats_synced_at TIMESTAMP,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW(),
      UNIQUE(user_id, email)
    )
  `;
  // Add engagement columns if they don't exist (for existing tables)
  await sql`ALTER TABLE contacts ADD COLUMN IF NOT EXISTS emails_sent INTEGER DEFAULT 0`;
  await sql`ALTER TABLE contacts ADD COLUMN IF NOT EXISTS emails_opened INTEGER DEFAULT 0`;
  await sql`ALTER TABLE contacts ADD COLUMN IF NOT EXISTS emails_clicked INTEGER DEFAULT 0`;
  await sql`ALTER TABLE contacts ADD COLUMN IF NOT EXISTS hard_bounces INTEGER DEFAULT 0`;
  await sql`ALTER TABLE contacts ADD COLUMN IF NOT EXISTS soft_bounces INTEGER DEFAULT 0`;
  await sql`ALTER TABLE contacts ADD COLUMN IF NOT EXISTS last_opened_at TIMESTAMP`;
  await sql`ALTER TABLE contacts ADD COLUMN IF NOT EXISTS stats_synced_at TIMESTAMP`;
}

// GET: list contacts
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
  await ensureContactsTable();

  const email = session.user.email as string;
  const users = await sql`SELECT id FROM users WHERE email = ${email}`;
  if (users.length === 0) {
    return NextResponse.json({ contacts: [], total: 0 });
  }

  const userId = users[0].id;

  // Get all user IDs visible to this user (own + org members)
  const orgMembers = await sql`
    SELECT om2.user_id FROM organization_members om1
    JOIN organization_members om2 ON om1.org_id = om2.org_id
    WHERE om1.user_id = ${userId}
  `;
  const visibleUserIds = [userId, ...orgMembers.map((m) => m.user_id)].filter((v, i, a) => a.indexOf(v) === i);

  const search = req.nextUrl.searchParams.get("search") || "";
  const projectId = req.nextUrl.searchParams.get("project_id");
  const source = req.nextUrl.searchParams.get("source");
  const page = Math.max(1, parseInt(req.nextUrl.searchParams.get("page") || "1"));
  const pageSize = 30;
  const offset = (page - 1) * pageSize;

  let contacts;
  if (search) {
    const like = `%${search}%`;
    contacts = await sql`
      SELECT * FROM contacts
      WHERE user_id = ANY(${visibleUserIds}::int[])
        AND (email ILIKE ${like} OR first_name ILIKE ${like} OR last_name ILIKE ${like} OR company ILIKE ${like})
        ${projectId ? sql`AND project_id = ${Number(projectId)}` : sql``}
        ${source ? sql`AND source = ${source}` : sql``}
      ORDER BY updated_at DESC
      LIMIT ${pageSize} OFFSET ${offset}
    `;
  } else {
    contacts = await sql`
      SELECT * FROM contacts
      WHERE user_id = ANY(${visibleUserIds}::int[])
        ${projectId ? sql`AND project_id = ${Number(projectId)}` : sql``}
        ${source ? sql`AND source = ${source}` : sql``}
      ORDER BY updated_at DESC
      LIMIT ${pageSize} OFFSET ${offset}
    `;
  }

  const totalRows = search
    ? await sql`
        SELECT COUNT(*)::int as count FROM contacts
        WHERE user_id = ANY(${visibleUserIds}::int[])
          AND (email ILIKE ${`%${search}%`} OR first_name ILIKE ${`%${search}%`} OR last_name ILIKE ${`%${search}%`} OR company ILIKE ${`%${search}%`})
          ${projectId ? sql`AND project_id = ${Number(projectId)}` : sql``}
          ${source ? sql`AND source = ${source}` : sql``}
      `
    : await sql`
        SELECT COUNT(*)::int as count FROM contacts
        WHERE user_id = ANY(${visibleUserIds}::int[])
          ${projectId ? sql`AND project_id = ${Number(projectId)}` : sql``}
          ${source ? sql`AND source = ${source}` : sql``}
      `;

  const totalCount = totalRows[0].count;
  return NextResponse.json({
    contacts,
    total: totalCount,
    page,
    pageSize,
    totalPages: Math.ceil(totalCount / pageSize),
  });
}

// POST: create, update, delete, or import from Brevo
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
  await ensureContactsTable();

  const userEmail = session.user.email as string;
  let users = await sql`SELECT id FROM users WHERE email = ${userEmail}`;
  if (users.length === 0) {
    users = await sql`INSERT INTO users (email, name, auth0_id) VALUES (${userEmail}, ${(session.user.name as string) || ""}, ${session.user.sub as string}) RETURNING id`;
  }
  const userId = users[0].id;

  const body = await req.json();
  const { action } = body;

  if (action === "create" || action === "update") {
    const { id, email: contactEmail, first_name, last_name, company, position, phone, source, tags, notes, project_id } = body;

    if (!contactEmail) {
      return NextResponse.json({ error: "Email is required" }, { status: 400 });
    }

    if (action === "update" && id) {
      await sql`
        UPDATE contacts SET
          email = ${contactEmail},
          first_name = ${first_name || null},
          last_name = ${last_name || null},
          company = ${company || null},
          position = ${position || null},
          phone = ${phone || null},
          source = ${source || "manual"},
          tags = ${tags || []},
          notes = ${notes || null},
          project_id = ${project_id || null},
          updated_at = NOW()
        WHERE id = ${id} AND user_id = ${userId}
      `;
      return NextResponse.json({ success: true });
    }

    // Create (upsert)
    await sql`
      INSERT INTO contacts (user_id, email, first_name, last_name, company, position, phone, source, tags, notes, project_id)
      VALUES (${userId}, ${contactEmail}, ${first_name || null}, ${last_name || null}, ${company || null}, ${position || null}, ${phone || null}, ${source || "manual"}, ${tags || []}, ${notes || null}, ${project_id || null})
      ON CONFLICT (user_id, email) DO UPDATE SET
        first_name = COALESCE(NULLIF(${first_name || null}, ''), contacts.first_name),
        last_name = COALESCE(NULLIF(${last_name || null}, ''), contacts.last_name),
        company = COALESCE(NULLIF(${company || null}, ''), contacts.company),
        position = COALESCE(NULLIF(${position || null}, ''), contacts.position),
        phone = COALESCE(NULLIF(${phone || null}, ''), contacts.phone),
        notes = COALESCE(NULLIF(${notes || null}, ''), contacts.notes),
        project_id = COALESCE(${project_id || null}, contacts.project_id),
        updated_at = NOW()
    `;
    return NextResponse.json({ success: true });
  }

  if (action === "delete") {
    const { id } = body;
    if (!id) return NextResponse.json({ error: "Contact ID required" }, { status: 400 });
    await sql`DELETE FROM contacts WHERE id = ${id} AND user_id = ${userId}`;
    return NextResponse.json({ success: true });
  }

  if (action === "import_brevo") {
    // Get user's Brevo API key (BYOK or system)
    let brevoKey = process.env.BREVO_API_KEY || "";
    const byokRows = await sql`SELECT api_key FROM user_api_keys WHERE user_id = ${userId} AND service = 'brevo'`;
    if (byokRows.length > 0) {
      try { brevoKey = decrypt(byokRows[0].api_key as string); } catch { /* use system key */ }
    }

    if (!brevoKey) {
      return NextResponse.json({ error: "No Brevo API key configured" }, { status: 400 });
    }

    try {
      // Fetch contacts from Brevo (paginated)
      let imported = 0;
      let offset = 0;
      const limit = 50;
      let hasMore = true;

      while (hasMore) {
        const res = await fetch(`https://api.brevo.com/v3/contacts?limit=${limit}&offset=${offset}&sort=desc`, {
          headers: { "api-key": brevoKey, "Content-Type": "application/json" },
        });

        if (!res.ok) {
          const errText = await res.text();
          console.error("Brevo API error:", errText);
          break;
        }

        const data = await res.json();
        const contacts = data.contacts || [];

        for (const c of contacts) {
          // Skip contacts without email (e.g. Brevo system contacts like "Welcome Bot")
          if (!c.email || typeof c.email !== "string" || !c.email.includes("@")) continue;
          const attrs = (c.attributes || {}) as Record<string, string>;
          await sql`
            INSERT INTO contacts (user_id, email, first_name, last_name, company, position, phone, source, brevo_id)
            VALUES (
              ${userId},
              ${c.email as string},
              ${attrs.FIRSTNAME || attrs.PRENOM || null},
              ${attrs.LASTNAME || attrs.NOM || null},
              ${attrs.COMPANY || attrs.SMS || null},
              ${attrs.JOB_TITLE || null},
              ${attrs.PHONE || attrs.SMS || null},
              'brevo',
              ${c.id as number}
            )
            ON CONFLICT (user_id, email) DO UPDATE SET
              first_name = COALESCE(NULLIF(${attrs.FIRSTNAME || attrs.PRENOM || null}, ''), contacts.first_name),
              last_name = COALESCE(NULLIF(${attrs.LASTNAME || attrs.NOM || null}, ''), contacts.last_name),
              company = COALESCE(NULLIF(${attrs.COMPANY || null}, ''), contacts.company),
              position = COALESCE(NULLIF(${attrs.JOB_TITLE || null}, ''), contacts.position),
              phone = COALESCE(NULLIF(${attrs.PHONE || attrs.SMS || null}, ''), contacts.phone),
              brevo_id = ${c.id as number},
              source = CASE WHEN contacts.source = 'manual' THEN 'brevo' ELSE contacts.source END,
              updated_at = NOW()
          `;
          imported++;
        }

        hasMore = contacts.length === limit;
        offset += limit;

        // Safety limit: max 500 contacts per import
        if (offset >= 500) break;
      }

      return NextResponse.json({ success: true, imported });
    } catch (err) {
      console.error("Brevo import error:", err);
      return NextResponse.json({ error: "Failed to import from Brevo" }, { status: 500 });
    }
  }

  if (action === "sync_stats") {
    // Sync engagement stats from Brevo for all contacts
    let brevoKey = process.env.BREVO_API_KEY || "";
    const byokRows = await sql`SELECT api_key FROM user_api_keys WHERE user_id = ${userId} AND service = 'brevo'`;
    if (byokRows.length > 0) {
      try { brevoKey = decrypt(byokRows[0].api_key as string); } catch { /* use system key */ }
    }

    if (!brevoKey) {
      return NextResponse.json({ error: "No Brevo API key configured" }, { status: 400 });
    }

    try {
      // Get all contacts with brevo_id or source=brevo
      const contactsToSync = await sql`
        SELECT id, email FROM contacts
        WHERE user_id = ${userId} AND (brevo_id IS NOT NULL OR source = 'brevo')
        ORDER BY stats_synced_at ASC NULLS FIRST
        LIMIT 50
      `;

      let synced = 0;
      for (const contact of contactsToSync) {
        try {
          const res = await fetch(`https://api.brevo.com/v3/contacts/${encodeURIComponent(contact.email as string)}`, {
            headers: { "api-key": brevoKey },
          });
          if (!res.ok) continue;

          const data = await res.json();
          const stats = data.statistics?.messagesSent || [];
          // Aggregate stats from all campaigns
          let sent = 0, opened = 0, clicked = 0, hardBounce = 0, softBounce = 0;
          let lastOpened: string | null = null;

          for (const s of stats) {
            if (s.eventTime) {
              sent++;
              if (s.events) {
                for (const evt of s.events) {
                  if (evt.event === "opened") {
                    opened++;
                    if (!lastOpened || evt.eventTime > lastOpened) lastOpened = evt.eventTime;
                  }
                  if (evt.event === "clicked") clicked++;
                  if (evt.event === "hardBounce") hardBounce++;
                  if (evt.event === "softBounce") softBounce++;
                }
              }
            }
          }

          // Also check transactional stats
          const txStats = data.statistics?.transacSms || [];
          sent += txStats.length;

          await sql`
            UPDATE contacts SET
              emails_sent = ${sent},
              emails_opened = ${opened},
              emails_clicked = ${clicked},
              hard_bounces = ${hardBounce},
              soft_bounces = ${softBounce},
              last_opened_at = ${lastOpened},
              stats_synced_at = NOW()
            WHERE id = ${contact.id}
          `;
          synced++;
        } catch {
          // Skip individual contact errors
        }
      }

      return NextResponse.json({ success: true, synced });
    } catch (err) {
      console.error("Stats sync error:", err);
      return NextResponse.json({ error: "Failed to sync stats" }, { status: 500 });
    }
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
