"use client";

import { useUser } from "@auth0/nextjs-auth0/client";
import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { getDictionary, type Locale } from "@/lib/i18n";
import DashboardShell from "@/components/DashboardShell";
import { useOrg } from "@/components/OrgContext";

interface Credits {
  balance_cents: number | string;
  reserved_cents: number | string;
  currency: string;
}

interface Transaction {
  id: number;
  type: "topup" | "reserve" | "unreserve" | "spend" | "refund" | "adjustment";
  amount_cents: number | string;
  balance_after_cents: number | string;
  reserved_after_cents: number | string;
  reference_type: string | null;
  reference_id: string | null;
  note: string | null;
  created_at: string;
}

function fromCents(cents: number | string | null | undefined): number {
  return Number(cents || 0) / 100;
}

function formatUsd(cents: number | string | null | undefined): string {
  const n = fromCents(cents);
  const sign = n < 0 ? "-" : "";
  return `${sign}$${Math.abs(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

const TYPE_COLORS: Record<string, string> = {
  topup: "bg-emerald-50 text-emerald-700",
  reserve: "bg-amber-50 text-amber-700",
  unreserve: "bg-blue-50 text-blue-700",
  spend: "bg-red-50 text-red-700",
  refund: "bg-blue-50 text-blue-700",
  adjustment: "bg-gray-100 text-gray-600",
};

export default function AdCreditsPage() {
  const { user } = useUser();
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const locale = (params.locale as Locale) || "en";
  const dict = getDictionary(locale);
  const t = dict.budgetPage;
  const tg = dict.googleAdsPage;
  const { activeOrg } = useOrg();
  const orgIdParam = activeOrg ? `?org_id=${activeOrg.id}` : "";

  const [credits, setCredits] = useState<Credits | null>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);

  const [showTopup, setShowTopup] = useState(false);
  const [topupAmount, setTopupAmount] = useState("100");
  const [topupSubmitting, setTopupSubmitting] = useState(false);
  const [toast, setToast] = useState("");

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetch(`/api/credits${orgIdParam}`).then((r) => r.json());
      setCredits(data.credits || { balance_cents: 0, reserved_cents: 0, currency: "USD" });
      setTransactions(data.transactions || []);
    } catch {
      setCredits({ balance_cents: 0, reserved_cents: 0, currency: "USD" });
      setTransactions([]);
    }
    setLoading(false);
  }, [orgIdParam]);

  useEffect(() => {
    const topup = searchParams.get("topup");
    const sessionId = searchParams.get("session_id");
    if (topup === "success" && sessionId) {
      fetch(`/api/credits/verify?session_id=${sessionId}`)
        .then((r) => r.json())
        .then((data) => {
          if (data.status === "success") {
            setToast(`${t.topupSuccess}: ${formatUsd(data.amountCents)}`);
            setTimeout(() => setToast(""), 4000);
          }
          fetchAll();
          router.replace(`/${locale}/dashboard/budget`);
        });
    } else if (topup === "cancel") {
      setToast(t.topupCancelled);
      setTimeout(() => setToast(""), 3000);
      router.replace(`/${locale}/dashboard/budget`);
    }
  }, [searchParams, fetchAll, router, locale, t]);

  useEffect(() => {
    if (user) fetchAll();
  }, [user, fetchAll]);

  async function handleTopup() {
    const amount = Number(topupAmount);
    if (!Number.isFinite(amount) || amount < 10) return;
    setTopupSubmitting(true);
    try {
      const res = await fetch("/api/credits/topup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          amountUsd: amount,
          locale,
          orgId: activeOrg?.id,
          // Override the success URL to come back to this page
          returnPath: `/${locale}/dashboard/budget`,
        }),
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

  const total = fromCents(credits?.balance_cents) + fromCents(credits?.reserved_cents);

  return (
    <DashboardShell user={user} plan={undefined}>
      <div className="p-4 sm:p-6 max-w-5xl mx-auto space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{t.title}</h1>
          <p className="text-gray-500 mt-1">
            {t.subtitle}
            {activeOrg && <span className="ml-2 text-xs px-2 py-0.5 rounded-full bg-blue-50 text-blue-700">{activeOrg.name}</span>}
          </p>
        </div>

        {toast && (
          <div className="fixed top-4 right-4 z-50 bg-green-600 text-white px-4 py-2 rounded-lg shadow-lg text-sm">
            {toast}
          </div>
        )}

        {/* Balance summary */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <div className="text-xs text-gray-500 mb-1">{tg.balance}</div>
            <div className="text-2xl font-bold text-gray-900">{formatUsd(credits?.balance_cents)}</div>
            <div className="text-xs text-gray-400 mt-1">{t.availableNote}</div>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <div className="text-xs text-gray-500 mb-1">{tg.reserved}</div>
            <div className="text-2xl font-semibold text-gray-700">{formatUsd(credits?.reserved_cents)}</div>
            <div className="text-xs text-gray-400 mt-1">{t.reservedNote}</div>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <div className="text-xs text-gray-500 mb-1">{t.totalAccount}</div>
            <div className="text-2xl font-semibold text-gray-500">${total.toFixed(2)}</div>
            <button
              onClick={() => setShowTopup(!showTopup)}
              className="mt-2 bg-emerald-600 text-white px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-emerald-700 transition cursor-pointer"
            >
              {showTopup ? tg.cancel : `+ ${tg.topup}`}
            </button>
          </div>
        </div>

        {/* Top-up form */}
        {showTopup && (
          <div className="bg-white rounded-xl border border-gray-200 p-5 sm:p-6 space-y-3">
            <h2 className="font-semibold text-gray-900">{tg.topup}</h2>
            <p className="text-xs text-gray-500">{tg.topupNote}</p>
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
              {[50, 100, 500, 1000, 5000].map((preset) => (
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
                {topupSubmitting ? tg.processing : tg.payWithStripe}
              </button>
            </div>
          </div>
        )}

        {/* Transaction history */}
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-200">
            <h2 className="font-semibold text-gray-800">{t.transactions}</h2>
          </div>
          {loading ? (
            <div className="p-8 text-center text-gray-400 text-sm">{tg.loading}</div>
          ) : transactions.length === 0 ? (
            <div className="p-8 text-center text-gray-400 text-sm">{t.noTransactions}</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-xs text-gray-500">
                  <tr>
                    <th className="text-left px-4 py-2 font-medium">{t.colDate}</th>
                    <th className="text-left px-4 py-2 font-medium">{t.colType}</th>
                    <th className="text-left px-4 py-2 font-medium">{t.colAmount}</th>
                    <th className="text-left px-4 py-2 font-medium">{t.colBalance}</th>
                    <th className="text-left px-4 py-2 font-medium">{t.colNote}</th>
                  </tr>
                </thead>
                <tbody>
                  {transactions.map((tx) => {
                    const amt = Number(tx.amount_cents);
                    return (
                      <tr key={tx.id} className="border-t border-gray-100 hover:bg-gray-50">
                        <td className="px-4 py-3 text-gray-500 text-xs whitespace-nowrap">{new Date(tx.created_at).toLocaleString()}</td>
                        <td className="px-4 py-3">
                          <span className={`px-2 py-0.5 text-xs rounded-full ${TYPE_COLORS[tx.type] || "bg-gray-100 text-gray-600"}`}>
                            {t[`type_${tx.type}` as keyof typeof t] || tx.type}
                          </span>
                        </td>
                        <td className={`px-4 py-3 font-medium ${amt > 0 ? "text-emerald-700" : amt < 0 ? "text-red-700" : "text-gray-600"}`}>
                          {amt > 0 ? "+" : ""}{formatUsd(tx.amount_cents)}
                        </td>
                        <td className="px-4 py-3 text-gray-600">{formatUsd(tx.balance_after_cents)}</td>
                        <td className="px-4 py-3 text-gray-500 text-xs">{tx.note || "—"}</td>
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
