"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { getDictionary, type Locale } from "@/lib/i18n";
import LanguageSwitcher from "@/components/LanguageSwitcher";

type L = "en" | "zh";

/* Sample personas shown as a teaser for the coming-soon enhancement.
   Full roster + cited evidence lives on /agents/personas. */
const PERSONA_TEASER: { emoji: string; name: Record<L, string> }[] = [
  { emoji: "🚀", name: { en: "Musk", zh: "马斯克" } },
  { emoji: "🧭", name: { en: "Naval", zh: "纳瓦尔" } },
  { emoji: "🔄", name: { en: "Munger", zh: "芒格" } },
  { emoji: "🔬", name: { en: "Feynman", zh: "费曼" } },
  { emoji: "🍎", name: { en: "Jobs", zh: "乔布斯" } },
  { emoji: "🦢", name: { en: "Taleb", zh: "塔勒布" } },
  { emoji: "🎬", name: { en: "MrBeast", zh: "MrBeast" } },
];

export default function AgentsPage() {
  const params = useParams();
  const locale = (params.locale as Locale) || "en";
  const lang: L = locale.startsWith("zh") ? "zh" : "en";
  const dict = getDictionary(locale);
  const t = dict.landing;
  const tc = dict.common;

  // General AI employees — reuse the homepage dictionary so all locales stay in sync
  const GENERAL = [
    { title: t.agentEmailTitle, desc: t.agentEmailDesc },
    { title: t.agentSeoTitle, desc: t.agentSeoDesc },
    { title: t.agentLeadTitle, desc: t.agentLeadDesc },
    { title: t.agentSocialTitle, desc: t.agentSocialDesc },
    { title: t.agentPmTitle, desc: t.agentPmDesc },
    { title: t.agentSalesTitle, desc: t.agentSalesDesc },
    { title: t.agentOrchestratorTitle, desc: t.agentOrchestratorDesc },
  ];

  const ENHANCE: { icon: string; title: Record<L, string>; desc: Record<L, string> }[] = [
    {
      icon: "🎯",
      title: { en: "Sharper task recommendations", zh: "更精准的任务推荐" },
      desc: { en: "A persona's decision heuristics bias the agent toward the right next action for that kind of work — not generic best-practice.", zh: "人物的决策启发式让 Agent 倾向于为该类工作选择正确的下一步，而非泛泛的通用最佳实践。" },
    },
    {
      icon: "🧠",
      title: { en: "An expert judgment layer", zh: "一层专家判断" },
      desc: { en: "On top of general capability, the agent reasons through a distilled mental model — Musk on cost, Munger on bias, Feynman on understanding.", zh: "在通用能力之上，Agent 用蒸馏的心智模型推理——马斯克看成本、芒格看偏误、费曼看理解。" },
    },
    {
      icon: "👥",
      title: { en: "A multi-perspective board", zh: "多视角顾问团" },
      desc: { en: "Run several personas on the same decision and read where they disagree — that gap is the insight a single agent misses.", zh: "让多个人物审视同一决策，分歧之处即是单个 Agent 会错过的洞见。" },
    },
    {
      icon: "🧩",
      title: { en: "Composable on your AI employees", zh: "叠加在你的 AI 员工之上" },
      desc: { en: "Persona enhancement is an optional layer over any General Agent — keep the workflow, upgrade the judgment.", zh: "人物增强是叠加在任意 General Agent 之上的可选层——保留工作流，升级判断力。" },
    },
  ];

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-4 flex items-center justify-between">
          <Link href={`/${locale}`} className="text-xl sm:text-2xl font-bold tracking-tight flex items-center gap-2">
            <img src="/logo.svg" alt="AutoClaw" className="w-8 h-8 sm:w-9 sm:h-9" />
            <span><span className="text-red-600">Auto</span>Claw</span>
          </Link>
          <div className="flex items-center gap-2 sm:gap-4">
            <Link href={`/${locale}`} className="text-xs sm:text-sm text-gray-500 hover:text-gray-700 transition-colors">{lang === "zh" ? "首页" : "Home"}</Link>
            <Link href={`/${locale}/use-cases`} className="text-xs sm:text-sm text-gray-500 hover:text-gray-700 transition-colors">{lang === "zh" ? "客户案例" : "Use Cases"}</Link>
            <Link href={`/${locale}/dashboard`} className="text-xs sm:text-sm text-gray-500 hover:text-gray-700 transition-colors">{tc.dashboard}</Link>
            <LanguageSwitcher locale={locale} />
          </div>
        </div>
      </header>

      <main>
        {/* Hero */}
        <section className="relative overflow-hidden bg-gradient-to-br from-gray-900 via-gray-900 to-red-950 text-white">
          <div className="absolute inset-0 opacity-[0.07]" style={{ backgroundImage: "radial-gradient(circle at 1px 1px, white 1px, transparent 0)", backgroundSize: "28px 28px" }} />
          <div className="relative max-w-5xl mx-auto px-4 sm:px-6 py-16 sm:py-24 text-center">
            <span className="inline-block text-[11px] uppercase tracking-[0.2em] text-red-300 mb-4">{lang === "zh" ? "AutoClaw Agents" : "AutoClaw Agents"}</span>
            <h1 className="text-3xl sm:text-5xl font-bold tracking-tight max-w-3xl mx-auto leading-tight">
              {lang === "zh" ? "AI 员工，现在拥有人物属性增强" : "AI employees — now with persona enhancement"}
            </h1>
            <p className="mt-5 text-base sm:text-lg text-gray-300 max-w-2xl mx-auto">
              {lang === "zh"
                ? "AutoClaw 的 General Agent 已经能自主完成营销与销售工作。下一步，我们为它们加入人物属性——让顶尖头脑的判断力，为不同任务提供更精准的推荐。"
                : "AutoClaw's General Agents already run your marketing and sales work autonomously. Next, we're adding persona attributes — so the judgment of the best minds powers sharper recommendations for every kind of task."}
            </p>
            <div className="mt-8 flex flex-wrap justify-center gap-3">
              <Link href={`/${locale}/dashboard`} className="inline-flex items-center justify-center bg-red-600 hover:bg-red-700 text-white px-7 py-3 rounded-lg text-sm font-semibold transition-colors">
                {lang === "zh" ? "免费部署 AI 员工" : "Deploy AI employees free"}
              </Link>
              <Link href={`/${locale}/agents/personas`} className="inline-flex items-center justify-center bg-white/10 hover:bg-white/20 border border-white/20 text-white px-7 py-3 rounded-lg text-sm font-semibold transition-colors">
                {lang === "zh" ? "查看人物增强案例" : "See the persona showcase"}
              </Link>
            </div>
          </div>
        </section>

        {/* Two pillars */}
        <section className="max-w-6xl mx-auto px-4 sm:px-6 py-14 sm:py-16">
          <div className="grid lg:grid-cols-2 gap-6">
            {/* Pillar 1 — General Agents (live) */}
            <div className="rounded-2xl border border-gray-200 bg-white p-6 sm:p-8 flex flex-col">
              <div className="flex items-center gap-2 mb-3">
                <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-green-700 bg-green-50 border border-green-200 rounded-full px-2.5 py-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-green-500" />{lang === "zh" ? "现已上线" : "Available now"}
                </span>
              </div>
              <h2 className="text-xl sm:text-2xl font-bold text-gray-900 mb-2">{lang === "zh" ? "General Agent · 通用 AI 员工" : "General Agents · Your AI workforce"}</h2>
              <p className="text-sm text-gray-600 leading-relaxed mb-5">
                {lang === "zh"
                  ? "开箱即用的自主 AI 员工，覆盖潜客开发、邮件、内容、社媒、项目与销售，由协调者统一编排，作为团队协同工作。"
                  : "Ready-to-deploy autonomous AI employees spanning prospecting, email, content, social, project and sales — coordinated by an orchestrator so they work as a team."}
              </p>
              <ul className="space-y-2.5 flex-1">
                {GENERAL.map((g) => (
                  <li key={g.title} className="flex gap-2.5">
                    <svg className="w-4 h-4 text-green-600 mt-0.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                    <span><span className="text-sm font-semibold text-gray-900">{g.title}</span><span className="text-sm text-gray-500"> — {g.desc}</span></span>
                  </li>
                ))}
              </ul>
              <Link href={`/${locale}/dashboard`} className="mt-6 inline-flex items-center justify-center bg-gray-900 hover:bg-black text-white px-6 py-2.5 rounded-lg text-sm font-semibold transition-colors">
                {lang === "zh" ? "部署 AI 员工" : "Deploy an AI employee"}
              </Link>
            </div>

            {/* Pillar 2 — Persona-Enhanced (coming soon) */}
            <div className="rounded-2xl border-2 border-red-200 bg-gradient-to-br from-white to-red-50/40 p-6 sm:p-8 flex flex-col">
              <div className="flex items-center gap-2 mb-3">
                <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-2.5 py-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />{lang === "zh" ? "即将上线" : "Coming soon"}
                </span>
              </div>
              <h2 className="text-xl sm:text-2xl font-bold text-gray-900 mb-2">{lang === "zh" ? "人物增强 Agent · Persona Enhancement" : "Persona-Enhanced Agents"}</h2>
              <p className="text-sm text-gray-600 leading-relaxed mb-5">
                {lang === "zh"
                  ? "在通用能力之上，叠加一位顶尖头脑的认知操作系统——心智模型、决策启发式与表达 DNA——为不同任务提供更精准的推荐与判断。这不是角色扮演，而是真实思维框架。"
                  : "On top of general capability, layer a top mind's cognitive operating system — mental models, decision heuristics and expression DNA — to power sharper recommendations and judgment per task. Not role-play; real reasoning frameworks."}
              </p>
              <div className="flex flex-wrap gap-2 mb-5">
                {PERSONA_TEASER.map((p) => (
                  <span key={p.name.en} className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-white border border-gray-200 text-gray-700">
                    <span>{p.emoji}</span>{p.name[lang]}
                  </span>
                ))}
                <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-white border border-gray-200 text-gray-500">+8 {lang === "zh" ? "更多" : "more"}</span>
              </div>
              <div className="flex-1" />
              <Link href={`/${locale}/agents/personas`} className="mt-2 inline-flex items-center justify-center bg-red-600 hover:bg-red-700 text-white px-6 py-2.5 rounded-lg text-sm font-semibold transition-colors">
                {lang === "zh" ? "预览人物增强案例 →" : "Preview the persona showcase →"}
              </Link>
            </div>
          </div>
        </section>

        {/* How persona enhancement helps */}
        <section className="bg-white border-y border-gray-200">
          <div className="max-w-6xl mx-auto px-4 sm:px-6 py-14 sm:py-16">
            <div className="text-center mb-10">
              <h2 className="text-2xl sm:text-3xl font-bold text-gray-900">{lang === "zh" ? "人物属性如何提升工作流" : "How persona attributes upgrade the workflow"}</h2>
              <p className="mt-3 text-gray-500 max-w-2xl mx-auto">
                {lang === "zh" ? "General Agent 负责把事情做完；人物增强负责把判断做对。" : "General Agents get the work done. Persona enhancement gets the judgment right."}
              </p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {ENHANCE.map((e) => (
                <div key={e.title.en} className="rounded-xl border border-gray-200 p-5">
                  <div className="text-2xl mb-3">{e.icon}</div>
                  <h3 className="text-sm font-semibold text-gray-900 mb-2">{e.title[lang]}</h3>
                  <p className="text-xs text-gray-600 leading-relaxed">{e.desc[lang]}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Case-study callout */}
        <section className="max-w-6xl mx-auto px-4 sm:px-6 py-14 sm:py-16">
          <div className="rounded-2xl bg-gradient-to-br from-gray-900 to-red-950 text-white p-8 sm:p-12">
            <div className="grid lg:grid-cols-[1.5fr_1fr] gap-8 items-center">
              <div>
                <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-amber-300 mb-3">
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-300 animate-pulse" />{lang === "zh" ? "案例文章" : "Case-study article"}
                </span>
                <h2 className="text-xl sm:text-2xl font-bold mb-3">{lang === "zh" ? "把顶尖头脑变成 AI 顾问：15+ 人物与市场证据" : "Turning the best minds into AI advisors: 15+ personas & the market evidence"}</h2>
                <p className="text-sm text-gray-300 leading-relaxed mb-5">
                  {lang === "zh"
                    ? "深度展示人物增强的完整名册（马斯克、纳瓦尔、芒格、费曼……）、它们如何提升 AI 工作流，以及来自 NAACL/ICLR 论文、Klarna、a16z、MIT Sloan 的真实引用证据。"
                    : "A deep showcase of the full persona roster (Musk, Naval, Munger, Feynman…), how they upgrade the AI workflow, and real cited evidence from NAACL/ICLR papers, Klarna, a16z and MIT Sloan."}
                </p>
                <Link href={`/${locale}/agents/personas`} className="inline-flex items-center gap-1.5 bg-white text-gray-900 hover:bg-gray-100 px-6 py-2.5 rounded-lg text-sm font-semibold transition-colors">
                  {lang === "zh" ? "阅读案例文章" : "Read the case study"} →
                </Link>
              </div>
              <div className="flex flex-wrap gap-2 lg:justify-end">
                {PERSONA_TEASER.slice(0, 6).map((p) => (
                  <span key={p.name.en} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium bg-white/10 border border-white/15">
                    <span>{p.emoji}</span>{p.name[lang]}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
