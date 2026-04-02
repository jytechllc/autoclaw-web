import { Auth0Provider } from "@auth0/nextjs-auth0";
import { notFound } from "next/navigation";
import { isValidLocale } from "@/lib/i18n";
import WeChatGuard from "@/components/WeChatGuard";

export function generateStaticParams() {
  return [{ locale: "en" }, { locale: "zh" }];
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
