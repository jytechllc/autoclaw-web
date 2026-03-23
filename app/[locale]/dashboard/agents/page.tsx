"use client";

import { useUser } from "@auth0/nextjs-auth0/client";
import { useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { getDictionary, type Locale } from "@/lib/i18n";
import DashboardShell from "@/components/DashboardShell";

interface AgentModelOption {
  id: string;
  name: string;
  available: boolean;
}

interface AgentAssignment {
  id: number;
  agent_type: string;
  status: string;
  project_name: string;
  project_id?: number;
  config?: {
    model?: string;
    plan?: string;
    tasks?: { name: string; status: string; result?: string; model_used?: string; use_mode?: string }[];
    blockers?: string[];
    sender_email?: string;
    sender_name?: string;
    [key: string]: unknown;
  };
}

interface Project {
  id: number;
  name: string;
  website: string;
  description: string;
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  created_at: string;
}

interface ServerAgent {
  id: string;
  agent: string;
  description?: string;
  period: string;
  status: string;
  project: string;
  last_run: string;
  summary: string;
  metrics: Record<string, string | number>;
  enabled?: boolean;
}

const AGENT_STATUS_LABELS: Record<string, Record<string, string>> = {
  en: { active: "Active", pending: "Pending", paused: "Paused", completed: "Completed", unknown: "Unknown" },
  zh: { active: "已启用", pending: "待运行", paused: "已暂停", completed: "已完成", unknown: "未知" },
};

function statusBadge(status: string | null, locale = "en") {
  const colors: Record<string, string> = {
    active: "bg-green-100 text-green-700",
    pending: "bg-blue-100 text-blue-700",
    paused: "bg-yellow-100 text-yellow-700",
    completed: "bg-red-100 text-red-700",
  };
  const s = status || "unknown";
  const label = AGENT_STATUS_LABELS[locale]?.[s] || AGENT_STATUS_LABELS.en[s] || s;
  return (
    <span
      className={`px-2 py-0.5 rounded-full text-xs font-medium ${colors[s] || "bg-gray-100 text-gray-600"}`}
    >
      {label}
    </span>
  );
}

function RunningTimer({ startedAt }: { startedAt: number }) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const interval = setInterval(
      () => setElapsed(Math.floor((Date.now() - startedAt) / 1000)),
      1000,
    );
    return () => clearInterval(interval);
  }, [startedAt]);
  return <span className="ml-1 text-yellow-600 font-normal">({elapsed}s)</span>;
}

const STEP_LABELS: Record<string, Record<string, string>> = {
  en: {
    load_kb: "Loading knowledge base",
    fetch_website: "Fetching website content",
    search_company: "Searching company info online",
    check_icp: "Checking existing ICP from Lead Prospecting",
    ai_analyze: "AI analyzing",
    extract_criteria: "Extracting search criteria",
    save_result: "Saving results",
    check_provider: "Checking email provider",
    load_template: "Loading email template",
    fetch_leads: "Fetching unsent leads",
    sending_emails: "Sending emails",
    save_report: "Saving report",
    verify_sources: "Verifying data sources",
    search_leads: "Searching for leads",
    enrich_leads: "Enriching lead data",
    dedup: "Deduplicating contacts",
    save_enrichment: "Saving enrichment to contacts",
    score_leads: "Scoring leads",
  },
  zh: {
    load_kb: "加载知识库",
    fetch_website: "抓取网站内容",
    search_company: "网络搜索公司信息",
    check_icp: "检查潜客开发的 ICP 结果",
    ai_analyze: "AI 分析中",
    extract_criteria: "提取搜索条件",
    save_result: "保存结果",
    check_provider: "检查邮件服务商",
    load_template: "加载邮件模板",
    fetch_leads: "获取未发送潜客",
    sending_emails: "发送邮件中",
    save_report: "保存报告",
    verify_sources: "验证数据源",
    search_leads: "搜索潜客",
    enrich_leads: "丰富潜在客户数据",
    dedup: "联系人去重",
    save_enrichment: "保存丰富数据到联系人",
    score_leads: "评分潜在客户",
  },
  "zh-TW": {
    load_kb: "載入知識庫",
    fetch_website: "擷取網站內容",
    search_company: "網路搜尋公司資訊",
    check_icp: "檢查潛客開發的 ICP 結果",
    ai_analyze: "AI 分析中",
    extract_criteria: "擷取搜尋條件",
    save_result: "儲存結果",
    check_provider: "檢查郵件服務商",
    load_template: "載入郵件範本",
    fetch_leads: "取得未發送潛客",
    sending_emails: "發送郵件中",
    save_report: "儲存報告",
    verify_sources: "驗證資料來源",
    search_leads: "搜尋潛客",
    enrich_leads: "豐富潛在客戶資料",
    dedup: "聯絡人去重",
    save_enrichment: "儲存豐富資料到聯絡人",
    score_leads: "評分潛在客戶",
  },
  fr: {
    load_kb: "Chargement de la base de connaissances",
    fetch_website: "Extraction du contenu du site",
    search_company: "Recherche d'infos entreprise en ligne",
    check_icp: "Vérification de l'ICP existant",
    ai_analyze: "Analyse IA",
    extract_criteria: "Extraction des critères",
    save_result: "Sauvegarde des résultats",
    check_provider: "Vérification du fournisseur e-mail",
    load_template: "Chargement du modèle e-mail",
    fetch_leads: "Récupération des prospects",
    sending_emails: "Envoi des e-mails",
    save_report: "Sauvegarde du rapport",
    verify_sources: "Vérification des sources",
    search_leads: "Recherche de prospects",
    enrich_leads: "Enrichissement des données",
    dedup: "Déduplication des contacts",
    save_enrichment: "Sauvegarde de l'enrichissement",
    score_leads: "Notation des prospects",
  },
};

interface StepData {
  step_key: string;
  status: string;
  detail: string | null;
  created_at: string;
}

function StepItem({ step, label }: { step: StepData; label: string }) {
  const [expanded, setExpanded] = useState(false);
  const hasLongDetail = !!step.detail && step.detail.length > 60;
  const shortDetail = step.detail ? (step.detail.length > 60 ? step.detail.substring(0, 60) + "…" : step.detail) : "";

  return (
    <div>
      <div className="flex items-center gap-1.5 text-[11px]">
        {step.status === "running" ? (
          <span className="text-yellow-500 animate-spin inline-block w-3 text-center">&#9696;</span>
        ) : step.status === "done" ? (
          <span className="text-green-500 w-3 text-center">&#10003;</span>
        ) : (
          <span className="text-red-500 w-3 text-center">&#10007;</span>
        )}
        <span className={step.status === "running" ? "text-gray-700 font-medium" : "text-gray-400"}>
          {label}
        </span>
        {step.detail && !hasLongDetail && <span className="text-gray-300">({step.detail})</span>}
        {hasLongDetail && (
          <button
            onClick={() => setExpanded(!expanded)}
            className="text-blue-400 hover:text-blue-500 underline cursor-pointer ml-0.5"
          >
            {expanded ? "▾ collapse" : `▸ ${shortDetail}`}
          </button>
        )}
      </div>
      {expanded && step.detail && (
        <pre className="ml-6 mt-0.5 mb-1 text-[10px] text-gray-500 bg-gray-50 rounded px-2 py-1 whitespace-pre-wrap break-words max-h-40 overflow-y-auto border border-gray-100">
          {step.detail}
        </pre>
      )}
    </div>
  );
}

function StepLog({ agentId, taskIndex, isRunning, locale }: { agentId: number; taskIndex: number; isRunning: boolean; locale: string }) {
  const [steps, setSteps] = useState<StepData[]>([]);

  useEffect(() => {
    if (!isRunning && steps.length === 0) return;
    let cancelled = false;
    const poll = () => {
      fetch(`/api/agent-steps?agent_id=${agentId}&task_index=${taskIndex}`)
        .then((r) => r.ok ? r.json() : null)
        .then((d) => { if (d && !cancelled) setSteps(d.steps || []); })
        .catch(() => {});
    };
    poll();
    const interval = isRunning ? setInterval(poll, 2000) : undefined;
    return () => { cancelled = true; if (interval) clearInterval(interval); };
  }, [agentId, taskIndex, isRunning]);

  if (steps.length === 0) return null;

  const labels = STEP_LABELS[locale] || STEP_LABELS.en;

  return (
    <div className="ml-6 mt-1 mb-1 space-y-0.5">
      {steps.map((s, i) => (
        <StepItem key={i} step={s} label={labels[s.step_key] || s.step_key} />
      ))}
    </div>
  );
}

function stringifyResult(value: unknown): string {
  if (typeof value === "string") return value;
  if (value == null) return "";
  try {
    return `\`\`\`json\n${JSON.stringify(value, null, 2)}\n\`\`\``;
  } catch {
    return String(value);
  }
}

