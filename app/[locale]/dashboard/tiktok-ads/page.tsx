"use client";

import { useUser } from "@auth0/nextjs-auth0/client";
import { useParams } from "next/navigation";
import { getDictionary, type Locale } from "@/lib/i18n";
import DashboardShell from "@/components/DashboardShell";

export default function TikTokAdsPage() {
  const { user } = useUser();
  const params = useParams();
  const locale = (params.locale as Locale) || "en";
  const dict = getDictionary(locale);
  const t = dict.tiktokAdsPage;

  if (!user) return null;

  return (
    <DashboardShell user={user} plan={undefined}>
      <div className="p-4 sm:p-6 max-w-3xl mx-auto space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{t.title}</h1>
          <p className="text-gray-500 mt-1">{t.subtitle}</p>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-8 text-center">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-gray-900 rounded-full mb-4">
            <svg className="w-8 h-8 text-white" viewBox="0 0 24 24" fill="currentColor">
              <path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-5.2 1.74 2.89 2.89 0 0 1 2.31-4.64 2.93 2.93 0 0 1 .88.13V9.4a6.84 6.84 0 0 0-1-.05A6.33 6.33 0 0 0 5.8 20.1a6.34 6.34 0 0 0 10.86-4.43v-7a8.16 8.16 0 0 0 4.77 1.52v-3.4a4.85 4.85 0 0 1-1.84-.1z" />
            </svg>
          </div>
          <span className="inline-block px-3 py-1 bg-amber-100 text-amber-700 text-sm font-medium rounded-full mb-3">
            {t.comingSoon}
          </span>
          <p className="text-gray-600 max-w-md mx-auto">{t.comingSoonDesc}</p>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-800 mb-4">{t.features}</h2>
          <ul className="space-y-3">
            {[t.featCampaigns, t.featSparkAds, t.featCreative, t.featReports, t.featPixel].map((feat, i) => (
              <li key={i} className="flex items-center gap-3 text-sm text-gray-600">
                <span className="w-5 h-5 rounded-full bg-gray-100 flex items-center justify-center text-gray-400 text-xs">
                  {i + 1}
                </span>
                {feat}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </DashboardShell>
  );
}
