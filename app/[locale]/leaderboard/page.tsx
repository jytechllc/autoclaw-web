"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
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

// Industry benchmark data (updated periodically)
const MARKET_LEADERBOARD: MarketModel[] = [
  // LLM
  { name: "Claude Opus 4", provider: "Anthropic", category: "llm", arena_elo: 1410, context: "200K", pricing: "$15/$75", highlight: "Best for complex reasoning & code" },
  { name: "GPT-4.1", provider: "OpenAI", category: "llm", arena_elo: 1395, context: "1M", pricing: "$2/$8", highlight: "Best price-performance ratio" },
  { name: "Gemini 2.5 Pro", provider: "Google", category: "llm", arena_elo: 1390, context: "1M", pricing: "$1.25/$10", highlight: "Largest context window" },
  { name: "Claude Sonnet 4", provider: "Anthropic", category: "llm", arena_elo: 1370, context: "200K", pricing: "$3/$15", highlight: "Best for writing & analysis" },
  { name: "Qwen 3 235B", provider: "Alibaba", category: "llm", arena_elo: 1340, context: "128K", pricing: "Free (Cerebras)", highlight: "Best free model" },
  { name: "DeepSeek V3", provider: "DeepSeek", category: "llm", arena_elo: 1330, context: "128K", pricing: "$0.27/$1.10", highlight: "Cheapest high-quality" },
  { name: "Llama 4 Scout", provider: "Meta", category: "llm", arena_elo: 1310, context: "10M", pricing: "Free (open)", highlight: "Best open-source" },
  { name: "Grok 3", provider: "xAI", category: "llm", arena_elo: 1350, context: "128K", pricing: "$3/$15", highlight: "Real-time web access" },
  // Image
  { name: "DALL-E 3", provider: "OpenAI", category: "image", context: "—", pricing: "$0.04/img", highlight: "Best text understanding" },
  { name: "Midjourney v7", provider: "Midjourney", category: "image", context: "—", pricing: "$10/mo", highlight: "Best artistic quality" },
  { name: "Flux 1.1 Pro", provider: "Black Forest", category: "image", context: "—", pricing: "$0.04/img", highlight: "Best photorealism" },
  { name: "Stable Diffusion 3.5", provider: "Stability AI", category: "image", context: "—", pricing: "Free (open)", highlight: "Best open-source image" },
  { name: "Ideogram 3", provider: "Ideogram", category: "image", context: "—", pricing: "$0.04/img", highlight: "Best text-in-image" },
  // Search
  { name: "Tavily", provider: "Tavily", category: "search", context: "—", pricing: "Free 1000/mo", highlight: "Best AI-optimized search" },
  { name: "Firecrawl", provider: "Firecrawl", category: "search", context: "—", pricing: "Free 500/mo", highlight: "Best JS rendering" },
  { name: "Perplexity API", provider: "Perplexity", category: "search", context: "—", pricing: "$5/1000 req", highlight: "Best answer engine" },
];

export default function LeaderboardPage() {
  const params = useParams();
  const locale = (params.locale as Locale) || "en";
  const isZh = locale === "zh" || locale === "zh-TW";
  const [activeTab, setActiveTab] = useState<"platform" | "market">("platform");
  const [rankings, setRankings] = useState<PlatformRanking[]>([]);
  const [autoPick, setAutoPick] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [marketCategory, setMarketCategory] = useState<"llm" | "image" | "search">("llm");

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
    provider: isZh ? "提供商" : "Provider",
    calls: isZh ? "调用次数" : "Calls",
    users: isZh ? "用户数" : "Users",
    tokens: "Tokens",
    trending: isZh ? "7日趋势" : "7d Trend",
    score: isZh ? "热度" : "Score",
    autoPick: isZh ? "Auto 推荐" : "Auto Pick",
    analysis: isZh ? "分析" : "Analysis",
    writing: isZh ? "写作" : "Writing",
    image: isZh ? "图像" : "Image",
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
                    {rankings.map((r, i) => (
                      <tr key={i} className={`border-b border-gray-100 ${i < 3 ? "bg-yellow-50/30" : ""}`}>
                        <td className="py-3 text-center">{medalEmoji(i)}</td>
                        <td className="py-3 font-medium text-gray-800">{String(r.model)}</td>
                        <td className="py-3 text-gray-500">{String(r.provider)}</td>
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
              {(["llm", "image", "search"] as const).map((cat) => (
                <button
                  key={cat}
                  onClick={() => setMarketCategory(cat)}
                  className={`px-4 py-1.5 rounded-full text-xs font-medium cursor-pointer ${marketCategory === cat ? "bg-red-700 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"}`}
                >
                  {cat === "llm" ? t.llm : cat === "image" ? t.image : t.search}
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
                    <th className="pb-2 font-medium text-right">{t.context}</th>
                    <th className="pb-2 font-medium text-right">{t.pricing}</th>
                    <th className="pb-2 font-medium">{t.highlight}</th>
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
                      <td className="py-3 text-right text-gray-600">{m.context}</td>
                      <td className="py-3 text-right text-gray-600">{m.pricing}</td>
                      <td className="py-3 text-xs text-gray-500">{m.highlight}</td>
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
