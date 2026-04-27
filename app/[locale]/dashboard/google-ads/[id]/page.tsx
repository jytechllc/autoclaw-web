"use client";

import { useUser } from "@auth0/nextjs-auth0/client";
import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { getDictionary, type Locale } from "@/lib/i18n";
import DashboardShell from "@/components/DashboardShell";
import { useOrg } from "@/components/OrgContext";
import { COUNTRIES } from "@/lib/google-ads";

interface CampaignRow {
  id: number;
  platform_campaign_id: string;
  campaign_name: string;
  channel: string;
  daily_budget: string | number;
  currency: string;
  status: string;
  total_budget_cents: number | string | null;
  reserved_cents: number | string | null;
  spent_cents: number | string | null;
  closed: boolean;
  created_at: string;
  updated_at: string;
}

interface Detail {
  resourceName: string;
  name: string;
  status: string;
  channelType: string;
  startDate?: string;
  endDate?: string;
  optimizationScore?: number;
  metrics: { impressions: number; clicks: number; costMicros: number; conversions: number; ctr: number; avgCpcMicros: number };
  locations: Array<{ id: string; name: string }>;
  audiences: Array<{ category: string; label: string; negative: boolean; adGroupName: string }>;
  adGroups: Array<{ resourceName: string; name: string; status: string; cpcBidMicros: number }>;
  keywords: Array<{ text: string; matchType: string }>;
  ads: Array<{
    resourceName: string;
    status: string;
    adId: string;
    name: string;
    type: string;
    headlines: string[];
    longHeadlines: string[];
    descriptions: string[];
    callToActions: string[];
    videos: Array<{ asset: string; youtubeVideoId: string; title: string }>;
    finalUrls: string[];
  }>;
}

