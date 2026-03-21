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

interface EnrichmentQuota {
  service: string;
  scope: "org" | "personal";
  configured: boolean;
  used?: number;
  limit?: number;
  remaining?: number;
  plan?: string;
  resetDate?: string;
  error?: string;
  exceeded?: boolean;
}

interface StorageUsage {
  plan: string;
  database: { totalSize: string; tableCount: number; tables: { name: string; rows: number; size: string }[] };
  knowledgeBase: { docCount: number; chunkCount: number; totalTokens: number };
  embeddings: { period: string; requestCount: number; tokenCount: number; budget: number };
  blob: { configured: boolean; totalFiles: number; totalBytes: number; totalSizeMB: string };
  data: { contacts: number; leads: number; projects: number; agents: number };
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
    enrichTitle: "Enrichment Services",
    enrichDesc: "External API quota for lead enrichment tools.",
    enrichService: "Service",
    enrichPlan: "Plan",
    enrichUsed: "Used",
    enrichRemaining: "Remaining",
    enrichReset: "Resets",
    enrichNotConfigured: "Not configured",
    enrichError: "Error fetching quota",
    enrichUnit: "credits",
    enrichUnitUsd: "cents (USD)",
    enrichOrg: "Organization",
    enrichPersonal: "Personal (BYOK)",
    enrichExceeded: "Quota exceeded",
    enrichExceededTip: "This service has exceeded its quota. Update the API key or upgrade the plan.",
    enrichUpdateKey: "Update Key",
    storageTitle: "Storage & Usage",
    storageDb: "Database",
    storageKb: "Knowledge Base",
    storageBlob: "Blob Storage",
    storageEmbeddings: "Embeddings",
    storageMonthly: "monthly",
    storageNotConfigured: "Not configured",
    storageProjects: "Projects",
    storageAgents: "AI Employees",
    storageContacts: "Contacts",
    storageLeads: "Leads",
    storageDbDetail: "Database table details",
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
    enrichTitle: "数据增强服务",
    enrichDesc: "线索挖掘工具的外部 API 额度。",
    enrichService: "服务",
    enrichPlan: "套餐",
    enrichUsed: "已使用",
    enrichRemaining: "剩余",
    enrichReset: "重置日期",
    enrichNotConfigured: "未配置",
    enrichError: "获取额度失败",
    enrichUnit: "次",
    enrichUnitUsd: "美分",
    enrichOrg: "组织",
    enrichPersonal: "个人 (BYOK)",
    enrichExceeded: "额度已用完",
    enrichExceededTip: "该服务额度已耗尽，请更新 API 密钥或升级套餐。",
    enrichUpdateKey: "更新密钥",
    storageTitle: "存储与用量",
    storageDb: "数据库",
    storageKb: "知识库",
    storageBlob: "文件存储",
    storageEmbeddings: "向量化",
    storageMonthly: "月度",
    storageNotConfigured: "未配置",
    storageProjects: "项目",
    storageAgents: "AI 员工",
    storageContacts: "联系人",
    storageLeads: "线索",
    storageDbDetail: "数据库表详情",
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
    enrichTitle: "資料增強服務",
    enrichDesc: "線索挖掘工具的外部 API 額度。",
    enrichService: "服務",
    enrichPlan: "方案",
    enrichUsed: "已使用",
    enrichRemaining: "剩餘",
    enrichReset: "重置日期",
    enrichNotConfigured: "未設定",
    enrichError: "取得額度失敗",
    enrichUnit: "次",
    enrichUnitUsd: "美分",
    enrichOrg: "組織",
    enrichPersonal: "個人 (BYOK)",
    enrichExceeded: "額度已用完",
    enrichExceededTip: "該服務額度已耗盡，請更新 API 金鑰或升級方案。",
    enrichUpdateKey: "更新金鑰",
    storageTitle: "儲存與用量",
    storageDb: "資料庫",
    storageKb: "知識庫",
    storageBlob: "檔案儲存",
    storageEmbeddings: "向量化",
    storageMonthly: "月度",
    storageNotConfigured: "未設定",
    storageProjects: "專案",
    storageAgents: "AI 員工",
    storageContacts: "聯絡人",
    storageLeads: "線索",
    storageDbDetail: "資料庫表詳情",
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
    enrichTitle: "Services d'Enrichissement",
    enrichDesc: "Quota API externe pour les outils d'enrichissement de leads.",
    enrichService: "Service",
    enrichPlan: "Forfait",
    enrichUsed: "Utilisé",
    enrichRemaining: "Restant",
    enrichReset: "Réinitialisation",
    enrichNotConfigured: "Non configuré",
    enrichError: "Erreur de récupération du quota",
    enrichUnit: "crédits",
    enrichUnitUsd: "cents (USD)",
    enrichOrg: "Organisation",
    enrichPersonal: "Personnel (BYOK)",
    enrichExceeded: "Quota dépassé",
    enrichExceededTip: "Ce service a dépassé son quota. Mettez à jour la clé API ou améliorez le forfait.",
    enrichUpdateKey: "Mettre à jour",
    storageTitle: "Stockage & Utilisation",
    storageDb: "Base de données",
    storageKb: "Base de connaissances",
    storageBlob: "Stockage fichiers",
    storageEmbeddings: "Embeddings",
    storageMonthly: "mensuel",
    storageNotConfigured: "Non configuré",
    storageProjects: "Projets",
    storageAgents: "Employés IA",
    storageContacts: "Contacts",
    storageLeads: "Leads",
    storageDbDetail: "Détails des tables",
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
  growth: "Growth ($99/mo)",
  scale: "Scale ($388/mo)",
  enterprise: "Enterprise",
};

