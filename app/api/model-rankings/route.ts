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
  // LLM — Alibaba (Qwen)
  { model: "alibaba/qwen-3-235b", provider: "alibaba", category: "llm" },
  { model: "alibaba/qwen-plus", provider: "alibaba", category: "llm" },
  { model: "alibaba/qwen-turbo", provider: "alibaba", category: "llm" },
  { model: "alibaba/qwen-2.5-3b", provider: "alibaba", category: "llm" },
  { model: "alibaba/qwen-2.5-7b", provider: "alibaba", category: "llm" },
  // LLM — Meta
  { model: "meta/llama-3.1-8b", provider: "meta", category: "llm" },
  { model: "meta/llama-3.3-70b", provider: "meta", category: "llm" },
  // LLM — OpenAI
  { model: "openai/gpt-oss-120b", provider: "openai", category: "llm" },
  { model: "openai/gpt-4o", provider: "openai", category: "llm" },
  { model: "openai/gpt-4o-mini", provider: "openai", category: "llm" },
  // LLM — Anthropic
  { model: "anthropic/claude-sonnet-4.5", provider: "anthropic", category: "llm" },
  // LLM — Zhipu GLM
  { model: "zhipu/glm-4.7-flash", provider: "zhipu", category: "llm" },
  { model: "zhipu/glm-4.5-flash", provider: "zhipu", category: "llm" },
  // LLM — xAI
  { model: "xai/grok-3", provider: "xai", category: "llm" },
  { model: "xai/grok-3-mini", provider: "xai", category: "llm" },
  // LLM — Google
  { model: "google/gemini-2.0-flash", provider: "google", category: "llm" },
  // Image
  { model: "google/nano-banana-2", provider: "google", category: "image" },
  { model: "bfl/flux-schnell", provider: "bfl", category: "image" },
  { model: "stability/stable-diffusion", provider: "stability", category: "image" },
  { model: "stability/sdxl", provider: "stability", category: "image" },
  { model: "bytedance/seedream-v4.5", provider: "bytedance", category: "image" },
  { model: "openai/dall-e-3", provider: "openai", category: "image" },
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

// Normalize model names to canonical form (provider/model)
const MODEL_ALIASES: Record<string, string> = {
  "claude-sonnet-4.5": "anthropic/claude-sonnet-4.5",
  "claude-sonnet-4-20250514": "anthropic/claude-sonnet-4.5",
  "gemini-2.0-flash": "google/gemini-2.0-flash",
  "gpt-oss-120b": "openai/gpt-oss-120b",
  "cerebras/gpt-oss-120b": "openai/gpt-oss-120b",
  "dall-e-3": "openai/dall-e-3",
  "text-embedding": "google/text-embedding",
  "sdxl": "stability/sdxl",
  "pixazo/sdxl": "stability/sdxl",
  "pixazo/stable-diffusion": "stability/stable-diffusion",
  "pixazo/flux-schnell": "bfl/flux-schnell",
  "qwen-3-235b-a22b-instruct-2507": "alibaba/qwen-3-235b",
  "cerebras/qwen-3-235b": "alibaba/qwen-3-235b",
  "cerebras/llama3.1-8b": "meta/llama-3.1-8b",
  "meta/llama-3.1-8b-instruct": "meta/llama-3.1-8b",
  "qwen2.5:3b": "alibaba/qwen-2.5-3b",
  "qwen2.5:7b": "alibaba/qwen-2.5-7b",
  "stepfun/step-3.5-flash:free": "stepfun/step-3.5-flash",
};

function normalizeModel(model: string): string {
  return MODEL_ALIASES[model] || model;
}

export async function GET() {
  const sql = getDb();

  // Usage rankings (last 30 days) — raw, before normalization
  const rawRankings = await sql`
    SELECT
      model,
      provider,
      COUNT(*)::int as total_calls,
      COUNT(DISTINCT user_id)::int as unique_users,
      SUM(total_tokens)::bigint as total_tokens,
      (SELECT COUNT(*)::int FROM token_usage t2
        WHERE t2.model = token_usage.model AND t2.created_at >= NOW() - INTERVAL '7 days'
      ) as recent_7d_calls
    FROM token_usage
    WHERE created_at >= NOW() - INTERVAL '30 days'
      AND model IS NOT NULL AND model != ''
    GROUP BY model, provider
    ORDER BY total_calls DESC
  `;

  // Merge rows with same canonical model name
  const mergedMap = new Map<string, { model: string; provider: string; total_calls: number; unique_users: number; total_tokens: number; recent_7d_calls: number }>();
  for (const r of rawRankings) {
    const canonical = normalizeModel(String(r.model));
    const existing = mergedMap.get(canonical);
    if (existing) {
      existing.total_calls += Number(r.total_calls);
      existing.unique_users = Math.max(existing.unique_users, Number(r.unique_users)); // approximate
      existing.total_tokens += Number(r.total_tokens);
      existing.recent_7d_calls += Number(r.recent_7d_calls);
    } else {
      mergedMap.set(canonical, {
        model: canonical,
        provider: String(r.provider),
        total_calls: Number(r.total_calls),
        unique_users: Number(r.unique_users),
        total_tokens: Number(r.total_tokens),
        recent_7d_calls: Number(r.recent_7d_calls),
      });
    }
  }

  // Calculate popularity score and sort
  const dbRankings = Array.from(mergedMap.values()).map((r) => ({
    ...r,
    popularity_score: Math.round(
      r.total_calls * 0.4 + r.recent_7d_calls * 0.3 + r.unique_users * 10 * 0.3
    ),
  })).sort((a, b) => b.popularity_score - a.popularity_score);

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
    analysis: analysisModels[0]?.model || "alibaba/qwen-3-235b",
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