function formatUsd(cents: number | string | null | undefined): string {
  return `$${(Number(cents || 0) / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fromMicros(micros: number): number {
  return micros / 1_000_000;
}

export default function CampaignDetailPage() {
  const { user } = useUser();
  const params = useParams();
  const router = useRouter();
  const locale = (params.locale as Locale) || "en";
  const campaignId = params.id as string;
  const dict = getDictionary(locale);
  const t = dict.googleAdsPage;
  const { activeOrg } = useOrg();

  const [campaign, setCampaign] = useState<CampaignRow | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [googleAdsUrl, setGoogleAdsUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [actioning, setActioning] = useState(false);
  const [toast, setToast] = useState("");

  // Rename
  const [editingName, setEditingName] = useState(false);
  const [nameInput, setNameInput] = useState("");
  const [renaming, setRenaming] = useState(false);

  // Generic field edit state
  const [editingField, setEditingField] = useState<"totalBudget" | "dailyBudget" | "schedule" | null>(null);
  const [fieldInputA, setFieldInputA] = useState("");
  const [fieldInputB, setFieldInputB] = useState("");
  const [savingField, setSavingField] = useState(false);

  async function handleSaveField() {
    if (!editingField) return;
    setSavingField(true);
    let body: Record<string, unknown> = { orgId: activeOrg?.id };
    if (editingField === "totalBudget") {
      const n = Number(fieldInputA);
      if (!Number.isFinite(n) || n <= 0) { setSavingField(false); setToast(t.invalidBudget || "Invalid"); setTimeout(() => setToast(""), 3000); return; }
      body = { ...body, action: "set_total_budget", totalBudget: n };
    } else if (editingField === "dailyBudget") {
      const n = Number(fieldInputA);
      if (!Number.isFinite(n) || n <= 0) { setSavingField(false); setToast(t.invalidBudget || "Invalid"); setTimeout(() => setToast(""), 3000); return; }
      body = { ...body, action: "set_daily_budget", dailyBudget: n };
    } else if (editingField === "schedule") {
      body = { ...body, action: "set_schedule", startDate: fieldInputA || null, endDate: fieldInputB || null };
    }
    try {
      const res = await fetch(`/api/google-ads/campaigns/${campaignId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setToast(t.updated || "Updated");
        setEditingField(null);
        fetchData();
        setTimeout(() => setToast(""), 3000);
      } else if (res.status === 402) {
        setToast(`${t.insufficientCredits || "Insufficient credits"} (${formatUsd(data.balanceCents)} / ${formatUsd(data.requestedCents)})`);
        setTimeout(() => setToast(""), 4000);
      } else {
        setToast(data.error || "Update failed");
        setTimeout(() => setToast(""), 4000);
      }
    } catch (e) {
      setToast(e instanceof Error ? e.message : "Update failed");
      setTimeout(() => setToast(""), 3000);
    }
    setSavingField(false);
  }

  // Locations edit
  const [editingLocations, setEditingLocations] = useState(false);
  const [editLocations, setEditLocations] = useState<Array<{ id: string; name: string; targetType?: string }>>([]);
  const [savingLocations, setSavingLocations] = useState(false);
  const [geoQuery, setGeoQuery] = useState("");
  const [geoSuggestions, setGeoSuggestions] = useState<Array<{ id: string; name: string; canonicalName: string; targetType: string }>>([]);
  const [geoSearching, setGeoSearching] = useState(false);

  // Debounced geo search
  useEffect(() => {
    if (!editingLocations || geoQuery.trim().length < 2) {
      setGeoSuggestions([]);
      return;
    }
    const ctrl = new AbortController();
    const timer = setTimeout(async () => {
      setGeoSearching(true);
      try {
        const res = await fetch(`/api/google-ads/geo-targets?q=${encodeURIComponent(geoQuery)}`, { signal: ctrl.signal });
        const data = await res.json();
        setGeoSuggestions(data.suggestions || []);
      } catch { /* ignore */ }
      setGeoSearching(false);
    }, 300);
    return () => { clearTimeout(timer); ctrl.abort(); };
  }, [geoQuery, editingLocations]);

  function openLocationEdit() {
    setEditLocations(detail?.locations || []);
    setGeoQuery("");
    setGeoSuggestions([]);
    setEditingLocations(true);
  }

  async function handleSaveLocations() {
    setSavingLocations(true);
    try {
      const res = await fetch(`/api/google-ads/campaigns/${campaignId}/locations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          locationIds: editLocations.map((l) => l.id),
          orgId: activeOrg?.id,
        }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setToast(t.locationsUpdated || "Locations updated");
        setEditingLocations(false);
        fetchData();
        setTimeout(() => setToast(""), 3000);
      } else {
        setToast(data.error || "Update failed");
        setTimeout(() => setToast(""), 4000);
      }
    } catch (e) {
      setToast(e instanceof Error ? e.message : "Update failed");
      setTimeout(() => setToast(""), 3000);
    }
    setSavingLocations(false);
  }

  // Ad group create
  const [showAgForm, setShowAgForm] = useState(false);
  const [agName, setAgName] = useState("");
  const [agCpcBid, setAgCpcBid] = useState("1.00");
  const [agSubmitting, setAgSubmitting] = useState(false);
  const [agError, setAgError] = useState("");

  // Ad create per-ad-group (Search Ad)
  const [adFormFor, setAdFormFor] = useState<string | null>(null); // adGroupResourceName
  const [adHeadlines, setAdHeadlines] = useState("");
  const [adDescriptions, setAdDescriptions] = useState("");
  const [adFinalUrl, setAdFinalUrl] = useState("");
  const [adSubmitting, setAdSubmitting] = useState(false);
  const [adError, setAdError] = useState("");

  // Video Ad form state
  const [vYoutubeUrl, setVYoutubeUrl] = useState("");
  const [vShortHeadlines, setVShortHeadlines] = useState("");
  const [vLongHeadline, setVLongHeadline] = useState("");
  const [vDescriptions, setVDescriptions] = useState("");
  const [vCta, setVCta] = useState("Subscribe");
  const [vFinalUrl, setVFinalUrl] = useState("");

  const fetchData = useCallback(async () => {
    setLoading(true);
    const orgQuery = activeOrg ? `?org_id=${activeOrg.id}` : "";
    try {
      const res = await fetch(`/api/google-ads/campaigns/${campaignId}${orgQuery}`);
      const data = await res.json();
      if (res.ok) {
        setCampaign(data.campaign);
        setDetail(data.detail);
        setDetailError(data.detailError);
        setGoogleAdsUrl(data.googleAdsUrl);
      } else {
        setDetailError(data.error || "Failed to load");
      }
    } catch (e) {
      setDetailError(e instanceof Error ? e.message : "Failed to load");
    }
    setLoading(false);
  }, [campaignId, activeOrg]);

  useEffect(() => {
    if (user) fetchData();
  }, [user, fetchData]);

  async function handleAction(action: "pause" | "enable" | "close") {
    if (action === "close" && !window.confirm(t.confirmClose || "Close and refund?")) return;
    setActioning(true);
    try {
      const res = await fetch(`/api/google-ads/campaigns/${campaignId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, orgId: activeOrg?.id }),
      });
      const data = await res.json();
      if (res.ok) {
        const note = data.releasedCents > 0 ? ` · ${t.refunded} ${formatUsd(data.releasedCents)}` : "";
        setToast(`${t[`action_${action}` as "action_pause" | "action_enable" | "action_close"]}${note}`);
        fetchData();
      } else {
        setToast(data.error || "Action failed");
      }
      setTimeout(() => setToast(""), 3000);
    } catch (e) {
      setToast(e instanceof Error ? e.message : "Action failed");
      setTimeout(() => setToast(""), 3000);
    }
    setActioning(false);
  }

  async function handleRename() {
    const newName = nameInput.trim();
    if (!newName || newName === campaign?.campaign_name) {
      setEditingName(false);
      return;
    }
    setRenaming(true);
    try {
      const res = await fetch(`/api/google-ads/campaigns/${campaignId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "rename", name: newName, orgId: activeOrg?.id }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setToast(t.renameDone || "Renamed");
        setEditingName(false);
        fetchData();
        setTimeout(() => setToast(""), 3000);
      } else {
        setToast(data.error || "Rename failed");
        setTimeout(() => setToast(""), 3000);
      }
    } catch (e) {
      setToast(e instanceof Error ? e.message : "Rename failed");
      setTimeout(() => setToast(""), 3000);
    }
    setRenaming(false);
  }

  async function handleCreateAdGroup() {
    if (!agName.trim() || Number(agCpcBid) <= 0) return;
    setAgSubmitting(true);
    setAgError("");
    try {
      const res = await fetch(`/api/google-ads/campaigns/${campaignId}/ad-groups`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: agName.trim(),
          cpcBidUsd: Number(agCpcBid),
          orgId: activeOrg?.id,
        }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setToast(t.adGroupCreated || "Ad group created");
        setShowAgForm(false);
        setAgName("");
        setAgCpcBid("1.00");
        fetchData();
        setTimeout(() => setToast(""), 3000);
      } else {
        setAgError(typeof data.details === "object" ? JSON.stringify(data.details, null, 2) : (data.error || "Failed"));
      }
    } catch (e) {
      setAgError(e instanceof Error ? e.message : "Failed");
    }
    setAgSubmitting(false);
  }

  async function handleCreateAd() {
    if (!adFormFor) return;
    const headlines = adHeadlines.split("\n").map((s) => s.trim()).filter(Boolean);
    const descriptions = adDescriptions.split("\n").map((s) => s.trim()).filter(Boolean);
    const finalUrl = adFinalUrl.trim();
    if (headlines.length < 3 || descriptions.length < 2 || !/^https?:\/\//i.test(finalUrl)) {
      setAdError(t.adValidation || "Need at least 3 headlines (one per line), 2 descriptions, and a valid URL.");
      return;
    }
    setAdSubmitting(true);
    setAdError("");
    try {
      const res = await fetch(`/api/google-ads/campaigns/${campaignId}/ads`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          adGroupResourceName: adFormFor,
          headlines, descriptions, finalUrl,
          orgId: activeOrg?.id,
        }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setToast(t.adCreated || "Ad created");
        setAdFormFor(null);
        setAdHeadlines("");
        setAdDescriptions("");
        setAdFinalUrl("");
        fetchData();
        setTimeout(() => setToast(""), 3000);
      } else {
        setAdError(typeof data.details === "object" ? JSON.stringify(data.details, null, 2) : (data.error || "Failed"));
      }
    } catch (e) {
      setAdError(e instanceof Error ? e.message : "Failed");
    }
    setAdSubmitting(false);
  }

  async function handleCreateVideoAd() {
    if (!adFormFor) return;
    const headlines = vShortHeadlines.split("\n").map((s) => s.trim()).filter(Boolean);
    const descriptions = vDescriptions.split("\n").map((s) => s.trim()).filter(Boolean);
    if (!vYoutubeUrl.trim() || !vLongHeadline.trim() || descriptions.length < 1 || !/^https?:\/\//i.test(vFinalUrl.trim())) {
      setAdError(t.videoAdValidation || "Need YouTube URL, long headline, at least 1 description, and a valid http(s) URL");
      return;
    }
    setAdSubmitting(true);
    setAdError("");
    try {
      const res = await fetch(`/api/google-ads/campaigns/${campaignId}/video-ads`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          adGroupResourceName: adFormFor,
          youtubeUrl: vYoutubeUrl.trim(),
          headlines,
          longHeadline: vLongHeadline.trim(),
          descriptions,
          callToAction: vCta,
          finalUrl: vFinalUrl.trim(),
          orgId: activeOrg?.id,
        }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setToast(t.videoAdCreated || "Video ad created");
        setAdFormFor(null);
        setVYoutubeUrl(""); setVShortHeadlines(""); setVLongHeadline(""); setVDescriptions(""); setVFinalUrl("");
        fetchData();
        setTimeout(() => setToast(""), 3000);
      } else {
        setAdError(typeof data.details === "object" ? JSON.stringify(data.details, null, 2) : (data.error || "Failed"));
      }
    } catch (e) {
      setAdError(e instanceof Error ? e.message : "Failed");
    }
    setAdSubmitting(false);
  }

  if (!user) return null;

  if (loading) {
    return (
      <DashboardShell user={user} plan={undefined}>
        <div className="p-8 text-center text-gray-400">{t.loading}</div>
      </DashboardShell>
    );
  }

  if (!campaign) {
    return (
      <DashboardShell user={user} plan={undefined}>
        <div className="p-8 max-w-3xl mx-auto">
          <p className="text-gray-500 mb-3">{detailError || t.notFound || "Not found"}</p>
          <button onClick={() => router.push(`/${locale}/dashboard/google-ads`)} className="text-sm text-red-700 hover:underline cursor-pointer">
            ← {t.backToCampaigns || "Back to campaigns"}
          </button>
        </div>
      </DashboardShell>
    );
  }

  const cap = Number(campaign.total_budget_cents || 0);
  const spent = Number(campaign.spent_cents || 0);
  const pct = cap > 0 ? Math.min(100, (spent / cap) * 100) : 0;
  const m = detail?.metrics;

  return (
    <DashboardShell user={user} plan={undefined}>
      <div className="p-4 sm:p-6 max-w-5xl mx-auto space-y-5">
        <Link href={`/${locale}/dashboard/google-ads`} className="text-sm text-gray-500 hover:text-gray-700">
          ← {t.backToCampaigns || "Back to campaigns"}
        </Link>

        {toast && (
          <div className="fixed top-4 right-4 z-50 bg-green-600 text-white px-4 py-2 rounded-lg shadow-lg text-sm">{toast}</div>
        )}

        {/* Header */}
        <div className="bg-white rounded-xl border border-gray-200 p-5 sm:p-6">
          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
            <div className="flex-1 min-w-0">
              {editingName && !campaign.closed ? (
                <div className="flex items-center gap-2">
                  <input
                    autoFocus
                    value={nameInput}
                    onChange={(e) => setNameInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleRename();
                      if (e.key === "Escape") setEditingName(false);
                    }}
                    className="text-2xl font-bold text-gray-900 px-2 py-1 border-2 border-red-500 rounded outline-none w-full"
                    maxLength={255}
                  />
                  <button
                    onClick={handleRename}
                    disabled={renaming || !nameInput.trim()}
                    className="text-xs px-3 py-1.5 bg-red-800 text-white rounded hover:bg-red-900 disabled:opacity-50 cursor-pointer"
                  >
                    {renaming ? (t.creating || "Saving...") : (t.save || "Save")}
                  </button>
                  <button
                    onClick={() => setEditingName(false)}
                    className="text-xs px-3 py-1.5 border border-gray-300 rounded hover:bg-gray-50 cursor-pointer"
                  >
                    {t.cancel || "Cancel"}
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-2 group">
                  <h1 className="text-2xl font-bold text-gray-900">{campaign.campaign_name}</h1>
                  {!campaign.closed && (
                    <button
                      onClick={() => { setNameInput(campaign.campaign_name); setEditingName(true); }}
                      className="text-xs text-gray-400 hover:text-gray-700 opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
                      title={t.renameTooltip || "Rename"}
                    >
                      ✏️ {t.rename || "Rename"}
                    </button>
                  )}
                </div>
              )}
              <div className="flex flex-wrap gap-2 mt-2 text-xs">
                <span className="px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">{campaign.channel}</span>
                <span className={`px-2 py-0.5 rounded-full ${
                  campaign.closed ? "bg-gray-200 text-gray-600" :
                  campaign.status === "PAUSED" ? "bg-yellow-50 text-yellow-700" :
                  campaign.status === "ENABLED" ? "bg-green-50 text-green-700" :
                  "bg-gray-100 text-gray-600"
                }`}>{campaign.closed ? (t.statusClosed || "CLOSED") : campaign.status}</span>
                {editingField === "schedule" ? (
                  <div className="flex items-center gap-1">
                    <input type="date" value={fieldInputA} onChange={(e) => setFieldInputA(e.target.value)} className="text-xs px-1 py-0.5 border border-red-500 rounded outline-none" />
                    <span>→</span>
                    <input type="date" value={fieldInputB} onChange={(e) => setFieldInputB(e.target.value)} className="text-xs px-1 py-0.5 border border-red-500 rounded outline-none" />
                    <button onClick={handleSaveField} disabled={savingField} className="text-xs px-2 py-0.5 bg-red-800 text-white rounded hover:bg-red-900 cursor-pointer">{savingField ? "..." : (t.save || "Save")}</button>
                    <button onClick={() => setEditingField(null)} className="text-xs px-1 text-gray-400 cursor-pointer">×</button>
                  </div>
                ) : (
                  detail?.startDate && (
                    <span className="text-gray-500 inline-flex items-center gap-1">
                      📅 {detail.startDate}{detail.endDate && detail.endDate !== "9999-12-31" ? ` → ${detail.endDate}` : ` → ${t.noEndDate || "no end"}`}
                      {!campaign.closed && (
                        <button
                          onClick={() => { setFieldInputA(detail.startDate || ""); setFieldInputB(detail.endDate && detail.endDate !== "9999-12-31" ? detail.endDate : ""); setEditingField("schedule"); }}
                          className="text-gray-400 hover:text-gray-700 cursor-pointer"
                        >✏️</button>
                      )}
                    </span>
                  )
                )}
              </div>
            </div>
            <div className="flex items-center gap-2">
              {!campaign.closed && (
                <>
                  {campaign.status === "PAUSED" ? (
                    <button onClick={() => handleAction("enable")} disabled={actioning} className="text-xs px-3 py-1.5 border border-green-200 text-green-700 rounded-lg hover:bg-green-50 disabled:opacity-50 cursor-pointer">{t.action_enable || "Enable"}</button>
                  ) : (
                    <button onClick={() => handleAction("pause")} disabled={actioning} className="text-xs px-3 py-1.5 border border-amber-200 text-amber-700 rounded-lg hover:bg-amber-50 disabled:opacity-50 cursor-pointer">{t.action_pause || "Pause"}</button>
                  )}
                  <button onClick={() => handleAction("close")} disabled={actioning} className="text-xs px-3 py-1.5 border border-red-200 text-red-700 rounded-lg hover:bg-red-50 disabled:opacity-50 cursor-pointer">{t.action_close || "Close"}</button>
                </>
              )}
              {googleAdsUrl && (
                <a
                  href={googleAdsUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs px-3 py-1.5 border border-gray-200 rounded-lg hover:bg-gray-50 cursor-pointer text-gray-600"
                >
                  {t.openInGoogleAds || "Open in Google Ads ↗"}
                </a>
              )}
            </div>
          </div>
        </div>

        {/* Performance metrics (last 30 days) */}
        <div>
          <h2 className="text-sm font-semibold text-gray-700 mb-2">{t.metricsTitle || "Performance (last 30 days)"}</h2>
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3">
            <Stat label={t.metricImpressions || "Impressions"} value={m ? m.impressions.toLocaleString() : "—"} />
            <Stat label={t.metricClicks || "Clicks"} value={m ? m.clicks.toLocaleString() : "—"} />
            <Stat label={t.metricCtr || "CTR"} value={m ? `${(m.ctr * 100).toFixed(2)}%` : "—"} />
            <Stat label={t.metricConversions || "Conversions"} value={m ? m.conversions.toFixed(1) : "—"} />
            <Stat label={t.metricCost || "Cost"} value={m ? `$${fromMicros(m.costMicros).toFixed(2)}` : "—"} />
            <Stat label={t.metricAvgCpc || "Avg CPC"} value={m ? `$${fromMicros(m.avgCpcMicros).toFixed(2)}` : "—"} />
          </div>
          {detailError && (
            <p className="text-xs text-amber-600 mt-2">⚠️ {t.detailError || "Could not load live metrics"}: {detailError}</p>
          )}
        </div>

        {/* Budget */}
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h2 className="text-sm font-semibold text-gray-700 mb-3">{t.budgetSection || "Budget"}</h2>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div>
              <div className="text-xs text-gray-500 mb-0.5 flex items-center gap-1">
                {t.dailyBudget}
                {!campaign.closed && editingField !== "dailyBudget" && (
                  <button
                    onClick={() => { setFieldInputA(String(Number(campaign.daily_budget))); setEditingField("dailyBudget"); }}
                    className="text-gray-400 hover:text-gray-700 cursor-pointer"
                  >✏️</button>
                )}
              </div>
              {editingField === "dailyBudget" ? (
                <div className="flex items-center gap-1">
                  <span className="text-sm">$</span>
                  <input
                    type="number" min="1" step="1" autoFocus
                    value={fieldInputA}
                    onChange={(e) => setFieldInputA(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") handleSaveField(); if (e.key === "Escape") setEditingField(null); }}
                    className="w-20 px-2 py-1 border border-red-500 rounded text-base font-semibold outline-none"
                  />
                  <button onClick={handleSaveField} disabled={savingField} className="text-xs px-2 py-1 bg-red-800 text-white rounded hover:bg-red-900 cursor-pointer">{savingField ? "..." : (t.save || "Save")}</button>
                  <button onClick={() => setEditingField(null)} className="text-xs px-1 text-gray-400 cursor-pointer">×</button>
                </div>
              ) : (
                <div className="text-base font-semibold text-gray-900">${Number(campaign.daily_budget).toFixed(2)}</div>
              )}
            </div>
            <div>
              <div className="text-xs text-gray-500 mb-0.5 flex items-center gap-1">
                {t.totalBudget || "Cap"}
                {!campaign.closed && editingField !== "totalBudget" && (
                  <button
                    onClick={() => { setFieldInputA(String((Number(campaign.total_budget_cents) || 0) / 100)); setEditingField("totalBudget"); }}
                    className="text-gray-400 hover:text-gray-700 cursor-pointer"
                  >✏️</button>
                )}
              </div>
              {editingField === "totalBudget" ? (
                <div className="flex items-center gap-1">
                  <span className="text-sm">$</span>
                  <input
                    type="number" min="1" step="1" autoFocus
                    value={fieldInputA}
                    onChange={(e) => setFieldInputA(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") handleSaveField(); if (e.key === "Escape") setEditingField(null); }}
                    className="w-20 px-2 py-1 border border-red-500 rounded text-base font-semibold outline-none"
                  />
                  <button onClick={handleSaveField} disabled={savingField} className="text-xs px-2 py-1 bg-red-800 text-white rounded hover:bg-red-900 cursor-pointer">{savingField ? "..." : (t.save || "Save")}</button>
                  <button onClick={() => setEditingField(null)} className="text-xs px-1 text-gray-400 cursor-pointer">×</button>
                </div>
              ) : (
                <div className="text-base font-semibold text-gray-900">{formatUsd(campaign.total_budget_cents)}</div>
              )}
            </div>
            <Stat label={t.spent || "Spent"} value={formatUsd(campaign.spent_cents)} />
            <Stat label={t.reserved || "Reserved"} value={formatUsd(campaign.reserved_cents)} />
          </div>
          {cap > 0 && (
            <div className="mt-3">
              <div className="w-full h-2 bg-gray-100 rounded-full overflow-hidden">
                <div className={`h-full ${pct >= 100 ? "bg-red-500" : pct >= 80 ? "bg-amber-500" : "bg-emerald-500"}`} style={{ width: `${pct}%` }} />
              </div>
              <p className="text-xs text-gray-500 mt-1">{pct.toFixed(1)}% {t.ofCapUsed || "of cap used"}</p>
            </div>
          )}
        </div>

        {/* Targeting */}
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-gray-700">{t.targetingSection || "Targeting"}</h2>
            {!campaign.closed && !editingLocations && (
              <button
                onClick={openLocationEdit}
                className="text-xs text-gray-400 hover:text-gray-700 cursor-pointer"
                title={t.editLocations || "Edit locations"}
              >
                ✏️ {t.editLocations || "Edit"}
              </button>
            )}
          </div>

          {!editingLocations ? (
            <div className="space-y-3">
              <div className="text-sm">
                <span className="text-xs text-gray-500">{t.locations || "Locations"}: </span>
                {detail?.locations?.length ? (
                  <div className="inline-flex flex-wrap gap-1.5 mt-1">
                    {detail.locations.map((l) => (
                      <span key={l.id} className="px-2 py-0.5 bg-blue-50 text-blue-700 text-xs rounded-full">{l.name}</span>
                    ))}
                  </div>
                ) : (
                  <span className="text-amber-700">⚠️ {t.locationsWorldwide || "Worldwide (no targeting set — may waste budget)"}</span>
                )}
              </div>

              {/* Audiences */}
              <div className="text-sm pt-2 border-t border-gray-100">
                <span className="text-xs text-gray-500">{t.audiences || "Audiences"}: </span>
                {detail?.audiences?.length ? (
                  <div className="space-y-1.5 mt-1">
                    {Object.entries(
                      detail.audiences.reduce<Record<string, typeof detail.audiences>>((acc, a) => {
                        (acc[a.category] = acc[a.category] || []).push(a);
                        return acc;
                      }, {})
                    ).map(([cat, items]) => (
                      <div key={cat}>
                        <span className="text-xs text-gray-400">{cat}:</span>
                        <span className="inline-flex flex-wrap gap-1 ml-1.5">
                          {items.map((a, i) => (
                            <span
                              key={i}
                              className={`px-2 py-0.5 text-xs rounded-full ${
                                a.negative ? "bg-red-50 text-red-700 line-through" : "bg-purple-50 text-purple-700"
                              }`}
                              title={a.adGroupName ? `Ad group: ${a.adGroupName}` : undefined}
                            >
                              {a.label}
                            </span>
                          ))}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <span className="text-amber-700">⚠️ {t.audiencesEmpty || "No audience signals set — recommended for Demand Gen / Display / Video"}</span>
                )}
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              {/* Selected locations */}
              {editLocations.length > 0 ? (
                <div className="flex flex-wrap gap-1.5">
                  {editLocations.map((l) => (
                    <span key={l.id} className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full bg-blue-50 text-blue-700 border border-blue-200">
                      {l.name}
                      {l.targetType && <span className="text-blue-400 text-[10px]">{l.targetType}</span>}
                      <button
                        type="button"
                        onClick={() => setEditLocations(editLocations.filter((x) => x.id !== l.id))}
                        className="text-blue-400 hover:text-blue-700 cursor-pointer"
                      >×</button>
                    </span>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-amber-700">⚠️ {t.locationsWorldwide || "Worldwide (no targeting set)"}</p>
              )}

              {/* Search */}
              <div className="relative">
                <input
                  value={geoQuery}
                  onChange={(e) => setGeoQuery(e.target.value)}
                  placeholder={t.searchLocation || "Search state, city, postal code, DMA..."}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm outline-none focus:ring-2 focus:ring-red-500"
                />
                {geoQuery.trim().length >= 2 && (geoSearching || geoSuggestions.length > 0) && (
                  <div className="absolute z-10 mt-1 w-full bg-white border border-gray-200 rounded-lg shadow-lg max-h-64 overflow-y-auto">
                    {geoSearching && <div className="px-3 py-2 text-xs text-gray-400">{t.searching || "Searching..."}</div>}
                    {!geoSearching && geoSuggestions.length === 0 && <div className="px-3 py-2 text-xs text-gray-400">{t.noResults || "No results"}</div>}
                    {geoSuggestions.map((s) => {
                      const already = editLocations.some((sel) => sel.id === s.id);
                      return (
                        <button
                          type="button"
                          key={s.id}
                          disabled={already}
                          onClick={() => {
                            setEditLocations([...editLocations, { id: s.id, name: s.canonicalName || s.name, targetType: s.targetType }]);
                            setGeoQuery("");
                            setGeoSuggestions([]);
                          }}
                          className={`w-full text-left px-3 py-2 text-sm flex items-center justify-between gap-2 ${already ? "text-gray-400 cursor-not-allowed" : "hover:bg-gray-50 cursor-pointer"}`}
                        >
                          <span className="truncate">{s.canonicalName || s.name}</span>
                          <span className="text-xs text-gray-400 shrink-0">{s.targetType}</span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Quick country chips */}
              <div>
                <div className="text-xs text-gray-400 mb-1">{t.quickSelectCountries || "Quick-select countries"}:</div>
                <div className="flex flex-wrap gap-1.5">
                  {COUNTRIES.map((country) => {
                    const selected = editLocations.some((l) => l.id === country.id);
                    return (
                      <button
                        type="button"
                        key={country.id}
                        onClick={() => {
                          if (selected) {
                            setEditLocations(editLocations.filter((l) => l.id !== country.id));
                          } else {
                            setEditLocations([...editLocations, { id: country.id, name: country.name, targetType: "Country" }]);
                          }
                        }}
                        className={`text-xs px-2.5 py-1 rounded-full border transition-colors cursor-pointer ${
                          selected
                            ? "bg-blue-50 text-blue-700 border-blue-200"
                            : "bg-white text-gray-600 border-gray-200 hover:bg-gray-50"
                        }`}
                      >
                        {country.name}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Save / cancel */}
              <div className="flex gap-2 pt-1">
                <button
                  onClick={handleSaveLocations}
                  disabled={savingLocations}
                  className="bg-red-800 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-red-900 disabled:opacity-50 cursor-pointer"
                >
                  {savingLocations ? "..." : (t.save || "Save")}
                </button>
                <button
                  onClick={() => setEditingLocations(false)}
                  className="px-4 py-2 border border-gray-300 rounded-lg text-sm hover:bg-gray-50 cursor-pointer"
                >
                  {t.cancel || "Cancel"}
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Ad Groups */}
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-gray-700">{t.adGroupsSection || "Ad Groups"} {detail?.adGroups && `(${detail.adGroups.length})`}</h2>
            {!campaign.closed && (
              <button
                onClick={() => { setShowAgForm(!showAgForm); setAgError(""); }}
                className="text-xs px-3 py-1.5 bg-red-800 text-white rounded-lg hover:bg-red-900 cursor-pointer"
              >
                {showAgForm ? (t.cancel || "Cancel") : `+ ${t.addAdGroup || "Add Ad Group"}`}
              </button>
            )}
          </div>

          {showAgForm && (
            <div className="border border-gray-200 rounded-lg p-3 mb-3 space-y-2">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <input
                  value={agName}
                  onChange={(e) => setAgName(e.target.value)}
                  placeholder={t.adGroupName || "Ad group name"}
                  className="px-3 py-2 border border-gray-300 rounded-lg text-sm outline-none focus:ring-2 focus:ring-red-500"
                />
                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-500">{t.cpcBid || "Default CPC bid"} $</span>
                  <input
                    value={agCpcBid}
                    onChange={(e) => setAgCpcBid(e.target.value)}
                    type="number"
                    min="0.01"
                    step="0.01"
                    className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm outline-none focus:ring-2 focus:ring-red-500"
                  />
                </div>
              </div>
              {agError && (
                <pre className="text-xs text-red-600 bg-red-50 p-2 rounded whitespace-pre-wrap break-all">{agError}</pre>
              )}
              <div className="flex gap-2">
                <button
                  onClick={handleCreateAdGroup}
                  disabled={agSubmitting || !agName.trim() || Number(agCpcBid) <= 0}
                  className="bg-red-800 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-red-900 disabled:opacity-50 cursor-pointer"
                >
                  {agSubmitting ? (t.creating || "Creating...") : (t.create || "Create")}
                </button>
                <button onClick={() => { setShowAgForm(false); setAgError(""); }} className="px-4 py-2 border border-gray-300 rounded-lg text-sm hover:bg-gray-50 cursor-pointer">
                  {t.cancel || "Cancel"}
                </button>
              </div>
            </div>
          )}

          {!detail?.adGroups || detail.adGroups.length === 0 ? (
            <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 px-3 py-2 rounded-lg">
              ⚠️ {t.noAdGroupsWarning || "No ad groups yet. Add one before this campaign can serve ads."}
            </p>
          ) : (
            <div className="space-y-1.5">
              {detail.adGroups.map((ag) => (
                <div key={ag.resourceName} className="border border-gray-100 rounded-lg">
                  <div className="flex items-center justify-between px-3 py-2 text-sm">
                    <div>
                      <span className="font-medium text-gray-800">{ag.name}</span>
                      <span className={`ml-2 px-1.5 py-0.5 text-xs rounded-full ${
                        ag.status === "PAUSED" ? "bg-yellow-50 text-yellow-700" :
                        ag.status === "ENABLED" ? "bg-green-50 text-green-700" :
                        "bg-gray-100 text-gray-600"
                      }`}>{ag.status}</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-xs text-gray-500">CPC ${(ag.cpcBidMicros / 1_000_000).toFixed(2)}</span>
                      {!campaign.closed && (
                        <button
                          onClick={() => {
                            setAdFormFor(adFormFor === ag.resourceName ? null : ag.resourceName);
                            setAdError("");
                          }}
                          className="text-xs px-2 py-1 border border-blue-200 text-blue-700 rounded hover:bg-blue-50 cursor-pointer"
                        >
                          {adFormFor === ag.resourceName ? (t.cancel || "Cancel") : `+ ${t.addAd || "Add Ad"}`}
                        </button>
                      )}
                    </div>
                  </div>

                  {adFormFor === ag.resourceName && campaign.channel !== "VIDEO" && (
                    <div className="border-t border-gray-100 p-3 bg-gray-50 space-y-2">
                      <div className="text-xs font-semibold text-gray-700 mb-2">
                        {t.searchAdHeading || "Responsive Search Ad"} <span className="font-normal text-gray-400">· channel: {campaign.channel}</span>
                      </div>
                      <div>
                        <label className="block text-xs text-gray-500 mb-1">{t.adHeadlinesLabel || "Headlines (one per line, 3-15 lines, max 30 chars each)"}</label>
                        <textarea
                          value={adHeadlines}
                          onChange={(e) => setAdHeadlines(e.target.value)}
                          rows={4}
                          placeholder={t.headlinesPlaceholder || "Best Online Tutoring\nTry It Free Today\n..."}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm outline-none focus:ring-2 focus:ring-red-500 font-mono"
                        />
                        <div className="text-xs text-gray-400 mt-0.5">
                          {adHeadlines.split("\n").filter((s) => s.trim()).length} {t.lines || "lines"}
                        </div>
                      </div>
                      <div>
                        <label className="block text-xs text-gray-500 mb-1">{t.adDescriptionsLabel || "Descriptions (one per line, 2-4 lines, max 90 chars each)"}</label>
                        <textarea
                          value={adDescriptions}
                          onChange={(e) => setAdDescriptions(e.target.value)}
                          rows={3}
                          placeholder={t.descriptionsPlaceholder || "Personalized AI tutoring for K-12. Free trial.\n..."}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm outline-none focus:ring-2 focus:ring-red-500 font-mono"
                        />
                        <div className="text-xs text-gray-400 mt-0.5">
                          {adDescriptions.split("\n").filter((s) => s.trim()).length} {t.lines || "lines"}
                        </div>
                      </div>
                      <div>
                        <label className="block text-xs text-gray-500 mb-1">{t.adFinalUrlLabel || "Final URL"}</label>
                        <input
                          value={adFinalUrl}
                          onChange={(e) => setAdFinalUrl(e.target.value)}
                          placeholder="https://example.com/landing"
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm outline-none focus:ring-2 focus:ring-red-500"
                        />
                      </div>
                      {adError && <pre className="text-xs text-red-600 bg-red-50 p-2 rounded whitespace-pre-wrap break-all">{adError}</pre>}
                      <div className="flex gap-2">
                        <button
                          onClick={handleCreateAd}
                          disabled={adSubmitting}
                          className="bg-red-800 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-red-900 disabled:opacity-50 cursor-pointer"
                        >
                          {adSubmitting ? (t.creating || "Creating...") : (t.create || "Create")}
                        </button>
                        <button onClick={() => { setAdFormFor(null); setAdError(""); }} className="px-4 py-2 border border-gray-300 rounded-lg text-sm hover:bg-gray-50 cursor-pointer">
                          {t.cancel || "Cancel"}
                        </button>
                      </div>
                    </div>
                  )}

                  {adFormFor === ag.resourceName && campaign.channel === "VIDEO" && (
                    <div className="border-t border-gray-100 p-3 bg-gray-50 space-y-2">
                      <div className="text-xs font-semibold text-gray-700 mb-2">
                        {t.videoAdHeading || "Video Responsive Ad"} <span className="font-normal text-gray-400">· channel: VIDEO</span>
                      </div>
                      <div>
                        <label className="block text-xs text-gray-500 mb-1">{t.youtubeUrlLabel || "YouTube video URL or ID"}</label>
                        <input
                          value={vYoutubeUrl}
                          onChange={(e) => setVYoutubeUrl(e.target.value)}
                          placeholder="https://youtube.com/watch?v=MGoN28MHzeY"
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm outline-none focus:ring-2 focus:ring-red-500"
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-gray-500 mb-1">{t.longHeadlineLabel || "Long headline (max 90 chars)"}</label>
                        <input
                          value={vLongHeadline}
                          onChange={(e) => setVLongHeadline(e.target.value.slice(0, 90))}
                          placeholder="AI Voice Assistant for Teachers — Try Merlyn Free"
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm outline-none focus:ring-2 focus:ring-red-500"
                          maxLength={90}
                        />
                        <div className="text-xs text-gray-400 mt-0.5">{vLongHeadline.length}/90</div>
                      </div>
                      <div>
                        <label className="block text-xs text-gray-500 mb-1">{t.shortHeadlinesLabel || "Short headlines (one per line, 1-5 lines, max 15 chars each — used in some formats)"}</label>
                        <textarea
                          value={vShortHeadlines}
                          onChange={(e) => setVShortHeadlines(e.target.value)}
                          rows={3}
                          placeholder={"Try Merlyn\nAI for Teachers\nFree Trial"}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm outline-none focus:ring-2 focus:ring-red-500 font-mono"
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-gray-500 mb-1">{t.adDescriptionsLabel || "Descriptions (one per line, max 90 chars each)"}</label>
                        <textarea
                          value={vDescriptions}
                          onChange={(e) => setVDescriptions(e.target.value)}
                          rows={3}
                          placeholder="Voice-controlled AI for K-12 classrooms.\nSee how teachers save 10 hrs/week."
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm outline-none focus:ring-2 focus:ring-red-500 font-mono"
                        />
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        <div>
                          <label className="block text-xs text-gray-500 mb-1">{t.ctaLabel || "Call to action"}</label>
                          <select
                            value={vCta}
                            onChange={(e) => setVCta(e.target.value)}
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm cursor-pointer"
                          >
                            <option value="Subscribe">Subscribe</option>
                            <option value="Learn More">Learn More</option>
                            <option value="Try Free">Try Free</option>
                            <option value="Sign Up">Sign Up</option>
                            <option value="Watch More">Watch More</option>
                            <option value="Get Started">Get Started</option>
                          </select>
                        </div>
                        <div>
                          <label className="block text-xs text-gray-500 mb-1">{t.adFinalUrlLabel || "Final URL"}</label>
                          <input
                            value={vFinalUrl}
                            onChange={(e) => setVFinalUrl(e.target.value)}
                            placeholder="https://www.youtube.com/@merlynforeducation"
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm outline-none focus:ring-2 focus:ring-red-500"
                          />
                        </div>
                      </div>
                      {adError && <pre className="text-xs text-red-600 bg-red-50 p-2 rounded whitespace-pre-wrap break-all">{adError}</pre>}
                      <div className="flex gap-2">
                        <button
                          onClick={handleCreateVideoAd}
                          disabled={adSubmitting}
                          className="bg-red-800 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-red-900 disabled:opacity-50 cursor-pointer"
                        >
                          {adSubmitting ? (t.creating || "Creating...") : (t.create || "Create")}
                        </button>
                        <button onClick={() => { setAdFormFor(null); setAdError(""); }} className="px-4 py-2 border border-gray-300 rounded-lg text-sm hover:bg-gray-50 cursor-pointer">
                          {t.cancel || "Cancel"}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Keywords */}
        {detail?.keywords && detail.keywords.length > 0 && (
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <h2 className="text-sm font-semibold text-gray-700 mb-3">{t.keywordsSection || "Keywords"} ({detail.keywords.length})</h2>
            <div className="flex flex-wrap gap-1.5">
              {detail.keywords.map((kw, i) => (
                <span key={i} className="px-2 py-0.5 bg-gray-100 text-gray-700 text-xs rounded-full">
                  {kw.text} <span className="text-gray-400">[{kw.matchType}]</span>
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Ads */}
        {detail?.ads && detail.ads.length > 0 && (
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <h2 className="text-sm font-semibold text-gray-700 mb-3">{t.adsSection || "Ads"} ({detail.ads.length})</h2>
            <div className="space-y-4">
              {detail.ads.map((ad, i) => (
                <div key={i} className="border border-gray-100 rounded-lg p-4">
                  {/* Header */}
                  <div className="flex flex-wrap items-center gap-2 mb-3">
                    <span className="font-medium text-gray-800">{ad.name || `Ad #${i + 1}`}</span>
                    <span className={`px-1.5 py-0.5 text-xs rounded-full ${
                      ad.status === "ENABLED" ? "bg-green-50 text-green-700" :
                      ad.status === "PAUSED" ? "bg-yellow-50 text-yellow-700" :
                      "bg-gray-100 text-gray-600"
                    }`}>{ad.status}</span>
                    {ad.type && <span className="px-1.5 py-0.5 bg-blue-50 text-blue-700 text-xs rounded-full">{ad.type}</span>}
                  </div>

                  {/* Videos */}
                  {ad.videos.length > 0 && (
                    <div className="mb-3 grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {ad.videos.map((v, idx) => (
                        <div key={idx} className="flex gap-2 items-start bg-gray-50 rounded p-2">
                          {v.youtubeVideoId ? (
                            <a href={`https://www.youtube.com/watch?v=${v.youtubeVideoId}`} target="_blank" rel="noreferrer" className="shrink-0">
                              <img src={`https://i.ytimg.com/vi/${v.youtubeVideoId}/default.jpg`} alt={v.title} className="w-24 h-auto rounded" />
                            </a>
                          ) : null}
                          <div className="text-xs min-w-0">
                            {v.title && <div className="text-gray-800 truncate font-medium">{v.title}</div>}
                            {v.youtubeVideoId && (
                              <a href={`https://www.youtube.com/watch?v=${v.youtubeVideoId}`} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline break-all">
                                youtube.com/watch?v={v.youtubeVideoId}
                              </a>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Headlines */}
                  {ad.headlines.length > 0 && (
                    <div className="mb-2">
                      <div className="text-xs text-gray-500 mb-1">{t.headlines || "Headlines"} ({ad.headlines.length})</div>
                      <div className="flex flex-wrap gap-1">
                        {ad.headlines.map((h, idx) => (
                          <span key={idx} className="text-xs px-2 py-0.5 bg-gray-100 rounded text-gray-800">{h}</span>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Long headlines */}
                  {ad.longHeadlines.length > 0 && (
                    <div className="mb-2">
                      <div className="text-xs text-gray-500 mb-1">{t.longHeadlineLabel || "Long headlines"} ({ad.longHeadlines.length})</div>
                      <ul className="text-sm text-gray-700 space-y-0.5">
                        {ad.longHeadlines.map((h, idx) => <li key={idx}>• {h}</li>)}
                      </ul>
                    </div>
                  )}

                  {/* Descriptions */}
                  {ad.descriptions.length > 0 && (
                    <div className="mb-2">
                      <div className="text-xs text-gray-500 mb-1">{t.descriptions || "Descriptions"} ({ad.descriptions.length})</div>
                      <ul className="text-sm text-gray-600 space-y-0.5">
                        {ad.descriptions.map((d, idx) => <li key={idx}>• {d}</li>)}
                      </ul>
                    </div>
                  )}

                  {/* CTA */}
                  {ad.callToActions.length > 0 && (
                    <div className="mb-2">
                      <span className="text-xs text-gray-500">{t.ctaLabel || "Call to action"}: </span>
                      {ad.callToActions.map((c, idx) => (
                        <span key={idx} className="text-xs px-2 py-0.5 bg-emerald-50 text-emerald-700 rounded ml-1">{c}</span>
                      ))}
                    </div>
                  )}

                  {/* Final URL */}
                  {ad.finalUrls.length > 0 && (
                    <div className="text-xs pt-2 border-t border-gray-100 mt-2">
                      <span className="text-gray-500">{t.finalUrl || "Final URL"}: </span>
                      {ad.finalUrls.map((url, idx) => (
                        <a key={idx} href={url} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline break-all">{url}</a>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>

            <p className="text-xs text-gray-400 mt-3">
              ℹ️ {t.adImmutableNote || "Ad creative content (headlines, descriptions, videos) is immutable in Google Ads — to change them, create a new ad and remove the old one."}
            </p>
          </div>
        )}
      </div>
    </DashboardShell>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs text-gray-500 mb-0.5">{label}</div>
      <div className="text-base font-semibold text-gray-900">{value}</div>
    </div>
  );
}
