"use client";

import { useUser } from "@auth0/nextjs-auth0/client";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { getDictionary, type Locale } from "@/lib/i18n";
import DashboardShell from "@/components/DashboardShell";

interface AgentSummary {
  id: number;
  type: string;
  taskProgress: string;
  errors: number;
  inProgress: number;
  lastError?: string;
}

interface ProjectSummary {
  id: number;
  name: string;
  website?: string;
  description?: string;
  agentCount: number;
  contactCount: number;
  totalTasks: number;
  completedTasks: number;
  inProgressTasks: number;
  errorTasks: number;
  recurringTasks: number;
  pendingReviews: number;
  agentErrors: number;
  lastActivity: string | null;
  agents: AgentSummary[];
}

const AGENT_ICONS: Record<string, string> = {
  email_marketing: "📧",
  seo_content: "📝",
  lead_prospecting: "🔍",
  social_media: "📱",
  product_manager: "📊",
  sales_followup: "🤝",
  orchestrator: "🎯",
  dev_agent: "🛠️",
  monitor: "👁️",
};

const AGENT_LABELS: Record<string, Record<string, string>> = {
  email_marketing: { en: "Email Marketing", zh: "邮件营销" },
  seo_content: { en: "SEO Content", zh: "SEO 内容" },
  lead_prospecting: { en: "Lead Prospecting", zh: "线索挖掘" },
  social_media: { en: "Social Media", zh: "社交媒体" },
  product_manager: { en: "Product Manager", zh: "产品经理" },
  sales_followup: { en: "Sales Follow-up", zh: "销售跟进" },
  orchestrator: { en: "Orchestrator", zh: "调度器" },
  dev_agent: { en: "Dev Agent", zh: "开发代理" },
  monitor: { en: "Monitor", zh: "监控" },
};

