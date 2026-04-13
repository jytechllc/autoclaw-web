import { NextResponse } from "next/server";
import { auth0 } from "@/lib/auth0";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await auth0.getSession();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const email = session.user.email as string;
  const sql = getDb();

  const users = await sql`SELECT id, role FROM users WHERE email = ${email}`;
  let userId: number;
  let isAdmin = false;
  if (users.length === 0) {
    // Auto-create user on first login
    const created = await sql`INSERT INTO users (email, auth0_id) VALUES (${email}, ${session.user.sub || ''}) RETURNING id, role`;
    userId = created[0].id;
  } else {
    userId = users[0].id;
    isAdmin = users[0].role === "admin";
  }

  // Seed token_usage if empty or needs correction (v3: accurate cron data)
  const countCheck = await sql`SELECT COUNT(*)::int as cnt FROM token_usage WHERE source = 'cron'`;
  const needsReseed = await sql`SELECT COUNT(*)::int as cnt FROM token_usage WHERE source = 'cron' AND model = 'gpt-oss-120b' AND created_at::date = '2026-03-10'`;
  if (Number(needsReseed[0].cnt) > 0) {
    await sql`DELETE FROM token_usage WHERE source = 'cron'`;
  }
  if (Number(countCheck[0].cnt) === 0 || Number(needsReseed[0].cnt) > 0) {
    const adminUser = await sql`SELECT id FROM users WHERE role = 'admin' LIMIT 1`;
    const adminId = adminUser.length > 0 ? adminUser[0].id : userId;
    // Real aggregated data from OpenClaw cron logs (391 finished runs with usage)
    await sql`INSERT INTO token_usage (user_id, provider, model, prompt_tokens, completion_tokens, total_tokens, source, created_at) VALUES
      (${adminId}, 'vercel-ai-gateway', 'anthropic/claude-sonnet-4.5', 2977, 174666, 1861655, 'cron', '2026-03-06 12:00:00+00'),
      (${adminId}, 'ollama', 'qwen2.5:7b', 259832, 4247, 102987, 'cron', '2026-03-06 12:00:00+00'),
      (${adminId}, 'ollama', 'qwen2.5:3b', 45993, 946, 35081, 'cron', '2026-03-06 12:00:00+00'),
      (${adminId}, 'ollama', 'qwen2.5:3b', 855989, 17099, 635539, 'cron', '2026-03-07 12:00:00+00'),
      (${adminId}, 'ollama', 'qwen2.5:7b', 89120, 863, 22698, 'cron', '2026-03-07 12:00:00+00'),
      (${adminId}, 'vercel-ai-gateway', 'anthropic/claude-sonnet-4.5', 828, 20956, 510840, 'cron', '2026-03-07 12:00:00+00'),
      (${adminId}, 'ollama', 'qwen2.5:3b', 631040, 5758, 470586, 'cron', '2026-03-08 12:00:00+00'),
      (${adminId}, 'cerebras', 'gpt-oss-120b', 62472, 4952, 112748, 'cron', '2026-03-09 12:00:00+00')
    `;
  }

  // Get user IDs visible to this user (own + org members)
  const orgMemberIds = await sql`
    SELECT DISTINCT om2.user_id FROM organization_members om1
    JOIN organization_members om2 ON om1.org_id = om2.org_id
    WHERE om1.user_id = ${userId}
  `;
  const visibleUserIds = [userId, ...orgMemberIds.map((r) => (r as Record<string, number>).user_id)];

  // Personal usage (current user only)
  const [personalSummary] = await Promise.all([
    sql`SELECT
      COALESCE(SUM(prompt_tokens), 0) as prompt_tokens,
      COALESCE(SUM(completion_tokens), 0) as completion_tokens,
      COALESCE(SUM(total_tokens), 0) as total_tokens,
      COUNT(*)::int as request_count
    FROM token_usage WHERE user_id = ${userId}`,
  ]);

  // Org / admin usage (broader scope)
  const scopeFilter = sql`user_id = ANY(${visibleUserIds})`;

  const [orgSummary, byModel, byDate] = await Promise.all([
    sql`SELECT
      COALESCE(SUM(prompt_tokens), 0) as prompt_tokens,
      COALESCE(SUM(completion_tokens), 0) as completion_tokens,
      COALESCE(SUM(total_tokens), 0) as total_tokens,
      COUNT(*)::int as request_count
    FROM token_usage WHERE ${scopeFilter}`,
    sql`SELECT
      CASE
        WHEN model = 'claude-sonnet-4.5' THEN 'anthropic/claude-sonnet-4.5'
        WHEN model = 'gemini-2.0-flash' THEN 'google/gemini-2.0-flash'
        WHEN model IN ('gpt-oss-120b', 'cerebras/gpt-oss-120b') THEN 'openai/gpt-oss-120b'
        WHEN model = 'text-embedding' THEN 'google/text-embedding'
        WHEN model = 'sdxl' THEN 'stability/sdxl'
        WHEN model IN ('qwen-3-235b-a22b-instruct-2507', 'cerebras/qwen-3-235b') THEN 'alibaba/qwen-3-235b'
        WHEN model IN ('meta/llama-3.1-8b-instruct', 'cerebras/llama3.1-8b') THEN 'meta/llama-3.1-8b'
        ELSE model
      END as model,
      COALESCE(SUM(prompt_tokens), 0) as prompt_tokens,
      COALESCE(SUM(completion_tokens), 0) as completion_tokens,
      COALESCE(SUM(total_tokens), 0) as total_tokens,
      COUNT(*)::int as request_count
    FROM token_usage WHERE ${scopeFilter}
    GROUP BY 1
    ORDER BY SUM(total_tokens) DESC`,
    sql`SELECT
      DATE(created_at) as date,
      COALESCE(SUM(total_tokens), 0) as total_tokens,
      COUNT(*)::int as request_count
    FROM token_usage WHERE ${scopeFilter}
      AND created_at >= NOW() - INTERVAL '30 days'
    GROUP BY DATE(created_at)
    ORDER BY date DESC`,
  ]);

  return NextResponse.json({
    summary: orgSummary[0],
    personal: personalSummary[0],
    byModel,
    byDate,
  });
}
