"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useParams, useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import LanguageSwitcher from "@/components/LanguageSwitcher";
import type { Locale } from "@/lib/i18n";

interface PlatformRanking {
  model: string;
  provider: string;
  total_calls: number;
  unique_users: number;
  total_tokens: number;
  recent_7d_calls: number;
  popularity_score: number;
  category?: string;
}

interface MarketModel {
  name: string;
  provider: string;
  category: string;
  arena_elo?: number;
  context: string;
  pricing: string;
  highlight: string;
}

// Map model IDs to their maintainer (creator), not the hosting provider
const MODEL_MAINTAINERS: Record<string, string> = {
  // Cerebras-hosted but maintained by others
  "qwen-3-235b-a22b-instruct-2507": "Alibaba (Qwen)",
  "cerebras/qwen-3-235b": "Alibaba (Qwen)",
  "cerebras/qwen-3-coder-480b": "Alibaba (Qwen)",
  "cerebras/gpt-oss-120b": "OpenAI",
  "gpt-oss-120b": "OpenAI",
  // Anthropic
  "claude-sonnet-4.5": "Anthropic",
  "anthropic/claude-sonnet-4.5": "Anthropic",
  "claude-sonnet-4-20250514": "Anthropic",
  // Alibaba direct
  "alibaba/qwen-plus": "Alibaba (Qwen)",
  "alibaba/qwen-turbo": "Alibaba (Qwen)",
  "qwen-plus": "Alibaba (Qwen)",
  "qwen-turbo": "Alibaba (Qwen)",
  // xAI
  "xai/grok-3": "xAI",
  "xai/grok-3-mini": "xAI",
  "grok-3": "xAI",
  "grok-3-mini": "xAI",
  // OpenAI
  "dall-e-3": "OpenAI",
  // Meta (hosted on various platforms: Cerebras, NVIDIA, Ollama, etc.)
  "llama3.1-8b": "Meta",
  "cerebras/llama3.1-8b": "Meta",
  "nvidia/llama-3.3-70b": "Meta",
  "nvidia/meta/llama-3.3-70b-instruct": "Meta",
  "meta/llama-3.1-8b-instruct": "Meta",
  "llama-4-scout-17b-16e-instruct": "Meta",
  "meta/llama": "Meta",
  // Zhipu GLM (via z.ai)
  "GLM-4.7-Flash": "Zhipu AI (智谱)",
  "zhipu/glm-4.7-flash": "Zhipu AI (智谱)",
  "glm-4.5": "Zhipu AI (智谱)",
  "glm-4.5-air": "Zhipu AI (智谱)",
  "glm-4.6": "Zhipu AI (智谱)",
  "glm-4.7": "Zhipu AI (智谱)",
  "glm-5": "Zhipu AI (智谱)",
  "glm-5-turbo": "Zhipu AI (智谱)",
  // Embedding
  "text-embedding": "Google",
  // Image / Video (free models / xPilot / Google)
  "pixazo/flux-schnell": "Black Forest Labs",
  "flux-schnell": "Black Forest Labs",
  "pixazo/stable-diffusion": "Stability AI",
  "pixazo/sdxl": "Stability AI",
  "pixazo/sd-inpainting": "Stability AI",
  "google/nano-banana-2": "Google",
  "gemini-3.1-flash-image-preview": "Google",
  "bytedance/seedream-v4.5": "ByteDance",
  "bytedance/seedance-v1.5-pro/text-to-video": "ByteDance",
  "seedance-2.0/text-to-video": "ByteDance",
  "alibaba/wan-2.6/text-to-video": "Alibaba",
  "kwaivgi/kling-video-o3-std/text-to-video": "Kuaishou (快手)",
  "wavespeed-ai/wan-2.2/t2v-480p-ultra-fast": "WaveSpeed AI",
  // OpenRouter free models
  "stepfun/step-3.5-flash": "StepFun",
  "nvidia/nemotron-3-super-120b-a12b": "NVIDIA",
  "nvidia/nemotron-3-nano-30b-a3b": "NVIDIA",
  "nvidia/nemotron-nano-12b-v2-vl": "NVIDIA",
  "nvidia/nemotron-nano-9b-v2": "NVIDIA",
  "minimax/minimax-m2.5": "MiniMax",
  "nousresearch/hermes-3-llama-3.1-405b": "Nous Research",
  "qwen/qwen3-next-80b-a3b-instruct": "Alibaba (Qwen)",
  "qwen/qwen3-coder": "Alibaba (Qwen)",
  "openai/gpt-oss-120b": "OpenAI",
  "openai/gpt-oss-20b": "OpenAI",
  "z-ai/glm-4.5-air": "Zhipu AI (智谱)",
  "arcee-ai/trinity-large-preview": "Arcee AI",
  "arcee-ai/trinity-mini": "Arcee AI",
  "mistralai/mistral-small-3.1-24b": "Mistral",
  "google/gemma-3-27b": "Google",
  "google/gemma-3-12b": "Google",
  "google/gemma-3n-4b": "Google",
  "meta-llama/llama-3.3-70b-instruct": "Meta",
  // Video (OpenRouter)
  "openai/sora-2-pro": "OpenAI",
  "google/veo-3.1": "Google",
  // Ollama
  "qwen2.5:7b": "Alibaba (Qwen)",
  "qwen2.5:3b": "Alibaba (Qwen)",
};

