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
// All models supported on the platform (shown even with 0 calls)
const PLATFORM_MODELS: { model: string; provider: string; category: string }[] = [
  // LLM — Cerebras
  { model: "cerebras/qwen-3-235b", provider: "cerebras", category: "llm" },
  { model: "cerebras/llama3.1-8b", provider: "cerebras", category: "llm" },
  { model: "cerebras/gpt-oss-120b", provider: "cerebras", category: "llm" },
  // LLM — Anthropic
  { model: "anthropic/claude-sonnet-4.5", provider: "anthropic", category: "llm" },
  // LLM — Zhipu GLM
  { model: "zhipu/glm-4.7-flash", provider: "zhipu", category: "llm" },
  { model: "zhipu/glm-4.5-flash", provider: "zhipu", category: "llm" },
  // LLM — NVIDIA (BYOK)
  { model: "nvidia/llama-3.3-70b", provider: "nvidia", category: "llm" },
  // LLM — xAI
  { model: "xai/grok-3", provider: "xai", category: "llm" },
  { model: "xai/grok-3-mini", provider: "xai", category: "llm" },
  // LLM — Alibaba
  { model: "alibaba/qwen-plus", provider: "alibaba", category: "llm" },
  { model: "alibaba/qwen-turbo", provider: "alibaba", category: "llm" },
  // LLM — Google
  { model: "google/gemini-2.0-flash", provider: "google", category: "llm" },
  // LLM — OpenAI
  { model: "openai/gpt-4o", provider: "openai", category: "llm" },
  { model: "openai/gpt-4o-mini", provider: "openai", category: "llm" },
  // Image
  { model: "google/nano-banana-2", provider: "google", category: "image" },
  { model: "pixazo/flux-schnell", provider: "pixazo", category: "image" },
  { model: "pixazo/stable-diffusion", provider: "pixazo", category: "image" },
  { model: "pixazo/sdxl", provider: "pixazo", category: "image" },
  { model: "bytedance/seedream-v4.5", provider: "xpilot", category: "image" },
  { model: "dall-e-3", provider: "openai", category: "image" },
  // Video
  { model: "seedance-2.0/text-to-video", provider: "xpilot", category: "video" },
  { model: "bytedance/seedance-v1.5-pro/text-to-video", provider: "xpilot", category: "video" },
  { model: "alibaba/wan-2.6/text-to-video", provider: "xpilot", category: "video" },
  { model: "kwaivgi/kling-video-o3-std/text-to-video", provider: "xpilot", category: "video" },
  // Audio / TTS
  { model: "openai/tts-1", provider: "openai", category: "audio" },
  // Search / Crawl
  { model: "tavily/search", provider: "tavily", category: "search" },
  { model: "firecrawl/scrape", provider: "firecrawl", category: "search" },
  // Embedding
  { model: "google/text-embedding", provider: "google", category: "embedding" },
];

export async function GET() {
  const sql = getDb();

  // Usage rankings (last 30 days)
  const dbRankings = await sql`
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

  // Merge: DB data + static models with 0 calls
  const dbMap = new Map<string, (typeof dbRankings)[number]>();
  for (const r of dbRankings) {
    dbMap.set(String(r.model), r);
  }

  const rankings = [];
  const seen = new Set<string>();

  // First: all DB entries (sorted by score)
  for (const r of dbRankings) {
    const key = String(r.model);
    const pm = PLATFORM_MODELS.find((p) => p.model === key || key.includes(p.model.split("/").pop()!));
    rankings.push({ ...r, category: pm?.category || "llm" });
    seen.add(key);
  }

  // Then: static models not yet in DB
  for (const pm of PLATFORM_MODELS) {
    if (!seen.has(pm.model) && !dbRankings.some((r) => String(r.model).includes(pm.model.split("/").pop()!))) {
      rankings.push({
        model: pm.model,
        provider: pm.provider,
        total_calls: 0,
        unique_users: 0,
        total_tokens: 0,
        recent_7d_calls: 0,
        popularity_score: 0,
        category: pm.category,
      });
    }
  }

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
    r.category === "llm" && Number(r.total_calls) > 0
  );
  const imageModels = rankings.filter((r) =>
    r.category === "image" && Number(r.total_calls) > 0
  );

  const autoPick = {
    analysis: analysisModels[0]?.model || "cerebras/qwen-3-235b",
    writing: analysisModels[0]?.model || "anthropic/claude-sonnet-4.5",
    image: imageModels[0]?.model || "bytedance/seedream-v4.5",
  };

  return NextResponse.json({
    rankings,
    weeklyTrend,
    autoPick,
    algorithm: "score = (total_calls * 0.4) + (recent_7d * 0.3) + (unique_users * 10 * 0.3)",
  });
}
