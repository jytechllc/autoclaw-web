"use client";

import { useUser } from "@auth0/nextjs-auth0/client";
import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { getDictionary, type Locale } from "@/lib/i18n";
import DashboardShell from "@/components/DashboardShell";
import { useOrg } from "@/components/OrgContext";

interface AccountAsset {
  resourceName: string;
  id: string;
  type: string;
  label: string;
  detail: string;
  imageUrl?: string;
  campaignCount: number;
}

const TYPE_FILTERS = ["ALL", "IMAGE", "SITELINK", "CALLOUT", "STRUCTURED_SNIPPET", "YOUTUBE_VIDEO", "TEXT"] as const;

const TYPE_BADGES: Record<string, string> = {
  IMAGE: "bg-blue-50 text-blue-700",
  SITELINK: "bg-sky-50 text-sky-700",
  CALLOUT: "bg-emerald-50 text-emerald-700",
  STRUCTURED_SNIPPET: "bg-purple-50 text-purple-700",
  YOUTUBE_VIDEO: "bg-red-50 text-red-700",
  TEXT: "bg-gray-100 text-gray-600",
};

const ATTACHABLE_TYPES = new Set(["SITELINK", "CALLOUT", "STRUCTURED_SNIPPET"]);

interface CampaignOption {
  id: number;
  campaign_name: string;
  channel: string;
  closed: boolean;
}

