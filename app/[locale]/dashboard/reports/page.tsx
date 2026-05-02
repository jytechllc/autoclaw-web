"use client";

import { useUser } from "@auth0/nextjs-auth0/client";
import { useEffect, useRef, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import { getDictionary, type Locale } from "@/lib/i18n";
import DashboardShell from "@/components/DashboardShell";

interface AgentReport {
  id: string;
  agent: string;
  period: string;
  summary: string;
  metrics: Record<string, string | number>;
  status: string;
  project: string;
  last_run: string;
}

interface DailyTraffic {
  date: string;
  users: number;
  sessions: number;
  pageViews: number;
}

interface ProjectTraffic {
  project: string;
  status?: "ok" | "no_data" | "error";
  error?: string;
  data: DailyTraffic[];
}

interface BrevoCampaign {
  id: number;
  name: string;
  status: string;
  sent: number;
  delivered: number;
  opened: number;
  clicked: number;
  project: string;
  sentDate?: string;
}

interface TokenUsageEntry {
  date: string;
  project: string;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

interface TaskStatusByProject {
  project: string;
  pending: number;
  processing: number;
  completed: number;
  total: number;
}

interface DbKpisByProject {
  project: string;
  leadsGenerated: number;
  contentPublished: number;
}

interface BrevoContactsByProject {
  project: string;
  contacts: number;
}

interface ContactAnalytics {
  total: number;
  enriched: number;
  byIndustry: { label: string; count: number }[];
  byCompanySize: { label: string; count: number }[];
  topCompanies: { label: string; count: number }[];
  publicVsPrivate: { public: number; private: number; unknown: number };
  bySource: { label: string; count: number }[];
}

interface MetricsSummary {
  totalTraffic: number;
  emailsSent: number;
  emailsFound: number;
  leadsGenerated: number;
  contentPublished: number;
  tasksCompleted: number;
}

const CHART_COLORS = ["#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899", "#14b8a6"];
const TRAFFIC_FILTER_STORAGE_PREFIX = "reports:traffic:selectedProjects";

function ProjectPieChart({ title, slices, emptyLabel }: { title: string; slices: { label: string; value: number; color: string }[]; emptyLabel?: string }) {
  const total = slices.reduce((sum, s) => sum + s.value, 0);
  if (total <= 0) {
    return (
      <div className="bg-white rounded-lg border border-gray-200 p-4">
        <h3 className="text-sm font-semibold mb-3">{title}</h3>
        <div className="h-56 flex items-center justify-center rounded border border-dashed border-gray-200 text-xs text-gray-400">
          {emptyLabel || "No data yet"}
        </div>
      </div>
    );
  }

  const gradient = slices
    .reduce<{ offset: number; parts: string[] }>(
      (acc, s) => {
        const nextOffset = acc.offset + (s.value / total) * 100;
        return {
          offset: nextOffset,
          parts: [...acc.parts, `${s.color} ${acc.offset}% ${nextOffset}%`],
        };
      },
      { offset: 0, parts: [] }
    )
    .parts.join(", ");

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-4">
      <h3 className="text-sm font-semibold mb-3">{title}</h3>
      <div className="flex items-center gap-4">
        <div
          className="w-56 h-56 rounded-full shrink-0 border border-gray-200"
          style={{ backgroundImage: `conic-gradient(${gradient})` }}
          title={`${title}: ${total.toLocaleString()}`}
        />
        <div className="min-w-0 flex-1 space-y-1.5">
          {slices.map((s) => (
            <div key={s.label} className="flex items-center justify-between gap-2 text-xs">
              <span className="inline-flex items-center gap-1.5 text-gray-600 min-w-0">
                <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: s.color }} />
                <span className="truncate">{s.label}</span>
              </span>
              <span className="text-gray-800 font-medium">{s.value.toLocaleString()}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function CombinedTrafficChart({ projects, locale, colorMap }: { projects: ProjectTraffic[]; locale: string; colorMap?: Record<string, string> }) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [hoveredProject, setHoveredProject] = useState<string | null>(null);
  const [tooltip, setTooltip] = useState<{ x: number; y: number; project: string; date: string; val: number } | null>(null);

  if (projects.length === 0) return null;

  const allDates = new Set<string>();
  for (const p of projects) for (const d of p.data) allDates.add(d.date);
  const dates = Array.from(allDates).sort();
  if (dates.length === 0) return null;

  const projectLines = projects.map((p, idx) => {
    const lookup: Record<string, number> = {};
    for (const d of p.data) lookup[d.date] = d.pageViews;
    const color = colorMap?.[p.project] || CHART_COLORS[idx % CHART_COLORS.length];
    return { name: p.project, color, lookup };
  });

  const maxVal = Math.max(...projects.flatMap((p) => p.data.map((d) => d.pageViews)), 1);
  const W = 700;
  const H = 220;
  const padL = 40;
  const padR = 10;
  const padT = 10;
  const padB = 30;
  const chartW = W - padL - padR;
  const chartH = H - padT - padB;

  const xFor = (i: number) => padL + (i / Math.max(dates.length - 1, 1)) * chartW;
  const yFor = (v: number) => padT + chartH - (v / maxVal) * chartH;

  const yTicks = [0, Math.round(maxVal / 2), maxVal];
  const step = Math.max(1, Math.floor(dates.length / 6));
  const xLabelIndices = dates.map((_, i) => i).filter((i) => i % step === 0 || i === dates.length - 1);

  const cDict = getDictionary((locale || "en") as Locale).reportsPage;
  const pvLabel = cDict.pageViews;
  const chartTitle = cDict.dailyTrafficTrend;

  const handleDotHover = (e: React.MouseEvent<SVGCircleElement>, project: string, date: string, val: number) => {
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    setTooltip({ x, y, project, date, val });
    setHoveredProject(project);
  };

  const handleLineHover = (project: string) => {
    setHoveredProject(project);
  };

  const handleChartLeave = () => {
    setTooltip(null);
    setHoveredProject(null);
  };

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-4 sm:p-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-3">
        <h3 className="font-semibold text-sm shrink-0">{chartTitle}</h3>
        <div className="overflow-x-auto min-w-0">
          <div className="flex gap-3 whitespace-nowrap">
            {projectLines.map((pl) => (
              <div
                key={pl.name}
                className="flex items-center gap-1.5 cursor-pointer transition-opacity shrink-0"
                style={{ opacity: hoveredProject && hoveredProject !== pl.name ? 0.35 : 1 }}
                onMouseEnter={() => setHoveredProject(pl.name)}
                onMouseLeave={() => setHoveredProject(null)}
              >
                <span className="inline-block w-3 h-[3px] rounded" style={{ backgroundColor: pl.color }} />
                <span className="text-xs text-gray-500">{pl.name}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="overflow-x-auto relative" onMouseLeave={handleChartLeave}>
        <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} className="w-full min-w-[500px]" style={{ maxHeight: 240 }}>
          <defs>
            {projectLines.map((pl) => (
              <linearGradient key={pl.name} id={`grad_${pl.name.replace(/\s/g, "_")}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={pl.color} stopOpacity={0.25} />
                <stop offset="100%" stopColor={pl.color} stopOpacity={0.03} />
              </linearGradient>
            ))}
          </defs>
          {/* Grid lines */}
          {yTicks.map((tick) => {
            const y = yFor(tick);
            return (
              <g key={tick}>
                <line x1={padL} y1={y} x2={W - padR} y2={y} stroke="#e5e7eb" strokeWidth={0.5} />
                <text x={padL - 4} y={y + 3} textAnchor="end" fontSize={9} fill="#9ca3af">{tick}</text>
              </g>
            );
          })}
          {/* Per-project area + line + dots */}
          {projectLines.map((pl) => {
            const isHovered = hoveredProject === pl.name;
            const isDimmed = hoveredProject !== null && !isHovered;
            const pts = dates.map((d, i) => ({ x: xFor(i), y: yFor(pl.lookup[d] || 0), val: pl.lookup[d] || 0, date: d }));
            const linePath = pts.map((p, i) => `${i === 0 ? "M" : "L"}${p.x},${p.y}`).join(" ");
            const areaPath = `${linePath} L${pts[pts.length - 1].x},${yFor(0)} L${pts[0].x},${yFor(0)} Z`;
            const gradId = `grad_${pl.name.replace(/\s/g, "_")}`;
            return (
              <g
                key={pl.name}
                style={{ opacity: isDimmed ? 0.15 : 1, transition: "opacity 0.2s" }}
                onMouseEnter={() => handleLineHover(pl.name)}
                onMouseLeave={() => { setHoveredProject(null); setTooltip(null); }}
              >
                <path d={areaPath} fill={`url(#${gradId})`} />
                {/* Invisible wider stroke for easier hover targeting */}
                <path d={linePath} fill="none" stroke="transparent" strokeWidth={12} style={{ cursor: "pointer" }} />
                <path d={linePath} fill="none" stroke={pl.color} strokeWidth={isHovered ? 3 : 2} style={{ transition: "stroke-width 0.2s" }} />
                {pts.map((p, i) => (
                  <circle
                    key={i}
                    cx={p.x}
                    cy={p.y}
                    r={isHovered ? 4 : 2}
                    fill={pl.color}
                    stroke="white"
                    strokeWidth={isHovered ? 1.5 : 0.8}
                    style={{ cursor: "pointer", transition: "r 0.2s" }}
                    onMouseEnter={(e) => handleDotHover(e, pl.name, p.date, p.val)}
                    onMouseLeave={() => setTooltip(null)}
                  />
                ))}
              </g>
            );
          })}
          {/* X labels */}
          {xLabelIndices.map((i) => (
            <text key={dates[i]} x={xFor(i)} y={H - 5} textAnchor="middle" fontSize={9} fill="#9ca3af">{dates[i].slice(5)}</text>
          ))}
        </svg>
        {/* Custom tooltip */}
        {tooltip && (
          <div
            className="absolute pointer-events-none z-10 bg-gray-800 text-white text-xs rounded-lg px-3 py-2 shadow-lg"
            style={{
              left: tooltip.x,
              top: tooltip.y - 50,
              transform: "translateX(-50%)",
              whiteSpace: "nowrap",
            }}
          >
            <div className="font-semibold flex items-center gap-1.5">
              <span
                className="inline-block w-2 h-2 rounded-full"
                style={{ backgroundColor: projectLines.find((pl) => pl.name === tooltip.project)?.color }}
              />
              {tooltip.project}
            </div>
            <div className="text-gray-300 mt-0.5">{tooltip.date}: <span className="text-white font-medium">{tooltip.val.toLocaleString()}</span> {pvLabel}</div>
          </div>
        )}
      </div>
    </div>
  );
}

function TokenUsageChart({ data, locale }: { data: TokenUsageEntry[]; locale: string }) {
  if (data.length === 0) return null;

  // Aggregate by date (stacked: prompt vs completion)
  const byDate: Record<string, { prompt: number; completion: number }> = {};
  for (const d of data) {
    if (!byDate[d.date]) byDate[d.date] = { prompt: 0, completion: 0 };
    byDate[d.date].prompt += d.prompt_tokens;
    byDate[d.date].completion += d.completion_tokens;
  }
  const dates = Object.keys(byDate).sort();
  if (dates.length === 0) return null;

  const maxVal = Math.max(...dates.map((d) => byDate[d].prompt + byDate[d].completion), 1);
  const W = 700, H = 220, padL = 50, padR = 10, padT = 10, padB = 30;
  const chartW = W - padL - padR, chartH = H - padT - padB;
  const barW = Math.max(4, Math.min(20, chartW / dates.length - 2));
  const xFor = (i: number) => padL + (i + 0.5) * (chartW / dates.length);
  const yFor = (v: number) => padT + chartH - (v / maxVal) * chartH;

  const yTicks = [0, Math.round(maxVal / 2), maxVal];
  const step = Math.max(1, Math.floor(dates.length / 6));
  const xLabelIndices = dates.map((_, i) => i).filter((i) => i % step === 0 || i === dates.length - 1);
  const fmtNum = (n: number) => n >= 1000000 ? (n / 1000000).toFixed(1) + "M" : n >= 1000 ? (n / 1000).toFixed(0) + "K" : String(n);

  const tDict = getDictionary((locale || "en") as Locale).reportsPage;
  const chartTitle = tDict.tokenUsageTrend;
  const promptLabel = tDict.promptTokens;
  const completionLabel = tDict.completionTokens;

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-4 sm:p-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-3">
        <h3 className="font-semibold text-sm">{chartTitle}</h3>
        <div className="flex gap-3">
          <div className="flex items-center gap-1.5">
            <span className="inline-block w-3 h-3 rounded-sm" style={{ backgroundColor: "#6366f1" }} />
            <span className="text-xs text-gray-500">{promptLabel}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="inline-block w-3 h-3 rounded-sm" style={{ backgroundColor: "#a78bfa" }} />
            <span className="text-xs text-gray-500">{completionLabel}</span>
          </div>
        </div>
      </div>
      <div className="overflow-x-auto">
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full min-w-[500px]" style={{ maxHeight: 240 }}>
          {yTicks.map((tick) => (
            <g key={tick}>
              <line x1={padL} y1={yFor(tick)} x2={W - padR} y2={yFor(tick)} stroke="#e5e7eb" strokeWidth={0.5} />
              <text x={padL - 4} y={yFor(tick) + 3} textAnchor="end" fontSize={9} fill="#9ca3af">{fmtNum(tick)}</text>
            </g>
          ))}
          {dates.map((d, i) => {
            const p = byDate[d].prompt;
            const c = byDate[d].completion;
            const total = p + c;
            const x = xFor(i) - barW / 2;
            return (
              <g key={d}>
                <rect x={x} y={yFor(total)} width={barW} height={yFor(0) - yFor(total)} fill="#6366f1" rx={1}>
                  <title>{`${d}: ${fmtNum(p)} ${promptLabel}`}</title>
                </rect>
                <rect x={x} y={yFor(c)} width={barW} height={yFor(0) - yFor(c)} fill="#a78bfa" rx={1}>
                  <title>{`${d}: ${fmtNum(c)} ${completionLabel}`}</title>
                </rect>
              </g>
            );
          })}
          {xLabelIndices.map((i) => (
            <text key={dates[i]} x={xFor(i)} y={H - 5} textAnchor="middle" fontSize={9} fill="#9ca3af">{dates[i].slice(5)}</text>
          ))}
        </svg>
      </div>
    </div>
  );
}

const STATUS_LABELS: Record<string, Record<string, string>> = {
  en: { active: "active", pending: "pending", paused: "paused", completed: "completed", unknown: "unknown" },
  zh: { active: "运行正常", pending: "待运行", paused: "已暂停", completed: "已完成", unknown: "未知" },
};

const CATEGORY_LABELS: Record<string, Record<string, string>> = {
  en: {
    engineering: "Engineering", lead_generation: "Lead Generation", email_marketing: "Email Marketing",
    seo: "SEO", social_media: "Social Media", monitoring: "Monitoring", project_mgmt: "Project Mgmt",
    product: "Product", marketing: "Marketing", sales: "Sales", advertising: "Advertising",
    research: "Research", other: "Other",
  },
  zh: {
    engineering: "工程", lead_generation: "潜在客户开发", email_marketing: "邮件营销",
    seo: "SEO 优化", social_media: "社交媒体", monitoring: "监控", project_mgmt: "项目管理",
    product: "产品", marketing: "营销", sales: "销售", advertising: "广告",
    research: "研究", other: "其他",
  },
};

const METRIC_LABELS: Record<string, Record<string, string>> = {
  en: {
    leads: "leads", emails_sent: "emails sent", contacts_found: "contacts found", tweets: "tweets",
    posts_published: "posts published", articles: "articles", prs_created: "PRs created",
    subscribers: "subscribers", crm_leads: "CRM leads", uptime_pct: "uptime %",
    tasks_completed: "tasks completed", issues: "issues", duration_sec: "duration (s)", errors: "errors",
    sales: "sales",
  },
  zh: {
    leads: "潜在客户", emails_sent: "已发邮件", contacts_found: "已找到联系人", tweets: "推文",
    posts_published: "已发布文章", articles: "文章", prs_created: "已创建 PR",
    subscribers: "订阅者", crm_leads: "CRM 潜在客户", uptime_pct: "运行时间 %",
    tasks_completed: "已完成任务", issues: "问题", duration_sec: "耗时（秒）", errors: "错误",
    sales: "销售",
  },
};

function statusBadge(status: string | null, locale: string) {
  const colors: Record<string, string> = {
    active: "bg-green-100 text-green-700",
    paused: "bg-yellow-100 text-yellow-700",
    completed: "bg-red-100 text-red-700",
  };
  const s = status || "unknown";
  const label = STATUS_LABELS[locale]?.[s] || STATUS_LABELS.en[s] || s;
  return (
    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${colors[s] || "bg-gray-100 text-gray-600"}`}>
      {label}
    </span>
  );
}

interface AuditLog {
  id: number;
  user_email: string;
  action: string;
  resource_type: string | null;
  resource_id: number | null;
  details: Record<string, unknown>;
  created_at: string;
}

const ACTION_LABELS: Record<string, Record<string, string>> = {
  en: {
    "login": "Login", "project.create": "Create Project", "project.update": "Update Project",
    "project.delete": "Delete Project", "agent.activate": "Activate Agent", "agent.deactivate": "Deactivate Agent",
    "agent.config_update": "Update Agent Config", "blocker.resolve": "Resolve Blocker",
    "settings.update": "Update Settings", "execute.task": "Execute Task",
    "subscribe.register": "Register Subscription", "org.create": "Create Organization",
    "org.add_member": "Add Org Member", "org.remove_member": "Remove Org Member",
    "org.assign_project": "Assign Project to Org", "org.update_role": "Update Member Role",
    "org.rename": "Rename Organization", "org.join": "Join Organization", "org.delete": "Delete Organization",
    "apikey.upsert": "Save API Key", "apikey.delete": "Delete API Key",
  },
  zh: {
    "login": "登录", "project.create": "创建项目", "project.update": "更新项目",
    "project.delete": "删除项目", "agent.activate": "激活智能体", "agent.deactivate": "停用智能体",
    "agent.config_update": "更新智能体配置", "blocker.resolve": "解决阻碍",
    "settings.update": "更新设置", "execute.task": "执行任务",
    "subscribe.register": "注册订阅", "org.create": "创建组织",
    "org.add_member": "添加组织成员", "org.remove_member": "移除组织成员",
    "org.assign_project": "分配项目到组织", "org.update_role": "更新成员角色",
    "org.rename": "重命名组织", "org.join": "加入组织", "org.delete": "删除组织",
    "apikey.upsert": "保存 API 密钥", "apikey.delete": "删除 API 密钥",
  },
  "zh-TW": {
    "login": "登入", "project.create": "建立專案", "project.update": "更新專案",
    "project.delete": "刪除專案", "agent.activate": "啟用智能體", "agent.deactivate": "停用智能體",
    "agent.config_update": "更新智能體設定", "blocker.resolve": "解決阻礙",
    "settings.update": "更新設定", "execute.task": "執行任務",
    "subscribe.register": "註冊訂閱", "org.create": "建立組織",
    "org.add_member": "新增組織成員", "org.remove_member": "移除組織成員",
    "org.assign_project": "分配專案至組織", "org.update_role": "更新成員角色",
    "org.rename": "重新命名組織", "org.join": "加入組織", "org.delete": "刪除組織",
    "apikey.upsert": "儲存 API 金鑰", "apikey.delete": "刪除 API 金鑰",
  },
};

export default function ReportsPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const locale = (params.locale as Locale) || "en";
  const dict = getDictionary(locale);
  const tr = dict.reportsPage;
  const tc = dict.common;
  const ts = dict.settings;

  const { user, isLoading: userLoading } = useUser();
  const allCompaniesSelected = searchParams.get("scope") === "all";
  const activeOrgIdParam = searchParams.get("org_id");
  const [reports, setReports] = useState<AgentReport[]>([]);
  const [brevoStats, setBrevoStats] = useState({ emailsSent: 0, delivered: 0, opened: 0, clicked: 0 });
  const [brevoCampaigns, setBrevoCampaigns] = useState<BrevoCampaign[]>([]);
  const [emailHistory, setEmailHistory] = useState<{ date: string; event: string; email: string; subject: string; from?: string; messageId?: string }[]>([]);
  const [emailHistoryOpen, setEmailHistoryOpen] = useState(false);
  const [emailSearch, setEmailSearch] = useState("");
  const [emailStatusFilter, setEmailStatusFilter] = useState("");
  const [emailPreview, setEmailPreview] = useState<{ subject: string; from: string; to: string; date: string; body: string } | null>(null);
  const [emailPreviewLoading, setEmailPreviewLoading] = useState<string | null>(null);

  function fetchEmailHistory(q = "", status = "") {
    const params = new URLSearchParams({ limit: "50" });
    if (q) params.set("q", q);
    if (status) params.set("event", status);
    fetch(`/api/email-history?${params}`)
      .then((r) => r.json())
      .then((d) => setEmailHistory(d.events || []))
      .catch(() => {});
  }
  const [gaStats, setGaStats] = useState({ totalUsers: 0, sessions: 0, pageViews: 0 });
  const [gaProjects, setGaProjects] = useState<ProjectTraffic[]>([]);
  const [selectedProjects, setSelectedProjects] = useState<Set<string>>(new Set());
  const [tokenUsage, setTokenUsage] = useState<TokenUsageEntry[]>([]);
  const [tokenSummary, setTokenSummary] = useState({ totalTokens: 0, promptTokens: 0, completionTokens: 0 });
  const [personalTokenSummary, setPersonalTokenSummary] = useState({ totalTokens: 0, promptTokens: 0, completionTokens: 0 });
  const [tasksCompleted, setTasksCompleted] = useState(0);
  const [taskStatusByProject, setTaskStatusByProject] = useState<TaskStatusByProject[]>([]);
  const [dbKpisByProject, setDbKpisByProject] = useState<DbKpisByProject[]>([]);
  const [brevoContactsByProject, setBrevoContactsByProject] = useState<BrevoContactsByProject[]>([]);
  const [contactAnalytics, setContactAnalytics] = useState<ContactAnalytics | null>(null);
  const [userPlan, setUserPlan] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [auditLoading, setAuditLoading] = useState(false);
  const [dismissedAlerts, setDismissedAlerts] = useState<Set<string>>(new Set());
  const [isFilterSettingsOpen, setIsFilterSettingsOpen] = useState(false);
  const [projectFilterQuery, setProjectFilterQuery] = useState("");
  const trafficFilterStorageKey = user ? `${TRAFFIC_FILTER_STORAGE_PREFIX}:${user.sub || user.email || "default"}` : "";

  useEffect(() => {
    if (!user) return;
    const url = new URL("/api/reports", window.location.origin);
    url.searchParams.set("locale", locale);
    if (allCompaniesSelected) {
      url.searchParams.set("scope", "all");
    } else {
      const activeOrgId = activeOrgIdParam || window.localStorage.getItem("autoclaw_active_org");
      if (activeOrgId) {
        url.searchParams.set("org_id", String(activeOrgId));
      }
    }
    fetch(url.toString())
      .then((r) => r.json())
      .then((data) => {
        setReports(data.reports || []);
        if (data.plan) setUserPlan(data.plan);
        if (data.brevoStats) setBrevoStats(data.brevoStats);
        if (data.brevoCampaigns) setBrevoCampaigns(data.brevoCampaigns);
        if (data.gaStats) setGaStats(data.gaStats);
        if (data.gaProjects) {
          const projects = data.gaProjects as ProjectTraffic[];
          setGaProjects(projects);
          const availableProjectNames = projects.map((p) => p.project);
          const nextSelectedProjects = new Set(availableProjectNames);

          if (trafficFilterStorageKey) {
            try {
              const raw = window.localStorage.getItem(trafficFilterStorageKey);
              if (raw) {
                const saved = JSON.parse(raw) as unknown;
                if (Array.isArray(saved)) {
                  const validSelection = saved
                    .filter((name): name is string => typeof name === "string" && availableProjectNames.includes(name));
                  if (validSelection.length > 0) {
                    // Deselect only projects the user previously unchecked;
                    // new projects (not in saved list at all) stay selected by default
                    const savedSet = new Set(saved.filter((s): s is string => typeof s === "string"));
                    availableProjectNames.forEach((name) => {
                      if (savedSet.has(name) && !validSelection.includes(name)) {
                        nextSelectedProjects.delete(name);
                      }
                    });
                  }
                }
              }
            } catch {
              // Ignore malformed localStorage payloads and fall back to all selected.
            }
          }

          setSelectedProjects(nextSelectedProjects);
        }
        if (data.tokenUsage) setTokenUsage(data.tokenUsage);
        if (data.tokenSummary) setTokenSummary(data.tokenSummary);
        if (data.personalTokenSummary) setPersonalTokenSummary(data.personalTokenSummary);
        if (typeof data.tasksCompleted === "number") setTasksCompleted(data.tasksCompleted);
        if (Array.isArray(data.taskStatusByProject)) setTaskStatusByProject(data.taskStatusByProject);
        if (Array.isArray(data.dbKpisByProject)) setDbKpisByProject(data.dbKpisByProject);
        if (Array.isArray(data.brevoContactsByProject)) setBrevoContactsByProject(data.brevoContactsByProject);
        if (data.contactAnalytics) setContactAnalytics(data.contactAnalytics);
      })
      .finally(() => setLoading(false));
    fetch("/api/audit-logs?limit=20")
      .then((r) => r.json())
      .then((data) => setAuditLogs(data.logs || []))
      .finally(() => setAuditLoading(false));
  }, [activeOrgIdParam, allCompaniesSelected, locale, trafficFilterStorageKey, user]);

  useEffect(() => {
    if (!trafficFilterStorageKey || gaProjects.length === 0) return;
    const selected = gaProjects
      .map((p) => p.project)
      .filter((projectName) => selectedProjects.has(projectName));
    window.localStorage.setItem(trafficFilterStorageKey, JSON.stringify(selected));
  }, [gaProjects, selectedProjects, trafficFilterStorageKey]);

  const agentMetrics = reports.reduce(
    (acc, r) => {
      const m = r.metrics || {};
      acc.leadsGenerated += Number(m.leads || m.leads_generated || m.prospects || m.crm_leads || m.subscribers || 0);
      acc.contentPublished += Number(m.articles || m.posts_published || m.content || m.prs_created || 0);
      acc.tasksCompleted += Number(m.tasks_completed || m.issues || 0);
      return acc;
    },
    { leadsGenerated: 0, contentPublished: 0, tasksCompleted: 0 }
  );
  const dbLeadsGeneratedTotal = dbKpisByProject.reduce((sum, r) => sum + (r.leadsGenerated || 0), 0);
  const dbContentPublishedTotal = dbKpisByProject.reduce((sum, r) => sum + (r.contentPublished || 0), 0);
  const metrics: MetricsSummary = {
    totalTraffic: gaStats.pageViews,
    emailsSent: brevoStats.emailsSent,
    emailsFound: brevoStats.opened,
    leadsGenerated: dbLeadsGeneratedTotal || agentMetrics.leadsGenerated,
    contentPublished: dbContentPublishedTotal || agentMetrics.contentPublished,
    tasksCompleted: tasksCompleted || agentMetrics.tasksCompleted,
  };

  const allProjectNames = gaProjects.map((p) => p.project);
  const selectedProjectCount = allProjectNames.filter((name) => selectedProjects.has(name)).length;
  const visibleGaProjects = gaProjects.filter((p) => selectedProjects.has(p.project) && p.status === "ok");
  const projectFilterKeyword = projectFilterQuery.trim().toLowerCase();
  const filterableProjects = projectFilterKeyword
    ? gaProjects.filter((p) => p.project.toLowerCase().includes(projectFilterKeyword))
    : gaProjects;
  const selectedCountLabel = tr.filtersSelected.replace("{count}", String(selectedProjectCount));

  type ProjectMetricKey = "traffic" | "emailsSent" | "emailsOpened" | "leadsGenerated" | "contentPublished" | "tasks";
  type ProjectMetricBucket = Record<ProjectMetricKey, number>;
  const projectMetricMap: Record<string, ProjectMetricBucket> = {};
  const ensureProjectMetrics = (projectName: string) => {
    if (!projectMetricMap[projectName]) {
      projectMetricMap[projectName] = {
        traffic: 0,
        emailsSent: 0,
        emailsOpened: 0,
        leadsGenerated: 0,
        contentPublished: 0,
        tasks: 0,
      };
    }
    return projectMetricMap[projectName];
  };

  for (const p of gaProjects) {
    const bucket = ensureProjectMetrics(p.project);
    bucket.traffic += p.data.reduce((sum, d) => sum + d.pageViews, 0);
  }
  for (const c of brevoCampaigns) {
    const bucket = ensureProjectMetrics(c.project);
    bucket.emailsSent += c.sent || 0;
    bucket.emailsOpened += c.opened || 0;
  }
  if (dbKpisByProject.length > 0) {
    for (const row of dbKpisByProject) {
      const bucket = ensureProjectMetrics(row.project);
      bucket.leadsGenerated += row.leadsGenerated || 0;
      bucket.contentPublished += row.contentPublished || 0;
    }
  } else {
    for (const r of reports) {
      const bucket = ensureProjectMetrics(r.project);
      const m = r.metrics || {};
      bucket.leadsGenerated += Number(m.leads || m.leads_generated || m.prospects || m.crm_leads || m.subscribers || 0);
      bucket.contentPublished += Number(m.articles || m.posts_published || m.content || m.prs_created || 0);
    }
  }
  for (const row of brevoContactsByProject) {
    const bucket = ensureProjectMetrics(row.project || "Unknown");
    bucket.leadsGenerated += row.contacts || 0;
  }
  for (const t of taskStatusByProject) {
    const bucket = ensureProjectMetrics(t.project);
    bucket.tasks += t.total || 0;
  }

  const pieProjectNames = Object.keys(projectMetricMap).sort();
  const pieProjectColorMap = Object.fromEntries(
    pieProjectNames.map((name, idx) => [name, CHART_COLORS[idx % CHART_COLORS.length]])
  );

  const buildPieSlices = (metric: ProjectMetricKey) => {
    const entries = pieProjectNames
      .map((name) => ({
        label: name,
        value: projectMetricMap[name][metric],
        color: pieProjectColorMap[name] as string,
      }))
      .filter((e) => e.value > 0)
      .sort((a, b) => b.value - a.value);
    if (entries.length <= 7) return entries;
    const top = entries.slice(0, 7);
    const rest = entries.slice(7).reduce((sum, e) => sum + e.value, 0);
    if (rest > 0) top.push({ label: tr.others, value: rest, color: "#9ca3af" });
    return top;
  };

  const projectPieCharts = [
    { key: "traffic", title: tr.totalTraffic, slices: buildPieSlices("traffic") },
    { key: "emailsSent", title: tr.emailsSent, slices: buildPieSlices("emailsSent") },
    { key: "emailsOpened", title: tr.emailsOpened, slices: buildPieSlices("emailsOpened") },
    { key: "leadsGenerated", title: tr.leadsGenerated, slices: buildPieSlices("leadsGenerated") },
    { key: "contentPublished", title: tr.contentPublished, slices: buildPieSlices("contentPublished") },
    { key: "tasks", title: tr.tasksCompleted, slices: buildPieSlices("tasks") },
  ];

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
          <h1 className="text-2xl font-bold mb-4">{tr.title}</h1>
          <a href={`/auth/login?returnTo=/${locale}/dashboard/reports`} className="bg-red-800 hover:bg-red-900 text-white px-6 py-3 rounded-lg font-medium transition-colors">{tc.logIn}</a>
        </div>
      </div>
    );
  }

  const metricCards = [
    { label: tr.totalTraffic, value: metrics.totalTraffic, icon: "📊", color: "bg-red-50 text-red-700 border-red-200" },
    { label: tr.emailsSent, value: metrics.emailsSent, icon: "📧", color: "bg-green-50 text-green-700 border-green-200" },
    { label: tr.emailsOpened, value: metrics.emailsFound, icon: "📬", color: "bg-purple-50 text-purple-700 border-purple-200" },
    { label: tr.leadsGenerated, value: metrics.leadsGenerated, icon: "👥", color: "bg-orange-50 text-orange-700 border-orange-200" },
    { label: tr.contentPublished, value: metrics.contentPublished, icon: "📝", color: "bg-teal-50 text-teal-700 border-teal-200" },
    { label: tr.tasksCompleted, value: metrics.tasksCompleted, icon: "✅", color: "bg-pink-50 text-pink-700 border-pink-200" },
  ];

  return (
    <DashboardShell user={user} plan={userPlan}>
      <div className="px-4 sm:px-6 py-6 w-full">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6">
          <h1 className="text-2xl font-bold">{tr.title}</h1>
        </div>

        {loading ? (
          <p className="text-gray-500">{tc.loading}</p>
        ) : (
          <>
            <section className="mb-8">
              <h2 className="text-lg font-semibold mb-4">{tr.overview}</h2>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                {metricCards.map((card) => (
                  <div key={card.label} className={`rounded-lg border p-4 ${card.color}`}>
                    <div className="text-2xl mb-1">{card.icon}</div>
                    <div className="text-2xl font-bold">{card.value.toLocaleString()}</div>
                    <div className="text-xs font-medium mt-1 opacity-80">{card.label}</div>
                  </div>
                ))}
              </div>
            </section>

            {/* Email History + Stats */}
            {brevoStats.emailsSent > 0 && (
              <section className="mb-8">
                <div className="flex items-center justify-between mb-3">
                  <h2 className="text-lg font-semibold">{locale === "zh" ? "邮件记录" : locale === "zh-TW" ? "郵件記錄" : "Email History"}</h2>
                  <button
                    onClick={() => {
                      if (!emailHistoryOpen) fetchEmailHistory();
                      setEmailHistoryOpen(!emailHistoryOpen);
                      setEmailPreview(null);
                    }}
                    className="text-xs text-red-600 hover:text-red-800 cursor-pointer"
                  >
                    {emailHistoryOpen ? (locale === "zh" || locale === "zh-TW" ? "收起" : "Hide") : (locale === "zh" || locale === "zh-TW" ? "查看详情" : "View Details")}
                  </button>
                </div>
                {emailHistoryOpen && (
                  <div className="flex flex-wrap items-center gap-2 mb-3">
                    <div className="relative flex-1 min-w-[200px]">
                      <input
                        type="text"
                        value={emailSearch}
                        onChange={(e) => setEmailSearch(e.target.value)}
                        onKeyDown={(e) => { if (e.key === "Enter") fetchEmailHistory(emailSearch, emailStatusFilter); }}
                        placeholder={locale === "zh" || locale === "zh-TW" ? "搜索收件人、主题..." : "Search recipient, subject..."}
                        className="w-full pl-8 pr-3 py-1.5 border border-gray-200 rounded-lg text-xs focus:ring-1 focus:ring-red-500 focus:border-red-500 outline-none"
                      />
                      <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" /></svg>
                    </div>
                    <select
                      value={emailStatusFilter}
                      onChange={(e) => { setEmailStatusFilter(e.target.value); fetchEmailHistory(emailSearch, e.target.value); }}
                      className="border border-gray-200 rounded-lg px-2 py-1.5 text-xs bg-white cursor-pointer"
                    >
                      <option value="">{locale === "zh" || locale === "zh-TW" ? "全部状态" : "All Status"}</option>
                      <option value="requests">📤 {locale === "zh" || locale === "zh-TW" ? "已发送" : "Sent"}</option>
                      <option value="delivered">✅ {locale === "zh" || locale === "zh-TW" ? "已送达" : "Delivered"}</option>
                      <option value="opened">📬 {locale === "zh" || locale === "zh-TW" ? "已打开" : "Opened"}</option>
                      <option value="clicks">🔗 {locale === "zh" || locale === "zh-TW" ? "已点击" : "Clicked"}</option>
                      <option value="error">❌ {locale === "zh" || locale === "zh-TW" ? "错误" : "Error"}</option>
                      <option value="hardBounce">↩️ {locale === "zh" || locale === "zh-TW" ? "退回" : "Bounced"}</option>
                    </select>
                    <button
                      onClick={() => fetchEmailHistory(emailSearch, emailStatusFilter)}
                      className="text-xs px-3 py-1.5 bg-red-50 text-red-600 hover:bg-red-100 rounded-lg cursor-pointer"
                    >
                      {locale === "zh" || locale === "zh-TW" ? "搜索" : "Search"}
                    </button>
                  </div>
                )}
                {emailHistoryOpen && (
                  <div className="bg-white border border-gray-200 rounded-lg overflow-hidden mb-4">
                    {emailHistory.length === 0 ? (
                      <p className="text-sm text-gray-400 p-4 text-center">{tc.loading}</p>
                    ) : (
                      <div className="flex flex-col lg:flex-row">
                        {/* Email list */}
                        <div className="overflow-x-auto max-h-96 overflow-y-auto lg:flex-1">
                          <table className="w-full text-xs">
                            <thead className="sticky top-0 bg-gray-50">
                              <tr className="text-left text-gray-500 border-b">
                                <th className="py-2 px-3 font-medium">{locale === "zh" || locale === "zh-TW" ? "时间" : "Date"}</th>
                                <th className="py-2 px-3 font-medium">{locale === "zh" || locale === "zh-TW" ? "状态" : "Status"}</th>
                                <th className="py-2 px-3 font-medium">{locale === "zh" || locale === "zh-TW" ? "发件人" : "From"}</th>
                                <th className="py-2 px-3 font-medium">{locale === "zh" || locale === "zh-TW" ? "收件人" : "To"}</th>
                                <th className="py-2 px-3 font-medium">{locale === "zh" || locale === "zh-TW" ? "主题" : "Subject"}</th>
                              </tr>
                            </thead>
                            <tbody>
                              {emailHistory.map((e, i) => {
                                const statusColor = e.event === "delivered" ? "text-green-600" : e.event === "opened" ? "text-blue-600" : e.event === "clicks" || e.event === "clicked" ? "text-purple-600" : e.event === "error" || e.event === "hardBounce" || e.event === "softBounce" ? "text-red-500" : e.event === "requests" ? "text-gray-600" : "text-gray-500";
                                const statusLabels: Record<string, string> = { requests: "Sent", delivered: "Delivered", opened: "Opened", clicks: "Clicked", clicked: "Clicked", error: "Error", hardBounce: "Bounced", softBounce: "Soft Bounce" };
                                const statusLabel = statusLabels[e.event] || e.event;
                                const isActive = emailPreview && emailPreviewLoading === e.messageId;
                                return (
                                  <tr
                                    key={i}
                                    className={`border-b border-gray-50 hover:bg-gray-50 cursor-pointer ${isActive ? "bg-red-50" : ""}`}
                                    onClick={() => {
                                      if (!e.messageId) return;
                                      setEmailPreviewLoading(e.messageId);
                                      fetch(`/api/email-history/content?uuid=${encodeURIComponent(e.messageId)}&email=${encodeURIComponent(e.email)}`)
                                        .then((r) => r.json())
                                        .then((d) => { if (!d.error) setEmailPreview(d); else setEmailPreview({ subject: e.subject, from: e.from || "", to: e.email, date: e.date, body: `<p style="color:#999">${locale === "zh" ? "邮件内容不可用" : "Email content not available"}</p>` }); })
                                        .catch(() => setEmailPreview(null));
                                    }}
                                  >
                                    <td className="py-1.5 px-3 text-gray-500 whitespace-nowrap">{new Date(e.date).toLocaleString(locale, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</td>
                                    <td className={`py-1.5 px-3 font-medium ${statusColor}`}>{statusLabel}</td>
                                    <td className="py-1.5 px-3 text-gray-500 text-[11px] truncate max-w-[120px]">{(e.from || "").replace(/@.*/, "")}</td>
                                    <td className="py-1.5 px-3 text-gray-700 font-mono text-[11px]">{e.email}</td>
                                    <td className="py-1.5 px-3 text-gray-600 max-w-xs truncate">{e.subject}</td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>

                        {/* Email content preview */}
                        {emailPreview && (
                          <div className="lg:w-96 border-t lg:border-t-0 lg:border-l border-gray-200 max-h-96 overflow-y-auto">
                            <div className="p-3 border-b border-gray-100 bg-gray-50">
                              <div className="flex items-center justify-between">
                                <h4 className="text-xs font-semibold text-gray-700 truncate">{emailPreview.subject}</h4>
                                <button onClick={() => setEmailPreview(null)} className="text-gray-400 hover:text-gray-600 cursor-pointer text-xs">✕</button>
                              </div>
                              <div className="text-[10px] text-gray-400 mt-1">
                                <span>{locale === "zh" || locale === "zh-TW" ? "收件人" : "To"}: {emailPreview.to}</span>
                                {emailPreview.from && <span className="ml-2">{locale === "zh" || locale === "zh-TW" ? "发件人" : "From"}: {emailPreview.from}</span>}
                              </div>
                            </div>
                            <div className="p-3 text-xs text-gray-700 prose prose-xs max-w-none" dangerouslySetInnerHTML={{ __html: emailPreview.body }} />
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {/* Stats bar - below history */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <div className="flex items-center gap-2 bg-green-50 border border-green-200 rounded-lg p-3">
                    <div className="w-2.5 h-2.5 rounded-full bg-green-500" />
                    <div>
                      <div className="text-lg font-bold text-green-700">{brevoStats.delivered}</div>
                      <div className="text-[11px] text-green-600">{locale === "zh" || locale === "zh-TW" ? "已送达" : "Delivered"}</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 bg-blue-50 border border-blue-200 rounded-lg p-3">
                    <div className="w-2.5 h-2.5 rounded-full bg-blue-500" />
                    <div>
                      <div className="text-lg font-bold text-blue-700">{brevoStats.opened}</div>
                      <div className="text-[11px] text-blue-600">{locale === "zh" || locale === "zh-TW" ? "已打开" : "Opened"}</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 bg-purple-50 border border-purple-200 rounded-lg p-3">
                    <div className="w-2.5 h-2.5 rounded-full bg-purple-500" />
                    <div>
                      <div className="text-lg font-bold text-purple-700">{brevoStats.clicked}</div>
                      <div className="text-[11px] text-purple-600">{locale === "zh" || locale === "zh-TW" ? "已点击" : "Clicked"}</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-lg p-3">
                    <div className="w-2.5 h-2.5 rounded-full bg-red-500" />
                    <div>
                      <div className="text-lg font-bold text-red-700">{Math.max(0, brevoStats.emailsSent - brevoStats.delivered)}</div>
                      <div className="text-[11px] text-red-600">{locale === "zh" || locale === "zh-TW" ? "错误/退回" : "Error/Bounced"}</div>
                    </div>
                  </div>
                </div>
              </section>
            )}

            {(gaProjects.length > 0 || tokenUsage.length > 0) && (
              <div className="mb-8 grid grid-cols-1 2xl:grid-cols-2 gap-6 items-start">
            {gaProjects.length > 0 && (
              <section className="min-w-0">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
                      <h2 className="text-lg font-semibold">{tr.websiteTraffic}</h2>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-gray-500">{selectedCountLabel}</span>
                        <button
                          onClick={() => setIsFilterSettingsOpen((v) => !v)}
                          className="px-2.5 py-1 rounded-full text-xs font-medium border bg-white text-gray-600 border-gray-300 hover:border-gray-400 transition-colors"
                        >
                          {tr.filterSettings}
                        </button>
                      </div>
                    </div>

                    {isFilterSettingsOpen && (
                      <div className="mb-4 bg-white border border-gray-200 rounded-lg p-3 sm:p-4 space-y-3">
                        <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                          <input
                            value={projectFilterQuery}
                            onChange={(e) => setProjectFilterQuery(e.target.value)}
                            className="flex-1 border border-gray-300 rounded px-3 py-2 text-sm"
                            placeholder={tr.searchProjects}
                          />
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => setSelectedProjects(new Set(gaProjects.map((p) => p.project)))}
                              className="px-2.5 py-1.5 rounded text-xs font-medium bg-gray-100 text-gray-700 hover:bg-gray-200 transition-colors"
                            >
                              {tr.all}
                            </button>
                            <button
                              onClick={() => setSelectedProjects(new Set())}
                              className="px-2.5 py-1.5 rounded text-xs font-medium bg-gray-100 text-gray-700 hover:bg-gray-200 transition-colors"
                            >
                              {tr.clear}
                            </button>
                            <button
                              onClick={() => setIsFilterSettingsOpen(false)}
                              className="px-2.5 py-1.5 rounded text-xs font-medium border border-gray-300 text-gray-600 hover:border-gray-400 transition-colors"
                            >
                              {tr.close}
                            </button>
                          </div>
                        </div>

                        <div className="max-h-52 overflow-auto border border-gray-200 rounded-md divide-y divide-gray-100">
                          {filterableProjects.length === 0 ? (
                            <p className="px-3 py-2 text-xs text-gray-500">{tr.noProjectsMatch}</p>
                          ) : (
                            filterableProjects.map((p) => {
                              const isSelected = selectedProjects.has(p.project);
                              const issueTitle = p.status === "error"
                                ? (p.error || tr.trafficError)
                                : p.status === "no_data"
                                ? tr.trafficNoData
                                : "";
                              return (
                                <label
                                  key={p.project}
                                  className="flex items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 cursor-pointer"
                                  title={issueTitle}
                                >
                                  <input
                                    type="checkbox"
                                    checked={isSelected}
                                    onChange={() => {
                                      setSelectedProjects((prev) => {
                                        const next = new Set(prev);
                                        if (next.has(p.project)) next.delete(p.project);
                                        else next.add(p.project);
                                        return next;
                                      });
                                    }}
                                  />
                                  <span className="flex-1 truncate">{p.project}</span>
                                  {p.status === "error" && <span className="text-red-600 text-xs">!</span>}
                                  {p.status === "no_data" && <span className="text-amber-600 text-xs">⚠</span>}
                                </label>
                              );
                            })
                          )}
                        </div>
                      </div>
                    )}

                    {/* Show full messages only for hard errors; no_data stays as compact chip icon */}
                    {gaProjects.some((p) => p.status === "error" && !dismissedAlerts.has(p.project)) && (
                      <div className="space-y-2 mb-4">
                        {gaProjects.filter((p) => p.status === "error" && !dismissedAlerts.has(p.project)).map((p) => (
                          <div key={p.project} className="flex items-center gap-2 text-sm bg-red-50 text-red-700 border border-red-200 rounded-lg px-3 py-2">
                            <span className="font-medium">{p.project}:</span>
                            <span className="flex-1">{p.error || tr.trafficError}</span>
                            <button
                              onClick={() => setDismissedAlerts((prev) => new Set(prev).add(p.project))}
                              className="ml-auto text-red-400 hover:text-red-600 transition-colors p-0.5"
                              aria-label="Dismiss"
                            >
                              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                              </svg>
                            </button>
                          </div>
                        ))}
                      </div>
                    )}

                    {visibleGaProjects.length > 0 && (
                      <CombinedTrafficChart
                        projects={visibleGaProjects}
                        locale={locale}
                        colorMap={Object.fromEntries(gaProjects.map((p, i) => [p.project, CHART_COLORS[i % CHART_COLORS.length]]))}
                      />
                    )}
                    {visibleGaProjects.length === 0 && (
                      <p className="text-sm text-gray-500">{tr.noProjectsSelected}</p>
                    )}
              </section>
            )}

            {tokenUsage.length > 0 && (
              <section className="min-w-0">
                <h2 className="text-lg font-semibold mb-4">{tr.tokenUsage}</h2>
                <TokenUsageChart data={tokenUsage} locale={locale} />
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
                  {/* Org usage */}
                  <div className="bg-white border border-gray-200 rounded-xl p-4">
                    <p className="text-xs text-gray-400 mb-2">{locale === "zh" || locale === "zh-TW" ? "组织消耗" : "Organization"}</p>
                    <div className="flex flex-wrap gap-2 text-sm">
                      <div className="bg-indigo-50 text-indigo-700 px-3 py-1 rounded-full font-medium">
                        {tr.totalTokens}: {tokenSummary.totalTokens.toLocaleString()}
                      </div>
                      <div className="bg-purple-50 text-purple-700 px-3 py-1 rounded-full font-medium">
                        {tr.promptLabel}: {tokenSummary.promptTokens.toLocaleString()}
                      </div>
                      <div className="bg-violet-50 text-violet-700 px-3 py-1 rounded-full font-medium">
                        {tr.completionLabel}: {tokenSummary.completionTokens.toLocaleString()}
                      </div>
                    </div>
                  </div>
                  {/* Personal usage */}
                  <div className="bg-white border border-gray-200 rounded-xl p-4">
                    <p className="text-xs text-gray-400 mb-2">{locale === "zh" || locale === "zh-TW" ? "个人消耗" : "Personal"}</p>
                    <div className="flex flex-wrap gap-2 text-sm">
                      <div className="bg-emerald-50 text-emerald-700 px-3 py-1 rounded-full font-medium">
                        {tr.totalTokens}: {personalTokenSummary.totalTokens.toLocaleString()}
                      </div>
                      <div className="bg-teal-50 text-teal-700 px-3 py-1 rounded-full font-medium">
                        {tr.promptLabel}: {personalTokenSummary.promptTokens.toLocaleString()}
                      </div>
                      <div className="bg-cyan-50 text-cyan-700 px-3 py-1 rounded-full font-medium">
                        {tr.completionLabel}: {personalTokenSummary.completionTokens.toLocaleString()}
                      </div>
                    </div>
                  </div>
                </div>
              </section>
            )}
              </div>
            )}

            {projectPieCharts.length > 0 && (
              <section className="mb-8">
                <h2 className="text-lg font-semibold mb-4">{tr.project} KPI</h2>
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                  {projectPieCharts.map((chart) => (
                    <ProjectPieChart key={chart.key} title={chart.title} slices={chart.slices} emptyLabel={tr.noDataYet} />
                  ))}
                </div>
              </section>
            )}

            {contactAnalytics && contactAnalytics.total > 0 && (
              <section className="mb-8">
                <h2 className="text-lg font-semibold mb-4">{tr.contactAnalytics}</h2>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
                  <div className="bg-white rounded-lg border border-gray-200 p-4 text-center">
                    <div className="text-2xl font-bold text-gray-800">{contactAnalytics.total.toLocaleString()}</div>
                    <div className="text-xs text-gray-500 mt-1">{tr.totalContacts}</div>
                  </div>
                  <div className="bg-white rounded-lg border border-gray-200 p-4 text-center">
                    <div className="text-2xl font-bold text-blue-600">{contactAnalytics.enriched.toLocaleString()}</div>
                    <div className="text-xs text-gray-500 mt-1">{tr.enrichedContacts}</div>
                  </div>
                  <div className="bg-white rounded-lg border border-gray-200 p-4 text-center">
                    <div className="text-2xl font-bold text-green-600">{contactAnalytics.publicVsPrivate.public.toLocaleString()}</div>
                    <div className="text-xs text-gray-500 mt-1">{tr.publicCompany}</div>
                  </div>
                  <div className="bg-white rounded-lg border border-gray-200 p-4 text-center">
                    <div className="text-2xl font-bold text-gray-600">{contactAnalytics.publicVsPrivate.private.toLocaleString()}</div>
                    <div className="text-xs text-gray-500 mt-1">{tr.privateCompany}</div>
                  </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                  {contactAnalytics.topCompanies.length > 0 && (
                    <div className="bg-white rounded-lg border border-gray-200 p-4">
                      <h3 className="text-sm font-semibold mb-3">{tr.topCompanies}</h3>
                      <div className="space-y-2">
                        {contactAnalytics.topCompanies.map((c) => (
                          <div key={c.label} className="flex items-center justify-between text-xs">
                            <span className="text-gray-600 truncate mr-2" title={c.label}>{c.label}</span>
                            <span className="text-gray-800 font-medium shrink-0">{c.count}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {contactAnalytics.byIndustry.length > 0 && (
                    <ProjectPieChart
                      title={tr.byIndustry}
                      slices={contactAnalytics.byIndustry.map((r, i) => ({
                        label: r.label,
                        value: r.count,
                        color: CHART_COLORS[i % CHART_COLORS.length],
                      }))}
                    />
                  )}
                  {contactAnalytics.byCompanySize.length > 0 && (
                    <ProjectPieChart
                      title={tr.byCompanySize}
                      slices={contactAnalytics.byCompanySize.map((r, i) => ({
                        label: r.label,
                        value: r.count,
                        color: CHART_COLORS[i % CHART_COLORS.length],
                      }))}
                    />
                  )}
                  {contactAnalytics.bySource.length > 0 && (
                    <ProjectPieChart
                      title={tr.bySource}
                      slices={contactAnalytics.bySource.map((r, i) => ({
                        label: r.label,
                        value: r.count,
                        color: CHART_COLORS[i % CHART_COLORS.length],
                      }))}
                    />
                  )}
                  {(contactAnalytics.publicVsPrivate.public > 0 || contactAnalytics.publicVsPrivate.private > 0) && (
                    <ProjectPieChart
                      title={tr.publicVsPrivate}
                      slices={[
                        { label: tr.publicCompany, value: contactAnalytics.publicVsPrivate.public, color: "#10b981" },
                        { label: tr.privateCompany, value: contactAnalytics.publicVsPrivate.private, color: "#3b82f6" },
                        { label: tr.unknown, value: contactAnalytics.publicVsPrivate.unknown, color: "#d1d5db" },
                      ].filter(s => s.value > 0)}
                    />
                  )}
                </div>
              </section>
            )}

            {brevoCampaigns.length > 0 && (
              <section className="mb-8">
                <h2 className="text-lg font-semibold mb-4">{tr.campaigns}</h2>
                <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="bg-gray-50 border-b border-gray-200">
                          <th className="text-left px-4 py-3 font-medium text-gray-600">{tr.campaignName}</th>
                          <th className="text-left px-3 py-3 font-medium text-gray-600">{tr.project}</th>
                          <th className="text-center px-3 py-3 font-medium text-gray-600">{tr.campaignStatus}</th>
                          <th className="text-right px-3 py-3 font-medium text-gray-600">{tr.campaignSent}</th>
                          <th className="text-right px-3 py-3 font-medium text-gray-600">{tr.campaignOpened}</th>
                          <th className="text-right px-3 py-3 font-medium text-gray-600">{tr.openRate}</th>
                          <th className="text-right px-3 py-3 font-medium text-gray-600">{tr.campaignClicked}</th>
                          <th className="text-right px-3 py-3 font-medium text-gray-600">{tr.clickRate}</th>
                          <th className="text-right px-4 py-3 font-medium text-gray-600">{tr.campaignDate}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {brevoCampaigns.map((c) => {
                          const openRate = c.delivered > 0 ? ((c.opened / c.delivered) * 100).toFixed(1) : "0.0";
                          const clickRate = c.delivered > 0 ? ((c.clicked / c.delivered) * 100).toFixed(1) : "0.0";
                          const statusColors: Record<string, string> = {
                            sent: "bg-green-100 text-green-700",
                            draft: "bg-gray-100 text-gray-600",
                            queued: "bg-blue-100 text-blue-700",
                            suspended: "bg-yellow-100 text-yellow-700",
                            archive: "bg-gray-100 text-gray-500",
                          };
                          const statusLabel = c.status === "sent" ? tr.statusSent
                            : c.status === "draft" ? tr.statusDraft
                            : c.status === "queued" ? tr.statusQueued
                            : c.status;
                          return (
                            <tr key={c.id} className="border-b border-gray-100 hover:bg-gray-50">
                              <td className="px-4 py-3 font-medium text-gray-800 max-w-[200px] truncate" title={c.name}>{c.name}</td>
                              <td className="px-3 py-3 text-xs text-gray-500">{c.project}</td>
                              <td className="px-3 py-3 text-center">
                                <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${statusColors[c.status] || "bg-gray-100 text-gray-600"}`}>{statusLabel}</span>
                              </td>
                              <td className="px-3 py-3 text-right tabular-nums">{c.sent.toLocaleString()}</td>
                              <td className="px-3 py-3 text-right tabular-nums">{c.opened.toLocaleString()}</td>
                              <td className="px-3 py-3 text-right tabular-nums text-green-600 font-medium">{openRate}%</td>
                              <td className="px-3 py-3 text-right tabular-nums">{c.clicked.toLocaleString()}</td>
                              <td className="px-3 py-3 text-right tabular-nums text-blue-600 font-medium">{clickRate}%</td>
                              <td className="px-4 py-3 text-right text-gray-500 text-xs">
                                {c.sentDate ? new Date(c.sentDate).toLocaleDateString(locale === "zh" ? "zh-CN" : locale === "zh-TW" ? "zh-TW" : "en-US") : "-"}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              </section>
            )}

            <section className="mb-8">
              <h2 className="text-lg font-semibold mb-4">{tr.agentReports}</h2>
              {reports.length === 0 ? (
                <div className="bg-white rounded-lg border border-gray-200 p-8 text-center">
                  <p className="text-gray-500 mb-2">{tr.noReports}</p>
                  <p className="text-gray-400 text-sm">{tr.noReportsDesc}</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {reports.map((report) => (
                    <div key={report.id} className="bg-white rounded-lg border border-gray-200 p-4 sm:p-5">
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-3">
                        <div className="flex items-center gap-2">
                          <h3 className="font-semibold text-sm">{report.agent.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}</h3>
                          {statusBadge(report.status, locale)}
                        </div>
                        <span className="text-xs text-gray-400">{report.project}</span>
                      </div>
                      <div className="prose prose-sm prose-gray max-w-none text-gray-600 mb-3 [&>p]:my-1 [&>ul]:my-1 [&>ol]:my-1 [&>h1]:text-base [&>h2]:text-sm [&>h3]:text-sm [&_table]:text-xs [&_table]:border-collapse [&_th]:border [&_th]:border-gray-300 [&_th]:px-2 [&_th]:py-1 [&_th]:bg-gray-50 [&_td]:border [&_td]:border-gray-200 [&_td]:px-2 [&_td]:py-1 [&_a]:text-red-600 [&_a]:no-underline hover:[&_a]:underline">
                        <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw]}>{report.summary}</ReactMarkdown>
                      </div>
                      <div className="flex flex-wrap gap-2 mb-3">
                        {Object.entries(report.metrics).map(([key, value]) => (
                          <div key={key} className="bg-gray-50 px-2.5 py-1.5 rounded text-xs">
                            <span className="text-gray-400">{METRIC_LABELS[locale]?.[key] || METRIC_LABELS.en[key] || key.replace(/_/g, " ")}:</span>{" "}
                            <span className="font-medium text-gray-700">{value}</span>
                          </div>
                        ))}
                      </div>
                      <p className="text-gray-400 text-xs">
                        {CATEGORY_LABELS[locale]?.[report.period] || CATEGORY_LABELS.en[report.period] || report.period} &middot; {tr.lastRun} {new Date(report.last_run).toLocaleString(locale === "zh" ? "zh-CN" : locale === "zh-TW" ? "zh-TW" : "en-US")}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </section>

            {/* Audit Log */}
            <section>
              <h2 className="text-lg font-semibold mb-4">{ts.auditLogTitle}</h2>
              {auditLoading ? (
                <p className="text-sm text-gray-400">{tc.loading}</p>
              ) : auditLogs.length === 0 ? (
                <div className="bg-white rounded-lg border border-gray-200 p-8 text-center">
                  <p className="text-gray-400 text-sm">{ts.auditLogEmpty}</p>
                </div>
              ) : (
                <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="bg-gray-50 border-b border-gray-200">
                          <th className="text-left px-4 py-3 font-medium text-gray-600 text-xs">{ts.auditAction}</th>
                          <th className="text-left px-3 py-3 font-medium text-gray-600 text-xs">{ts.auditResource}</th>
                          <th className="text-left px-3 py-3 font-medium text-gray-600 text-xs">{ts.auditUser}</th>
                          <th className="text-right px-4 py-3 font-medium text-gray-600 text-xs">{ts.auditTime}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {auditLogs.map((log) => (
                          <tr key={log.id} className="border-b border-gray-100 hover:bg-gray-50">
                            <td className="px-4 py-2.5 text-gray-700">
                              {(ACTION_LABELS[locale] || ACTION_LABELS.en)[log.action] || log.action}
                            </td>
                            <td className="px-3 py-2.5 text-gray-500">
                              {log.resource_type ? `${log.resource_type}${log.resource_id ? ` #${log.resource_id}` : ""}` : "-"}
                            </td>
                            <td className="px-3 py-2.5 text-gray-500 truncate max-w-40">{log.user_email}</td>
                            <td className="px-4 py-2.5 text-right text-gray-400 whitespace-nowrap text-xs">
                              {new Date(log.created_at).toLocaleString(locale === "zh" ? "zh-CN" : locale === "zh-TW" ? "zh-TW" : "en-US", {
                                month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
                              })}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </section>
          </>
        )}
      </div>
    </DashboardShell>
  );
}
