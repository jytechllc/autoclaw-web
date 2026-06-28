import type { Metadata } from "next";
import { SITE_NAME, DEFAULT_OG_IMAGE, localizedPath, buildLanguageAlternates } from "@/lib/seo";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const isZh = locale.startsWith("zh");
  const title = isZh
    ? `AI 营销自动化客户案例与研究 | ${SITE_NAME}`
    : `AI Marketing Automation Case Studies & Research | ${SITE_NAME}`;
  const description = isZh
    ? "真实案例研究与研究文章，展示 AutoClaw 的 AI 员工如何在批发、工业、法律 SaaS、跨境电商等行业实现潜客开发、邮件外联与内容营销自动化。"
    : "Real case studies and research showing how AutoClaw's AI employees automate lead generation, email outreach, and content marketing across wholesale, industrial, legal SaaS, cross-border e-commerce, and more.";
  const canonical = localizedPath(locale as never, "/use-cases");
  return {
    title,
    description,
    alternates: {
      canonical,
      languages: { ...buildLanguageAlternates("/use-cases"), "x-default": localizedPath("en" as never, "/use-cases") },
    },
    openGraph: {
      type: "website",
      url: canonical,
      siteName: SITE_NAME,
      title,
      description,
      images: [{ url: DEFAULT_OG_IMAGE, width: 512, height: 512, alt: title }],
    },
    twitter: { card: "summary_large_image", title, description, images: [DEFAULT_OG_IMAGE] },
  };
}

export default function UseCasesLayout({ children }: { children: React.ReactNode }) {
  return children;
}
