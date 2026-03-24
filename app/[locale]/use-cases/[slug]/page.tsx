"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { getDictionary, type Locale } from "@/lib/i18n";
import LanguageSwitcher from "@/components/LanguageSwitcher";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { USE_CASES } from "../page";

export default function UseCaseArticlePage() {
  const params = useParams();
  const locale = (params.locale as Locale) || "en";
  const slug = params.slug as string;
  const dict = getDictionary(locale);
  const tc = dict.common;
  const lang = locale === "zh" || locale === "zh-TW" ? "zh" : locale === "fr" ? "fr" : "en";

  // Find the use case across all categories
  const allCases = [...(USE_CASES.existing || []), ...(USE_CASES.featured || [])];
  const uc = allCases.find((c) => c.slug === slug);

  if (!uc) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-gray-900 mb-4">Not Found</h1>
          <Link href={`/${locale}/use-cases`} className="text-red-700 hover:underline">
            &larr; {lang === "zh" ? "返回案例列表" : "Back to Use Cases"}
          </Link>
        </div>
      </div>
    );
  }

  const title = uc.title[lang] || uc.title.en;
  const content = uc.content[lang] || uc.content.en;
  const industry = uc.industry[lang] || uc.industry.en;
  const summary = uc.summary[lang] || uc.summary.en;

  return (
    <div className="min-h-screen bg-white">
      {/* Header */}
      <header className="bg-gray-50 border-b border-gray-200">
        <div className="max-w-4xl mx-auto px-4 py-4 flex items-center justify-between">
          <Link href={`/${locale}/use-cases`} className="text-sm text-gray-500 hover:text-gray-700 flex items-center gap-1">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
            {lang === "zh" ? "所有案例" : "All Use Cases"}
          </Link>
          <div className="flex items-center gap-3">
            <LanguageSwitcher />
            <Link href={`/${locale}`} className="text-sm font-medium text-red-700 hover:text-red-900">
              AutoClaw
            </Link>
          </div>
        </div>
      </header>

      {/* Hero */}
      <div className="bg-gradient-to-b from-gray-50 to-white">
        <div className="max-w-4xl mx-auto px-4 py-12">
          <div className="flex items-center gap-3 mb-4">
            <span className="text-xs font-medium text-red-700 bg-red-50 px-3 py-1 rounded-full">{industry}</span>
            {uc.agents > 0 && (
              <span className="text-xs font-medium text-gray-500 bg-gray-100 px-3 py-1 rounded-full">
                {uc.agents} AI {lang === "zh" ? "员工" : "Employees"}
              </span>
            )}
            {uc.company && (
              <span className="text-xs font-medium text-blue-700 bg-blue-50 px-3 py-1 rounded-full">{uc.company}</span>
            )}
          </div>
          <h1 className="text-3xl sm:text-4xl font-bold text-gray-900 leading-tight mb-4">{title}</h1>
          <p className="text-lg text-gray-500">{summary}</p>
        </div>
      </div>

      {/* Article content */}
      <article className="max-w-4xl mx-auto px-4 pb-16">
        <div className="prose prose-lg max-w-none prose-headings:text-gray-900 prose-h2:text-2xl prose-h2:mt-10 prose-h2:mb-4 prose-h3:text-xl prose-h3:mt-8 prose-h3:mb-3 prose-p:text-gray-600 prose-li:text-gray-600 prose-strong:text-gray-900 prose-table:text-sm prose-th:bg-gray-50 prose-th:px-4 prose-th:py-2 prose-td:px-4 prose-td:py-2 prose-td:border-gray-200 prose-code:bg-gray-100 prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded prose-code:text-sm prose-code:before:content-none prose-code:after:content-none">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
        </div>

        {/* CTA */}
        <div className="mt-16 bg-gradient-to-r from-red-800 to-red-900 rounded-2xl p-8 text-center">
          <h2 className="text-2xl font-bold text-white mb-3">
            {lang === "zh" ? "准备好开始了吗？" : "Ready to Get Started?"}
          </h2>
          <p className="text-red-200 mb-6">
            {lang === "zh" ? "免费注册，部署你的第一个 AI 员工" : "Sign up free and deploy your first AI employee"}
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Link href={`/${locale}#pricing`} className="bg-white text-red-800 px-6 py-3 rounded-lg font-medium hover:bg-red-50 transition-colors">
              {lang === "zh" ? "查看套餐" : "View Plans"}
            </Link>
            <Link href={`/auth/login?returnTo=/${locale}/dashboard/reports`} className="border border-white/30 text-white px-6 py-3 rounded-lg font-medium hover:bg-white/10 transition-colors">
              {tc.logIn}
            </Link>
          </div>
        </div>

        {/* Back link */}
        <div className="mt-8 text-center">
          <Link href={`/${locale}/use-cases`} className="text-sm text-gray-400 hover:text-gray-600">
            &larr; {lang === "zh" ? "返回所有案例" : "Back to all use cases"}
          </Link>
        </div>
      </article>
    </div>
  );
}
