import type { Metadata } from "next";
import { SITE_URL, SITE_NAME, DEFAULT_OG_IMAGE, localizedPath, buildLanguageAlternates } from "@/lib/seo";

export interface UseCase {
  slug: string;
  company?: string;
  industry: Record<string, string>;
  agents: number;
  title: Record<string, string>;
  summary: Record<string, string>;
  content: Record<string, string>;
  /** ISO date the study was published/updated — used for sitemap + Article schema */
  date?: string;
}

export const USE_CASES: Record<string, UseCase[]> = {
  existing: [
    {
      slug: "dkwholesale",
      company: "DK Wholesale",
      industry: { en: "B2B Wholesale / E-Commerce", zh: "B2B 批发电商" },
      agents: 4,
      title: { en: "DK Wholesale: AI-Orchestrated B2B Marketing Operations", zh: "DK Wholesale：AI 编排的 B2B 营销运营" },
      summary: {
        en: "4 AI employees with orchestrator coordination, 43 automated tasks, weekly strategy digests",
        zh: "4 个 AI 员工协同运作，43 个自动化任务，每周策略摘要",
      },
      content: {
        en: `## Challenge
DK Wholesale is a B2B wholesale platform that needed to build a marketing operation from scratch — lead generation, email outreach, content creation, and cross-agent coordination — without hiring a marketing team.

## Solution
AutoClaw deployed 4 AI employees with an orchestrator coordinating them:
- **Orchestrator** — Analyzed all agents weekly, generated strategy digests, identified optimization opportunities (28 coordination tasks completed)
- **Lead Prospecting** — Built prospect lists of wholesale buyers and distributors (10 tasks completed)
- **Email Marketing** — Created templates and launched outreach campaigns to prospects (5 tasks completed)
- **SEO Content** — Optimized product pages and blog content for wholesale search terms

## Results
- **43 automated tasks** executed across all agents
- **Weekly strategy digests** auto-generated with cross-agent insights
- **Orchestrator coordination** — the AI employees work as a team, not in silos
- Full marketing operation running autonomously with zero human marketing staff`,
        zh: `## 挑战
DK Wholesale 是一个 B2B 批发平台，需要从零构建营销运营体系 — 潜客开发、邮件触达、内容创建以及跨 Agent 协调 — 无需招聘营销团队。

## 解决方案
AutoClaw 部署了 4 个 AI 员工，由协调者统一编排：
- **协调者** — 每周分析所有 Agent 工作，生成策略摘要，识别优化机会（完成 28 个协调任务）
- **潜客开发** — 构建批发买家和分销商的目标名单（完成 10 个任务）
- **邮件营销** — 创建模板并向目标客户发起营销活动（完成 5 个任务）
- **SEO 内容** — 优化产品页面和博客内容的批发搜索词排名

## 成果
- 所有 Agent 共执行 **43 个自动化任务**
- 自动生成 **每周策略摘要**，包含跨 Agent 洞察
- **协调者编排** — AI 员工作为团队协作，而非各自为政
- 完整营销运营自主运行，零人工营销人员`,
      },
    },
    {
      slug: "usproglove",
      company: "US ProGlove",
      industry: { en: "Industrial Safety / PPE", zh: "工业安全 / 防护用品" },
      agents: 3,
      title: { en: "US ProGlove: Automated B2B Prospecting & Email Outreach", zh: "US ProGlove：自动化 B2B 潜客开发与邮件触达" },
      summary: {
        en: "3 AI employees, 33 tasks completed, 20 enriched contacts, automated cold email campaigns",
        zh: "3 个 AI 员工，33 个任务完成，20 个精准联系人，自动化冷邮件营销",
      },
      content: {
        en: `## Challenge
US ProGlove sells nitrile and industrial safety gloves to businesses across the US. As a small team, they needed to find and reach potential wholesale buyers, distributors, and procurement managers in logistics, warehousing, and manufacturing — industries they had no existing connections in.

## Solution
AutoClaw deployed 3 AI employees:
- **Lead Prospecting** — Defined ideal customer profiles for the PPE industry, searched professional databases, and built a qualified lead list of 20 enriched contacts with company data and decision-maker info (20 tasks completed)
- **Email Marketing** — Created personalized cold outreach templates, configured sending schedules, and launched automated campaigns (13 tasks completed)
- **Sales Follow-Up** — Configured for pipeline tracking and follow-up automation

## Results
- **33 automated tasks** completed across all agents
- **20 enriched B2B contacts** — procurement managers and operations directors at target companies
- **Automated cold email campaigns** running on schedule with personalized templates
- AI-generated ICP identified key industries: logistics, warehousing, food processing, manufacturing
- Zero manual prospecting — AI found and qualified all leads autonomously`,
        zh: `## 挑战
US ProGlove 向全美企业销售丁腈和工业安全手套。作为小团队，他们需要在物流、仓储和制造业 — 之前没有任何联系的行业 — 找到并触达潜在批发买家、分销商和采购经理。

## 解决方案
AutoClaw 部署了 3 个 AI 员工：
- **潜客开发** — 为 PPE 行业定义理想客户画像，搜索专业数据库，构建了 20 个丰富联系人的合格潜客列表，包含企业数据和决策者信息（完成 20 个任务）
- **邮件营销** — 创建个性化冷邮件模板，配置发送计划，发起自动化营销活动（完成 13 个任务）
- **销售跟进** — 配置管道追踪和跟进自动化

## 成果
- 所有 Agent 共完成 **33 个自动化任务**
- **20 个丰富的 B2B 联系人** — 目标公司的采购经理和运营总监
- **自动化冷邮件营销** 按计划运行，使用个性化模板
- AI 生成的 ICP 识别了关键行业：物流、仓储、食品加工、制造业
- 零手动开发 — AI 自主寻找并筛选所有潜客`,
      },
    },
    {
      slug: "gpulaw",
      company: "GPULaw",
      industry: { en: "Legal Tech / SaaS", zh: "法律科技 / SaaS" },
      agents: 1,
      title: { en: "GPULaw: AI Dev Agent for Product Quality", zh: "GPULaw：AI 开发 Agent 保障产品质量" },
      summary: {
        en: "Dev agent running automated code quality checks, deployment monitoring, and health reports",
        zh: "Dev Agent 自动化代码质量检查、部署监控和健康报告",
      },
      content: {
        en: `## Challenge
GPULaw is a legal tech SaaS platform that needed continuous monitoring of code quality, build health, and deployment status — but didn't have a dedicated DevOps team to watch dashboards around the clock.

## Solution
AutoClaw deployed a Dev Agent that runs autonomously:
- **Code Quality Monitoring** — Automated checks on build status, test results, and deployment health
- **Health Reports** — Generated regular health check reports covering CI/CD pipeline, error rates, and system metrics
- **Issue Detection** — Proactively identified build failures and service degradation

## Results
- **6 automated DevOps tasks** completed
- **Regular health check reports** delivered without manual monitoring
- Build failures detected and reported automatically
- Engineering team freed from routine monitoring to focus on feature development`,
        zh: `## 挑战
GPULaw 是一个法律科技 SaaS 平台，需要持续监控代码质量、构建健康状态和部署情况 — 但没有专职 DevOps 团队全天候查看监控面板。

## 解决方案
AutoClaw 部署了一个自主运行的 Dev Agent：
- **代码质量监控** — 自动检查构建状态、测试结果和部署健康
- **健康报告** — 定期生成涵盖 CI/CD 管道、错误率和系统指标的健康检查报告
- **问题检测** — 主动识别构建失败和服务退化

## 成果
- 完成 **6 个自动化 DevOps 任务**
- **定期健康检查报告** 自动交付，无需人工监控
- 构建失败自动检测和报告
- 工程团队从日常监控中解放，专注于功能开发`,
      },
    },
  ],
  featured: [
    {
      slug: "persona-enhanced-agents",
      industry: { en: "AI Capability / Persona Agents", zh: "AI 能力 / 人物增强 Agent" },
      agents: 0,
      date: "2026-06-28",
      title: {
        en: "Persona-Enhanced AI Agents: adding expert mental models to your AI employees (Coming Soon)",
        zh: "人物增强 AI Agent：为你的 AI 员工注入专家心智模型（即将上线）",
      },
      summary: {
        en: "AutoClaw is adding a persona layer to its AI employees — distilled mental models and decision heuristics from minds like Musk, Naval, Munger and Feynman — to power sharper, task-specific recommendations.",
        zh: "AutoClaw 正在为 AI 员工加入人物增强层——蒸馏马斯克、纳瓦尔、芒格、费曼等顶尖头脑的心智模型与决策启发式——为不同任务提供更精准的推荐。",
      },
      content: {
        en: `## What are persona-enhanced AI agents?

Persona-enhanced AI agents are AutoClaw AI employees with an added layer of expert judgment. On top of a General Agent's ability to *do* the work — prospecting, email, content, SEO — the persona layer shapes *how the agent decides*, using the distilled mental models and decision heuristics of a specific top performer.

This is not role-play or quoting famous people. Each persona is built from a person's cognitive operating system: their core mental models, decision heuristics, expression style, and explicit limits.

> **Status: Coming Soon.** General Agents are available today. The persona enhancement layer is in development. Preview the full roster and the research behind it on the [Persona-Enhanced Agents showcase](/en/agents/personas).

## Why add a persona layer to AI marketing agents?

A General Agent gives you a capable, autonomous AI employee. A persona-enhanced agent gives that employee a point of view:

- **Sharper task recommendations** — a persona's decision heuristics bias the agent toward the right next action for that kind of work, instead of generic best-practice.
- **An expert judgment layer** — the agent reasons through a real framework: Musk on cost structure, Munger on cognitive bias, Feynman on whether something is truly understood.
- **A multi-perspective board** — run several personas on the same decision and read where they disagree. That gap is the insight a single agent misses.
- **Composable on your existing AI employees** — persona enhancement is an optional layer over any General Agent. Keep the workflow, upgrade the judgment.

## Which experts can become an agent persona?

The initial roster spans engineering, investing, product, content, negotiation, and education — including Elon Musk, Naval Ravikant, Charlie Munger, Richard Feynman, Steve Jobs, Nassim Taleb, Andrej Karpathy, and a dedicated X / Twitter growth operator.

See the full 15+ persona roster, each with its core lens and best-fit tasks, on the [showcase page](/en/agents/personas).

## Does persona prompting actually improve AI output?

The honest answer from the research: persona and role prompting reliably helps *reasoning-style* tasks but not raw factual recall. That is exactly where persona-enhanced agents operate — distilling mental models and decision heuristics (the reasoning regime), not treating an agent as a factual database.

The showcase page documents the cited evidence, including peer-reviewed role-play prompting results (NAACL 2024), multi-agent expert-role benchmarks (MetaGPT, ICLR 2024), and enterprise AI deployments such as Klarna's assistant doing the work of 700 agents.

## How do I get started today?

You don't have to wait for the persona layer to start seeing value:

1. Deploy a General Agent for prospecting, email, content, or SEO.
2. Let it run real marketing tasks autonomously.
3. Opt into persona enhancement when it ships.

Start with a General Agent now, and preview what's next on the [Persona-Enhanced Agents showcase](/en/agents/personas).`,
        zh: `## 什么是人物增强 AI Agent？

人物增强 AI Agent 是在 AutoClaw AI 员工之上，叠加了一层专家判断。在 General Agent 已经能够*完成工作*（潜客开发、邮件、内容、SEO）的基础上，人物增强层决定了*Agent 如何做判断*——使用某位顶尖人物蒸馏出的心智模型与决策启发式。

这不是角色扮演，也不是引用名言。每个人物都基于其认知操作系统构建：核心心智模型、决策启发式、表达风格，以及明确的能力边界。

> **状态：即将上线。** General Agent 现已可用，人物增强层正在开发中。可在[人物增强 Agent 案例展示](/zh/agents/personas)预览完整名册与背后的研究证据。

## 为什么要为 AI 营销 Agent 加入人物层？

General Agent 给你一个能干、自主的 AI 员工。人物增强 Agent 则让这个员工拥有立场：

- **更精准的任务推荐** —— 人物的决策启发式让 Agent 倾向于为该类工作选择正确的下一步，而非泛泛的通用最佳实践。
- **一层专家判断** —— Agent 用真实框架推理：马斯克看成本结构、芒格看认知偏误、费曼判断是否真正理解。
- **多视角顾问团** —— 让多个人物审视同一决策，分歧之处即是单个 Agent 会错过的洞见。
- **叠加在现有 AI 员工之上** —— 人物增强是叠加在任意 General Agent 之上的可选层。保留工作流，升级判断力。

## 哪些专家可以成为 Agent 人物？

首批名册覆盖工程、投资、产品、内容、谈判与教育——包括埃隆·马斯克、纳瓦尔·拉维坎特、查理·芒格、理查德·费曼、史蒂夫·乔布斯、纳西姆·塔勒布、安德烈·卡帕西，以及一位专精的 X / Twitter 增长操盘手。

完整的 15+ 人物名册（含各自的核心视角与最适合的任务）见[案例展示页](/zh/agents/personas)。

## 人物提示真的能提升 AI 输出吗？

研究给出的诚实答案：人物与角色提示能稳定提升*推理类*任务，但无法提升纯事实记忆。而这正是人物增强 Agent 所处的领域——蒸馏的是心智模型与决策启发式（推理领域），而非把 Agent 当作事实数据库。

案例展示页记录了引用证据，包括经同行评审的角色扮演提示结果（NAACL 2024）、多智能体专家角色基准（MetaGPT，ICLR 2024），以及 Klarna AI 助手完成相当于 700 名客服工作量等企业级落地案例。

## 今天如何开始？

你无需等待人物层上线即可获得价值：

1. 部署一个 General Agent，用于潜客开发、邮件、内容或 SEO。
2. 让它自主运行真实营销任务。
3. 当人物增强上线时一键启用。

现在就从 General Agent 开始，并在[人物增强 Agent 案例展示](/zh/agents/personas)预览即将到来的能力。`,
      },
    },
    {
      slug: "us-b2b-outbound",
      industry: { en: "B2B Outbound / Revenue Operations", zh: "B2B 外联 / 收入运营" },
      agents: 4,
      title: {
        en: "How AutoClaw helps B2B teams build outbound pipeline for the US market",
        zh: "AutoClaw 如何帮助 B2B 团队搭建美国市场外联获客流程",
      },
      summary: {
        en: "A practical guide to target-account research, contact enrichment, cold email setup, follow-up automation, and the first 14 days of outbound execution.",
        zh: "一份关于目标客户研究、联系人补全、冷邮件触达、自动跟进和前 14 天外联执行流程的实操指南。",
      },
      content: {
        en: `## What problem does AutoClaw solve?

Most outbound programs underperform before the first email is sent.

The usual issues are:

- target accounts are too broad
- contact data is incomplete
- message sequencing is inconsistent
- follow-up has no clear owner

AutoClaw is designed to tighten that workflow for B2B teams selling into the US market.

## Who is this best for?

AutoClaw fits best when a company already knows outbound matters and wants faster pipeline creation without adding more SDR headcount.

Common fits:

- founder-led B2B SaaS
- high-ticket agencies and service firms
- exporters and suppliers targeting North America
- lean revenue teams that need cleaner prospecting workflows

## What does the workflow include?

AutoClaw focuses on four linked jobs:

1. **Target-account research**  
   Build a narrower list of accounts that actually fit your ICP.

2. **Contact enrichment**  
   Find decision-makers, roles, company details, and reachable work emails.

3. **Cold email setup**  
   Turn ICP, account data, and offer positioning into practical outbound copy.

4. **Follow-up automation**  
   Keep the sequence moving so leads do not stall after the first touch.

## What happens in the first 14 days?

### Days 1-3

- define ICP and target geography
- collect target accounts
- enrich initial decision-maker contacts

### Days 4-7

- prepare first-touch and follow-up copy
- set reply path and booking CTA
- launch the first outbound batch

### Days 8-10

- review replies, opens, and fit signals
- refine targeting and message angle
- prepare sample lead packs for warmer prospects

### Days 11-14

- send follow-ups
- book calls
- convert warm prospects into a paid setup or managed outbound engagement

## What does a first deliverable look like?

A practical first deliverable is usually a sample lead pack:

- 10 to 20 target accounts
- relevant decision-makers
- enriched contact data
- outreach angle for that ICP

That keeps the first buying decision simple. The client sees list quality before committing to a larger engagement.

## What metrics should a team watch first?

For early outbound, the most useful weekly metrics are:

- contacts enriched
- initial emails sent
- reply rate
- qualified conversations
- calls booked
- paid setups closed

Do not over-focus on vanity metrics before the first few real sales conversations happen.

## Why is this page structured like a guide?

Answer engines such as ChatGPT, Perplexity, and Google AI Overviews tend to prefer pages that are:

- specific
- factual
- clearly structured
- easy to quote in small sections

That is why this guide answers direct buyer questions instead of relying on vague marketing copy.

## How to talk with us

If you want to discuss fit, book a short call here:

<https://calendly.com/jytech>

If you want a sample first, start here:

<https://autoclaw.jytech.us/en#try-it>`,
        zh: `## AutoClaw 解决什么问题？

很多外联项目在第一封邮件发出之前就已经表现不佳。

常见问题包括：

- 目标客户范围过宽
- 联系人数据不完整
- 触达节奏不一致
- 跟进没有明确负责人

AutoClaw 的核心作用，就是帮助面向美国市场销售的 B2B 团队把这一整套流程收紧并标准化。

## 最适合哪些团队？

当一个团队已经明确知道 outbound 很重要，但又不想继续增加 SDR 人力时，AutoClaw 最有价值。

典型适配场景：

- 创始人主导销售的 B2B SaaS
- 高客单 agency 与专业服务公司
- 面向北美市场的出口商与供应商
- 需要更干净 prospecting 流程的精简收入团队

## 这套流程包含什么？

AutoClaw 聚焦四个连续动作：

1. **目标客户研究**  
   先把真正符合 ICP 的公司名单缩窄。

2. **联系人补全**  
   找到决策人、岗位、公司信息和可触达的工作邮箱。

3. **冷邮件启动**  
   根据 ICP、账户信息和 offer 产出可执行的外联文案。

4. **自动跟进**  
   让线索不会在第一次触达后停掉。

## 前 14 天一般怎么做？

### 第 1-3 天

- 定义 ICP 与目标市场
- 收集目标账户
- 补全第一批决策人联系人

### 第 4-7 天

- 准备首触和跟进文案
- 配置回复路径与预约 CTA
- 启动第一轮外联

### 第 8-10 天

- 看回复、打开和 fit signal
- 调整名单与文案角度
- 为更热的潜在线索准备 sample lead pack

### 第 11-14 天

- 发 follow-up
- 推进预约
- 把更热的客户转成付费 setup 或托管外联项目

## 第一份交付通常长什么样？

最容易成交的第一份交付通常是 sample lead pack：

- 10 到 20 个目标账户
- 对应决策人
- 补全后的联系人信息
- 适配该 ICP 的外联切入角度

这样客户可以先看名单质量，再决定是否进入更大的合作。

## 最先该看哪些指标？

在前期 outbound 阶段，最有价值的每周指标通常是：

- 补全了多少联系人
- 发出了多少首轮邮件
- 回复率
- 合格对话数
- 预约数
- 成交的 setup 数

在真正出现销售对话之前，不要过度关注虚荣指标。

## 为什么这页写成问答指南？

像 ChatGPT、Perplexity、Google AI Overviews 这类答案引擎，更容易引用：

- 具体的
- 事实清晰的
- 结构化明确的
- 可以被截取小段引用的页面

所以这页不是泛营销文案，而是直接回答买家会问的问题。

## 如何和我们沟通？

如果你想直接聊，预约入口：

<https://calendly.com/jytech>

如果你想先看样例线索，从这里开始：

<https://autoclaw.jytech.us/en#try-it>`,
      },
    },
    {
      slug: "enterprise",
      industry: { en: "Enterprise Solution", zh: "企业级解决方案" },
      agents: 8,
      title: {
        en: "Enterprise: Dedicated AI Marketing Operations with Expert Support",
        zh: "企业版：专属 AI 营销运营 + 专家支持",
      },
      summary: {
        en: "Unlimited AI employees, dedicated infrastructure, and a partner team that embeds with yours",
        zh: "无限 AI 员工、专属基础设施、以及深度嵌入你团队的合作伙伴",
      },
      content: {
        en: `## The Enterprise Challenge

Growing companies hit a ceiling with self-service marketing tools. You need more than software — you need a partner who monitors performance, optimizes campaigns, and scales with your business. Hiring an in-house team for every marketing function is expensive and slow.

## The AutoClaw Enterprise Model

AutoClaw Enterprise is not just a platform subscription — it's a full marketing operations partnership. You get the AI-powered platform **plus** a dedicated team that operates alongside yours.

### Three Pillars

**1. AI Marketing Platform**
Deploy unlimited AI employees across every marketing function:
- Email Marketing — Automated cold outreach and nurture campaigns
- SEO & Content — Search-optimized content generation at scale
- Lead Prospecting — Multi-source lead discovery, enrichment, and scoring
- Social Media — Cross-platform brand management and engagement
- Sales Follow-Up — Pipeline automation and lead nurturing
- Product Manager — Competitive intelligence and market monitoring
- Orchestrator — Cross-agent coordination and weekly strategy digests
- Custom AI Agents — Purpose-built agents for your unique needs

**2. Dedicated Support & Monitoring**
Your dedicated partner team provides:
- **Performance Monitoring** — Continuous tracking of AI agent effectiveness and campaign ROI
- **Operations Oversight** — Proactive issue detection and resolution before they impact results
- **Project Consultation** — Strategic growth advice tailored to your industry and goals

**3. Project Collaboration**
The unique enterprise advantage — invite our team directly into your specific projects:
- We embed with your marketing team as a hands-on partner
- Custom agent training on your products, brand voice, and market
- Strategic growth support with regular business reviews
- Direct access to engineering for custom integrations

## Enterprise Features

| Feature | Details |
|---------|---------|
| AI Employees | Unlimited |
| Projects | Unlimited |
| Email Volume | Custom limits |
| Infrastructure | Dedicated |
| SSO/SAML | Included |
| SLA | Custom guarantee |
| White-label | Available |
| Custom APIs | Full access |
| Analytics | Advanced + custom dashboards |
| On-premise | Available |

## How It Works

1. **Subscribe** — Enterprise client onboards to the AutoClaw platform
2. **Deploy** — AI employees are configured for your specific marketing needs
3. **Invite** — Invite our team into your projects for hands-on collaboration
4. **Monitor** — Our team continuously monitors and optimizes your campaigns
5. **Grow** — Regular business reviews and strategic consultation drive results

## Who It's For

- **Mid-market companies** scaling beyond DIY marketing tools
- **Agencies** looking for AI-powered white-label marketing automation
- **International businesses** needing multi-language, multi-market campaigns
- **Companies** that want results without building an in-house marketing ops team`,
        zh: `## 企业级挑战

成长中的企业在自助营销工具上会遇到瓶颈。你需要的不仅是软件 — 你需要一个合作伙伴来监控绩效、优化活动、与你的业务共同成长。为每个营销职能组建内部团队既昂贵又缓慢。

## AutoClaw 企业版模式

AutoClaw 企业版不仅仅是平台订阅 — 它是完整的营销运营合作。你获得 AI 驱动的平台 **加上** 一支与你团队并肩工作的专属团队。

### 三大支柱

**1. AI 营销平台**
部署无限 AI 员工覆盖每个营销职能：
- 邮件营销 — 自动化冷邮件触达和培育活动
- SEO 与内容 — 规模化搜索优化内容生成
- 潜客开发 — 多来源线索发现、数据丰富和评分
- 社交媒体 — 跨平台品牌管理和互动
- 销售跟进 — 管道自动化和潜客培育
- 产品经理 — 竞争情报和市场监控
- 协调者 — 跨 Agent 协调和每周策略摘要
- 自定义 AI Agent — 为你的独特需求定制

**2. 专属支持与监控**
你的专属合作团队提供：
- **绩效监控** — 持续追踪 AI 员工效能和活动 ROI
- **运营监管** — 在问题影响结果之前主动发现和解决
- **项目咨询** — 针对你的行业和目标的战略增长建议

**3. 项目协作**
独特的企业版优势 — 直接邀请我们团队加入你的特定项目：
- 我们作为实操合作伙伴嵌入你的营销团队
- 基于你的产品、品牌声音和市场进行定制 Agent 训练
- 定期业务回顾的战略增长支持
- 直接对接工程团队进行定制集成

## 企业版功能

| 功能 | 详情 |
|------|------|
| AI 员工 | 无限制 |
| 项目 | 无限制 |
| 邮件量 | 自定义额度 |
| 基础设施 | 专属 |
| SSO/SAML | 包含 |
| SLA | 自定义保障 |
| 白标 | 可选 |
| 自定义 API | 全部开放 |
| 数据分析 | 高级 + 自定义仪表盘 |
| 私有化部署 | 可选 |

## 工作流程

1. **订阅** — 企业客户接入 AutoClaw 平台
2. **部署** — 根据你的具体营销需求配置 AI 员工
3. **邀请** — 邀请我们团队加入你的项目进行实操协作
4. **监控** — 我们团队持续监控和优化你的活动
5. **增长** — 定期业务回顾和战略咨询推动成果

## 适用客户

- **中型企业** — 超越 DIY 营销工具的规模化需求
- **代理商** — 寻找 AI 驱动的白标营销自动化
- **国际企业** — 需要多语言、多市场营销活动
- **企业** — 想要成果但不想组建内部营销运营团队`,
      },
    },
    {
      slug: "cross-border-ecommerce",
      industry: { en: "Cross-Border E-Commerce", zh: "跨境电商" },
      agents: 5,
      title: {
        en: "Cross-Border E-Commerce: Scale Your Overseas Marketing from China",
        zh: "跨境电商：从中国出发，规模化海外营销",
      },
      summary: {
        en: "24/7 AI marketing employees that bridge the gap between your China team and overseas customers",
        zh: "24/7 AI 营销员工，连接中国团队与海外客户",
      },
      content: {
        en: `## The Challenge

Cross-border e-commerce sellers face a unique paradox: your team operates in China, but your customers are spread across North America, Europe, and beyond. This creates constant friction — crafting native-quality English marketing content, managing overseas social media accounts across time zones, prospecting wholesale buyers in unfamiliar markets, and running email campaigns that actually land in inboxes instead of spam folders.

Most sellers end up hiring expensive overseas agencies or burning hours on manual outreach with mediocre results.

## Why AutoClaw

AutoClaw deploys AI-powered marketing employees that run 24/7 — no time zone constraints, no language barriers, no agency fees. Each AI employee is a specialist, working around the clock while your team sleeps.

**Built for global markets from day one.** Your business data and marketing campaigns are hosted on enterprise-grade international infrastructure, ensuring fast delivery to overseas customers. This isn't a China tool adapted for overseas — it's a global marketing platform that your China-based team can operate natively in Chinese.

## AI Employees for Cross-Border Sellers

### Email Marketing Employee
Builds and manages cold outreach campaigns to overseas buyers, distributors, and retail partners. Creates personalized email sequences in native English, handles follow-ups on schedule, and tracks engagement — all without you writing a single English email.

### SEO Content Employee
Generates search-optimized English content for your product pages and blog. Creates content that ranks on Google — not machine-translated copy, but content written for Western search intent.

### Lead Prospecting Employee
Finds potential wholesale buyers, distributors, and B2B partners in your target markets. Searches professional databases, enriches contact data, scores leads by fit, and delivers qualified prospect lists ready for outreach.

### Social Media Employee
Manages your brand on international platforms — X (Twitter), TikTok, Instagram, and Facebook. Creates content, schedules posts for optimal overseas engagement times, and builds brand awareness.

### Sales Follow-Up Employee
Tracks lead engagement, sends timed follow-up sequences, and nurtures prospects through your pipeline. No lead falls through the cracks during overseas business hours.

## Real Results

**For Amazon/Shopify Sellers:**
- Automated prospecting finds wholesale buyers you'd never reach manually
- Professional English email campaigns with 30%+ open rates
- SEO content drives organic traffic to your DTC store

**For B2B Exporters:**
- AI-generated customer profiles identify the right companies in target markets
- Multi-channel outreach running 24/7 across time zones
- Lead scoring prioritizes prospects most likely to convert

**For Brand Builders:**
- Consistent international social media presence without overseas staff
- Native-quality English content across all channels
- Data-driven insights on what resonates with overseas audiences

## Your Competitive Edge

- **24/7 operation** — AI employees work while you sleep, matching overseas business hours
- **Native-quality output** — Not machine translation, but content created for Western audiences
- **Chinese interface** — Operate entirely in Chinese while producing professional English output
- **Full visibility** — Watch every step of what your AI employees are doing in real-time
- **Unified platform** — Email, SEO, social, lead gen, and sales follow-up in one dashboard`,
        zh: `## 挑战

跨境电商卖家面临一个独特的矛盾：团队在中国运营，但客户遍布北美、欧洲及全球。这带来持续的摩擦 — 撰写母语级英文营销内容、跨时区管理海外社交媒体、在陌生市场开发批发买家、运营邮件营销确保送达收件箱而非垃圾邮件。

大多数卖家最终要么聘请昂贵的海外代理商，要么花大量时间手动触达却收效甚微。

## 为什么选择 AutoClaw

AutoClaw 部署 24/7 运行的 AI 营销员工 — 没有时区限制，没有语言障碍，没有代理商费用。每个 AI 员工都是专家，在你的团队休息时持续工作。

**从第一天起就为全球市场而生。** 业务数据和营销活动托管在企业级国际基础设施上，确保快速触达海外客户。这不是为海外改装的中国工具 — 而是一个中国团队可以用中文原生操作的全球营销平台。

## 跨境卖家的 AI 员工

### 邮件营销员工
自动构建和管理面向海外买家、分销商和零售合作伙伴的冷邮件营销活动。创建母语级英文个性化邮件序列，按时跟进，追踪互动 — 无需你写一封英文邮件。

### SEO 内容员工
为产品页和博客生成搜索优化的英文内容。创建在 Google 上有排名的内容 — 不是机器翻译，而是为西方搜索意图编写的原创内容。

### 潜客开发员工
在目标市场寻找潜在批发买家、分销商和 B2B 合作伙伴。搜索专业数据库，丰富联系人数据，按匹配度评分，交付准备好触达的合格潜客列表。

### 社交媒体员工
管理你在国际平台的品牌形象 — X (Twitter)、TikTok、Instagram 和 Facebook。创建内容，在最佳海外互动时段发布，建立品牌知名度。

### 销售跟进员工
追踪潜客互动，发送定时跟进序列，培育潜客通过销售管道。在海外工作时间也不会遗漏任何潜客。

## 实际成果

**亚马逊/Shopify 卖家：**
- 自动化潜客开发，找到你永远无法手动触达的批发买家
- 专业英文邮件营销活动，30%+ 打开率
- SEO 内容为 DTC 店铺带来自然流量

**B2B 出口商：**
- AI 生成客户画像，识别目标市场中的正确企业
- 多渠道触达 24/7 跨时区运行
- 潜客评分优先处理最可能转化的目标

**品牌出海：**
- 无需海外员工即可保持国际社交媒体持续在线
- 所有渠道的母语级英文内容
- 数据驱动的洞察，了解什么内容能引起海外受众共鸣

## 你的竞争优势

- **24/7 运行** — AI 员工在你睡觉时工作，匹配海外工作时间
- **母语级输出** — 不是机器翻译，而是为西方受众创作的内容
- **中文界面** — 完全用中文操作，输出专业英文内容
- **全程可见** — 实时查看 AI 员工执行每一步的详情
- **一站式平台** — 邮件、SEO、社交、潜客开发、销售跟进集于一体`,
      },
    },
    {
      slug: "ai-model-strategy",
      industry: { en: "AI Infrastructure", zh: "AI 基础设施" },
      agents: 0,
      title: {
        en: "AI Model Strategy: How AutoClaw Manages 300+ Models So You Don't Have To",
        zh: "AI 模型策略：AutoClaw 如何托管 300+ 模型，让你无需操心",
      },
      summary: {
        en: "Intelligent model routing, automatic failover, and zero configuration — just focus on your business",
        zh: "智能模型路由、自动故障转移、零配置 — 你只需专注业务",
      },
      content: {
        en: `## The Problem with AI Models Today

The AI landscape is overwhelming. Hundreds of models, dozens of providers, different pricing tiers, rate limits, and quality tradeoffs. Most businesses face a painful choice: spend weeks evaluating models, or just pick one and hope for the best.

Questions that shouldn't be your problem:
- Which LLM should I use for email writing vs. data analysis?
- What happens when a model provider goes down?
- How do I avoid vendor lock-in?
- Which image generation model gives the best results for product photos?
- How do I control costs when some models charge per token?

## AutoClaw's Approach: Fully Managed AI

**You focus on marketing. We handle the AI.**

AutoClaw continuously benchmarks, routes, and optimizes across 300+ AI models so you never have to think about which model to use. Every request is automatically routed to the best available model based on the task type, speed requirements, and your plan.

### Benchmark-Driven Selection

We regularly test every model on real-world marketing tasks:

| Task | What We Measure | Selection Criteria |
|------|----------------|-------------------|
| Email writing | Quality, tone, personalization | Best output quality |
| Lead analysis | Accuracy, structured output | Most reliable JSON output |
| Image generation | Speed, resolution, style | Best price-to-quality ratio |
| Image understanding | OCR accuracy, description quality | Best structured metadata |
| Content creation | SEO relevance, readability | Highest search ranking potential |

### Intelligent Routing

Every API call goes through our routing engine:

1. **Task Classification** — Is this a simple classification or a complex analysis?
2. **Model Selection** — Route to the optimal model for this specific task type
3. **Automatic Failover** — If the primary model fails, seamlessly switch to the next best option
4. **Cost Optimization** — Free-tier users get free models; paid users get high-speed models

### Free Tier: 25 Models, Zero Cost

All free users get access to 25 production-grade AI models:

**17 Language Models** — Covering text generation, analysis, coding, and reasoning. Our routing engine picks the fastest available model for each request, with automatic failover across multiple providers.

**6 Image Models** — From fast drafts (under 3 seconds) to high-definition 1024px product photos. Both speed-optimized and quality-optimized options available.

**2 Video Models** — AI-generated video content for social media and marketing campaigns.

### Paid Tier: High-Speed + 300+ BYOK Models

Paid users unlock two advantages:

**1. High-Speed Models**
Our premium routing tier delivers 10-50x faster inference for all AI tasks. The same email that takes 10 seconds on the free tier completes in under 1 second — enabling real-time AI experiences.

| Metric | Free Tier | Paid Tier |
|--------|-----------|-----------|
| LLM Speed | 17-91 tok/s | 810-2,500 tok/s |
| Email Generation | ~10s | <1s |
| Lead Analysis | ~12s | <1s |

**2. BYOK Market (300+ Models)**
Bring your own API keys to unlock the full model marketplace:
- Premium LLMs (Claude, GPT-4, Gemini Pro)
- Advanced image generation (DALL-E, Midjourney API)
- Specialized models (coding, translation, voice)
- Third-party integrations (search, enrichment, advertising)

### Automatic Failover

Every model call has a fallback chain. If the primary model is overloaded, rate-limited, or down, AutoClaw automatically switches to the next best option — with zero impact on your workflow.

> **Primary Model** (fastest available) → **Secondary Model** (alternative provider) → **Tertiary Model** (guaranteed availability)

You never see an error. You never wait for a provider to come back online. It just works.

### Vision AI for Media Management

AutoClaw's media library uses multimodal vision models to automatically:
- **Analyze product images** — Generate titles, descriptions, and tags
- **Score photo quality** — Composition, lighting, background assessment
- **OCR documents** — Extract text from uploaded PDFs and images
- **Understand charts** — Analyze business documents and reports

All powered by free vision models, with premium options available for paid users.

## Why This Matters

| Without AutoClaw | With AutoClaw |
|-----------------|--------------|
| Research models yourself | We benchmark for you |
| Pick one provider, hope it works | Automatic routing across providers |
| Handle outages manually | Automatic failover, zero downtime |
| Pay for models you don't need | Free tier covers most use cases |
| Configure APIs and endpoints | Zero configuration required |
| Monitor rate limits and quotas | We handle all limits transparently |

## The Bottom Line

AI model management is a full-time job. AutoClaw makes it invisible. Whether you're sending cold emails, generating product images, or analyzing leads — the right model is always selected, the fallback is always ready, and you never pay more than you need to.

**Start for free. Scale when ready. Never worry about AI infrastructure again.**`,
        zh: `## 当今 AI 模型的困境

AI 领域令人眼花缭乱。数百个模型、几十个供应商、不同的定价层级、速率限制和质量权衡。大多数企业面临痛苦的选择：花数周时间评估模型，或者随便选一个碰运气。

这些问题不应该成为你的负担：
- 写邮件和做数据分析应该用哪个模型？
- 模型供应商宕机了怎么办？
- 如何避免供应商锁定？
- 哪个图片模型最适合做商品图？
- 有些模型按 token 收费，怎么控制成本？

## AutoClaw 的方案：全托管 AI

**你专注营销，我们搞定 AI。**

AutoClaw 持续对 300+ AI 模型进行基准测试、路由优化，让你永远不用考虑该用哪个模型。每次请求都会根据任务类型、速度需求和你的套餐自动路由到最佳模型。

### 基准驱动的模型选择

我们定期用真实营销任务测试每个模型：

| 任务 | 测试指标 | 选择标准 |
|------|---------|---------|
| 邮件撰写 | 质量、语调、个性化 | 最优输出质量 |
| 潜客分析 | 准确性、结构化输出 | 最可靠的 JSON 输出 |
| 图片生成 | 速度、分辨率、风格 | 最佳性价比 |
| 图片理解 | OCR 准确率、描述质量 | 最佳结构化元数据 |
| 内容创作 | SEO 相关性、可读性 | 最高搜索排名潜力 |

### 智能路由

每次 API 调用都经过我们的路由引擎：

1. **任务分类** — 这是简单分类还是复杂分析？
2. **模型选择** — 路由到最适合该任务的模型
3. **自动故障转移** — 主模型失败时，无缝切换到下一个最优选项
4. **成本优化** — 免费用户使用免费模型；付费用户使用高速模型

### 免费版：25 个模型，零成本

所有免费用户都可使用 25 个生产级 AI 模型：

**17 个语言模型** — 覆盖文本生成、分析、编程和推理。路由引擎为每次请求选择最快的可用模型，多供应商自动故障转移。

**6 个图片模型** — 从快速草图（3 秒内）到高清 1024px 商品图。同时提供速度优先和质量优先的选项。

**2 个视频模型** — AI 生成的视频内容，用于社交媒体和营销活动。

### 付费版：高速 + 300+ BYOK 模型

付费用户解锁两大优势：

**1. 高速模型**
高级路由层为所有 AI 任务提供 10-50 倍更快的推理速度。免费版需要 10 秒完成的邮件，付费版不到 1 秒 — 实现实时 AI 体验。

| 指标 | 免费版 | 付费版 |
|------|-------|-------|
| 语言模型速度 | 17-91 tok/s | 810-2,500 tok/s |
| 邮件生成 | ~10 秒 | <1 秒 |
| 潜客分析 | ~12 秒 | <1 秒 |

**2. BYOK 模型市场（300+ 模型）**
自带 API Key 解锁完整模型市场：
- 高级语言模型（Claude、GPT-4、Gemini Pro）
- 高级图片生成（DALL-E、Midjourney API）
- 专用模型（编程、翻译、语音）
- 第三方服务集成（搜索、客户增强、广告）

### 自动故障转移

每次模型调用都有备选链。主模型过载、限速或宕机时，AutoClaw 自动切换到下一个最优选项 — 对你的工作流零影响。

> **主模型**（最快可用） → **备选模型**（替代供应商） → **保底模型**（保证可用性）

你永远不会看到错误。你永远不用等待供应商恢复。它就是能用。

### 视觉 AI 素材管理

AutoClaw 的素材库使用多模态视觉模型自动：
- **分析商品图片** — 生成标题、描述和标签
- **评估照片质量** — 构图、光线、背景评分
- **OCR 文档识别** — 从上传的 PDF 和图片中提取文字
- **理解图表** — 分析商业文档和报告

全部基于免费视觉模型驱动，付费用户可使用高级选项。

## 为什么这很重要

| 没有 AutoClaw | 有 AutoClaw |
|-------------|-----------|
| 自己研究模型 | 我们替你做基准测试 |
| 选一个供应商，祈祷能用 | 多供应商自动路由 |
| 手动处理宕机 | 自动故障转移，零停机 |
| 为用不上的模型付费 | 免费版覆盖大部分场景 |
| 配置 API 和端点 | 零配置 |
| 监控速率限制和配额 | 我们透明处理所有限制 |

## 结论

AI 模型管理本身就是一份全职工作。AutoClaw 让它变得无形。无论你是发送冷邮件、生成商品图、还是分析潜客 — 最佳模型总是被选中，备选方案总是就绪，你永远不会多花一分钱。

**免费开始。按需升级。再也不用担心 AI 基础设施。**`,
      },
    },
  ],
};

