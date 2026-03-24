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
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">{ta.title}</h1>
            <p className="text-sm text-gray-500 mt-1">
              {isZh ? `${projects.length} 个项目 · ${projects.reduce((s, p) => s + p.agentCount, 0)} 个 AI 员工` : `${projects.length} projects · ${projects.reduce((s, p) => s + p.agentCount, 0)} AI employees`}
            </p>
          </div>
        </div>

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
                  href={`/${locale}/dashboard/agents/${p.id}`}
                  className="block bg-white border border-gray-200 rounded-xl hover:shadow-md hover:border-gray-300 transition-all"
                >
                  {/* Header */}
                  <div className="p-4 pb-3">
                    <div className="flex items-start justify-between">
                      <div className="flex-1 min-w-0">
                        <h3 className="font-semibold text-gray-900 truncate">{p.name}</h3>
                        {p.website && <p className="text-xs text-gray-400 truncate mt-0.5">{p.website}</p>}
                      </div>
                      <span className={`ml-2 flex items-center gap-1.5 text-[10px] font-medium px-2 py-0.5 rounded-full border ${statusColors[color]}`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${dotColors[color]}`} />
                        {getStatusLabel(p)}
                      </span>
                    </div>
                  </div>

                  {/* Stats */}
                  <div className="px-4 pb-3 grid grid-cols-3 gap-2">
                    <div className="text-center">
                      <p className="text-lg font-bold text-gray-900">{p.agentCount}</p>
                      <p className="text-[10px] text-gray-400">{isZh ? "AI 员工" : "Agents"}</p>
                    </div>
                    <div className="text-center">
                      <p className="text-lg font-bold text-gray-900">{p.completedTasks}/{p.totalTasks}</p>
                      <p className="text-[10px] text-gray-400">{isZh ? "任务完成" : "Tasks Done"}</p>
                    </div>
                    <div className="text-center">
                      <p className="text-lg font-bold text-gray-900">{p.contactCount}</p>
                      <p className="text-[10px] text-gray-400">{isZh ? "联系人" : "Contacts"}</p>
                    </div>
                  </div>

                  {/* Agent chips */}
                  <div className="px-4 pb-3 flex flex-wrap gap-1">
                    {p.agents.map((a) => (
                      <span
                        key={a.id}
                        className={`text-[10px] px-1.5 py-0.5 rounded-full ${
                          a.errors > 0 ? "bg-red-50 text-red-600" :
                          a.inProgress > 0 ? "bg-yellow-50 text-yellow-700" :
                          "bg-gray-50 text-gray-500"
                        }`}
                      >
                        {AGENT_ICONS[a.type] || "🤖"} {a.taskProgress}
                      </span>
                    ))}
                  </div>

                  {/* Alerts */}
                  {(p.errorTasks > 0 || p.pendingReviews > 0) && (
                    <div className="px-4 pb-3 space-y-1">
                      {p.errorTasks > 0 && (
                        <div className="flex items-center gap-1.5 text-[10px] text-red-600">
                          <span>⚠</span>
                          <span>{isZh ? `${p.errorTasks} 个任务出错` : `${p.errorTasks} task error(s)`}</span>
                        </div>
                      )}
                      {p.pendingReviews > 0 && (
                        <div className="flex items-center gap-1.5 text-[10px] text-amber-600">
                          <span>📋</span>
                          <span>{isZh ? `${p.pendingReviews} 封邮件待审核` : `${p.pendingReviews} email(s) pending review`}</span>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Footer */}
                  <div className="px-4 py-2 border-t border-gray-100 flex items-center justify-between">
                    <span className="text-[10px] text-gray-400">
                      {p.lastActivity
                        ? `${isZh ? "最近活动" : "Last"}: ${new Date(p.lastActivity).toLocaleDateString()}`
                        : isZh ? "无活动" : "No activity"}
                    </span>
                    <span className="text-xs text-red-700 font-medium">{isZh ? "管理 →" : "Manage →"}</span>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </DashboardShell>
  );
}
