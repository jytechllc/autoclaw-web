"use client";

import type { Dictionary } from "@/lib/i18n";

interface ApiKey {
  id: number;
  service: string;
  masked_key: string;
  label: string | null;
  updated_at: string;
}

interface ByokSectionProps {
  ts: Dictionary["settings"];
  tc: Dictionary["common"];
  apiKeys: ApiKey[];
  setApiKeys: React.Dispatch<React.SetStateAction<ApiKey[]>>;
  byokEditing: string | null;
  setByokEditing: React.Dispatch<React.SetStateAction<string | null>>;
  byokKeyInput: string;
  setByokKeyInput: React.Dispatch<React.SetStateAction<string>>;
  byokLabelInput: string;
  setByokLabelInput: React.Dispatch<React.SetStateAction<string>>;
  byokSaving: boolean;
  setByokSaving: React.Dispatch<React.SetStateAction<boolean>>;
  byokMsg: string;
  setByokMsg: React.Dispatch<React.SetStateAction<string>>;
  byokRevealed: Record<string, string>;
  setByokRevealed: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  byokRevealing: string | null;
  setByokRevealing: React.Dispatch<React.SetStateAction<string | null>>;
  userPlan: string;
  collapsed: Record<string, boolean>;
  setCollapsed: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
}

export default function ByokSection({
  ts,
  tc,
  apiKeys,
  setApiKeys,
  byokEditing,
  setByokEditing,
  byokKeyInput,
  setByokKeyInput,
  byokLabelInput,
  setByokLabelInput,
  byokSaving,
  setByokSaving,
  byokMsg,
  setByokMsg,
  byokRevealed,
  setByokRevealed,
  byokRevealing,
  setByokRevealing,
  userPlan,
  collapsed,
  setCollapsed,
}: ByokSectionProps) {
  return (
    <div id="section-byok" className="bg-white rounded-lg border border-gray-200 mb-6 overflow-hidden">
      <button
        onClick={() => setCollapsed((prev) => ({ ...prev, byok: !prev.byok }))}
        className="w-full flex items-center justify-between p-6 cursor-pointer hover:bg-gray-50 transition-colors"
      >
        <div className="text-left">
          <h2 className="text-lg font-semibold">{ts.byokTitle}</h2>
          <p className="text-sm text-gray-500">{ts.byokDesc}</p>
        </div>
        <svg className={`w-5 h-5 text-gray-400 transition-transform ${collapsed.byok ? "" : "rotate-180"}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {!collapsed.byok && <div className="px-6 pb-6 border-t border-gray-100 pt-4">

      <div className="space-y-3">
        {([
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
          ...(userPlan !== "starter" ? [
            { service: "tavily" as const, name: "Tavily", hint: ts.byokTavilyHint || "AI-optimized web search. Get key at tavily.com.", tier: "freemium" as const, tierInfo: ts.byokTavilyTier || "Free: 1000 searches/mo. Pro: $20/mo." },
            { service: "apollo" as const, name: ts.byokApollo, hint: ts.byokApolloHint, tier: "freemium" as const, tierInfo: ts.byokApolloTier },
            { service: "apify" as const, name: ts.byokApify, hint: ts.byokApifyHint, tier: "freemium" as const, tierInfo: ts.byokApifyTier },
            { service: "hunter" as const, name: ts.byokHunter, hint: ts.byokHunterHint, tier: "freemium" as const, tierInfo: ts.byokHunterTier },
            { service: "snov_api_id" as const, name: ts.byokSnovApiId || "Snov.io ID", hint: ts.byokSnovHint || "Client ID from snov.io", tier: "freemium" as const, tierInfo: ts.byokSnovTier || "Free: 50 credits/mo" },
            { service: "snov_api_secret" as const, name: ts.byokSnovApiSecret || "Snov.io Secret", hint: ts.byokSnovHint || "Client Secret from snov.io", tier: "freemium" as const, tierInfo: ts.byokSnovTier || "Free: 50 credits/mo" },
          ] : []),
        ] as { service: string; name: string; hint: string; tier: "free" | "freemium" | "paid"; tierInfo: string }[]).map((svc) => {
          const existing = apiKeys.find((k) => k.service === svc.service);
          const isEditing = byokEditing === svc.service;
          const isEnrichment = ["apollo", "apify", "hunter", "snov_api_id", "snov_api_secret"].includes(svc.service);
          const planTiers: Record<string, { value: string; label: string }[]> = {
            apollo: [{ value: "free", label: "Free" }, { value: "basic", label: "Basic ($49/mo)" }, { value: "professional", label: "Professional ($79/mo)" }, { value: "organization", label: "Organization ($119/mo)" }],
            hunter: [{ value: "free", label: "Free (25/mo)" }, { value: "starter", label: "Starter ($49/mo)" }, { value: "growth", label: "Growth ($149/mo)" }, { value: "business", label: "Business ($499/mo)" }],
            apify: [{ value: "free", label: "Free ($5/mo)" }, { value: "personal", label: "Personal ($49/mo)" }, { value: "team", label: "Team ($499/mo)" }],
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
                  <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${svc.tier === "free" ? "bg-blue-100 text-blue-700" : svc.tier === "freemium" ? "bg-purple-100 text-purple-700" : "bg-orange-100 text-orange-700"}`}>
                    {svc.tier === "free" ? ts.byokTierFree : svc.tier === "freemium" ? ts.byokTierFreemium : ts.byokTierPaid}
                  </span>
                  {isEnrichment && currentPlanTier && (
                    <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-yellow-100 text-yellow-800 capitalize">
                      {currentPlanTier}
                    </span>
                  )}
                </div>
                {!isEditing && (
                  <button
                    onClick={() => {
                      setByokEditing(svc.service);
                      setByokKeyInput("");
                      setByokLabelInput(existing?.label || (isEnrichment ? "plan:free" : ""));
                    }}
                    className="text-xs text-red-600 hover:text-red-800 transition-colors cursor-pointer"
                  >
                    {existing ? ts.edit : ts.byokSave}
                  </button>
                )}
              </div>
              <p className="text-xs text-gray-400 mb-1">{svc.hint}</p>
              <p className="text-xs text-gray-500 mb-2 flex items-center gap-1">
                <svg className="w-3 h-3 text-gray-400 shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z" /></svg>
                {svc.tierInfo}
              </p>

              {existing && !isEditing && (
                <div className="flex items-center gap-2">
                  <p className="text-sm text-gray-600 font-mono">{byokRevealed[svc.service] || existing.masked_key}</p>
                  <button
                    onClick={async () => {
                      if (byokRevealed[svc.service]) {
                        setByokRevealed((prev) => { const n = { ...prev }; delete n[svc.service]; return n; });
                        return;
                      }
                      setByokRevealing(svc.service);
                      try {
                        const res = await fetch("/api/api-keys", {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ action: "reveal", service: svc.service }),
                        });
                        const data = await res.json();
                        if (res.ok && data.api_key) {
                          setByokRevealed((prev) => ({ ...prev, [svc.service]: data.api_key }));
                        }
                      } catch { /* ignore */ } finally { setByokRevealing(null); }
                    }}
                    disabled={byokRevealing === svc.service}
                    className="text-xs text-blue-600 hover:text-blue-800 transition-colors cursor-pointer"
                  >
                    {byokRevealing === svc.service ? "..." : byokRevealed[svc.service] ? ts.byokHide : ts.byokReveal}
                  </button>
                </div>
              )}

              {isEditing && (
                <div className="space-y-2 mt-2">
                  <input
                    type="password"
                    value={byokKeyInput}
                    onChange={(e) => setByokKeyInput(e.target.value)}
                    placeholder={ts.byokPlaceholder}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-red-500 focus:border-red-500 outline-none font-mono"
                    autoFocus
                  />
                  {isEnrichment && tierOptions ? (
                    <select
                      value={byokLabelInput.startsWith("plan:") ? byokLabelInput.slice(5) : byokLabelInput || "free"}
                      onChange={(e) => setByokLabelInput(`plan:${e.target.value}`)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-red-500 focus:border-red-500 outline-none bg-white cursor-pointer"
                    >
                      {tierOptions.map((t) => (
                        <option key={t.value} value={t.value}>{t.label}</option>
                      ))}
                    </select>
                  ) : (
                    <input
                      type="text"
                      value={byokLabelInput}
                      onChange={(e) => setByokLabelInput(e.target.value)}
                      placeholder={ts.byokLabel}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-red-500 focus:border-red-500 outline-none"
                    />
                  )}
                  <div className="flex gap-2">
                    <button
                      onClick={async () => {
                        if (!byokKeyInput && !isEnrichment) return;
                        setByokSaving(true);
                        const label = isEnrichment && byokLabelInput.startsWith("plan:") ? byokLabelInput : byokLabelInput || null;
                        try {
                          const res = await fetch("/api/api-keys", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ action: "upsert", service: svc.service, api_key: byokKeyInput || "__keep__", label }),
                          });
                          if (res.ok) {
                            setByokMsg(ts.byokSaved);
                            setByokEditing(null);
                            setByokKeyInput("");
                            const data = await fetch("/api/api-keys").then((r) => r.json());
                            setApiKeys(data.keys || []);
                          }
                        } finally {
                          setByokSaving(false);
                          setTimeout(() => setByokMsg(""), 3000);
                        }
                      }}
                      disabled={byokSaving || !byokKeyInput}
                      className="text-xs bg-red-800 hover:bg-red-900 text-white px-3 py-1.5 rounded font-medium transition-colors cursor-pointer disabled:opacity-50"
                    >
                      {byokSaving ? "..." : ts.byokSave}
                    </button>
                    <button
                      onClick={() => setByokEditing(null)}
                      className="text-xs text-gray-500 hover:text-gray-700 px-3 py-1.5 rounded border border-gray-200 transition-colors cursor-pointer"
                    >
                      {tc.cancel}
                    </button>
                    {existing && (
                      <button
                        onClick={async () => {
                          await fetch("/api/api-keys", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ action: "delete", service: svc.service }),
                          });
                          setByokMsg(ts.byokDeleted);
                          setByokEditing(null);
                          const data = await fetch("/api/api-keys").then((r) => r.json());
                          setApiKeys(data.keys || []);
                          setTimeout(() => setByokMsg(""), 3000);
                        }}
                        className="text-xs text-red-500 hover:text-red-700 px-3 py-1.5 rounded border border-red-200 transition-colors cursor-pointer"
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

        {/* X (Twitter) - 4 keys grouped */}
        {(() => {
          const twitterKeys = [
            { service: "twitter_api_key" as const, name: ts.byokTwitterApiKey },
            { service: "twitter_api_secret" as const, name: ts.byokTwitterApiSecret },
            { service: "twitter_access_token" as const, name: ts.byokTwitterAccessToken },
            { service: "twitter_access_token_secret" as const, name: ts.byokTwitterAccessTokenSecret },
          ];
          const twitterConfigured = twitterKeys.filter((k) => apiKeys.some((a) => a.service === k.service));
          const isEditingTwitter = byokEditing === "twitter";

          return (
            <div className="border border-gray-200 rounded-lg p-4">
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-semibold">{ts.byokTwitter}</h3>
                  <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${twitterConfigured.length === 4 ? "bg-green-100 text-green-800" : twitterConfigured.length > 0 ? "bg-yellow-100 text-yellow-800" : "bg-gray-100 text-gray-500"}`}>
                    {twitterConfigured.length === 4 ? ts.byokMasked : twitterConfigured.length > 0 ? `${twitterConfigured.length}/4` : ts.byokNotSet}
                  </span>
                  <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-purple-100 text-purple-700">{ts.byokTierFreemium}</span>
                </div>
                {!isEditingTwitter && (
                  <button
                    onClick={() => {
                      setByokEditing("twitter");
                      setByokKeyInput("");
                    }}
                    className="text-xs text-red-600 hover:text-red-800 transition-colors cursor-pointer"
                  >
                    {twitterConfigured.length > 0 ? ts.edit : ts.byokSave}
                  </button>
                )}
              </div>
              <p className="text-xs text-gray-400 mb-1">{ts.byokTwitterHint}</p>
              <p className="text-xs text-gray-500 mb-2 flex items-center gap-1">
                <svg className="w-3 h-3 text-gray-400 shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z" /></svg>
                {ts.byokTwitterTier}
              </p>

              {!isEditingTwitter && twitterConfigured.length > 0 && (
                <div className="space-y-1">
                  {twitterKeys.map((tk) => {
                    const existing = apiKeys.find((a) => a.service === tk.service);
                    return existing ? (
                      <div key={tk.service} className="flex items-center gap-2">
                        <span className="text-xs text-gray-500 w-36">{tk.name}:</span>
                        <span className="text-sm text-gray-600 font-mono">{existing.masked_key}</span>
                      </div>
                    ) : null;
                  })}
                </div>
              )}

              {isEditingTwitter && (
                <div className="space-y-2 mt-2">
                  {twitterKeys.map((tk) => {
                    const existing = apiKeys.find((a) => a.service === tk.service);
                    return (
                      <div key={tk.service}>
                        <label className="text-xs text-gray-500 mb-1 block">{tk.name}</label>
                        <input
                          type="password"
                          defaultValue=""
                          placeholder={existing ? "••••••••  (leave blank to keep)" : ts.byokPlaceholder}
                          data-twitter-key={tk.service}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-red-500 focus:border-red-500 outline-none font-mono"
                        />
                      </div>
                    );
                  })}
                  <div className="flex gap-2 mt-3">
                    <button
                      onClick={async () => {
                        setByokSaving(true);
                        try {
                          const inputs = document.querySelectorAll<HTMLInputElement>("[data-twitter-key]");
                          let saved = false;
                          for (const input of inputs) {
                            const service = input.getAttribute("data-twitter-key");
                            const value = input.value.trim();
                            if (value && service) {
                              const res = await fetch("/api/api-keys", {
                                method: "POST",
                                headers: { "Content-Type": "application/json" },
                                body: JSON.stringify({ action: "upsert", service, api_key: value }),
                              });
                              if (res.ok) saved = true;
                            }
                          }
                          if (saved) {
                            setByokMsg(ts.byokSaved);
                            setByokEditing(null);
                            const data = await fetch("/api/api-keys").then((r) => r.json());
                            setApiKeys(data.keys || []);
                          }
                        } finally {
                          setByokSaving(false);
                          setTimeout(() => setByokMsg(""), 3000);
                        }
                      }}
                      disabled={byokSaving}
                      className="text-xs bg-red-800 hover:bg-red-900 text-white px-3 py-1.5 rounded font-medium transition-colors cursor-pointer disabled:opacity-50"
                    >
                      {byokSaving ? "..." : ts.byokSave}
                    </button>
                    <button
                      onClick={() => setByokEditing(null)}
                      className="text-xs text-gray-500 hover:text-gray-700 px-3 py-1.5 rounded border border-gray-200 transition-colors cursor-pointer"
                    >
                      {tc.cancel}
                    </button>
                    {twitterConfigured.length > 0 && (
                      <button
                        onClick={async () => {
                          for (const tk of twitterKeys) {
                            await fetch("/api/api-keys", {
                              method: "POST",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({ action: "delete", service: tk.service }),
                            });
                          }
                          setByokMsg(ts.byokDeleted);
                          setByokEditing(null);
                          const data = await fetch("/api/api-keys").then((r) => r.json());
                          setApiKeys(data.keys || []);
                          setTimeout(() => setByokMsg(""), 3000);
                        }}
                        className="text-xs text-red-500 hover:text-red-700 px-3 py-1.5 rounded border border-red-200 transition-colors cursor-pointer"
                      >
                        {ts.byokDelete}
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })()}

        {/* Snov.io - 2 keys grouped (enterprise/scale only) */}
        {(userPlan === "enterprise" || userPlan === "scale") && (() => {
          const snovKeys = [
            { service: "snov_api_id" as const, name: ts.byokSnovApiId },
            { service: "snov_api_secret" as const, name: ts.byokSnovApiSecret },
          ];
          const snovConfigured = snovKeys.filter((k) => apiKeys.some((a) => a.service === k.service));
          const isEditingSnov = byokEditing === "snov";

          return (
            <div className="border border-gray-200 rounded-lg p-4">
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-semibold">{ts.byokSnov}</h3>
                  <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${snovConfigured.length === 2 ? "bg-green-100 text-green-800" : snovConfigured.length > 0 ? "bg-yellow-100 text-yellow-800" : "bg-gray-100 text-gray-500"}`}>
                    {snovConfigured.length === 2 ? ts.byokMasked : snovConfigured.length > 0 ? `${snovConfigured.length}/2` : ts.byokNotSet}
                  </span>
                  <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-purple-100 text-purple-700">{ts.byokTierFreemium}</span>
                </div>
                {!isEditingSnov && (
                  <button
                    onClick={() => { setByokEditing("snov"); setByokKeyInput(""); setByokLabelInput(""); }}
                    className="text-xs text-red-600 hover:text-red-800 transition-colors cursor-pointer"
                  >
                    {snovConfigured.length > 0 ? ts.edit : ts.byokSave}
                  </button>
                )}
              </div>
              <p className="text-xs text-gray-400 mb-1">{ts.byokSnovHint}</p>
              <p className="text-xs text-gray-500 mb-2 flex items-center gap-1">
                <svg className="w-3 h-3 text-gray-400 shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z" /></svg>
                {ts.byokSnovTier}
              </p>

              {!isEditingSnov && snovConfigured.length > 0 && (
                <div className="text-xs text-gray-500 space-y-0.5">
                  {snovConfigured.map((sk) => (
                    <div key={sk.service}>{sk.name}: ••••••••</div>
                  ))}
                </div>
              )}

              {isEditingSnov && (
                <div className="space-y-2 mt-2">
                  {snovKeys.map((sk) => {
                    const existing = apiKeys.find((k) => k.service === sk.service);
                    return (
                      <div key={sk.service}>
                        <label className="text-xs text-gray-500 mb-0.5 block">{sk.name}</label>
                        <input
                          type="password"
                          defaultValue=""
                          placeholder={existing ? "••••••••  (leave blank to keep)" : ts.byokPlaceholder}
                          data-snov-key={sk.service}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-red-500 focus:border-red-500 outline-none font-mono"
                        />
                      </div>
                    );
                  })}
                  <div className="flex gap-2 mt-1">
                    <button
                      onClick={async () => {
                        setByokSaving(true);
                        let saved = false;
                        for (const sk of snovKeys) {
                          const input = document.querySelector<HTMLInputElement>(`[data-snov-key="${sk.service}"]`);
                          const val = input?.value?.trim();
                          if (val) {
                            await fetch("/api/api-keys", {
                              method: "POST",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({ action: "upsert", service: sk.service, api_key: val }),
                            });
                            saved = true;
                          }
                        }
                        if (saved) {
                          setByokMsg(ts.byokSaved);
                          setByokEditing(null);
                          const data = await fetch("/api/api-keys").then((r) => r.json());
                          setApiKeys(data.keys || []);
                        }
                        setByokSaving(false);
                      }}
                      disabled={byokSaving}
                      className="text-xs bg-red-800 hover:bg-red-900 text-white px-3 py-1.5 rounded font-medium transition-colors cursor-pointer disabled:opacity-50"
                    >
                      {byokSaving ? "..." : ts.byokSave}
                    </button>
                    <button
                      onClick={() => setByokEditing(null)}
                      className="text-xs text-gray-500 hover:text-gray-700 px-3 py-1.5 cursor-pointer"
                    >
                      {tc.cancel}
                    </button>
                    {snovConfigured.length > 0 && (
                      <button
                        onClick={async () => {
                          for (const sk of snovKeys) {
                            await fetch("/api/api-keys", {
                              method: "POST",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({ action: "delete", service: sk.service }),
                            });
                          }
                          setByokMsg(ts.byokDeleted);
                          setByokEditing(null);
                          const data = await fetch("/api/api-keys").then((r) => r.json());
                          setApiKeys(data.keys || []);
                        }}
                        className="text-xs text-red-500 hover:text-red-700 px-3 py-1.5 rounded border border-red-200 transition-colors cursor-pointer"
                      >
                        {ts.byokDelete}
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })()}

        {/* Cloudflare Worker - 2 keys grouped */}
        {(() => {
          const workerKeys = [
            { service: "worker_url" as const, name: ts.byokWorkerUrl, hint: ts.byokWorkerUrlHint },
            { service: "worker_secret" as const, name: ts.byokWorkerSecret, hint: ts.byokWorkerSecretHint },
          ];
          const workerConfigured = workerKeys.filter((k) => apiKeys.some((a) => a.service === k.service));
          const isEditingWorker = byokEditing === "worker";

          return (
            <div className="border border-gray-200 rounded-lg p-4">
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-semibold">{ts.byokWorker}</h3>
                  <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${workerConfigured.length === 2 ? "bg-green-100 text-green-800" : workerConfigured.length > 0 ? "bg-yellow-100 text-yellow-800" : "bg-gray-100 text-gray-500"}`}>
                    {workerConfigured.length === 2 ? ts.byokMasked : workerConfigured.length > 0 ? `${workerConfigured.length}/2` : ts.byokNotSet}
                  </span>
                  <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-blue-100 text-blue-700">{ts.byokTierFree}</span>
                </div>
                {!isEditingWorker && (
                  <button
                    onClick={() => {
                      setByokEditing("worker");
                      setByokKeyInput("");
                    }}
                    className="text-xs text-red-600 hover:text-red-800 transition-colors cursor-pointer"
                  >
                    {workerConfigured.length > 0 ? ts.edit : ts.byokSave}
                  </button>
                )}
              </div>
              <p className="text-xs text-gray-400 mb-1">{ts.byokWorkerHint}</p>
              <p className="text-xs text-gray-500 mb-2 flex items-center gap-1">
                <svg className="w-3 h-3 text-gray-400 shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z" /></svg>
                {ts.byokWorkerTier}
              </p>

              {!isEditingWorker && workerConfigured.length > 0 && (
                <div className="space-y-1">
                  {workerKeys.map((wk) => {
                    const existing = apiKeys.find((a) => a.service === wk.service);
                    return existing ? (
                      <div key={wk.service} className="flex items-center gap-2">
                        <span className="text-xs text-gray-500 w-36">{wk.name}:</span>
                        <span className="text-sm text-gray-600 font-mono">{existing.masked_key}</span>
                      </div>
                    ) : null;
                  })}
                </div>
              )}

              {isEditingWorker && (
                <div className="space-y-2 mt-2">
                  {workerKeys.map((wk) => {
                    const existing = apiKeys.find((a) => a.service === wk.service);
                    return (
                      <div key={wk.service}>
                        <label className="text-xs text-gray-500 mb-1 block">{wk.name}</label>
                        <input
                          type={wk.service === "worker_url" ? "text" : "password"}
                          defaultValue=""
                          placeholder={existing ? "••••••••  (leave blank to keep)" : wk.service === "worker_url" ? "https://my-worker.workers.dev" : ts.byokPlaceholder}
                          data-worker-key={wk.service}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-red-500 focus:border-red-500 outline-none font-mono"
                        />
                      </div>
                    );
                  })}
                  <div className="flex gap-2 mt-3">
                    <button
                      onClick={async () => {
                        setByokSaving(true);
                        try {
                          const inputs = document.querySelectorAll<HTMLInputElement>("[data-worker-key]");
                          let saved = false;
                          for (const input of inputs) {
                            const service = input.getAttribute("data-worker-key");
                            const value = input.value.trim();
                            if (value && service) {
                              const res = await fetch("/api/api-keys", {
                                method: "POST",
                                headers: { "Content-Type": "application/json" },
                                body: JSON.stringify({ action: "upsert", service, api_key: value }),
                              });
                              if (res.ok) saved = true;
                            }
                          }
                          if (saved) {
                            setByokMsg(ts.byokSaved);
                            setByokEditing(null);
                            const data = await fetch("/api/api-keys").then((r) => r.json());
                            setApiKeys(data.keys || []);
                          }
                        } finally {
                          setByokSaving(false);
                          setTimeout(() => setByokMsg(""), 3000);
                        }
                      }}
                      disabled={byokSaving}
                      className="text-xs bg-red-800 hover:bg-red-900 text-white px-3 py-1.5 rounded font-medium transition-colors cursor-pointer disabled:opacity-50"
                    >
                      {byokSaving ? "..." : ts.byokSave}
                    </button>
                    <button
                      onClick={() => setByokEditing(null)}
                      className="text-xs text-gray-500 hover:text-gray-700 px-3 py-1.5 rounded border border-gray-200 transition-colors cursor-pointer"
                    >
                      {tc.cancel}
                    </button>
                    {workerConfigured.length > 0 && (
                      <button
                        onClick={async () => {
                          for (const wk of workerKeys) {
                            await fetch("/api/api-keys", {
                              method: "POST",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({ action: "delete", service: wk.service }),
                            });
                          }
                          setByokMsg(ts.byokDeleted);
                          setByokEditing(null);
                          const data = await fetch("/api/api-keys").then((r) => r.json());
                          setApiKeys(data.keys || []);
                          setTimeout(() => setByokMsg(""), 3000);
                        }}
                        className="text-xs text-red-500 hover:text-red-700 px-3 py-1.5 rounded border border-red-200 transition-colors cursor-pointer"
                      >
                        {ts.byokDelete}
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })()}
        {/* TikTok - 2 keys grouped */}
        {(() => {
          const tiktokKeys = [
            { service: "tiktok_client_key" as const, name: ts.byokTiktokClientKey },
            { service: "tiktok_client_secret" as const, name: ts.byokTiktokClientSecret },
          ];
          const tiktokConfigured = tiktokKeys.filter((k) => apiKeys.some((a) => a.service === k.service));
          const isEditingTiktok = byokEditing === "tiktok";

          return (
            <div className="border border-gray-200 rounded-lg p-4">
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-semibold">{ts.byokTiktok}</h3>
                  <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${tiktokConfigured.length === 2 ? "bg-green-100 text-green-800" : tiktokConfigured.length > 0 ? "bg-yellow-100 text-yellow-800" : "bg-gray-100 text-gray-500"}`}>
                    {tiktokConfigured.length === 2 ? ts.byokMasked : tiktokConfigured.length > 0 ? `${tiktokConfigured.length}/2` : ts.byokNotSet}
                  </span>
                  <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-blue-100 text-blue-700">{ts.byokTierFree}</span>
                </div>
                {!isEditingTiktok && (
                  <button
                    onClick={() => { setByokEditing("tiktok"); setByokKeyInput(""); }}
                    className="text-xs text-red-600 hover:text-red-800 transition-colors cursor-pointer"
                  >
                    {tiktokConfigured.length > 0 ? ts.edit : ts.byokSave}
                  </button>
                )}
              </div>
              <p className="text-xs text-gray-400 mb-1">{ts.byokTiktokHint}</p>
              <p className="text-xs text-gray-500 mb-2 flex items-center gap-1">
                <svg className="w-3 h-3 text-gray-400 shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z" /></svg>
                {ts.byokTiktokTier}
              </p>

              {!isEditingTiktok && tiktokConfigured.length > 0 && (
                <div className="space-y-1">
                  {tiktokKeys.map((tk) => {
                    const existing = apiKeys.find((a) => a.service === tk.service);
                    return existing ? (
                      <div key={tk.service} className="flex items-center gap-2">
                        <span className="text-xs text-gray-500 w-36">{tk.name}:</span>
                        <span className="text-sm text-gray-600 font-mono">{existing.masked_key}</span>
                      </div>
                    ) : null;
                  })}
                </div>
              )}

              {isEditingTiktok && (
                <div className="space-y-2 mt-2">
                  {tiktokKeys.map((tk) => {
                    const existing = apiKeys.find((a) => a.service === tk.service);
                    return (
                      <div key={tk.service}>
                        <label className="text-xs text-gray-500 mb-1 block">{tk.name}</label>
                        <input
                          type="password"
                          defaultValue=""
                          placeholder={existing ? "••••••••  (leave blank to keep)" : ts.byokPlaceholder}
                          data-tiktok-key={tk.service}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-red-500 focus:border-red-500 outline-none font-mono"
                        />
                      </div>
                    );
                  })}
                  <div className="flex gap-2 mt-3">
                    <button
                      onClick={async () => {
                        setByokSaving(true);
                        try {
                          const inputs = document.querySelectorAll<HTMLInputElement>("[data-tiktok-key]");
                          let saved = false;
                          for (const input of inputs) {
                            const service = input.getAttribute("data-tiktok-key");
                            const value = input.value.trim();
                            if (value && service) {
                              const res = await fetch("/api/api-keys", {
                                method: "POST",
                                headers: { "Content-Type": "application/json" },
                                body: JSON.stringify({ action: "upsert", service, api_key: value }),
                              });
                              if (res.ok) saved = true;
                            }
                          }
                          if (saved) {
                            setByokMsg(ts.byokSaved);
                            setByokEditing(null);
                            const data = await fetch("/api/api-keys").then((r) => r.json());
                            setApiKeys(data.keys || []);
                          }
                        } finally {
                          setByokSaving(false);
                          setTimeout(() => setByokMsg(""), 3000);
                        }
                      }}
                      disabled={byokSaving}
                      className="text-xs bg-red-800 hover:bg-red-900 text-white px-3 py-1.5 rounded font-medium transition-colors cursor-pointer disabled:opacity-50"
                    >
                      {byokSaving ? "..." : ts.byokSave}
                    </button>
                    <button
                      onClick={() => setByokEditing(null)}
                      className="text-xs text-gray-500 hover:text-gray-700 px-3 py-1.5 rounded border border-gray-200 transition-colors cursor-pointer"
                    >
                      {tc.cancel}
                    </button>
                    {tiktokConfigured.length > 0 && (
                      <button
                        onClick={async () => {
                          for (const tk of tiktokKeys) {
                            await fetch("/api/api-keys", {
                              method: "POST",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({ action: "delete", service: tk.service }),
                            });
                          }
                          setByokMsg(ts.byokDeleted);
                          setByokEditing(null);
                          const data = await fetch("/api/api-keys").then((r) => r.json());
                          setApiKeys(data.keys || []);
                          setTimeout(() => setByokMsg(""), 3000);
                        }}
                        className="text-xs text-red-500 hover:text-red-700 px-3 py-1.5 rounded border border-red-200 transition-colors cursor-pointer"
                      >
                        {ts.byokDelete}
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })()}
      </div>
      {byokMsg && <p className="text-sm text-green-600 mt-3">{byokMsg}</p>}
    </div>}
    </div>
  );
}