export function caseLang(locale: string): "en" | "zh" {
  return locale.startsWith("zh") ? "zh" : "en";
}

export function getAllCases(): UseCase[] {
  return [...(USE_CASES.featured || []), ...(USE_CASES.existing || [])];
}

export function findCase(slug: string): UseCase | undefined {
  return getAllCases().find((c) => c.slug === slug);
}

const DEFAULT_DATE = "2026-01-01";

/** Build per-article metadata for /[locale]/use-cases/[slug] */
export function buildCaseMetadata(locale: string, slug: string): Metadata {
  const uc = findCase(slug);
  const lang = caseLang(locale);
  if (!uc) return { title: `Use Case | ${SITE_NAME}` };
  const title = `${uc.title[lang] || uc.title.en} | ${SITE_NAME}`;
  const description = uc.summary[lang] || uc.summary.en;
  const path = `/use-cases/${slug}`;
  const canonical = localizedPath(locale as never, path);
  return {
    title,
    description,
    alternates: {
      canonical,
      languages: { ...buildLanguageAlternates(path), "x-default": localizedPath("en" as never, path) },
    },
    openGraph: {
      type: "article",
      url: canonical,
      siteName: SITE_NAME,
      title,
      description,
      images: [{ url: DEFAULT_OG_IMAGE, width: 512, height: 512, alt: title }],
    },
    twitter: { card: "summary_large_image", title, description, images: [DEFAULT_OG_IMAGE] },
  };
}

