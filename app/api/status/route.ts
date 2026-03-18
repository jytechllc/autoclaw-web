import { NextResponse } from "next/server";
import { auth0 } from "@/lib/auth0";
import { getDb, resolveUserPlan } from "@/lib/db";
import { getUsageStats } from "@/lib/embeddings";

export const dynamic = "force-dynamic";

const DAILY_LIMIT_CENTS: Record<string, number> = {
  starter: 100,     // $1.00
  growth: 5000,     // $50.00
  scale: 50000,     // $500.00
  enterprise: 0,    // unlimited
};

// Cost per 1M tokens (cents)
const COST_PER_M: Record<string, { input: number; output: number }> = {
  cerebras: { input: 0, output: 0 },
  nvidia: { input: 0, output: 0 },
  google: { input: 10, output: 40 },
  openai: { input: 15, output: 60 },
  anthropic: { input: 300, output: 1500 },
  alibaba: { input: 40, output: 120 },       // Qwen Plus ~$0.0004/$0.0012 per 1K
  "vercel-ai-gateway": { input: 300, output: 1500 }, // Proxied Anthropic
  ollama: { input: 0, output: 0 },           // Self-hosted
};

function calcCostCents(provider: string, promptTokens: number, completionTokens: number): number {
  const rate = COST_PER_M[provider] || COST_PER_M.google;
  return (promptTokens * rate.input + completionTokens * rate.output) / 1_000_000;
}

// Free tier daily token limits (approximate tokens for $1 at Gemini Flash rates)
const FREE_DAILY_TOKENS: Record<string, number> = {
  starter: 1_000_000,    // ~$1 worth at Gemini Flash
  growth: 50_000_000,
  scale: 500_000_000,
  enterprise: 0,         // unlimited
};

