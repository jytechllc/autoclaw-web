"use client";

// Printable campaign report — open, review, Cmd/Ctrl+P → save as PDF.
// Pure frontend: reuses the existing detail GET (campaign + live 30-day
// metrics) and the stored recommendations digest. No DashboardShell chrome —
// the page IS the document, so browser print output is clean by construction.

import { useUser } from "@auth0/nextjs-auth0/client";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { getDictionary, type Locale } from "@/lib/i18n";
import { useOrg } from "@/components/OrgContext";

interface Daily { date: string; impressions: number; clicks: number; costMicros: number; conversions: number }

interface ReportDetail {
  status: string;
  channelType: string;
  startDate?: string;
  endDate?: string;
  optimizationScore?: number;
  metrics: { impressions: number; clicks: number; costMicros: number; conversions: number };
  dailyMetrics: Daily[];
  locations: Array<{ id: string; name: string; bidModifier?: number }>;
  keywords: Array<{ text: string; matchType: string }>;
  negativeKeywords: Array<{ text: string }>;
  bidding: { strategyType: string };
  sitelinks: Array<{ linkText: string }>;
  callouts: Array<{ text: string }>;
  structuredSnippets: Array<{ header: string }>;
  callAssets: Array<{ phoneNumber: string }>;
  promotions: Array<{ promotionTarget: string }>;
  adSchedules: Array<{ dayOfWeek: string; startHour: number; endHour: number }>;
}

interface ReportCampaign {
  campaign_name: string;
  channel: string;
  status: string;
  daily_budget: string | number;
  total_budget_cents: number | string | null;
  spent_cents: number | string | null;
  created_at: string;
  project_name?: string | null;
  project_website?: string | null;
}

interface Rec { category: string; priority: string; title: string; rationale: string; action: string }