/** JSON-LD Article + Breadcrumb structured data for an article */
export function buildCaseJsonLd(locale: string, slug: string) {
  const uc = findCase(slug);
  const lang = caseLang(locale);
  if (!uc) return null;
  const url = `${SITE_URL}${localizedPath(locale as never, `/use-cases/${slug}`)}`;
  const headline = uc.title[lang] || uc.title.en;
  const date = uc.date || DEFAULT_DATE;
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Article",
        headline,
        description: uc.summary[lang] || uc.summary.en,
        about: uc.industry[lang] || uc.industry.en,
        datePublished: date,
        dateModified: date,
        inLanguage: lang === "zh" ? "zh-CN" : "en-US",
        mainEntityOfPage: { "@type": "WebPage", "@id": url },
        author: { "@type": "Organization", name: SITE_NAME, url: SITE_URL },
        publisher: {
          "@type": "Organization",
          name: SITE_NAME,
          logo: { "@type": "ImageObject", url: `${SITE_URL}${DEFAULT_OG_IMAGE}` },
        },
      },
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: SITE_NAME, item: `${SITE_URL}${localizedPath(locale as never)}` },
          { "@type": "ListItem", position: 2, name: lang === "zh" ? "客户案例" : "Use Cases", item: `${SITE_URL}${localizedPath(locale as never, "/use-cases")}` },
          { "@type": "ListItem", position: 3, name: headline, item: url },
        ],
      },
    ],
  };
}
