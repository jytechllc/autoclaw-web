"use client";

import { useUser } from "@auth0/nextjs-auth0/client";
import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { getDictionary, type Locale } from "@/lib/i18n";
import DashboardShell from "@/components/DashboardShell";
import { useOrg } from "@/components/OrgContext";
import { COUNTRIES } from "@/lib/google-ads";
import { toCsv, downloadCsv } from "@/lib/csv";

interface Campaign {
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
}

interface Credits {
  balance_cents: number | string;
  reserved_cents: number | string;
  currency: string;
}

const CHANNELS = ["SEARCH", "DISPLAY", "SHOPPING", "VIDEO", "DEMAND_GEN", "PERFORMANCE_MAX"] as const;
const CHANNELS_DISABLED_FOR_API_CREATE: ReadonlyArray<typeof CHANNELS[number]> = ["VIDEO", "DEMAND_GEN"];
// PMAX is creatable via API (PR #16 KAN-51), but the shell-only — asset groups,
// audience signals, and conversion goals are required before it serves. See PR #18.
const CHANNELS_REQUIRING_FOLLOWUP: ReadonlyArray<typeof CHANNELS[number]> = ["PERFORMANCE_MAX"];

function fromCents(cents: number | string | null | undefined): number {
  return Number(cents || 0) / 100;
}

