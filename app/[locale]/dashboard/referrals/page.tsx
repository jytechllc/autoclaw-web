"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { useUser } from "@auth0/nextjs-auth0/client";
import DashboardShell from "@/components/DashboardShell";
import { getDictionary, type Locale } from "@/lib/i18n";

interface Commission {
  id: number;
  referredEmail: string;
  paymentAmount: number;
  commission: number;
  currency: string;
  status: string;
  period: string;
  createdAt: string;
}

export default function ReferralsPage() {
  const params = useParams();
  const locale = (params.locale as Locale) || "en";
  const dict = getDictionary(locale);
  const t = dict.referralsPage;
  const tc = dict.common;

  const { user } = useUser();
  const [referralCode, setReferralCode] = useState("");
  const [stats, setStats] = useState({ totalReferred: 0, activeSubscribers: 0, totalEarnings: 0, pendingPayout: 0 });
  const [commissions, setCommissions] = useState<Commission[]>([]);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    fetch("/api/referrals")
      .then((r) => r.json())
      .then((data) => {
        setReferralCode(data.referralCode || "");
        setStats(data.stats || {});
        setCommissions(data.commissions || []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const referralLink = typeof window !== "undefined" && referralCode
    ? `${window.location.origin}?ref=${referralCode}`
    : "";

  function copyLink() {
    if (!referralLink) return;
    navigator.clipboard.writeText(referralLink);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  const formatCurrency = (amount: number, currency = "usd") => {
    return new Intl.NumberFormat(locale === "zh" ? "zh-CN" : locale === "zh-TW" ? "zh-TW" : "en-US", {
      style: "currency",
      currency: currency.toUpperCase(),
    }).format(amount);
  };

  if (loading) {
    return (
      <DashboardShell user={user || {}}>
        <div className="flex items-center justify-center py-20 text-gray-400">{tc.loading}</div>
      </DashboardShell>
    );
  }

  return (
    <DashboardShell user={user || {}}>
      <div className="max-w-4xl mx-auto p-4 sm:p-6">
        <div className="mb-6">
          <h1 className="text-2xl font-bold">{t.title}</h1>
          <p className="text-sm text-gray-500">{t.subtitle}</p>
        </div>

        {/* Referral Link */}
        <div className="bg-white rounded-lg border border-gray-200 p-5 mb-6">
          <h2 className="text-sm font-semibold text-gray-700 mb-3">{t.yourLink}</h2>
          <div className="flex gap-2">
            <input
              type="text"
              value={referralLink}
              readOnly
              className="flex-1 bg-gray-50 border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono text-gray-600 select-all"
              onClick={(e) => (e.target as HTMLInputElement).select()}
            />
            <button
              onClick={copyLink}
              className="bg-red-700 hover:bg-red-800 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors cursor-pointer whitespace-nowrap"
            >
              {copied ? t.copied : t.copyLink}
            </button>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
          {[
            { label: t.totalReferred, value: stats.totalReferred, color: "bg-blue-50 text-blue-700 border-blue-200" },
            { label: t.activeSubscribers, value: stats.activeSubscribers, color: "bg-green-50 text-green-700 border-green-200" },
            { label: t.totalEarnings, value: formatCurrency(stats.totalEarnings), color: "bg-purple-50 text-purple-700 border-purple-200" },
            { label: t.pendingPayout, value: formatCurrency(stats.pendingPayout), color: "bg-orange-50 text-orange-700 border-orange-200" },
          ].map((stat) => (
            <div key={stat.label} className={`rounded-lg border p-4 ${stat.color}`}>
              <p className="text-xs font-medium opacity-70">{stat.label}</p>
              <p className="text-xl font-bold mt-1">{stat.value}</p>
            </div>
          ))}
        </div>

        {/* How it works */}
        <div className="bg-gradient-to-r from-red-50 to-orange-50 rounded-lg border border-red-200 p-5 mb-6">
          <h2 className="text-sm font-semibold text-red-800 mb-3">{t.howItWorks}</h2>
          <div className="space-y-2">
            {[t.step1, t.step2, t.step3].map((step, i) => (
              <div key={i} className="flex items-start gap-3">
                <span className="w-6 h-6 rounded-full bg-red-700 text-white text-xs font-bold flex items-center justify-center shrink-0 mt-0.5">
                  {i + 1}
                </span>
                <p className="text-sm text-gray-700">{step}</p>
              </div>
            ))}
          </div>
          <div className="mt-4 pt-3 border-t border-red-200">
            <p className="text-sm font-semibold text-red-800">{t.lifetimeCommission}</p>
            <p className="text-xs text-gray-600 mt-1">{t.lifetimeDesc}</p>
          </div>
        </div>

        {/* Commissions table */}
        <div className="bg-white rounded-lg border border-gray-200">
          <div className="px-5 py-4 border-b border-gray-200">
            <h2 className="text-sm font-semibold">{t.recentCommissions}</h2>
          </div>
          {commissions.length === 0 ? (
            <div className="text-center py-12 text-gray-400 text-sm">{t.noCommissions}</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200 bg-gray-50">
                    <th className="text-left px-4 py-3 font-medium text-gray-600">{t.date}</th>
                    <th className="text-left px-4 py-3 font-medium text-gray-600">{t.referredUser}</th>
                    <th className="text-right px-4 py-3 font-medium text-gray-600">{t.payment}</th>
                    <th className="text-right px-4 py-3 font-medium text-gray-600">{t.commission}</th>
                    <th className="text-center px-4 py-3 font-medium text-gray-600">{t.status}</th>
                  </tr>
                </thead>
                <tbody>
                  {commissions.map((c) => (
                    <tr key={c.id} className="border-b border-gray-100 hover:bg-gray-50">
                      <td className="px-4 py-3 text-gray-500">{new Date(c.createdAt).toLocaleDateString()}</td>
                      <td className="px-4 py-3 font-mono text-xs">{c.referredEmail}</td>
                      <td className="px-4 py-3 text-right">{formatCurrency(c.paymentAmount, c.currency)}</td>
                      <td className="px-4 py-3 text-right font-semibold text-green-700">{formatCurrency(c.commission, c.currency)}</td>
                      <td className="px-4 py-3 text-center">
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                          c.status === "paid" ? "bg-green-100 text-green-700" :
                          c.status === "cancelled" ? "bg-red-100 text-red-600" :
                          "bg-yellow-100 text-yellow-700"
                        }`}>
                          {c.status === "paid" ? t.statusPaid : c.status === "cancelled" ? t.statusCancelled : t.statusPending}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </DashboardShell>
  );
}
