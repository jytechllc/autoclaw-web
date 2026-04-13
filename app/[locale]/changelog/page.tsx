import Link from "next/link";
import { getDictionary, isValidLocale } from "@/lib/i18n";
import { notFound } from "next/navigation";
import LanguageSwitcher from "@/components/LanguageSwitcher";

export const metadata = {
  title: "Changelog – AutoClaw",
};

interface ChangelogEntry {
  date: string;
  version: string;
  title: Record<string, string>;
  items: Record<string, string[]>;
}

const changelog: ChangelogEntry[] = [
  {
    date: "2026-04-13",
    version: "1.5.0",
    title: {
      en: "Recruiting System, Email Improvements & Korean Language",
      zh: "招聘系统、邮件功能优化与韩语支持",
      "zh-TW": "招募系統、郵件功能優化與韓語支援",
      fr: "Système de recrutement, améliorations email et support coréen",
      ko: "채용 시스템, 이메일 개선 및 한국어 지원",
    },
    items: {
      en: [
        "Recruiting module — Full hiring pipeline with job postings, candidate tracking, kanban board, and interview scheduling. Available for all paid plans.",
        "AI-powered job posting — Describe what you need (e.g. \"hire 5 sales reps\") and AI generates complete job descriptions using your project's knowledge base, with compliance checks for minimum wage and pay transparency laws.",
        "Public careers page — Share your open positions at /careers/your-company. External candidates can view jobs and apply directly, with resume upload support via Vercel Blob.",
        "Google Jobs integration — Careers pages include JSON-LD structured data so positions automatically appear in Google Jobs search results.",
        "{{calendarLink}} merge tag — Add booking links (Calendly, Cal.com, Google Calendar) to all email templates. AI-generated templates now include calendar CTAs by default.",
        "Email approval gate — When \"Review emails before sending\" is enabled, bulk emails are queued for review instead of sent immediately. Approve or reject in CRM → Email Review.",
        "Test send in agent card — Send a test email directly from the email marketing agent configuration panel without navigating to the templates page.",
        "Brevo webhook — Real-time email status updates (delivered, opened, clicked, bounced) via Brevo outbound webhook integration.",
        "Korean language support (한국어) — Full translation of all 1,800+ strings. Available in the language switcher.",
        "H1B/Visa sponsorship field — Mark positions as offering visa sponsorship, displayed as a badge on job cards and the public careers page.",
        "Salary types — Support for hourly, monthly, and yearly salary. Positions with $0 salary display as \"Unpaid\" for internships.",
        "Openings/seats — Set how many people to hire per position.",
        "Enterprise onboarding — Enterprise users are guided to create a business account (organization) on first login.",
        "Security fix — Token usage data is now properly scoped to the user's organization. Enterprise users no longer see platform-wide usage data.",
        "Email language fix — Email templates now use the agent's target language setting, not the UI display language.",
        "WeChat Pay restricted to yeoso.com domain — API and frontend both enforce the domain check.",
        "Cron automation — Agent tasks now run every 30 minutes via Vercel cron for hands-free operation.",
      ],
      zh: [
        "招聘模块 — 完整的招聘流程：职位发布、候选人追踪、看板视图、面试安排。所有付费计划可用。",
        "AI 智能生成职位 — 描述需求（如'招聘5-6个销售'），AI 根据项目知识库生成完整招聘信息，并自动检查最低工资和薪资透明法合规性。",
        "公开招聘页面 — 在 /careers/公司名 分享开放职位，外部候选人可直接查看并投递简历（支持 Vercel Blob 上传）。",
        "Google Jobs 集成 — 招聘页面自动生成 JSON-LD 结构化数据，职位会出现在 Google 搜索的招聘结果中。",
        "{{calendarLink}} 邮件标签 — 在邮件模板中添加预约链接（支持 Calendly、Cal.com、Google Calendar），AI 生成的模板默认包含日历 CTA。",
        "邮件审核机制 — 启用'发送前审核'后，批量邮件会进入审核队列而非直接发出，在 CRM → 邮件审核中批准或拒绝。",
        "Agent 卡片内测试发送 — 直接在邮件营销 Agent 配置面板中选择模板发送测试邮件，无需跳转到模板页面。",
        "Brevo Webhook — 通过 Brevo outbound webhook 实时更新邮件状态（已送达、已打开、已点击、已退回）。",
        "韩语支持（한국어）— 完整翻译 1800+ 条字符串，可在语言切换器中选择。",
        "H1B/签证担保字段 — 标记职位是否提供签证担保，在职位卡片和公开招聘页面显示徽章。",
        "薪资类型 — 支持时薪、月薪、年薪。薪资为 $0 的职位显示为'无薪实习'。",
        "招聘人数 — 每个职位可设置多个空缺名额。",
        "企业版引导 — 企业版用户首次登录引导创建组织账户。",
        "安全修复 — Token 使用数据现在正确限定在用户组织范围内，企业用户不再看到平台全局数据。",
        "邮件语言修复 — 邮件模板现在使用 Agent 的目标语言设置，而非界面显示语言。",
        "微信支付限制为 yeoso.com 域名 — API 和前端均执行域名检查。",
        "定时自动化 — Agent 任务现在每 30 分钟通过 Vercel Cron 自动执行。",
      ],
      "zh-TW": [
        "招募模組 — 完整招募流程：職位發佈、候選人追蹤、看板視圖、面試安排。所有付費方案可用。",
        "AI 智能生成職位 — 描述需求，AI 根據專案知識庫生成完整招募資訊，並自動檢查最低工資和薪資透明法合規性。",
        "公開招募頁面 — 在 /careers/公司名 分享開放職位，外部候選人可直接查看並投遞履歷。",
        "Google Jobs 整合 — 招募頁面自動生成 JSON-LD 結構化資料，職位會出現在 Google 搜尋的招聘結果中。",
        "{{calendarLink}} 郵件標籤 — 在郵件範本中新增預約連結，AI 生成的範本預設包含日曆 CTA。",
        "郵件審核機制 — 啟用「發送前審核」後，批量郵件進入審核佇列，在 CRM → 郵件審核中批准或拒絕。",
        "Agent 卡片內測試發送 — 直接在郵件行銷 Agent 配置面板中發送測試郵件。",
        "Brevo Webhook — 透過 Brevo outbound webhook 即時更新郵件狀態。",
        "韓語支援（한국어）— 完整翻譯 1800+ 條字串。",
        "H1B/簽證擔保欄位 — 標記職位是否提供簽證擔保。",
        "薪資類型 — 支援時薪、月薪、年薪。薪資為 $0 顯示為「無薪實習」。",
        "招募人數 — 每個職位可設定多個空缺名額。",
        "企業版引導 — 企業版用戶首次登入引導建立組織帳戶。",
        "安全修復 — Token 使用資料現在正確限定在用戶組織範圍內。",
        "郵件語言修復 — 郵件範本使用 Agent 的目標語言設定。",
        "微信支付限制為 yeoso.com 網域。",
        "定時自動化 — Agent 任務每 30 分鐘自動執行。",
      ],
      fr: [
        "Module de recrutement — Pipeline complet : offres d'emploi, suivi des candidats, tableau kanban, planification d'entretiens. Disponible pour tous les plans payants.",
        "Génération IA des offres — Décrivez vos besoins et l'IA génère des descriptions complètes avec vérification de conformité salariale.",
        "Page carrières publique — Partagez vos postes ouverts, les candidats externes peuvent postuler directement.",
        "Intégration Google Jobs — Données structurées JSON-LD pour apparaître dans les résultats Google Jobs.",
        "Tag {{calendarLink}} — Ajoutez des liens de réservation dans les modèles d'email. Les modèles générés par IA incluent un CTA calendrier.",
        "Validation des emails — Les emails en masse sont mis en file d'attente pour révision avant envoi.",
        "Envoi test dans l'agent — Testez directement depuis la carte de l'agent email marketing.",
        "Webhook Brevo — Mises à jour en temps réel du statut des emails.",
        "Support coréen (한국어) — Traduction complète de 1800+ chaînes.",
        "Champ parrainage H1B/Visa, types de salaire, nombre de postes ouverts.",
        "Onboarding entreprise, correctifs de sécurité, automatisation cron toutes les 30 minutes.",
      ],
      ko: [
        "채용 모듈 — 채용 공고, 후보자 추적, 칸반 보드, 면접 일정 관리를 포함한 완전한 채용 파이프라인.",
        "AI 채용 공고 생성 — 필요한 포지션을 설명하면 AI가 프로젝트 지식 기반을 활용해 완전한 채용 공고를 생성합니다.",
        "공개 채용 페이지 — /careers/회사명에서 오픈 포지션을 공유하고, 외부 후보자가 직접 지원할 수 있습니다.",
        "Google Jobs 통합 — 채용 페이지에 JSON-LD 구조화 데이터를 자동 생성합니다.",
        "{{calendarLink}} 이메일 태그 — 예약 링크를 이메일 템플릿에 추가합니다.",
        "이메일 승인 게이트, 에이전트 카드 내 테스트 발송, Brevo 웹훅 실시간 상태 업데이트.",
        "한국어 지원 — 1,800개 이상의 문자열 완전 번역.",
        "H1B/비자 스폰서십 필드, 급여 유형 (시급/월급/연봉), 채용 인원 설정.",
        "기업 온보딩, 보안 수정, 30분마다 자동 실행되는 Cron 자동화.",
      ],
    },
  },
  {
    date: "2026-04-06",
    version: "1.4.0",
    title: {
      en: "5-Week Mega Update: 111 Commits, 100K+ Lines — WeChat Pay, TikTok Video, Knowledge Base RAG, Sales Channels & More",
      zh: "5 周超级更新：111 次提交、10 万+ 行代码 — 微信支付、TikTok 视频、知识库 RAG、销售渠道等",
      "zh-TW": "5 週超級更新：111 次提交、10 萬+ 行代碼 — 微信支付、TikTok 影片、知識庫 RAG、銷售渠道等",
      fr: "Mega mise a jour 5 semaines : 111 commits, 100K+ lignes — WeChat Pay, TikTok, RAG et plus",
      ko: "5주 메가 업데이트: 111 커밋, 100K+ 줄 — WeChat Pay, TikTok 비디오, 지식 기반 RAG 등",
    },
    items: {
      en: [
        "--- Payment & Billing ---",
        "WeChat Pay integration — Chinese users on yeoso.com can pay via WeChat QR code for Growth and Scale plans. Includes order creation, QR code display, payment polling, and webhook notification.",
        "Enterprise pricing — 6-month minimum commitment with dedicated infrastructure options.",
        "Chinese market pricing — RMB pricing display with localized package tiers.",
        "Billing page — Manage subscriptions, view invoices, and track payment history in one place.",
        "Budget limits — Set monthly spending caps for API usage with auto-pause.",
        "--- AI & Knowledge Base ---",
        "Knowledge Base RAG for all plans — Upload documents, PDFs, or URLs and AI agents use them as context. Powered by pgvector embeddings (768-dim) + LlamaIndex Cloud integration.",
        "AI Model Leaderboard — Live benchmark rankings for Claude, GPT, Gemini, Llama, and Qwen models with performance metrics.",
        "AIGC content generation — Generate marketing content, blog posts, and social media copy directly in AI chat.",
        "Agent conversation history — Chat sessions persisted to database, resumable across sessions.",
        "Agent loop execution — Run multiple task steps in sequence without manual intervention.",
        "Model consumption labels — Clear free vs. paid indicator per model per request.",
        "--- TikTok & Video ---",
        "TikTok OAuth integration — Connect TikTok accounts with PKCE flow, manage connected accounts.",
        "TikTok content posting — Publish videos directly from AutoClaw with privacy controls and sandbox support.",
        "AI Video Generator (xPilot) — Generate marketing videos with AI, choose models and durations (5s/8s), persist to Vercel Blob.",
        "Voice narration — Add AI-generated voice narration and background music to videos.",
        "Video history — All generated videos saved with playback and re-download.",
        "--- Sales Channels ---",
        "Xianyu marketplace — Chinese secondhand market integration for product listings.",
        "Amazon, DK Wholesale, Etsy — Sales channel dashboard structure for multi-platform selling.",
        "--- Email Marketing ---",
        "SMTP support — Configure custom SMTP servers (host, port, user, password) as alternative to Brevo/SendGrid.",
        "Email verification — Validate addresses before sending to reduce bounce rates.",
        "Email template fixes — Improved template parsing and generation reliability.",
        "Testing email fix — Resolved send failures in test email flow.",
        "--- Lead Generation & CRM ---",
        "Firecrawl integration — Web crawling tool for extracting website content into knowledge base.",
        "Customer search improvements — Better contact search, enrichment, and data source verification.",
        "Contact counter updates — Accurate contact statistics per project.",
        "Homepage lead capture — Registration form on landing page to capture trial leads.",
        "Case studies — New use case pages showcasing customer success stories.",
        "--- Infrastructure ---",
        "GitHub Actions — Automated yeoso → main branch sync workflow for continuous deployment.",
        "Worker architecture — Cloudflare Worker migration for agent task execution.",
        "Cron reliability — Fixed cron job timing issues and removed Vercel Hobby plan cron limits.",
        "LlamaIndex integration — Cloud-based RAG pipeline for advanced document retrieval.",
        "Vercel Blob BYOK — User-configurable blob storage token for video and media assets.",
        "--- UI & Localization ---",
        "Chat widget upgrade — Better error handling, model selection dropdown, and streaming responses.",
        "Pricing plan display — Refined feature comparison for Growth, Scale, and Enterprise tiers.",
        "Icon refresh — Updated favicon and app icons across all platforms.",
        "Terms of service update — Revised legal terms with data confidentiality clauses.",
        "X (Twitter) automation — Strategy tools for automated posting and scheduling.",
        "Multiple bug fixes — 30+ fixes across chat, deployment, i18n, schema, and authentication.",
      ],
      zh: [
        "--- 支付与账单 ---",
        "微信支付集成 — yeoso.com 中文用户可通过微信二维码支付 Growth 和 Scale 计划，包含订单创建、二维码展示、支付轮询和回调通知。",
        "企业版定价 — 6 个月最低承诺期，提供专属基础设施选项。",
        "中国市场定价 — 人民币价格显示，本地化套餐层级。",
        "账单页面 — 统一管理订阅、发票和付款记录。",
        "预算限额 — 设置 API 使用月度上限，超额自动暂停。",
        "--- AI 与知识库 ---",
        "知识库 RAG 全面开放 — 上传文档、PDF 或 URL，AI 智能体使用它们作为内容生成上下文。基于 pgvector 嵌入 + LlamaIndex Cloud。",
        "AI 模型排行榜 — Claude、GPT、Gemini、Llama、Qwen 实时性能基准排名。",
        "AIGC 内容生成 — 在 AI 对话中直接生成营销内容、博客文章和社交媒体文案。",
        "智能体对话历史 — 对话持久化到数据库，可跨会话恢复。",
        "智能体循环执行 — 自动连续执行多个任务步骤，无需手动干预。",
        "模型消耗标签 — 清晰显示每个模型每次请求是免费还是付费。",
        "--- TikTok 与视频 ---",
        "TikTok OAuth 集成 — 通过 PKCE 流程连接 TikTok 账户。",
        "TikTok 内容发布 — 直接从 AutoClaw 发布视频，支持隐私控制和沙盒模式。",
        "AI 视频生成器 (xPilot) — 用 AI 生成营销视频，选择模型和时长，保存到 Vercel Blob。",
        "语音解说 — 为视频添加 AI 生成的旁白和背景音乐。",
        "视频历史 — 所有生成的视频可回放和重新下载。",
        "--- 销售渠道 ---",
        "闲鱼市场 — 中国二手市场产品列表集成。",
        "Amazon、DK Wholesale、Etsy — 多平台销售渠道仪表板。",
        "--- 邮件营销 ---",
        "SMTP 支持 — 配置自定义 SMTP 服务器作为 Brevo/SendGrid 替代方案。",
        "邮箱验证 — 发送前验证地址，降低退信率。",
        "模板修复 — 改进模板解析和生成可靠性。",
        "--- 获客与 CRM ---",
        "Firecrawl 集成 — 网页爬取工具，提取内容到知识库。",
        "客户搜索优化 — 改进联系人搜索、数据充实和来源验证。",
        "首页线索捕获 — 落地页注册表单。",
        "案例研究 — 新增客户成功案例页面。",
        "--- 基础设施 ---",
        "GitHub Actions — yeoso → main 自动分支同步，持续部署。",
        "Worker 架构 — Cloudflare Worker 迁移用于智能体任务执行。",
        "Cron 可靠性修复 — 定时任务问题修复。",
        "LlamaIndex 集成 — 云端 RAG 管道。",
        "Vercel Blob BYOK — 用户可配置的 Blob 存储令牌。",
        "--- UI 与本地化 ---",
        "对话组件升级 — 更好的错误处理和模型选择。",
        "定价展示优化 — 改进 Growth/Scale/Enterprise 功能对比。",
        "图标刷新、服务条款更新、X 自动化策略工具。",
        "30+ Bug 修复 — 对话、部署、国际化、Schema、认证等多项修复。",
      ],
      "zh-TW": [
        "--- 支付與帳單 ---",
        "微信支付、企業版定價、中國市場人民幣定價、帳單頁面、預算限額。",
        "--- AI 與知識庫 ---",
        "知識庫 RAG、AI 模型排行榜、AIGC 內容生成、對話歷史、循環執行、模型消耗標籤。",
        "--- TikTok 與影片 ---",
        "TikTok OAuth + 內容發佈、AI 影片生成器 (xPilot)、語音旁白、影片歷史。",
        "--- 銷售渠道 ---",
        "閒魚市場、Amazon/DK Wholesale/Etsy 多平台。",
        "--- 郵件行銷 ---",
        "SMTP 支援、郵箱驗證、模板修復。",
        "--- 獲客與 CRM ---",
        "Firecrawl 整合、客戶搜尋優化、首頁線索捕獲、案例研究。",
        "--- 基礎設施 ---",
        "GitHub Actions、Worker 架構、Cron 修復、LlamaIndex、Vercel Blob BYOK。",
        "--- UI 與本地化 ---",
        "對話元件升級、定價展示優化、圖標刷新、30+ Bug 修復。",
      ],
      fr: [
        "--- Paiement ---",
        "WeChat Pay, tarification entreprise, prix en RMB, page facturation, limites budget.",
        "--- IA & Base de connaissances ---",
        "RAG pour tous, classement modeles IA, AIGC, historique conversations, execution en boucle.",
        "--- TikTok & Video ---",
        "OAuth TikTok, publication de contenu, generateur video IA (xPilot), narration vocale.",
        "--- Canaux de vente ---",
        "Xianyu, Amazon, DK Wholesale, Etsy.",
        "--- Email ---",
        "Support SMTP, verification email, corrections de modeles.",
        "--- CRM ---",
        "Firecrawl, recherche contacts, capture de leads, etudes de cas.",
        "--- Infrastructure ---",
        "GitHub Actions, architecture Worker, corrections cron, LlamaIndex, Vercel Blob.",
        "--- UI ---",
        "Widget chat ameliore, affichage tarifs, icones, 30+ corrections de bugs.",
      ],
      ko: [
        "--- 결제 ---",
        "WeChat Pay, 기업 가격, RMB 가격, 청구 페이지, 예산 한도.",
        "--- AI & 지식 기반 ---",
        "전체 플랜 RAG, AI 모델 리더보드, AIGC, 대화 기록, 루프 실행.",
        "--- TikTok & 비디오 ---",
        "TikTok OAuth + 게시, AI 비디오 생성기 (xPilot), 음성 내레이션.",
        "--- 판매 채널 ---",
        "Xianyu, Amazon, DK Wholesale, Etsy.",
        "--- 이메일 ---",
        "SMTP 지원, 이메일 인증, 템플릿 수정.",
        "--- CRM ---",
        "Firecrawl, 연락처 검색, 리드 캡처, 사례 연구.",
        "--- 인프라 ---",
        "GitHub Actions, Worker 아키텍처, Cron 수정, LlamaIndex, Vercel Blob.",
        "--- UI ---",
        "채팅 위젯 개선, 가격 표시, 아이콘, 30개 이상 버그 수정.",
      ],
    },
  },
  {
    date: "2026-03-07",
    version: "1.3.0",
    title: {
      en: "Real-time Sync & Privacy Compliance",
      zh: "实时同步与隐私合规",
      "zh-TW": "即時同步與隱私合規",
      fr: "Synchronisation en temps réel et conformité",
    },
    items: {
      en: [
        "Real-time notifications — When you create a project or activate an AI agent, your automation pipeline starts immediately. No more waiting.",
        "Automatic retry — A background sync runs every 10 minutes to ensure no task is ever missed, even during network hiccups.",
        "Privacy Policy — A dedicated privacy policy page is now available in all supported languages, as part of our SOC 2 compliance efforts.",
        "Unified Team & Organization — The team management and organization settings have been combined into a single, cleaner interface.",
      ],
      zh: [
        "实时通知 — 创建项目或激活 AI 智能体后，自动化流程立即启动，无需等待。",
        "自动重试 — 后台每 10 分钟同步一次，确保即使网络波动也不会遗漏任何任务。",
        "隐私政策 — 新增多语言隐私政策页面，作为 SOC 2 合规工作的一部分。",
        "统一团队与组织 — 团队管理和组织设置合并为更简洁的界面。",
      ],
      "zh-TW": [
        "即時通知 — 建立專案或啟用 AI 智能體後，自動化流程立即啟動，無需等待。",
        "自動重試 — 背景每 10 分鐘同步一次，確保即使網路波動也不會遺漏任何任務。",
        "隱私權政策 — 新增多語言隱私權政策頁面，作為 SOC 2 合規工作的一部分。",
        "統一團隊與組織 — 團隊管理和組織設定合併為更簡潔的介面。",
      ],
      fr: [
        "Notifications en temps réel — Lorsque vous créez un projet ou activez un agent IA, votre pipeline d'automatisation démarre immédiatement.",
        "Synchronisation automatique — Une synchronisation en arrière-plan s'exécute toutes les 10 minutes pour garantir qu'aucune tâche n'est manquée.",
        "Politique de confidentialité — Une page dédiée est désormais disponible dans toutes les langues, dans le cadre de notre conformité SOC 2.",
        "Équipe et organisation unifiées — La gestion d'équipe et les paramètres d'organisation ont été regroupés dans une interface simplifiée.",
      ],
    },
  },
  {
    date: "2026-03-05",
    version: "1.2.0",
    title: {
      en: "Analytics & Reporting",
      zh: "数据分析与报告",
      "zh-TW": "數據分析與報告",
      fr: "Analytique et rapports",
    },
    items: {
      en: [
        "Google Analytics integration — Connect your GA4 property to see real-time traffic data per project directly in your dashboard.",
        "Agent Reports tab — View detailed performance summaries from each AI agent, including tasks completed and key metrics.",
        "Mobile-optimized dashboard — Navigation and layout improvements for a better experience on phones and tablets.",
      ],
      zh: [
        "Google Analytics 集成 — 连接 GA4 媒体资源，在面板中直接查看每个项目的实时流量数据。",
        "智能体报告 — 查看每个 AI 智能体的详细绩效摘要，包括完成的任务和关键指标。",
        "移动端优化 — 仪表板导航和布局改进，在手机和平板上体验更佳。",
      ],
      "zh-TW": [
        "Google Analytics 整合 — 連接 GA4 媒體資源，在面板中直接檢視每個專案的即時流量資料。",
        "智能體報告 — 檢視每個 AI 智能體的詳細績效摘要，包括完成的任務和關鍵指標。",
        "行動裝置最佳化 — 儀表板導航和版面改進，在手機和平板上體驗更佳。",
      ],
      fr: [
        "Intégration Google Analytics — Connectez votre propriété GA4 pour voir les données de trafic en temps réel par projet.",
        "Rapports d'agents — Consultez les résumés de performance détaillés de chaque agent IA.",
        "Tableau de bord mobile — Navigation et mise en page améliorées pour une meilleure expérience sur téléphone et tablette.",
      ],
    },
  },
  {
    date: "2026-03-01",
    version: "1.1.0",
    title: {
      en: "Multi-language Support & Billing",
      zh: "多语言支持与账单管理",
      "zh-TW": "多語言支援與帳單管理",
      fr: "Support multilingue et facturation",
    },
    items: {
      en: [
        "4-language support — AutoClaw is now available in English, Simplified Chinese, Traditional Chinese, and French.",
        "Standalone billing page — Manage your subscription, view invoices, and update payment methods in one place.",
        "Settings page — Personalized dashboard settings with project management and team collaboration.",
      ],
      zh: [
        "四语言支持 — AutoClaw 现已支持英语、简体中文、繁体中文和法语。",
        "独立账单页面 — 在一个页面中管理订阅、查看发票和更新支付方式。",
        "设置页面 — 包含项目管理和团队协作的个性化面板设置。",
      ],
      "zh-TW": [
        "四語言支援 — AutoClaw 現已支援英語、簡體中文、繁體中文和法語。",
        "獨立帳單頁面 — 在一個頁面中管理訂閱、檢視發票和更新付款方式。",
        "設定頁面 — 包含專案管理和團隊協作的個人化面板設定。",
      ],
      fr: [
        "Support 4 langues — AutoClaw est maintenant disponible en anglais, chinois simplifié, chinois traditionnel et français.",
        "Page de facturation — Gérez votre abonnement, consultez vos factures et mettez à jour vos moyens de paiement.",
        "Page de paramètres — Paramètres personnalisés avec gestion de projets et collaboration d'équipe.",
      ],
    },
  },
  {
    date: "2026-02-20",
    version: "1.0.0",
    title: {
      en: "AutoClaw Launch",
      zh: "AutoClaw 正式上线",
      "zh-TW": "AutoClaw 正式上線",
      fr: "Lancement d'AutoClaw",
    },
    items: {
      en: [
        "6 AI Agents — Email marketing, SEO optimization, lead generation, social media, project management, and sales outreach.",
        "One-click activation — Select the agents you need, configure them for your project, and let them work autonomously.",
        "Dashboard — A central hub to manage all your projects, monitor agent activity, and communicate with your AI team.",
        "3 pricing tiers — Free starter plan, Growth at $49/mo, and Scale at $149/mo.",
      ],
      zh: [
        "6 大 AI 智能体 — 邮件营销、SEO 优化、潜客开发、社交媒体、项目管理和销售拓展。",
        "一键激活 — 选择所需智能体，为项目配置后即可自主运行。",
        "管理面板 — 集中管理所有项目、监控智能体活动并与 AI 团队沟通。",
        "3 档定价 — 免费入门版、Growth $49/月、Scale $149/月。",
      ],
      "zh-TW": [
        "6 大 AI 智能體 — 郵件行銷、SEO 最佳化、潛客開發、社群媒體、專案管理和銷售拓展。",
        "一鍵啟用 — 選擇所需智能體，為專案設定後即可自主運行。",
        "管理面板 — 集中管理所有專案、監控智能體活動並與 AI 團隊溝通。",
        "3 檔定價 — 免費入門版、Growth $49/月、Scale $149/月。",
      ],
      fr: [
        "6 agents IA — Marketing par email, optimisation SEO, génération de leads, réseaux sociaux, gestion de projet et prospection commerciale.",
        "Activation en un clic — Sélectionnez les agents nécessaires, configurez-les et laissez-les travailler de manière autonome.",
        "Tableau de bord — Un hub central pour gérer vos projets, surveiller l'activité des agents et communiquer avec votre équipe IA.",
        "3 niveaux de tarification — Plan gratuit, Growth à 49 $/mois et Scale à 149 $/mois.",
      ],
    },
  },
];

