import type { Metadata } from "next";
import { defaultLocale, getDictionary, locales, type Locale } from "@/lib/i18n";

export const SITE_NAME = "AutoClaw";
export const SITE_URL = "https://autoclaw.jytech.us";
export const DEFAULT_OG_IMAGE = "/icon-512.png";

const OG_LOCALE: Record<Locale, string> = {
  en: "en_US",
  zh: "zh_CN",
  "zh-TW": "zh_TW",
  fr: "fr_FR",
  ko: "ko_KR",
};

export const PUBLIC_MARKETING_PATHS = [
  "",
  "/use-cases",
  "/docs",
  "/partners",
  "/careers",
  "/status",
  "/privacy",
  "/terms",
  "/changelog",
  "/leaderboard",
] as const;

export function localizedPath(locale: Locale, path = "") {
  return `/${locale}${path}`;
}

export function buildLanguageAlternates(path = "") {
  return Object.fromEntries(
    locales.map((locale) => [locale, localizedPath(locale, path)])
  );
}

export function getLocaleMetadata(locale: Locale): Metadata {
  const dict = getDictionary(locale);
  const title = `${dict.landing.heroTitle} ${dict.landing.heroTitleHighlight}`;
  const description = dict.landing.heroDescription;
  const canonicalPath = localizedPath(locale);

  return {
    title,
    description,
    alternates: {
      canonical: canonicalPath,
      languages: {
        ...buildLanguageAlternates(),
        "x-default": localizedPath(defaultLocale),
      },
    },
    openGraph: {
      type: "website",
      url: canonicalPath,
      siteName: SITE_NAME,
      title,
      description,
      locale: OG_LOCALE[locale],
      images: [
        {
          url: DEFAULT_OG_IMAGE,
          width: 512,
          height: 512,
          alt: `${SITE_NAME} preview`,
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [DEFAULT_OG_IMAGE],
    },
  };
}