function usd(n: number): string {
  return `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Tiny dependency-free SVG line chart (prints crisply). */
function TrendChart({ daily, label }: { daily: Daily[]; label: string }) {
  const W = 680;
  const H = 120;
  const PAD = 6;
  const costs = daily.map((d) => d.costMicros / 1_000_000);
  const max = Math.max(...costs, 0.01);
  const pts = costs
    .map((c, i) => {
      const x = PAD + (i * (W - 2 * PAD)) / Math.max(costs.length - 1, 1);
      const y = H - PAD - (c / max) * (H - 2 * PAD);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full border border-gray-200 rounded bg-gray-50">
        <polyline points={pts} fill="none" stroke="#991b1b" strokeWidth="2" />
      </svg>
      <div className="flex justify-between text-[10px] text-gray-400 mt-0.5">
        <span>{daily[0]?.date}</span>
        <span>{label} (max {usd(max)})</span>
        <span>{daily[daily.length - 1]?.date}</span>
      </div>
    </div>
  );
}

export default function CampaignReportPage() {
  const { user } = useUser();
  const params = useParams();
  const locale = (params.locale as Locale) || "en";
  const campaignId = Number(params.id);
  const dict = getDictionary(locale);
  const t = dict.googleAdsPage;
  const { activeOrg } = useOrg();

  const [campaign, setCampaign] = useState<ReportCampaign | null>(null);
  const [detail, setDetail] = useState<ReportDetail | null>(null);
  const [recs, setRecs] = useState<Rec[] | null>(null);
  const [recsGeneratedAt, setRecsGeneratedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const orgQ = activeOrg ? `?org_id=${activeOrg.id}` : "";
        const orgQ2 = activeOrg ? `?orgId=${activeOrg.id}` : "";
        const [detailRes, recsRes] = await Promise.all([
          fetch(`/api/google-ads/campaigns/${campaignId}${orgQ}`).then((r) => r.json()),
          fetch(`/api/google-ads/campaigns/${campaignId}/recommendations${orgQ2}`).then((r) => r.json()).catch(() => null),
        ]);
        if (cancelled) return;
        if (detailRes.error) {
          setError(detailRes.error);
        } else {
          setCampaign(detailRes.campaign || null);
          setDetail(detailRes.detail || null);
          if (detailRes.detailError) setError(detailRes.detailError);
        }
        if (recsRes?.success && recsRes.digest) {
          setRecs(Array.isArray(recsRes.digest.recommendations) ? recsRes.digest.recommendations : null);
          setRecsGeneratedAt(recsRes.digest.generatedAt || null);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
      if (!cancelled) setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [campaignId, activeOrg?.id]);

  if (!user) return null;

  const cost = (detail?.metrics.costMicros || 0) / 1_000_000;
  const clicks = detail?.metrics.clicks || 0;
  const impressions = detail?.metrics.impressions || 0;
  const conversions = detail?.metrics.conversions || 0;
  const ctr = impressions > 0 ? (clicks / impressions) * 100 : 0;
  const cpc = clicks > 0 ? cost / clicks : 0;
  const spent = Number(campaign?.spent_cents || 0) / 100;
  const totalBudget = Number(campaign?.total_budget_cents || 0) / 100;

  const kpis: Array<[string, string]> = [
    [t.metricImpressions || "Impressions", impressions.toLocaleString()],
    [t.metricClicks || "Clicks", clicks.toLocaleString()],
    [t.metricCtr || "CTR", `${ctr.toFixed(2)}%`],
    [t.metricAvgCpc || "Avg CPC", usd(cpc)],
    [t.metricCost || "Cost (30d)", usd(cost)],
    [t.metricConversions || "Conversions", conversions.toLocaleString()],
  ];

  const extensionsSummary = detail
    ? [
        detail.sitelinks?.length ? `${detail.sitelinks.length} sitelinks` : "",
        detail.callouts?.length ? `${detail.callouts.length} callouts` : "",
        detail.structuredSnippets?.length ? `${detail.structuredSnippets.length} snippets` : "",
        detail.callAssets?.length ? `${detail.callAssets.length} call` : "",
        detail.promotions?.length ? `${detail.promotions.length} promotions` : "",
      ].filter(Boolean).join(" · ")
    : "";

  return (
    <div className="max-w-3xl mx-auto p-6 sm:p-10 bg-white min-h-screen text-gray-900">
      {/* Toolbar — hidden in print */}
      <div className="flex items-center justify-between mb-6 print:hidden">
        <Link href={`/${locale}/dashboard/google-ads/${campaignId}`} className="text-sm text-gray-500 hover:text-gray-800">
          ← {t.backToCampaign || "Back to campaign"}
        </Link>
        <button
          onClick={() => window.print()}
          className="bg-red-800 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-red-900 transition cursor-pointer"
        >
          🖨️ {t.reportPrint || "Print / Save as PDF"}
        </button>
      </div>

      {loading && <p className="text-sm text-gray-400">{t.loading || "Loading…"}</p>}
      {error && !detail && <p className="text-sm text-red-600 bg-red-50 rounded p-3">{error}</p>}

      {campaign && (
        <>
          {/* Header */}
          <div className="border-b-2 border-red-800 pb-4 mb-6">
            <div className="flex items-baseline justify-between gap-4 flex-wrap">
              <h1 className="text-2xl font-bold">{campaign.campaign_name}</h1>
              <span className="text-xs text-gray-400">AutoClaw · Google Ads · {new Date().toLocaleDateString()}</span>
            </div>
            <p className="text-sm text-gray-500 mt-1">
              {campaign.channel} · {detail?.status || campaign.status}
              {campaign.project_name && <> · {campaign.project_name}</>}
              {detail?.startDate && <> · {detail.startDate} → {detail.endDate || "—"}</>}
              {detail?.optimizationScore !== undefined && detail.optimizationScore > 0 && (
                <> · {t.reportOptScore || "Optimization score"}: {(detail.optimizationScore * 100).toFixed(0)}%</>
              )}
            </p>
          </div>

          {/* KPI grid */}
          <div className="grid grid-cols-3 gap-3 mb-6">
            {kpis.map(([label, value]) => (
              <div key={label} className="border border-gray-200 rounded-lg p-3">
                <div className="text-[11px] text-gray-500 uppercase tracking-wide">{label}</div>
                <div className="text-xl font-bold mt-0.5">{value}</div>
              </div>
            ))}
          </div>

          {/* Budget */}
          <div className="mb-6">
            <h2 className="text-sm font-semibold text-gray-700 mb-2">💰 {t.reportBudgetSection || "Budget"}</h2>
            <div className="text-sm text-gray-700">
              {t.dailyBudget || "Daily budget"}: <span className="font-medium">{usd(Number(campaign.daily_budget || 0))}</span>
              {" · "}{t.totalBudget || "Total budget cap"}: <span className="font-medium">{usd(totalBudget)}</span>
              {" · "}{t.spent || "Spent"}: <span className="font-medium">{usd(spent)}</span>
              {totalBudget > 0 && <> ({((spent / totalBudget) * 100).toFixed(1)}%)</>}
            </div>
            {totalBudget > 0 && (
              <div className="mt-2 h-2 rounded-full bg-gray-100 overflow-hidden">
                <div className="h-full bg-red-800" style={{ width: `${Math.min((spent / totalBudget) * 100, 100)}%` }} />
              </div>
            )}
          </div>

          {/* Trend */}
          {detail && detail.dailyMetrics.length > 0 && (
            <div className="mb-6">
              <h2 className="text-sm font-semibold text-gray-700 mb-2">📈 {t.reportTrendSection || "Daily spend (30 days)"}</h2>
              <TrendChart daily={detail.dailyMetrics} label={t.metricCost || "Cost"} />
            </div>
          )}

          {/* Setup summary */}
          {detail && (
            <div className="mb-6">
              <h2 className="text-sm font-semibold text-gray-700 mb-2">⚙️ {t.reportSetupSection || "Campaign setup"}</h2>
              <table className="w-full text-sm">
                <tbody>
                  {detail.bidding?.strategyType && (
                    <tr className="border-t border-gray-100">
                      <td className="py-1.5 text-gray-500 w-44">{t.bidStrategyLabel || "Bid strategy"}</td>
                      <td className="py-1.5">{detail.bidding.strategyType}</td>
                    </tr>
                  )}
                  <tr className="border-t border-gray-100">
                    <td className="py-1.5 text-gray-500">{t.locations || "Locations"}</td>
                    <td className="py-1.5">{detail.locations?.length ? detail.locations.map((l) => l.name).join(", ") : "—"}</td>
                  </tr>
                  <tr className="border-t border-gray-100">
                    <td className="py-1.5 text-gray-500">{t.keywordsSection || "Keywords"}</td>
                    <td className="py-1.5">
                      {detail.keywords?.length || 0}
                      {(detail.negativeKeywords?.length || 0) > 0 && <> ( + {detail.negativeKeywords.length} {t.negKwSection || "Negative Keywords"})</>}
                    </td>
                  </tr>
                  {(detail.adSchedules?.length || 0) > 0 && (
                    <tr className="border-t border-gray-100">
                      <td className="py-1.5 text-gray-500">{t.schedSection || "Ad Schedule"}</td>
                      <td className="py-1.5">{detail.adSchedules.map((s) => `${s.dayOfWeek.slice(0, 3)} ${s.startHour}–${s.endHour}`).join(", ")}</td>
                    </tr>
                  )}
                  {extensionsSummary && (
                    <tr className="border-t border-gray-100">
                      <td className="py-1.5 text-gray-500">{t.extSection || "Extensions"}</td>
                      <td className="py-1.5">{extensionsSummary}</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}

          {/* AI recommendations digest */}
          {recs && recs.length > 0 && (
            <div className="mb-6 break-inside-avoid">
              <h2 className="text-sm font-semibold text-gray-700 mb-2">✨ {t.recsSection || "AI Optimization Recommendations"}</h2>
              <div className="space-y-2">
                {recs.map((r, i) => (
                  <div key={i} className="border border-gray-200 rounded-lg p-2.5 text-sm">
                    <span className={`px-1.5 py-0.5 text-[10px] rounded-full font-medium mr-2 ${
                      r.priority === "HIGH" ? "bg-red-50 text-red-700" : r.priority === "MEDIUM" ? "bg-amber-50 text-amber-700" : "bg-gray-100 text-gray-600"
                    }`}>{r.priority}</span>
                    <span className="font-medium">{r.title}</span>
                    <p className="text-xs text-gray-600 mt-1">{r.rationale}</p>
                    <p className="text-xs text-gray-800 mt-0.5">▸ {r.action}</p>
                  </div>
                ))}
              </div>
              {recsGeneratedAt && (
                <p className="text-[10px] text-gray-400 mt-1">{t.recsGeneratedAt || "Generated"}: {new Date(recsGeneratedAt).toLocaleString()}</p>
              )}
            </div>
          )}

          <p className="text-[10px] text-gray-400 border-t border-gray-100 pt-3">
            {t.reportFooter || "Generated by AutoClaw — metrics cover the last 30 days as reported by Google Ads."}
          </p>
        </>
      )}
    </div>
  );
}
