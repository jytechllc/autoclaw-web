"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { getDictionary, type Locale } from "@/lib/i18n";
import LanguageSwitcher from "@/components/LanguageSwitcher";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useState } from "react";

import { USE_CASES } from "./data";

function CaseVisual({ slug, lang }: { slug: string; lang: string }) {
  if (slug === "enterprise") {
    const t = lang === "zh";
    return (
      <div className="mb-8">
        {/* Architecture diagram */}
        <div className="bg-gray-50 rounded-xl p-6 mb-6">
          <h3 className="text-sm font-semibold text-center text-gray-500 mb-6">{t ? "企业版运营架构" : "Enterprise Operations Architecture"}</h3>
          <div className="flex flex-col md:flex-row items-stretch gap-4">
            {/* Partner */}
            <div className="flex-1 bg-white rounded-lg border border-blue-200 p-4">
              <div className="flex items-center gap-2 mb-3">
                <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center text-blue-600 text-sm">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                </div>
                <span className="text-xs font-semibold text-blue-700">{t ? "专属合作团队" : "Dedicated Partner Team"}</span>
              </div>
              <div className="space-y-1.5 text-xs text-gray-500">
                <div className="flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full bg-blue-400" />{t ? "绩效监控" : "Performance Monitoring"}</div>
                <div className="flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full bg-blue-400" />{t ? "运营监管" : "Operations Oversight"}</div>
                <div className="flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full bg-blue-400" />{t ? "项目咨询" : "Project Consultation"}</div>
              </div>
            </div>

            {/* Arrow */}
            <div className="hidden md:flex items-center">
              <svg className="w-8 h-8 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 7h12m0 0l-4-4m4 4l-4 4M8 17h12m0 0l-4-4m4 4l-4 4" /></svg>
            </div>

            {/* Platform */}
            <div className="flex-1 bg-white rounded-lg border border-red-200 p-4">
              <div className="flex items-center gap-2 mb-3">
                <div className="w-8 h-8 rounded-full bg-red-100 flex items-center justify-center text-red-600 text-sm">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg>
                </div>
                <span className="text-xs font-semibold text-red-700">AutoClaw {t ? "平台" : "Platform"}</span>
              </div>
              <div className="grid grid-cols-2 gap-1.5 text-xs text-gray-500">
                {["Email", "SEO", "Leads", "Social", "Sales", "PM", "Orchestrator", "Custom"].map((a) => (
                  <div key={a} className="flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full bg-red-400" />{a}</div>
                ))}
              </div>
            </div>

            {/* Arrow */}
            <div className="hidden md:flex items-center">
              <svg className="w-8 h-8 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 7h12m0 0l-4-4m4 4l-4 4M8 17h12m0 0l-4-4m4 4l-4 4" /></svg>
            </div>

            {/* Client */}
            <div className="flex-1 bg-white rounded-lg border border-green-200 p-4">
              <div className="flex items-center gap-2 mb-3">
                <div className="w-8 h-8 rounded-full bg-green-100 flex items-center justify-center text-green-600 text-sm">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" /></svg>
                </div>
                <span className="text-xs font-semibold text-green-700">{t ? "企业客户" : "Enterprise Client"}</span>
              </div>
              <div className="space-y-1.5 text-xs text-gray-500">
                <div className="flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full bg-green-400" />{t ? "无限 AI 员工" : "Unlimited AI Employees"}</div>
                <div className="flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full bg-green-400" />{t ? "高级分析" : "Advanced Analytics"}</div>
                <div className="flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full bg-green-400" />{t ? "专属基础设施" : "Dedicated Infra"}</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (slug === "cross-border-ecommerce") {
    const t = lang === "zh";
    return (
      <div className="mb-8">
        {/* Time zone visual */}
        <div className="bg-gray-50 rounded-xl p-6 mb-6">
          <h3 className="text-sm font-semibold text-center text-gray-500 mb-4">{t ? "24/7 跨时区运营" : "24/7 Cross-Timezone Operations"}</h3>
          <div className="flex flex-col sm:flex-row items-center gap-4">
            {/* China team */}
            <div className="flex-1 text-center">
              <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-red-100 mb-2">
                <span className="text-2xl">🇨🇳</span>
              </div>
              <p className="text-xs font-semibold text-gray-700">{t ? "中国团队" : "China Team"}</p>
              <p className="text-[10px] text-gray-400">UTC+8 | 9am - 6pm</p>
              <p className="text-[10px] text-gray-500 mt-1">{t ? "中文操作界面" : "Chinese Interface"}</p>
            </div>

            {/* Arrow with AutoClaw */}
            <div className="flex flex-col items-center gap-1">
              <div className="bg-red-800 text-white text-[10px] font-bold px-3 py-1.5 rounded-full">AutoClaw AI</div>
              <svg className="w-20 h-6 text-red-300" viewBox="0 0 80 24"><path d="M0 12h70m0 0l-6-6m6 6l-6 6" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
              <p className="text-[10px] text-red-600 font-medium">{t ? "24/7 自动运行" : "Runs 24/7"}</p>
            </div>

            {/* Global customers */}
            <div className="flex-1 text-center">
              <div className="flex justify-center gap-2 mb-2">
                <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-blue-100"><span className="text-xl">🇺🇸</span></div>
                <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-blue-100"><span className="text-xl">🇪🇺</span></div>
              </div>
              <p className="text-xs font-semibold text-gray-700">{t ? "海外客户" : "Global Customers"}</p>
              <p className="text-[10px] text-gray-400">UTC-8 to UTC+1</p>
              <p className="text-[10px] text-gray-500 mt-1">{t ? "母语级英文内容" : "Native English Content"}</p>
            </div>
          </div>
        </div>

        {/* AI Employee workflow */}
        <div className="bg-gray-50 rounded-xl p-6 mb-6">
          <h3 className="text-sm font-semibold text-center text-gray-500 mb-4">{t ? "AI 员工工作流" : "AI Employee Workflow"}</h3>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            {[
              { icon: "📧", name: t ? "邮件营销" : "Email", desc: t ? "冷邮件 + 跟进" : "Cold outreach" },
              { icon: "🔍", name: t ? "SEO 内容" : "SEO", desc: t ? "英文产品页" : "Product pages" },
              { icon: "🎯", name: t ? "潜客开发" : "Leads", desc: t ? "批发商开发" : "Find buyers" },
              { icon: "📱", name: t ? "社交媒体" : "Social", desc: t ? "海外社交运营" : "Global social" },
              { icon: "🤝", name: t ? "销售跟进" : "Follow-up", desc: t ? "自动培育" : "Auto nurture" },
            ].map((agent) => (
              <div key={agent.name} className="bg-white rounded-lg border border-gray-200 p-3 text-center">
                <div className="text-2xl mb-1">{agent.icon}</div>
                <p className="text-xs font-semibold text-gray-700">{agent.name}</p>
                <p className="text-[10px] text-gray-400">{agent.desc}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Results metrics */}
        <div className="grid grid-cols-3 gap-3 mb-6">
          {[
            { value: "30%+", label: t ? "邮件打开率" : "Email Open Rate", color: "text-green-600" },
            { value: "24/7", label: t ? "自动运行" : "Always Running", color: "text-blue-600" },
            { value: "5", label: t ? "AI 员工协同" : "AI Employees", color: "text-red-600" },
          ].map((metric) => (
            <div key={metric.label} className="bg-gray-50 rounded-lg p-4 text-center">
              <p className={`text-2xl font-bold ${metric.color}`}>{metric.value}</p>
              <p className="text-xs text-gray-500 mt-1">{metric.label}</p>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (slug === "dkwholesale") {
    const t = lang === "zh";
    return (
      <div className="mb-8">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { value: "43", label: t ? "自动化任务" : "Tasks Executed", color: "text-red-600" },
            { value: "28", label: t ? "协调任务" : "Orchestrator Tasks", color: "text-blue-600" },
            { value: "4", label: t ? "AI 员工" : "AI Employees", color: "text-purple-600" },
            { value: t ? "每周" : "Weekly", label: t ? "策略摘要" : "Strategy Digest", color: "text-green-600" },
          ].map((m) => (
            <div key={m.label} className="bg-gray-50 rounded-lg p-4 text-center">
              <p className={`text-2xl font-bold ${m.color}`}>{m.value}</p>
              <p className="text-xs text-gray-500 mt-1">{m.label}</p>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (slug === "usproglove") {
    const t = lang === "zh";
    return (
      <div className="mb-8">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { value: "33", label: t ? "自动化任务" : "Tasks Executed", color: "text-red-600" },
            { value: "20", label: t ? "丰富联系人" : "Enriched Contacts", color: "text-blue-600" },
            { value: "3", label: t ? "AI 员工" : "AI Employees", color: "text-purple-600" },
            { value: "13", label: t ? "邮件任务" : "Email Tasks", color: "text-green-600" },
          ].map((m) => (
            <div key={m.label} className="bg-gray-50 rounded-lg p-4 text-center">
              <p className={`text-2xl font-bold ${m.color}`}>{m.value}</p>
              <p className="text-xs text-gray-500 mt-1">{m.label}</p>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (slug === "gpulaw") {
    const t = lang === "zh";
    return (
      <div className="mb-8">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { value: "6", label: t ? "DevOps 任务" : "DevOps Tasks", color: "text-red-600" },
            { value: "1", label: t ? "AI 员工" : "AI Employee", color: "text-purple-600" },
            { value: t ? "自动化" : "Auto", label: t ? "健康检查" : "Health Checks", color: "text-green-600" },
            { value: "24/7", label: t ? "持续监控" : "Monitoring", color: "text-blue-600" },
          ].map((m) => (
            <div key={m.label} className="bg-gray-50 rounded-lg p-4 text-center">
              <p className={`text-2xl font-bold ${m.color}`}>{m.value}</p>
              <p className="text-xs text-gray-500 mt-1">{m.label}</p>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return null;
}

export default function UseCasesPage() {
  const params = useParams();
  const locale = (params.locale as Locale) || "en";
  const lang = locale.startsWith("zh") ? "zh" : "en";
  const dict = getDictionary(locale);
  const tc = dict.common;
  const [expandedSlug, setExpandedSlug] = useState<string | null>("cross-border-ecommerce");

  const allCases = [...USE_CASES.featured, ...USE_CASES.existing];

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-4 flex items-center justify-between">
          <Link href={`/${locale}`} className="text-xl sm:text-2xl font-bold tracking-tight flex items-center gap-2">
            <img src="/logo.svg" alt="AutoClaw" className="w-8 h-8 sm:w-9 sm:h-9" />
            <span><span className="text-red-600">Auto</span>Claw</span>
          </Link>
          <div className="flex items-center gap-2 sm:gap-4">
            <Link href={`/${locale}`} className="text-xs sm:text-sm text-gray-500 hover:text-gray-700 transition-colors">
              {lang === "zh" ? "首页" : "Home"}
            </Link>
            <Link href={`/${locale}/dashboard`} className="text-xs sm:text-sm text-gray-500 hover:text-gray-700 transition-colors">{tc.dashboard}</Link>
            <LanguageSwitcher locale={locale} />
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
        <div className="mb-6 sm:mb-8">
          <h1 className="text-2xl sm:text-3xl font-bold mb-2">{lang === "zh" ? "客户案例" : "Use Cases"}</h1>
          <p className="text-sm sm:text-base text-gray-500">{lang === "zh" ? "了解 AutoClaw 如何帮助不同行业的企业实现营销自动化" : "See how AutoClaw helps businesses across industries automate their marketing"}</p>
        </div>

        <div className="space-y-6">
          {allCases.map((uc) => {
            const isExpanded = expandedSlug === uc.slug;
            const isFeatured = USE_CASES.featured.some((f) => f.slug === uc.slug);

            return (
              <div key={uc.slug} className={`bg-white rounded-xl border overflow-hidden ${isFeatured ? "border-red-200 shadow-sm" : "border-gray-200"}`}>
                {/* Card header */}
                <button
                  onClick={() => setExpandedSlug(isExpanded ? null : uc.slug)}
                  className="w-full text-left cursor-pointer"
                >
                  <div className={`p-4 sm:p-6 ${isFeatured ? "bg-gradient-to-r from-gray-800 to-red-900 text-white" : "bg-gradient-to-r from-gray-700 to-gray-800 text-white"}`}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2 mb-1">
                          {isFeatured && (
                            <span className="inline-block bg-white/20 text-white text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full">
                              {lang === "zh" ? "精选案例" : "Featured"}
                            </span>
                          )}
                          {uc.agents > 0 && (
                            <span className="bg-white/20 text-white text-[10px] sm:text-xs font-semibold px-2 py-0.5 rounded-full">
                              {uc.agents} AI {lang === "zh" ? "员工" : "Employees"}
                            </span>
                          )}
                        </div>
                        <p className="text-white/70 text-xs uppercase tracking-wider mb-1">{uc.industry[lang] || uc.industry.en}</p>
                        <h2 className="text-base sm:text-xl font-bold leading-snug">{uc.title[lang] || uc.title.en}</h2>
                        {uc.company && <p className="text-white/60 text-sm mt-1">{uc.company}</p>}
                      </div>
                      <svg className={`w-5 h-5 text-white/60 transition-transform shrink-0 mt-1 ${isExpanded ? "rotate-180" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                      </svg>
                    </div>
                    <p className="text-white/80 text-xs sm:text-sm mt-2 line-clamp-2 sm:line-clamp-none">{uc.summary[lang] || uc.summary.en}</p>
                    <Link href={`/${locale}/use-cases/${uc.slug}`} className="inline-flex items-center gap-1 text-xs text-white/50 hover:text-white mt-2" onClick={(e) => e.stopPropagation()}>
                      {lang === "zh" ? "阅读全文" : "Read article"} &rarr;
                    </Link>
                  </div>
                </button>

                {/* Expanded content */}
                {isExpanded && (
                  <div className="p-4 sm:p-6">
                    {/* Visual infographic per use case */}
                    <CaseVisual slug={uc.slug} lang={lang} />

                    {/* Markdown content (preview) */}
                    <div className="prose prose-sm max-w-none prose-headings:text-gray-900 prose-h2:text-lg prose-h2:mt-6 prose-h2:mb-3 prose-h3:text-base prose-p:text-gray-600 prose-li:text-gray-600 prose-strong:text-gray-800 line-clamp-[20]">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>
                        {uc.content[lang] || uc.content.en}
                      </ReactMarkdown>
                    </div>

                    {/* Read full article link */}
                    <div className="mt-4 pt-4 border-t border-gray-100">
                      <Link href={`/${locale}/use-cases/${uc.slug}`} className="inline-flex items-center gap-1 text-sm font-medium text-red-700 hover:text-red-900">
                        {lang === "zh" ? "阅读完整文章" : "Read full article"}
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
                      </Link>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* CTA */}
        <div className="mt-8 sm:mt-12 text-center bg-white rounded-xl border border-gray-200 p-6 sm:p-8">
          <h2 className="text-xl sm:text-2xl font-bold mb-2">{lang === "zh" ? "准备好开始了吗？" : "Ready to get started?"}</h2>
          <p className="text-sm sm:text-base text-gray-500 mb-6">{lang === "zh" ? "免费部署你的第一个 AI 员工，几分钟即可上手" : "Deploy your first AI employee for free — get started in minutes"}</p>
          <Link
            href={`/${locale}/dashboard`}
            className="inline-flex items-center justify-center bg-red-600 hover:bg-red-700 text-white px-8 py-3 rounded-lg text-sm font-semibold transition-colors"
          >
            {lang === "zh" ? "免费开始" : "Get Started Free"}
          </Link>
        </div>
      </main>
    </div>
  );
}
