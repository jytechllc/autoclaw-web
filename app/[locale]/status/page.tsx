"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { getDictionary, type Locale } from "@/lib/i18n";
import LanguageSwitcher from "@/components/LanguageSwitcher";

interface UserQuota {
  plan: string;
  todayTokens: number;
  todaySpendCents: number;
  dailyLimitCents: number;
  dailyTokenLimit: number;
  remaining: number | null;
  remainingTokens: number | null;
  unlimited: boolean;
}

interface EmbeddingUsage {
  period: string;
  requestCount: number;
  tokenCount: number;
  budget: number;
}

interface Usage30d {
  activeUsers: number;
  activeDays: number;
  totalTokens: number;
  totalRequests: number;
  totalCostCents: number;
  avgDailyTokens: number;
  avgDailyCostCents: number;
  avgPerUser: number;
  avgDailyPerUser: number;
  avgCostPerUser: number;
}

interface BySource { source: string; totalTokens: number; requests: number; costCents: number }
interface ByPlan { plan: string; users: number; totalTokens: number; requests: number; costCents: number; avgPerUser: number; avgCostPerUser: number; avgDailyPerUser: number }
interface ByokStats { totalTokens: number; requests: number; users: number; costCents: number }

interface StatusData {
  allTime: { prompt_tokens: number; completion_tokens: number; total_tokens: number; request_count: number };
  today: { prompt_tokens: number; completion_tokens: number; total_tokens: number; request_count: number };
  byProvider: { provider: string; total_tokens: number; prompt_tokens: number; completion_tokens: number; request_count: number; costCents: number }[];
  totalCostCents: number;
  last7Days: { date: string; total_tokens: number; request_count: number }[];
  users: number;
  nextResetUtc: string;
  user?: UserQuota;
  embedding?: EmbeddingUsage;
  usage30d?: Usage30d;
  bySource?: BySource[];
  byPlan?: ByPlan[];
  byok?: ByokStats;
  apiUsage?: { service: string; action: string; totalCount: number; users: number; lastUsed: string }[];
}

interface PlatformData {
  platform: string;
  services: { name: string; cost: number; quantity: number; unit: string }[];
  totalGross: number;
}

interface PlatformBilling {
  platforms: PlatformData[];
  monthStart?: string;
  syncedAt?: string;
}

function formatCost(cents: number): string {
  if (cents === 0) return "$0";
  if (cents < 1) return `$${(cents / 100).toFixed(4)}`;
  if (cents < 100) return `$${(cents / 100).toFixed(2)}`;
  return `$${(cents / 100).toFixed(2)}`;
}

