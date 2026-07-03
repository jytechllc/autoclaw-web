"use client";

// Launch preflight — traffic-light view over /api/google-ads/preflight.
// Internal ops page: run it after wiring a real Google Ads account, fix the
// reds, then walk the manual items in docs/google-ads-launch-checklist.md.

import { useUser } from "@auth0/nextjs-auth0/client";
import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { getDictionary, type Locale } from "@/lib/i18n";
import DashboardShell from "@/components/DashboardShell";

interface Check { id: string; label: string; status: "pass" | "warn" | "fail"; detail: string }
interface Summary { status: "pass" | "warn" | "fail"; pass: number; warn: number; fail: number; total: number }

const ICON = { pass: "✅", warn: "⚠️", fail: "❌" } as const;
const ROW_BG = { pass: "bg-green-50/50", warn: "bg-amber-50/60", fail: "bg-red-50/60" } as const;

export default function PreflightPage() {
  const { user } = useUser();
  const params = useParams();
  const locale = (params.locale as Locale) || "en";
  const dict = getDictionary(locale);
  const t = dict.googleAdsPage;

  const [checks, setChecks] = useState<Check[] | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const run = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/google-ads/preflight");
      const data = await res.json();
      if (res.ok && data.success) {
        setChecks(data.checks || []);
        setSummary(data.summary || null);
      } else {
        setError(data.error || "Preflight failed");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    run();
  }, [run]);

  if (!user) return null;

  return (
    <DashboardShell user={user} plan={undefined}>
      <div className="p-4 sm:p-6 max-w-3xl mx-auto space-y-6">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <Link href={`/${locale}/dashboard/google-ads`} className="text-sm text-gray-500 hover:text-gray-800">
              ← {t.title}
            </Link>
            <h1 className="text-2xl font-bold text-gray-900 mt-2">🛫 {t.preflightTitle || "Launch Preflight"}</h1>
            <p className="text-gray-500 mt-1">{t.preflightSubtitle || "Automated read-only checks before going live. Human-eyes items stay in the launch checklist."}</p>
          </div>
          <button
            onClick={run}
            disabled={loading}
            className="bg-red-800 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-red-900 transition cursor-pointer disabled:opacity-50 self-start"
          >
            {loading ? (t.preflightRunning || "Checking…") : `↻ ${t.preflightRerun || "Re-run"}`}
          </button>
        </div>

        {summary && (
          <div className={`rounded-xl border p-4 flex items-center gap-3 ${
            summary.status === "pass" ? "border-green-200 bg-green-50" : summary.status === "warn" ? "border-amber-200 bg-amber-50" : "border-red-200 bg-red-50"
          }`}>
            <span className="text-3xl">{ICON[summary.status]}</span>
            <div>
              <div className="font-semibold text-gray-900">
                {summary.status === "pass"
                  ? (t.preflightAllClear || "All automated checks pass")
                  : summary.status === "warn"
                    ? (t.preflightWarns || "Passable, with warnings")
                    : (t.preflightFails || "Blockers found — fix the reds before launch")}
              </div>
              <div className="text-xs text-gray-500">✅ {summary.pass} · ⚠️ {summary.warn} · ❌ {summary.fail}</div>
            </div>
          </div>
        )}

        {error && <div className="bg-red-50 border border-red-200 text-red-800 rounded-lg p-3 text-sm">{error}</div>}

        {checks && (
          <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
            {checks.map((c) => (
              <div key={c.id} className={`flex items-start gap-3 px-4 py-3 border-b border-gray-100 last:border-b-0 ${ROW_BG[c.status]}`}>
                <span className="text-lg leading-6">{ICON[c.status]}</span>
                <div className="min-w-0">
                  <div className="text-sm font-medium text-gray-800">{c.label}</div>
                  <div className="text-xs text-gray-500 break-words">{c.detail}</div>
                </div>
              </div>
            ))}
          </div>
        )}

        <p className="text-xs text-gray-400">
          {t.preflightManualNote || "Green board here ≠ launched: run the manual items (watch an ad serve, watch auto-pause fire) in docs/google-ads-launch-checklist.md."}
        </p>
      </div>
    </DashboardShell>
  );
}
