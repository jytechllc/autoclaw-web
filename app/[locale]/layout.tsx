import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Auth0Provider } from "@auth0/nextjs-auth0";
import { Analytics } from "@vercel/analytics/next";
import Script from "next/script";
import { notFound } from "next/navigation";
import { isValidLocale } from "@/lib/i18n";
import WeChatGuard from "@/components/WeChatGuard";
import "../globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "AutoClaw | AI Marketing Agents That Run 24/7",
  description:
    "Deploy AI-powered marketing agents that run 24/7. Email outreach, content creation, lead generation, SEO, and social media — all automated. Free tier available.",
  icons: { icon: "/logo.svg" },
  alternates: {
    canonical: "https://autoclaw.jytech.us",
  },
};

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
    <html lang={locale}>
      <head>
        <Script
          src="https://www.googletagmanager.com/gtag/js?id=G-XV7GLZ82LV"
          strategy="afterInteractive"
        />
        <Script id="google-analytics" strategy="afterInteractive">
          {`
            window.dataLayer = window.dataLayer || [];
            function gtag(){dataLayer.push(arguments);}
            gtag('js', new Date());
            gtag('config', 'G-XV7GLZ82LV');
          `}
        </Script>
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <WeChatGuard />
        <Auth0Provider>{children}</Auth0Provider>
        <Analytics />
      </body>
    </html>
  );
}