function formatTokens(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function Countdown({ target }: { target: string }) {
  const [timeLeft, setTimeLeft] = useState("");

  useEffect(() => {
    function update() {
      const diff = new Date(target).getTime() - Date.now();
      if (diff <= 0) { setTimeLeft("Resetting..."); return; }
      const h = Math.floor(diff / 3600000);
      const m = Math.floor((diff % 3600000) / 60000);
      const s = Math.floor((diff % 60000) / 1000);
      setTimeLeft(`${h}h ${m}m ${s}s`);
    }
    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [target]);

  return <span className="font-mono">{timeLeft}</span>;
}

export default function StatusPage() {
  const params = useParams();
  const locale = (params.locale as Locale) || "en";
  const dict = getDictionary(locale);
  const ts = dict.status;

  const [data, setData] = useState<StatusData | null>(null);
  const [platformBilling, setPlatformBilling] = useState<PlatformBilling | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/status")
      .then((r) => r.json())
      .then((d) => { setData(d); setLoading(false); })
      .catch(() => setLoading(false));
    // Fetch platform billing separately (may be slow on first load without cache)
    fetch("/api/status/vercel")
      .then((r) => r.ok ? r.json() : null)
      .then((d) => { if (d && !d.error) setPlatformBilling(d); })
      .catch(() => {});
  }, []);

  const maxDayTokens = data ? Math.max(...data.last7Days.map((d) => Number(d.total_tokens)), 1) : 1;

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 py-4 flex items-center justify-between">
          <Link href={`/${locale}`} className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <img src="/logo.svg" alt="AutoClaw" className="w-9 h-9" />
            <span><span className="text-red-600">Auto</span>Claw</span>
          </Link>
          <LanguageSwitcher locale={locale} />
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 sm:px-6 py-8">
        <div className="mb-8">
          <h1 className="text-3xl font-bold mb-2">{ts.title}</h1>
          <p className="text-gray-500">{ts.subtitle}</p>
        </div>

        {loading ? (
          <div className="text-center py-12 text-gray-400">{dict.common.loading}</div>
        ) : data ? (
          <div className="space-y-6">
            {/* Status indicator */}
            <div className="bg-white rounded-lg border border-gray-200 p-6">
              <div className="flex items-center gap-3">
                <div className="w-3 h-3 rounded-full bg-green-500 animate-pulse" />
                <span className="text-lg font-semibold text-green-700">{ts.operational}</span>
              </div>
            </div>

            {/* Monthly Cost Overview */}
            {(() => {
              const aiCost = data.usage30d?.totalCostCents ? data.usage30d.totalCostCents / 100 : 0;
              const byokAiCost = data.byok?.costCents ? data.byok.costCents / 100 : 0;
              const vercelGross = platformBilling?.platforms.find((p) => p.platform === "vercel")?.totalGross || 0;
              const githubGross = platformBilling?.platforms.find((p) => p.platform === "github")?.totalGross || 0;
              const fixedCosts = [
                { name: "Claude Max", cost: 100 },
                { name: "Vercel Pro", cost: 20 },
                { name: "ChatGPT Go", cost: 8 },
                { name: "Neon DB (Free)", cost: 0 },
                { name: "Auth0 (Free)", cost: 0 },
                { name: "Cloudflare Worker (Free)", cost: 0 },
                { name: "Brevo (Free 300/day)", cost: 0 },
              ];
              const enrichCosts = [
                { name: "Hunter.io", cost: 0, paidCost: 49, paidLabel: "Starter (500 searches)" },
                { name: "Apollo.io", cost: 0, paidCost: 49, paidLabel: "Basic (unlimited)" },
                { name: "Snov.io", cost: 0, paidCost: 30, paidLabel: "Starter (1K credits)" },
                { name: "Apify", cost: 0, paidCost: 49, paidLabel: "Personal" },
              ];
              const fixedTotal = fixedCosts.reduce((s, c) => s + c.cost, 0);
              const enrichCurrentTotal = enrichCosts.reduce((s, c) => s + c.cost, 0);
              const enrichPaidTotal = enrichCosts.reduce((s, c) => s + c.paidCost, 0);
              const platformTotal = vercelGross + githubGross;
              const totalAI = aiCost + byokAiCost;
              const totalMonthly = fixedTotal + enrichCurrentTotal + totalAI + platformTotal;
              const totalAnnual = totalMonthly * 12;
              const totalMonthlyPaid = fixedTotal + enrichPaidTotal + totalAI + platformTotal;
              const totalAnnualPaid = totalMonthlyPaid * 12;

              return (
                <div className="bg-white rounded-lg border border-red-200 p-6">
                  <h2 className="text-sm font-semibold mb-4">{ts.monthlyCostOverview || "Monthly Cost Overview"}</h2>
                  {/* Grand total — current (free enrichment) vs upgraded */}
                  <div className="mb-4 pb-4 border-b border-gray-100">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      {/* Current */}
                      <div className="text-center p-4 bg-gray-50 rounded-lg">
                        <p className="text-xs text-gray-400 mb-2">{ts.enrichFree || "Current (Free Enrichment)"}</p>
                        <div className="flex items-center justify-center gap-4">
                          <div>
                            <p className="text-3xl font-bold text-red-600">${totalMonthly.toFixed(2)}</p>
                            <p className="text-[10px] text-gray-400">{ts.estTotal || "/ Month"}</p>
                          </div>
                          <div className="text-gray-300">→</div>
                          <div>
                            <p className="text-3xl font-bold text-red-800">${totalAnnual.toFixed(2)}</p>
                            <p className="text-[10px] text-gray-400">{ts.estAnnual || "/ Year"}</p>
                          </div>
                        </div>
                      </div>
                      {/* Upgraded */}
                      <div className="text-center p-4 bg-red-50 rounded-lg border border-red-100">
                        <p className="text-xs text-red-400 mb-2">{ts.enrichUpgraded || "If Enrichment Upgraded"}</p>
                        <div className="flex items-center justify-center gap-4">
                          <div>
                            <p className="text-3xl font-bold text-red-600">${totalMonthlyPaid.toFixed(2)}</p>
                            <p className="text-[10px] text-gray-400">{ts.estTotal || "/ Month"}</p>
                          </div>
                          <div className="text-gray-300">→</div>
                          <div>
                            <p className="text-3xl font-bold text-red-800">${totalAnnualPaid.toFixed(2)}</p>
                            <p className="text-[10px] text-gray-400">{ts.estAnnual || "/ Year"}</p>
                          </div>
                        </div>
                        <p className="text-[10px] text-red-300 mt-1">+${enrichPaidTotal}/mo enrichment</p>
                      </div>
                    </div>
                  </div>
                  {/* Breakdown */}
                  <div className="grid grid-cols-2 sm:grid-cols-5 gap-4 text-center mb-4">
                    <div>
                      <p className="text-lg font-bold">${fixedTotal}</p>
                      <p className="text-xs text-gray-500">{ts.fixedCosts || "Subscriptions"}</p>
                    </div>
                    <div>
                      <p className="text-lg font-bold">${enrichCurrentTotal}<span className="text-xs text-gray-400 font-normal"> / ${enrichPaidTotal}</span></p>
                      <p className="text-xs text-gray-500">{ts.enrichCosts || "Enrichment"}</p>
                    </div>
                    <div>
                      <p className="text-lg font-bold">{formatCost(totalAI * 100)}</p>
                      <p className="text-xs text-gray-500">{ts.aiApiCost || "AI API (all users)"}</p>
                    </div>
                    <div>
                      <p className="text-lg font-bold">{formatCost(vercelGross * 100)}</p>
                      <p className="text-xs text-gray-500">{ts.vercelUsage || "Vercel (gross)"}</p>
                    </div>
                    <div>
                      <p className="text-lg font-bold">{formatCost(githubGross * 100)}</p>
                      <p className="text-xs text-gray-500">{ts.githubUsage || "GitHub (gross)"}</p>
                    </div>
                  </div>
                  {/* AI cost detail */}
                  {totalAI > 0 && (
                    <div className="bg-gray-50 rounded-lg p-3 mb-3">
                      <p className="text-xs text-gray-500 mb-1">{ts.aiBreakdown || "AI API Breakdown"}</p>
                      <div className="flex gap-4 text-xs">
                        <span>{ts.platformAI || "Platform API"}: <strong>{formatCost(aiCost * 100)}</strong></span>
                        <span>{ts.byokAI || "BYOK (user keys)"}: <strong>{formatCost(byokAiCost * 100)}</strong></span>
                      </div>
                    </div>
                  )}
                  {/* Fixed cost tags */}
                  <div className="mb-3">
                    <p className="text-xs text-gray-400 mb-1.5">{ts.fixedCosts || "Subscriptions"}</p>
                    <div className="flex flex-wrap gap-2">
                      {fixedCosts.map((c) => (
                        <span key={c.name} className={`text-xs px-2 py-1 rounded-full ${c.cost > 0 ? "bg-gray-100 text-gray-600" : "bg-green-50 text-green-600"}`}>
                          {c.name}: {c.cost > 0 ? `$${c.cost}/mo` : "Free"}
                        </span>
                      ))}
                    </div>
                  </div>
                  {/* Enrichment cost tags */}
                  <div>
                    <p className="text-xs text-gray-400 mb-1.5">{ts.enrichCosts || "Enrichment Services"}</p>
                    <div className="flex flex-wrap gap-2">
                      {enrichCosts.map((c) => (
                        <span key={c.name} className={`text-xs px-2 py-1 rounded-full ${c.cost > 0 ? "bg-blue-50 text-blue-600" : "bg-green-50 text-green-600"}`} title={`${c.paidLabel}: $${c.paidCost}/mo`}>
                          {c.name}: {c.cost > 0 ? `$${c.cost}/mo` : "Free"}
                        </span>
                      ))}
                    </div>
                    <p className="text-[10px] text-gray-300 mt-1.5">
                      {ts.enrichUpgradeHint || "Hover for upgrade options. If upgraded: Hunter $49 + Apollo $49 + Snov $30 + Apify $49 = $177/mo ($2,124/yr)"}
                    </p>
                  </div>
                </div>
              );
            })()}

            {/* User Quota (if logged in) */}
            {data.user && (
              <div className="bg-white rounded-lg border border-red-200 p-6">
                <h2 className="text-sm font-semibold mb-4">{ts.yourQuota} <span className="text-xs font-normal text-gray-400 capitalize">({data.user.plan} {ts.plan})</span></h2>
                {data.user.unlimited ? (
                  <p className="text-sm text-gray-600">{ts.unlimited}</p>
                ) : (
                  <div className="space-y-3">
                    {/* Progress bar */}
                    <div>
                      <div className="flex justify-between text-xs text-gray-500 mb-1">
                        <span>{formatTokens(data.user.todayTokens)} {ts.used}</span>
                        <span>{formatTokens(data.user.dailyTokenLimit)} {ts.limit}</span>
                      </div>
                      <div className="w-full bg-gray-100 rounded-full h-3 overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all duration-500 ${
                            data.user.todayTokens / data.user.dailyTokenLimit > 0.9 ? "bg-red-500" :
                            data.user.todayTokens / data.user.dailyTokenLimit > 0.7 ? "bg-yellow-500" : "bg-green-500"
                          }`}
                          style={{ width: `${Math.min(100, (data.user.todayTokens / data.user.dailyTokenLimit) * 100)}%` }}
                        />
                      </div>
                    </div>
                    <div className="grid grid-cols-3 gap-4 text-center">
                      <div>
                        <p className="text-lg font-bold">{formatTokens(data.user.remainingTokens ?? 0)}</p>
                        <p className="text-xs text-gray-500">{ts.remaining}</p>
                      </div>
                      <div>
                        <p className="text-lg font-bold">${(data.user.dailyLimitCents / 100).toFixed(2)}</p>
                        <p className="text-xs text-gray-500">{ts.dailyBudget}</p>
                      </div>
                      <div>
                        <p className="text-lg font-bold"><Countdown target={data.nextResetUtc} /></p>
                        <p className="text-xs text-gray-500">{ts.nextReset}</p>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Key metrics */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <div className="bg-white rounded-lg border border-gray-200 p-4">
                <p className="text-xs text-gray-500 mb-1">{ts.todayTokens}</p>
                <p className="text-2xl font-bold">{formatTokens(Number(data.today.total_tokens))}</p>
                <p className="text-xs text-gray-400 mt-1">{Number(data.today.request_count).toLocaleString()} {ts.requests}</p>
              </div>
              <div className="bg-white rounded-lg border border-gray-200 p-4">
                <p className="text-xs text-gray-500 mb-1">{ts.allTimeTokens}</p>
                <p className="text-2xl font-bold">{formatTokens(Number(data.allTime.total_tokens))}</p>
                <p className="text-xs text-gray-400 mt-1">{Number(data.allTime.request_count).toLocaleString()} {ts.requests}</p>
              </div>
              <div className="bg-white rounded-lg border border-gray-200 p-4">
                <p className="text-xs text-gray-500 mb-1">{ts.registeredUsers}</p>
                <p className="text-2xl font-bold">{data.users}</p>
              </div>
              <div className="bg-white rounded-lg border border-gray-200 p-4">
                <p className="text-xs text-gray-500 mb-1">{ts.nextReset}</p>
                <p className="text-xl font-bold"><Countdown target={data.nextResetUtc} /></p>
                <p className="text-xs text-gray-400 mt-1">UTC {ts.midnight}</p>
              </div>
            </div>

            {/* Last 7 days chart */}
            <div className="bg-white rounded-lg border border-gray-200 p-6">
              <h2 className="text-sm font-semibold mb-4">{ts.last7Days}</h2>
              <div className="space-y-2">
                {data.last7Days.map((day) => (
                  <div key={day.date} className="flex items-center gap-3">
                    <span className="text-xs text-gray-500 w-20 shrink-0">{new Date(day.date).toLocaleDateString(locale, { month: "short", day: "numeric" })}</span>
                    <div className="flex-1 bg-gray-100 rounded-full h-5 overflow-hidden">
                      <div
                        className="bg-red-500 h-full rounded-full transition-all duration-500"
                        style={{ width: `${(Number(day.total_tokens) / maxDayTokens) * 100}%` }}
                      />
                    </div>
                    <span className="text-xs text-gray-600 font-mono w-16 text-right">{formatTokens(Number(day.total_tokens))}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* By provider */}
            <div className="bg-white rounded-lg border border-gray-200 p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-sm font-semibold">{ts.byProvider}</h2>
                <span className="text-sm font-bold text-red-600">{ts.totalCost || "Total Cost"}: {formatCost(data.totalCostCents)}</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-gray-500 border-b border-gray-100">
                      <th className="py-2 font-medium">{ts.provider}</th>
                      <th className="py-2 font-medium text-right">{ts.totalTokens}</th>
                      <th className="py-2 font-medium text-right">{ts.requests}</th>
                      <th className="py-2 font-medium text-right">{ts.cost || "Cost"}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.byProvider.map((p) => (
                      <tr key={p.provider} className="border-b border-gray-50">
                        <td className="py-2 font-medium capitalize">{p.provider}</td>
                        <td className="py-2 text-right font-mono">{formatTokens(Number(p.total_tokens))}</td>
                        <td className="py-2 text-right font-mono">{Number(p.request_count).toLocaleString()}</td>
                        <td className="py-2 text-right font-mono">{p.costCents === 0 ? <span className="text-green-600">Free</span> : formatCost(p.costCents)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            {/* 30-Day Usage Summary */}
            {data.usage30d && (
              <div className="bg-white rounded-lg border border-gray-200 p-6">
                <h2 className="text-sm font-semibold mb-4">{ts.usage30d || "30-Day Usage Summary"}</h2>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 text-center mb-4">
                  <div>
                    <p className="text-2xl font-bold">{formatTokens(data.usage30d.totalTokens)}</p>
                    <p className="text-xs text-gray-500">{ts.totalTokens || "Total Tokens"}</p>
                  </div>
                  <div>
                    <p className="text-2xl font-bold text-red-600">{formatCost(data.usage30d.totalCostCents)}</p>
                    <p className="text-xs text-gray-500">{ts.totalCost || "Total Cost"}</p>
                  </div>
                  <div>
                    <p className="text-2xl font-bold">{data.usage30d.activeUsers}</p>
                    <p className="text-xs text-gray-500">{ts.activeUsers || "Active Users"}</p>
                  </div>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-center border-t border-gray-100 pt-4">
                  <div>
                    <p className="text-lg font-bold">{formatTokens(data.usage30d.avgDailyTokens)}</p>
                    <p className="text-xs text-gray-500">{ts.avgDaily || "Avg Daily"}</p>
                  </div>
                  <div>
                    <p className="text-lg font-bold">{formatCost(data.usage30d.avgDailyCostCents)}</p>
                    <p className="text-xs text-gray-500">{ts.avgDailyCost || "Avg Daily Cost"}</p>
                  </div>
                  <div>
                    <p className="text-lg font-bold">{formatTokens(data.usage30d.avgDailyPerUser)}</p>
                    <p className="text-xs text-gray-500">{ts.avgDailyPerUser || "Avg / User / Day"}</p>
                  </div>
                  <div>
                    <p className="text-lg font-bold">{formatCost(data.usage30d.avgCostPerUser)}</p>
                    <p className="text-xs text-gray-500">{ts.avgCostPerUser || "Avg Cost / User"}</p>
                  </div>
                </div>
              </div>
            )}

            {/* By Source + BYOK */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {data.bySource && data.bySource.length > 0 && (
                <div className="bg-white rounded-lg border border-gray-200 p-6">
                  <h2 className="text-sm font-semibold mb-4">{ts.bySource || "By Source"}</h2>
                  <div className="space-y-2">
                    {data.bySource.map((s) => {
                      const pct = data.usage30d ? Math.round((s.totalTokens / Math.max(data.usage30d.totalTokens, 1)) * 100) : 0;
                      const label: Record<string, string> = { chat: "Chat", cron: "Agent (Cron)", chat_enrich: "Chat Enrich", unknown: "Other" };
                      return (
                        <div key={s.source} className="flex items-center gap-3">
                          <span className="text-xs text-gray-600 w-28 shrink-0">{label[s.source] || s.source}</span>
                          <div className="flex-1 bg-gray-100 rounded-full h-4 overflow-hidden">
                            <div className="bg-red-400 h-full rounded-full" style={{ width: `${pct}%` }} />
                          </div>
                          <span className="text-xs font-mono text-gray-500 w-16 text-right">{formatTokens(s.totalTokens)}</span>
                          <span className="text-xs font-mono text-gray-500 w-16 text-right">{formatCost(s.costCents)}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {data.byok && (
                <div className="bg-white rounded-lg border border-gray-200 p-6">
                  <h2 className="text-sm font-semibold mb-4">{ts.byokUsage || "BYOK Usage (Agent/Worker)"}</h2>
                  <p className="text-xs text-gray-400 mb-4">{ts.byokDesc || "Requests using user/org-provided API keys via cron agents"}</p>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-center">
                    <div>
                      <p className="text-2xl font-bold">{formatTokens(data.byok.totalTokens)}</p>
                      <p className="text-xs text-gray-500">{ts.totalTokens || "Tokens"}</p>
                    </div>
                    <div>
                      <p className="text-2xl font-bold">{formatCost(data.byok.costCents)}</p>
                      <p className="text-xs text-gray-500">{ts.cost || "Cost"}</p>
                    </div>
                    <div>
                      <p className="text-2xl font-bold">{data.byok.requests.toLocaleString()}</p>
                      <p className="text-xs text-gray-500">{ts.requests || "Requests"}</p>
                    </div>
                    <div>
                      <p className="text-2xl font-bold">{data.byok.users}</p>
                      <p className="text-xs text-gray-500">{ts.byokUsers || "Users with BYOK"}</p>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Avg Consumption by Plan */}
            {data.byPlan && data.byPlan.length > 0 && (
              <div className="bg-white rounded-lg border border-gray-200 p-6">
                <h2 className="text-sm font-semibold mb-4">{ts.byPlan || "Avg Consumption by Plan (30 days)"}</h2>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-xs text-gray-500 border-b border-gray-100">
                        <th className="py-2 font-medium">{ts.plan || "Plan"}</th>
                        <th className="py-2 font-medium text-right">{ts.usersLabel || "Users"}</th>
                        <th className="py-2 font-medium text-right">{ts.totalTokens || "Total"}</th>
                        <th className="py-2 font-medium text-right">{ts.cost || "Cost"}</th>
                        <th className="py-2 font-medium text-right">{ts.avgPerUser || "Avg / User"}</th>
                        <th className="py-2 font-medium text-right">{ts.avgCostPerUser || "Avg Cost / User"}</th>
                        <th className="py-2 font-medium text-right">{ts.requests || "Requests"}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.byPlan.map((p) => (
                        <tr key={p.plan} className="border-b border-gray-50">
                          <td className="py-2"><span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 capitalize font-medium">{p.plan}</span></td>
                          <td className="py-2 text-right font-mono">{p.users}</td>
                          <td className="py-2 text-right font-mono">{formatTokens(p.totalTokens)}</td>
                          <td className="py-2 text-right font-mono">{formatCost(p.costCents)}</td>
                          <td className="py-2 text-right font-mono">{formatTokens(p.avgPerUser)}</td>
                          <td className="py-2 text-right font-mono">{formatCost(p.avgCostPerUser)}</td>
                          <td className="py-2 text-right font-mono">{p.requests.toLocaleString()}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Embedding Usage */}
            {data.embedding && (
              <div className="bg-white rounded-lg border border-gray-200 p-6">
                <h2 className="text-sm font-semibold mb-4">{ts.embeddingUsage || "Embedding Usage"} <span className="text-xs font-normal text-gray-400">({data.embedding.period})</span></h2>
                <div className="space-y-3">
                  <div>
                    <div className="flex justify-between text-xs text-gray-500 mb-1">
                      <span>{formatTokens(data.embedding.requestCount)} {ts.requests}</span>
                      <span>{formatTokens(data.embedding.budget)} {ts.limit || "limit"}</span>
                    </div>
                    <div className="w-full bg-gray-100 rounded-full h-3 overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all duration-500 ${
                          data.embedding.requestCount / data.embedding.budget > 0.9 ? "bg-red-500" :
                          data.embedding.requestCount / data.embedding.budget > 0.7 ? "bg-yellow-500" : "bg-blue-500"
                        }`}
                        style={{ width: `${Math.min(100, (data.embedding.requestCount / data.embedding.budget) * 100)}%` }}
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-4 text-center">
                    <div>
                      <p className="text-lg font-bold">{formatTokens(data.embedding.requestCount)}</p>
                      <p className="text-xs text-gray-500">{ts.requests}</p>
                    </div>
                    <div>
                      <p className="text-lg font-bold">{formatTokens(data.embedding.tokenCount)}</p>
                      <p className="text-xs text-gray-500">{ts.embeddingTokens || "Tokens Embedded"}</p>
                    </div>
                    <div>
                      <p className="text-lg font-bold">{formatTokens(Math.max(0, data.embedding.budget - data.embedding.requestCount))}</p>
                      <p className="text-xs text-gray-500">{ts.remaining}</p>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* External API Usage (BYOK) */}
            {data.apiUsage && data.apiUsage.length > 0 && (
              <div className="bg-white rounded-lg border border-gray-200 p-6">
                <h2 className="text-sm font-semibold mb-4">{ts.externalApiUsage || "External API Usage (30 days)"}</h2>
                <p className="text-xs text-gray-400 mb-3">{ts.externalApiDesc || "API calls via user/org BYOK keys (Apollo, Hunter, Brevo, Apify, etc.)"}</p>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-xs text-gray-500 border-b border-gray-100">
                        <th className="py-2 font-medium">{ts.service || "Service"}</th>
                        <th className="py-2 font-medium">{ts.actionLabel || "Action"}</th>
                        <th className="py-2 font-medium text-right">{ts.callCount || "Calls"}</th>
                        <th className="py-2 font-medium text-right">{ts.usersLabel || "Users"}</th>
                        <th className="py-2 font-medium text-right">{ts.lastUsedLabel || "Last Used"}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.apiUsage.map((a, i) => (
                        <tr key={i} className="border-b border-gray-50">
                          <td className="py-2 text-xs font-medium capitalize">{a.service}</td>
                          <td className="py-2 text-xs text-gray-500">{a.action.replace(/_/g, " ")}</td>
                          <td className="py-2 text-right font-mono text-xs">{a.totalCount.toLocaleString()}</td>
                          <td className="py-2 text-right font-mono text-xs">{a.users}</td>
                          <td className="py-2 text-right text-xs text-gray-400">{new Date(a.lastUsed).toLocaleDateString(locale)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Platform Billing (Vercel + GitHub) */}
            <div className="bg-white rounded-lg border border-gray-200 p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-sm font-semibold">{ts.platformBilling || "Platform Usage (This Month)"}</h2>
                {platformBilling?.syncedAt ? (
                  <span className="text-xs text-gray-400">Synced: {new Date(platformBilling.syncedAt).toLocaleDateString(locale)}</span>
                ) : !platformBilling ? (
                  <span className="text-xs text-gray-400 animate-pulse">{dict.common.loading}</span>
                ) : null}
              </div>
              {platformBilling?.platforms && platformBilling.platforms.length > 0 ? (
                <div className="space-y-4">
                  {platformBilling.platforms.map((p) => {
                    const platformLabels: Record<string, string> = { vercel: "Vercel", github: "GitHub" };
                    return (
                      <div key={p.platform}>
                        <div className="flex items-center justify-between mb-2">
                          <h3 className="text-xs font-semibold text-gray-600">{platformLabels[p.platform] || p.platform}</h3>
                          <span className="text-xs font-mono">{ts.grossUsage || "Gross"}: {formatCost(p.totalGross * 100)}</span>
                        </div>
                        <div className="overflow-x-auto">
                          <table className="w-full text-xs">
                            <thead>
                              <tr className="text-left text-gray-400 border-b border-gray-100">
                                <th className="py-1.5 font-medium">{ts.service || "Service"}</th>
                                <th className="py-1.5 font-medium text-right">{ts.quantity || "Usage"}</th>
                                <th className="py-1.5 font-medium text-right">{ts.cost || "Gross Cost"}</th>
                              </tr>
                            </thead>
                            <tbody>
                              {p.services.map((s) => {
                                const isFree = s.unit.includes("free tier");
                                return (
                                  <tr key={s.name} className="border-b border-gray-50">
                                    <td className="py-1.5 text-gray-700">{s.name}</td>
                                    <td className="py-1.5 text-right font-mono">{s.quantity > 0 ? `${s.quantity.toLocaleString()} ${s.unit.split(" (")[0]}` : "-"}</td>
                                    <td className="py-1.5 text-right font-mono">
                                      {formatCost(s.cost * 100)}
                                      {isFree && <span className="ml-1 text-green-600 font-normal">(free)</span>}
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : !platformBilling ? (
                <p className="text-sm text-gray-400 text-center py-4 animate-pulse">{ts.platformLoading || "Loading platform billing..."}</p>
              ) : (
                <p className="text-sm text-gray-400 text-center py-4">{ts.platformNoData || "No billing data yet. Run sync-billing cron first."}</p>
              )}
            </div>
          </div>
        ) : (
          <div className="text-center py-12 text-gray-400">{ts.unavailable}</div>
        )}
      </main>
    </div>
  );
}
