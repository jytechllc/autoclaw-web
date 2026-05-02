import type { MetadataRoute } from "next";
import { locales, type Locale } from "@/lib/i18n";
import { DEFAULT_OG_IMAGE, PUBLIC_MARKETING_PATHS, SITE_URL, localizedPath } from "@/lib/seo";

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  const localeEntries = locales.flatMap((locale) =>
    PUBLIC_MARKETING_PATHS.map((path) => ({
      url: `${SITE_URL}${localizedPath(locale as Locale, path)}`,
      lastModified: now,
      changeFrequency: (path === "" ? "weekly" : "monthly") as "weekly" | "monthly",
      priority: path === "" ? 1 : path === "/use-cases" || path === "/docs" ? 0.8 : 0.6,
      images: path === "" ? [`${SITE_URL}${DEFAULT_OG_IMAGE}`] : undefined,
    }))
  );

  return localeEntries;
}