function formatExecutionData(data: unknown, labels?: { statusCompleted: string; statusFailed: string; executedTasks: string; executionCompleted: string }): string {
  if (!data || typeof data !== "object") {
    return stringifyResult(data);
  }

  const payload = data as {
    message?: string;
    error?: string;
    result?: unknown;
    results?: Array<{
      task_index?: number;
      task_name?: string;
      ok?: boolean;
      data?: unknown;
      error?: string;
    }>;
    tasks_run?: number;
  };

  if (Array.isArray(payload.results)) {
    const completedLabel = labels?.statusCompleted || "completed";
    const failedLabel = labels?.statusFailed || "failed";
    const sections = payload.results.map((item, index) => {
      const lines = [
        `## ${index + 1}. ${item.task_name || `Task ${item.task_index ?? index}`}`,
        item.ok ? `- Status: ${completedLabel}` : `- Status: ${failedLabel}`,
      ];

      if (item.error) {
        lines.push("", item.error);
      }

      const nested =
        item.data &&
        typeof item.data === "object" &&
        "result" in (item.data as Record<string, unknown>)
          ? (item.data as { result?: unknown }).result
          : item.data;
      const rendered = stringifyResult(nested);

      if (rendered) {
        lines.push("", rendered);
      }

      return lines.join("\n");
    });

    const header =
      payload.message ||
      (payload.tasks_run
        ? (labels?.executedTasks || "Executed {count} tasks").replace("{count}", String(payload.tasks_run))
        : labels?.executionCompleted || "Execution completed");
    return [`# ${header}`, "", ...sections].join("\n\n");
  }

  if (payload.result !== undefined) {
    const message = payload.message ? `# ${payload.message}\n\n` : "";
    return `${message}${stringifyResult(payload.result)}`.trim();
  }

  if (payload.error) {
    return payload.error;
  }

  return stringifyResult(payload);
}

function MarkdownResult({ content }: { content: string }) {
  return (
    <div className="prose prose-sm max-w-none prose-p:my-1 prose-pre:my-2 prose-ul:my-1 prose-ol:my-1 prose-headings:my-2">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
    </div>
  );
}

