import { NextResponse } from "next/server";
import { auth0 } from "@/lib/auth0";
import { getDb, resolveUserPlan } from "@/lib/db";

export const dynamic = "force-dynamic";

const DAILY_LIMIT_CENTS: Record<string, number> = {
  starter: 500,     // $5.00 free daily credit
  growth: 5000,
  scale: 50000,
  enterprise: 0,
};

const COST_PER_M: Record<string, { input: number; output: number }> = {
  cerebras: { input: 0, output: 0 },
  nvidia: { input: 0, output: 0 },
  google: { input: 10, output: 40 },
  openai: { input: 15, output: 60 },
  anthropic: { input: 300, output: 1500 },
};

export async function GET() {
  try {
    const session = await auth0.getSession();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const sql = getDb();
    const email = session.user.email as string;

    const users = await sql`SELECT id, plan FROM users WHERE email = ${email}`;
    if (users.length === 0) {
      return NextResponse.json({ quota: { plan: "starter", dailyLimitCents: 500, todaySpendCents: 0, remaining: 500, percentage: 0 } });
    }

    const userId = users[0].id;
    const userPlan = await resolveUserPlan(sql, userId, (users[0].plan as string) || "starter", email);
    const dailyLimitCents = DAILY_LIMIT_CENTS[userPlan] || 100;

    // Calculate today's spend
    const todayUsage = await sql`
      SELECT provider, SUM(prompt_tokens)::int as prompt_tokens, SUM(completion_tokens)::int as completion_tokens
      FROM token_usage
      WHERE user_id = ${userId} AND source = 'chat' AND created_at::date = CURRENT_DATE
      GROUP BY provider
    `;

    let todaySpendCents = 0;
    for (const row of todayUsage) {
      const cost = COST_PER_M[row.provider as string] || COST_PER_M.google;
      todaySpendCents += ((row.prompt_tokens as number) * cost.input + (row.completion_tokens as number) * cost.output) / 1_000_000;
    }

    const remaining = dailyLimitCents > 0 ? Math.max(0, dailyLimitCents - todaySpendCents) : -1;
    const percentage = dailyLimitCents > 0 ? Math.round((todaySpendCents / dailyLimitCents) * 100) : 0;

    // Get org info
    let org = null;
    const orgRows = await sql`
      SELECT o.name, o.plan, COUNT(om2.id)::int as member_count
      FROM organization_members om
      JOIN organizations o ON om.org_id = o.id
      LEFT JOIN organization_members om2 ON om2.org_id = o.id
      WHERE om.user_id = ${userId}
      GROUP BY o.id, o.name, o.plan
      LIMIT 1
    `;
    if (orgRows.length > 0) {
      org = {
        name: orgRows[0].name as string,
        plan: orgRows[0].plan as string,
        memberCount: orgRows[0].member_count as number,
      };
    }

    return NextResponse.json({
      quota: {
        plan: userPlan,
        dailyLimitCents,
        todaySpendCents: Math.round(todaySpendCents * 100) / 100,
        remaining: Math.round(remaining * 100) / 100,
        percentage,
      },
      org,
    });
  } catch (err) {
    console.error("[GET /api/usage-quota]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
