"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { getDictionary, type Locale } from "@/lib/i18n";
import LanguageSwitcher from "@/components/LanguageSwitcher";

type L = "en" | "zh";
type T = Record<L, string>;

/* ------------------------------------------------------------------ */
/* Character / perspective agents distilled by AutoClaw                */
/* ------------------------------------------------------------------ */
const AGENTS: {
  name: T;
  emoji: string;
  domain: T;
  lens: T;
  bestFor: T;
}[] = [
  {
    name: { en: "Elon Musk", zh: "埃隆·马斯克" },
    emoji: "🚀",
    domain: { en: "First-Principles Engineering", zh: "第一性原理工程" },
    lens: { en: "Idiot index · 5-step algorithm · physics-floor cost teardown · vertical integration", zh: "白痴指数 · 五步算法 · 物理极限成本拆解 · 垂直整合" },
    bestFor: { en: "Cost structure, radical iteration, challenging industry assumptions", zh: "成本拆解、激进迭代、挑战行业假设" },
  },
  {
    name: { en: "Naval Ravikant", zh: "纳瓦尔·拉维坎特" },
    emoji: "🧭",
    domain: { en: "Leverage & Wealth", zh: "杠杆与财富" },
    lens: { en: "Specific knowledge · desire-as-contract · permissionless leverage · serial compounding", zh: "特定知识 · 欲望即契约 · 无需许可的杠杆 · 串行复利" },
    bestFor: { en: "Career leverage, focus, what to build first", zh: "职业杠杆、聚焦、先做哪一件事" },
  },
  {
    name: { en: "Charlie Munger", zh: "查理·芒格" },
    emoji: "🔄",
    domain: { en: "Inversion & Mental Models", zh: "逆向思考与思维模型" },
    lens: { en: "Invert always · cognitive-bias checklist · Lollapalooza effect · circle of competence", zh: "永远反过来想 · 认知偏误清单 · Lollapalooza 效应 · 能力圈" },
    bestFor: { en: "Investment review, bias detection, cross-disciplinary thinking", zh: "投资审视、偏误检查、跨学科思考" },
  },
  {
    name: { en: "Richard Feynman", zh: "理查德·费曼" },
    emoji: "🔬",
    domain: { en: "Understanding vs. Naming", zh: "理解 vs 命名" },
    lens: { en: "Cargo-cult detection · naming ≠ understanding · demonstrate, don't argue · anti-self-deception", zh: "货物崇拜检测 · 命名不等于理解 · 用演示替代论证 · 反自欺" },
    bestFor: { en: "Stress-testing whether you truly understand a thing", zh: "检验你是否真正理解某件事" },
  },
  {
    name: { en: "Steve Jobs", zh: "史蒂夫·乔布斯" },
    emoji: "🍎",
    domain: { en: "Product Taste & Focus", zh: "产品品味与聚焦" },
    lens: { en: "Say no to 1,000 things · end-to-end experience · simplicity as the final layer", zh: "对一千件事说不 · 端到端体验 · 简单是最后一层" },
    bestFor: { en: "Product decisions, ruthless prioritization, design reviews", zh: "产品决策、极致优先级、设计评审" },
  },
  {
    name: { en: "Nassim Taleb", zh: "纳西姆·塔勒布" },
    emoji: "🦢",
    domain: { en: "Antifragility & Tail Risk", zh: "反脆弱与尾部风险" },
    lens: { en: "Black-swan exposure · skin in the game · barbell strategy · precautionary principle", zh: "黑天鹅暴露 · 利益攸关 · 杠铃策略 · 预防原则" },
    bestFor: { en: "Risk decisions, questioning consensus narratives", zh: "风险决策、质疑主流叙事" },
  },
  {
    name: { en: "Andrej Karpathy", zh: "安德烈·卡帕西" },
    emoji: "🧠",
    domain: { en: "AI Engineering Realism", zh: "AI 工程现实主义" },
    lens: { en: "Software 2.0/3.0 · march of nines · jagged intelligence · build-to-understand", zh: "Software 2.0/3.0 · march of nines · 锯齿状智能 · 构建即理解" },
    bestFor: { en: "AI reliability, hype calibration, LLM capability boundaries", zh: "AI 可靠性、炒作判断、LLM 能力边界" },
  },
  {
    name: { en: "Ilya Sutskever", zh: "伊利亚·苏茨克维" },
    emoji: "🌌",
    domain: { en: "AI Research Taste & Safety", zh: "AI 研究品味与安全" },
    lens: { en: "Scaling intuition · research-direction taste · alignment-first reasoning", zh: "规模化直觉 · 研究方向品味 · 安全优先推理" },
    bestFor: { en: "AI technical direction, safety strategy, research bets", zh: "AI 技术方向、安全策略、研究下注" },
  },
  {
    name: { en: "MrBeast", zh: "MrBeast" },
    emoji: "🎬",
    domain: { en: "Content Virality OS", zh: "内容病毒式增长系统" },
    lens: { en: "Title × thumbnail × hook × retention-curve obsession (from the leaked 36-page playbook)", zh: "标题 × 缩略图 × Hook × 留存曲线（源自泄露的 36 页内部手册）" },
    bestFor: { en: "Video CTR, titles, thumbnails, audience retention", zh: "视频点击率、标题、缩略图、观众留存" },
  },
  {
    name: { en: "Paul Graham", zh: "保罗·格雷厄姆" },
    emoji: "✍️",
    domain: { en: "Startups & Writing", zh: "创业与写作" },
    lens: { en: "Make something people want · do things that don't scale · write to think", zh: "做人们想要的东西 · 做不可规模化的事 · 以写作思考" },
    bestFor: { en: "Early-stage startups, essays, founder decisions", zh: "早期创业、文章写作、创始人决策" },
  },
  {
    name: { en: "Donald Trump", zh: "唐纳德·特朗普" },
    emoji: "🎤",
    domain: { en: "Negotiation, Power & Attention", zh: "谈判、权力与注意力" },
    lens: { en: "Anchor extreme · control the frame · weaponize attention · behavior prediction", zh: "极端锚定 · 掌控叙事框架 · 武器化注意力 · 行为预判" },
    bestFor: { en: "Hardball negotiation, messaging, predicting his next move", zh: "强硬谈判、传播、预判其下一步" },
  },
  {
    name: { en: "Zhang Yiming", zh: "张一鸣" },
    emoji: "📈",
    domain: { en: "Product, Org & Globalization", zh: "产品、组织与全球化" },
    lens: { en: "Context not control · delay gratification · globalize from day one (ByteDance/TikTok)", zh: "Context not control · 延迟满足 · 生而全球化（字节/TikTok）" },
    bestFor: { en: "Org design, product strategy, going global", zh: "组织设计、产品策略、全球化" },
  },
  {
    name: { en: "Zhang Xuefeng", zh: "张雪峰" },
    emoji: "🎓",
    domain: { en: "Education & Career Planning", zh: "教育与职业规划" },
    lens: { en: "Class-mobility realism · major-to-job mapping · risk-aware family advice", zh: "阶层流动现实主义 · 专业到职业映射 · 风险意识的家庭建议" },
    bestFor: { en: "Education choices, major selection, career planning (China)", zh: "升学选择、专业选择、职业规划（中国）" },
  },
  {
    name: { en: "Justin Sun", zh: "孙宇晨" },
    emoji: "📣",
    domain: { en: "Attention Economy & Narrative", zh: "注意力经济与叙事" },
    lens: { en: "Attention arbitrage · narrative manipulation · crisis PR · ride every trend", zh: "注意力套利 · 叙事操控 · 危机公关 · 蹭一切热点" },
    bestFor: { en: "Marketing stunts, attention strategy, crisis spin", zh: "营销造势、注意力策略、危机公关" },
  },
  {
    name: { en: "X Mastery Mentor", zh: "X 增长导师" },
    emoji: "🐦",
    domain: { en: "X / Twitter Growth Operator", zh: "X / Twitter 运营操盘" },
    lens: { en: "Distilled from Nicolas Cole, Dickie Bush, Sahil Bloom, Justin Welsh, Dan Koe & Hormozi + the open X algorithm", zh: "蒸馏自 Nicolas Cole、Dickie Bush、Sahil Bloom、Justin Welsh、Dan Koe、Hormozi + X 开源算法" },
    bestFor: { en: "Tweet writing, threads, audience growth on X", zh: "推文写作、Thread、X 涨粉" },
  },
];

