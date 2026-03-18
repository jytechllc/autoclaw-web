"use client";

import { useUser } from "@auth0/nextjs-auth0/client";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { getDictionary, type Locale } from "@/lib/i18n";
import DashboardShell from "@/components/DashboardShell";

interface TokenByModel {
  model: string;
  provider?: string;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  request_count: number;
}

interface TokenByDate {
  date: string;
  total_tokens: number;
  request_count: number;
}

interface DailySpend {
  user_id: number;
  email: string;
  provider: string;
  prompt_tokens: number;
  completion_tokens: number;
  spend_cents: number;
}

interface QuotaInfo {
  plan: string;
  dailyLimitCents: number;
  todaySpendCents: number;
  remaining: number;
  percentage: number;
}

interface OrgInfo {
  name: string;
  plan: string;
  memberCount: number;
}

// Pricing per 1M tokens [input, output] in USD
const MODEL_PRICING: Record<string, [number, number]> = {
  "anthropic/claude-sonnet-4.5": [15, 75],
  "anthropic/claude-haiku-3.5": [4, 20],
  "openai/gpt-4o": [12.5, 50],
  "openai/gpt-4o-mini": [0.75, 3],
  "gpt-oss-120b": [0.25, 0.69],
  "llama-3.3-70b": [0, 0],
  "llama3.1-8b": [0, 0],
  "qwen2.5:3b": [0, 0],
  "qwen2.5:7b": [0, 0],
  "qwen-3-235b-a22b-instruct-2507": [0, 0],
  "gemini-2.0-flash": [0.05, 0.05],
  "meta/llama-3.1-8b-instruct": [0, 0],
};

const FREE_MODELS = new Set([
  "llama-3.3-70b", "llama3.1-8b", "qwen2.5:3b", "qwen2.5:7b",
  "qwen-3-235b-a22b-instruct-2507", "meta/llama-3.1-8b-instruct",
  "gpt-oss-120b", "gemini-2.0-flash",
]);

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function estimateCost(model: string, promptTokens: number, completionTokens: number): number {
  const pricing = MODEL_PRICING[model];
  if (!pricing) return 0;
  return (promptTokens / 1_000_000) * pricing[0] + (completionTokens / 1_000_000) * pricing[1];
}

function formatCost(cost: number): string {
  if (cost === 0) return "Free";
  if (cost < 0.01) return "<$0.01";
  return `$${cost.toFixed(2)}`;
}

const LABELS: Record<string, Record<string, string>> = {
  en: {
    title: "Usage",
    subtitle: "Monitor your AI usage, quotas, and costs across all models.",
    yourQuota: "Your Daily Quota",
    used: "Used",
    remaining: "Remaining",
    limit: "Daily Limit",
    plan: "Plan",
    orgUsage: "Organization Usage",
    orgName: "Organization",
    members: "Members",
    personalUsage: "Your Usage (Last 30 Days)",
    model: "Model",
    requests: "Requests",
    inputTokens: "Input Tokens",
    outputTokens: "Output Tokens",
    totalTokens: "Total Tokens",
    estCost: "Est. Cost",
    type: "Type",
    free: "Free",
    paid: "Paid",
    byok: "BYOK",
    dailyTrend: "Daily Trend (Last 30 Days)",
    date: "Date",
    noUsage: "No usage data yet. Start chatting to see your usage here.",
    quotaExceeded: "Quota exceeded! Upgrade your plan or add your own API keys (BYOK).",
    quotaHealthy: "Quota healthy",
    quotaWarning: "Approaching daily limit",
    addKeys: "Add API Keys",
    upgrade: "Upgrade Plan",
  },
  zh: {
    title: "用量",
    subtitle: "监控您的 AI 使用量、配额和各模型成本。",
    yourQuota: "每日配额",
    used: "已使用",
    remaining: "剩余",
    limit: "每日限额",
    plan: "套餐",
    orgUsage: "组织用量",
    orgName: "组织",
    members: "成员",
    personalUsage: "个人用量（近 30 天）",
    model: "模型",
    requests: "请求数",
    inputTokens: "输入 Token",
    outputTokens: "输出 Token",
    totalTokens: "总 Token",
    estCost: "预估成本",
    type: "类型",
    free: "免费",
    paid: "付费",
    byok: "自带密钥",
    dailyTrend: "每日趋势（近 30 天）",
    date: "日期",
    noUsage: "暂无使用数据。开始对话后即可在此查看用量。",
    quotaExceeded: "配额已超出！请升级套餐或添加自己的 API 密钥（BYOK）。",
    quotaHealthy: "配额正常",
    quotaWarning: "接近每日限额",
    addKeys: "添加 API 密钥",
    upgrade: "升级套餐",
  },
  "zh-TW": {
    title: "用量",
    subtitle: "監控您的 AI 使用量、配額和各模型成本。",
    yourQuota: "每日配額",
    used: "已使用",
    remaining: "剩餘",
    limit: "每日限額",
    plan: "方案",
    orgUsage: "組織用量",
    orgName: "組織",
    members: "成員",
    personalUsage: "個人用量（近 30 天）",
    model: "模型",
    requests: "請求數",
    inputTokens: "輸入 Token",
    outputTokens: "輸出 Token",
    totalTokens: "總 Token",
    estCost: "預估成本",
    type: "類型",
    free: "免費",
    paid: "付費",
    byok: "自帶金鑰",
    dailyTrend: "每日趨勢（近 30 天）",
    date: "日期",
    noUsage: "暫無使用數據。開始對話後即可在此查看用量。",
    quotaExceeded: "配額已超出！請升級方案或添加自己的 API 金鑰（BYOK）。",
    quotaHealthy: "配額正常",
    quotaWarning: "接近每日限額",
    addKeys: "添加 API 金鑰",
    upgrade: "升級方案",
  },
  fr: {
    title: "Utilisation",
    subtitle: "Surveillez votre utilisation IA, quotas et coûts pour tous les modèles.",
    yourQuota: "Quota Journalier",
    used: "Utilisé",
    remaining: "Restant",
    limit: "Limite Journalière",
    plan: "Forfait",
    orgUsage: "Utilisation Organisation",
    orgName: "Organisation",
    members: "Membres",
    personalUsage: "Votre Utilisation (30 derniers jours)",
    model: "Modèle",
    requests: "Requêtes",
    inputTokens: "Tokens Entrée",
    outputTokens: "Tokens Sortie",
    totalTokens: "Tokens Total",
    estCost: "Coût Est.",
    type: "Type",
    free: "Gratuit",
    paid: "Payant",
    byok: "BYOK",
    dailyTrend: "Tendance Journalière (30 jours)",
    date: "Date",
    noUsage: "Aucune donnée d'utilisation. Commencez à discuter pour voir votre utilisation ici.",
    quotaExceeded: "Quota dépassé ! Améliorez votre forfait ou ajoutez vos propres clés API (BYOK).",
    quotaHealthy: "Quota normal",
    quotaWarning: "Approche de la limite journalière",
    addKeys: "Ajouter Clés API",
    upgrade: "Améliorer Forfait",
  },
};

