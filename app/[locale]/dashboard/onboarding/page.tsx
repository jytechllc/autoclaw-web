"use client";

import { useUser } from "@auth0/nextjs-auth0/client";
import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { getDictionary, type Locale } from "@/lib/i18n";
import DashboardShell from "@/components/DashboardShell";

interface StepStatus {
  hasProjects: boolean;
  hasApiKeys: boolean;
  hasKnowledge: boolean;
  hasLeadAgent: boolean;
  hasEmailAgent: boolean;
  hasReports: boolean;
}

function CheckIcon() {
  return (
    <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
    </svg>
  );
}

function StepNumber({ num, done }: { num: number; done: boolean }) {
  if (done) {
    return (
      <div className="w-8 h-8 rounded-full bg-green-600 flex items-center justify-center shrink-0">
        <CheckIcon />
      </div>
    );
  }
  return (
    <div className="w-8 h-8 rounded-full bg-red-800 text-white flex items-center justify-center shrink-0 text-sm font-bold">
      {num}
    </div>
  );
}

export default function OnboardingPage() {
  const params = useParams();
  const locale = (params.locale as Locale) || "en";
  const dict = getDictionary(locale);
  const t = dict.onboardingPage;
  const tc = dict.common;

  const { user, isLoading: userLoading } = useUser();
  const [plan, setPlan] = useState<string>("");
  const [status, setStatus] = useState<StepStatus>({
    hasProjects: false,
    hasApiKeys: false,
    hasKnowledge: false,
    hasLeadAgent: false,
    hasEmailAgent: false,
    hasReports: false,
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;

    async function fetchStatus() {
      try {
        const [projectsRes, keysRes, kbRes, agentsRes, reportsRes] = await Promise.all([
          fetch("/api/projects").then((r) => r.json()).catch(() => ({ projects: [] })),
          fetch("/api/api-keys").then((r) => r.json()).catch(() => ({ keys: [] })),
          fetch("/api/knowledge-base").then((r) => r.json()).catch(() => ({ documents: [] })),
          fetch("/api/projects").then((r) => r.json()).catch(() => ({ agents: [] })),
          fetch("/api/agent-reports").then((r) => r.json()).catch(() => ({ reports: [] })),
        ]);

        if (projectsRes.plan) setPlan(projectsRes.plan);

        const projects = projectsRes.projects || [];
        const keys = keysRes.keys || [];
        const documents = kbRes.documents || kbRes.items || [];
        const agents = agentsRes.agents || [];
        const reports = reportsRes.reports || reportsRes.data || [];

        const hasLeadAgent = agents.some?.((a: { agent?: string; agent_type?: string }) =>
          (a.agent || a.agent_type || "").toLowerCase().includes("lead") ||
          (a.agent || a.agent_type || "").toLowerCase().includes("prospect")
        ) || false;

        const hasEmailAgent = agents.some?.((a: { agent?: string; agent_type?: string }) =>
          (a.agent || a.agent_type || "").toLowerCase().includes("email") ||
          (a.agent || a.agent_type || "").toLowerCase().includes("mail")
        ) || false;

        setStatus({
          hasProjects: projects.length > 0,
          hasApiKeys: keys.length > 0,
          hasKnowledge: documents.length > 0,
          hasLeadAgent,
          hasEmailAgent,
          hasReports: reports.length > 0,
        });
      } catch {
        // silently fail — show all as incomplete
      } finally {
        setLoading(false);
      }
    }

    fetchStatus();
  }, [user]);

  const steps = [
    { key: "step1", done: status.hasProjects, href: `/${locale}/dashboard/projects`, icon: "folder" },
    { key: "step2", done: status.hasApiKeys, href: `/${locale}/dashboard/settings`, icon: "key" },
    { key: "step3", done: status.hasKnowledge, href: `/${locale}/dashboard/knowledge`, icon: "book" },
    { key: "step4", done: status.hasLeadAgent, href: `/${locale}/dashboard/agents`, icon: "search" },
    { key: "step5", done: status.hasEmailAgent, href: `/${locale}/dashboard/agents`, icon: "mail" },
    { key: "step6", done: status.hasReports, href: `/${locale}/dashboard/reports`, icon: "chart" },
  ] as const;

  const completedCount = steps.filter((s) => s.done).length;
  const progressPct = Math.round((completedCount / steps.length) * 100);

  function getIcon(icon: string) {
    switch (icon) {
      case "folder":
        return (
          <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z" />
          </svg>
        );
      case "key":
        return (
          <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 5.25a3 3 0 013 3m3 0a6 6 0 01-7.029 5.912c-.563-.097-1.159.026-1.563.43L10.5 17.25H8.25v2.25H6v2.25H2.25v-2.818c0-.597.237-1.17.659-1.591l6.499-6.499c.404-.404.527-1 .43-1.563A6 6 0 1121.75 8.25z" />
          </svg>
        );
      case "book":
        return (
          <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25" />
          </svg>
        );
      case "search":
        return (
          <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
          </svg>
        );
      case "mail":
        return (
          <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" />
          </svg>
        );
      case "chart":
        return (
          <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" />
          </svg>
        );
      default:
        return null;
    }
  }

  function getStatusBadge(done: boolean) {
    if (done) {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700">
          {t.completed}
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-500">
        {t.notStarted}
      </span>
    );
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
          <h1 className="text-2xl font-bold mb-4">{t.title}</h1>
          <a
            href={`/auth/login?returnTo=/${locale}/dashboard/onboarding`}
            className="bg-red-800 hover:bg-red-900 text-white px-6 py-3 rounded-lg font-medium transition-colors"
          >
            {tc.logIn}
          </a>
        </div>
      </div>
    );
  }

  return (
    <DashboardShell user={user} plan={plan}>
      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-6 sm:py-10">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 mb-2">{t.title}</h1>
          <p className="text-sm sm:text-base text-gray-500">{t.subtitle}</p>
        </div>

        {/* Progress bar */}
        <div className="mb-8 bg-white rounded-xl border border-gray-200 p-4 sm:p-6 shadow-sm">
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm font-medium text-gray-700">{t.progress}</span>
            <span className="text-sm text-gray-500">
              {t.stepsCompleted
                .replace("{done}", String(completedCount))
                .replace("{total}", String(steps.length))}
            </span>
          </div>
          <div className="w-full bg-gray-200 rounded-full h-3 overflow-hidden">
            <div
              className="h-3 rounded-full transition-all duration-500 ease-out"
              style={{
                width: `${progressPct}%`,
                background: progressPct === 100
                  ? "linear-gradient(90deg, #16a34a, #15803d)"
                  : "linear-gradient(90deg, #991b1b, #dc2626)",
              }}
            />
          </div>
        </div>

        {/* Steps */}
        <div className="space-y-4">
          {steps.map((step, idx) => {
            const stepKey = step.key as
              | "step1"
              | "step2"
              | "step3"
              | "step4"
              | "step5"
              | "step6";
            const titleKey = `${stepKey}Title` as keyof typeof t;
            const descKey = `${stepKey}Desc` as keyof typeof t;
            const actionKey = `${stepKey}Action` as keyof typeof t;

            return (
              <div
                key={step.key}
                className={`bg-white rounded-xl border shadow-sm transition-all ${
                  step.done
                    ? "border-green-200 bg-green-50/30"
                    : "border-gray-200 hover:border-red-200 hover:shadow-md"
                }`}
              >
                <div className="p-4 sm:p-6">
                  <div className="flex items-start gap-4">
                    {/* Step number / check */}
                    <div className="pt-0.5">
                      <StepNumber num={idx + 1} done={step.done} />
                    </div>

                    {/* Icon */}
                    <div
                      className={`hidden sm:flex items-center justify-center w-12 h-12 rounded-lg shrink-0 ${
                        step.done
                          ? "bg-green-100 text-green-700"
                          : "bg-red-50 text-red-800"
                      }`}
                    >
                      {getIcon(step.icon)}
                    </div>

                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-3 mb-1">
                        <h3 className="text-base sm:text-lg font-semibold text-gray-900">
                          {t[titleKey]}
                        </h3>
                        {!loading && getStatusBadge(step.done)}
                      </div>
                      <p className="text-sm text-gray-500 mb-3 leading-relaxed">
                        {t[descKey]}
                      </p>
                      <Link
                        href={step.href}
                        className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                          step.done
                            ? "bg-gray-100 text-gray-700 hover:bg-gray-200"
                            : "bg-red-800 text-white hover:bg-red-900"
                        }`}
                      >
                        {t[actionKey]}
                        <svg
                          className="w-4 h-4"
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                          strokeWidth={2}
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3"
                          />
                        </svg>
                      </Link>
                    </div>
                  </div>

                  {/* Connector line (not on last) */}
                </div>
              </div>
            );
          })}
        </div>

        {/* Vertical connector lines between cards (visible on desktop) */}
        <style jsx>{`
          @media (min-width: 640px) {
            .space-y-4 > *:not(:last-child) {
              position: relative;
            }
          }
        `}</style>
      </div>
    </DashboardShell>
  );
}