/* ------------------------------------------------------------------ */
/* Six things AutoClaw extracts (the "cognitive operating system")     */
/* ------------------------------------------------------------------ */
const LAYERS: { icon: string; title: T; desc: T }[] = [
  { icon: "🗣️", title: { en: "How they speak", zh: "如何表达" }, desc: { en: "Expression DNA — tone, rhythm, signature phrasing", zh: "表达 DNA——语气、节奏、标志性句式" } },
  { icon: "🧩", title: { en: "How they think", zh: "如何思考" }, desc: { en: "3–7 core mental models & cognitive frameworks", zh: "3–7 个核心心智模型与认知框架" } },
  { icon: "⚖️", title: { en: "How they judge", zh: "如何判断" }, desc: { en: "5–10 decision heuristics applied to new problems", zh: "5–10 条决策启发式，用于新问题" } },
  { icon: "🚫", title: { en: "What they won't do", zh: "绝不会做什么" }, desc: { en: "Anti-patterns and the value floor", zh: "反模式与价值底线" } },
  { icon: "🔍", title: { en: "Honest limits", zh: "诚实的边界" }, desc: { en: "What the agent genuinely cannot do", zh: "这个 Agent 真正无法做到的事" } },
];

/* ------------------------------------------------------------------ */
/* Market case studies / evidence — every number is cited below        */
/* ------------------------------------------------------------------ */
const CASES: {
  tag: T;
  metric: string;
  title: T;
  body: T;
  refs: number[];
}[] = [
  {
    tag: { en: "Role prompting · NAACL 2024", zh: "角色提示 · NAACL 2024" },
    metric: "+10.3 pts",
    title: { en: "Reasoning through a role beats generic prompting", zh: "以角色推理优于通用提示" },
    body: {
      en: "Peer-reviewed research found role-play prompting lifted ChatGPT's accuracy on algebra word problems from 53.5% to 63.8% (+10.3 points) and beat standard zero-shot prompting on most of 12 reasoning benchmarks. Reasoning is exactly the regime where a distilled mental-model agent shines.",
      zh: "经同行评审的研究发现，角色扮演提示让 ChatGPT 在代数应用题上的准确率从 53.5% 升至 63.8%（+10.3 个百分点），并在 12 个推理基准中的大多数上超过标准 zero-shot 提示。推理正是蒸馏后的心智模型 Agent 最擅长的领域。",
    },
    refs: [1],
  },
  {
    tag: { en: "Multi-agent · ICLR 2024", zh: "多智能体 · ICLR 2024" },
    metric: "85.9% Pass@1",
    title: { en: "Distinct expert roles produce state-of-the-art results", zh: "明确的专家角色带来 SOTA 结果" },
    body: {
      en: "MetaGPT assigns human-analogous expert roles (PM, architect, engineer, QA) to collaborating agents and reached 85.9% Pass@1 on HumanEval and 87.7% on MBPP, surpassing prior chat-based multi-agent frameworks. \"Expert role\" is a validated primitive — the same one AutoClaw builds on.",
      zh: "MetaGPT 为协作 Agent 分配类人专家角色（产品、架构、工程、测试），在 HumanEval 上达到 85.9% Pass@1、MBPP 上达到 87.7%，超越此前基于对话的多智能体框架。「专家角色」是被验证过的设计原语——也正是 AutoClaw 的基石。",
    },
    refs: [2],
  },
  {
    tag: { en: "Enterprise ROI · Klarna", zh: "企业 ROI · Klarna" },
    metric: "700 agents",
    title: { en: "One AI assistant doing the work of 700 agents", zh: "一个 AI 助手完成 700 名客服的工作量" },
    body: {
      en: "Klarna's AI assistant handled 2.3M conversations in its first month — two-thirds of all customer-service chats — doing the workload of 700 full-time agents, cutting resolution time from 11 minutes to under 2, with CSAT on par with humans and an estimated $40M profit improvement. Persona-driven AI is already production-grade knowledge work.",
      zh: "Klarna 的 AI 助手上线首月处理了 230 万次对话——占全部客服会话的三分之二——完成相当于 700 名全职客服的工作量，将解决时间从 11 分钟压缩到 2 分钟以内，满意度与人工持平，预计带来 4000 万美元利润提升。角色驱动的 AI 已是生产级的知识工作。",
    },
    refs: [3],
  },
  {
    tag: { en: "Market demand · GitHub", zh: "市场需求 · GitHub" },
    metric: "~7K stars / 5 days",
    title: { en: "\"Distill a person into an AI\" is going viral", zh: "「把一个人蒸馏成 AI」正在病毒式传播" },
    body: {
      en: "The open-source colleague-skill project — which distills a person's review criteria and decision heuristics into a loadable agent — gained roughly 7,000 GitHub stars in five days and now sits in the tens of thousands, explicitly supporting colleagues, relationships and celebrities. The market clearly wants distilled-person agents. AutoClaw is the engine that puts them to work.",
      zh: "开源项目 colleague-skill——把一个人的评审标准与决策启发式蒸馏成可加载的 Agent——五天内获得约 7,000 个 GitHub star，如今已达数万，并明确支持同事、关系与名人三类角色。市场显然想要「人格蒸馏」Agent，而 AutoClaw 正是让它们投入工作的引擎。",
    },
    refs: [4],
  },
  {
    tag: { en: "Consumer scale · a16z", zh: "消费级规模 · a16z" },
    metric: "#2 GenAI app",
    title: { en: "Character chat is the #2 consumer AI category", zh: "角色对话是消费级 AI 第二大品类" },
    body: {
      en: "Andreessen Horowitz's consumer GenAI analysis ranks Character.AI a \"solid #2\" after ChatGPT — about 21% of ChatGPT's scale with notably higher retention. People don't just tolerate talking to character agents; they prefer it. AutoClaw points that pull at real work.",
      zh: "Andreessen Horowitz 的消费级 GenAI 分析将 Character.AI 列为仅次于 ChatGPT 的「稳居第二」——约为 ChatGPT 规模的 21%，且留存明显更高。人们不只是接受与角色 Agent 对话，而是更偏爱它。AutoClaw 把这股拉力导向真实工作。",
    },
    refs: [5],
  },
  {
    tag: { en: "Executive practice · MIT Sloan", zh: "高管实践 · MIT Sloan" },
    metric: "Personal AI board",
    title: { en: "A personal board of directors, built from AI personas", zh: "用 AI 人格搭建的个人董事会" },
    body: {
      en: "MIT Sloan Management Review documents an executive building a personal \"board of directors\" from GenAI personas of real iconic leaders (Steve Jobs, Indra Nooyi, Nelson Mandela) for strategy, innovation and ethics counsel. This is exactly the AutoClaw perspective-agent concept — validated in a high-authority publication.",
      zh: "《MIT 斯隆管理评论》记录了一位高管用真实标志性领袖（乔布斯、英德拉·努伊、曼德拉）的 GenAI 人格搭建个人「董事会」，用于战略、创新与伦理决策。这正是 AutoClaw 角色 Agent 的核心理念——已被高权威刊物背书。",
    },
    refs: [6],
  },
];

