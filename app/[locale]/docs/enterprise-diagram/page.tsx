"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { getDictionary, type Locale } from "@/lib/i18n";
import LanguageSwitcher from "@/components/LanguageSwitcher";

export default function EnterpriseDiagramPage() {
  const params = useParams();
  const locale = (params.locale as Locale) || "en";
  const dict = getDictionary(locale);
  const tc = dict.common;
  const t = dict.enterpriseDiagram;

  const agents = [
    { label: t.agentEmail, x: 465, y: 110 },
    { label: t.agentSeo, x: 465, y: 155 },
    { label: t.agentLead, x: 465, y: 200 },
    { label: t.agentSocial, x: 660, y: 110 },
    { label: t.agentSales, x: 660, y: 155 },
    { label: t.agentProduct, x: 660, y: 200 },
    { label: t.agentOrchestrator, x: 855, y: 110 },
    { label: t.agentCustom, x: 855, y: 155 },
  ];

  const clientFeatures = [
    { label: t.clientFeature1, x: 305, y: 450 },
    { label: t.clientFeature2, x: 305, y: 490 },
    { label: t.clientFeature3, x: 305, y: 530 },
    { label: t.clientFeature4, x: 555, y: 450 },
    { label: t.clientFeature5, x: 555, y: 490 },
    { label: t.clientFeature6, x: 555, y: 530 },
  ];

  const jytechServices = [t.jytechService1, t.jytechService2, t.jytechService3];

  const mobileAgents = [t.agentEmail, t.agentSeo, t.agentLead, t.agentSocial, t.agentSales, t.agentProduct, t.agentOrchestrator, t.agentCustom];

  const mobileClientFeatures = [t.clientFeature1, t.clientFeature2, t.clientFeature3, t.clientFeature4, t.clientFeature5, t.clientFeature6];

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-950 via-gray-900 to-gray-950 text-white">
      {/* Header */}
      <header className="border-b border-white/10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-4 flex items-center justify-between">
          <Link href={`/${locale}`} className="flex items-center gap-2">
            <img src="/logo.svg" alt="AutoClaw" className="h-8 w-8" />
            <span className="font-bold text-lg">AutoClaw</span>
          </Link>
          <div className="flex items-center gap-4">
            <LanguageSwitcher locale={locale} />
            <Link
              href={`/${locale}/docs`}
              className="text-sm text-gray-400 hover:text-white transition-colors"
            >
              {tc.docs || "Docs"}
            </Link>
          </div>
        </div>
      </header>

      {/* Title */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 pt-12 pb-6 text-center">
        <h1 className="text-3xl sm:text-4xl font-bold mb-3 bg-gradient-to-r from-white via-gray-200 to-gray-400 bg-clip-text text-transparent">
          {t.title}
        </h1>
        <p className="text-gray-400 text-base max-w-2xl mx-auto">
          {t.subtitle}
        </p>
      </section>

      {/* Diagram */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 pb-20">
        <div className="relative">
          {/* Desktop Diagram (hidden on mobile) */}
          <div className="hidden lg:block">
            <svg viewBox="0 0 1100 620" className="w-full" xmlns="http://www.w3.org/2000/svg">
              {/* Defs */}
              <defs>
                <marker id="arrowRed" markerWidth="10" markerHeight="7" refX="10" refY="3.5" orient="auto">
                  <polygon points="0 0, 10 3.5, 0 7" fill="#ef4444" />
                </marker>
                <marker id="arrowBlue" markerWidth="10" markerHeight="7" refX="10" refY="3.5" orient="auto">
                  <polygon points="0 0, 10 3.5, 0 7" fill="#3b82f6" />
                </marker>
                <marker id="arrowGreen" markerWidth="10" markerHeight="7" refX="10" refY="3.5" orient="auto">
                  <polygon points="0 0, 10 3.5, 0 7" fill="#22c55e" />
                </marker>
                <marker id="arrowAmber" markerWidth="10" markerHeight="7" refX="10" refY="3.5" orient="auto">
                  <polygon points="0 0, 10 3.5, 0 7" fill="#f59e0b" />
                </marker>
                <linearGradient id="jytechGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stopColor="#3b82f6" stopOpacity="0.15" />
                  <stop offset="100%" stopColor="#6366f1" stopOpacity="0.15" />
                </linearGradient>
                <linearGradient id="platformGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stopColor="#ef4444" stopOpacity="0.15" />
                  <stop offset="100%" stopColor="#f97316" stopOpacity="0.15" />
                </linearGradient>
                <linearGradient id="clientGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stopColor="#22c55e" stopOpacity="0.15" />
                  <stop offset="100%" stopColor="#14b8a6" stopOpacity="0.15" />
                </linearGradient>
              </defs>

              {/* ===== JY Tech Box (Top Left) ===== */}
              <rect x="30" y="30" width="320" height="260" rx="16" fill="url(#jytechGrad)" stroke="#3b82f6" strokeWidth="1.5" strokeOpacity="0.5" />
              <text x="190" y="68" textAnchor="middle" fill="#60a5fa" fontSize="20" fontWeight="700">{t.jytech}</text>
              <text x="190" y="90" textAnchor="middle" fill="#94a3b8" fontSize="12">{t.jytechDesc}</text>
              {/* Services */}
              <rect x="55" y="110" width="270" height="38" rx="8" fill="white" fillOpacity="0.05" stroke="white" strokeOpacity="0.1" />
              <text x="70" y="134" fill="#93c5fd" fontSize="13">{t.jytechService1}</text>
              <rect x="55" y="158" width="270" height="38" rx="8" fill="white" fillOpacity="0.05" stroke="white" strokeOpacity="0.1" />
              <text x="70" y="182" fill="#93c5fd" fontSize="13">{t.jytechService2}</text>
              <rect x="55" y="206" width="270" height="38" rx="8" fill="white" fillOpacity="0.05" stroke="white" strokeOpacity="0.1" />
              <text x="70" y="230" fill="#93c5fd" fontSize="13">{t.jytechService3}</text>
              <rect x="55" y="254" width="270" height="24" rx="6" fill="white" fillOpacity="0.03" />
              <text x="190" y="271" textAnchor="middle" fill="#64748b" fontSize="11">{t.jytechTeam}</text>

              {/* ===== AutoClaw Platform Box (Top Right) ===== */}
              <rect x="440" y="30" width="630" height="260" rx="16" fill="url(#platformGrad)" stroke="#ef4444" strokeWidth="1.5" strokeOpacity="0.5" />
              <text x="755" y="68" textAnchor="middle" fill="#f87171" fontSize="20" fontWeight="700">{t.platform}</text>
              <text x="755" y="90" textAnchor="middle" fill="#94a3b8" fontSize="12">{t.platformDesc}</text>
              {/* AI Employees Grid */}
              {agents.map((item, i) => (
                <g key={i}>
                  <rect x={item.x} y={item.y} width="175" height="34" rx="8" fill="white" fillOpacity="0.05" stroke="white" strokeOpacity="0.1" />
                  <circle cx={item.x + 18} cy={item.y + 17} r="5" fill="#ef4444" fillOpacity="0.6" />
                  <text x={item.x + 30} y={item.y + 22} fill="#fca5a5" fontSize="12">{item.label}</text>
                </g>
              ))}
              {/* Infrastructure badges */}
              <rect x="855" y="200" width="175" height="34" rx="8" fill="white" fillOpacity="0.05" stroke="white" strokeOpacity="0.1" />
              <text x="942" y="222" textAnchor="middle" fill="#94a3b8" fontSize="11">{t.platformInfra}</text>
              <rect x="465" y="248" width="230" height="24" rx="6" fill="white" fillOpacity="0.03" />
              <text x="580" y="265" textAnchor="middle" fill="#64748b" fontSize="11">{t.platformFeatures}</text>

              {/* ===== Enterprise Client Box (Bottom Center) ===== */}
              <rect x="280" y="370" width="540" height="220" rx="16" fill="url(#clientGrad)" stroke="#22c55e" strokeWidth="1.5" strokeOpacity="0.5" />
              <text x="550" y="408" textAnchor="middle" fill="#4ade80" fontSize="20" fontWeight="700">{t.client}</text>
              <text x="550" y="430" textAnchor="middle" fill="#94a3b8" fontSize="12">{t.clientDesc}</text>
              {/* Client features */}
              {clientFeatures.map((item, i) => (
                <g key={i}>
                  <rect x={item.x} y={item.y} width="230" height="30" rx="6" fill="white" fillOpacity="0.05" stroke="white" strokeOpacity="0.1" />
                  <circle cx={item.x + 15} cy={item.y + 15} r="4" fill="#22c55e" fillOpacity="0.6" />
                  <text x={item.x + 28} y={item.y + 20} fill="#86efac" fontSize="12">{item.label}</text>
                </g>
              ))}

              {/* ===== Arrows ===== */}

              {/* JY Tech -> AutoClaw Platform: Monitors */}
              <line x1="350" y1="120" x2="430" y2="120" stroke="#3b82f6" strokeWidth="2" strokeDasharray="6 3" markerEnd="url(#arrowBlue)" />
              <rect x="355" y="100" width="75" height="18" rx="4" fill="#1e293b" />
              <text x="392" y="113" textAnchor="middle" fill="#60a5fa" fontSize="10">{t.arrowMonitors}</text>

              {/* AutoClaw Platform -> Enterprise Client: Deploys AI Agents */}
              <line x1="650" y1="295" x2="600" y2="362" stroke="#ef4444" strokeWidth="2" markerEnd="url(#arrowRed)" />
              <rect x="588" y="310" width="110" height="18" rx="4" fill="#1e293b" />
              <text x="643" y="323" textAnchor="middle" fill="#f87171" fontSize="10">{t.arrowDeploys}</text>

              {/* Enterprise Client -> AutoClaw Platform: Subscribes */}
              <line x1="500" y1="365" x2="540" y2="298" stroke="#22c55e" strokeWidth="2" strokeDasharray="6 3" markerEnd="url(#arrowGreen)" />
              <rect x="470" y="315" width="75" height="18" rx="4" fill="#1e293b" />
              <text x="507" y="328" textAnchor="middle" fill="#4ade80" fontSize="10">{t.arrowSubscribes}</text>

              {/* JY Tech -> Enterprise Client: Joins Projects */}
              <line x1="190" y1="295" x2="350" y2="420" stroke="#f59e0b" strokeWidth="2" markerEnd="url(#arrowAmber)" />
              <rect x="195" y="345" width="130" height="18" rx="4" fill="#1e293b" />
              <text x="260" y="358" textAnchor="middle" fill="#fbbf24" fontSize="10">{t.arrowJoinsProjects}</text>

              {/* Enterprise Client -> JY Tech: Invites */}
              <line x1="320" y1="440" x2="170" y2="295" stroke="#22c55e" strokeWidth="2" strokeDasharray="6 3" markerEnd="url(#arrowGreen)" />
              <rect x="180" y="370" width="130" height="18" rx="4" fill="#1e293b" />
              <text x="245" y="383" textAnchor="middle" fill="#4ade80" fontSize="10">{t.arrowInvites}</text>

              {/* JY Tech -> Platform: Operates */}
              <line x1="350" y1="200" x2="430" y2="200" stroke="#3b82f6" strokeWidth="2" markerEnd="url(#arrowBlue)" />
              <rect x="355" y="180" width="75" height="18" rx="4" fill="#1e293b" />
              <text x="392" y="193" textAnchor="middle" fill="#60a5fa" fontSize="10">{t.arrowOperates}</text>
            </svg>
          </div>

          {/* Mobile Diagram (visible on small screens) */}
          <div className="lg:hidden space-y-6">
            {/* JY Tech Card */}
            <div className="rounded-2xl border border-blue-500/30 bg-blue-500/10 p-5">
              <h3 className="text-lg font-bold text-blue-400 mb-1">{t.jytech}</h3>
              <p className="text-xs text-gray-400 mb-3">{t.jytechDesc}</p>
              <div className="space-y-2">
                {jytechServices.map((s, i) => (
                  <div key={i} className="bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-blue-300">{s}</div>
                ))}
              </div>
              <p className="text-[11px] text-gray-500 mt-3">{t.jytechTeam}</p>
            </div>

            {/* Arrow down */}
            <div className="flex flex-col items-center gap-1 text-gray-500">
              <div className="flex gap-6">
                <span className="text-xs text-blue-400">{t.arrowMonitorsOperates}</span>
                <span className="text-xs text-amber-400">{t.arrowJoinsClientProjects}</span>
              </div>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none"><path d="M12 4v14m0 0l-5-5m5 5l5-5" stroke="#64748b" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
            </div>

            {/* AutoClaw Platform Card */}
            <div className="rounded-2xl border border-red-500/30 bg-red-500/10 p-5">
              <h3 className="text-lg font-bold text-red-400 mb-1">{t.platform}</h3>
              <p className="text-xs text-gray-400 mb-3">{t.platformDesc}</p>
              <div className="grid grid-cols-2 gap-2">
                {mobileAgents.map((s, i) => (
                  <div key={i} className="bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-xs text-red-300 flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-red-400/60 shrink-0" />
                    {s}
                  </div>
                ))}
              </div>
              <div className="mt-3 bg-white/5 rounded-lg px-3 py-1.5 text-[11px] text-gray-500 text-center">
                {t.platformFeatures} / {t.platformInfra}
              </div>
            </div>

            {/* Arrow down */}
            <div className="flex flex-col items-center gap-1 text-gray-500">
              <div className="flex gap-6">
                <span className="text-xs text-green-400">{t.arrowSubscribes}</span>
                <span className="text-xs text-red-400">{t.arrowDeploys}</span>
              </div>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none"><path d="M12 4v14m0 0l-5-5m5 5l5-5" stroke="#64748b" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
            </div>

            {/* Enterprise Client Card */}
            <div className="rounded-2xl border border-green-500/30 bg-green-500/10 p-5">
              <h3 className="text-lg font-bold text-green-400 mb-1">{t.client}</h3>
              <p className="text-xs text-gray-400 mb-3">{t.clientDesc}</p>
              <div className="grid grid-cols-2 gap-2">
                {mobileClientFeatures.map((s, i) => (
                  <div key={i} className="bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-xs text-green-300 flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-green-400/60 shrink-0" />
                    {s}
                  </div>
                ))}
              </div>
            </div>

            {/* Invite relationship */}
            <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-center">
              <p className="text-sm text-amber-300 font-medium">{t.inviteTitle}</p>
              <p className="text-xs text-gray-400 mt-1">{t.inviteDesc}</p>
            </div>
          </div>

          {/* Legend */}
          <div className="mt-8 flex flex-wrap justify-center gap-4 sm:gap-6 text-xs text-gray-400">
            <div className="flex items-center gap-2">
              <span className="w-3 h-3 rounded-full bg-blue-500/60" />
              <span>{t.legendJytech}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-3 h-3 rounded-full bg-red-500/60" />
              <span>{t.legendPlatform}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-3 h-3 rounded-full bg-green-500/60" />
              <span>{t.legendClient}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-3 h-0.5 bg-amber-500" />
              <span>{t.legendInvite}</span>
            </div>
          </div>
        </div>

        {/* Relationship Details */}
        <div className="mt-12 grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* Card 1 */}
          <div className="bg-white/5 backdrop-blur border border-white/10 rounded-2xl p-6 hover:border-blue-500/40 transition-all">
            <div className="w-10 h-10 rounded-xl bg-blue-500/20 flex items-center justify-center mb-4">
              <svg className="w-5 h-5 text-blue-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 3v11.25A2.25 2.25 0 006 16.5h2.25M3.75 3h-1.5m1.5 0h16.5m0 0h1.5m-1.5 0v11.25A2.25 2.25 0 0118 16.5h-2.25m-7.5 0h7.5m-7.5 0l-1 3m8.5-3l1 3m0 0l.5 1.5m-.5-1.5h-9.5m0 0l-.5 1.5" />
              </svg>
            </div>
            <h3 className="font-semibold text-white mb-2">{t.cardMonitorTitle}</h3>
            <p className="text-sm text-gray-400">{t.cardMonitorDesc}</p>
          </div>

          {/* Card 2 */}
          <div className="bg-white/5 backdrop-blur border border-white/10 rounded-2xl p-6 hover:border-red-500/40 transition-all">
            <div className="w-10 h-10 rounded-xl bg-red-500/20 flex items-center justify-center mb-4">
              <svg className="w-5 h-5 text-red-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 00-2.455 2.456zM16.894 20.567L16.5 21.75l-.394-1.183a2.25 2.25 0 00-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 001.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 001.423 1.423l1.183.394-1.183.394a2.25 2.25 0 00-1.423 1.423z" />
              </svg>
            </div>
            <h3 className="font-semibold text-white mb-2">{t.cardDeployTitle}</h3>
            <p className="text-sm text-gray-400">{t.cardDeployDesc}</p>
          </div>

          {/* Card 3 */}
          <div className="bg-white/5 backdrop-blur border border-white/10 rounded-2xl p-6 hover:border-amber-500/40 transition-all">
            <div className="w-10 h-10 rounded-xl bg-amber-500/20 flex items-center justify-center mb-4">
              <svg className="w-5 h-5 text-amber-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M18 18.72a9.094 9.094 0 003.741-.479 3 3 0 00-4.682-2.72m.94 3.198l.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0112 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 016 18.719m12 0a5.971 5.971 0 00-.941-3.197m0 0A5.995 5.995 0 0012 12.75a5.995 5.995 0 00-5.058 2.772m0 0a3 3 0 00-4.681 2.72 8.986 8.986 0 003.74.477m.94-3.197a5.971 5.971 0 00-.94 3.197M15 6.75a3 3 0 11-6 0 3 3 0 016 0zm6 3a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0zm-13.5 0a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0z" />
              </svg>
            </div>
            <h3 className="font-semibold text-white mb-2">{t.cardCollabTitle}</h3>
            <p className="text-sm text-gray-400">{t.cardCollabDesc}</p>
          </div>
        </div>
      </section>

      {/* Contact */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 pb-16">
        <div className="bg-white/5 backdrop-blur border border-white/10 rounded-2xl p-6 text-center">
          <h3 className="font-semibold text-white mb-2">{t.needHelp}</h3>
          <p className="text-sm text-gray-400">
            {t.contactUs}{" "}
            <a href="mailto:leo.liu@jytech.us" className="text-red-400 hover:text-red-300 transition-colors">Yanlei Liu (leo.liu@jytech.us)</a>
          </p>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-white/10 py-8 text-center text-xs text-gray-500">
        &copy; {new Date().getFullYear()} AutoClaw by JY Tech. All rights reserved.
      </footer>
    </div>
  );
}