export default function GoogleAdsAssetsPage() {
  const { user } = useUser();
  const params = useParams();
  const locale = (params.locale as Locale) || "en";
  const dict = getDictionary(locale);
  const t = dict.googleAdsPage;
  const { activeOrg, isReadOnly } = useOrg();

  const [assets, setAssets] = useState<AccountAsset[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [filter, setFilter] = useState<(typeof TYPE_FILTERS)[number]>("ALL");
  const [toast, setToast] = useState("");

  // Attach-to-campaign
  const [campaignOptions, setCampaignOptions] = useState<CampaignOption[]>([]);
  const [attachingFor, setAttachingFor] = useState<string | null>(null); // asset resourceName with open picker
  const [attachTarget, setAttachTarget] = useState<number | "">("");
  const [attachSubmitting, setAttachSubmitting] = useState(false);

  useEffect(() => {
    // Load SEARCH campaigns once for the attach picker (cheap DB list).
    (async () => {
      try {
        const res = await fetch(`/api/google-ads/campaigns${activeOrg ? `?org_id=${activeOrg.id}` : ""}`);
        const data = await res.json();
        const list: CampaignOption[] = Array.isArray(data.campaigns) ? data.campaigns : [];
        setCampaignOptions(list.filter((c) => c.channel === "SEARCH" && !c.closed));
      } catch { /* picker just stays empty */ }
    })();
  }, [activeOrg]);

  async function handleAttach(assetResourceName: string) {
    if (!attachTarget) return;
    setAttachSubmitting(true);
    try {
      const res = await fetch("/api/google-ads/assets/attach", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assetResourceName, campaignId: attachTarget, orgId: activeOrg?.id }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setToast(data.alreadyAttached ? (t.assetsAlreadyAttached || "Already attached to that campaign") : (t.assetsAttached || "Asset attached"));
        setAttachingFor(null);
        setAttachTarget("");
        fetchAssets();
      } else {
        setToast(typeof data.details === "string" ? data.details : (data.error || "Attach failed"));
      }
    } catch (e) {
      setToast(e instanceof Error ? e.message : "Attach failed");
    }
    setAttachSubmitting(false);
    setTimeout(() => setToast(""), 4000);
  }

  const fetchAssets = useCallback(async () => {
    setLoading(true);
    setLoadError("");
    try {
      const res = await fetch(`/api/google-ads/assets${activeOrg ? `?org_id=${activeOrg.id}` : ""}`);
      const data = await res.json();
      if (res.ok) setAssets(data.assets || []);
      else setLoadError(data.error || "Failed to load");
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Failed to load");
    }
    setLoading(false);
  }, [activeOrg]);

  useEffect(() => { fetchAssets(); }, [fetchAssets]);

  if (!user) return null;

  const visible = filter === "ALL" ? assets : assets.filter((a) => a.type === filter);
  const countByType = new Map<string, number>();
  for (const a of assets) countByType.set(a.type, (countByType.get(a.type) || 0) + 1);

  return (
    <DashboardShell user={user} plan={undefined}>
      <div className="p-4 sm:p-6 max-w-5xl mx-auto space-y-6">
        <div>
          <div className="flex items-center gap-2">
            <Link href={`/${locale}/dashboard/google-ads`} className="text-gray-400 hover:text-gray-700 text-sm">←</Link>
            <h1 className="text-2xl font-bold text-gray-900">{t.assetsTitle || "Asset Library"}</h1>
          </div>
          <p className="text-gray-500 mt-1">
            {t.assetsSubtitle || "Every reusable asset in the account — images, sitelinks, callouts, snippets, videos — with how many campaigns use each."}
            {activeOrg && <span className="ml-2 text-xs px-2 py-0.5 rounded-full bg-blue-50 text-blue-700">{activeOrg.name}</span>}
          </p>
        </div>

        {/* Type filter */}
        <div className="flex flex-wrap gap-2">
          {TYPE_FILTERS.map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`text-xs px-3 py-1.5 rounded-lg border cursor-pointer ${
                filter === f ? "bg-red-800 text-white border-red-800" : "border-gray-200 text-gray-600 hover:bg-gray-50"
              }`}
            >
              {f === "ALL" ? (t.assetsFilterAll || "All") : f.replace(/_/g, " ")}
              {f === "ALL" ? ` (${assets.length})` : countByType.has(f) ? ` (${countByType.get(f)})` : ""}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="text-sm text-gray-400 py-8 text-center">…</div>
        ) : loadError ? (
          <pre className="text-xs text-red-600 bg-red-50 p-3 rounded-lg whitespace-pre-wrap break-all">{loadError}</pre>
        ) : visible.length === 0 ? (
          <div className="bg-white rounded-xl border border-gray-200 p-8 text-center text-sm text-gray-400">
            {t.assetsEmpty || "No assets yet. Assets are created automatically when you add ads, sitelinks, callouts, or snippets."}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {visible.map((a) => (
              <div key={a.resourceName} className="bg-white rounded-xl border border-gray-200 p-3 flex gap-3">
                {a.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={a.imageUrl} alt={a.label} className="w-16 h-16 object-cover rounded shrink-0" />
                ) : (
                  <div className="w-16 h-16 rounded bg-gray-50 border border-gray-100 flex items-center justify-center text-gray-300 text-xl shrink-0">
                    {a.type === "SITELINK" ? "🔗" : a.type === "CALLOUT" ? "📣" : a.type === "STRUCTURED_SNIPPET" ? "📋" : "📄"}
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className={`px-1.5 py-0.5 text-[10px] rounded-full ${TYPE_BADGES[a.type] || "bg-gray-100 text-gray-600"}`}>
                      {a.type.replace(/_/g, " ")}
                    </span>
                    <span className={`text-[10px] ${a.campaignCount > 0 ? "text-gray-500" : "text-gray-300"}`}>
                      {a.campaignCount} {t.assetsUsedIn || "campaigns"}
                    </span>
                  </div>
                  <p className="text-sm font-medium text-gray-800 truncate mt-1" title={a.label}>{a.label}</p>
                  {a.detail && <p className="text-xs text-gray-400 truncate" title={a.detail}>{a.detail}</p>}
                  {!isReadOnly && ATTACHABLE_TYPES.has(a.type) && campaignOptions.length > 0 && (
                    attachingFor === a.resourceName ? (
                      <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                        <select
                          value={attachTarget}
                          onChange={(e) => setAttachTarget(e.target.value ? Number(e.target.value) : "")}
                          className="text-xs px-2 py-1 border border-gray-300 rounded outline-none bg-white max-w-40"
                        >
                          <option value="">{t.assetsPickCampaign || "Pick a campaign…"}</option>
                          {campaignOptions.map((c) => (
                            <option key={c.id} value={c.id}>{c.campaign_name}</option>
                          ))}
                        </select>
                        <button
                          onClick={() => handleAttach(a.resourceName)}
                          disabled={attachSubmitting || !attachTarget}
                          className="text-xs px-2 py-1 bg-red-800 text-white rounded hover:bg-red-900 disabled:opacity-50 cursor-pointer"
                        >
                          {attachSubmitting ? "…" : (t.assetsAttach || "Attach")}
                        </button>
                        <button onClick={() => { setAttachingFor(null); setAttachTarget(""); }} className="text-xs px-1 text-gray-400 cursor-pointer">×</button>
                      </div>
                    ) : (
                      <button
                        onClick={() => { setAttachingFor(a.resourceName); setAttachTarget(""); }}
                        className="text-[11px] mt-2 px-2 py-0.5 border border-gray-200 rounded hover:bg-gray-50 cursor-pointer text-gray-500"
                      >
                        + {t.assetsAttach || "Attach"}
                      </button>
                    )
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {toast && (
          <div className="fixed top-4 right-4 z-50 bg-green-600 text-white px-4 py-2 rounded-lg shadow-lg text-sm">
            {toast}
          </div>
        )}
      </div>
    </DashboardShell>
  );
}