export default function AgentsPage() {
  const params = useParams();
  const locale = (params.locale as Locale) || "en";
  const dict = getDictionary(locale);
  const ta = dict.agentsPage;
  const tc = dict.common;

  const AGENT_OPTIONS = [
    { type: "email_marketing", label: ta.emailMarketing, comingSoon: false },
    { type: "seo_content", label: ta.seoContent, comingSoon: false },
    { type: "lead_prospecting", label: ta.leadProspecting, comingSoon: false },
    { type: "social_media", label: ta.socialMedia, comingSoon: true },
    { type: "product_manager", label: ta.productManager, comingSoon: true },
    { type: "sales_followup", label: ta.salesFollowup, comingSoon: false },
    { type: "orchestrator", label: ta.orchestrator, comingSoon: true },
  ];

  const { user, isLoading: userLoading } = useUser();
  const WORKER_MODELS = [
    "cerebras/qwen-3-235b",
    "cerebras/gpt-oss-120b",
    "anthropic/claude-sonnet-4.5",
    "alibaba/qwen-plus",
    "alibaba/qwen-turbo",
  ];

  const taskNameZh: Record<string, string> = {
    "Build prospect email list from existing contacts": "从现有联系人构建邮件列表",
    "Create email templates (cold, follow-up, newsletter)": "创建邮件模板（冷启动、跟进、通讯）",
    "Configure sending schedule & limits": "配置发送计划和限制",
    "Set up tracking (opens, clicks, replies)": "设置追踪（打开、点击、回复）",
    "Launch outreach campaign": "发起营销活动",
    "Crawl website & audit current SEO health": "爬取网站并审计 SEO 状态",
    "Keyword research": "关键词研究",
    "Competitor content analysis": "竞争对手内容分析",
    "Create monthly content calendar": "创建月度内容日历",
    "Write first 3 SEO-optimized blog posts": "撰写前 3 篇 SEO 优化博客",
    "Set up rank tracking & analytics": "设置排名追踪和分析",
    "Define ICP and qualification criteria": "定义理想客户画像和筛选标准",
    "Verify available data sources": "验证可用数据源",
    "Build initial lead list": "构建初始线索列表",
    "Enrich leads with company & contact data": "丰富线索的公司和联系信息",
    "Score and prioritize leads": "评分和排序线索",
    "Deliver qualified lead report": "交付合格线索报告",
    "Audit existing social presence": "审计现有社交媒体状态",
    "Create brand voice & content guidelines": "创建品牌声音和内容指南",
    "Build 2-week content queue (posts, threads)": "构建 2 周内容队列",
    "Set up scheduling tool integration": "设置排期工具集成",
    "Launch engagement campaign (likes, replies, follows)": "发起互动活动",
    "Track follower growth & engagement metrics": "追踪粉丝增长和互动指标",
    "Set up website monitoring (uptime, speed)": "设置网站监控（可用性、速度）",
    "Install analytics tracking": "安装分析追踪",
    "Map conversion funnels": "映射转化漏斗",
    "Run initial UX audit": "执行 UX 初步审计",
    "Identify top 5 conversion blockers": "识别前 5 个转化阻碍",
    "Create optimization roadmap": "创建优化路线图",
    "Connect to CRM (HubSpot, Salesforce, etc.)": "连接 CRM（HubSpot、Salesforce 等）",
    "Import existing leads & deals": "导入现有线索和商机",
    "Create follow-up email sequences": "创建跟进邮件序列",
    "Set up automated reminders": "设置自动提醒",
    "Configure deal stage tracking": "配置商机阶段追踪",
    "Launch follow-up email campaign": "发起跟进邮件活动",
    "Analyze agent ecosystem & collect reports": "分析代理生态并收集报告",
    "Generate cross-agent optimization recommendations": "生成跨代理优化建议",
    "Market intelligence & content strategy": "市场情报与内容策略",
    "Auto-coordinate agents (reset periodic tasks, flag blockers)": "自动协调代理",
  };
  const translateTask = (name: string) => (locale === "zh" || locale === "zh-TW") ? (taskNameZh[name] || name) : name;

  const [agents, setAgents] = useState<AgentAssignment[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [serverAgents, setServerAgents] = useState<ServerAgent[]>([]);
  const [loading, setLoading] = useState(true);
  const [planInfo, setPlanInfo] = useState({
    plan: "starter",
    agentLimit: 2,
    totalAgents: 0,
  });
  const [showCreateProject, setShowCreateProject] = useState(false);
  const [newProject, setNewProject] = useState({
    name: "",
    website: "",
    description: "",
  });
  const [actionLoading, setActionLoading] = useState(false);
  const [runningTask, setRunningTask] = useState<{
    agentId: number;
    taskIndex: number;
    startedAt: number;
  } | null>(null);
  const batchAbortRef = useRef<AbortController | null>(null);
  const [taskResult, setTaskResult] = useState<
    Record<number, { result?: unknown; message?: string; error?: string }>
  >({});
  const [expandedTasks, setExpandedTasks] = useState<Record<string, boolean>>(
    {},
  );
  const [taskReports, setTaskReports] = useState<
    Record<
      number,
      {
        task_name: string;
        summary: string;
        metrics: Record<string, unknown>;
        created_at: string;
      }[]
    >
  >({});
  const [agentModels, setAgentModels] = useState<Record<number, string>>({});
  const [savingModelId, setSavingModelId] = useState<number | null>(null);
  const [availableModels, setAvailableModels] = useState<AgentModelOption[]>([
    {
      id: "auto",
      name: ta.modelAuto || "Auto (Best Available)",
      available: true,
    },
  ]);

  const loadData = () => {
    const ts = Date.now();
    return Promise.all([
      fetch(`/api/reports?_t=${ts}`).then((r) => r.json()),
      fetch(`/api/projects?_t=${ts}`).then((r) => r.json()),
      fetch(`/api/models?_t=${ts}`)
        .then((r) => r.json())
        .catch(() => ({ models: [] })),
    ]).then(async ([reportData, projectData, modelData]) => {
      const agentsList = (projectData.agents || []) as AgentAssignment[];
      setAgents(agentsList);
      setServerAgents(reportData.serverAgents || reportData.reports || []);
      setProjects(projectData.projects || []);
      setPlanInfo({
        plan: projectData.plan || "starter",
        agentLimit: projectData.agentLimit || 2,
        totalAgents: projectData.totalAgents || 0,
      });
      setAgentModels(
        Object.fromEntries(
          agentsList.map((agent) => [
            agent.id,
            agent.config?.model || "auto",
          ]),
        ),
      );
      const models = (
        (
          modelData as {
            models?: { id: string; name: string; available?: boolean }[];
          }
        ).models || []
      )
        .filter((model) => WORKER_MODELS.includes(model.id))
        .map((model) => ({
          id: model.id,
          name: model.name,
          available: model.available !== false,
        }));
      setAvailableModels([
        {
          id: "auto",
          name: ta.modelAuto || "Auto (Best Available)",
          available: true,
        },
        ...models,
      ]);

      // Auto-fetch reports for agents that have completed tasks (to show model_used)
      const agentsWithCompleted = agentsList.filter((a) =>
        a.config?.tasks?.some((t) => t.status === "completed"),
      );
      const reportFetches = agentsWithCompleted.map((a) =>
        fetch(`/api/agent-reports?agent_id=${a.id}`)
          .then((r) => r.json())
          .then((data) => ({ agentId: a.id, reports: data.reports || [] }))
          .catch(() => ({ agentId: a.id, reports: [] })),
      );
      if (reportFetches.length > 0) {
        const allReports = await Promise.all(reportFetches);
        setTaskReports((prev) => {
          const next = { ...prev };
          for (const { agentId, reports } of allReports) {
            next[agentId] = reports;
          }
          return next;
        });
      }
    });
  };

  useEffect(() => {
    if (!user) return;
    setLoading(true);
    loadData().finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  async function createProject(e: React.FormEvent) {
    e.preventDefault();
    if (!newProject.name.trim() || actionLoading) return;
    setActionLoading(true);
    try {
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "create_project", ...newProject }),
      });
      if (res.ok) {
        setNewProject({ name: "", website: "", description: "" });
        setShowCreateProject(false);
        await loadData();
      }
    } finally {
      setActionLoading(false);
    }
  }

  async function activateAgent(projectId: number, agentType: string) {
    setActionLoading(true);
    try {
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "activate_agent",
          project_id: projectId,
          agent_type: agentType,
          locale,
        }),
      });
      const data = await res.json();
      if (!res.ok) alert(data.error);
      await loadData();
    } finally {
      setActionLoading(false);
    }
  }

  async function deactivateAgent(agentId: number) {
    if (!confirm(ta.confirmRemoveAgent)) return;
    setActionLoading(true);
    try {
      await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "deactivate_agent", agent_id: agentId }),
      });
      await loadData();
    } finally {
      setActionLoading(false);
    }
  }

  async function resolveBlocker(
    agentId: number,
    blockerIndex: number,
    blockerText: string,
  ) {
    // Auto-resolve: check BYOK keys for service credential blockers
    const isEmailBlocker = /smtp|email.*service|sendgrid|mailgun|brevo|邮件服务/i.test(blockerText);
    const isTwitterBlocker = /twitter|x\/twitter/i.test(blockerText);
    const isWebsiteBlocker = /website url|网站\s*url/i.test(blockerText);
    const isICPBlocker = /target audience|ideal customer profile|ICP|理想客户|目标受众/i.test(blockerText);
    const isByokBlocker = isEmailBlocker || isTwitterBlocker;

    // ICP/audience blocker — check if Lead Prospecting has completed ICP
    if (isICPBlocker) {
      const agent = agents.find((a) => a.id === agentId);
      const projectId = agent?.project_id;
      // Check if there's a lead_prospecting agent with completed ICP on the same project
      const lpAgent = agents.find((a) => a.agent_type === "lead_prospecting" && a.project_id === projectId);
      const lpTasks = lpAgent?.config?.tasks || [];
      const icpDone = lpTasks[0]?.status === "completed";
      if (icpDone) {
        setActionLoading(true);
        try {
          await fetch("/api/projects", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              action: "resolve_blocker",
              agent_id: agentId,
              blocker_index: blockerIndex,
              value: "ICP data available from Lead Prospecting agent",
            }),
          });
          await loadData();
          return;
        } finally {
          setActionLoading(false);
        }
      } else {
        const msg = locale === "zh" || locale === "zh-TW"
          ? "请先运行「潜在客户挖掘」代理的 ICP 定义任务，完成后再回来解决此阻挡项。"
          : "Please run the Lead Prospecting agent's ICP Definition task first, then come back to resolve this blocker.";
        alert(msg);
        return;
      }
    }

    // Website URL blocker — check if project already has a website configured
    if (isWebsiteBlocker) {
      const agent = agents.find((a) => a.id === agentId);
      const project = projects.find((p) => p.id === agent?.project_id);
      if (project?.website) {
        setActionLoading(true);
        try {
          await fetch("/api/projects", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              action: "resolve_blocker",
              agent_id: agentId,
              blocker_index: blockerIndex,
              value: project.website,
            }),
          });
          await loadData();
          return;
        } finally {
          setActionLoading(false);
        }
      }
    }

    // BYOK credential blockers — check user's API keys
    if (isByokBlocker) {
      setActionLoading(true);
      try {
        const keysRes = await fetch("/api/api-keys");
        const keysData = await keysRes.json() as { keys?: { service: string }[] };
        const keys = keysData.keys || [];

        if (isEmailBlocker) {
          const hasEmail = keys.some((k) => k.service === "sendgrid" || k.service === "brevo");
          if (hasEmail) {
            const provider = keys.find((k) => k.service === "sendgrid") ? "SendGrid" : "Brevo";
            await fetch("/api/projects", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                action: "resolve_blocker",
                agent_id: agentId,
                blocker_index: blockerIndex,
                value: `${provider} API key configured via BYOK`,
              }),
            });
            await loadData();
            return;
          }
        }

        if (isTwitterBlocker) {
          const hasTwitter = keys.some((k) => k.service === "twitter_api_key");
          if (hasTwitter) {
            await fetch("/api/projects", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                action: "resolve_blocker",
                agent_id: agentId,
                blocker_index: blockerIndex,
                value: "Twitter API credentials configured via BYOK",
              }),
            });
            await loadData();
            return;
          }
        }

        // No matching key found — redirect to settings
        const goToSettings = confirm(ta.apiKeyNotFound);
        if (goToSettings) {
          window.location.href = `/${locale}/dashboard/settings#section-byok`;
        }
        return;
      } finally {
        setActionLoading(false);
      }
    }

    const value = prompt(
      `${ta.resolvePrompt} "${blockerText}"\n\n${ta.resolveHint}`,
    );
    if (value === null) return;
    setActionLoading(true);
    try {
      await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "resolve_blocker",
          agent_id: agentId,
          blocker_index: blockerIndex,
          value,
        }),
      });
      await loadData();
    } finally {
      setActionLoading(false);
    }
  }

  async function executeTask(agentId: number, taskIndex: number) {
    setActionLoading(true);
    setRunningTask({ agentId, taskIndex, startedAt: Date.now() });
    setTaskResult((prev) => ({ ...prev, [agentId]: {} }));
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 120000); // 2 min timeout
    try {
      const res = await fetch("/api/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agent_id: agentId, task_index: taskIndex, locale }),
        signal: controller.signal,
      });
      const data = await res.json();
      if (!res.ok) {
        setTaskResult((prev) => ({
          ...prev,
          [agentId]: { error: data.error || ta.taskFailed },
        }));
      } else {
        setTaskResult((prev) => ({
          ...prev,
          [agentId]: { result: data.result, message: data.message },
        }));
      }
      await loadData();
    } catch (e) {
      const msg =
        e instanceof DOMException && e.name === "AbortError"
          ? ta.taskTimeout
          : ta.taskFailed;
      setTaskResult((prev) => ({ ...prev, [agentId]: { error: msg } }));
    } finally {
      clearTimeout(timeout);
      setActionLoading(false);
      setRunningTask(null);
    }
  }

  function stopRunning() {
    if (batchAbortRef.current) {
      batchAbortRef.current.abort();
      batchAbortRef.current = null;
    }
  }

  async function executeTaskBatch(agentId: number, taskIndexes: number[]) {
    const batchAbort = new AbortController();
    batchAbortRef.current = batchAbort;
    setActionLoading(true);
    setRunningTask({ agentId, taskIndex: -1, startedAt: Date.now() });
    setTaskResult((prev) => ({ ...prev, [agentId]: {} }));
    const results: {
      task_index: number;
      task_name: string;
      ok: boolean;
      data?: unknown;
      error?: string;
    }[] = [];

    try {
      const agent = agents.find((item) => item.id === agentId);
      const tasks = agent?.config?.tasks || [];

      for (const taskIndex of taskIndexes) {
        // Check if user requested stop
        if (batchAbort.signal.aborted) {
          setTaskResult((prev) => ({
            ...prev,
            [agentId]: {
              error: ta.runAllStopped,
              message: ta.executedTasks?.replace("{count}", String(results.length)),
              result: { tasks_run: results.length, results },
            },
          }));
          await loadData();
          return;
        }

        // Update UI to show which task is running
        setRunningTask({ agentId, taskIndex, startedAt: Date.now() });

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 120000);
        // Link batch abort to per-task abort
        const onBatchAbort = () => controller.abort();
        batchAbort.signal.addEventListener("abort", onBatchAbort);

        try {
          const res = await fetch("/api/execute", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ agent_id: agentId, task_index: taskIndex, locale }),
            signal: controller.signal,
          });
          const data = await res.json();
          results.push({
            task_index: taskIndex,
            task_name: tasks[taskIndex]?.name || `Task ${taskIndex}`,
            ok: res.ok,
            data: res.ok ? data.result : undefined,
            error: !res.ok ? data.error || ta.taskFailed : undefined,
          });

          // Refresh data after each task so UI updates in real time
          await loadData();

          if (!res.ok) {
            setTaskResult((prev) => ({
              ...prev,
              [agentId]: {
                error: ta.runAllStopped,
                result: { tasks_run: results.length, results },
              },
            }));
            return;
          }
        } catch (e) {
          const isAbort = e instanceof DOMException && e.name === "AbortError";
          const isStopped = batchAbort.signal.aborted;
          const msg = isStopped
            ? (ta.forceStoppedMsg || "Stopped by user")
            : isAbort
              ? ta.taskTimeout
              : ta.taskFailed;
          results.push({
            task_index: taskIndex,
            task_name: tasks[taskIndex]?.name || `Task ${taskIndex}`,
            ok: false,
            error: msg,
          });
          setTaskResult((prev) => ({
            ...prev,
            [agentId]: {
              error: isStopped ? (ta.forceStoppedMsg || "Stopped by user") : ta.runAllStopped,
              result: { tasks_run: results.length, results },
            },
          }));
          await loadData();
          return;
        } finally {
          clearTimeout(timeout);
          batchAbort.signal.removeEventListener("abort", onBatchAbort);
        }
      }

      setTaskResult((prev) => ({
        ...prev,
        [agentId]: {
          message: ta.allTasksCompleted,
          result: { tasks_run: results.length, results },
        },
      }));
      await loadData();
    } finally {
      batchAbortRef.current = null;
      setActionLoading(false);
      setRunningTask(null);
    }
  }

  async function runNextTask(agentId: number) {
    const agent = agents.find((item) => item.id === agentId);
    if (!agent) return;
    const tasks = agent.config?.tasks || [];
    const nextTaskIndex = tasks.findIndex(
      (task) => task.status === "in_progress" || task.status === "pending",
    );
    if (nextTaskIndex === -1) {
      if (tasks.length === 0) {
        setTaskResult((prev) => ({
          ...prev,
          [agentId]: { message: "No tasks available" },
        }));
        return;
      }
      return executeTask(agentId, 0);
    }
    return executeTask(agentId, nextTaskIndex);
  }

  async function runAllTasks(agentId: number, mode: "continue" | "restart" = "continue") {
    const agent = agents.find((item) => item.id === agentId);
    if (!agent) return;
    const tasks = agent.config?.tasks || [];
    if (tasks.length === 0) return;

    // Restart mode: reset all tasks first
    if (mode === "restart") {
      try {
        await fetch("/api/execute", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ agent_id: agentId, action: "reset" }),
        });
        await loadData();
      } catch { /* continue anyway */ }
      // Run all tasks from 0
      return executeTaskBatch(agentId, tasks.map((_, i) => i));
    }

    // Continue mode: find remaining tasks and run them sequentially
    const runnableIndexes = tasks
      .map((task, index) => ({ task, index }))
      .filter(({ task }) => task.status === "in_progress" || task.status === "pending")
      .map(({ index }) => index);

    if (runnableIndexes.length === 0) {
      // All completed — restart all
      try {
        await fetch("/api/execute", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ agent_id: agentId, action: "reset" }),
        });
        await loadData();
      } catch { /* continue anyway */ }
      return executeTaskBatch(agentId, tasks.map((_, i) => i));
    }

    return executeTaskBatch(agentId, runnableIndexes);
  }

  function toggleTaskDetail(agentId: number, taskIndex: number) {
    const key = `${agentId}-${taskIndex}`;
    setExpandedTasks((prev) => ({ ...prev, [key]: !prev[key] }));
    // Fetch reports for this agent if not loaded yet
    if (!taskReports[agentId]) {
      fetch(`/api/agent-reports?agent_id=${agentId}`)
        .then((r) => r.json())
        .then((data) => {
          setTaskReports((prev) => ({
            ...prev,
            [agentId]: data.reports || [],
          }));
        });
    }
  }

  async function deleteProject(projectId: number) {
    if (!confirm(ta.confirmDeleteProject)) return;
    setActionLoading(true);
    try {
      await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "delete_project",
          project_id: projectId,
        }),
      });
      await loadData();
    } finally {
      setActionLoading(false);
    }
  }

  async function updateAgentModel(agentId: number, model: string) {
    setSavingModelId(agentId);
    setAgentModels((prev) => ({ ...prev, [agentId]: model }));
    try {
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "update_agent_config",
          agent_id: agentId,
          config: { model },
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        alert(data.error || ta.modelSaveFailed || "Failed to update model");
        await loadData();
      }
    } finally {
      setSavingModelId(null);
    }
  }

  if (userLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <p className="text-gray-500">{tc.loading}</p>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <h1 className="text-2xl font-bold mb-4">{ta.signInAgents}</h1>
          <a
            href={`/auth/login?returnTo=/${locale}/dashboard/reports`}
            className="bg-red-800 hover:bg-red-900 text-white px-6 py-3 rounded-lg font-medium transition-colors"
          >
            {tc.logIn}
          </a>
        </div>
      </div>
    );
  }

  return (
    <DashboardShell user={user} plan={planInfo.plan}>
      <div className="px-4 sm:px-6 py-6 w-full">
        <h1 className="text-2xl font-bold mb-6">{ta.title}</h1>

        {loading ? (
          <p className="text-gray-500">{ta.loadingAgents}</p>
        ) : (
          <>
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
              <div className="text-sm text-gray-500">
                <span className="font-medium text-gray-700 capitalize">
                  {planInfo.plan}
                </span>{" "}
                {ta.plan} — {planInfo.totalAgents}/
                {planInfo.agentLimit === 999
                  ? ta.unlimited
                  : planInfo.agentLimit}{" "}
                {ta.agentsUsed}
              </div>
              <button
                onClick={() => setShowCreateProject(true)}
                className="bg-red-800 hover:bg-red-900 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors cursor-pointer"
              >
                {ta.newProject}
              </button>
            </div>

            {showCreateProject && (
              <form
                onSubmit={createProject}
                className="bg-white rounded-lg border border-gray-200 p-5 mb-4"
              >
                <h3 className="font-semibold text-sm mb-3">
                  {ta.createProject}
                </h3>
                <div className="space-y-3">
                  <input
                    type="text"
                    placeholder={ta.projectName}
                    value={newProject.name}
                    onChange={(e) =>
                      setNewProject({ ...newProject, name: e.target.value })
                    }
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
                    required
                  />
                  <input
                    type="text"
                    placeholder={ta.websiteUrl}
                    value={newProject.website}
                    onChange={(e) =>
                      setNewProject({ ...newProject, website: e.target.value })
                    }
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
                  />
                  <textarea
                    placeholder={ta.briefDesc}
                    value={newProject.description}
                    onChange={(e) =>
                      setNewProject({
                        ...newProject,
                        description: e.target.value,
                      })
                    }
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500 resize-none"
                    rows={2}
                  />
                  <div className="flex gap-2">
                    <button
                      type="submit"
                      disabled={actionLoading || !newProject.name.trim()}
                      className="bg-red-800 hover:bg-red-900 disabled:bg-gray-300 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors cursor-pointer"
                    >
                      {tc.create}
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowCreateProject(false)}
                      className="text-gray-500 hover:text-gray-700 px-4 py-2 text-sm cursor-pointer"
                    >
                      {tc.cancel}
                    </button>
                  </div>
                </div>
              </form>
            )}

            {/* AI Employee Role Overview */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
              {AGENT_OPTIONS.map((opt) => {
                const descriptions: Record<string, string> = {
                  email_marketing: ta.emailMarketingDesc,
                  seo_content: ta.seoContentDesc,
                  lead_prospecting: ta.leadProspectingDesc,
                  social_media: ta.socialMediaDesc,
                  product_manager: ta.productManagerDesc,
                  sales_followup: ta.salesFollowupDesc,
                  orchestrator: ta.orchestratorDesc,
                };
                const icons: Record<string, string> = {
                  email_marketing: "📧",
                  seo_content: "🔍",
                  lead_prospecting: "🎯",
                  social_media: "📱",
                  product_manager: "📋",
                  sales_followup: "🤝",
                  orchestrator: "🎛️",
                };
                const activeCount = agents.filter((a) => a.agent_type === opt.type).length;
                return (
                  <div
                    key={opt.type}
                    className={`relative rounded-lg border p-4 ${
                      opt.comingSoon
                        ? "bg-gray-50 border-gray-200 opacity-75"
                        : "bg-white border-gray-200"
                    }`}
                  >
                    {opt.comingSoon && (
                      <span className="absolute top-2 right-2 px-2 py-0.5 bg-amber-100 text-amber-700 text-[10px] font-semibold rounded-full">
                        {ta.comingSoon}
                      </span>
                    )}
                    {!opt.comingSoon && activeCount > 0 && (
                      <span className="absolute top-2 right-2 px-2 py-0.5 bg-green-100 text-green-700 text-[10px] font-semibold rounded-full">
                        {activeCount} {ta.activeLabel}
                      </span>
                    )}
                    <div className="text-2xl mb-2">{icons[opt.type] || "🤖"}</div>
                    <h3 className={`text-sm font-semibold mb-1 ${opt.comingSoon ? "text-gray-400" : "text-gray-800"}`}>
                      {opt.label}
                    </h3>
                    <p className={`text-xs leading-relaxed ${opt.comingSoon ? "text-gray-400" : "text-gray-500"}`}>
                      {descriptions[opt.type] || ""}
                    </p>
                  </div>
                );
              })}
            </div>

            {projects.length === 0 && agents.length === 0 && (
              <div className="bg-white rounded-lg border border-gray-200 p-8 text-center">
                <p className="text-gray-500 mb-2">{ta.noProjects}</p>
                <p className="text-gray-400 text-sm">{ta.noProjectsDesc}</p>
              </div>
            )}

            {projects.map((project) => {
              const projectAgents = agents.filter(
                (a) => a.project_name === project.name,
              );
              const assignedTypes = projectAgents.map((a) => a.agent_type);
              const availableToAdd = AGENT_OPTIONS.filter(
                (a) => !assignedTypes.includes(a.type),
              );

              return (
                <div key={project.id} className="mb-6">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-3">
                    <div>
                      <h2 className="text-base font-semibold">
                        {project.name}
                      </h2>
                      {project.website && (
                        <p className="text-xs text-gray-400 break-all">
                          {project.website}
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {availableToAdd.length > 0 &&
                        planInfo.totalAgents < planInfo.agentLimit && (
                          <select
                            onChange={(e) => {
                              if (e.target.value) {
                                const opt = AGENT_OPTIONS.find((o) => o.type === e.target.value);
                                if (opt?.comingSoon) {
                                  e.target.value = "";
                                  return;
                                }
                                activateAgent(project.id, e.target.value);
                                e.target.value = "";
                              }
                            }}
                            className="border border-gray-300 rounded-lg px-2 py-1.5 text-xs text-gray-600 cursor-pointer focus:outline-none focus:ring-2 focus:ring-red-500"
                            defaultValue=""
                          >
                            <option value="" disabled>
                              {ta.addAgent}
                            </option>
                            {availableToAdd.map((a) => (
                              <option key={a.type} value={a.type} disabled={a.comingSoon}>
                                {a.label}{a.comingSoon ? ` (${ta.comingSoon})` : ""}
                              </option>
                            ))}
                          </select>
                        )}
                      <button
                        onClick={() => deleteProject(project.id)}
                        className="text-xs text-red-400 hover:text-red-600 cursor-pointer"
                      >
                        {tc.delete}
                      </button>
                    </div>
                  </div>

                  {projectAgents.length === 0 ? (
                    <p className="text-sm text-gray-400 bg-white rounded-lg border border-gray-200 p-4">
                      {ta.noAgents}
                    </p>
                  ) : (
                    <div className="space-y-3">
                      {projectAgents.map((agent) => {
                        const config = agent.config || {};
                        const tasks = config.tasks || [];
                        const blockers = (config.blockers || []).filter(
                          (b) => !b.toLowerCase().includes("linkedin"),
                        );
                        const completedTasks = tasks.filter(
                          (t) => t.status === "completed" || t.status === "recurring",
                        ).length;
                        const inProgressTasks = tasks.filter(
                          (t) => t.status === "in_progress",
                        ).length;
                        const progress =
                          tasks.length > 0
                            ? Math.round((completedTasks / tasks.length) * 100)
                            : 0;

                        return (
                          <div
                            key={agent.id}
                            className="bg-white rounded-lg border border-gray-200 p-5"
                          >
                            <div className="flex items-center justify-between mb-3">
                              <div>
                                <h3 className="font-semibold text-sm">
                                  {agent.agent_type
                                    .replace(/_/g, " ")
                                    .replace(/\b\w/g, (c) => c.toUpperCase())
                                    .replace(/\bSeo\b/g, "SEO")}
                                  <span className="ml-1.5 text-[10px] text-gray-400 font-normal">#{agent.id}</span>
                                </h3>
                                <p className="text-xs text-gray-400">
                                  {agent.project_name}
                                  {agent.project_id
                                    ? ` (#${agent.project_id})`
                                    : ""}
                                </p>
                              </div>
                              <div className="flex items-center gap-2">
                                {tasks.length > 0 && (() => {
                                  const hasPending = tasks.some((t: { status: string }) => t.status === "pending" || t.status === "in_progress");
                                  const allCompleted = completedTasks === tasks.length;
                                  const hasPartialProgress = completedTasks > 0 && hasPending;
                                  const isThisAgentRunning = actionLoading && runningTask?.agentId === agent.id;
                                  return (
                                    <>
                                      {/* Stop button — only when this agent is running */}
                                      {isThisAgentRunning && (
                                        <button
                                          onClick={stopRunning}
                                          className="bg-red-600 hover:bg-red-700 text-white px-3 py-1 rounded text-xs font-medium transition-colors cursor-pointer flex items-center gap-1"
                                        >
                                          <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24"><rect x="6" y="6" width="12" height="12" rx="1" /></svg>
                                          {ta.forceStop || "Stop"}
                                        </button>
                                      )}
                                      <button
                                        onClick={() => runNextTask(agent.id)}
                                        disabled={actionLoading}
                                        className="bg-emerald-600 hover:bg-emerald-700 disabled:bg-gray-300 text-white px-3 py-1 rounded text-xs font-medium transition-colors cursor-pointer"
                                      >
                                        {ta.runNext}
                                      </button>
                                      {/* Fresh agent (no completed): Run All */}
                                      {!allCompleted && !hasPartialProgress && (
                                        <button
                                          onClick={() => runAllTasks(agent.id, "continue")}
                                          disabled={actionLoading}
                                          className="bg-green-500 hover:bg-green-600 disabled:bg-gray-300 text-white px-3 py-1 rounded text-xs font-medium transition-colors cursor-pointer"
                                        >
                                          {ta.runAll || "Run All"}
                                        </button>
                                      )}
                                      {/* Partial progress: Continue + Restart */}
                                      {hasPartialProgress && (
                                        <>
                                          <button
                                            onClick={() => runAllTasks(agent.id, "continue")}
                                            disabled={actionLoading}
                                            className="bg-green-500 hover:bg-green-600 disabled:bg-gray-300 text-white px-3 py-1 rounded text-xs font-medium transition-colors cursor-pointer"
                                          >
                                            {ta.continueRun || "Continue"}
                                          </button>
                                          <button
                                            onClick={() => runAllTasks(agent.id, "restart")}
                                            disabled={actionLoading}
                                            className="bg-orange-500 hover:bg-orange-600 disabled:bg-gray-300 text-white px-3 py-1 rounded text-xs font-medium transition-colors cursor-pointer"
                                          >
                                            {ta.restartRun || "Restart"}
                                          </button>
                                        </>
                                      )}
                                      {/* All completed: Restart only */}
                                      {allCompleted && (
                                        <button
                                          onClick={() => runAllTasks(agent.id, "restart")}
                                          disabled={actionLoading}
                                          className="bg-orange-500 hover:bg-orange-600 disabled:bg-gray-300 text-white px-3 py-1 rounded text-xs font-medium transition-colors cursor-pointer"
                                        >
                                          {ta.restartRun || "Restart"}
                                        </button>
                                      )}
                                    </>
                                  );
                                })()}
                                {statusBadge(agent.status, locale)}
                                <button
                                  onClick={() => deactivateAgent(agent.id)}
                                  className="text-xs text-red-400 hover:text-red-600 cursor-pointer"
                                >
                                  {tc.remove}
                                </button>
                              </div>
                            </div>

                            {config.plan && (
                              <div className="mb-3">
                                <p className="text-xs font-medium text-gray-500 mb-1">
                                  {ta.planLabel}
                                </p>
                                <p className="text-sm text-gray-600">
                                  {config.plan}
                                </p>
                              </div>
                            )}

                            <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                              <div>
                                <p className="text-xs font-medium text-gray-500 mb-1">
                                  {ta.modelLabel || "Model"}
                                </p>
                                <p className="text-xs text-gray-400">
                                  {ta.modelHint ||
                                    "Choose which model this AI employee should use for future tasks."}
                                </p>
                              </div>
                              <select
                                value={
                                  agentModels[agent.id] ||
                                  config.model ||
                                  "auto"
                                }
                                onChange={(e) =>
                                  updateAgentModel(agent.id, e.target.value)
                                }
                                disabled={savingModelId === agent.id}
                                className="border border-gray-300 rounded-lg px-3 py-2 text-xs text-gray-700 cursor-pointer focus:outline-none focus:ring-2 focus:ring-red-500 min-w-[220px] disabled:opacity-60"
                              >
                                {availableModels.map((model) => (
                                  <option
                                    key={model.id}
                                    value={model.id}
                                    disabled={!model.available}
                                  >
                                    {model.name}
                                    {!model.available
                                      ? ` - ${ta.modelUnavailable || "Unavailable"}`
                                      : ""}
                                  </option>
                                ))}
                              </select>
                            </div>

                            {/* Exclude region for lead prospecting */}
                            {agent.agent_type === "lead_prospecting" && (
                              <div className="mb-3 p-3 bg-gray-50 rounded-lg border border-gray-200">
                                <p className="text-xs font-medium text-gray-500 mb-2">{locale === "zh" || locale === "zh-TW" ? "目标地区设置" : "Region Settings"}</p>
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                  <div>
                                    <label className="text-[10px] text-gray-500">{locale === "zh" || locale === "zh-TW" ? "重点推广地区" : "Include Regions"}</label>
                                    <input
                                      type="text"
                                      placeholder={locale === "zh" || locale === "zh-TW" ? "例如: United States, Europe" : "e.g. United States, Europe"}
                                      defaultValue={(config.include_regions as string) || "United States, Europe"}
                                      onBlur={(e) => {
                                        const val = e.target.value.trim();
                                        if (val !== ((config.include_regions as string) || "United States, Europe")) {
                                          fetch("/api/projects", {
                                            method: "POST",
                                            headers: { "Content-Type": "application/json" },
                                            body: JSON.stringify({ action: "update_agent_config", agent_id: agent.id, config: { include_regions: val || null } }),
                                          }).then(() => loadData());
                                        }
                                      }}
                                      className="w-full border border-gray-300 rounded-md px-3 py-1.5 text-xs mt-0.5"
                                    />
                                  </div>
                                  <div>
                                    <label className="text-[10px] text-gray-500">{locale === "zh" || locale === "zh-TW" ? "排除地区" : "Exclude Regions"}</label>
                                    <input
                                      type="text"
                                      placeholder={locale === "zh" || locale === "zh-TW" ? "例如: China, Russia" : "e.g. China, Russia"}
                                      defaultValue={(config.exclude_regions as string) || "China"}
                                      onBlur={(e) => {
                                        const val = e.target.value.trim();
                                        if (val !== ((config.exclude_regions as string) || "China")) {
                                          fetch("/api/projects", {
                                            method: "POST",
                                            headers: { "Content-Type": "application/json" },
                                            body: JSON.stringify({ action: "update_agent_config", agent_id: agent.id, config: { exclude_regions: val || null } }),
                                          }).then(() => loadData());
                                        }
                                      }}
                                      className="w-full border border-gray-300 rounded-md px-3 py-1.5 text-xs mt-0.5"
                                    />
                                  </div>
                                </div>
                                <p className="text-[10px] text-gray-400 mt-1">{locale === "zh" || locale === "zh-TW" ? "搜索潜在客户时优先目标地区，排除指定地区的公司" : "Prioritize target regions and skip excluded regions when searching leads."}</p>
                              </div>
                            )}

                            {/* Sender config for email/sales agents */}
                            {(agent.agent_type === "email_marketing" || agent.agent_type === "sales_followup") && (
                              <div className="mb-3 p-3 bg-gray-50 rounded-lg border border-gray-200">
                                <p className="text-xs font-medium text-gray-500 mb-2">{ta.senderConfig || "Sender Configuration"}</p>
                                <div className="flex flex-col sm:flex-row gap-2">
                                  <input
                                    type="email"
                                    placeholder={ta.senderEmailPlaceholder || "Sender email (e.g. hello@company.com)"}
                                    defaultValue={(config.sender_email as string) || ""}
                                    onBlur={(e) => {
                                      const val = e.target.value.trim();
                                      if (val !== ((config.sender_email as string) || "")) {
                                        fetch("/api/projects", {
                                          method: "POST",
                                          headers: { "Content-Type": "application/json" },
                                          body: JSON.stringify({ action: "update_agent_config", agent_id: agent.id, config: { sender_email: val || null } }),
                                        }).then(() => loadData());
                                      }
                                    }}
                                    className="flex-1 border border-gray-300 rounded-md px-3 py-1.5 text-xs"
                                  />
                                  <input
                                    type="text"
                                    placeholder={ta.senderNamePlaceholder || "Sender name (e.g. Marketing Team)"}
                                    defaultValue={(config.sender_name as string) || ""}
                                    onBlur={(e) => {
                                      const val = e.target.value.trim();
                                      if (val !== ((config.sender_name as string) || "")) {
                                        fetch("/api/projects", {
                                          method: "POST",
                                          headers: { "Content-Type": "application/json" },
                                          body: JSON.stringify({ action: "update_agent_config", agent_id: agent.id, config: { sender_name: val || null } }),
                                        }).then(() => loadData());
                                      }
                                    }}
                                    className="flex-1 border border-gray-300 rounded-md px-3 py-1.5 text-xs"
                                  />
                                </div>
                                <p className="text-[10px] text-gray-400 mt-1">{ta.senderConfigHint || "Must be a verified sender in your email provider (Brevo/SendGrid). Leave empty to use project owner email."}</p>
                                <div className="mt-2">
                                  <label className="text-[10px] text-gray-500 font-medium">{ta.targetLanguage || "Target Language"}</label>
                                  <select
                                    defaultValue={(config.locale as string) || locale}
                                    onChange={(e) => {
                                      fetch("/api/projects", {
                                        method: "POST",
                                        headers: { "Content-Type": "application/json" },
                                        body: JSON.stringify({ action: "update_agent_config", agent_id: agent.id, config: { locale: e.target.value } }),
                                      }).then(() => loadData());
                                    }}
                                    className="mt-0.5 w-full sm:w-auto border border-gray-300 rounded-md px-3 py-1.5 text-xs cursor-pointer"
                                  >
                                    <option value="en">English</option>
                                    <option value="zh">简体中文</option>
                                    <option value="zh-TW">繁體中文</option>
                                    <option value="fr">Français</option>
                                    <option value="ja">日本語</option>
                                    <option value="ko">한국어</option>
                                    <option value="es">Español</option>
                                    <option value="de">Deutsch</option>
                                  </select>
                                  <p className="text-[10px] text-gray-400 mt-0.5">{ta.targetLanguageHint || "Language used for email templates and outreach content."}</p>
                                </div>
                              </div>
                            )}

                            {tasks.length > 0 && (
                              <div className="mb-3">
                                <div className="flex items-center justify-between text-xs text-gray-500 mb-1">
                                  <span className="font-medium">
                                    {ta.executionProgress}
                                  </span>
                                  <span>
                                    {completedTasks}/{tasks.length} {ta.tasks} (
                                    {progress}%)
                                  </span>
                                </div>
                                <div className="w-full bg-gray-100 rounded-full h-2">
                                  <div
                                    className="bg-red-500 h-2 rounded-full transition-all"
                                    style={{
                                      width: `${Math.max(progress, inProgressTasks > 0 ? 8 : 0)}%`,
                                    }}
                                  />
                                </div>
                              </div>
                            )}

                            {/* Failure / Status Diagnostics */}
                            {tasks.length > 0 && (() => {
                              const issues: { type: "error" | "warn" | "info"; msg: string }[] = [];

                              // Detect unsupported agent type
                              const unsupported = tasks.find((t: { result?: string }) => t.result && String(t.result).includes("not yet supported"));
                              if (unsupported) {
                                issues.push({ type: "error", msg: ta.diagUnsupported || `Agent type "${agent.agent_type}" is not yet supported. Tasks cannot execute.` });
                              }

                              // Detect no provider
                              const noProvider = tasks.find((t: { result?: string }) => t.result && String(t.result).includes("No email provider configured"));
                              if (noProvider) {
                                issues.push({ type: "error", msg: ta.diagNoProvider || "No email provider (Brevo/SendGrid) configured. Add API keys in Settings → BYOK." });
                              }

                              // Detect no template
                              const noTemplate = tasks.find((t: { result?: string }) => t.result && String(t.result).includes("Could not parse email template"));
                              if (noTemplate) {
                                issues.push({ type: "error", msg: ta.diagNoTemplate || "Email template missing or invalid. Re-run the Email Templates task." });
                              }

                              // Detect throttle
                              const throttled = tasks.find((t: { result?: string }) => t.result && String(t.result).includes("Throttled:"));
                              if (throttled) {
                                const match = String(throttled.result).match(/last batch sent ([\d.]+)h ago \(min interval: (\d+)h\)/);
                                const msg = match
                                  ? (ta.diagThrottled || "Sending throttled: last batch {ago}h ago, next batch in ~{wait}h.").replace("{ago}", match[1]).replace("{wait}", String(Math.max(0.1, Number(match[2]) - Number(match[1])).toFixed(1)))
                                  : (ta.diagThrottledGeneric || "Sending throttled. Will auto-retry next cron cycle.");
                                issues.push({ type: "info", msg });
                              }

                              // Detect daily cap
                              const capped = tasks.find((t: { result?: string }) => t.result && String(t.result).includes("Daily send cap reached"));
                              if (capped) {
                                issues.push({ type: "info", msg: ta.diagDailyCap || "Daily send cap reached. Will resume tomorrow." });
                              }

                              // Detect no unsent leads
                              const noLeads = tasks.find((t: { result?: string }) => t.result && String(t.result).includes("No unsent leads found"));
                              if (noLeads) {
                                issues.push({ type: "info", msg: ta.diagNoLeads || "All leads have been emailed. Add more leads or run Lead Prospecting." });
                              }

                              // Detect stuck in_progress (task in_progress but no active run)
                              const stuckTask = tasks.find((t: { status: string }, idx: number) =>
                                t.status === "in_progress" && !(runningTask?.agentId === agent.id && (runningTask.taskIndex === idx || runningTask.taskIndex === -1))
                              );
                              if (stuckTask && !unsupported) {
                                issues.push({ type: "warn", msg: ta.diagStuck || "A task appears stuck in progress. Try running it manually or restart." });
                              }

                              // Blockers
                              if (config.blockers && (config.blockers as string[]).length > 0) {
                                for (const b of config.blockers as string[]) {
                                  issues.push({ type: "warn", msg: b });
                                }
                              }

                              if (issues.length === 0) return null;

                              const colors = { error: "bg-red-50 border-red-200 text-red-700", warn: "bg-yellow-50 border-yellow-200 text-yellow-700", info: "bg-blue-50 border-blue-200 text-blue-700" };
                              const icons = { error: "\u26D4", warn: "\u26A0\uFE0F", info: "\u2139\uFE0F" };

                              return (
                                <div className="mb-3 space-y-1.5">
                                  {issues.map((issue, idx) => (
                                    <div key={idx} className={`flex items-start gap-2 text-xs px-3 py-2 rounded-lg border ${colors[issue.type]}`}>
                                      <span className="flex-shrink-0">{icons[issue.type]}</span>
                                      <span>{issue.msg}</span>
                                    </div>
                                  ))}
                                </div>
                              );
                            })()}

                            {tasks.length > 0 && (
                              <div className="mb-3">
                                <p className="text-xs font-medium text-gray-500 mb-2">
                                  {ta.tasksLabel}
                                </p>
                                <div className="space-y-1">
                                  {tasks.map((task, i) => {
                                    const taskKey = `${agent.id}-${i}`;
                                    const isExpanded = expandedTasks[taskKey];
                                    const reports = taskReports[agent.id] || [];
                                    // Match report to task by task_index in metrics (precise), fallback to name matching
                                    const matchedReport =
                                      reports.find((r) => r.metrics?.task_index === i) ||
                                      reports.find((r) => {
                                        if (r.metrics?.task_index !== undefined) return false; // already indexed, skip fuzzy
                                        const rName = r.task_name.toLowerCase();
                                        const tName = task.name.toLowerCase();
                                        return rName === tName
                                          || tName.includes(rName)
                                          || rName.includes(tName);
                                      });
                                    const isThisTaskRunning =
                                      runningTask?.agentId === agent.id &&
                                      (runningTask.taskIndex === i ||
                                        runningTask.taskIndex === -1);

                                    return (
                                      <div key={i}>
                                        <div className="flex items-start gap-2 text-xs">
                                          <span className="mt-0.5 flex-shrink-0">
                                            {isThisTaskRunning ? (
                                              <span className="text-yellow-500 animate-spin inline-block">
                                                &#9696;
                                              </span>
                                            ) : task.status === "completed" || task.status === "recurring" ? (
                                              <span className="text-green-500">
                                                &#10003;
                                              </span>
                                            ) : task.status ===
                                              "in_progress" ? (
                                              <span className="text-red-500">
                                                &#9679;
                                              </span>
                                            ) : (
                                              <span className="text-gray-300">
                                                &#9675;
                                              </span>
                                            )}
                                          </span>
                                          <span
                                            className={`flex-1 ${task.status === "completed" || task.status === "recurring" ? "text-gray-400 line-through" : task.status === "in_progress" ? "text-gray-700 font-medium" : "text-gray-500"}`}
                                          >
                                            {translateTask(task.name)}
                                            {isThisTaskRunning && (
                                              <RunningTimer
                                                startedAt={
                                                  runningTask!.startedAt
                                                }
                                              />
                                            )}
                                            {task.status === "completed" && (
                                                <span className="ml-1 no-underline inline-block px-1.5 py-0 rounded bg-purple-50 text-purple-600 text-[10px] font-medium" style={{ textDecoration: 'none' }}>
                                                  {(() => {
                                                    // Resolve actual model: task stamp > report metrics > fallback
                                                    const modelUsed = task.model_used || String(matchedReport?.metrics?.model_used || "");
                                                    const useMode = task.use_mode || String(matchedReport?.metrics?.preferred_model || config.model || "auto");
                                                    if (modelUsed && modelUsed !== "none" && modelUsed !== "auto") {
                                                      return `${modelUsed} (${useMode})`;
                                                    }
                                                    if (modelUsed === "none") {
                                                      return ta.noModel;
                                                    }
                                                    return useMode;
                                                  })()}
                                                </span>
                                              )}
                                          </span>
                                          {task.status === "completed" && (
                                              <button
                                                onClick={() =>
                                                  toggleTaskDetail(agent.id, i)
                                                }
                                                className="text-xs text-blue-500 hover:text-blue-700 font-medium whitespace-nowrap cursor-pointer"
                                              >
                                                {isExpanded ? ta.logHide : ta.logShow}
                                              </button>
                                            )}
                                          {!isThisTaskRunning && (
                                            <button
                                              onClick={() =>
                                                executeTask(agent.id, i)
                                              }
                                              disabled={actionLoading}
                                              className="text-xs text-green-500 hover:text-green-700 font-medium whitespace-nowrap cursor-pointer"
                                            >
                                              {tc.run}
                                            </button>
                                          )}
                                        </div>
                                        {/* Real-time step log (thinking process) */}
                                        {(isThisTaskRunning || task.status === "in_progress") && (
                                          <StepLog agentId={agent.id} taskIndex={i} isRunning={isThisTaskRunning} locale={locale} />
                                        )}
                                        {isExpanded && (
                                          <div className="ml-6 mt-1 mb-2 bg-gray-50 border border-gray-100 rounded-md p-2">
                                            <div className="flex items-center justify-between mb-2">
                                              <div className="flex items-center gap-2 text-xs">
                                                <span className="text-gray-400">{ta.modelUsedLabel}</span>
                                                <span className="px-1.5 py-0.5 rounded bg-purple-50 text-purple-600 font-medium">
                                                  {(() => {
                                                    const m = task.model_used || String(matchedReport?.metrics?.model_used || "");
                                                    return m === "none" ? ta.noModel : (m || config.model || "auto");
                                                  })()}
                                                </span>
                                                <span className="text-gray-400">{ta.useModeLabel}</span>
                                                <span className="px-1.5 py-0.5 rounded bg-gray-100 text-gray-600 font-medium">
                                                  {task.use_mode || String(matchedReport?.metrics?.preferred_model || config.model || "auto")}
                                                </span>
                                              </div>
                                              <button
                                                onClick={() => {
                                                  const text = [
                                                    task.result ? String(task.result) : "",
                                                    matchedReport ? stringifyResult(matchedReport.metrics) : "",
                                                  ].filter(Boolean).join("\n\n");
                                                  navigator.clipboard.writeText(text);
                                                }}
                                                className="text-xs text-gray-400 hover:text-gray-600 cursor-pointer px-1.5 py-0.5 rounded hover:bg-gray-200 transition-colors"
                                                title="Copy"
                                              >
                                                {dict.settings.copy}
                                              </button>
                                            </div>
                                            {task.result && (
                                              <div className="select-text">
                                                <MarkdownResult
                                                  content={String(task.result)}
                                                />
                                              </div>
                                            )}
                                            {matchedReport && (
                                              <div className="text-xs text-gray-600 max-h-60 overflow-y-auto bg-white rounded p-2 mt-1 select-text">
                                                <div className="mb-1 font-medium">
                                                  {ta.metricsLabel}
                                                </div>
                                                <MarkdownResult
                                                  content={stringifyResult(
                                                    matchedReport.metrics,
                                                  )}
                                                />
                                              </div>
                                            )}
                                            {!task.result && !matchedReport && (
                                              <p className="text-xs text-gray-400">{ta.noModel}</p>
                                            )}
                                          </div>
                                        )}
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>
                            )}

                            {blockers.length > 0 && (
                              <div className="bg-red-50 border border-red-100 rounded-md p-3">
                                <p className="text-xs font-medium text-red-600 mb-1">
                                  {ta.blockers}
                                </p>
                                <ul className="text-xs text-red-500 space-y-1">
                                  {blockers.map((b, i) => (
                                    <li
                                      key={i}
                                      className="flex items-center justify-between gap-2"
                                    >
                                      <div className="flex items-start gap-1.5">
                                        <span className="mt-0.5 flex-shrink-0">
                                          !
                                        </span>
                                        <span>{b}</span>
                                      </div>
                                      <button
                                        onClick={() =>
                                          resolveBlocker(agent.id, i, b)
                                        }
                                        disabled={actionLoading}
                                        className="text-xs text-red-500 hover:text-red-700 font-medium whitespace-nowrap cursor-pointer"
                                      >
                                        {tc.resolve}
                                      </button>
                                    </li>
                                  ))}
                                </ul>
                              </div>
                            )}

                            {/* Task execution error */}
                            {taskResult[agent.id]?.error && (
                                <div className="mt-3 rounded-md p-3 bg-red-50 border border-red-100">
                                  <div className="flex items-center justify-between mb-1">
                                    <p className="text-xs font-medium text-red-600">
                                      {ta.taskFailed}
                                    </p>
                                    <button
                                      onClick={() =>
                                        setTaskResult((prev) => {
                                          const n = { ...prev };
                                          delete n[agent.id];
                                          return n;
                                        })
                                      }
                                      className="text-xs text-gray-400 hover:text-gray-600 cursor-pointer"
                                    >
                                      &times;
                                    </button>
                                  </div>
                                  <div className="text-xs text-red-500">
                                    <MarkdownResult
                                      content={String(taskResult[agent.id].error)}
                                    />
                                  </div>
                                </div>
                              )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}

            {/* Server Agents (OpenClaw cron jobs) */}
            <section className="mt-8">
              <div className="mb-4">
                <h2 className="text-lg font-semibold">{ta.serverAgents}</h2>
                <p className="text-xs text-gray-400 mt-1">
                  {ta.serverAgentsDesc}
                </p>
              </div>
              {serverAgents.length === 0 ? (
                <div className="bg-white rounded-lg border border-gray-200 p-6 text-center">
                  <p className="text-gray-500 text-sm">{ta.noServerAgents}</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {serverAgents.map((sa) => {
                    const statusColors: Record<string, string> = {
                      active: "bg-green-100 text-green-700",
                      pending: "bg-blue-100 text-blue-700",
                      paused: "bg-yellow-100 text-yellow-700",
                      completed: "bg-gray-100 text-gray-600",
                    };
                    const categoryLabels: Record<
                      string,
                      Record<string, string>
                    > = {
                      en: {
                        lead_generation: "Lead Gen",
                        email_marketing: "Email",
                        seo: "SEO",
                        social_media: "Social",
                        monitoring: "Monitor",
                        project_mgmt: "PM",
                        engineering: "Eng",
                        sales: "Sales",
                        other: "Other",
                      },
                      zh: {
                        lead_generation: "潜在客户",
                        email_marketing: "邮件",
                        seo: "SEO",
                        social_media: "社交",
                        monitoring: "监控",
                        project_mgmt: "项目",
                        engineering: "工程",
                        sales: "销售",
                        other: "其他",
                      },
                    };
                    const catLabel =
                      categoryLabels[locale]?.[sa.period] ||
                      categoryLabels.en[sa.period] ||
                      sa.period;
                    const metricEntries = Object.entries(
                      sa.metrics || {},
                    ).filter(([, v]) => v !== 0 && v !== "0");
                    const statusLabels: Record<
                      string,
                      Record<string, string>
                    > = {
                      en: {
                        active: "active",
                        pending: "pending",
                        paused: "paused",
                        completed: "completed",
                      },
                      zh: {
                        active: "运行正常",
                        pending: "待运行",
                        paused: "已暂停",
                        completed: "已完成",
                      },
                    };
                    const metricLabels: Record<
                      string,
                      Record<string, string>
                    > = {
                      en: {
                        emails_sent: "Sent",
                        delivered: "Delivered",
                        opened: "Opened",
                        clicked: "Clicked",
                        contacts_found: "Contacts",
                        articles: "Articles",
                        backlinks: "Backlinks",
                        duration_sec: "Duration(s)",
                        errors: "Errors",
                      },
                      zh: {
                        emails_sent: "已发送",
                        delivered: "已送达",
                        opened: "已打开",
                        clicked: "已点击",
                        contacts_found: "联系人",
                        articles: "文章",
                        backlinks: "外链",
                        duration_sec: "耗时(秒)",
                        errors: "错误",
                      },
                    };
                    return (
                      <div
                        key={sa.id}
                        className="bg-white rounded-lg border border-gray-200 px-4 py-3"
                      >
                        <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="font-medium text-sm truncate">
                                {sa.agent
                                  .replace(/-/g, " ")
                                  .replace(/\b\w/g, (c) => c.toUpperCase())}
                              </span>
                              <span
                                className={`px-2 py-0.5 rounded-full text-xs font-medium ${statusColors[sa.status] || "bg-gray-100 text-gray-600"}`}
                              >
                                {statusLabels[locale]?.[sa.status] || sa.status}
                              </span>
                            </div>
                            <div className="flex items-center gap-3 mt-1 text-xs text-gray-400">
                              <span>{sa.project}</span>
                              <span className="bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded">
                                {catLabel}
                              </span>
                              {sa.last_run ? (
                                <span>
                                  {ta.lastRunAt}:{" "}
                                  {new Date(sa.last_run).toLocaleString(
                                    locale === "zh" ? "zh-CN" : "en-US",
                                  )}
                                </span>
                              ) : (
                                <span className="italic">
                                  {locale === "zh"
                                    ? "等待首次运行"
                                    : "Awaiting first run"}
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                        {sa.summary && (
                          <p className="text-xs text-gray-500 mt-2">
                            {sa.summary}
                          </p>
                        )}
                        {metricEntries.length > 0 && (
                          <div className="flex flex-wrap gap-2 mt-2">
                            {metricEntries.map(([key, value]) => (
                              <span
                                key={key}
                                className="bg-gray-50 px-2 py-1 rounded text-xs"
                              >
                                <span className="text-gray-400">
                                  {metricLabels[locale]?.[key] ||
                                    metricLabels.en[key] ||
                                    key.replace(/_/g, " ")}
                                  :
                                </span>{" "}
                                <span className="font-medium text-gray-700">
                                  {typeof value === "number"
                                    ? value.toLocaleString()
                                    : value}
                                </span>
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </section>

            {/* Recent Activity Log */}
            <ActivityLog locale={locale} ta={ta} />
          </>
        )}
      </div>
    </DashboardShell>
  );
}

interface ActivityItem {
  task_name: string;
  summary: string;
  agent_type: string;
  project: string;
  metrics: Record<string, string | number>;
  created_at: string;
}

const AGENT_TYPE_ICONS: Record<string, string> = {
  email_marketing: "📧",
  seo_content: "📝",
  lead_prospecting: "👥",
  social_media: "📱",
  product_manager: "📊",
  sales_followup: "🤝",
  orchestrator: "🎯",
};

function timeAgo(dateStr: string, ta: Record<string, string>): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffMs = now - then;
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return `<1 ${ta.minutesAgo}`;
  if (diffMin < 60) return `${diffMin} ${ta.minutesAgo}`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr} ${ta.hoursAgo}`;
  const diffDays = Math.floor(diffHr / 24);
  return `${diffDays} ${ta.daysAgo}`;
}

function ActivityLog({ locale, ta }: { locale: string; ta: Record<string, string> }) {
  const [activities, setActivities] = useState<ActivityItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(true);

  useEffect(() => {
    fetch("/api/agent-reports?mode=activities&limit=30")
      .then((r) => r.json())
      .then((data) => setActivities(data.activities || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const agentLabel = (type: string) => {
    const map: Record<string, string> = {
      email_marketing: ta.emailMarketing || "Email Marketing",
      seo_content: ta.seoContent || "SEO & Content",
      lead_prospecting: ta.leadProspecting || "Lead Prospecting",
      social_media: ta.socialMedia || "Social Media",
      product_manager: ta.productManager || "Product Manager",
      sales_followup: ta.salesFollowup || "Sales Follow-up",
      orchestrator: ta.orchestrator || "Orchestrator",
    };
    return map[type] || type;
  };


  return (
    <section className="mb-8">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h2 className="text-lg font-semibold">{ta.recentActivity}</h2>
          <p className="text-xs text-gray-500">{ta.recentActivityDesc}</p>
        </div>
        <button
          onClick={() => setExpanded(!expanded)}
          className="text-xs text-blue-600 hover:underline"
        >
          {expanded ? ta.logHide : ta.logShow}
        </button>
      </div>

      {expanded && (
        <>
          {loading ? (
            <div className="text-sm text-gray-400 py-4">{ta.loadingActivity}</div>
          ) : activities.length === 0 ? (
            <div className="bg-white rounded-lg border border-gray-200 p-6 text-center">
              <p className="text-sm text-gray-500">{ta.noActivity}</p>
              <p className="text-xs text-gray-400 mt-1">{ta.noActivityDesc}</p>
            </div>
          ) : (
            <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
              <div className="overflow-x-auto max-h-[480px] overflow-y-auto">
                <table className="w-full text-sm">
                  <thead className="sticky top-0">
                    <tr className="bg-gray-50 border-b border-gray-200">
                      <th className="text-left px-4 py-2.5 font-medium text-gray-600 w-[140px]">{ta.lastRunAt || "Time"}</th>
                      <th className="text-left px-3 py-2.5 font-medium text-gray-600 w-[130px]">Agent</th>
                      <th className="text-left px-3 py-2.5 font-medium text-gray-600 w-[100px]">{ta.tasksLabel || "Task"}</th>
                      <th className="text-left px-3 py-2.5 font-medium text-gray-600 w-[90px]">{locale === "zh" ? "项目" : "Project"}</th>
                      <th className="text-left px-4 py-2.5 font-medium text-gray-600">{locale === "zh" ? "摘要" : "Summary"}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {activities.map((a, i) => (
                      <tr key={i} className="border-b border-gray-100 hover:bg-gray-50">
                        <td className="px-4 py-2 text-xs text-gray-400 whitespace-nowrap">
                          {timeAgo(a.created_at, ta)}
                        </td>
                        <td className="px-3 py-2 text-xs whitespace-nowrap">
                          <span className="mr-1">{AGENT_TYPE_ICONS[a.agent_type] || "🤖"}</span>
                          {agentLabel(a.agent_type)}
                        </td>
                        <td className="px-3 py-2 text-xs text-gray-600 whitespace-nowrap">
                          {a.task_name}
                        </td>
                        <td className="px-3 py-2 text-xs text-gray-500 whitespace-nowrap">
                          {a.project}
                        </td>
                        <td className="px-4 py-2 text-xs text-gray-700 max-w-[400px] truncate" title={a.summary}>
                          {a.summary}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </section>
  );
}
