"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useOrg } from "@/components/OrgContext";

interface Props {
  locale: string;
}

function formatUsd(cents: number | string | null | undefined): string {
  const n = Number(cents || 0) / 100;
  return `$${n.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

export default function AdCreditsBadge({ locale }: Props) {
  const { activeOrg } = useOrg();
  const [balance, setBalance] = useState<number | null>(null);
  const [reserved, setReserved] = useState<number | null>(null);

  useEffect(() => {
    if (!activeOrg) {
      setBalance(null);
      setReserved(null);
      return;
    }
    const ctrl = new AbortController();
    fetch(`/api/credits?org_id=${activeOrg.id}`, { signal: ctrl.signal })
      .then((r) => r.json())
      .then((data) => {
        if (data.credits) {
          setBalance(Number(data.credits.balance_cents) || 0);
          setReserved(Number(data.credits.reserved_cents) || 0);
        }
      })
      .catch(() => { /* aborted or failed */ });
    return () => ctrl.abort();
  }, [activeOrg]);

  if (!activeOrg || balance === null) return null;

  const low = balance < 1000; // < $10
  const empty = balance === 0;

  return (
    <Link
      href={`/${locale}/dashboard/budget`}
      className={`hidden md:flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium border transition-colors cursor-pointer ${
        empty
          ? "bg-red-50 text-red-700 border-red-200 hover:bg-red-100"
          : low
            ? "bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-100"
            : "bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100"
      }`}
      title={`Available ${formatUsd(balance)} · Reserved ${formatUsd(reserved)}`}
    >
      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
      {formatUsd(balance)}
    </Link>
  );
}