function renderEnrichCard(svc: EnrichmentQuota, t: Record<string, string>, locale: string) {
  const isApify = svc.service === "apify";
  const unit = isApify ? t.enrichUnitUsd : t.enrichUnit;
  const pct = svc.limit && svc.limit > 0 ? Math.round(((svc.used ?? 0) / svc.limit) * 100) : 0;
  const barColor = !svc.configured ? "bg-gray-300" : svc.exceeded ? "bg-red-500" : pct >= 70 ? "bg-yellow-500" : "bg-green-500";
  const displayUsed = isApify ? `$${((svc.used ?? 0) / 100).toFixed(2)}` : String(svc.used ?? 0);
  const displayLimit = isApify ? `$${((svc.limit ?? 0) / 100).toFixed(2)}` : String(svc.limit ?? "–");

  return (
    <div key={`${svc.service}-${svc.scope}`} className={`border rounded-lg p-3 ${svc.exceeded ? "border-red-200 bg-red-50/30" : "border-gray-100"}`}>
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-medium text-gray-800 capitalize">{svc.service}</span>
        {svc.configured ? (
          svc.exceeded ? (
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-red-100 text-red-700">{t.enrichExceeded}</span>
          ) : (
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-green-50 text-green-700">{svc.plan || "Active"}</span>
          )
        ) : (
          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-500">{t.enrichNotConfigured}</span>
        )}
      </div>
      {svc.error ? (
        <p className="text-xs text-red-500">{t.enrichError}: {svc.error}</p>
      ) : svc.configured ? (
        <>
          <div className="w-full bg-gray-100 rounded-full h-2 mb-2">
            <div className={`h-2 rounded-full transition-all ${barColor}`} style={{ width: `${Math.min(pct, 100)}%` }} />
          </div>
          <div className="flex justify-between text-[11px] text-gray-500">
            <span>{t.enrichUsed}: {displayUsed}</span>
            <span>{t.enrichRemaining}: {svc.remaining != null ? (isApify ? `$${(svc.remaining / 100).toFixed(2)}` : svc.remaining) : "–"}</span>
          </div>
          {svc.limit != null && (
            <div className="text-[10px] text-gray-400 mt-1">
              {t.limit}: {displayLimit} {!isApify ? unit : ""}
              {svc.resetDate && <> · {t.enrichReset}: {svc.resetDate}</>}
            </div>
          )}
          {svc.exceeded && (
            <a href={`/${locale}/dashboard/settings`} className="inline-block mt-2 text-[11px] px-2 py-1 bg-red-600 text-white rounded hover:bg-red-700 transition">
              {t.enrichUpdateKey}
            </a>
          )}
        </>
      ) : (
        <p className="text-xs text-gray-400">{t.enrichNotConfigured}</p>
      )}
    </div>
  );
}

