import { NextRequest, NextResponse } from "next/server";
import { auth0 } from "@/lib/auth0";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

const SEED_SKILLS = [
  { key: "skillColdEmail", category: "email", sort_order: 1 },
  { key: "skillFollowUp", category: "email", sort_order: 2 },
  { key: "skillNewsletter", category: "email", sort_order: 3 },
  { key: "skillEmailTemplate", category: "email", sort_order: 4 },
  { key: "skillBlogWriter", category: "seo", sort_order: 5 },
  { key: "skillKeywordResearch", category: "seo", sort_order: 6 },
  { key: "skillSeoAudit", category: "seo", sort_order: 7 },
  { key: "skillMetaOptimizer", category: "seo", sort_order: 8 },
  { key: "skillWebScraper", category: "leads", sort_order: 9 },
  { key: "skillEnrichment", category: "leads", sort_order: 10 },
  { key: "skillCrmSync", category: "leads", sort_order: 11 },
  { key: "skillTweetComposer", category: "social", sort_order: 13 },
  { key: "skillContentScheduler", category: "social", sort_order: 14 },
  { key: "skillSocialListening", category: "social", sort_order: 15 },
  { key: "skillHashtagResearch", category: "social", sort_order: 16 },
  { key: "skillTrafficDashboard", category: "analytics", sort_order: 17 },
  { key: "skillCampaignAnalytics", category: "analytics", sort_order: 18 },
  { key: "skillConversionTracking", category: "analytics", sort_order: 19 },
  { key: "skillReportGenerator", category: "analytics", sort_order: 20 },
  { key: "skillWorkflowBuilder", category: "automation", sort_order: 21 },
  { key: "skillWebhookTrigger", category: "automation", sort_order: 22 },
  { key: "skillDataPipeline", category: "automation", sort_order: 23 },
  { key: "skillTaskScheduler", category: "automation", sort_order: 24 },
];

async function ensureSkillsTables() {
  const sql = getDb();
  await sql`
    CREATE TABLE IF NOT EXISTS skills (
      id SERIAL PRIMARY KEY,
      key VARCHAR(100) UNIQUE NOT NULL,
      category VARCHAR(50) NOT NULL,
      sort_order INTEGER DEFAULT 0,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS user_skills (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      skill_id INTEGER REFERENCES skills(id) ON DELETE CASCADE,
      active BOOLEAN DEFAULT true,
      created_at TIMESTAMP DEFAULT NOW(),
      UNIQUE(user_id, skill_id)
    )
  `;
  // Seed skills if empty
  const count = await sql`SELECT COUNT(*)::int AS c FROM skills`;
  if (count[0].c === 0) {
    for (const s of SEED_SKILLS) {
      await sql`INSERT INTO skills (key, category, sort_order) VALUES (${s.key}, ${s.category}, ${s.sort_order}) ON CONFLICT (key) DO NOTHING`;
    }
  }
}

export async function GET() {
  try {
    const session = await auth0.getSession();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const sql = getDb();
    await ensureSkillsTables();

    const email = session.user.email as string;
    const users = await sql`SELECT id FROM users WHERE email = ${email}`;
    if (users.length === 0) {
      return NextResponse.json({ skills: [] });
    }

    const userId = users[0].id;

    // Get all skills with user activation status and agent usage count
    const skills = await sql`
      SELECT
        s.id,
        s.key,
        s.category,
        s.sort_order,
        COALESCE(us.active, false) AS active,
        (
          SELECT COUNT(*)::int FROM agent_assignments aa
          JOIN projects p ON aa.project_id = p.id
          WHERE p.user_id = ${userId}
            AND aa.status = 'active'
            AND aa.config->>'skills' LIKE '%' || s.key || '%'
        ) AS agents
      FROM skills s
      LEFT JOIN user_skills us ON us.skill_id = s.id AND us.user_id = ${userId}
      ORDER BY s.sort_order
    `;

    return NextResponse.json({ skills });
  } catch (err) {
    console.error("Skills GET error:", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await auth0.getSession();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const sql = getDb();
    await ensureSkillsTables();

    const email = session.user.email as string;
    const users = await sql`SELECT id FROM users WHERE email = ${email}`;
    if (users.length === 0) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const userId = users[0].id;
    const body = await req.json();
    const { skill_id, active } = body;

    if (!skill_id || typeof active !== "boolean") {
      return NextResponse.json({ error: "skill_id and active required" }, { status: 400 });
    }

    // Verify skill exists
    const skillRows = await sql`SELECT id FROM skills WHERE id = ${skill_id}`;
    if (skillRows.length === 0) {
      return NextResponse.json({ error: "Skill not found" }, { status: 404 });
    }

    await sql`
      INSERT INTO user_skills (user_id, skill_id, active)
      VALUES (${userId}, ${skill_id}, ${active})
      ON CONFLICT (user_id, skill_id)
      DO UPDATE SET active = ${active}
    `;

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("Skills POST error:", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
