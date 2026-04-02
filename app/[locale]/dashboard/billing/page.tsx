"use client";

import { useUser } from "@auth0/nextjs-auth0/client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { getDictionary, type Locale } from "@/lib/i18n";
import DashboardShell from "@/components/DashboardShell";

interface Payment {
  order_no: string;
  transaction_id: string | null;
  payment_method: string;
  amount: number;
  currency: string;
  status: string;
  plan: string | null;
  paid_at: string | null;
  created_at: string;
}

interface Invoice {
  id: string;
  number: string | null;
  status: string | null;
  amount_due: number;
  amount_paid: number;
  currency: string;
  created: number;
  hosted_invoice_url: string | null;
  invoice_pdf: string | null;
  description: string;
}

interface Subscription {
  id: string;
  status: string;
  current_period_start: number;
  current_period_end: number;
  plan: string;
  amount: number | null;
  interval: string;
  cancel_at_period_end: boolean;
}

interface TokenSummary {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  request_count: number;
}

interface TokenByModel {
  model: string;
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

function formatCurrency(amount: number, currency: string) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency.toUpperCase(),
  }).format(amount / 100);
}

function formatDate(timestamp: number) {
  return new Date(timestamp * 1000).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function formatNumber(n: number) {
  return new Intl.NumberFormat("en-US").format(n);
}

// Retail pricing per 1M tokens [input, output]
// Includes API cost + compute/infrastructure overhead
const MODEL_PRICING: Record<string, [number, number]> = {
  // Premium models — API + compute
  "anthropic/claude-sonnet-4.5": [15, 75],
  "anthropic/claude-haiku-3.5": [4, 20],
  "anthropic/claude-opus-4": [75, 375],
  "openai/gpt-4o": [12.5, 50],
  "openai/gpt-4o-mini": [0.75, 3],
  "openai/gpt-oss-120b": [0.30, 0.30],
  // Open models — compute cost only
  "meta/llama-3.3-70b": [0.20, 0.20],
  "meta/llama-3.1-8b": [0.05, 0.05],
  "alibaba/qwen-3-235b": [0.15, 0.15],
  "alibaba/qwen-2.5-3b": [0.05, 0.05],
  "alibaba/qwen-2.5-7b": [0.10, 0.10],
  "google/gemini-2.0-flash": [0.05, 0.05],
};

function estimateCost(model: string, promptTokens: number, completionTokens: number): number {
  const pricing = MODEL_PRICING[model];
  if (!pricing) return 0;
  return (promptTokens / 1_000_000) * pricing[0] + (completionTokens / 1_000_000) * pricing[1];
}

function formatCost(cost: number): string {
  if (cost === 0) return "—";
  if (cost < 0.01) return "<$0.01";
  return `$${cost.toFixed(2)}`;
}

const BILLING_STATUS_LABELS: Record<string, Record<string, string>> = {
  en: { paid: "Paid", open: "Open", active: "Active", draft: "Draft", void: "Void", uncollectible: "Uncollectible", past_due: "Past Due", canceled: "Canceled", trialing: "Trial", paused: "Paused", unknown: "Unknown" },
  zh: { paid: "已支付", open: "待支付", active: "生效中", draft: "草稿", void: "已作废", uncollectible: "无法收回", past_due: "逾期", canceled: "已取消", trialing: "试用中", paused: "已暂停", unknown: "未知" },
};

function statusBadge(status: string | null, locale = "en") {
  const colors: Record<string, string> = {
    paid: "bg-green-100 text-green-700",
    open: "bg-yellow-100 text-yellow-700",
    active: "bg-green-100 text-green-700",
    draft: "bg-gray-100 text-gray-600",
    void: "bg-red-100 text-red-700",
    uncollectible: "bg-red-100 text-red-700",
    past_due: "bg-red-100 text-red-700",
    canceled: "bg-gray-100 text-gray-600",
    trialing: "bg-red-100 text-red-700",
    paused: "bg-yellow-100 text-yellow-700",
  };
  const s = status || "unknown";
  const label = BILLING_STATUS_LABELS[locale]?.[s] || BILLING_STATUS_LABELS.en[s] || s;
  return (
    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${colors[s] || "bg-gray-100 text-gray-600"}`}>
      {label}
    </span>
  );
}

export default function BillingPage() {
  const params = useParams();
  const locale = (params.locale as Locale) || "en";
  const dict = getDictionary(locale);
  const td = dict.dashboard;
  const tc = dict.common;
  const tl = dict.landing;

  const { user, isLoading: userLoading } = useUser();
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [userPlan, setUserPlan] = useState<string>("starter");
  const [loading, setLoading] = useState(true);
  const [tokenSummary, setTokenSummary] = useState<TokenSummary | null>(null);
  const [tokenByModel, setTokenByModel] = useState<TokenByModel[]>([]);
  const [tokenByDate, setTokenByDate] = useState<TokenByDate[]>([]);
  // const [upgrading, setUpgrading] = useState<string | null>(null);
  const [apiKeys, setApiKeys] = useState<{ service: string; masked_key: string }[]>([]);
  const [budgetLimit, setBudgetLimit] = useState<string>("");
  const [totalBudgetLimit, setTotalBudgetLimit] = useState<string>("");
  const [alertThresholds, setAlertThresholds] = useState<boolean[]>([false, true, true]); // 50%, 80%, 100%
  const [autoPause, setAutoPause] = useState(true);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [budgetSaving, setBudgetSaving] = useState(false);
  const [budgetMsg, setBudgetMsg] = useState("");

  useEffect(() => {
    if (!user) return;
    setLoading(true);
    const fetchBilling = fetch("/api/invoices").then((r) => r.json()).catch(() => ({}));
    const fetchTokens = fetch("/api/token-usage").then((r) => r.json()).catch(() => ({}));
    const fetchKeys = fetch("/api/api-keys").then((r) => r.json()).catch(() => ({}));
    const fetchBudget = fetch("/api/budget").then((r) => r.json()).catch(() => ({}));
    const fetchPayments = fetch("/api/payments").then((r) => r.json()).catch(() => ({}));
    Promise.all([fetchBilling, fetchTokens, fetchKeys, fetchBudget, fetchPayments])
      .then(([billingData, tokenData, keyData, budgetData, paymentData]) => {
        setPayments(paymentData.payments || []);
        setInvoices(billingData.invoices || []);
        setSubscriptions(billingData.subscriptions || []);
        if (billingData.userPlan) setUserPlan(billingData.userPlan);
        setTokenSummary(tokenData.summary || null);
        setTokenByModel(tokenData.byModel || []);
        setApiKeys(keyData.keys || []);
        setTokenByDate(tokenData.byDate || []);
        if (budgetData.monthly_limit != null) setBudgetLimit(String(budgetData.monthly_limit));
        if (budgetData.total_limit != null) setTotalBudgetLimit(String(budgetData.total_limit));
        if (budgetData.alert_thresholds) setAlertThresholds([50, 80, 100].map((v) => budgetData.alert_thresholds.includes(v)));
        if (budgetData.auto_pause != null) setAutoPause(budgetData.auto_pause);
      })
      .finally(() => setLoading(false));
  }, [user]);

  if (userLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <p className="text-gray-500">{tc.loading}</p>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <h1 className="text-2xl font-bold mb-4">{td.signInDashboard}</h1>
          <a href={`/auth/login?returnTo=/${locale}/dashboard/reports`} className="bg-red-800 hover:bg-red-900 text-white px-6 py-3 rounded-lg font-medium transition-colors">{tc.logIn}</a>
        </div>
      </div>
    );
  }

  return (
    <DashboardShell user={user}>
      <div className="px-4 sm:px-6 py-6 w-full">
        <h1 className="text-2xl font-bold mb-6">{tc.billing}</h1>

        {loading ? (
          <p className="text-gray-500">{tc.loading}</p>
        ) : (
          <>
            {/* Current Plan & Available Plans */}
            {(() => {
              const plans = [
                {
                  key: "starter",
                  name: tl.planStarter,
                  price: tl.planStarterPrice,
                  desc: tl.planStarterDesc,
                  features: [tl.feat2Agents, tl.feat100Emails, tl.feat1Project, tl.featFreeModels, tl.featBYOK],
                  color: "border-gray-300",
                  badge: "bg-gray-200 text-gray-700",
                  cta: null,
                },
                {
                  key: "growth",
                  name: tl.planGrowth,
                  price: tl.planGrowthPrice,
                  desc: tl.planGrowthDesc,
                  features: [tl.feat10Agents, tl.feat2000Emails, tl.feat5Projects],
                  color: "border-emerald-400",
                  badge: "bg-emerald-100 text-emerald-700",
                  cta: "growth",
                },
                {
                  key: "scale",
                  name: tl.planScale,
                  price: tl.planScalePrice,
                  desc: tl.planScaleDesc,
                  features: [tl.featUnlimitedAgents, tl.feat10000Emails, tl.featUnlimitedProjects, tl.featCustomAgent],
                  color: "border-purple-400",
                  badge: "bg-purple-100 text-purple-700",
                  cta: "scale",
                },
                {
                  key: "enterprise",
                  name: tl.planEnterprise,
                  price: tl.planEnterprisePrice,
                  desc: tl.planEnterpriseDesc,
                  features: [tl.featUnlimitedAgents, tl.featUnlimitedProjects, tl.featDedicated, tl.featDedicatedInfra, tl.featCustomTraining],
                  color: "border-amber-400",
                  badge: "bg-amber-100 text-amber-700",
                  cta: "enterprise",
                },
              ];
              const currentPlan = plans.find((p) => p.key === userPlan) || plans[0];
              // const otherPlans = plans.filter((p) => p.key !== userPlan);

              return (
                <>
                  {/* Current Plan */}
                  <section className="mb-8">
                    <h2 className="text-lg font-semibold mb-4">{td.yourCurrentPlan}</h2>
                    <div className={`bg-white rounded-lg border-2 ${currentPlan.color} p-6`}>
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
                        <div>
                          <div className="flex items-center gap-2 mb-1">
                            <h3 className="text-xl font-bold">{currentPlan.name}</h3>
                            <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${currentPlan.badge}`}>{td.currentPlanBadge}</span>
                          </div>
                          <p className="text-sm text-gray-500">{currentPlan.desc}</p>
                        </div>
                        {/* Price hidden */}
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {currentPlan.features.map((feat, i) => (
                          <span key={i} className="inline-flex items-center gap-1 text-xs bg-gray-50 text-gray-600 px-2.5 py-1 rounded-full">
                            <svg className="w-3.5 h-3.5 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                            {feat}
                          </span>
                        ))}
                      </div>
                      {/* Token usage summary inline */}
                      {tokenSummary && Number(tokenSummary.total_tokens) > 0 && (
                        <div className="mt-4 pt-4 border-t border-gray-100 grid grid-cols-2 sm:grid-cols-4 gap-3">
                          <div>
                            <p className="text-xs text-gray-400">{td.totalTokens}</p>
                            <p className="text-sm font-semibold">{formatNumber(Number(tokenSummary.total_tokens))}</p>
                          </div>
                          <div>
                            <p className="text-xs text-gray-400">{td.promptTokens}</p>
                            <p className="text-sm font-semibold">{formatNumber(Number(tokenSummary.prompt_tokens))}</p>
                          </div>
                          <div>
                            <p className="text-xs text-gray-400">{td.completionTokens}</p>
                            <p className="text-sm font-semibold">{formatNumber(Number(tokenSummary.completion_tokens))}</p>
                          </div>
                          <div>
                            <p className="text-xs text-gray-400">{td.requests}</p>
                            <p className="text-sm font-semibold">{formatNumber(Number(tokenSummary.request_count))}</p>
                          </div>
                        </div>
                      )}
                    </div>
                  </section>

                  {/* Available Plans — hidden */}
                </>
              );
            })()}

            {/* BYOK Section */}
            <section className="mb-8">
              <h2 className="text-lg font-semibold mb-4">{td.byokSectionTitle}</h2>
              <div className="bg-white rounded-lg border border-gray-200 p-6">
                <p className="text-sm text-gray-500 mb-4">{td.byokSectionDesc}</p>
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-4">
                  {([
                    { service: "openai", name: "OpenAI" },
                    { service: "anthropic", name: "Anthropic" },
                    { service: "google", name: "Google Gemini" },
                    { service: "alibaba", name: "Alibaba Qwen" },
                    { service: "vercel", name: "Vercel AI Gateway" },
                    { service: "clawhub", name: "ClawHub" },
                    { service: "twitter", name: "X (Twitter)", multi: ["twitter_api_key", "twitter_api_secret", "twitter_access_token", "twitter_access_token_secret"] },
                  ]).map((svc) => {
                    const configured = svc.multi ? svc.multi.every((s: string) => apiKeys.some((k) => k.service === s)) : apiKeys.some((k) => k.service === svc.service);
                    return (
                      <div key={svc.service} className={`rounded-lg border p-3 ${configured ? "border-green-200 bg-green-50" : "border-gray-200 bg-gray-50"}`}>
                        <p className="text-sm font-medium">{svc.name}</p>
                        <p className={`text-xs mt-1 ${configured ? "text-green-600" : "text-gray-400"}`}>
                          {configured ? `✓ ${td.byokConfigured}` : "—"}
                        </p>
                      </div>
                    );
                  })}
                </div>
                <Link href={`/${locale}/dashboard/settings`} className="text-sm text-red-600 hover:text-red-700 font-medium">
                  {td.byokManageKeys} →
                </Link>
              </div>
            </section>

            {/* Budget Controls Section */}
            <section className="mb-8">
              <h2 className="text-lg font-semibold mb-4">{td.budgetTitle}</h2>
              <div className="bg-white rounded-lg border border-gray-200 p-6">
                <p className="text-sm text-gray-500 mb-5">{td.budgetDesc}</p>

                {/* Budget overview bar */}
                {(() => {
                  const totalCost = tokenByModel.reduce((sum, row) => sum + estimateCost(row.model, Number(row.prompt_tokens), Number(row.completion_tokens)), 0);
                  const limit = budgetLimit ? parseFloat(budgetLimit) : 0;
                  const pct = limit > 0 ? Math.min((totalCost / limit) * 100, 100) : 0;
                  const barColor = !limit ? "bg-gray-200" : pct >= 100 ? "bg-red-500" : pct >= 80 ? "bg-amber-500" : "bg-emerald-500";
                  const statusLabel = !limit ? td.noBudgetSet : pct >= 100 ? td.budgetExceeded : pct >= 80 ? td.budgetWarning : td.budgetHealthy;
                  const statusColor = !limit ? "text-gray-400" : pct >= 100 ? "text-red-600" : pct >= 80 ? "text-amber-600" : "text-emerald-600";

                  return (
                    <div className="mb-6 p-4 bg-gray-50 rounded-lg border border-gray-100">
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <span className={`text-sm font-medium ${statusColor}`}>{statusLabel}</span>
                        </div>
                        <span className="text-xs text-gray-400">{td.budgetReset}</span>
                      </div>
                      <div className="flex items-end justify-between mb-2">
                        <div>
                          <span className="text-2xl font-bold">{formatCost(totalCost)}</span>
                          {limit > 0 && <span className="text-sm text-gray-400 ml-1">/ ${limit.toFixed(2)}</span>}
                        </div>
                        {limit > 0 && (
                          <span className="text-sm text-gray-500">{td.budgetRemaining}: {formatCost(Math.max(limit - totalCost, 0))}</span>
                        )}
                      </div>
                      <div className="w-full bg-gray-200 rounded-full h-3">
                        <div className={`${barColor} h-3 rounded-full transition-all`} style={{ width: `${limit > 0 ? pct : 0}%` }} />
                      </div>
                      {limit > 0 && (
                        <p className="text-xs text-gray-400 mt-1 text-right">{pct.toFixed(1)}% {td.budgetUsed}</p>
                      )}
                    </div>
                  );
                })()}

                {/* Total budget bar */}
                {(() => {
                  const totalCost = tokenByModel.reduce((sum, row) => sum + estimateCost(row.model, Number(row.prompt_tokens), Number(row.completion_tokens)), 0);
                  const totalCap = totalBudgetLimit ? parseFloat(totalBudgetLimit) : 0;
                  const totalPct = totalCap > 0 ? Math.min((totalCost / totalCap) * 100, 100) : 0;
                  const totalBarColor = !totalCap ? "bg-gray-200" : totalPct >= 100 ? "bg-red-500" : totalPct >= 80 ? "bg-amber-500" : "bg-blue-500";

                  return totalCap > 0 ? (
                    <div className="mb-6 p-4 bg-blue-50/50 rounded-lg border border-blue-100">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-sm font-medium text-blue-700">{td.totalBudget}</span>
                        <span className="text-xs text-gray-400">{td.totalSpend}</span>
                      </div>
                      <div className="flex items-end justify-between mb-2">
                        <div>
                          <span className="text-2xl font-bold">{formatCost(totalCost)}</span>
                          <span className="text-sm text-gray-400 ml-1">/ ${totalCap.toFixed(2)}</span>
                        </div>
                        <span className="text-sm text-gray-500">{td.budgetRemaining}: {formatCost(Math.max(totalCap - totalCost, 0))}</span>
                      </div>
                      <div className="w-full bg-blue-100 rounded-full h-3">
                        <div className={`${totalBarColor} h-3 rounded-full transition-all`} style={{ width: `${totalPct}%` }} />
                      </div>
                      <p className="text-xs text-gray-400 mt-1 text-right">{totalPct.toFixed(1)}% {td.budgetUsed}</p>
                      {totalPct >= 100 && (
                        <p className="text-xs text-red-600 font-medium mt-2">{td.totalBudgetExceeded}</p>
                      )}
                    </div>
                  ) : null;
                })()}

                {/* Budget limit inputs */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1.5">{td.monthlyBudget}</label>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">$</span>
                      <input
                        type="number"
                        min="0"
                        step="10"
                        value={budgetLimit}
                        onChange={(e) => setBudgetLimit(e.target.value)}
                        placeholder={td.budgetPlaceholder}
                        className="w-full border border-gray-300 rounded-lg pl-7 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent"
                      />
                    </div>
                    <p className="text-xs text-gray-400 mt-1">{!budgetLimit ? td.budgetUnlimited : `$${parseFloat(budgetLimit || "0").toFixed(2)} / ${td.billingCycleMonthly.replace("/", "")}`}</p>
                  </div>

                  {/* Total budget input */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1.5">{td.totalBudget}</label>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">$</span>
                      <input
                        type="number"
                        min="0"
                        step="100"
                        value={totalBudgetLimit}
                        onChange={(e) => setTotalBudgetLimit(e.target.value)}
                        placeholder={td.totalBudgetPlaceholder}
                        className="w-full border border-gray-300 rounded-lg pl-7 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent"
                      />
                    </div>
                    <p className="text-xs text-gray-400 mt-1">{!totalBudgetLimit ? td.totalBudgetUnlimited : td.totalBudgetDesc}</p>
                  </div>
                </div>

                {/* Alert thresholds */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 mt-6">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1.5">{td.alertThresholds}</label>
                    <p className="text-xs text-gray-400 mb-2">{td.alertDesc}</p>
                    <div className="flex flex-col gap-2">
                      {[50, 80, 100].map((pct, i) => (
                        <label key={pct} className="flex items-center gap-2 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={alertThresholds[i]}
                            onChange={() => {
                              const next = [...alertThresholds];
                              next[i] = !next[i];
                              setAlertThresholds(next);
                            }}
                            className="rounded border-gray-300 text-red-600 focus:ring-red-500"
                          />
                          <span className="text-sm text-gray-600">{td.alertAt} {pct}%</span>
                        </label>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Auto-pause toggle */}
                <div className="mt-6 pt-5 border-t border-gray-100">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <h4 className="text-sm font-medium text-gray-700">{td.autoPause}</h4>
                      <p className="text-xs text-gray-400 mt-0.5">{td.autoPauseDesc}</p>
                    </div>
                    <button
                      onClick={() => setAutoPause(!autoPause)}
                      className={`relative shrink-0 inline-flex h-6 w-11 items-center rounded-full transition-colors cursor-pointer ${autoPause ? "bg-red-600" : "bg-gray-300"}`}
                    >
                      <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${autoPause ? "translate-x-6" : "translate-x-1"}`} />
                    </button>
                  </div>
                  <p className={`text-xs mt-2 ${autoPause ? "text-red-600" : "text-gray-400"}`}>
                    {autoPause ? td.autoPauseEnabled : td.autoPauseDisabled}
                  </p>
                </div>

                {/* Save button */}
                <div className="mt-5 flex items-center gap-3">
                  <button
                    onClick={async () => {
                      setBudgetSaving(true);
                      setBudgetMsg("");
                      try {
                        await fetch("/api/budget", {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({
                            monthly_limit: budgetLimit ? parseFloat(budgetLimit) : null,
                            total_limit: totalBudgetLimit ? parseFloat(totalBudgetLimit) : null,
                            alert_thresholds: [50, 80, 100].filter((_, i) => alertThresholds[i]),
                            auto_pause: autoPause,
                          }),
                        });
                        setBudgetMsg(td.budgetSaved);
                        setTimeout(() => setBudgetMsg(""), 3000);
                      } catch {
                        setBudgetMsg("Error");
                      } finally {
                        setBudgetSaving(false);
                      }
                    }}
                    disabled={budgetSaving}
                    className="bg-red-800 hover:bg-red-900 disabled:opacity-50 text-white px-5 py-2 rounded-lg text-sm font-medium transition-colors cursor-pointer"
                  >
                    {budgetSaving ? "..." : td.saveBudget}
                  </button>
                  {budgetMsg && <span className="text-sm text-green-600">{budgetMsg}</span>}
                </div>
              </div>
            </section>

            {/* Token Usage Section */}
            <section className="mb-8">
              <h2 className="text-lg font-semibold mb-4">{td.tokenUsage}</h2>
              {!tokenSummary || Number(tokenSummary.total_tokens) === 0 ? (
                <div className="bg-white rounded-lg border border-gray-200 p-6 text-center">
                  <p className="text-gray-500">{td.noTokenUsage}</p>
                </div>
              ) : (
                <>
                  {/* Summary Cards */}
                  {(() => {
                    const totalCost = tokenByModel.reduce((sum, row) => sum + estimateCost(row.model, Number(row.prompt_tokens), Number(row.completion_tokens)), 0);
                    return (
                      <div className="grid grid-cols-2 sm:grid-cols-5 gap-4 mb-4">
                        <div className="bg-white rounded-lg border border-gray-200 p-4">
                          <p className="text-xs text-gray-500 mb-1">{td.estCost}</p>
                          <p className="text-xl font-bold text-red-600">{formatCost(totalCost)}</p>
                        </div>
                        <div className="bg-white rounded-lg border border-gray-200 p-4">
                          <p className="text-xs text-gray-500 mb-1">{td.totalTokens}</p>
                          <p className="text-xl font-bold text-gray-900">{formatNumber(Number(tokenSummary.total_tokens))}</p>
                        </div>
                        <div className="bg-white rounded-lg border border-gray-200 p-4">
                          <p className="text-xs text-gray-500 mb-1">{td.promptTokens}</p>
                          <p className="text-xl font-bold text-gray-900">{formatNumber(Number(tokenSummary.prompt_tokens))}</p>
                        </div>
                        <div className="bg-white rounded-lg border border-gray-200 p-4">
                          <p className="text-xs text-gray-500 mb-1">{td.completionTokens}</p>
                          <p className="text-xl font-bold text-gray-900">{formatNumber(Number(tokenSummary.completion_tokens))}</p>
                        </div>
                        <div className="bg-white rounded-lg border border-gray-200 p-4">
                          <p className="text-xs text-gray-500 mb-1">{td.requests}</p>
                          <p className="text-xl font-bold text-gray-900">{formatNumber(Number(tokenSummary.request_count))}</p>
                        </div>
                      </div>
                    );
                  })()}

                  {/* Usage by Provider/Model */}
                  {tokenByModel.length > 0 && (
                    <div className="bg-white rounded-lg border border-gray-200 overflow-hidden mb-4">
                      <div className="px-4 py-3 bg-gray-50 border-b border-gray-200">
                        <h3 className="text-sm font-medium text-gray-600">{td.usageByModel}</h3>
                      </div>
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="border-b border-gray-100">
                              <th className="text-left px-4 py-2 font-medium text-gray-500">{td.model}</th>
                              <th className="text-right px-4 py-2 font-medium text-gray-500">{td.totalTokens}</th>
                              <th className="text-right px-4 py-2 font-medium text-gray-500">{td.requests}</th>
                              <th className="text-right px-4 py-2 font-medium text-gray-500">{td.estCost}</th>
                            </tr>
                          </thead>
                          <tbody>
                            {tokenByModel.map((row, i) => {
                              const cost = estimateCost(row.model, Number(row.prompt_tokens), Number(row.completion_tokens));
                              return (
                              <tr key={i} className="border-b border-gray-50 last:border-0">
                                <td className="px-4 py-2 font-medium">{row.model}</td>
                                <td className="px-4 py-2 text-right">{formatNumber(Number(row.total_tokens))}</td>
                                <td className="px-4 py-2 text-right text-gray-500">{formatNumber(Number(row.request_count))}</td>
                                <td className="px-4 py-2 text-right font-medium text-red-600">{formatCost(cost)}</td>
                              </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}

                  {/* Daily Usage (Last 30 Days) */}
                  {tokenByDate.length > 0 && (
                    <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
                      <div className="px-4 py-3 bg-gray-50 border-b border-gray-200">
                        <h3 className="text-sm font-medium text-gray-600">{td.last30Days}</h3>
                      </div>
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="border-b border-gray-100">
                              <th className="text-left px-4 py-2 font-medium text-gray-500">{td.date}</th>
                              <th className="text-right px-4 py-2 font-medium text-gray-500">{td.totalTokens}</th>
                              <th className="text-right px-4 py-2 font-medium text-gray-500">{td.requests}</th>
                            </tr>
                          </thead>
                          <tbody>
                            {tokenByDate.map((row) => (
                              <tr key={row.date} className="border-b border-gray-50 last:border-0">
                                <td className="px-4 py-2">{row.date}</td>
                                <td className="px-4 py-2 text-right">{formatNumber(Number(row.total_tokens))}</td>
                                <td className="px-4 py-2 text-right text-gray-500">{formatNumber(Number(row.request_count))}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </>
              )}
            </section>

            {/* Subscriptions */}
            <section className="mb-8">
              <h2 className="text-lg font-semibold mb-4">{td.activeSubscriptions}</h2>
              {subscriptions.length === 0 ? (
                userPlan === "enterprise" || userPlan === "scale" || userPlan === "growth" ? (
                  <div className="bg-white rounded-lg border border-gray-200 p-6">
                    <div className="flex items-center gap-3 mb-3">
                      <h3 className="font-semibold text-lg">
                        {userPlan === "enterprise" ? td.enterprisePlan : userPlan === "scale" ? td.scalePlan : td.growthPlan}
                      </h3>
                      <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700">active</span>
                    </div>
                    <p className="text-gray-500 text-sm mb-2">
                      {userPlan === "enterprise" ? td.enterprisePlanDesc : td.managedBilling}
                    </p>
                    <p className="text-gray-400 text-xs">{td.managedBilling}</p>
                  </div>
                ) : (
                  <div className="bg-white rounded-lg border border-gray-200 p-6 text-center">
                    <p className="text-gray-500 mb-4">{td.noSubscriptions}</p>
                    <Link href={`/${locale}#pricing`} className="text-red-600 hover:underline text-sm font-medium">{td.viewPlans}</Link>
                  </div>
                )
              ) : (
                <div className="grid gap-4">
                  {subscriptions.map((sub) => (
                    <div key={sub.id} className="bg-white rounded-lg border border-gray-200 p-6">
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-3">
                          <h3 className="font-semibold">{sub.amount ? `${formatCurrency(sub.amount, "usd")}/${sub.interval}` : td.customPlan}</h3>
                          {statusBadge(sub.status, locale)}
                        </div>
                        {sub.cancel_at_period_end && <span className="text-xs text-red-500 font-medium">{td.cancelsAtEnd}</span>}
                      </div>
                      <p className="text-sm text-gray-500">{td.currentPeriod} {formatDate(sub.current_period_start)} — {formatDate(sub.current_period_end)}</p>
                    </div>
                  ))}
                </div>
              )}
            </section>

            {/* Payment History */}
            {payments.length > 0 && (
              <section className="mb-8">
                <h2 className="text-lg font-semibold mb-4">{locale === "zh" || locale === "zh-TW" ? "购买记录" : "Payment History"}</h2>
                <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="bg-gray-50 border-b border-gray-200">
                          <th className="text-left px-4 py-3 font-medium text-gray-600">{locale === "zh" || locale === "zh-TW" ? "订单号" : "Order"}</th>
                          <th className="text-left px-4 py-3 font-medium text-gray-600">{locale === "zh" || locale === "zh-TW" ? "方案" : "Plan"}</th>
                          <th className="text-left px-4 py-3 font-medium text-gray-600">{td.amount}</th>
                          <th className="text-left px-4 py-3 font-medium text-gray-600">{locale === "zh" || locale === "zh-TW" ? "支付方式" : "Method"}</th>
                          <th className="text-left px-4 py-3 font-medium text-gray-600">{td.status}</th>
                          <th className="text-left px-4 py-3 font-medium text-gray-600">{td.date}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {payments.map((p) => (
                          <tr key={p.order_no} className="border-b border-gray-100 last:border-0">
                            <td className="px-4 py-3 font-mono text-xs">{p.order_no}</td>
                            <td className="px-4 py-3 capitalize">{p.plan || "—"}</td>
                            <td className="px-4 py-3 font-medium">
                              {p.currency === "CNY" ? `¥${(p.amount / 100).toFixed(2)}` : formatCurrency(p.amount, p.currency)}
                            </td>
                            <td className="px-4 py-3">
                              {p.payment_method === "wechat_pay" ? "WeChat Pay" : p.payment_method === "stripe" ? "Stripe" : p.payment_method}
                            </td>
                            <td className="px-4 py-3">{statusBadge(p.status, locale)}</td>
                            <td className="px-4 py-3 text-gray-600">
                              {p.paid_at ? new Date(p.paid_at).toLocaleDateString() : new Date(p.created_at).toLocaleDateString()}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </section>
            )}

            {/* Invoices */}
            <section>
              <h2 className="text-lg font-semibold mb-4">{td.invoices}</h2>
              {invoices.length === 0 ? (
                <div className="bg-white rounded-lg border border-gray-200 p-6 text-center">
                  <p className="text-gray-500">{td.noInvoices}</p>
                </div>
              ) : (
                <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="bg-gray-50 border-b border-gray-200">
                          <th className="text-left px-4 py-3 font-medium text-gray-600">{td.invoice}</th>
                          <th className="text-left px-4 py-3 font-medium text-gray-600">{td.date}</th>
                          <th className="text-left px-4 py-3 font-medium text-gray-600">{td.amount}</th>
                          <th className="text-left px-4 py-3 font-medium text-gray-600">{td.status}</th>
                          <th className="text-right px-4 py-3 font-medium text-gray-600">{td.actions}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {invoices.map((inv) => (
                          <tr key={inv.id} className="border-b border-gray-100 last:border-0">
                            <td className="px-4 py-3">
                              <p className="font-medium">{inv.number || inv.id.slice(0, 16)}</p>
                              <p className="text-gray-400 text-xs">{inv.description}</p>
                            </td>
                            <td className="px-4 py-3 text-gray-600">{formatDate(inv.created)}</td>
                            <td className="px-4 py-3 font-medium">{formatCurrency(inv.amount_due, inv.currency)}</td>
                            <td className="px-4 py-3">{statusBadge(inv.status, locale)}</td>
                            <td className="px-4 py-3 text-right space-x-2">
                              {inv.hosted_invoice_url && <a href={inv.hosted_invoice_url} target="_blank" rel="noopener noreferrer" className="text-red-600 hover:underline">{td.view}</a>}
                              {inv.invoice_pdf && <a href={inv.invoice_pdf} target="_blank" rel="noopener noreferrer" className="text-red-600 hover:underline">{td.pdf}</a>}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </section>
          </>
        )}
      </div>
    </DashboardShell>
  );
}