function formatUsd(cents: number | string | null | undefined): string {
  return `$${fromCents(cents).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default function GoogleAdsPage() {
  const { user } = useUser();
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const locale = (params.locale as Locale) || "en";
  const dict = getDictionary(locale);
  const t = dict.googleAdsPage;
  const { activeOrg, isReadOnly } = useOrg();
  const orgIdParam = activeOrg ? `?org_id=${activeOrg.id}` : "";

  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [credits, setCredits] = useState<Credits | null>(null);
  const [loading, setLoading] = useState(true);

  // Create form
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [dailyBudget, setDailyBudget] = useState("10");
  const [totalBudget, setTotalBudget] = useState("100");
  const [channel, setChannel] = useState<typeof CHANNELS[number]>("SEARCH");
  // Selected locations: full objects so we can render their names without re-fetching
  const [selectedLocations, setSelectedLocations] = useState<Array<{ id: string; name: string; targetType?: string }>>([
    { id: "2840", name: "United States", targetType: "Country" },
  ]);
  const locationIds = selectedLocations.map((l) => l.id);
  // Geo search
  const [geoQuery, setGeoQuery] = useState("");
  const [geoSuggestions, setGeoSuggestions] = useState<Array<{ id: string; name: string; canonicalName: string; targetType: string; countryCode: string }>>([]);
  const [geoSearching, setGeoSearching] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  // Top-up
  const [showTopup, setShowTopup] = useState(false);
  const [topupAmount, setTopupAmount] = useState("100");
  const [topupSubmitting, setTopupSubmitting] = useState(false);

  const [toast, setToast] = useState("");
  const [syncing, setSyncing] = useState(false);
  const [actioningId, setActioningId] = useState<number | null>(null);

  // Import existing
  interface DiscoverCampaign {
    resourceName: string;
    id: string;
    name: string;
    status: string;
    channelType: string;
    metrics: { costMicros: number; impressions: number; clicks: number };
    managed: boolean;
  }
  const [showImport, setShowImport] = useState(false);
  const [discovering, setDiscovering] = useState(false);
  const [discovered, setDiscovered] = useState<DiscoverCampaign[]>([]);
  const [importingResource, setImportingResource] = useState<string | null>(null);
  const [importBudget, setImportBudget] = useState("100");

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [c, cr] = await Promise.all([
        fetch(`/api/google-ads/campaigns${orgIdParam}`).then((r) => r.json()),
        fetch(`/api/credits${orgIdParam}`).then((r) => r.json()),
      ]);
      setCampaigns(c.campaigns || []);
      setCredits(cr.credits || { balance_cents: 0, reserved_cents: 0, currency: "USD" });
    } catch {
      setCampaigns([]);
      setCredits({ balance_cents: 0, reserved_cents: 0, currency: "USD" });
    }
    setLoading(false);
  }, [orgIdParam]);

  // Handle Stripe redirect with ?topup=success&session_id=...
  useEffect(() => {
    const topup = searchParams.get("topup");
    const sessionId = searchParams.get("session_id");
    if (topup === "success" && sessionId) {
      fetch(`/api/credits/verify?session_id=${sessionId}`)
        .then((r) => r.json())
        .then((data) => {
          if (data.status === "success") {
            setToast(`${t.topupSuccess || "Top-up successful"}: ${formatUsd(data.amountCents)}`);
            setTimeout(() => setToast(""), 4000);
          }
          fetchAll();
          router.replace(`/${locale}/dashboard/google-ads`);
        });
    } else if (topup === "cancel") {
      setToast(t.topupCancelled || "Top-up cancelled");
      setTimeout(() => setToast(""), 3000);
      router.replace(`/${locale}/dashboard/google-ads`);
    }
  }, [searchParams, fetchAll, router, locale, t]);

  useEffect(() => {
    if (user) fetchAll();
  }, [user, fetchAll]);

  // Debounced geo search
  useEffect(() => {
    if (geoQuery.trim().length < 2) {
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
      } catch { /* aborted or failed */ }
      setGeoSearching(false);
    }, 300);
    return () => { clearTimeout(timer); ctrl.abort(); };
  }, [geoQuery]);

  async function handleCreate() {
    if (!name.trim() || Number(dailyBudget) <= 0 || Number(totalBudget) <= 0) return;
    setSubmitting(true);
    setError("");
    try {
      const res = await fetch("/api/google-ads/campaigns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          dailyBudget: Number(dailyBudget),
          totalBudget: Number(totalBudget),
          channel,
          locationIds,
          orgId: activeOrg?.id,
        }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setShowForm(false);
        setName("");
        setDailyBudget("10");
        setTotalBudget("100");
        setChannel("SEARCH");
        fetchAll();
        if (data.warnings && data.warnings.length > 0) {
          // Partial success — show errors for the steps that failed
          alert(
            `${t.createdWithWarnings || "Campaign created with warnings"}:\n\n` +
            data.warnings.map((w: { step: string; details: unknown }) =>
              `[${w.step}] ${JSON.stringify(w.details, null, 2)}`).join("\n\n")
          );
        } else {
          setToast(t.createdToast || "Campaign created (paused)");
          setTimeout(() => setToast(""), 3000);
        }
      } else if (res.status === 402) {
        setError(`${t.insufficientCredits || "Insufficient credits"} (${formatUsd(data.balanceCents)} / ${formatUsd(data.requestedCents)})`);
      } else {
        setError(data.error || "Failed to create campaign");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create campaign");
    }
    setSubmitting(false);
  }

  async function openImport() {
    setShowImport(true);
    setDiscovering(true);
    try {
      const res = await fetch(`/api/google-ads/campaigns/discover${orgIdParam}`);
      const data = await res.json();
      setDiscovered(data.campaigns || []);
    } catch {
      setDiscovered([]);
    }
    setDiscovering(false);
  }

  async function handleImport(resourceName: string) {
    const budget = Number(importBudget);
    if (!Number.isFinite(budget) || budget <= 0) {
      setToast(t.invalidBudget || "Invalid budget");
      setTimeout(() => setToast(""), 3000);
      return;
    }
    setImportingResource(resourceName);
    try {
      const res = await fetch("/api/google-ads/campaigns/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resourceName, totalBudget: budget, orgId: activeOrg?.id }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setToast(`${t.importSuccess || "Imported"}: ${data.name}`);
        setShowImport(false);
        fetchAll();
        setTimeout(() => setToast(""), 3000);
      } else if (res.status === 402) {
        setToast(`${t.insufficientCredits || "Insufficient credits"} (${formatUsd(data.balanceCents)} / ${formatUsd(data.requestedCents)})`);
        setTimeout(() => setToast(""), 4000);
      } else {
        setToast(data.error || "Import failed");
        setTimeout(() => setToast(""), 4000);
      }
    } catch (e) {
      setToast(e instanceof Error ? e.message : "Import failed");
      setTimeout(() => setToast(""), 3000);
    }
    setImportingResource(null);
  }

  async function handleSync() {
    setSyncing(true);
    try {
      const res = await fetch("/api/google-ads/campaigns/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orgId: activeOrg?.id }),
      });
      const data = await res.json();
      if (res.ok) {
        const closedNote = data.autoClosed?.length
          ? ` · ${data.autoClosed.length} ${t.autoClosed || "auto-closed"}`
          : "";
        setToast(`${t.syncDone || "Synced"} ${data.campaignsSynced}${closedNote}`);
        fetchAll();
      } else {
        setToast(data.error || "Sync failed");
      }
      setTimeout(() => setToast(""), 4000);
    } catch (e) {
      setToast(e instanceof Error ? e.message : "Sync failed");
      setTimeout(() => setToast(""), 3000);
    }
    setSyncing(false);
  }

  async function handleAction(id: number, action: "pause" | "enable" | "close") {
    if (action === "close" && !window.confirm(t.confirmClose || "Close this campaign and refund unspent budget?")) return;
    setActioningId(id);
    try {
      const res = await fetch(`/api/google-ads/campaigns/${id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, orgId: activeOrg?.id }),
      });
      const data = await res.json();
      if (res.ok) {
        const releasedNote = data.releasedCents > 0
          ? ` · ${t.refunded || "Refunded"} ${formatUsd(data.releasedCents)}`
          : "";
        setToast(`${t[`action_${action}` as "action_pause" | "action_enable" | "action_close"] || action}${releasedNote}`);
        fetchAll();
      } else {
        setToast(data.error || "Action failed");
      }
      setTimeout(() => setToast(""), 3000);
    } catch (e) {
      setToast(e instanceof Error ? e.message : "Action failed");
      setTimeout(() => setToast(""), 3000);
    }
    setActioningId(null);
  }

  async function handleTopup() {
    const amount = Number(topupAmount);
    if (!Number.isFinite(amount) || amount < 10) return;
    setTopupSubmitting(true);
    try {
      const res = await fetch("/api/credits/topup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amountUsd: amount, locale, orgId: activeOrg?.id }),
      });
      const data = await res.json();
      if (res.ok && data.url) {
        window.location.href = data.url;
      } else {
        setToast(data.error || "Top-up failed");
        setTimeout(() => setToast(""), 3000);
      }
    } catch (e) {
      setToast(e instanceof Error ? e.message : "Top-up failed");
      setTimeout(() => setToast(""), 3000);
    }
    setTopupSubmitting(false);
  }

  if (!user) return null;

  const balance = fromCents(credits?.balance_cents);
  const reserved = fromCents(credits?.reserved_cents);
  const totalRequested = Number(totalBudget) || 0;
  const insufficient = totalRequested > balance;

  return (
    <DashboardShell user={user} plan={undefined}>
      <div className="p-4 sm:p-6 max-w-5xl mx-auto space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">{t.title}</h1>
            <p className="text-gray-500 mt-1">
              {t.subtitle}
              {activeOrg && <span className="ml-2 text-xs px-2 py-0.5 rounded-full bg-blue-50 text-blue-700">{activeOrg.name}</span>}
            </p>
          </div>
          <div className="flex flex-wrap gap-2 self-start">
            <Link
              href={`/${locale}/dashboard/google-ads/conversions`}
              className="border border-gray-300 px-4 py-2 rounded-lg text-sm font-medium hover:bg-gray-50 transition cursor-pointer"
            >
              🎯 {t.convTitle || "Conversion Tracking"}
            </Link>
            {!isReadOnly && (
              <>
                <button
                  onClick={openImport}
                  className="border border-gray-300 px-4 py-2 rounded-lg text-sm font-medium hover:bg-gray-50 transition cursor-pointer"
                >
                  ↘️ {t.importExisting || "Import existing"}
                </button>
                <button
                  onClick={() => { setShowForm(!showForm); setError(""); }}
                  className="bg-red-800 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-red-900 transition cursor-pointer"
                >
                  {showForm ? t.cancel : `+ ${t.createCampaign}`}
                </button>
              </>
            )}
          </div>
        </div>

        {toast && (
          <div className="fixed top-4 right-4 z-50 bg-green-600 text-white px-4 py-2 rounded-lg shadow-lg text-sm">
            {toast}
          </div>
        )}

        {/* Import existing campaign dialog */}
        {showImport && (
          <div className="fixed inset-0 z-40 bg-black/50 flex items-start justify-center pt-16 pb-8 px-4 overflow-y-auto" onClick={() => setShowImport(false)}>
            <div className="bg-white rounded-xl max-w-3xl w-full p-5 sm:p-6 max-h-[80vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-lg font-bold text-gray-900">{t.importTitle || "Import existing Google Ads campaigns"}</h2>
                <button onClick={() => setShowImport(false)} className="text-gray-400 hover:text-gray-700 cursor-pointer">✕</button>
              </div>
              <p className="text-xs text-gray-500 mb-4">{t.importDesc || "Pick a campaign that already exists on Google Ads and bring it under AutoClaw budget management. Spend will sync automatically."}</p>

              <div className="flex items-center gap-2 mb-4 bg-blue-50 border border-blue-200 rounded-lg p-3">
                <span className="text-xs text-gray-500">{t.budgetCapForImport || "Budget cap for selected campaign"}: $</span>
                <input
                  type="number"
                  min="1"
                  value={importBudget}
                  onChange={(e) => setImportBudget(e.target.value)}
                  className="px-3 py-1.5 border border-blue-200 rounded text-sm w-28 outline-none focus:ring-2 focus:ring-blue-400"
                />
                <span className="text-xs text-gray-500 ml-auto">{t.balance}: {formatUsd(credits?.balance_cents)}</span>
              </div>

              {discovering ? (
                <div className="p-8 text-center text-gray-400 text-sm">{t.searching || "Searching..."}</div>
              ) : discovered.length === 0 ? (
                <div className="p-8 text-center text-gray-400 text-sm">{t.noCampaignsFound || "No campaigns found on Google Ads"}</div>
              ) : (
                <div className="space-y-2">
                  {discovered.map((c) => {
                    const spentUsd = (c.metrics.costMicros / 1_000_000).toFixed(2);
                    return (
                      <div key={c.resourceName} className={`border rounded-lg p-3 flex items-center justify-between gap-3 ${c.managed ? "bg-gray-50 opacity-70" : "bg-white"}`}>
                        <div className="flex-1 min-w-0">
                          <div className="font-medium text-gray-800 truncate">{c.name || "(unnamed)"}</div>
                          <div className="text-xs text-gray-500 mt-0.5 flex flex-wrap gap-2">
                            <span className="px-1.5 py-0.5 bg-gray-100 rounded">{c.channelType}</span>
                            <span className={`px-1.5 py-0.5 rounded ${c.status === "ENABLED" ? "bg-green-50 text-green-700" : c.status === "PAUSED" ? "bg-yellow-50 text-yellow-700" : "bg-gray-100"}`}>{c.status}</span>
                            {!isReadOnly && <span>{t.spent || "Spent"}: ${spentUsd}</span>}
                            <span>{c.metrics.clicks} {t.clicksLabel || "clicks"}</span>
                          </div>
                        </div>
                        {c.managed ? (
                          <span className="text-xs text-gray-500 px-3 py-1 shrink-0">✓ {t.alreadyManaged || "Managed"}</span>
                        ) : (
                          <button
                            onClick={() => handleImport(c.resourceName)}
                            disabled={importingResource === c.resourceName}
                            className="text-xs px-3 py-1.5 bg-red-800 text-white rounded hover:bg-red-900 disabled:opacity-50 cursor-pointer shrink-0"
                          >
                            {importingResource === c.resourceName ? "..." : (t.importBtn || "Import")}
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Credits card */}
        <div className="bg-white rounded-xl border border-gray-200 p-5 sm:p-6">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div className="flex flex-wrap gap-6">
              <div>
                <div className="text-xs text-gray-500 mb-1">{t.balance || "Balance"}</div>
                <div className="text-2xl font-bold text-gray-900">{formatUsd(credits?.balance_cents)}</div>
              </div>
              <div>
                <div className="text-xs text-gray-500 mb-1">{t.reserved || "Reserved"}</div>
                <div className="text-2xl font-semibold text-gray-700">{formatUsd(credits?.reserved_cents)}</div>
              </div>
              <div>
                <div className="text-xs text-gray-500 mb-1">{t.total || "Total"}</div>
                <div className="text-2xl font-semibold text-gray-500">{formatUsd((Number(credits?.balance_cents || 0) + Number(credits?.reserved_cents || 0)))}</div>
              </div>
            </div>
            <button
              onClick={() => setShowTopup(!showTopup)}
              className="bg-emerald-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-emerald-700 transition cursor-pointer self-start"
            >
              {showTopup ? t.cancel : `+ ${t.topup || "Top up"}`}
            </button>
          </div>

          {showTopup && (
            <div className="mt-4 pt-4 border-t border-gray-100 space-y-3">
              <p className="text-xs text-gray-500">{t.topupNote || "Funds added to your AutoClaw ad credits balance via Stripe."}</p>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm text-gray-500">$</span>
                <input
                  type="number"
                  min="10"
                  step="10"
                  value={topupAmount}
                  onChange={(e) => setTopupAmount(e.target.value)}
                  className="px-3 py-2 border border-gray-300 rounded-lg text-sm w-32 outline-none focus:ring-2 focus:ring-emerald-500"
                />
                {[50, 100, 500, 1000].map((preset) => (
                  <button
                    key={preset}
                    onClick={() => setTopupAmount(String(preset))}
                    className="text-xs px-3 py-1.5 border border-gray-200 rounded-lg hover:bg-gray-50 cursor-pointer"
                  >
                    ${preset}
                  </button>
                ))}
                <button
                  onClick={handleTopup}
                  disabled={topupSubmitting || Number(topupAmount) < 10}
                  className="bg-emerald-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-emerald-700 disabled:opacity-50 cursor-pointer ml-auto"
                >
                  {topupSubmitting ? t.processing || "Processing..." : t.payWithStripe || "Pay with Stripe"}
                </button>
              </div>
            </div>
          )}
        </div>

        {showForm && (
          <div className="bg-white rounded-xl border border-gray-200 p-5 sm:p-6 space-y-4">
            <h2 className="font-semibold text-gray-900">{t.createCampaign}</h2>
            <p className="text-xs text-gray-500">{t.createNote}</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t.campaignName}
                className="px-3 py-2 border border-gray-300 rounded-lg text-sm outline-none focus:ring-2 focus:ring-red-500 sm:col-span-2"
              />
              <div>
                <label className="block text-xs text-gray-500 mb-1">{t.totalBudget || "Total budget cap (USD)"}</label>
                <input
                  value={totalBudget}
                  onChange={(e) => setTotalBudget(e.target.value)}
                  type="number"
                  min="1"
                  step="1"
                  className={`w-full px-3 py-2 border rounded-lg text-sm outline-none focus:ring-2 ${
                    insufficient ? "border-red-300 focus:ring-red-500" : "border-gray-300 focus:ring-red-500"
                  }`}
                />
                <div className="text-xs text-gray-500 mt-1">
                  {t.budgetWillReserve || "Will reserve this amount from your balance"} · {t.balance || "Balance"}: {formatUsd(credits?.balance_cents)}
                </div>
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">{t.dailyBudget}</label>
                <input
                  value={dailyBudget}
                  onChange={(e) => setDailyBudget(e.target.value)}
                  type="number"
                  min="1"
                  step="1"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm outline-none focus:ring-2 focus:ring-red-500"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">{t.channel}</label>
                <select
                  value={channel}
                  onChange={(e) => setChannel(e.target.value as typeof CHANNELS[number])}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm cursor-pointer"
                >
                  {CHANNELS.map((c) => {
                    const blocked = CHANNELS_DISABLED_FOR_API_CREATE.includes(c);
                    return (
                      <option key={c} value={c} disabled={blocked}>
                        {blocked ? `${c} — ${t.videoDisabledLabel || "use Import"}` : c}
                      </option>
                    );
                  })}
                </select>
                {CHANNELS_DISABLED_FOR_API_CREATE.includes(channel) && (
                  <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 px-2 py-1.5 rounded mt-1">
                    ⚠️ {t.videoCreateBlocked || "Video / Demand Gen campaign creation via API is currently disabled. Please create it in Google Ads UI, then use \"Import existing\" to bring it under AutoClaw budget management. See Docs for steps."}
                  </p>
                )}
                {CHANNELS_REQUIRING_FOLLOWUP.includes(channel) && (
                  <p className="text-xs text-blue-700 bg-blue-50 border border-blue-200 px-2 py-1.5 rounded mt-1">
                    ℹ️ {t.pmaxShellOnly || "PMAX shell will be created PAUSED. Asset groups, audience signals, and conversion goals are required before it can serve — coming in follow-up PRs."}
                  </p>
                )}
              </div>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">{t.locations || "Locations"}</label>

              {/* Selected locations as removable chips */}
              {selectedLocations.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {selectedLocations.map((l) => (
                    <span key={l.id} className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full bg-blue-50 text-blue-700 border border-blue-200">
                      {l.name}
                      {l.targetType && <span className="text-blue-400 text-[10px]">{l.targetType}</span>}
                      <button
                        type="button"
                        onClick={() => setSelectedLocations(selectedLocations.filter((s) => s.id !== l.id))}
                        className="text-blue-400 hover:text-blue-700 cursor-pointer"
                        aria-label="Remove"
                      >×</button>
                    </span>
                  ))}
                </div>
              )}

              {/* Search any location (state, city, postal code, etc.) */}
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
                      const alreadySelected = selectedLocations.some((sel) => sel.id === s.id);
                      return (
                        <button
                          type="button"
                          key={s.id}
                          disabled={alreadySelected}
                          onClick={() => {
                            setSelectedLocations([...selectedLocations, { id: s.id, name: s.canonicalName || s.name, targetType: s.targetType }]);
                            setGeoQuery("");
                            setGeoSuggestions([]);
                          }}
                          className={`w-full text-left px-3 py-2 text-sm flex items-center justify-between gap-2 ${
                            alreadySelected ? "text-gray-400 cursor-not-allowed" : "hover:bg-gray-50 cursor-pointer"
                          }`}
                        >
                          <span className="truncate">{s.canonicalName || s.name}</span>
                          <span className="text-xs text-gray-400 shrink-0">{s.targetType}</span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Quick-select country chips */}
              <div className="mt-2">
                <div className="text-xs text-gray-400 mb-1">{t.quickSelectCountries || "Quick-select countries"}:</div>
                <div className="flex flex-wrap gap-1.5">
                  {COUNTRIES.map((country) => {
                    const selected = locationIds.includes(country.id);
                    return (
                      <button
                        type="button"
                        key={country.id}
                        onClick={() => {
                          if (selected) {
                            setSelectedLocations(selectedLocations.filter((l) => l.id !== country.id));
                          } else {
                            setSelectedLocations([...selectedLocations, { id: country.id, name: country.name, targetType: "Country" }]);
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

              {locationIds.length === 0 && (
                <p className="text-xs text-amber-700 mt-2">⚠️ {t.noLocationsWarning || "No locations selected — campaign will target worldwide and may waste budget"}</p>
              )}
            </div>
            {insufficient && (
              <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 px-3 py-2 rounded-lg">
                {t.insufficientCredits || "Insufficient credits"} — {t.topupPromptShort || "top up to continue"}.
              </p>
            )}
            {error && <p className="text-sm text-red-600">{error}</p>}
            <div className="flex gap-2">
              <button
                onClick={handleCreate}
                disabled={submitting || !name.trim() || Number(dailyBudget) <= 0 || Number(totalBudget) <= 0 || insufficient}
                className="bg-red-800 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-red-900 disabled:opacity-50 cursor-pointer"
              >
                {submitting ? t.creating : t.create}
              </button>
              <button
                onClick={() => { setShowForm(false); setError(""); }}
                className="px-4 py-2 border border-gray-300 rounded-lg text-sm hover:bg-gray-50 cursor-pointer"
              >
                {t.cancel}
              </button>
            </div>
          </div>
        )}

        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-200 flex items-center justify-between gap-3">
            <h2 className="font-semibold text-gray-800">{t.campaigns}</h2>
            <div className="flex items-center gap-3">
              <span className="text-xs text-gray-500">{campaigns.length} {t.total}</span>
              {!isReadOnly && campaigns.length > 0 && (
                <button
                  onClick={() => {
                    const csv = toCsv(
                      ["ID", "Name", "Channel", "Status", "Closed", "Daily Budget (USD)", "Cap (USD)", "Spent (USD)", "Reserved (USD)", "Created"],
                      campaigns.map((c) => [
                        c.platform_campaign_id?.split("/").pop() || c.id,
                        c.campaign_name,
                        c.channel,
                        c.status,
                        c.closed ? "yes" : "no",
                        Number(c.daily_budget || 0).toFixed(2),
                        fromCents(c.total_budget_cents).toFixed(2),
                        fromCents(c.spent_cents).toFixed(2),
                        fromCents(c.reserved_cents).toFixed(2),
                        c.created_at?.slice(0, 10) || "",
                      ])
                    );
                    downloadCsv(`google-ads-campaigns-${new Date().toISOString().slice(0, 10)}`, csv);
                  }}
                  className="text-xs px-3 py-1.5 border border-gray-200 rounded-lg hover:bg-gray-50 cursor-pointer"
                >
                  ⬇ {t.exportCsv || "Export CSV"}
                </button>
              )}
              <button
                onClick={handleSync}
                disabled={syncing || campaigns.length === 0}
                className="text-xs px-3 py-1.5 border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-50 cursor-pointer flex items-center gap-1.5"
                title={t.syncTooltip || "Pull latest spend from Google Ads"}
              >
                <svg className={`w-3.5 h-3.5 ${syncing ? "animate-spin" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                {syncing ? (t.syncing || "Syncing...") : (t.syncNow || "Sync")}
              </button>
            </div>
          </div>
          {loading ? (
            <div className="p-8 text-center text-gray-400 text-sm">{t.loading || "Loading..."}</div>
          ) : campaigns.length === 0 ? (
            <div className="p-8 text-center text-gray-400 text-sm">{t.noCampaigns}</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-xs text-gray-500">
                  <tr>
                    <th className="text-left px-4 py-2 font-medium">{t.campaignName}</th>
                    <th className="text-left px-4 py-2 font-medium">{t.channel}</th>
                    {!isReadOnly && <th className="text-left px-4 py-2 font-medium">{t.dailyBudget}</th>}
                    {!isReadOnly && <th className="text-left px-4 py-2 font-medium">{t.totalBudget || "Cap"}</th>}
                    {!isReadOnly && <th className="text-left px-4 py-2 font-medium">{t.spent || "Spent"}</th>}
                    <th className="text-left px-4 py-2 font-medium">{t.status}</th>
                    <th className="text-right px-4 py-2 font-medium">{t.actions || "Actions"}</th>
                  </tr>
                </thead>
                <tbody>
                  {campaigns.map((c) => {
                    const cap = Number(c.total_budget_cents || 0);
                    const spent = Number(c.spent_cents || 0);
                    const pct = cap > 0 ? Math.min(100, (spent / cap) * 100) : 0;
                    return (
                      <tr key={c.id} className="border-t border-gray-100 hover:bg-gray-50 cursor-pointer" onClick={() => router.push(`/${locale}/dashboard/google-ads/${c.id}`)}>
                        <td className="px-4 py-3">
                          <div className="text-blue-700 font-medium hover:underline">{c.campaign_name}</div>
                          <div className="text-[11px] font-mono text-gray-400 mt-0.5" title={c.platform_campaign_id}>
                            ID: {c.platform_campaign_id?.split("/").pop() || c.platform_campaign_id}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-gray-600">{c.channel}</td>
                        {!isReadOnly && <td className="px-4 py-3 text-gray-600">${Number(c.daily_budget).toFixed(2)}</td>}
                        {!isReadOnly && <td className="px-4 py-3 text-gray-600">{formatUsd(c.total_budget_cents)}</td>}
                        {!isReadOnly && (
                          <td className="px-4 py-3 text-gray-600">
                            <div>{formatUsd(c.spent_cents)}</div>
                            {cap > 0 && (
                              <div className="w-24 h-1.5 bg-gray-100 rounded-full overflow-hidden mt-1">
                                <div className={`h-full ${pct >= 100 ? "bg-red-500" : pct >= 80 ? "bg-amber-500" : "bg-emerald-500"}`} style={{ width: `${pct}%` }} />
                              </div>
                            )}
                          </td>
                        )}
                        <td className="px-4 py-3">
                          <span className={`px-2 py-0.5 text-xs rounded-full ${
                            c.closed ? "bg-gray-200 text-gray-600" :
                            c.status === "PAUSED" ? "bg-yellow-50 text-yellow-700" :
                            c.status === "ENABLED" ? "bg-green-50 text-green-700" :
                            "bg-gray-100 text-gray-600"
                          }`}>{c.closed ? (t.statusClosed || "CLOSED") : c.status}</span>
                        </td>
                        <td className="px-4 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                          {c.closed ? (
                            <span className="text-xs text-gray-400">—</span>
                          ) : (
                            <div className="flex items-center gap-1.5 justify-end">
                              {c.status === "PAUSED" ? (
                                <button
                                  onClick={(e) => { e.stopPropagation(); handleAction(c.id, "enable"); }}
                                  disabled={actioningId === c.id}
                                  className="text-xs px-2 py-1 border border-green-200 text-green-700 rounded hover:bg-green-50 disabled:opacity-50 cursor-pointer"
                                >
                                  {t.action_enable || "Enable"}
                                </button>
                              ) : (
                                <button
                                  onClick={(e) => { e.stopPropagation(); handleAction(c.id, "pause"); }}
                                  disabled={actioningId === c.id}
                                  className="text-xs px-2 py-1 border border-amber-200 text-amber-700 rounded hover:bg-amber-50 disabled:opacity-50 cursor-pointer"
                                >
                                  {t.action_pause || "Pause"}
                                </button>
                              )}
                              <button
                                onClick={(e) => { e.stopPropagation(); handleAction(c.id, "close"); }}
                                disabled={actioningId === c.id}
                                className="text-xs px-2 py-1 border border-red-200 text-red-700 rounded hover:bg-red-50 disabled:opacity-50 cursor-pointer"
                              >
                                {t.action_close || "Close"}
                              </button>
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </DashboardShell>
  );
}