const PLAN_DAILY_LIMITS: Record<string, number> = {
  starter: 100,
  growth: 5000,
  scale: 50000,
  enterprise: 0,
};

const PLAN_LABELS: Record<string, string> = {
  starter: "Starter",
  growth: "Growth ($49/mo)",
  scale: "Scale ($149/mo)",
  enterprise: "Enterprise",
};

export default function UsagePage() {
  const params = useParams();
  const locale = (params.locale as Locale) || "en";
  const t = LABELS[locale] || LABELS.en;
  const { user, isLoading: userLoading } = useUser();

  const [byModel, setByModel] = useState<TokenByModel[]>([]);
  const [byDate, setByDate] = useState<TokenByDate[]>([]);
  const [quota, setQuota] = useState<QuotaInfo | null>(null);
  const [org, setOrg] = useState<OrgInfo | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    Promise.all([
      fetch("/api/token-usage").then((r) => r.json()),
      fetch("/api/usage-quota").then((r) => r.ok ? r.json() : null),
    ]).then(([tokenData, quotaData]) => {
      setByModel(tokenData.byModel || []);
      setByDate(tokenData.byDate || []);
      if (quotaData) {
        setQuota(quotaData.quota);
        setOrg(quotaData.org || null);
      }
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [user]);

  if (userLoading) return <DashboardShell user={{ email: null }}><div className="p-8 text-gray-400">{getDictionary(locale).common.loading}</div></DashboardShell>;
  if (!user) return <DashboardShell user={{ email: null }}><div className="p-8 text-gray-400">Please log in.</div></DashboardShell>;

  const quotaPct = quota ? quota.percentage : 0;
  const quotaColor = quotaPct >= 100 ? "bg-red-500" : quotaPct >= 80 ? "bg-yellow-500" : "bg-green-500";
  const quotaStatus = quotaPct >= 100 ? t.quotaExceeded : quotaPct >= 80 ? t.quotaWarning : t.quotaHealthy;

  return (
    <DashboardShell user={user}>
      <div className="p-4 md:p-8 max-w-5xl mx-auto space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{t.title}</h1>
          <p className="text-sm text-gray-500 mt-1">{t.subtitle}</p>
        </div>

        {loading ? (
          <div className="text-gray-400 py-12 text-center">{getDictionary(locale).common.loading}</div>
        ) : (
          <>
            {/* Quota Card */}
            {quota && (
              <div className="bg-white border rounded-xl p-5 space-y-4">
                <div className="flex items-center justify-between">
                  <h2 className="font-semibold text-gray-800">{t.yourQuota}</h2>
                  <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">{t.plan}: {PLAN_LABELS[quota.plan] || quota.plan}</span>
                </div>

                {/* Progress bar */}
                <div>
                  <div className="flex justify-between text-xs text-gray-500 mb-1">
                    <span>{t.used}: ${(quota.todaySpendCents / 100).toFixed(2)}</span>
                    <span>{t.limit}: {quota.dailyLimitCents === 0 ? "Unlimited" : `$${(quota.dailyLimitCents / 100).toFixed(2)}`}</span>
                  </div>
                  {quota.dailyLimitCents > 0 && (
                    <div className="w-full bg-gray-100 rounded-full h-3">
                      <div className={`h-3 rounded-full transition-all ${quotaColor}`} style={{ width: `${Math.min(quotaPct, 100)}%` }} />
                    </div>
                  )}
                  <div className={`mt-2 text-xs font-medium ${quotaPct >= 100 ? "text-red-600" : quotaPct >= 80 ? "text-yellow-600" : "text-green-600"}`}>
                    {quotaStatus}
                  </div>
                </div>

                {quotaPct >= 100 && (
                  <div className="flex gap-2 mt-2">
                    <a href={`/${locale}/dashboard/settings`} className="text-xs px-3 py-1.5 bg-gray-100 hover:bg-gray-200 rounded-lg transition">{t.addKeys}</a>
                    <a href={`/${locale}/dashboard/billing`} className="text-xs px-3 py-1.5 bg-red-600 text-white hover:bg-red-700 rounded-lg transition">{t.upgrade}</a>
                  </div>
                )}
              </div>
            )}

            {/* Org Card */}
            {org && (
              <div className="bg-white border rounded-xl p-5">
                <h2 className="font-semibold text-gray-800 mb-3">{t.orgUsage}</h2>
                <div className="grid grid-cols-3 gap-4 text-sm">
                  <div>
                    <div className="text-gray-500 text-xs">{t.orgName}</div>
                    <div className="font-medium">{org.name}</div>
                  </div>
                  <div>
                    <div className="text-gray-500 text-xs">{t.plan}</div>
                    <div className="font-medium">{PLAN_LABELS[org.plan] || org.plan}</div>
                  </div>
                  <div>
                    <div className="text-gray-500 text-xs">{t.members}</div>
                    <div className="font-medium">{org.memberCount}</div>
                  </div>
                </div>
              </div>
            )}

            {/* Usage by Model */}
            <div className="bg-white border rounded-xl p-5">
              <h2 className="font-semibold text-gray-800 mb-3">{t.personalUsage}</h2>
              {byModel.length === 0 ? (
                <p className="text-sm text-gray-400 py-4 text-center">{t.noUsage}</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-left text-gray-500 text-xs">
                        <th className="pb-2 pr-3">{t.model}</th>
                        <th className="pb-2 pr-3">{t.type}</th>
                        <th className="pb-2 pr-3 text-right">{t.requests}</th>
                        <th className="pb-2 pr-3 text-right">{t.inputTokens}</th>
                        <th className="pb-2 pr-3 text-right">{t.outputTokens}</th>
                        <th className="pb-2 text-right">{t.estCost}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {byModel.map((m) => {
                        const isFree = FREE_MODELS.has(m.model);
                        const cost = estimateCost(m.model, m.prompt_tokens, m.completion_tokens);
                        return (
                          <tr key={m.model} className="border-b border-gray-50 hover:bg-gray-50">
                            <td className="py-2 pr-3 font-medium text-gray-800">{m.model}</td>
                            <td className="py-2 pr-3">
                              <span className={`text-xs px-2 py-0.5 rounded-full ${isFree ? "bg-green-50 text-green-700" : "bg-blue-50 text-blue-700"}`}>
                                {isFree ? t.free : t.paid}
                              </span>
                            </td>
                            <td className="py-2 pr-3 text-right text-gray-600">{m.request_count}</td>
                            <td className="py-2 pr-3 text-right text-gray-600">{formatTokens(m.prompt_tokens)}</td>
                            <td className="py-2 pr-3 text-right text-gray-600">{formatTokens(m.completion_tokens)}</td>
                            <td className="py-2 text-right font-medium">{formatCost(cost)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Daily Trend */}
            {byDate.length > 0 && (
              <div className="bg-white border rounded-xl p-5">
                <h2 className="font-semibold text-gray-800 mb-3">{t.dailyTrend}</h2>
                {/* Simple bar chart */}
                <div className="space-y-1">
                  {byDate.slice(0, 14).map((d) => {
                    const maxTokens = Math.max(...byDate.map((x) => Number(x.total_tokens)));
                    const pct = maxTokens > 0 ? (Number(d.total_tokens) / maxTokens) * 100 : 0;
                    return (
                      <div key={d.date} className="flex items-center gap-3 text-xs">
                        <span className="w-20 text-gray-500 shrink-0">{new Date(d.date).toLocaleDateString(locale === "zh" || locale === "zh-TW" ? "zh-CN" : locale, { month: "short", day: "numeric" })}</span>
                        <div className="flex-1 bg-gray-100 rounded-full h-4 relative">
                          <div className="h-4 rounded-full bg-red-400 transition-all" style={{ width: `${Math.max(pct, 2)}%` }} />
                        </div>
                        <span className="w-16 text-right text-gray-600 shrink-0">{formatTokens(Number(d.total_tokens))}</span>
                        <span className="w-10 text-right text-gray-400 shrink-0">{d.request_count}r</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </DashboardShell>
  );
}