export default function AgentsOverviewPage() {
  const params = useParams();
  const locale = (params.locale as Locale) || "en";
  const dict = getDictionary(locale);
  const ta = dict.agentsPage;
  const tc = dict.common;
  const isZh = locale === "zh" || locale === "zh-TW";

  const { user, isLoading: userLoading } = useUser();
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [plan, setPlan] = useState("starter");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    setLoading(true);
    fetch("/api/agent-summary")
      .then((r) => r.json())
      .then((data) => {
        setProjects(data.projects || []);
        setPlan(data.plan || "starter");
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [user]);

  function getStatusColor(p: ProjectSummary) {
    if (p.errorTasks > 0) return "red";
    if (p.inProgressTasks > 0) return "yellow";
    if (p.completedTasks > 0) return "green";
    return "gray";
  }

  function getStatusLabel(p: ProjectSummary) {
    if (p.errorTasks > 0) return isZh ? `${p.errorTasks} 个错误` : `${p.errorTasks} error(s)`;
    if (p.inProgressTasks > 0) return isZh ? `${p.inProgressTasks} 个执行中` : `${p.inProgressTasks} running`;
    if (p.recurringTasks > 0) return isZh ? "周期运行中" : "Recurring";
    if (p.completedTasks === p.totalTasks && p.totalTasks > 0) return isZh ? "全部完成" : "All done";
    return isZh ? "待执行" : "Idle";
  }

  const statusColors: Record<string, string> = {
    red: "bg-red-100 text-red-700 border-red-200",
    yellow: "bg-yellow-100 text-yellow-700 border-yellow-200",
    green: "bg-green-100 text-green-700 border-green-200",
    gray: "bg-gray-100 text-gray-500 border-gray-200",
  };

  const dotColors: Record<string, string> = {
    red: "bg-red-500",
    yellow: "bg-yellow-500",
    green: "bg-green-500",
    gray: "bg-gray-400",
  };

  if (!user && !userLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <a href={`/auth/login?returnTo=/${locale}/dashboard/agents`} className="bg-red-800 hover:bg-red-900 text-white px-6 py-3 rounded-lg font-medium transition-colors">{tc.logIn}</a>
      </div>
    );
  }

  return (
    <DashboardShell user={user || { email: null }} plan={plan}>
      <div className="px-4 sm:px-6 py-6 w-full max-w-6xl mx-auto">
        {(() => {
          const allAgents = projects.flatMap((p) =>
            p.agents.map((a) => ({ ...a, projectId: p.id, projectName: p.name }))
          );
          const totalAgents = allAgents.length;

<<<<<<< HEAD
          return (
            <>
              <div className="flex items-center justify-between mb-6">
                <div>
                  <h1 className="text-2xl font-bold text-gray-900">{ta.title}</h1>
                  <p className="text-sm text-gray-500 mt-1">
                    {isZh ? `${totalAgents} 个 AI Agent · ${projects.length} 个项目` : `${totalAgents} AI agents · ${projects.length} projects`}
                  </p>
                </div>
              </div>

              {loading ? (
                <div className="text-center py-16 text-gray-400">{tc.loading}</div>
              ) : projects.length === 0 ? (
                <div className="text-center py-16">
                  <p className="text-gray-400 mb-4">{isZh ? "还没有项目，先创建一个项目并添加 AI Agent" : "No projects yet. Create a project and add AI agents to get started."}</p>
                  <Link href={`/${locale}/dashboard/projects`} className="bg-red-800 hover:bg-red-900 text-white px-5 py-2 rounded-lg text-sm font-medium">
                    {isZh ? "创建项目" : "Create Project"}
                  </Link>
                </div>
              ) : (
                <div className="space-y-6">
                  {projects.map((p) => {
                    const color = getStatusColor(p);
                    return (
                      <div key={p.id} className="bg-white border border-gray-200 rounded-xl overflow-hidden">
                        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <Link href={`/${locale}/dashboard/projects/${p.id}`} className="font-semibold text-gray-900 hover:text-red-800 transition-colors">
                              {p.name}
                            </Link>
                            <span className={`flex items-center gap-1.5 text-[10px] font-medium px-2 py-0.5 rounded-full border ${statusColors[color]}`}>
                              <span className={`w-1.5 h-1.5 rounded-full ${dotColors[color]}`} />
                              {getStatusLabel(p)}
                            </span>
                            {p.contactCount > 0 && (
                              <span className="text-xs text-gray-400">{isZh ? `${p.contactCount} 个联系人` : `${p.contactCount} contacts`}</span>
                            )}
                          </div>
                          <Link href={`/${locale}/dashboard/projects/${p.id}`} className="text-xs text-red-700 font-medium hover:text-red-900 transition-colors">
                            {isZh ? "管理 →" : "Manage →"}
                          </Link>
                        </div>

                        <div className="p-5">
                          {p.agents.length === 0 ? (
                            <div className="text-center py-6">
                              <p className="text-sm text-gray-400 mb-3">{isZh ? "该项目还没有 AI Agent" : "No AI agents in this project yet"}</p>
                              <Link href={`/${locale}/dashboard/projects/${p.id}`} className="inline-flex items-center gap-1.5 bg-red-800 hover:bg-red-900 text-white px-4 py-1.5 rounded-lg text-sm font-medium transition-colors">
                                {isZh ? "+ 添加 Agent" : "+ Add Agent"}
                              </Link>
                            </div>
                          ) : (
                            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                              {p.agents.map((a) => {
                                const hasError = a.errors > 0;
                                const isRunning = a.inProgress > 0;
                                const agentColor = hasError ? "red" : isRunning ? "yellow" : "green";
                                const statusLabel = hasError
                                  ? (isZh ? `${a.errors} 个错误` : `${a.errors} error(s)`)
                                  : isRunning
                                  ? (isZh ? "执行中" : "Running")
                                  : (isZh ? "就绪" : "Ready");
                                const agentLabel = (AGENT_LABELS[a.type] || {})[isZh ? "zh" : "en"] || a.type;

                                return (
                                  <Link
                                    key={a.id}
                                    href={`/${locale}/dashboard/projects/${p.id}`}
                                    className="flex items-center gap-3 p-3 rounded-lg border border-gray-100 hover:border-gray-300 hover:shadow-sm transition-all"
                                  >
                                    <span className="text-xl">{AGENT_ICONS[a.type] || "🤖"}</span>
                                    <div className="flex-1 min-w-0">
                                      <h4 className="text-sm font-medium text-gray-900">{agentLabel}</h4>
                                      <div className="flex items-center gap-2 mt-0.5">
                                        <span className="text-xs text-gray-500">{a.taskProgress}</span>
                                        <span className={`flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-full border ${statusColors[agentColor]}`}>
                                          <span className={`w-1.5 h-1.5 rounded-full ${dotColors[agentColor]}`} />
                                          {statusLabel}
                                        </span>
                                      </div>
                                    </div>
                                  </Link>
                                );
                              })}
                            </div>
                          )}
                        </div>
=======
        {loading ? (
          <div className="text-center py-16 text-gray-400">{tc.loading}</div>
        ) : projects.length === 0 ? (
          <div className="text-center py-16">
            <p className="text-gray-400 mb-4">{isZh ? "还没有项目，从创建第一个项目开始" : "No projects yet. Create your first one to get started."}</p>
            <Link href={`/${locale}/dashboard/projects`} className="bg-red-800 hover:bg-red-900 text-white px-5 py-2 rounded-lg text-sm font-medium">
              {isZh ? "创建项目" : "Create Project"}
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {projects.map((p) => {
              const color = getStatusColor(p);
              return (
                <Link
                  key={p.id}
                  href={`/${locale}/dashboard/projects/${p.id}`}
                  className="block bg-white border border-gray-200 rounded-xl hover:shadow-md hover:border-gray-300 transition-all"
                >
                  {/* Header */}
                  <div className="p-4 pb-3">
                    <div className="flex items-start justify-between">
                      <div className="flex-1 min-w-0">
                        <h3 className="font-semibold text-gray-900 truncate">{p.name}</h3>
                        {p.website && <p className="text-xs text-gray-400 truncate mt-0.5">{p.website}</p>}
>>>>>>> 47449eed6848d650125992002535779b4cdab134
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          );
        })()}
      </div>
    </DashboardShell>
  );
}
