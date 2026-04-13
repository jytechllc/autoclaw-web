"use client";

import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import type { Locale } from "@/lib/i18n";

interface OrgListing {
  name: string;
  slug: string;
  open_positions: number;
}

const T: Record<string, Record<string, string>> = {
  en: {
    title: "Career Opportunities",
    subtitle: "Explore open positions at companies using AutoClaw.",
    openPositions: "open positions",
    viewPositions: "View Positions",
    noCompanies: "No companies are currently hiring. Check back later!",
    loading: "Loading...",
    poweredBy: "Powered by AutoClaw",
  },
  zh: {
    title: "招聘机会",
    subtitle: "探索使用 AutoClaw 平台的公司的开放职位。",
    openPositions: "个开放职位",
    viewPositions: "查看职位",
    noCompanies: "目前没有公司在招聘，请稍后再来！",
    loading: "加载中...",
    poweredBy: "由 AutoClaw 提供技术支持",
  },
  "zh-TW": {
    title: "招募機會",
    subtitle: "探索使用 AutoClaw 平台的公司的開放職位。",
    openPositions: "個開放職位",
    viewPositions: "查看職位",
    noCompanies: "目前沒有公司在招募，請稍後再來！",
    loading: "載入中...",
    poweredBy: "由 AutoClaw 提供技術支援",
  },
  fr: {
    title: "Opportunités de carrière",
    subtitle: "Découvrez les postes ouverts dans les entreprises utilisant AutoClaw.",
    openPositions: "postes ouverts",
    viewPositions: "Voir les postes",
    noCompanies: "Aucune entreprise ne recrute actuellement. Revenez plus tard !",
    loading: "Chargement...",
    poweredBy: "Propulsé par AutoClaw",
  },
};

export default function CareersIndexPage() {
  const params = useParams();
  const locale = (params.locale as Locale) || "en";
  const t = T[locale] || T.en;

  const [companies, setCompanies] = useState<OrgListing[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/public/careers?list=1")
      .then((r) => r.json())
      .then((data) => {
        setCompanies(data.companies || []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 shadow-sm">
        <div className="max-w-4xl mx-auto px-4 py-8 sm:py-12 text-center">
          <h1 className="text-3xl sm:text-4xl font-bold text-gray-900">{t.title}</h1>
          <p className="text-gray-500 mt-2 text-sm sm:text-base">{t.subtitle}</p>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-8">
        {loading ? (
          <div className="text-center py-16 text-gray-400">{t.loading}</div>
        ) : companies.length === 0 ? (
          <div className="text-center py-16 text-gray-400">{t.noCompanies}</div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            {companies.map((c) => (
              <Link
                key={c.slug}
                href={`/${locale}/careers/${c.slug}`}
                className="bg-white rounded-xl border shadow-sm hover:shadow-md transition-shadow p-5 sm:p-6 flex items-center justify-between group"
              >
                <div>
                  <h2 className="text-lg font-bold text-gray-900 group-hover:text-red-800 transition-colors">{c.name}</h2>
                  <p className="text-sm text-gray-500 mt-1">{c.open_positions} {t.openPositions}</p>
                </div>
                <span className="text-sm text-red-700 font-medium shrink-0 group-hover:translate-x-1 transition-transform">
                  {t.viewPositions} →
                </span>
              </Link>
            ))}
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-gray-200 mt-16 py-6 text-center text-xs text-gray-400">
        {t.poweredBy}
      </footer>
    </div>
  );
}