export default function UsagePage() {
  const params = useParams();
  const locale = (params.locale as Locale) || "en";
  const t = LABELS[locale] || LABELS.en;
  const { user, isLoading: userLoading } = useUser();

  const [byModel, setByModel] = useState<TokenByModel[]>([]);
  const [byDate, setByDate] = useState<TokenByDate[]>([]);
  const [quota, setQuota] = useState<QuotaInfo | null>(null);
  const [org, setOrg] = useState<OrgInfo | null>(null);
  const [enrichOrg, setEnrichOrg] = useState<EnrichmentQuota[]>([]);
  const [enrichPersonal, setEnrichPersonal] = useState<EnrichmentQuota[]>([]);
  const [enrichUsage, setEnrichUsage] = useState<{ provider: string; total_calls: number; total_results: number; errors: number; quota_exceeded: number }[]>([]);
  const [storage, setStorage] = useState<StorageUsage | null>(null);
  const [loading, setLoading] = useState(true);

  function refreshEnrichment() {
    fetch("/api/enrichment-quota").then((r) => r.ok ? r.json() : null).then((data) => {
      if (data) {
        setEnrichOrg(data.org || []);
        setEnrichPersonal(data.personal || []);
        setEnrichUsage(data.usage || []);
      }
    });
  }

  useEffect(() => {
    if (!user) return;
    Promise.all([
      fetch("/api/token-usage").then((r) => r.json()),
      fetch("/api/usage-quota").then((r) => r.ok ? r.json() : null),
      fetch("/api/enrichment-quota").then((r) => r.ok ? r.json() : null),
      fetch("/api/storage-usage").then((r) => r.ok ? r.json() : null),
    ]).then(([tokenData, quotaData, enrichData, storageData]) => {
      setByModel(tokenData.byModel || []);
      setByDate(tokenData.byDate || []);
      if (quotaData) {
        setQuota(quotaData.quota);
        setOrg(quotaData.org || null);
      }
      if (enrichData) {
        setEnrichOrg(enrichData.org || []);
        setEnrichPersonal(enrichData.personal || []);
        setEnrichUsage(enrichData.usage || []);
      }
      if (storageData) setStorage(storageData);
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

            {/* Enrichment Services Quota */}
            {(enrichOrg.length > 0 || enrichPersonal.length > 0) && (
              <div className="bg-white border rounded-xl p-5 space-y-5">
                <div>
                  <h2 className="font-semibold text-gray-800">{t.enrichTitle}</h2>
                  <p className="text-xs text-gray-500 mt-0.5">{t.enrichDesc}</p>
                </div>

                {/* Exceeded warning banner */}
                {[...enrichOrg, ...enrichPersonal].some((s) => s.exceeded) && (
                  <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 flex items-start gap-3">
                    <svg className="w-5 h-5 text-red-500 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <div className="flex-1">
                      <p className="text-sm font-medium text-red-800">{t.enrichExceeded}</p>
                      <p className="text-xs text-red-600 mt-0.5">{t.enrichExceededTip}</p>
                    </div>
                    <a href={`/${locale}/dashboard/settings`} className="shrink-0 text-xs px-3 py-1.5 bg-red-600 text-white hover:bg-red-700 rounded-lg transition">
                      {t.enrichUpdateKey}
                    </a>
                  </div>
                )}

                {/* Org-level */}
                {enrichOrg.length > 0 && (
                  <div>
                    <h3 className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">{t.enrichOrg}</h3>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {enrichOrg.map((svc) => renderEnrichCard(svc, t, locale))}
                    </div>
                  </div>
                )}

                {/* Personal BYOK */}
                {enrichPersonal.length > 0 && (
                  <div>
                    <h3 className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">{t.enrichPersonal}</h3>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {enrichPersonal.map((svc) => renderEnrichCard(svc, t, locale))}
                    </div>
                  </div>
                )}

                {/* Internal usage stats (last 30 days) */}
                {enrichUsage.length > 0 && (
                  <div>
                    <h3 className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">{t.enrichUsageTitle || "Your Usage (30 days)"}</h3>
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="text-left text-gray-400 border-b border-gray-100">
                            <th className="py-1.5 pr-3">{t.enrichService}</th>
                            <th className="py-1.5 pr-3 text-right">{t.enrichUsageCalls || "Calls"}</th>
                            <th className="py-1.5 pr-3 text-right">{t.enrichUsageResults || "Results"}</th>
                            <th className="py-1.5 pr-3 text-right">{t.enrichUsageErrors || "Errors"}</th>
                            <th className="py-1.5 text-right">{t.enrichUsageExceeded || "Quota Hit"}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {enrichUsage.map((u) => (
                            <tr key={u.provider} className="border-b border-gray-50">
                              <td className="py-1.5 pr-3 font-medium text-gray-700 capitalize">{u.provider}</td>
                              <td className="py-1.5 pr-3 text-right text-gray-600">{u.total_calls}</td>
                              <td className="py-1.5 pr-3 text-right text-gray-600">{u.total_results}</td>
                              <td className="py-1.5 pr-3 text-right">{u.errors > 0 ? <span className="text-red-500">{u.errors}</span> : <span className="text-gray-400">0</span>}</td>
                              <td className="py-1.5 text-right">{u.quota_exceeded > 0 ? <span className="text-red-500">{u.quota_exceeded}</span> : <span className="text-gray-400">0</span>}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                <div className="flex justify-end">
                  <button
                    onClick={refreshEnrichment}
                    className="text-xs text-gray-500 hover:text-gray-700 px-3 py-1.5 border border-gray-200 rounded-lg hover:bg-gray-50 transition cursor-pointer"
                  >
                    ↻ {t.enrichReset || "Refresh"}
                  </button>
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

            {/* Storage & Usage */}
            {storage && (
              <div className="bg-white border rounded-xl p-5">
                <h2 className="font-semibold text-gray-800 mb-4">{t.storageTitle}</h2>
                {/* Summary cards */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
                  <div className="bg-gray-50 rounded-lg border border-gray-200 p-3">
                    <p className="text-xs text-gray-400">{t.storageDb}</p>
                    <p className="text-lg font-bold text-gray-900">{storage.database.totalSize}</p>
                    <p className="text-xs text-gray-400">{storage.database.tableCount} tables</p>
                  </div>
                  <div className="bg-gray-50 rounded-lg border border-gray-200 p-3">
                    <p className="text-xs text-gray-400">{t.storageKb}</p>
                    <p className="text-lg font-bold text-gray-900">{storage.knowledgeBase.docCount} <span className="text-sm font-normal text-gray-400">docs</span></p>
                    <p className="text-xs text-gray-400">{storage.knowledgeBase.chunkCount} chunks / ~{Math.round(storage.knowledgeBase.totalTokens / 1000)}K tokens</p>
                  </div>
                  <div className="bg-gray-50 rounded-lg border border-gray-200 p-3">
                    <p className="text-xs text-gray-400">{t.storageBlob}</p>
                    {storage.blob.configured ? (
                      <>
                        <p className="text-lg font-bold text-gray-900">{storage.blob.totalSizeMB} <span className="text-sm font-normal text-gray-400">MB</span></p>
                        <p className="text-xs text-gray-400">{storage.blob.totalFiles} files</p>
                      </>
                    ) : (
                      <p className="text-sm text-gray-400">{t.storageNotConfigured}</p>
                    )}
                  </div>
                  <div className="bg-gray-50 rounded-lg border border-gray-200 p-3">
                    <p className="text-xs text-gray-400">{t.storageEmbeddings}</p>
                    <p className="text-lg font-bold text-gray-900">{(storage.embeddings.requestCount / 1000).toFixed(1)}K</p>
                    <p className="text-xs text-gray-400">/ {(storage.embeddings.budget / 1000).toFixed(0)}K {t.storageMonthly}</p>
                    {storage.embeddings.budget > 0 && (
                      <div className="mt-1.5 h-1.5 bg-gray-200 rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full ${storage.embeddings.requestCount / storage.embeddings.budget > 0.8 ? "bg-red-500" : "bg-green-500"}`}
                          style={{ width: `${Math.min(100, (storage.embeddings.requestCount / storage.embeddings.budget) * 100)}%` }}
                        />
                      </div>
                    )}
                  </div>
                </div>

                {/* Data counts */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
                  {[
                    { label: t.storageProjects, value: storage.data.projects },
                    { label: t.storageAgents, value: storage.data.agents },
                    { label: t.storageContacts, value: storage.data.contacts },
                    { label: t.storageLeads, value: storage.data.leads },
                  ].map((item) => (
                    <div key={item.label} className="text-center p-2 bg-gray-50 rounded-lg border border-gray-100">
                      <p className="text-lg font-bold text-gray-900">{item.value.toLocaleString()}</p>
                      <p className="text-xs text-gray-400">{item.label}</p>
                    </div>
                  ))}
                </div>

                {/* Database tables detail */}
                {storage.database.tables.length > 0 && (
                  <details className="text-sm">
                    <summary className="text-xs text-gray-400 cursor-pointer hover:text-gray-600">{t.storageDbDetail}</summary>
                    <div className="mt-2 overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="text-left text-gray-400 border-b border-gray-100">
                            <th className="py-1.5 pr-4">Table</th>
                            <th className="py-1.5 pr-4 text-right">Rows</th>
                            <th className="py-1.5 text-right">Size</th>
                          </tr>
                        </thead>
                        <tbody>
                          {storage.database.tables.map((tbl) => (
                            <tr key={tbl.name} className="border-b border-gray-50">
                              <td className="py-1.5 pr-4 font-mono text-gray-600">{tbl.name}</td>
                              <td className="py-1.5 pr-4 text-right text-gray-500">{tbl.rows.toLocaleString()}</td>
                              <td className="py-1.5 text-right text-gray-500">{tbl.size}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </details>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </DashboardShell>
  );
}
