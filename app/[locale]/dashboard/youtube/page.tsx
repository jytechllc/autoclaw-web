"use client";

import { useUser } from "@auth0/nextjs-auth0/client";
import { useParams } from "next/navigation";
import Link from "next/link";
import { getDictionary, type Locale } from "@/lib/i18n";
import DashboardShell from "@/components/DashboardShell";

export default function YouTubePage() {
  const { user } = useUser();
  const params = useParams();
  const locale = (params.locale as Locale) || "en";
  const dict = getDictionary(locale);
  const t = dict.youtubePage;

  if (!user) return null;

  return (
    <DashboardShell user={user} plan={undefined}>
      <div className="p-4 sm:p-6 max-w-3xl mx-auto space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{t.title}</h1>
          <p className="text-gray-500 mt-1">{t.subtitle}</p>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-8 text-center">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-red-50 rounded-full mb-4">
            <svg className="w-8 h-8" viewBox="0 0 24 24" fill="#FF0000">
              <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" />
            </svg>
          </div>
          <span className="inline-block px-3 py-1 bg-amber-100 text-amber-700 text-sm font-medium rounded-full mb-3">
            {t.comingSoon}
          </span>
          <p className="text-gray-600 max-w-md mx-auto mb-4">{t.comingSoonDesc}</p>
          <Link
            href={`/${locale}/dashboard/google-ads`}
            className="inline-flex items-center gap-1.5 text-sm text-red-700 hover:underline"
          >
            {t.seeGoogleAds || "See Google Ads (video campaigns)"} →
          </Link>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-800 mb-4">{t.features}</h2>
          <ul className="space-y-3">
            {[t.featConnect, t.featUpload, t.featSchedule, t.featAnalytics, t.featAdsAssets].map((feat, i) => (
              <li key={i} className="flex items-center gap-3 text-sm text-gray-600">
                <span className="w-5 h-5 rounded-full bg-gray-100 flex items-center justify-center text-gray-400 text-xs">
                  {i + 1}
                </span>
                {feat}
              </li>
            ))}
          </ul>
        </div>

        <div className="bg-blue-50 rounded-xl border border-blue-200 p-5">
          <h3 className="text-sm font-semibold text-blue-900 mb-2">{t.helpTitle || "Linking your YouTube channel for Google Ads?"}</h3>
          <p className="text-sm text-blue-800">
            {t.helpDesc || "If you just want to run video ads using your channel, you don't need to connect via this page. See"}{" "}
            <Link href={`/${locale}/dashboard/docs`} className="underline font-medium">
              {t.helpLink || "the Docs page"}
            </Link>
            {" "}{t.helpDescTail || "for the YouTube channel linking guide."}
          </p>
        </div>
      </div>
    </DashboardShell>
  );
}