async function fetchVercelBilling(): Promise<{ services: { name: string; cost: number; quantity: number; unit: string }[]; totalCost: number } | null> {
  const token = process.env.VERCEL_TOKEN;
  if (!token) return null;

  const teamId = "team_d8TD8al7Effx9Oumnn3xomTj";
  const now = new Date();
  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
  const to = now.toISOString();

  try {
    const res = await fetch(
      `https://api.vercel.com/v1/billing/charges?teamId=${teamId}&from=${from}&to=${to}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (!res.ok) return null;

    const text = await res.text();
    const lines = text.split("\n").filter(Boolean);
    const byService = new Map<string, { cost: number; quantity: number; unit: string }>();
    let totalCost = 0;

    for (const line of lines) {
      try {
        const c = JSON.parse(line);
        const svc = c.ServiceName || "unknown";
        const prev = byService.get(svc) || { cost: 0, quantity: 0, unit: "" };
        prev.cost += c.BilledCost || 0;
        prev.quantity += c.ConsumedQuantity || 0;
        prev.unit = c.ConsumedUnit || prev.unit;
        byService.set(svc, prev);
        totalCost += c.BilledCost || 0;
      } catch { /* skip malformed lines */ }
    }

    const services = Array.from(byService.entries())
      .map(([name, d]) => ({ name, cost: Math.round(d.cost * 10000) / 10000, quantity: Math.round(d.quantity * 100) / 100, unit: d.unit }))
      .filter((s) => s.cost > 0 || s.quantity > 0)
      .sort((a, b) => b.cost - a.cost);

    return { services, totalCost: Math.round(totalCost * 10000) / 10000 };
  } catch {
    return null;
  }
}

export async function GET() {
  const sql = getDb();

  const [totals, today, byProvider, last7Days, userCount, embeddingUsage, apiUsage] = await Promise.all([
    sql`SELECT
      COALESCE(SUM(prompt_tokens), 0)::bigint as prompt_tokens,
      COALESCE(SUM(completion_tokens), 0)::bigint as completion_tokens,
      COALESCE(SUM(total_tokens), 0)::bigint as total_tokens,
      COUNT(*)::int as request_count
    FROM token_usage`,

    sql`SELECT
      COALESCE(SUM(prompt_tokens), 0)::bigint as prompt_tokens,
      COALESCE(SUM(completion_tokens), 0)::bigint as completion_tokens,
      COALESCE(SUM(total_tokens), 0)::bigint as total_tokens,
      COUNT(*)::int as request_count
    FROM token_usage
    WHERE created_at::date = CURRENT_DATE`,

    sql`SELECT
      provider,
      COALESCE(SUM(prompt_tokens), 0)::bigint as prompt_tokens,
      COALESCE(SUM(completion_tokens), 0)::bigint as completion_tokens,
      COALESCE(SUM(total_tokens), 0)::bigint as total_tokens,
      COUNT(*)::int as request_count
    FROM token_usage
    GROUP BY provider
    ORDER BY SUM(total_tokens) DESC`,

    sql`SELECT
      DATE(created_at) as date,
      COALESCE(SUM(total_tokens), 0)::bigint as total_tokens,
      COUNT(*)::int as request_count
    FROM token_usage
    WHERE created_at >= NOW() - INTERVAL '7 days'
    GROUP BY DATE(created_at)
    ORDER BY date ASC`,

    sql`SELECT COUNT(*)::int as count FROM users`,

    getUsageStats(sql),

    sql`SELECT
      service,
      action,
      COALESCE(SUM(count), 0)::int as total_count,
      COUNT(*)::int as entries,
      COUNT(DISTINCT user_id)::int as users,
      MIN(created_at) as first_used,
      MAX(created_at) as last_used
    FROM api_usage
    WHERE created_at >= NOW() - INTERVAL '30 days'
    GROUP BY service, action
    ORDER BY total_count DESC`,
  ]);

  const now = new Date();
  const nextReset = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 0));

  // Per-user averages + by-source + by-plan breakdown (last 30 days)
  const [perUserDaily, bySource, byPlan, byokStats] = await Promise.all([
    sql`SELECT
      COUNT(DISTINCT user_id)::int as active_users,
      COUNT(DISTINCT DATE(created_at))::int as active_days,
      COALESCE(SUM(total_tokens), 0)::bigint as total_tokens,
      COUNT(*)::int as total_requests
    FROM token_usage
    WHERE created_at >= NOW() - INTERVAL '30 days'`,

    sql`SELECT
      source, provider,
      COALESCE(SUM(prompt_tokens), 0)::bigint as prompt_tokens,
      COALESCE(SUM(completion_tokens), 0)::bigint as completion_tokens,
      COALESCE(SUM(total_tokens), 0)::bigint as total_tokens,
      COUNT(*)::int as requests
    FROM token_usage
    WHERE created_at >= NOW() - INTERVAL '30 days'
    GROUP BY source, provider
    ORDER BY SUM(total_tokens) DESC`,

    sql`SELECT
      COALESCE(u.plan, 'starter') as plan,
      COUNT(DISTINCT t.user_id)::int as users,
      COALESCE(SUM(t.prompt_tokens), 0)::bigint as prompt_tokens,
      COALESCE(SUM(t.completion_tokens), 0)::bigint as completion_tokens,
      COALESCE(SUM(t.total_tokens), 0)::bigint as total_tokens,
      COUNT(*)::int as requests,
      COUNT(DISTINCT DATE(t.created_at))::int as active_days
    FROM token_usage t
    JOIN users u ON t.user_id = u.id
    WHERE t.created_at >= NOW() - INTERVAL '30 days'
    GROUP BY u.plan
    ORDER BY SUM(t.total_tokens) DESC`,

    // BYOK usage: requests via cron agents / chat enrichment (using user/org API keys)
    sql`SELECT
      provider,
      COALESCE(SUM(prompt_tokens), 0)::bigint as prompt_tokens,
      COALESCE(SUM(completion_tokens), 0)::bigint as completion_tokens,
      COALESCE(SUM(total_tokens), 0)::bigint as total_tokens,
      COUNT(*)::int as requests,
      COUNT(DISTINCT user_id)::int as users
    FROM token_usage
    WHERE created_at >= NOW() - INTERVAL '30 days'
      AND source IN ('cron', 'chat_enrich')
    GROUP BY provider`,
  ]);

  const stats30d = perUserDaily[0];
  const avgDailyTokens = stats30d.active_days > 0 ? Math.round(Number(stats30d.total_tokens) / stats30d.active_days) : 0;
  const avgPerUser = stats30d.active_users > 0 ? Math.round(Number(stats30d.total_tokens) / stats30d.active_users) : 0;
  const avgDailyPerUser = (stats30d.active_users > 0 && stats30d.active_days > 0)
    ? Math.round(Number(stats30d.total_tokens) / stats30d.active_users / stats30d.active_days)
    : 0;

  // Compute cost for byProvider
  const byProviderWithCost = byProvider.map((p) => {
    const costCents = calcCostCents(p.provider as string, Number(p.prompt_tokens), Number(p.completion_tokens));
    return {
      provider: p.provider,
      total_tokens: Number(p.total_tokens),
      prompt_tokens: Number(p.prompt_tokens),
      completion_tokens: Number(p.completion_tokens),
      request_count: p.request_count,
      costCents: Math.round(costCents * 100) / 100,
    };
  });
  const totalCostCents = byProviderWithCost.reduce((sum, p) => sum + p.costCents, 0);

  // Aggregate bySource rows (grouped by source+provider) into source-level with cost
  const sourceMap = new Map<string, { totalTokens: number; requests: number; costCents: number }>();
  for (const s of bySource) {
    const key = (s.source as string) || "unknown";
    const prev = sourceMap.get(key) || { totalTokens: 0, requests: 0, costCents: 0 };
    prev.totalTokens += Number(s.total_tokens);
    prev.requests += s.requests as number;
    prev.costCents += calcCostCents(s.provider as string, Number(s.prompt_tokens), Number(s.completion_tokens));
    sourceMap.set(key, prev);
  }
  const bySourceAgg = Array.from(sourceMap.entries())
    .map(([source, v]) => ({ source, ...v, costCents: Math.round(v.costCents * 100) / 100 }))
    .sort((a, b) => b.totalTokens - a.totalTokens);

  // Aggregate BYOK stats with cost (multiple provider rows)
  let byokTotalTokens = 0, byokRequests = 0, byokUsers = 0, byokCostCents = 0;
  for (const row of byokStats) {
    byokTotalTokens += Number(row.total_tokens);
    byokRequests += row.requests as number;
    byokUsers = Math.max(byokUsers, row.users as number);
    byokCostCents += calcCostCents(row.provider as string, Number(row.prompt_tokens), Number(row.completion_tokens));
  }

  // 30d cost
  const total30dCostCents = bySourceAgg.reduce((sum, s) => sum + s.costCents, 0);
  const avgDailyCostCents = stats30d.active_days > 0 ? total30dCostCents / stats30d.active_days : 0;

  const response: Record<string, unknown> = {
    allTime: totals[0],
    today: today[0],
    byProvider: byProviderWithCost,
    totalCostCents: Math.round(totalCostCents * 100) / 100,
    last7Days,
    users: userCount[0].count,
    nextResetUtc: nextReset.toISOString(),
    embedding: embeddingUsage,
    apiUsage: apiUsage.map((r) => ({
      service: r.service,
      action: r.action,
      totalCount: r.total_count,
      users: r.users,
      lastUsed: r.last_used,
    })),
    usage30d: {
      activeUsers: stats30d.active_users,
      activeDays: stats30d.active_days,
      totalTokens: Number(stats30d.total_tokens),
      totalRequests: stats30d.total_requests,
      totalCostCents: Math.round(total30dCostCents * 100) / 100,
      avgDailyTokens,
      avgDailyCostCents: Math.round(avgDailyCostCents * 100) / 100,
      avgPerUser,
      avgDailyPerUser,
      avgCostPerUser: stats30d.active_users > 0 ? Math.round(total30dCostCents / stats30d.active_users * 100) / 100 : 0,
    },
    bySource: bySourceAgg,
    byPlan: byPlan.map((p) => {
      // Approximate cost: we don't have per-plan provider split, so estimate from overall ratio
      const planCostCents = totalCostCents > 0 && Number(totals[0].total_tokens) > 0
        ? (Number(p.total_tokens) / Number(totals[0].total_tokens)) * totalCostCents
        : 0;
      return {
        plan: p.plan || "starter",
        users: p.users,
        totalTokens: Number(p.total_tokens),
        requests: p.requests,
        costCents: Math.round(planCostCents * 100) / 100,
        avgPerUser: p.users > 0 ? Math.round(Number(p.total_tokens) / p.users) : 0,
        avgCostPerUser: p.users > 0 ? Math.round(planCostCents / p.users * 100) / 100 : 0,
        avgDailyPerUser: (p.users > 0 && p.active_days > 0) ? Math.round(Number(p.total_tokens) / p.users / (p.active_days as number)) : 0,
      };
    }),
    byok: {
      totalTokens: byokTotalTokens,
      requests: byokRequests,
      users: byokUsers,
      costCents: Math.round(byokCostCents * 100) / 100,
    },
  };

  // If logged in, add per-user quota info
  try {
    const session = await auth0.getSession();
    if (session?.user) {
      const email = session.user.email as string;
      const users = await sql`SELECT id, plan FROM users WHERE email = ${email}`;
      if (users.length > 0) {
        const userId = users[0].id;
        const userPlan = await resolveUserPlan(sql, userId, (users[0].plan as string) || "starter", email);

        const userToday = await sql`
          SELECT provider, SUM(prompt_tokens)::bigint as prompt_tokens, SUM(completion_tokens)::bigint as completion_tokens, SUM(total_tokens)::bigint as total_tokens, COUNT(*)::int as request_count
          FROM token_usage
          WHERE user_id = ${userId} AND created_at::date = CURRENT_DATE
          GROUP BY provider
        `;

        let totalSpendCents = 0;
        let totalTokensToday = 0;
        for (const row of userToday) {
          const cost = COST_PER_M[row.provider as string] || COST_PER_M.google;
          totalSpendCents += ((Number(row.prompt_tokens)) * cost.input + (Number(row.completion_tokens)) * cost.output) / 1_000_000;
          totalTokensToday += Number(row.total_tokens);
        }

        const dailyLimitCents = DAILY_LIMIT_CENTS[userPlan] || 100;
        const dailyTokenLimit = FREE_DAILY_TOKENS[userPlan] || 1_000_000;

        response.user = {
          plan: userPlan,
          todayTokens: totalTokensToday,
          todaySpendCents: Math.round(totalSpendCents * 100) / 100,
          dailyLimitCents: dailyLimitCents,
          dailyTokenLimit: dailyTokenLimit,
          remaining: dailyLimitCents > 0 ? Math.max(0, dailyLimitCents - totalSpendCents) : null,
          remainingTokens: dailyTokenLimit > 0 ? Math.max(0, dailyTokenLimit - totalTokensToday) : null,
          unlimited: dailyLimitCents === 0,
        };
      }
    }
  } catch {
    // Not logged in — that's fine, just return public data
  }

  return NextResponse.json(response);
}