function getModelMaintainer(model: string, provider: string): string {
  return MODEL_MAINTAINERS[model] || MODEL_MAINTAINERS[`${provider}/${model}`] || provider;
}

// Industry benchmark data (updated periodically)
const MARKET_LEADERBOARD: MarketModel[] = [
  // LLM
  { name: "Claude Opus 4", provider: "Anthropic", category: "llm", arena_elo: 1410, context: "200K", pricing: "$15/$75", highlight: "Best for complex reasoning & code" },
  { name: "GPT-4.1", provider: "OpenAI", category: "llm", arena_elo: 1395, context: "1M", pricing: "$2/$8", highlight: "Best price-performance ratio" },
  { name: "Gemini 2.5 Pro", provider: "Google", category: "llm", arena_elo: 1390, context: "1M", pricing: "$1.25/$10", highlight: "Largest context window" },
  { name: "Claude Sonnet 4", provider: "Anthropic", category: "llm", arena_elo: 1370, context: "200K", pricing: "$3/$15", highlight: "Best for writing & analysis" },
  { name: "Qwen 3 235B", provider: "Alibaba", category: "llm", arena_elo: 1340, context: "128K", pricing: "Free", highlight: "Best free model" },
  { name: "DeepSeek V3", provider: "DeepSeek", category: "llm", arena_elo: 1330, context: "128K", pricing: "$0.27/$1.10", highlight: "Cheapest high-quality" },
  { name: "Llama 4 Scout", provider: "Meta", category: "llm", arena_elo: 1310, context: "10M", pricing: "Free (open)", highlight: "Best open-source" },
  { name: "Grok 3", provider: "xAI", category: "llm", arena_elo: 1350, context: "128K", pricing: "$3/$15", highlight: "Real-time web access" },
  { name: "GLM-4 Plus", provider: "Zhipu AI (智谱)", category: "llm", arena_elo: 1300, context: "128K", pricing: "$0.70/$0.70", highlight: "Best Chinese-native model" },
  { name: "GLM-4.5 Flash", provider: "Zhipu AI (智谱)", category: "llm", arena_elo: 1280, context: "128K", pricing: "Free", highlight: "Free high-quality Chinese model" },
  { name: "GLM-4.7 Flash", provider: "Zhipu AI (智谱)", category: "llm", arena_elo: 1285, context: "128K", pricing: "Free", highlight: "Latest free flash model" },
  { name: "GLM-4.6V Flash", provider: "Zhipu AI (智谱)", category: "llm", arena_elo: 1275, context: "128K", pricing: "Free", highlight: "Free multimodal vision model" },
  { name: "GLM-5", provider: "Zhipu AI (智谱)", category: "llm", arena_elo: 1320, context: "128K", pricing: "Paid", highlight: "Latest flagship Chinese model" },
  { name: "GLM-5 Turbo", provider: "Zhipu AI (智谱)", category: "llm", arena_elo: 1305, context: "128K", pricing: "Paid", highlight: "Fast flagship model" },
  { name: "Llama 3.3 70B", provider: "Meta", category: "llm", arena_elo: 1260, context: "128K", pricing: "BYOK", highlight: "Best NVIDIA NIM model (~51 tok/s)" },
  { name: "Llama 3.1 8B", provider: "Meta", category: "llm", arena_elo: 1200, context: "128K", pricing: "Free", highlight: "Fastest inference (~2500 tok/s)" },
  // OpenRouter free models
  { name: "Step 3.5 Flash", provider: "StepFun", category: "llm", arena_elo: 1290, context: "256K", pricing: "Free", highlight: "1.63T tokens/week, ~30 tok/s" },
  { name: "Nemotron 3 Super 120B", provider: "NVIDIA", category: "llm", arena_elo: 1300, context: "262K", pricing: "Free", highlight: "550B/week, 262K context" },
  { name: "MiniMax M2.5", provider: "MiniMax", category: "llm", arena_elo: 1280, context: "196K", pricing: "Free", highlight: "1.97B/week, 196K context" },
  { name: "Hermes 3 405B", provider: "Nous Research", category: "llm", arena_elo: 1310, context: "131K", pricing: "Free", highlight: "Largest free open-source (405B)" },
  { name: "Qwen3 Next 80B", provider: "Alibaba (Qwen)", category: "llm", arena_elo: 1295, context: "262K", pricing: "Free", highlight: "1.93B/week, MoE 80B" },
  { name: "Qwen3 Coder 480B", provider: "Alibaba (Qwen)", category: "llm", arena_elo: 1330, context: "262K", pricing: "Free", highlight: "Best free coding model" },
  { name: "GPT-OSS 120B", provider: "OpenAI", category: "llm", arena_elo: 1270, context: "131K", pricing: "Free", highlight: "OpenAI open-source 120B" },
  { name: "GPT-OSS 20B", provider: "OpenAI", category: "llm", arena_elo: 1220, context: "131K", pricing: "Free", highlight: "Lightweight OpenAI OSS" },
  { name: "GLM 4.5 Air", provider: "Zhipu AI (智谱)", category: "llm", arena_elo: 1270, context: "131K", pricing: "Free", highlight: "52.7B tokens/week via OpenRouter" },
  { name: "Arcee Trinity Large", provider: "Arcee AI", category: "llm", arena_elo: 1260, context: "131K", pricing: "Free", highlight: "290B/week" },
  { name: "Mistral Small 3.1 24B", provider: "Mistral", category: "llm", arena_elo: 1250, context: "128K", pricing: "Free", highlight: "603M/week, compact & fast" },
  { name: "Gemma 3 27B", provider: "Google", category: "llm", arena_elo: 1240, context: "131K", pricing: "Free", highlight: "Best free Google model" },
  { name: "Nemotron Nano 12B V2 VL", provider: "NVIDIA", category: "llm", arena_elo: 1220, context: "128K", pricing: "Free", highlight: "Free vision model, 6.87B/week" },
  // Image
  { name: "Nano Banana 2", provider: "Google", category: "image", context: "4K", pricing: "Gemini API", highlight: "Latest Google image gen, Pro quality + Flash speed" },
  { name: "Seedream v4.5", provider: "ByteDance", category: "image", context: "—", pricing: "~$0.02/img", highlight: "Platform default, high quality" },
  { name: "DALL-E 3", provider: "OpenAI", category: "image", context: "—", pricing: "$0.04/img", highlight: "Best text understanding" },
  { name: "Midjourney v7", provider: "Midjourney", category: "image", context: "—", pricing: "$10/mo", highlight: "Best artistic quality" },
  { name: "Flux 1.1 Pro", provider: "Black Forest", category: "image", context: "—", pricing: "$0.04/img", highlight: "Best photorealism" },
  { name: "Flux Schnell", provider: "Black Forest Labs", category: "image", context: "—", pricing: "Free", highlight: "Fastest free model (~1.2s), photorealistic" },
  { name: "Stable Diffusion", provider: "Stability AI", category: "image", context: "—", pricing: "Free", highlight: "Versatile free workhorse" },
  { name: "SDXL", provider: "Stability AI", category: "image", context: "—", pricing: "Free", highlight: "Free high-res generation" },
  { name: "Stable Diffusion 3.5", provider: "Stability AI", category: "image", context: "—", pricing: "Open / API paid", highlight: "Best open-source image (self-host free)" },
  { name: "FLUX.2 Pro", provider: "Black Forest Labs", category: "image", context: "—", pricing: "Free", highlight: "Latest pro-grade Flux" },
  { name: "FLUX.2 Max", provider: "Black Forest Labs", category: "image", context: "—", pricing: "Free", highlight: "Maximum quality Flux" },
  { name: "FLUX.2 Klein 4B", provider: "Black Forest Labs", category: "image", context: "—", pricing: "Free", highlight: "Lightweight fast Flux" },
  { name: "FLUX.2 Flex", provider: "Black Forest Labs", category: "image", context: "—", pricing: "Free", highlight: "Flexible generation" },
  { name: "Ideogram 3", provider: "Ideogram", category: "image", context: "—", pricing: "$0.04/img", highlight: "Best text-in-image" },
  // Video
  { name: "Sora 2 Pro", provider: "OpenAI", category: "video", context: "—", pricing: "Free", highlight: "OpenAI video generation" },
  { name: "Veo 3.1", provider: "Google", category: "video", context: "—", pricing: "Free", highlight: "Google video generation" },
  { name: "Seedance 2.0", provider: "ByteDance", category: "video", context: "—", pricing: "~$0.10/vid", highlight: "Latest text-to-video with audio" },
  { name: "Seedance 1.5 Pro", provider: "ByteDance", category: "video", context: "—", pricing: "~$0.10/vid", highlight: "Premium video with audio" },
  { name: "Wan 2.6", provider: "Alibaba", category: "video", context: "—", pricing: "~$0.10/vid", highlight: "Standard text-to-video with audio" },
  { name: "Kling Video O3", provider: "Kuaishou (快手)", category: "video", context: "—", pricing: "~$0.10/vid", highlight: "Premium video generation" },
  // Audio / TTS
  { name: "OpenAI TTS", provider: "OpenAI", category: "audio", context: "—", pricing: "BYOK", highlight: "6 voices (alloy, echo, fable, onyx, nova, shimmer)" },
  // Search
  { name: "Tavily", provider: "Tavily", category: "search", context: "—", pricing: "Free 1000/mo", highlight: "Best AI-optimized search" },
  { name: "Firecrawl", provider: "Firecrawl", category: "search", context: "—", pricing: "Free 500/mo", highlight: "Best JS rendering" },
  { name: "Perplexity API", provider: "Perplexity", category: "search", context: "—", pricing: "$5/1000 req", highlight: "Best answer engine" },
];

