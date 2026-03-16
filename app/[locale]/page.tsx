"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { getDictionary, type Locale } from "@/lib/i18n";
import LanguageSwitcher from "@/components/LanguageSwitcher";

function SignupForm({ t }: { t: ReturnType<typeof getDictionary>["landing"] }) {
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [selectedAgents, setSelectedAgents] = useState<string[]>([]);

  const agentChecks = [
    t.agentCheckEmail, t.agentCheckSeo, t.agentCheckLead,
    t.agentCheckSocial, t.agentCheckPm, t.agentCheckSales,
  ];

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setStatus("loading");
    const form = e.currentTarget;
    const formData = new FormData(form);
    try {
      const res = await fetch("/api/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: formData.get("name"),
          email: formData.get("email"),
          company: formData.get("company"),
          website: formData.get("website"),
          agents: selectedAgents,
          goals: formData.get("goals"),
        }),
      });
      if (res.ok) {
        setStatus("success");
        form.reset();
        setSelectedAgents([]);
      } else {
        setStatus("error");
      }
    } catch {
      setStatus("error");
    }
  };

  const toggleAgent = (agent: string) => {
    setSelectedAgents((prev) =>
      prev.includes(agent) ? prev.filter((a) => a !== agent) : [...prev, agent]
    );
  };

  if (status === "success") {
    return (
      <div className="bg-white/10 backdrop-blur rounded-xl p-8 text-center">
        <div className="text-4xl mb-4">&#10003;</div>
        <h3 className="text-xl font-bold text-white mb-2">{t.formSuccess}</h3>
        <p className="text-gray-300">{t.formSuccessMsg}</p>
        <button onClick={() => setStatus("idle")} className="mt-6 text-red-400 hover:underline text-sm">
          {t.formRegisterAnother}
        </button>
      </div>
    );
  }

  return (
    <div className="bg-white/10 backdrop-blur rounded-xl p-8 text-left">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">{t.formName}</label>
            <input name="name" type="text" required className="w-full px-4 py-2.5 bg-white/10 border border-white/20 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:border-red-400" placeholder="John Doe" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">{t.formEmail}</label>
            <input name="email" type="email" required className="w-full px-4 py-2.5 bg-white/10 border border-white/20 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:border-red-400" placeholder="you@company.com" />
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-1">{t.formCompany}</label>
          <input name="company" type="text" className="w-full px-4 py-2.5 bg-white/10 border border-white/20 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:border-red-400" />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-1">{t.formWebsite}</label>
          <input name="website" type="url" className="w-full px-4 py-2.5 bg-white/10 border border-white/20 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:border-red-400" placeholder="https://yourproduct.com" />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-1">{t.formAgents}</label>
          <div className="grid grid-cols-2 gap-2">
            {agentChecks.map((agent) => (
              <label key={agent} className="flex items-center gap-2 text-sm text-gray-300 cursor-pointer">
                <input type="checkbox" checked={selectedAgents.includes(agent)} onChange={() => toggleAgent(agent)} className="rounded border-white/30 bg-white/10 text-red-500 focus:ring-red-400" />
                {agent}
              </label>
            ))}
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-1">{t.formGoals}</label>
          <textarea name="goals" rows={3} className="w-full px-4 py-2.5 bg-white/10 border border-white/20 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:border-red-400" placeholder={t.formGoalsPlaceholder} />
        </div>
        <button type="submit" disabled={status === "loading"} className="w-full bg-red-700 hover:bg-red-800 disabled:bg-red-500/50 text-white py-3 rounded-lg font-medium transition-colors text-lg">
          {status === "loading" ? t.formSubmitting : t.formSubmit}
        </button>
        {status === "error" && <p className="text-red-400 text-sm text-center">{t.formError}</p>}
      </form>
    </div>
  );
}

