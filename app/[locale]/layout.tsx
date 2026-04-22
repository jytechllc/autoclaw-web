import type { Metadata } from "next";
import { Auth0Provider } from "@auth0/nextjs-auth0";
import { notFound } from "next/navigation";
import { getDictionary, isValidLocale, locales, type Locale } from "@/lib/i18n";
import WeChatGuard from "@/components/WeChatGuard";
import { getLocaleMetadata } from "@/lib/seo";
import "../globals.css";

export function generateStaticParams() {
  return locales.map((locale) => ({ locale }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  if (!isValidLocale(locale)) {
    return {};
  }

  const dict = getDictionary(locale as Locale);
  return {
    ...getLocaleMetadata(locale as Locale),
    category: dict.landing.heroTag,
  };
}

export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isValidLocale(locale)) notFound();

  return (
    <>
      <WeChatGuard />
      <Auth0Provider>{children}</Auth0Provider>
    </>
  );
}