export default function LeaderboardPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-gray-50 flex items-center justify-center text-gray-400">Loading...</div>}>
      <LeaderboardContent />
    </Suspense>
  );
}

function LeaderboardContent() {
  const params = useParams();
  const searchParams = useSearchParams();
  const router = useRouter();
  const locale = (params.locale as Locale) || "en";
  const isZh = locale === "zh" || locale === "zh-TW";

  const tabParam = searchParams.get("tab");
  const categoryParam = searchParams.get("category");

  const [activeTab, setActiveTabState] = useState<"platform" | "market">(
    tabParam === "market" ? "market" : "platform"
  );
  const [rankings, setRankings] = useState<PlatformRanking[]>([]);
  const [autoPick, setAutoPick] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [marketCategory, setMarketCategoryState] = useState<"llm" | "image" | "video" | "audio" | "search">(
    (tabParam === "market" && categoryParam && ["llm", "image", "video", "audio", "search"].includes(categoryParam))
      ? categoryParam as "llm" | "image" | "video" | "audio" | "search"
      : "llm"
  );
  const [platformCategory, setPlatformCategoryState] = useState<"all" | "llm" | "image" | "video" | "audio" | "search" | "embedding">(
    (tabParam !== "market" && categoryParam && ["all", "llm", "image", "video", "audio", "search", "embedding"].includes(categoryParam))
      ? categoryParam as "all" | "llm" | "image" | "video" | "audio" | "search" | "embedding"
      : "all"
  );

  const updateURL = useCallback((tab: string, category?: string) => {
    const params = new URLSearchParams();
    params.set("tab", tab);
    if (category && category !== (tab === "platform" ? "all" : "llm")) {
      params.set("category", category);
    }
    router.replace(`/${locale}/leaderboard?${params.toString()}`, { scroll: false });
  }, [locale, router]);

  const setActiveTab = useCallback((tab: "platform" | "market") => {
    setActiveTabState(tab);
    const cat = tab === "platform" ? platformCategory : marketCategory;
    updateURL(tab, cat);
  }, [updateURL, platformCategory, marketCategory]);

  const setPlatformCategory = useCallback((cat: "all" | "llm" | "image" | "video" | "audio" | "search" | "embedding") => {
    setPlatformCategoryState(cat);
    updateURL("platform", cat);
  }, [updateURL]);

  const setMarketCategory = useCallback((cat: "llm" | "image" | "video" | "audio" | "search") => {
    setMarketCategoryState(cat);
    updateURL("market", cat);
  }, [updateURL]);

  const fetchRankings = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/model-rankings");
      if (res.ok) {
        const data = await res.json();
        setRankings(data.rankings || []);
        setAutoPick(data.autoPick || {});
      }
    } catch { /* ignore */ }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchRankings();
  }, [fetchRankings]);

  const t = {
    title: isZh ? "模型排行榜" : "Model Leaderboard",
    subtitle: isZh ? "平台使用热度 & 市场模型对比" : "Platform usage rankings & market model comparison",
    platform: isZh ? "平台排行" : "Platform Rankings",
    market: isZh ? "市场排行" : "Market Leaderboard",
    rank: "#",
    model: isZh ? "模型" : "Model",
    provider: isZh ? "维护者" : "Maintainer",
    calls: isZh ? "调用次数" : "Calls",
    users: isZh ? "用户数" : "Users",
    tokens: "Tokens",
    trending: isZh ? "7日趋势" : "7d Trend",
    score: isZh ? "热度" : "Score",
    autoPick: isZh ? "Auto 推荐" : "Auto Pick",
    analysis: isZh ? "分析" : "Analysis",
    writing: isZh ? "写作" : "Writing",
    image: isZh ? "图像" : "Image",
    video: isZh ? "视频" : "Video",
    audio: isZh ? "语音" : "Audio",
    noData: isZh ? "暂无使用数据" : "No usage data yet",
    loading: isZh ? "加载中..." : "Loading...",
    context: isZh ? "上下文" : "Context",
    pricing: isZh ? "定价" : "Pricing",
    highlight: isZh ? "特点" : "Highlight",
    elo: "Arena ELO",
    llm: isZh ? "大语言模型" : "LLMs",
    search: isZh ? "搜索/爬取" : "Search / Crawl",
    algorithm: isZh ? "算法：热度 = 调用量×0.4 + 7日趋势×0.3 + 用户数×10×0.3" : "Algorithm: Score = calls×0.4 + 7d_trend×0.3 + users×10×0.3",
  };

  const medalEmoji = (i: number) => i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `${i + 1}`;

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-[1100px] mx-auto px-4 sm:px-6 py-4 flex items-center justify-between">
          <Link href={`/${locale}`} className="text-xl font-bold text-red-800">AutoClaw</Link>
          <div className="flex items-center gap-3">
            <LanguageSwitcher locale={locale} />
            <Link href={`/${locale}/dashboard/reports`} className="text-sm text-red-700 hover:text-red-800 font-medium">
              {isZh ? "控制台" : "Dashboard"} →
            </Link>
          </div>
        </div>
      </header>

      <div className="max-w-[1100px] mx-auto p-4 sm:p-6">
        <div className="mb-6">
          <h1 className="text-2xl font-bold">{t.title}</h1>
          <p className="text-sm text-gray-500">{t.subtitle}</p>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 mb-6 border-b border-gray-200">
          <button onClick={() => setActiveTab("platform")} className={`px-4 py-2 text-sm font-medium border-b-2 cursor-pointer ${activeTab === "platform" ? "border-red-700 text-red-700" : "border-transparent text-gray-500"}`}>
            {t.platform}
          </button>
          <button onClick={() => setActiveTab("market")} className={`px-4 py-2 text-sm font-medium border-b-2 cursor-pointer ${activeTab === "market" ? "border-red-700 text-red-700" : "border-transparent text-gray-500"}`}>
            {t.market}
          </button>
        </div>

        {/* Platform Rankings */}
        {activeTab === "platform" && (
          <div>
            {/* Auto Pick */}
            {Object.keys(autoPick).length > 0 && (
              <div className="bg-gradient-to-r from-red-50 to-orange-50 border border-red-200 rounded-xl p-5 mb-6">
                <h2 className="font-semibold text-red-800 mb-3">{t.autoPick}</h2>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div className="bg-white rounded-lg p-3 border border-red-100">
                    <p className="text-xs text-gray-400">{t.analysis}</p>
                    <p className="font-medium text-sm mt-1">{autoPick.analysis || "—"}</p>
                  </div>
                  <div className="bg-white rounded-lg p-3 border border-red-100">
                    <p className="text-xs text-gray-400">{t.writing}</p>
                    <p className="font-medium text-sm mt-1">{autoPick.writing || "—"}</p>
                  </div>
                  <div className="bg-white rounded-lg p-3 border border-red-100">
                    <p className="text-xs text-gray-400">{t.image}</p>
                    <p className="font-medium text-sm mt-1">{autoPick.image || "—"}</p>
                  </div>
                </div>
                <p className="text-[10px] text-red-400 mt-2">{t.algorithm}</p>
              </div>
            )}

            <div className="flex gap-2 mb-4">
              {(["all", "llm", "image", "video", "audio", "search"] as const).map((cat) => (
                <button
                  key={cat}
                  onClick={() => setPlatformCategory(cat)}
                  className={`px-4 py-1.5 rounded-full text-xs font-medium cursor-pointer ${platformCategory === cat ? "bg-red-700 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"}`}
                >
                  {cat === "all" ? (isZh ? "全部" : "All") : t[cat] || cat}
                </button>
              ))}
            </div>

            {loading ? (
              <p className="text-center py-12 text-gray-400">{t.loading}</p>
            ) : rankings.length === 0 ? (
              <p className="text-center py-12 text-gray-400">{t.noData}</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-200 text-left text-gray-500">
                      <th className="pb-2 w-10 font-medium">{t.rank}</th>
                      <th className="pb-2 font-medium">{t.model}</th>
                      <th className="pb-2 font-medium">{t.provider}</th>
                      <th className="pb-2 font-medium text-right">{t.calls}</th>
                      <th className="pb-2 font-medium text-right">{t.users}</th>
                      <th className="pb-2 font-medium text-right">{t.trending}</th>
                      <th className="pb-2 font-medium text-right">{t.score}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rankings.filter((r) => platformCategory === "all" || (r.category || "llm") === platformCategory).map((r, i) => (
                      <tr key={i} className={`border-b border-gray-100 ${i < 3 && platformCategory === "all" ? "bg-yellow-50/30" : ""}`}>
                        <td className="py-3 text-center">{medalEmoji(i)}</td>
                        <td className="py-3 font-medium text-gray-800">{String(r.model)}</td>
                        <td className="py-3 text-gray-500">{getModelMaintainer(String(r.model), String(r.provider))}</td>
                        <td className="py-3 text-right text-gray-700">{r.total_calls.toLocaleString()}</td>
                        <td className="py-3 text-right text-gray-700">{r.unique_users}</td>
                        <td className="py-3 text-right">
                          <span className={r.recent_7d_calls > 0 ? "text-green-600" : "text-gray-400"}>
                            {r.recent_7d_calls > 0 ? `+${r.recent_7d_calls}` : "0"}
                          </span>
                        </td>
                        <td className="py-3 text-right font-semibold text-red-700">{Number(r.popularity_score).toFixed(0)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* Market Leaderboard */}
        {activeTab === "market" && (
          <div>
            <div className="flex gap-2 mb-4">
              {(["llm", "image", "video", "audio", "search"] as const).map((cat) => (
                <button
                  key={cat}
                  onClick={() => setMarketCategory(cat)}
                  className={`px-4 py-1.5 rounded-full text-xs font-medium cursor-pointer ${marketCategory === cat ? "bg-red-700 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"}`}
                >
                  {t[cat] || cat}
                </button>
              ))}
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200 text-left text-gray-500">
                    <th className="pb-2 w-10 font-medium">{t.rank}</th>
                    <th className="pb-2 font-medium">{t.model}</th>
                    <th className="pb-2 font-medium">{t.provider}</th>
                    {marketCategory === "llm" && <th className="pb-2 font-medium text-right">{t.elo}</th>}
                    {marketCategory === "llm" && <th className="pb-2 font-medium text-right">{t.context}</th>}
                    <th className="pb-2 pr-6 font-medium text-right">{t.pricing}</th>
                    <th className="pb-2 pl-4 font-medium">{t.highlight}</th>
                  </tr>
                </thead>
                <tbody>
                  {MARKET_LEADERBOARD.filter((m) => m.category === marketCategory).map((m, i) => (
                    <tr key={i} className={`border-b border-gray-100 ${i < 3 ? "bg-yellow-50/30" : ""}`}>
                      <td className="py-3 text-center">{medalEmoji(i)}</td>
                      <td className="py-3 font-medium text-gray-800">{m.name}</td>
                      <td className="py-3 text-gray-500">{m.provider}</td>
                      {marketCategory === "llm" && (
                        <td className="py-3 text-right font-semibold text-indigo-600">{m.arena_elo || "—"}</td>
                      )}
                      {marketCategory === "llm" && <td className="py-3 text-right text-gray-600">{m.context}</td>}
                      <td className="py-3 pr-6 text-right text-gray-600">{m.pricing}</td>
                      <td className="py-3 pl-4 text-xs text-gray-500">{m.highlight}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <p className="text-[10px] text-gray-400 mt-4">
              {isZh
                ? "市场数据参考 Chatbot Arena、官方定价页。ELO 评分越高 = 用户投票越多 = 质量越好。数据定期更新。"
                : "Market data from Chatbot Arena rankings & official pricing. Higher ELO = more user votes = better quality. Updated periodically."}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
