"use client";

import { useUser } from "@auth0/nextjs-auth0/client";
import { useParams } from "next/navigation";
import { getDictionary, type Locale } from "@/lib/i18n";
import DashboardShell from "@/components/DashboardShell";

export default function MetaAdsPage() {
  const { user } = useUser();
  const params = useParams();
  const locale = (params.locale as Locale) || "en";
  const dict = getDictionary(locale);
  const t = dict.metaAdsPage;

  if (!user) return null;

  return (
    <DashboardShell user={user} plan={undefined}>
      <div className="p-4 sm:p-6 max-w-3xl mx-auto space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{t.title}</h1>
          <p className="text-gray-500 mt-1">{t.subtitle}</p>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-8 text-center">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-blue-50 rounded-full mb-4">
            <svg className="w-8 h-8 text-blue-600" viewBox="0 0 24 24" fill="currentColor">
              <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
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
            {[t.featCampaigns, t.featAudience, t.featCreative, t.featReports, t.featPixel].map((feat, i) => (
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