/* The honesty section — keeps the page credible */
const REFERENCES: { n: number; text: T; url: string }[] = [
  { n: 1, text: { en: "Kong et al., \"Better Zero-Shot Reasoning with Role-Play Prompting,\" NAACL 2024.", zh: "Kong 等，《Better Zero-Shot Reasoning with Role-Play Prompting》，NAACL 2024。" }, url: "https://arxiv.org/abs/2308.07702" },
  { n: 2, text: { en: "Hong et al., \"MetaGPT: Meta Programming for a Multi-Agent Collaborative Framework,\" ICLR 2024.", zh: "Hong 等，《MetaGPT: Meta Programming for a Multi-Agent Collaborative Framework》，ICLR 2024。" }, url: "https://arxiv.org/abs/2308.00352" },
  { n: 3, text: { en: "Klarna press release, \"Klarna AI assistant handles two-thirds of customer service chats in its first month,\" Feb 27, 2024.", zh: "Klarna 新闻稿，《Klarna AI 助手上线首月处理三分之二客服会话》，2024 年 2 月 27 日。" }, url: "https://www.klarna.com/international/press/klarna-ai-assistant-handles-two-thirds-of-customer-service-chats-in-its-first-month/" },
  { n: 4, text: { en: "titanwings/colleague-skill (\"Digital Life 1.0\"), GitHub.", zh: "titanwings/colleague-skill（「数字生命 1.0」），GitHub。" }, url: "https://github.com/titanwings/colleague-skill" },
  { n: 5, text: { en: "Andreessen Horowitz, \"How Are Consumers Using Generative AI?\" Sept 13, 2023.", zh: "Andreessen Horowitz，《消费者如何使用生成式 AI？》，2023 年 9 月 13 日。" }, url: "https://a16z.com/how-are-consumers-using-generative-ai/" },
  { n: 6, text: { en: "Vipin Gupta, \"How I Built a Personal Board of Directors With GenAI,\" MIT Sloan Management Review, Jul 21, 2025.", zh: "Vipin Gupta，《我如何用生成式 AI 搭建个人董事会》，MIT 斯隆管理评论，2025 年 7 月 21 日。" }, url: "https://sloanreview.mit.edu/article/how-i-built-a-personal-board-of-directors-with-genai/" },
  { n: 7, text: { en: "Zheng et al., \"When 'A Helpful Assistant' Is Not Really Helpful: Personas in System Prompts Do Not Improve Performances,\" EMNLP Findings 2024 (the honest counter-evidence — personas help reasoning, not raw factual recall).", zh: "Zheng 等，《当「乐于助人的助手」并不真的有用：系统提示中的人格无法提升表现》，EMNLP Findings 2024（诚实的反面证据——人格有助于推理，而非纯事实记忆）。" }, url: "https://arxiv.org/abs/2311.10054" },
];

