"use client";

import { useUser } from "@auth0/nextjs-auth0/client";
import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { getDictionary, type Locale } from "@/lib/i18n";
import DashboardShell from "@/components/DashboardShell";
import { useOrg } from "@/components/OrgContext";

interface ConversionAction {
  resourceName: string;
  id: string;
  name: string;
  category: string;
  status: string;
  type: string;
  countingType: string;
  primaryForGoal: boolean;
  tagSnippets: Array<{ type: string; pageFormat: string; globalSiteTag: string; eventSnippet: string }>;
}

const CATEGORIES = [
  "PURCHASE", "SIGNUP", "LEAD", "SUBMIT_LEAD_FORM", "CONTACT",
  "PAGE_VIEW", "DOWNLOAD", "ADD_TO_CART", "BEGIN_CHECKOUT", "SUBSCRIBE_PAID",
] as const;

export default function GoogleAdsConversionsPage() {
  const { user } = useUser();
  const params = useParams();
  const locale = (params.locale as Locale) || "en";
  const dict = getDictionary(locale);
  const t = dict.googleAdsPage;
  const { activeOrg, isReadOnly } = useOrg();
  const orgIdParam = activeOrg ? `?org_id=${activeOrg.id}` : "";

  const [actions, setActions] = useState<ConversionAction[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [toast, setToast] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [mutating, setMutating] = useState<string | null>(null);

  // Create form
  const [showForm, setShowForm] = useState(false);
  const [fName, setFName] = useState("");
  const [fCategory, setFCategory] = useState<string>("SIGNUP");
  const [fCounting, setFCounting] = useState<string>("ONE_PER_CLICK");
  const [fValue, setFValue] = useState("");
  const [fLookback, setFLookback] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState("");

  const fetchActions = useCallback(async () => {
    setLoading(true);
    setLoadError("");
    try {
      const res = await fetch(`/api/google-ads/conversion-actions${orgIdParam}`);
      const data = await res.json();
      if (res.ok) setActions(data.actions || []);
      else setLoadError(data.error || "Failed to load");
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Failed to load");
    }
    setLoading(false);
  }, [orgIdParam]);

  useEffect(() => { fetchActions(); }, [fetchActions]);

  function flash(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(""), 3500);
  }

  async function handleCreate() {
    if (!fName.trim()) { setFormError(t.convNameRequired || "Name is required"); return; }
    setSubmitting(true);
    setFormError("");
    try {
      const res = await fetch("/api/google-ads/conversion-actions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: fName.trim(),
          category: fCategory,
          countingType: fCounting,
          defaultValue: fValue || undefined,
          clickLookbackDays: fLookback || undefined,
          orgId: activeOrg?.id,
        }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        flash(t.convCreated || "Conversion action created");
        setShowForm(false);
        setFName(""); setFValue(""); setFLookback("");
        fetchActions();
        if (data.action?.resourceName) setExpanded(data.action.resourceName);
      } else {
        setFormError(typeof data.details === "string" ? data.details : (data.error || "Failed"));
      }
    } catch (e) {
      setFormError(e instanceof Error ? e.message : "Failed");
    }
    setSubmitting(false);
  }

  async function handleSetStatus(action: ConversionAction, status: "ENABLED" | "PAUSED" | "REMOVED") {
    if (status === "REMOVED" && !confirm(t.convRemoveConfirm || `Remove "${action.name}"? Historical data is kept, but the tag stops counting.`)) return;
    setMutating(action.resourceName);
    try {
      const res = await fetch(`/api/google-ads/conversion-actions/${action.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status, orgId: activeOrg?.id }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        flash(t.updated || "Updated");
        fetchActions();
      } else {
        flash(data.error || "Update failed");
      }
    } catch (e) {
      flash(e instanceof Error ? e.message : "Update failed");
    }
    setMutating(null);
  }

  async function copyText(key: string, text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      setTimeout(() => setCopied(null), 2000);
    } catch { /* clipboard unavailable */ }
  }

  if (!user) return null;

  return (
    <DashboardShell user={user} plan={undefined}>
      <div className="p-4 sm:p-6 max-w-5xl mx-auto space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <Link href={`/${locale}/dashboard/google-ads`} className="text-gray-400 hover:text-gray-700 text-sm">←</Link>
              <h1 className="text-2xl font-bold text-gray-900">{t.convTitle || "Conversion Tracking"}</h1>
            </div>
            <p className="text-gray-500 mt-1">
              {t.convSubtitle || "Define what counts as a conversion, install the tag on your site, and smart bidding starts learning."}
              {activeOrg && <span className="ml-2 text-xs px-2 py-0.5 rounded-full bg-blue-50 text-blue-700">{activeOrg.name}</span>}
            </p>
          </div>
          {!isReadOnly && (
            <button
              onClick={() => { setShowForm(!showForm); setFormError(""); }}
              className="bg-red-800 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-red-900 transition cursor-pointer self-start"
            >
              {showForm ? (t.cancel || "Cancel") : `+ ${t.convCreate || "New Conversion Action"}`}
            </button>
          )}
        </div>

        {toast && (
          <div className="fixed top-4 right-4 z-50 bg-green-600 text-white px-4 py-2 rounded-lg shadow-lg text-sm">
            {toast}
          </div>
        )}

        {/* Create form */}
        {showForm && !isReadOnly && (
          <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-gray-500 mb-1">{t.convName || "Name"}</label>
                <input
                  value={fName}
                  onChange={(e) => setFName(e.target.value)}
                  maxLength={100}
                  placeholder={t.convNamePlaceholder || "e.g. Sign-up (website)"}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm outline-none focus:ring-2 focus:ring-red-500"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">{t.convCategory || "Category"}</label>
                <select
                  value={fCategory}
                  onChange={(e) => setFCategory(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm outline-none bg-white"
                >
                  {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">{t.convCounting || "Counting"}</label>
                <select
                  value={fCounting}
                  onChange={(e) => setFCounting(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm outline-none bg-white"
                >
                  <option value="ONE_PER_CLICK">{t.convCountingOne || "One per click (leads, sign-ups)"}</option>
                  <option value="MANY_PER_CLICK">{t.convCountingMany || "Every conversion (purchases)"}</option>
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-gray-500 mb-1">{t.convValue || "Value (USD, optional)"}</label>
                  <input
                    type="number" min="0" step="0.01"
                    value={fValue}
                    onChange={(e) => setFValue(e.target.value)}
                    placeholder="—"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm outline-none focus:ring-2 focus:ring-red-500"
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">{t.convLookback || "Click lookback (days, optional)"}</label>
                  <input
                    type="number" min="1" max="90" step="1"
                    value={fLookback}
                    onChange={(e) => setFLookback(e.target.value)}
                    placeholder="30"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm outline-none focus:ring-2 focus:ring-red-500"
                  />
                </div>
              </div>
            </div>
            {formError && <pre className="text-xs text-red-600 bg-red-50 p-2 rounded whitespace-pre-wrap break-all">{formError}</pre>}
            <button
              onClick={handleCreate}
              disabled={submitting}
              className="bg-red-800 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-red-900 disabled:opacity-50 cursor-pointer"
            >
              {submitting ? (t.creating || "Creating...") : (t.create || "Create")}
            </button>
          </div>
        )}

        {/* List */}
        {loading ? (
          <div className="text-sm text-gray-400 py-8 text-center">…</div>
        ) : loadError ? (
          <pre className="text-xs text-red-600 bg-red-50 p-3 rounded-lg whitespace-pre-wrap break-all">{loadError}</pre>
        ) : actions.length === 0 ? (
          <div className="bg-white rounded-xl border border-gray-200 p-8 text-center text-sm text-gray-400">
            {t.convEmpty || "No conversion actions yet. Create one, install the tag, and conversions start flowing into smart bidding and AI recommendations."}
          </div>
        ) : (
          <div className="space-y-3">
            {actions.map((a) => (
              <div key={a.resourceName} className="bg-white rounded-xl border border-gray-200 p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-gray-900">{a.name}</span>
                  <span className={`px-1.5 py-0.5 text-xs rounded-full ${
                    a.status === "ENABLED" ? "bg-green-50 text-green-700" :
                    a.status === "PAUSED" ? "bg-yellow-50 text-yellow-700" :
                    "bg-gray-100 text-gray-600"
                  }`}>{a.status}</span>
                  <span className="px-1.5 py-0.5 bg-purple-50 text-purple-700 text-xs rounded-full">{a.category}</span>
                  <span className="px-1.5 py-0.5 bg-gray-100 text-gray-600 text-xs rounded-full">{a.countingType === "MANY_PER_CLICK" ? (t.convCountingManyShort || "every") : (t.convCountingOneShort || "one/click")}</span>
                  {a.primaryForGoal && <span className="px-1.5 py-0.5 bg-blue-50 text-blue-700 text-xs rounded-full">{t.convPrimary || "primary"}</span>}
                  <span className="text-xs text-gray-400 font-mono">#{a.id}</span>
                  <div className="ml-auto flex items-center gap-2">
                    {a.tagSnippets.length > 0 && (
                      <button
                        onClick={() => setExpanded(expanded === a.resourceName ? null : a.resourceName)}
                        className="text-xs px-2 py-1 border border-gray-200 rounded hover:bg-gray-50 cursor-pointer text-gray-600"
                      >
                        {expanded === a.resourceName ? (t.convHideTag || "Hide tag") : (t.convShowTag || "Get tag code")}
                      </button>
                    )}
                    {!isReadOnly && (
                      <>
                        {a.status === "ENABLED" ? (
                          <button onClick={() => handleSetStatus(a, "PAUSED")} disabled={mutating === a.resourceName} className="text-xs px-2 py-1 border border-amber-200 text-amber-700 rounded hover:bg-amber-50 disabled:opacity-50 cursor-pointer">{t.action_pause || "Pause"}</button>
                        ) : (
                          <button onClick={() => handleSetStatus(a, "ENABLED")} disabled={mutating === a.resourceName} className="text-xs px-2 py-1 border border-green-200 text-green-700 rounded hover:bg-green-50 disabled:opacity-50 cursor-pointer">{t.action_enable || "Enable"}</button>
                        )}
                        <button onClick={() => handleSetStatus(a, "REMOVED")} disabled={mutating === a.resourceName} className="text-xs px-2 py-1 border border-red-200 text-red-700 rounded hover:bg-red-50 disabled:opacity-50 cursor-pointer">{t.convRemove || "Remove"}</button>
                      </>
                    )}
                  </div>
                </div>

                {expanded === a.resourceName && a.tagSnippets.length > 0 && (
                  <div className="mt-3 border-t border-gray-100 pt-3 space-y-3">
                    <p className="text-xs text-gray-500">{t.convInstallHint || "1) Put the global site tag in <head> on every page (once per site). 2) Fire the event snippet on the conversion page or button."}</p>
                    {a.tagSnippets.slice(0, 1).map((s, i) => (
                      <div key={i} className="space-y-3">
                        <div>
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-xs font-medium text-gray-600">{t.convGlobalTag || "Global site tag (all pages)"}</span>
                            <button onClick={() => copyText(`g-${a.id}`, s.globalSiteTag)} className="text-xs px-2 py-0.5 border border-gray-200 rounded hover:bg-gray-50 cursor-pointer text-gray-600">
                              {copied === `g-${a.id}` ? (t.convCopied || "Copied ✓") : (t.convCopy || "Copy")}
                            </button>
                          </div>
                          <pre className="text-[11px] bg-gray-50 border border-gray-100 rounded p-2 overflow-x-auto whitespace-pre-wrap break-all max-h-40">{s.globalSiteTag}</pre>
                        </div>
                        <div>
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-xs font-medium text-gray-600">{t.convEventSnippet || "Event snippet (conversion page)"}</span>
                            <button onClick={() => copyText(`e-${a.id}`, s.eventSnippet)} className="text-xs px-2 py-0.5 border border-gray-200 rounded hover:bg-gray-50 cursor-pointer text-gray-600">
                              {copied === `e-${a.id}` ? (t.convCopied || "Copied ✓") : (t.convCopy || "Copy")}
                            </button>
                          </div>
                          <pre className="text-[11px] bg-gray-50 border border-gray-100 rounded p-2 overflow-x-auto whitespace-pre-wrap break-all max-h-40">{s.eventSnippet}</pre>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </DashboardShell>
  );
}
