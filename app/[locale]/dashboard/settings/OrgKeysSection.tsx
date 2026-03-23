"use client";

import { useState } from "react";

interface Org {
  id: number;
  name: string;
  domain: string | null;
  member_role: string | null;
  member_count: number;
  project_count: number;
}

interface OrgKeysSectionProps {
  orgs: Org[];
  orgKeys: { id: number; org_id: number; org_name: string; service: string; label: string | null; masked_key: string; updated_at: string }[];
  setOrgKeys: React.Dispatch<React.SetStateAction<{ id: number; org_id: number; org_name: string; service: string; label: string | null; masked_key: string; updated_at: string }[]>>;
  apiKeys: { id: number; service: string; masked_key: string; label: string | null; updated_at: string }[];
  collapsed: boolean;
  setCollapsed: (collapsed: boolean) => void;
  ts: Record<string, any>;
  tc: Record<string, any>;
}

export default function OrgKeysSection({ orgs, orgKeys, setOrgKeys, apiKeys, collapsed, setCollapsed, ts, tc }: OrgKeysSectionProps) {
  const [selectedOrgForKeys, setSelectedOrgForKeys] = useState<number | null>(null);
  const [orgKeyEditing, setOrgKeyEditing] = useState<string | null>(null);
  const [orgKeyInput, setOrgKeyInput] = useState("");
  const [orgKeyLabelInput, setOrgKeyLabelInput] = useState("");
  const [orgKeySaving, setOrgKeySaving] = useState(false);
  const [orgKeyMsg, setOrgKeyMsg] = useState("");
  const [orgKeyRevealed, setOrgKeyRevealed] = useState<Record<string, string>>({});

  return (
    <div id="section-orgkeys" className="bg-white rounded-lg border border-gray-200 mb-6 overflow-hidden">
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="w-full flex items-center justify-between p-6 cursor-pointer hover:bg-gray-50 transition-colors"
      >
        <div className="text-left">
          <h2 className="text-lg font-semibold">{ts.orgKeysTitle || "Organization API Keys"}</h2>
          <p className="text-sm text-gray-500">{ts.orgKeysDesc}</p>
        </div>
        <svg className={`w-5 h-5 text-gray-400 transition-transform ${collapsed ? "" : "rotate-180"}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {!collapsed && <div className="px-6 pb-6 border-t border-gray-100 pt-4">
        {/* Org selector (only orgs where user is admin/operator) */}
        {(() => {
          const adminOrgs = orgs.filter((o) => o.member_role === "admin" || o.member_role === "operator");
          return adminOrgs.length > 1 ? (
            <div className="mb-4">
              <label className="text-xs font-medium text-gray-500 mb-1 block">{ts.orgKeysSelectOrg}</label>
              <select
                value={selectedOrgForKeys || adminOrgs[0]?.id || ""}
                onChange={(e) => setSelectedOrgForKeys(Number(e.target.value))}
                className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm w-full max-w-xs"
              >
                {adminOrgs.map((o) => (
                  <option key={o.id} value={o.id}>{o.name}</option>
                ))}
              </select>
            </div>
          ) : null;
        })()}

        {(() => {
          const adminOrgs = orgs.filter((o) => o.member_role === "admin" || o.member_role === "operator");
          const activeOrgId = selectedOrgForKeys || adminOrgs[0]?.id;
          if (!activeOrgId) return null;
          const activeOrg = orgs.find((o) => o.id === activeOrgId);

          const services = [
            { service: "openai", name: ts.byokOpenai, hint: ts.byokOpenaiHint, tier: "freemium" as const, tierInfo: ts.byokOpenaiTier },
            { service: "anthropic", name: ts.byokAnthropic, hint: ts.byokAnthropicHint, tier: "freemium" as const, tierInfo: ts.byokAnthropicTier },
            { service: "google", name: ts.byokGoogle, hint: ts.byokGoogleHint, tier: "free" as const, tierInfo: ts.byokGoogleTier },
            { service: "alibaba", name: ts.byokAlibaba, hint: ts.byokAlibabaHint, tier: "free" as const, tierInfo: ts.byokAlibabaTier },
            { service: "cerebras", name: ts.byokCerebras, hint: ts.byokCerebrasHint, tier: "free" as const, tierInfo: ts.byokCerebrasTier },
            { service: "vercel", name: ts.byokVercel, hint: ts.byokVercelHint, tier: "free" as const, tierInfo: ts.byokVercelTier },
            { service: "clawhub", name: ts.byokClawhub, hint: ts.byokClawhubHint, tier: "free" as const, tierInfo: ts.byokClawhubTier },
            { service: "xpilot", name: ts.byokXpilot, hint: ts.byokXpilotHint, tier: "free" as const, tierInfo: ts.byokXpilotTier },
            { service: "blob_token", name: ts.byokBlobToken, hint: ts.byokBlobTokenHint, tier: "free" as const, tierInfo: ts.byokBlobTokenTier },
            { service: "brevo", name: ts.byokBravo, hint: ts.byokBrevoHint, tier: "free" as const, tierInfo: ts.byokBrevoTier },
            { service: "sendgrid", name: ts.byokSendGrid, hint: ts.byokSendGridHint, tier: "free" as const, tierInfo: ts.byokSendGridTier },
            { service: "smtp_host", name: "SMTP Host", hint: "Gmail: smtp.gmail.com | Outlook: smtp-mail.outlook.com", tier: "free" as const, tierInfo: "Use your own email server" },
            { service: "smtp_port", name: "SMTP Port", hint: "Usually 587 (TLS) or 465 (SSL)", tier: "free" as const, tierInfo: "587 for most providers" },
            { service: "smtp_user", name: "SMTP Username", hint: "Your email address", tier: "free" as const, tierInfo: "Gmail/Outlook: full email" },
            { service: "smtp_pass", name: "SMTP Password", hint: "Gmail: App Password | Outlook: your password", tier: "free" as const, tierInfo: "Gmail: App Passwords" },
            { service: "smtp_from", name: "SMTP From Email", hint: "Sender email for recipients", tier: "free" as const, tierInfo: "Must match SMTP provider" },
            { service: "tavily", name: ts.byokTavily || "Tavily", hint: ts.byokTavilyHint || "AI-optimized web search. Get key at tavily.com.", tier: "freemium" as const, tierInfo: ts.byokTavilyTier || "Free: 1000 searches/mo. Pro: $20/mo." },
            { service: "firecrawl", name: "Firecrawl", hint: "Web scraping with JS rendering. Get key at firecrawl.dev.", tier: "freemium" as const, tierInfo: "Free: 500 pages/mo. Starter: $19/mo." },
            { service: "apollo", name: ts.byokApollo || "Apollo", hint: ts.byokApolloHint, tier: "freemium" as const, tierInfo: ts.byokApolloTier },
            { service: "apify", name: ts.byokApify || "Apify", hint: ts.byokApifyHint, tier: "freemium" as const, tierInfo: ts.byokApifyTier },
            { service: "hunter", name: ts.byokHunter || "Hunter", hint: ts.byokHunterHint, tier: "freemium" as const, tierInfo: ts.byokHunterTier },
            { service: "pdl", name: "People Data Labs", hint: "Phone number enrichment. Get key at peopledatalabs.com.", tier: "freemium" as const, tierInfo: "Free: 100/mo. Pay-as-you-go: $0.10/record." },
            { service: "abstract", name: "Abstract API", hint: "Phone validation, company enrichment. Get key at abstractapi.com.", tier: "freemium" as const, tierInfo: "Free: 100/mo. Starter: $17/mo." },
          ];

          // Snov.io needs special handling (2 keys: snov_id + snov_secret)
          const snovOrgId = orgKeys.find((k) => k.org_id === activeOrgId && k.service === "snov_id");
          const snovOrgSecret = orgKeys.find((k) => k.org_id === activeOrgId && k.service === "snov_secret");
          const snovPersonalId = apiKeys.find((k) => k.service === "snov_id" || k.service === "snov_api_id");
          const snovPersonalSecret = apiKeys.find((k) => k.service === "snov_secret" || k.service === "snov_api_secret");
          const snovOrgConfigured = snovOrgId && snovOrgSecret;
          const snovPersonalExists = snovPersonalId && snovPersonalSecret;
          const isEditingOrgSnov = orgKeyEditing === `org_${activeOrgId}_snov`;

          // Helper: copy a personal key to org
          const copyPersonalToOrg = async (service: string) => {
            try {
              const revealRes = await fetch("/api/api-keys", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ action: "reveal", service }),
              });
              const revealData = await revealRes.json();
              if (!revealRes.ok || !revealData.api_key) return false;

              const upsertRes = await fetch("/api/api-keys", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ action: "org_upsert", org_id: activeOrgId, service, api_key: revealData.api_key, label: "Copied from personal" }),
              });
              return upsertRes.ok;
            } catch { return false; }
          };

          // Personal keys that exist but org doesn't have
          const personalOnlyServices = services.filter(
            (svc) => apiKeys.some((k) => k.service === svc.service) && !orgKeys.some((k) => k.org_id === activeOrgId && k.service === svc.service)
          );

          return (
            <div className="space-y-3">
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs text-gray-400">
                  {activeOrg?.name} — {ts.orgKeysDesc?.split(".")[0] || "Shared keys for the organization"}
                </p>
                {personalOnlyServices.length > 0 && (
                  <button
                    onClick={async () => {
                      setOrgKeySaving(true);
                      let count = 0;
                      for (const svc of personalOnlyServices) {
                        const ok = await copyPersonalToOrg(svc.service);
                        if (ok) count++;
                      }
                      const data = await fetch("/api/api-keys").then((r) => r.json());
                      setOrgKeys(data.orgKeys || []);
                      setOrgKeySaving(false);
                      setOrgKeyMsg(ts.orgKeysCopiedAll?.replace("{count}", String(count)) || `Copied ${count} keys from personal`);
                      setTimeout(() => setOrgKeyMsg(""), 3000);
                    }}
                    disabled={orgKeySaving}
                    className="text-xs bg-blue-50 text-blue-700 hover:bg-blue-100 border border-blue-200 px-3 py-1 rounded-lg font-medium transition-colors cursor-pointer disabled:opacity-50 flex items-center gap-1"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 17.25v3.375c0 .621-.504 1.125-1.125 1.125h-9.75a1.125 1.125 0 01-1.125-1.125V7.875c0-.621.504-1.125 1.125-1.125H6.75a9.06 9.06 0 011.5.124m7.5 10.376h3.375c.621 0 1.125-.504 1.125-1.125V11.25c0-4.46-3.243-8.161-7.5-8.876a9.06 9.06 0 00-1.5-.124H9.375c-.621 0-1.125.504-1.125 1.125v3.5m7.5 10.375H9.375a1.125 1.125 0 01-1.125-1.125v-9.25m12 6.625v-1.875a3.375 3.375 0 00-3.375-3.375h-1.5a1.125 1.125 0 01-1.125-1.125v-1.5a3.375 3.375 0 00-3.375-3.375H9.75" /></svg>
                    {ts.orgKeysCopyAll || `Copy all personal keys (${personalOnlyServices.length})`}
                  </button>
                )}
              </div>
              {services.map((svc) => {
                const existing = orgKeys.find((k) => k.org_id === activeOrgId && k.service === svc.service);
                const personalKey = apiKeys.find((k) => k.service === svc.service);
                const editKey = `org_${activeOrgId}_${svc.service}`;
                const isEditing = orgKeyEditing === editKey;
                const isEnrichment = ["apollo", "apify", "hunter", "tavily", "snov_id", "snov_secret"].includes(svc.service);
                const planTiers: Record<string, { value: string; label: string }[]> = {
                  apollo: [{ value: "free", label: "Free" }, { value: "basic", label: "Basic ($49/mo)" }, { value: "professional", label: "Professional ($79/mo)" }, { value: "organization", label: "Organization ($119/mo)" }],
                  hunter: [{ value: "free", label: "Free (25/mo)" }, { value: "starter", label: "Starter ($49/mo)" }, { value: "growth", label: "Growth ($149/mo)" }, { value: "business", label: "Business ($499/mo)" }],
                  apify: [{ value: "free", label: "Free ($5/mo)" }, { value: "personal", label: "Personal ($49/mo)" }, { value: "team", label: "Team ($499/mo)" }],
                  tavily: [{ value: "free", label: "Free (1000/mo)" }, { value: "pro", label: "Pro ($20/mo)" }],
                  snov_api_id: [{ value: "free", label: "Free (50 credits)" }, { value: "starter", label: "Starter ($39/mo)" }, { value: "pro", label: "Pro ($99/mo)" }],
                };
                const tierOptions = planTiers[svc.service];
                const currentPlanTier = existing?.label?.startsWith("plan:") ? existing.label.slice(5) : undefined;

                return (
                  <div key={svc.service} className="border border-gray-200 rounded-lg p-4">
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-2">
                        <h3 className="text-sm font-semibold">{svc.name}</h3>
                        <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${existing ? "bg-green-100 text-green-800" : "bg-gray-100 text-gray-500"}`}>
                          {existing ? ts.byokMasked : ts.byokNotSet}
                        </span>
                        {isEnrichment && currentPlanTier && (
                          <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-yellow-100 text-yellow-800 capitalize">
                            {currentPlanTier}
                          </span>
                        )}
                        <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${svc.tier === "free" ? "bg-blue-100 text-blue-700" : svc.tier === "freemium" ? "bg-purple-100 text-purple-700" : "bg-orange-100 text-orange-700"}`}>
                          {svc.tier === "free" ? ts.byokTierFree : svc.tier === "freemium" ? ts.byokTierFreemium : ts.byokTierPaid}
                        </span>
                      </div>
                    </div>
                    {svc.hint && <p className="text-xs text-gray-400 mb-1">{svc.hint}</p>}
                    {svc.tierInfo && <p className="text-xs text-gray-500 mb-2 flex items-center gap-1">
                      <svg className="w-3 h-3 text-gray-400 shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z" /></svg>
                      {svc.tierInfo}
                    </p>}

                    <div className="flex items-center justify-between">
                      {!isEditing && (
                        <div className="flex items-center gap-2">
                          {!existing && personalKey && (
                            <button
                              onClick={async () => {
                                setOrgKeySaving(true);
                                const ok = await copyPersonalToOrg(svc.service);
                                if (ok) {
                                  const data = await fetch("/api/api-keys").then((r) => r.json());
                                  setOrgKeys(data.orgKeys || []);
                                  setOrgKeyMsg(ts.orgKeysCopied?.replace("{service}", svc.name) || `Copied ${svc.name} from personal`);
                                  setTimeout(() => setOrgKeyMsg(""), 3000);
                                }
                                setOrgKeySaving(false);
                              }}
                              disabled={orgKeySaving}
                              className="text-xs text-blue-600 hover:text-blue-800 transition-colors cursor-pointer disabled:opacity-50 flex items-center gap-1"
                            >
                              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 17.25v3.375c0 .621-.504 1.125-1.125 1.125h-9.75a1.125 1.125 0 01-1.125-1.125V7.875c0-.621.504-1.125 1.125-1.125H6.75a9.06 9.06 0 011.5.124m7.5 10.376h3.375c.621 0 1.125-.504 1.125-1.125V11.25c0-4.46-3.243-8.161-7.5-8.876a9.06 9.06 0 00-1.5-.124H9.375c-.621 0-1.125.504-1.125 1.125v3.5m7.5 10.375H9.375a1.125 1.125 0 01-1.125-1.125v-9.25m12 6.625v-1.875a3.375 3.375 0 00-3.375-3.375h-1.5a1.125 1.125 0 01-1.125-1.125v-1.5a3.375 3.375 0 00-3.375-3.375H9.75" /></svg>
                              {ts.orgKeysCopyFromPersonal || "Copy from personal"}
                            </button>
                          )}
                          <button
                            onClick={() => { setOrgKeyEditing(editKey); setOrgKeyInput(""); setOrgKeyLabelInput(existing?.label || (isEnrichment ? "plan:free" : "")); }}
                            className="text-xs text-red-600 hover:text-red-800 transition-colors cursor-pointer"
                          >
                            {existing ? ts.edit : ts.byokSave}
                          </button>
                        </div>
                      )}
                    </div>

                    {existing && !isEditing && (
                      <div className="flex items-center gap-2">
                        <p className="text-sm text-gray-600 font-mono">{orgKeyRevealed[editKey] || existing.masked_key}</p>
                        <button
                          onClick={async () => {
                            if (orgKeyRevealed[editKey]) {
                              setOrgKeyRevealed((prev) => { const n = { ...prev }; delete n[editKey]; return n; });
                              return;
                            }
                            try {
                              const res = await fetch("/api/api-keys", {
                                method: "POST",
                                headers: { "Content-Type": "application/json" },
                                body: JSON.stringify({ action: "org_reveal", org_id: activeOrgId, service: svc.service }),
                              });
                              const data = await res.json();
                              if (res.ok && data.api_key) {
                                setOrgKeyRevealed((prev) => ({ ...prev, [editKey]: data.api_key }));
                              }
                            } catch { /* ignore */ }
                          }}
                          className="text-xs text-blue-600 hover:text-blue-800 transition-colors cursor-pointer"
                        >
                          {orgKeyRevealed[editKey] ? ts.byokHide : ts.byokReveal}
                        </button>
                      </div>
                    )}

                    {isEditing && (
                      <div className="mt-2 space-y-2">
                        <input
                          type="text"
                          value={orgKeyInput}
                          onChange={(e) => setOrgKeyInput(e.target.value)}
                          placeholder={ts.byokPlaceholder}
                          className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm"
                        />
                        {isEnrichment && tierOptions ? (
                          <select
                            value={orgKeyLabelInput.startsWith("plan:") ? orgKeyLabelInput.slice(5) : orgKeyLabelInput || "free"}
                            onChange={(e) => setOrgKeyLabelInput(`plan:${e.target.value}`)}
                            className="w-full px-3 py-1.5 border border-gray-300 rounded-lg text-sm bg-white cursor-pointer"
                          >
                            {tierOptions.map((t) => (
                              <option key={t.value} value={t.value}>{t.label}</option>
                            ))}
                          </select>
                        ) : null}
                        <div className="flex items-center gap-2">
                          <button
                            disabled={orgKeySaving || !orgKeyInput}
                            onClick={async () => {
                              setOrgKeySaving(true);
                              const label = isEnrichment && orgKeyLabelInput.startsWith("plan:") ? orgKeyLabelInput : orgKeyLabelInput || null;
                              try {
                                await fetch("/api/api-keys", {
                                  method: "POST",
                                  headers: { "Content-Type": "application/json" },
                                  body: JSON.stringify({ action: "org_upsert", org_id: activeOrgId, service: svc.service, api_key: orgKeyInput, label }),
                                });
                                setOrgKeyMsg(ts.orgKeysSaved || "Saved!");
                                setOrgKeyEditing(null);
                                const data = await fetch("/api/api-keys").then((r) => r.json());
                                setOrgKeys(data.orgKeys || []);
                              } catch { /* ignore */ } finally { setOrgKeySaving(false); setTimeout(() => setOrgKeyMsg(""), 3000); }
                            }}
                            className="bg-red-800 hover:bg-red-900 disabled:opacity-50 text-white px-3 py-1 rounded text-xs font-medium transition-colors cursor-pointer"
                          >
                            {orgKeySaving ? "..." : ts.byokSave}
                          </button>
                          <button onClick={() => setOrgKeyEditing(null)} className="text-xs text-gray-400 hover:text-gray-600 cursor-pointer">{tc.cancel}</button>
                          {existing && (
                            <button
                              onClick={async () => {
                                await fetch("/api/api-keys", {
                                  method: "POST",
                                  headers: { "Content-Type": "application/json" },
                                  body: JSON.stringify({ action: "org_delete", org_id: activeOrgId, service: svc.service }),
                                });
                                setOrgKeyEditing(null);
                                setOrgKeyMsg(ts.orgKeysDeleted || "Deleted.");
                                const data = await fetch("/api/api-keys").then((r) => r.json());
                                setOrgKeys(data.orgKeys || []);
                                setTimeout(() => setOrgKeyMsg(""), 3000);
                              }}
                              className="text-xs text-red-500 hover:text-red-700 cursor-pointer"
                            >
                              {ts.byokDelete}
                            </button>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}

              {/* Snov.io — combined card with 2 keys */}
              <div className="border border-gray-200 rounded-lg p-4">
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-semibold">Snov.io</h3>
                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${snovOrgConfigured ? "bg-green-100 text-green-800" : snovOrgId || snovOrgSecret ? "bg-yellow-100 text-yellow-800" : "bg-gray-100 text-gray-500"}`}>
                      {snovOrgConfigured ? ts.byokMasked : snovOrgId || snovOrgSecret ? "1/2" : ts.byokNotSet}
                    </span>
                    <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-purple-100 text-purple-700">{ts.byokTierFreemium}</span>
                  </div>
                </div>
                <p className="text-xs text-gray-400 mb-1">Lead enrichment — email finder &amp; verifier</p>
                <p className="text-xs text-gray-500 mb-2 flex items-center gap-1">
                  <svg className="w-3 h-3 text-gray-400 shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z" /></svg>
                  Free: 50 credits/mo
                </p>

                <div className="flex items-center gap-2">
                  {!isEditingOrgSnov && !snovOrgConfigured && snovPersonalExists && (
                    <button
                      onClick={async () => {
                        setOrgKeySaving(true);
                        const ok1 = await copyPersonalToOrg(snovPersonalId!.service);
                        const ok2 = await copyPersonalToOrg(snovPersonalSecret!.service);
                        if (ok1 || ok2) {
                          const data = await fetch("/api/api-keys").then((r) => r.json());
                          setOrgKeys(data.orgKeys || []);
                          setOrgKeyMsg("Copied Snov.io keys from personal");
                          setTimeout(() => setOrgKeyMsg(""), 3000);
                        }
                        setOrgKeySaving(false);
                      }}
                      disabled={orgKeySaving}
                      className="text-xs text-blue-600 hover:text-blue-800 transition-colors cursor-pointer disabled:opacity-50 flex items-center gap-1"
                    >
                      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 17.25v3.375c0 .621-.504 1.125-1.125 1.125h-9.75a1.125 1.125 0 01-1.125-1.125V7.875c0-.621.504-1.125 1.125-1.125H6.75a9.06 9.06 0 011.5.124m7.5 10.376h3.375c.621 0 1.125-.504 1.125-1.125V11.25c0-4.46-3.243-8.161-7.5-8.876a9.06 9.06 0 00-1.5-.124H9.375c-.621 0-1.125.504-1.125 1.125v3.5m7.5 10.375H9.375a1.125 1.125 0 01-1.125-1.125v-9.25m12 6.625v-1.875a3.375 3.375 0 00-3.375-3.375h-1.5a1.125 1.125 0 01-1.125-1.125v-1.5a3.375 3.375 0 00-3.375-3.375H9.75" /></svg>
                      {ts.orgKeysCopyFromPersonal || "Copy from personal"}
                    </button>
                  )}
                  {!isEditingOrgSnov && (
                    <button
                      onClick={() => { setOrgKeyEditing(`org_${activeOrgId}_snov`); setOrgKeyInput(""); setOrgKeyLabelInput(""); }}
                      className="text-xs text-red-600 hover:text-red-800 transition-colors cursor-pointer"
                    >
                      {snovOrgConfigured ? ts.edit : ts.byokSave}
                    </button>
                  )}
                </div>

                {isEditingOrgSnov && (
                  <div className="mt-2 space-y-2">
                    <input
                      id="org-snov-id"
                      type="text"
                      placeholder="Snov.io API ID"
                      className="w-full border border-gray-200 rounded px-3 py-1.5 text-sm font-mono"
                    />
                    <input
                      id="org-snov-secret"
                      type="text"
                      placeholder="Snov.io API Secret"
                      className="w-full border border-gray-200 rounded px-3 py-1.5 text-sm font-mono"
                    />
                    <div className="flex items-center gap-2">
                      <button
                        disabled={orgKeySaving}
                        onClick={async () => {
                          const idInput = document.getElementById("org-snov-id") as HTMLInputElement;
                          const secretInput = document.getElementById("org-snov-secret") as HTMLInputElement;
                          const idVal = idInput?.value?.trim();
                          const secretVal = secretInput?.value?.trim();
                          if (!idVal || !secretVal) return;
                          setOrgKeySaving(true);
                          try {
                            await fetch("/api/api-keys", {
                              method: "POST",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({ action: "org_upsert", org_id: activeOrgId, service: "snov_id", api_key: idVal, label: "Snov.io" }),
                            });
                            await fetch("/api/api-keys", {
                              method: "POST",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({ action: "org_upsert", org_id: activeOrgId, service: "snov_secret", api_key: secretVal, label: "Snov.io" }),
                            });
                            setOrgKeyEditing(null);
                            setOrgKeyMsg("Snov.io keys saved");
                            const data = await fetch("/api/api-keys").then((r) => r.json());
                            setOrgKeys(data.orgKeys || []);
                          } catch { /* ignore */ } finally { setOrgKeySaving(false); setTimeout(() => setOrgKeyMsg(""), 3000); }
                        }}
                        className="bg-red-800 hover:bg-red-900 disabled:opacity-50 text-white px-3 py-1 rounded text-xs font-medium transition-colors cursor-pointer"
                      >
                        {orgKeySaving ? "..." : ts.byokSave}
                      </button>
                      <button onClick={() => setOrgKeyEditing(null)} className="text-xs text-gray-400 hover:text-gray-600 cursor-pointer">{tc.cancel}</button>
                      {snovOrgConfigured && (
                        <button
                          onClick={async () => {
                            await fetch("/api/api-keys", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "org_delete", org_id: activeOrgId, service: "snov_id" }) });
                            await fetch("/api/api-keys", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "org_delete", org_id: activeOrgId, service: "snov_secret" }) });
                            setOrgKeyEditing(null);
                            setOrgKeyMsg("Snov.io keys deleted");
                            const data = await fetch("/api/api-keys").then((r) => r.json());
                            setOrgKeys(data.orgKeys || []);
                            setTimeout(() => setOrgKeyMsg(""), 3000);
                          }}
                          className="text-xs text-red-500 hover:text-red-700 cursor-pointer"
                        >
                          {ts.byokDelete}
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          );
        })()}
        {orgKeyMsg && <p className="text-sm text-green-600 mt-3">{orgKeyMsg}</p>}
      </div>}
    </div>
  );
}