export default function AgentsPage() {
  const params = useParams();
  const locale = (params.locale as Locale) || "en";
  const lang: L = locale.startsWith("zh") ? "zh" : "en";
  const dict = getDictionary(locale);
  const tc = dict.common;

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
            <Link href={`/${locale}`} className="text-xs sm:text-sm text-gray-500 hover:text-gray-700 transition-colors">
              {lang === "zh" ? "首页" : "Home"}
            </Link>
            <Link href={`/${locale}/agents`} className="text-xs sm:text-sm text-gray-500 hover:text-gray-700 transition-colors">
              {lang === "zh" ? "Agents" : "Agents"}
            </Link>
            <Link href={`/${locale}/use-cases`} className="text-xs sm:text-sm text-gray-500 hover:text-gray-700 transition-colors">
              {lang === "zh" ? "客户案例" : "Use Cases"}
            </Link>
            <Link href={`/${locale}/dashboard`} className="text-xs sm:text-sm text-gray-500 hover:text-gray-700 transition-colors">{tc.dashboard}</Link>
            <LanguageSwitcher locale={locale} />
          </div>
        </div>
      </header>

      <main>
        {/* Hero */}
        <section className="relative overflow-hidden bg-gradient-to-br from-gray-900 via-gray-900 to-red-950 text-white">
          <div className="absolute inset-0 opacity-[0.07]" style={{ backgroundImage: "radial-gradient(circle at 1px 1px, white 1px, transparent 0)", backgroundSize: "28px 28px" }} />
          <div className="relative max-w-6xl mx-auto px-4 sm:px-6 py-16 sm:py-24 text-center">
            <div className="flex items-center justify-center gap-2 mb-4">
              <Link href={`/${locale}/agents`} className="text-[11px] uppercase tracking-[0.2em] text-gray-400 hover:text-white transition-colors">
                &larr; Agents
              </Link>
              <span className="text-gray-600">·</span>
              <span className="inline-flex items-center gap-1.5 text-[11px] uppercase tracking-[0.2em] text-amber-300">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-300 animate-pulse" />
                {lang === "zh" ? "人物增强 · 即将上线" : "Persona Enhancement · Coming Soon"}
              </span>
            </div>
            <span className="inline-block text-[11px] uppercase tracking-[0.2em] text-red-300 mb-4">
              {lang === "zh" ? "案例展示 · 由 AutoClaw 蒸馏与编排" : "Showcase · Distilled & orchestrated by AutoClaw"}
            </span>
            <h1 className="text-3xl sm:text-5xl font-bold tracking-tight max-w-3xl mx-auto leading-tight">
              {lang === "zh"
                ? "把顶尖头脑变成你随时可调用的 AI 顾问"
                : "Turn the best minds into AI advisors you can summon on demand"}
            </h1>
            <p className="mt-5 text-base sm:text-lg text-gray-300 max-w-2xl mx-auto">
              {lang === "zh"
                ? "这不是角色扮演。AutoClaw 蒸馏一个人的认知操作系统——心智模型、决策启发式、表达 DNA 与诚实边界——让马斯克、纳瓦尔、芒格、费曼为你的真实问题工作。"
                : "This isn't role-play. AutoClaw distills a person's cognitive operating system — mental models, decision heuristics, expression DNA and honest limits — so Musk, Naval, Munger and Feynman work on your real problems."}
            </p>
            <div className="mt-8 flex flex-wrap justify-center gap-2">
              {AGENTS.slice(0, 8).map((a) => (
                <span key={a.name.en} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium bg-white/10 border border-white/15 backdrop-blur-sm">
                  <span>{a.emoji}</span>{a.name[lang]}
                </span>
              ))}
              <span className="inline-flex items-center px-3 py-1.5 rounded-full text-xs font-medium bg-white/10 border border-white/15">+{AGENTS.length - 8} {lang === "zh" ? "更多" : "more"}</span>
            </div>
            <div className="mt-9 flex flex-wrap justify-center gap-3">
              <Link href={`/${locale}/dashboard`} className="inline-flex items-center justify-center bg-red-600 hover:bg-red-700 text-white px-7 py-3 rounded-lg text-sm font-semibold transition-colors">
                {lang === "zh" ? "先部署 AI 员工" : "Deploy AI Employees now"}
              </Link>
              <Link href={`/${locale}/agents`} className="inline-flex items-center justify-center bg-white/10 hover:bg-white/20 border border-white/20 text-white px-7 py-3 rounded-lg text-sm font-semibold transition-colors">
                {lang === "zh" ? "了解 Agent 能力" : "Explore Agent capabilities"}
              </Link>
            </div>
          </div>
        </section>

        {/* What AutoClaw distills */}
        <section className="max-w-6xl mx-auto px-4 sm:px-6 py-14 sm:py-16">
          <div className="text-center mb-10">
            <h2 className="text-2xl sm:text-3xl font-bold text-gray-900">
              {lang === "zh" ? "不是引用名言，而是蒸馏认知操作系统" : "Not quotes — a distilled cognitive operating system"}
            </h2>
            <p className="mt-3 text-gray-500 max-w-2xl mx-auto">
              {lang === "zh"
                ? "每个角色 Agent 都经过六个并行调研流与三重验证提炼，再写入可加载的技能。一个心智模型必须满足：跨 2+ 领域出现、能预测新问题上的立场、且非常识——三者缺一不可。"
                : "Every agent is built from six parallel research streams and triple-verified extraction. A mental model is kept only if it appears across 2+ domains, predicts positions on new questions, and isn't something any smart person would say — all three required."}
            </p>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
            {LAYERS.map((l) => (
              <div key={l.title.en} className="bg-white rounded-xl border border-gray-200 p-4 text-center">
                <div className="text-2xl mb-2">{l.icon}</div>
                <h3 className="text-sm font-semibold text-gray-900 mb-1">{l.title[lang]}</h3>
                <p className="text-xs text-gray-500 leading-relaxed">{l.desc[lang]}</p>
              </div>
            ))}
          </div>
        </section>

        {/* The roster */}
        <section className="bg-white border-y border-gray-200">
          <div className="max-w-6xl mx-auto px-4 sm:px-6 py-14 sm:py-16">
            <div className="text-center mb-10">
              <h2 className="text-2xl sm:text-3xl font-bold text-gray-900">{lang === "zh" ? "角色 Agent 名册" : "The Perspective-Agent Roster"}</h2>
              <p className="mt-3 text-gray-500 max-w-2xl mx-auto">
                {lang === "zh" ? "15+ 个已蒸馏的角色，覆盖工程、投资、产品、内容、谈判与教育。任意切换，或组成多视角顾问团并行运行。" : "15+ distilled minds spanning engineering, investing, product, content, negotiation and education. Switch between them, or run several in parallel as a multi-perspective board."}
              </p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {AGENTS.map((a) => (
                <div key={a.name.en} className="group rounded-xl border border-gray-200 p-5 hover:border-red-300 hover:shadow-sm transition-all">
                  <div className="flex items-center gap-3 mb-3">
                    <div className="text-2xl w-10 h-10 flex items-center justify-center rounded-lg bg-gray-100 group-hover:bg-red-50 transition-colors">{a.emoji}</div>
                    <div className="min-w-0">
                      <h3 className="text-sm font-bold text-gray-900 leading-tight">{a.name[lang]}</h3>
                      <p className="text-[11px] uppercase tracking-wide text-red-600 font-medium">{a.domain[lang]}</p>
                    </div>
                  </div>
                  <p className="text-xs text-gray-600 leading-relaxed mb-3">{a.lens[lang]}</p>
                  <div className="pt-3 border-t border-gray-100">
                    <p className="text-[11px] text-gray-400 uppercase tracking-wide mb-0.5">{lang === "zh" ? "最适合" : "Best for"}</p>
                    <p className="text-xs text-gray-700">{a.bestFor[lang]}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* How they improve the AI workflow */}
        <section className="max-w-6xl mx-auto px-4 sm:px-6 py-14 sm:py-16">
          <div className="text-center mb-10">
            <h2 className="text-2xl sm:text-3xl font-bold text-gray-900">{lang === "zh" ? "它们如何提升你的 AI 工作流" : "How they upgrade your AI workflow"}</h2>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {[
              { t: { en: "Better reasoning, not generic answers", zh: "更强的推理，而非泛泛的答案" }, d: { en: "A distilled mental-model agent reasons through a real framework — the regime where role prompting measurably lifts accuracy.", zh: "蒸馏后的心智模型 Agent 用真实框架推理——这正是角色提示能显著提升准确率的领域。" } },
              { t: { en: "A board, not a single oracle", zh: "一个顾问团，而非单一神谕" }, d: { en: "Run Musk, Munger and Taleb on the same decision in parallel and read where they disagree — that gap is the insight.", zh: "让马斯克、芒格、塔勒布并行审视同一决策，分歧之处即是洞见。" } },
              { t: { en: "Composable into AutoClaw workflows", zh: "可编入 AutoClaw 工作流" }, d: { en: "Drop a perspective agent into any AutoClaw pipeline — strategy review, content critique, prospect qualification.", zh: "把角色 Agent 嵌入任意 AutoClaw 流程——策略审查、内容评判、潜客资格判定。" } },
              { t: { en: "Honest about its limits", zh: "对边界诚实" }, d: { en: "Each agent states what it cannot do — frameworks can be extracted, intuition cannot. No false confidence.", zh: "每个 Agent 都声明自己做不到什么——框架可被提炼，直觉不能。绝不虚假自信。" } },
            ].map((b) => (
              <div key={b.t.en} className="bg-white rounded-xl border border-gray-200 p-5">
                <h3 className="text-sm font-semibold text-gray-900 mb-2">{b.t[lang]}</h3>
                <p className="text-xs text-gray-600 leading-relaxed">{b.d[lang]}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Market case studies */}
        <section className="bg-white border-y border-gray-200">
          <div className="max-w-6xl mx-auto px-4 sm:px-6 py-14 sm:py-16">
            <div className="text-center mb-10">
              <h2 className="text-2xl sm:text-3xl font-bold text-gray-900">{lang === "zh" ? "市场已经证明：角色 Agent 有效" : "The market already proves it: persona agents work"}</h2>
              <p className="mt-3 text-gray-500 max-w-2xl mx-auto">{lang === "zh" ? "每个数字均来自下方引用的同行评审论文、企业新闻稿或权威机构。" : "Every figure below is sourced from the peer-reviewed papers, corporate releases and authoritative institutions cited underneath."}</p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
              {CASES.map((c) => (
                <div key={c.title.en} className="rounded-xl border border-gray-200 p-5 flex flex-col">
                  <p className="text-[11px] uppercase tracking-wide text-gray-400 mb-2">{c.tag[lang]}</p>
                  <p className="text-2xl font-bold text-red-600 mb-2">{c.metric}</p>
                  <h3 className="text-sm font-semibold text-gray-900 mb-2 leading-snug">{c.title[lang]}</h3>
                  <p className="text-xs text-gray-600 leading-relaxed flex-1">{c.body[lang]}</p>
                  <div className="mt-3 pt-3 border-t border-gray-100 flex gap-1.5">
                    {c.refs.map((r) => (
                      <a key={r} href={`#ref-${r}`} className="text-[11px] font-medium text-red-600 hover:text-red-800">[{r}]</a>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            {/* Honesty note */}
            <div className="mt-8 rounded-xl bg-amber-50 border border-amber-200 p-5">
              <p className="text-xs text-amber-900 leading-relaxed">
                <span className="font-semibold">{lang === "zh" ? "诚实说明：" : "An honest note: "}</span>
                {lang === "zh"
                  ? "研究表明，简单的「假装你是专家」标签提示能提升推理类任务，但无法提升纯事实记忆 [7]。这恰恰是 AutoClaw 的差异化所在——它蒸馏的是心智模型与决策启发式（推理领域），而非把 Agent 当作事实数据库。一个不告诉你边界的 Agent，不值得信任。"
                  : "Research shows that cheap \"act as an expert\" label prompting helps reasoning-style tasks but not raw factual recall [7]. That nuance is exactly AutoClaw's edge — it distills mental models and decision heuristics (the reasoning regime), not a factual database. An agent that doesn't tell you its limits isn't worth trusting."}
              </p>
            </div>
          </div>
        </section>

        {/* References */}
        <section className="max-w-6xl mx-auto px-4 sm:px-6 py-12">
          <h2 className="text-lg font-bold text-gray-900 mb-4">{lang === "zh" ? "引用来源" : "References & Citations"}</h2>
          <ol className="space-y-2">
            {REFERENCES.map((r) => (
              <li key={r.n} id={`ref-${r.n}`} className="text-xs text-gray-600 leading-relaxed flex gap-2 scroll-mt-20">
                <span className="text-gray-400 font-medium shrink-0">[{r.n}]</span>
                <span>
                  {r.text[lang]}{" "}
                  <a href={r.url} target="_blank" rel="noopener noreferrer" className="text-red-600 hover:text-red-800 break-all">{r.url}</a>
                </span>
              </li>
            ))}
          </ol>
        </section>

        {/* CTA */}
        <section className="max-w-6xl mx-auto px-4 sm:px-6 pb-16">
          <div className="text-center bg-gradient-to-br from-gray-900 to-red-950 rounded-2xl p-8 sm:p-12 text-white">
            <h2 className="text-xl sm:text-3xl font-bold mb-3">{lang === "zh" ? "组建你的 AI 顾问团" : "Assemble your AI advisory board"}</h2>
            <p className="text-sm sm:text-base text-gray-300 mb-7 max-w-xl mx-auto">{lang === "zh" ? "在 AutoClaw 中部署角色 Agent，让顶尖头脑参与你每天的决策与营销工作流。" : "Deploy perspective agents inside AutoClaw and bring the best minds into your daily decisions and marketing workflows."}</p>
            <Link href={`/${locale}/dashboard`} className="inline-flex items-center justify-center bg-red-600 hover:bg-red-700 text-white px-8 py-3 rounded-lg text-sm font-semibold transition-colors">
              {lang === "zh" ? "免费开始" : "Get Started Free"}
            </Link>
          </div>
        </section>
      </main>
    </div>
  );
}
