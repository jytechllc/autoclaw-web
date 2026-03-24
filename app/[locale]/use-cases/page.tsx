"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { getDictionary, type Locale } from "@/lib/i18n";
import LanguageSwitcher from "@/components/LanguageSwitcher";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useState } from "react";

export const USE_CASES: Record<string, {
  slug: string;
  company?: string;
  industry: Record<string, string>;
  agents: number;
  title: Record<string, string>;
  summary: Record<string, string>;
  content: Record<string, string>;
}[]> = {
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