export default function Home() {
  const params = useParams();
  const locale = (params.locale as Locale) || "en";
  const dict = getDictionary(locale);
  const t = dict.landing;
  const tc = dict.common;

  const [user, setUser] = useState<{ name?: string; picture?: string; email?: string } | null>(null);
  const [platformStats, setPlatformStats] = useState<{
    today: { total_tokens: number; request_count: number };
    users: number;
    nextResetUtc: string;
    user?: { todayTokens: number; dailyTokenLimit: number; remainingTokens: number | null; plan: string; unlimited: boolean };
  } | null>(null);

  useEffect(() => {
    fetch("/auth/profile")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => { if (data?.email || data?.name) setUser(data); })
      .catch(() => {});
    fetch("/api/status")
      .then((res) => res.json())
      .then((data) => setPlatformStats(data))
      .catch(() => {});
  }, []);

  const agents = [
    { icon: "M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75", title: t.agentEmailTitle, description: t.agentEmailDesc },
    { icon: "M12 21a9.004 9.004 0 008.716-6.747M12 21a9.004 9.004 0 01-8.716-6.747M12 21c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3m0 18c-2.485 0-4.5-4.03-4.5-9S9.515 3 12 3m0 0a8.997 8.997 0 017.843 4.582M12 3a8.997 8.997 0 00-7.843 4.582m15.686 0A11.953 11.953 0 0112 10.5c-2.998 0-5.74-1.1-7.843-2.918m15.686 0A8.959 8.959 0 0121 12c0 .778-.099 1.533-.284 2.253m0 0A17.919 17.919 0 0112 16.5c-3.162 0-6.133-.815-8.716-2.247m0 0A9.015 9.015 0 013 12c0-1.605.42-3.113 1.157-4.418", title: t.agentSeoTitle, description: t.agentSeoDesc },
    { icon: "M18 18.72a9.094 9.094 0 003.741-.479 3 3 0 00-4.682-2.72m.94 3.198l.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0112 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 016 18.719m12 0a5.971 5.971 0 00-.941-3.197m0 0A5.995 5.995 0 0012 12.75a5.995 5.995 0 00-5.058 2.772m0 0a3 3 0 00-4.681 2.72 8.986 8.986 0 003.74.477m.94-3.197a5.971 5.971 0 00-.94 3.197M15 6.75a3 3 0 11-6 0 3 3 0 016 0zm6 3a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0zm-13.5 0a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0z", title: t.agentLeadTitle, description: t.agentLeadDesc },
    { icon: "M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.123 2.994 2.707 3.227 1.129.166 2.27.293 3.423.379.35.026.67.21.865.501L12 21l2.755-4.133a1.14 1.14 0 01.865-.501 48.172 48.172 0 003.423-.379c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0012 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018z", title: t.agentSocialTitle, description: t.agentSocialDesc },
    { icon: "M9.568 3H5.25A2.25 2.25 0 003 5.25v4.318c0 .597.237 1.17.659 1.591l9.581 9.581c.699.699 1.78.872 2.607.33a18.095 18.095 0 005.223-5.223c.542-.827.369-1.908-.33-2.607L11.16 3.66A2.25 2.25 0 009.568 3z M6 6h.008v.008H6V6z", title: t.agentPmTitle, description: t.agentPmDesc },
    { icon: "M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z", title: t.agentSalesTitle, description: t.agentSalesDesc },
    { icon: "M10.5 6h9.75M10.5 6a1.5 1.5 0 11-3 0m3 0a1.5 1.5 0 10-3 0M3.75 6H7.5m3 12h9.75m-9.75 0a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m-3.75 0H7.5m9-6h3.75m-3.75 0a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m-9.75 0h9.75", title: t.agentOrchestratorTitle, description: t.agentOrchestratorDesc },
  ];

  const caseStudies = [
    { company: "Sienovo", industry: "Edge AI / Hardware", agents: 3, results: t.caseSienovo },
    { company: "MedTravel China", industry: "Dental Tourism", agents: 5, results: t.caseMedTravel },
    { company: "GPULaw", industry: "Legal Tech", agents: 4, results: t.caseGpuLaw },
  ];

  const pricingPlans = [
    { name: t.planStarter, price: t.planStarterPrice, period: "", description: t.planStarterDesc, features: [t.feat2Agents, t.feat100Emails, t.feat1Project, t.featFreeModels, t.featBYOK, t.featCommunity, t.featBasicTemplates], cta: t.ctaStarterFree, highlight: false, plan: "starter", disabled: false, minCommitment: false },
    { name: t.planGrowth, price: t.planGrowthPrice, period: t.perMonth, description: t.planGrowthDesc, features: [t.feat10Agents, t.feat2000Emails, t.feat5Projects, t.featCrm, t.featSeoContent, t.featSocialAuto, t.featPriority], cta: t.ctaStartTrial, highlight: true, plan: "growth", disabled: false, minCommitment: true },
    { name: t.planScale, price: t.planScalePrice, period: t.perMonth, description: t.planScaleDesc, features: [t.featUnlimitedAgents, t.feat10000Emails, t.featUnlimitedProjects, t.featCustomAgent, t.featMultiChannel, t.featAdvAnalytics, t.featDedicated, t.featWhiteLabel], cta: t.ctaGetStarted, highlight: false, plan: "scale", disabled: false, minCommitment: true },
    { name: t.planEnterprise, price: t.planEnterprisePrice, period: "", description: t.planEnterpriseDesc, features: [t.featEverythingScale, t.featDedicatedInfra, t.featCustomTraining, t.featSla, t.featSso, t.featOnPrem, t.featCustomApi, t.featAccountManager, t.featVolumeEmail], cta: t.ctaContactSales, highlight: false, plan: "enterprise", disabled: false, minCommitment: true },
  ];

  const stats = [
    { value: "30+", label: t.statSkills },
    { value: "24/7", label: t.statOperation },
    { value: "10K+", label: t.statEmails },
    { value: "3", label: t.statProducts },
  ];

  const steps = [
    { step: "1", title: t.step1Title, description: t.step1Desc },
    { step: "2", title: t.step2Title, description: t.step2Desc },
    { step: "3", title: t.step3Title, description: t.step3Desc },
  ];

  return (
    <>
      {/* Header */}
      <header className="sticky top-0 z-50 bg-white/95 backdrop-blur border-b border-gray-100">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <span className="text-2xl font-bold tracking-tight flex items-center gap-2">
              <img src="/logo.svg" alt="AutoClaw" className="w-10 h-10" />
              <span><span className="text-primary">Auto</span>Claw</span>
            </span>
            <nav className="hidden md:flex items-center gap-8 text-sm font-medium text-gray-600">
              <a href="#agents" className="hover:text-primary transition-colors">{tc.agents}</a>
              <a href="#how-it-works" className="hover:text-primary transition-colors">{t.howItWorks}</a>
              <a href="#cases" className="hover:text-primary transition-colors">{t.caseStudies}</a>
              <a href="#pricing" className="hover:text-primary transition-colors">{t.pricing}</a>
              <a href={`/${locale}/dashboard`} className="hover:text-primary transition-colors">{tc.dashboard}</a>
              <LanguageSwitcher locale={locale} />
              {user ? (
                <div className="flex items-center gap-3">
                  <a href={`/${locale}/dashboard`} className="flex items-center gap-2">
                    {user.picture ? (
                      <img src={user.picture} alt={user.name || "User"} className="w-8 h-8 rounded-full border-2 border-red-200" referrerPolicy="no-referrer" />
                    ) : (
                      <div className="w-8 h-8 rounded-full bg-primary text-white flex items-center justify-center text-sm font-bold">
                        {(user.name || user.email || "U")[0].toUpperCase()}
                      </div>
                    )}
                    <span className="text-sm text-gray-700 max-w-[100px] truncate">{user.name || user.email}</span>
                  </a>
                  <a href="/auth/logout" className="text-xs text-gray-400 hover:text-red-500 transition-colors">{tc.logOut}</a>
                </div>
              ) : (
                <a href={`/auth/login?returnTo=/${locale}/dashboard/reports`} className="bg-primary text-white px-5 py-2 rounded-lg hover:bg-primary-dark transition-colors">{t.getStarted}</a>
              )}
            </nav>
            {/* Mobile nav */}
            <div className="flex md:hidden items-center gap-3">
              <LanguageSwitcher locale={locale} />
              {user ? (
                <a href={`/${locale}/dashboard`} className="text-sm text-primary font-medium">{tc.dashboard}</a>
              ) : (
                <a href={`/auth/login?returnTo=/${locale}/dashboard/reports`} className="bg-primary text-white px-4 py-2 rounded-lg text-sm">{t.getStarted}</a>
              )}
            </div>
          </div>
        </div>
      </header>

      <main>
        {/* Hero */}
        <section className="bg-gradient-to-br from-gray-900 via-red-900 to-gray-900 text-white">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-24 md:py-36 text-center">
            <p className="text-red-300 font-semibold text-sm uppercase tracking-wider mb-4">{t.heroTag}</p>
            <h1 className="text-4xl md:text-6xl font-bold leading-tight mb-6 max-w-4xl mx-auto">
              {t.heroTitle} <span className="text-red-300">{t.heroTitleHighlight}</span>
            </h1>
            <p className="text-xl text-gray-300 mb-10 max-w-2xl mx-auto leading-relaxed">{t.heroDescription}</p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <a href={`/auth/login?returnTo=/${locale}/dashboard/reports`} className="bg-red-700 hover:bg-red-800 text-white px-8 py-4 rounded-lg font-medium text-lg transition-colors">{t.startFree}</a>
              <a href="#how-it-works" className="border border-red-400/50 hover:border-red-300 text-white px-8 py-4 rounded-lg font-medium text-lg transition-colors">{t.seeHowItWorks}</a>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-6 mt-20 pt-12 border-t border-gray-700 max-w-3xl mx-auto">
              {stats.map((stat) => (
                <div key={stat.label} className="text-center">
                  <p className="text-3xl font-bold text-white">{stat.value}</p>
                  <p className="text-gray-400 text-sm mt-1">{stat.label}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Agents */}
        <section id="agents" className="py-20 bg-white">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="text-center mb-16">
              <h2 className="text-3xl md:text-4xl font-bold mb-4">{t.agentsTitle}</h2>
              <p className="text-lg text-gray-500 max-w-2xl mx-auto">{t.agentsSubtitle}</p>
            </div>
            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8">
              {agents.map((agent) => (
                <div key={agent.title} className="p-6 rounded-xl border border-gray-100 hover:border-red-200 hover:shadow-lg transition-all group">
                  <div className="w-12 h-12 bg-red-50 rounded-lg flex items-center justify-center text-primary mb-4 group-hover:bg-primary group-hover:text-white transition-colors">
                    <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d={agent.icon} />
                    </svg>
                  </div>
                  <h3 className="text-lg font-semibold mb-2">{agent.title}</h3>
                  <p className="text-gray-500 text-sm leading-relaxed">{agent.description}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* How It Works */}
        <section id="how-it-works" className="py-20 bg-gray-50">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="text-center mb-16">
              <h2 className="text-3xl md:text-4xl font-bold mb-4">{t.howItWorksTitle}</h2>
              <p className="text-lg text-gray-500 max-w-2xl mx-auto">{t.howItWorksSubtitle}</p>
            </div>
            <div className="grid md:grid-cols-3 gap-8 max-w-4xl mx-auto">
              {steps.map((item) => (
                <div key={item.step} className="text-center">
                  <div className="w-14 h-14 bg-primary text-white rounded-full flex items-center justify-center text-xl font-bold mx-auto mb-4">{item.step}</div>
                  <h3 className="text-lg font-semibold mb-2">{item.title}</h3>
                  <p className="text-gray-500 text-sm leading-relaxed">{item.description}</p>
                </div>
              ))}
            </div>
            <div className="mt-16 bg-white rounded-xl p-8 border border-gray-100 max-w-3xl mx-auto">
              <p className="text-center text-sm font-medium text-gray-400 mb-4">{t.poweredBy}</p>
              <div className="flex flex-wrap justify-center gap-4">
                {["Claude AI", "Brevo Email", "HubSpot CRM", "GitHub", "X / Twitter", "Docker"].map((tech) => (
                  <span key={tech} className="bg-gray-50 px-4 py-2 rounded-lg text-sm font-medium text-gray-600 border border-gray-100">{tech}</span>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* Case Studies */}
        <section id="cases" className="py-20 bg-white">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="text-center mb-16">
              <h2 className="text-3xl md:text-4xl font-bold mb-4">{t.casesTitle}</h2>
              <p className="text-lg text-gray-500 max-w-2xl mx-auto">{t.casesSubtitle}</p>
            </div>
            <div className="grid md:grid-cols-3 gap-8">
              {caseStudies.map((cs) => (
                <div key={cs.company} className="rounded-xl border border-gray-100 overflow-hidden hover:shadow-lg transition-shadow">
                  <div className="bg-gradient-to-r from-red-600 to-red-700 p-6 text-white">
                    <p className="text-red-200 text-xs uppercase tracking-wider mb-1">{cs.industry}</p>
                    <h3 className="text-2xl font-bold">{cs.company}</h3>
                  </div>
                  <div className="p-6">
                    <div className="flex items-center gap-2 mb-4">
                      <span className="bg-red-50 text-primary text-sm font-semibold px-3 py-1 rounded-full">{cs.agents} {t.aiAgents}</span>
                    </div>
                    <p className="text-gray-500 text-sm leading-relaxed">{cs.results}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Live Platform Stats + User Quota */}
        {platformStats && (
          <section className="py-8 bg-white border-b border-gray-100">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
              <div className="flex flex-col sm:flex-row items-center justify-center gap-6 sm:gap-10 text-center">
                <div>
                  <p className="text-2xl font-bold">{Number(platformStats.today.total_tokens) >= 1_000_000 ? `${(Number(platformStats.today.total_tokens) / 1_000_000).toFixed(1)}M` : Number(platformStats.today.total_tokens) >= 1_000 ? `${(Number(platformStats.today.total_tokens) / 1_000).toFixed(1)}K` : String(platformStats.today.total_tokens)}</p>
                  <p className="text-xs text-gray-500">{t.statTokensToday}</p>
                </div>
                <div className="hidden sm:block w-px h-8 bg-gray-200" />
                <div>
                  <p className="text-2xl font-bold">{platformStats.users}</p>
                  <p className="text-xs text-gray-500">{t.statUsers}</p>
                </div>
                {platformStats.user && !platformStats.user.unlimited && (
                  <>
                    <div className="hidden sm:block w-px h-8 bg-gray-200" />
                    <div>
                      <div className="flex items-center gap-2">
                        <div className="w-24 bg-gray-100 rounded-full h-2 overflow-hidden">
                          <div
                            className={`h-full rounded-full ${
                              platformStats.user.todayTokens / platformStats.user.dailyTokenLimit > 0.9 ? "bg-red-500" :
                              platformStats.user.todayTokens / platformStats.user.dailyTokenLimit > 0.7 ? "bg-yellow-500" : "bg-green-500"
                            }`}
                            style={{ width: `${Math.min(100, (platformStats.user.todayTokens / platformStats.user.dailyTokenLimit) * 100)}%` }}
                          />
                        </div>
                        <span className="text-sm font-bold">
                          {platformStats.user.remainingTokens !== null
                            ? (platformStats.user.remainingTokens >= 1_000_000
                              ? `${(platformStats.user.remainingTokens / 1_000_000).toFixed(1)}M`
                              : platformStats.user.remainingTokens >= 1_000
                              ? `${(platformStats.user.remainingTokens / 1_000).toFixed(0)}K`
                              : String(platformStats.user.remainingTokens))
                            : "0"}
                        </span>
                      </div>
                      <p className="text-xs text-gray-500">{t.statFreeRemaining}</p>
                    </div>
                  </>
                )}
                <div className="hidden sm:block w-px h-8 bg-gray-200" />
                <Link href={`/${locale}/status`} className="text-xs text-red-600 hover:text-red-700 font-medium">
                  {t.statViewStatus} &rarr;
                </Link>
              </div>
            </div>
          </section>
        )}

        {/* Pricing */}
        <section id="pricing" className="py-20 bg-gray-50">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="text-center mb-16">
              <h2 className="text-3xl md:text-4xl font-bold mb-4">{t.pricingTitle}</h2>
              <p className="text-lg text-gray-500 max-w-2xl mx-auto">{t.pricingSubtitle}</p>
            </div>
            <p className="text-center text-sm text-gray-500 mb-8">{t.planMinCommitment}</p>
            <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6 max-w-6xl mx-auto">
              {pricingPlans.map((plan) => (
                <div key={plan.name} className={`rounded-xl p-8 relative flex flex-col ${plan.highlight ? "bg-primary text-white ring-4 ring-red-200 scale-105" : plan.disabled ? "bg-gray-50 border border-gray-200 opacity-60" : "bg-white border border-gray-200"}`}>
                  {plan.disabled && <span className="absolute top-3 right-3 bg-gray-200 text-gray-500 text-xs font-medium px-2 py-0.5 rounded-full">{t.planComingSoon}</span>}
                  <h3 className={`text-lg font-semibold mb-1 ${plan.highlight ? "text-red-100" : "text-gray-500"}`}>{plan.name}</h3>
                  <div className="mb-6" />
                  <ul className="space-y-3 mb-8 flex-1">
                    {plan.features.map((feature) => (
                      <li key={feature} className="flex items-start gap-2 text-sm">
                        <svg className={`w-5 h-5 shrink-0 mt-0.5 ${plan.highlight ? "text-red-200" : plan.disabled ? "text-gray-400" : "text-green-500"}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                        </svg>
                        {feature}
                      </li>
                    ))}
                  </ul>
                  <button
                    disabled={plan.disabled}
                    onClick={async () => {
                      if (plan.disabled) return;
                      if (plan.plan === "enterprise") {
                        window.location.href = locale === "en" ? "mailto:jay.lin@jytech.us?subject=AutoClaw Enterprise Plan Inquiry" : "tel:+8617318011997";
                      } else if (plan.plan === "starter") {
                        window.location.href = `/auth/login?returnTo=/${locale}/dashboard/reports`;
                      } else {
                        try {
                          const res = await fetch("/api/checkout", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ plan: plan.plan }) });
                          const data = await res.json();
                          if (data.url) window.location.href = data.url;
                        } catch { window.location.href = `/auth/login?returnTo=/${locale}/dashboard/reports`; }
                      }
                    }}
                    className={`block w-full text-center py-3 rounded-lg font-medium transition-colors ${plan.disabled ? "bg-gray-300 text-gray-500 cursor-not-allowed" : plan.highlight ? "bg-white text-primary hover:bg-red-50 cursor-pointer" : "bg-primary text-white hover:bg-primary-dark cursor-pointer"}`}
                  >
                    {plan.cta}
                  </button>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Signup */}
        <section id="signup" className="py-20 bg-gradient-to-br from-slate-900 via-red-950 to-slate-900 text-white">
          <div className="max-w-xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
            <h2 className="text-3xl md:text-4xl font-bold mb-4">{t.signupTitle}</h2>
            <p className="text-lg text-gray-300 mb-8">{t.signupSubtitle}</p>
            <SignupForm t={t} />
            <p className="text-gray-400 text-sm mt-6">
              {t.questionsEmail}{" "}
              {locale === "en" ? (
                <a href="mailto:jay.lin@jytech.us" className="text-red-400 hover:underline">jay.lin@jytech.us</a>
              ) : (
                <a href="tel:+8617318011997" className="text-red-400 hover:underline">Helen Lan +86 17318011997</a>
              )}
            </p>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="bg-slate-900 text-gray-400 border-t border-gray-800">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
          <div className="grid md:grid-cols-3 gap-8">
            <div>
              <p className="text-xl font-bold text-white mb-2"><span className="text-red-400">Auto</span>Claw</p>
              <p className="text-sm leading-relaxed">{t.footerDesc}</p>
            </div>
            <div>
              <p className="font-semibold text-white mb-3 text-sm">{t.footerPlatform}</p>
              <ul className="space-y-2 text-sm">
                <li><a href="#agents" className="hover:text-white transition-colors">{t.footerAiAgents}</a></li>
                <li><a href="#cases" className="hover:text-white transition-colors">{t.footerCaseStudies}</a></li>
                <li><a href="#pricing" className="hover:text-white transition-colors">{t.pricing}</a></li>
              </ul>
            </div>
            <div>
              <p className="font-semibold text-white mb-3 text-sm">{t.footerContact}</p>
              <ul className="space-y-2 text-sm">
                {locale === "en" ? (
                  <li><a href="mailto:jay.lin@jytech.us" className="hover:text-white transition-colors">jay.lin@jytech.us</a></li>
                ) : (
                  <li><a href="tel:+8617318011997" className="hover:text-white transition-colors">Helen Lan +86 17318011997</a></li>
                )}
                <li><a href="https://jytech.us" target="_blank" rel="noopener noreferrer" className="hover:text-white transition-colors">jytech.us</a></li>
                <li><a href="https://xpilot.jytech.us/" target="_blank" rel="noopener noreferrer" className="hover:text-white transition-colors">xPilot — AI Social Media Copilot</a></li>
              </ul>
            </div>
          </div>
          <div className="border-t border-gray-800 mt-8 pt-8 text-center text-xs flex flex-col sm:flex-row items-center justify-center gap-2">
            <p>&copy; {new Date().getFullYear()} {t.footerRights}</p>
            <span className="hidden sm:inline text-gray-600">|</span>
            <a href={`/${locale}/terms`} className="hover:text-white transition-colors">{t.footerTerms}</a>
            <span className="hidden sm:inline text-gray-600">|</span>
            <a href={`/${locale}/privacy`} className="hover:text-white transition-colors">{t.footerPrivacy}</a>
            <span className="hidden sm:inline text-gray-600">|</span>
            <a href={`/${locale}/changelog`} className="hover:text-white transition-colors">{t.footerChangelog}</a>
          </div>
        </div>
      </footer>
    </>
  );
}