const labels: Record<string, { title: string; backHome: string }> = {
  en: { title: "Changelog", backHome: "Back to Home" },
  zh: { title: "更新日志", backHome: "返回首页" },
  "zh-TW": { title: "更新日誌", backHome: "返回首頁" },
  fr: { title: "Journal des mises à jour", backHome: "Retour à l'accueil" },
};

export default async function ChangelogPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isValidLocale(locale)) notFound();
  getDictionary(locale); // validate locale
  const l = labels[locale] || labels.en;

  return (
    <div className="min-h-screen bg-gray-50">
      <nav className="bg-white border-b border-gray-200">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex items-center justify-between">
          <Link href={`/${locale}`} className="text-xl font-bold">
            <span className="text-red-500">Auto</span>Claw
          </Link>
          <div className="flex items-center gap-4">
            <LanguageSwitcher locale={locale} />
            <Link
              href={`/${locale}`}
              className="text-sm text-gray-500 hover:text-gray-700 transition-colors"
            >
              &larr; {l.backHome}
            </Link>
          </div>
        </div>
      </nav>

      <main className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <h1 className="text-3xl font-bold mb-8">{l.title}</h1>

        <div className="space-y-12">
          {changelog.map((entry) => (
            <article key={entry.version} className="relative">
              <div className="flex items-center gap-3 mb-3">
                <span className="inline-block bg-red-100 text-red-700 text-xs font-semibold px-2.5 py-1 rounded-full">
                  v{entry.version}
                </span>
                <time className="text-sm text-gray-400">{entry.date}</time>
              </div>
              <h2 className="text-xl font-semibold mb-4">
                {entry.title[locale] || entry.title.en}
              </h2>
              <ul className="space-y-3">
                {(entry.items[locale] || entry.items.en).map((item, i) => (
                  <li key={i} className="flex gap-3 text-gray-700 leading-relaxed">
                    <span className="text-red-400 mt-1 shrink-0">&#9679;</span>
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </article>
          ))}
        </div>
      </main>

      <footer className="bg-slate-900 text-gray-400 border-t border-gray-800">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8 text-center text-xs">
          <p>&copy; {new Date().getFullYear()} AutoClaw. All rights reserved.</p>
        </div>
      </footer>
    </div>
  );
}
