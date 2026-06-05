"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

interface Props {
  locale: string;
}

interface Quota {
  plan: string;
  dailyLimitCents: number;
  todaySpendCents: number;
  remaining: number; // cents remaining today; -1 when unlimited
  percentage: number;
}

const L: Record<string, { credit: string; unlimited: string; tip: (r: string, l: string) => string; tipUnlimited: string }> = {
  en: {
    credit: "Credit",
    unlimited: "Unlimited",
    tip: (r, l) => `${r} of ${l} free daily AI credit left`,
    tipUnlimited: "Unlimited AI credit",
  },
  zh: {
    credit: "点数",
    unlimited: "无限",
    tip: (r, l) => `今日 AI 点数：剩余 ${r}（每日 ${l}）`,
    tipUnlimited: "AI 点数无限",
  },
  "zh-TW": {
    credit: "點數",
    unlimited: "無限",
    tip: (r, l) => `今日 AI 點數：剩餘 ${r}（每日 ${l}）`,
    tipUnlimited: "AI 點數無限",
  },
  ko: {
    credit: "크레딧",
    unlimited: "무제한",
    tip: (r, l) => `오늘 남은 AI 크레딧 ${r} / ${l}`,
    tipUnlimited: "무제한 AI 크레딧",
  },
};

function usd(cents: number): string {
  return `$${(cents / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default function AiCreditBadge({ locale }: Props) {
  const t = L[locale] || L.en;
  const [quota, setQuota] = useState<Quota | null>(null);

  useEffect(() => {
    const ctrl = new AbortController();
    fetch("/api/usage-quota", { signal: ctrl.signal })
      .then((r) => r.json())
      .then((data) => {
        if (data?.quota) setQuota(data.quota as Quota);
      })
      .catch(() => { /* aborted or failed */ });
    return () => ctrl.abort();
  }, []);

  if (!quota) return null;

  const unlimited = quota.dailyLimitCents <= 0;
  const remainingCents = Math.max(0, quota.remaining);
  const ratio = unlimited ? 1 : remainingCents / quota.dailyLimitCents;
  const empty = !unlimited && remainingCents <= 0;
  const low = !unlimited && !empty && ratio < 0.2;

  const label = unlimited ? t.unlimited : usd(remainingCents);
  const title = unlimited
    ? t.tipUnlimited
    : t.tip(usd(remainingCents), usd(quota.dailyLimitCents));

  return (
    <Link
      href={`/${locale}/dashboard/settings`}
      className={`hidden md:flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium border transition-colors cursor-pointer ${
        empty
          ? "bg-red-50 text-red-700 border-red-200 hover:bg-red-100"
          : low
            ? "bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-100"
            : "bg-violet-50 text-violet-700 border-violet-200 hover:bg-violet-100"
      }`}
      title={title}
    >
      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 10V3L4 14h7v7l9-11h-7z" />
      </svg>
      <span>{t.credit}</span>
      <span className="font-semibold">{label}</span>
    </Link>
  );
}
