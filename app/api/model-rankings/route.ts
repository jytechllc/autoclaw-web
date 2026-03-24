import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * Model popularity ranking algorithm:
 *
 * Score = (usage_count * 0.4) + (recent_7d_count * 0.3) + (unique_users * 0.3)
 *
 * - usage_count: total calls in last 30 days (volume)
 * - recent_7d_count: calls in last 7 days (trending)
 * - unique_users: distinct users in last 30 days (breadth)
 *
 * "auto" mode picks the top-ranked model for each category:
 * - analysis: best for ICP, SEO, lead research
 * - writing: best for emails, content
 * - image: best for image generation
 */
export async function GET() {
  const sql = getDb();

  // Overall rankings (last 30 days)
  const rankings = await sql`
    SELECT
      model,
      provider,
      COUNT(*)::int as total_calls,
      COUNT(DISTINCT user_id)::int as unique_users,
      SUM(total_tokens)::bigint as total_tokens,
      (SELECT COUNT(*)::int FROM token_usage t2
        WHERE t2.model = token_usage.model AND t2.created_at >= NOW() - INTERVAL '7 days'
      ) as recent_7d_calls,
      ROUND(
        COUNT(*) * 0.4 +
        (SELECT COUNT(*) FROM token_usage t2 WHERE t2.model = token_usage.model AND t2.created_at >= NOW() - INTERVAL '7 days') * 0.3 +
        COUNT(DISTINCT user_id) * 10 * 0.3
      , 1) as popularity_score
    FROM token_usage
    WHERE created_at >= NOW() - INTERVAL '30 days'
      AND model IS NOT NULL AND model != ''
    GROUP BY model, provider
    ORDER BY popularity_score DESC
  `;

  // Weekly trend (last 4 weeks)
  const weeklyTrend = await sql`
    SELECT
      model,
      DATE_TRUNC('week', created_at)::date as week,
      COUNT(*)::int as calls
    FROM token_usage
    WHERE created_at >= NOW() - INTERVAL '28 days'
      AND model IS NOT NULL AND model != ''
    GROUP BY model, week
    ORDER BY week DESC, calls DESC
  `;

  // Auto-pick: best model per category
  const analysisModels = rankings.filter((r) =>
    !String(r.model).includes("dall-e") && !String(r.model).includes("image") && !String(r.model).includes("embedding")
  );
  const imageModels = rankings.filter((r) =>
    String(r.model).includes("dall-e") || String(r.model).includes("seedream") || String(r.source) === "etsy-image"
  );

  const autoPick = {
    analysis: analysisModels[0]?.model || "qwen-3-235b-a22b-instruct-2507",
    writing: analysisModels[0]?.model || "claude-sonnet-4.5",
    image: imageModels[0]?.model || "dall-e-3",
  };

  return NextResponse.json({
    rankings,
    weeklyTrend,
    autoPick,
    algorithm: "score = (total_calls * 0.4) + (recent_7d * 0.3) + (unique_users * 10 * 0.3)",
  });
}
