"use client";

import { useUser } from "@auth0/nextjs-auth0/client";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { getDictionary, type Locale } from "@/lib/i18n";
import DashboardShell from "@/components/DashboardShell";

interface XStatus {
  connected: boolean;
  username?: string;
  name?: string;
  id?: string;
  error?: string;
}

interface XPost {
  id: number;
  content: string;
  media_url?: string;
  tweet_id?: string;
  status: "draft" | "scheduled" | "posted" | "failed";
  scheduled_at?: string;
  posted_at?: string;
  error?: string;
  impressions?: number;
  likes?: number;
  retweets?: number;
  replies?: number;
  created_at: string;
}

interface RecentTweet {
  id: string;
  text: string;
  createdAt?: string;
  metrics?: { like_count?: number; retweet_count?: number; reply_count?: number; impression_count?: number };
  mediaUrl?: string | null;
}

export default function XPage() {
  const { user } = useUser();
  const params = useParams();
  const locale = (params.locale as Locale) || "en";
  const dict = getDictionary(locale);
  const t = dict.xPage;

  const [status, setStatus] = useState<XStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [posts, setPosts] = useState<XPost[]>([]);
  const [recentTweets, setRecentTweets] = useState<RecentTweet[]>([]);
  const [loadingTweets, setLoadingTweets] = useState(false);

  // Multi-account state
  interface XAccount { id: number; label: string; username?: string; x_user_id?: string; is_default: boolean; status: string; last_verified_at?: string; created_at: string }
  const [accounts, setAccounts] = useState<XAccount[]>([]);
  const [selectedAccountId, setSelectedAccountId] = useState<number | undefined>(undefined);
  const [showAccountPanel, setShowAccountPanel] = useState(false);
  const [showAddAccount, setShowAddAccount] = useState(false);
  const [addingAccount, setAddingAccount] = useState(false);
  const [newLabel, setNewLabel] = useState("");
  const [newApiKey, setNewApiKey] = useState("");
  const [newApiSecret, setNewApiSecret] = useState("");
  const [newAccessToken, setNewAccessToken] = useState("");
  const [newAccessTokenSecret, setNewAccessTokenSecret] = useState("");
  const [editingAccountId, setEditingAccountId] = useState<number | null>(null);
  const [editLabel, setEditLabel] = useState("");
  const [editApiKey, setEditApiKey] = useState("");
  const [editApiSecret, setEditApiSecret] = useState("");
  const [editAccessToken, setEditAccessToken] = useState("");
  const [editAccessTokenSecret, setEditAccessTokenSecret] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);

  // Composer state
  const [content, setContent] = useState("");
  const [mediaUrl, setMediaUrl] = useState("");
  const [posting, setPosting] = useState(false);
  const [message, setMessage] = useState("");
  const [scheduleMode, setScheduleMode] = useState(false);
  const [scheduledAt, setScheduledAt] = useState("");

  // AI analysis state
  const [analyzing, setAnalyzing] = useState(false);
  const [analysis, setAnalysis] = useState<{
    analysis?: { bestPerforming?: string; patterns?: string[]; bestTime?: string; engagementRate?: string };
    industryInsights?: { topTrends?: string[]; gapAnalysis?: string; opportunities?: string };
    industryTweets?: { text: string; metrics?: Record<string, number>; createdAt?: string; authorUsername?: string }[];
    detectedIndustry?: string;
    searchKeywords?: string[];
    variants?: { label: string; text: string; tone?: string; imagePrompt?: string; generatedImageUrl?: string; estimatedCost?: { postsPerWeek: number; monthlyBudget: string; breakdown: string }; bestPostTimes?: string[] }[];
    samplePost?: string;
    strategy?: string;
    usedKnowledgeBase?: boolean;
    contentLocale?: string;
  } | null>(null);
  const [selectedVariant, setSelectedVariant] = useState(0);
  const [aiTopic, setAiTopic] = useState("");
  const [industryKeyword, setIndustryKeyword] = useState("");
  const [analyzeWithImage, setAnalyzeWithImage] = useState(true);
  const [contentLocale, setContentLocale] = useState("en");

  // Pipeline steps state
  const [pipelineSteps, setPipelineSteps] = useState<{
    key: string; status: string; detail?: string; startedAt?: string; completedAt?: string;
  }[]>([]);

  // Analysis history
  const [historyRuns, setHistoryRuns] = useState<{
    id: number; topic?: string; industry_keyword?: string; content_locale?: string;
    steps: { key: string; status: string; detail?: string }[];
    result?: Record<string, unknown>; status: string; error?: string; created_at: string;
  }[]>([]);
  const [showHistory, setShowHistory] = useState(true);

  // Image generation state
  const [imagePrompt, setImagePrompt] = useState("");
  const [imageAspect, setImageAspect] = useState("1:1");
  const [imageModel, setImageModel] = useState("bytedance/seedream-v4.5");
  // Recurring tasks state
  const [recurringTasks, setRecurringTasks] = useState<{
    id: number; name: string; variant_label?: string;
    tone?: string; image_prompt?: string; posts_per_week: number; best_post_times: string[]; status: string;
    version: number; last_posted_at?: string; last_posted_content?: string; next_post_at?: string;
  }[]>([]);

  const [generatingImage, setGeneratingImage] = useState(false);
  const [generatedImage, setGeneratedImage] = useState<string | null>(null);
  const [imageError, setImageError] = useState("");

  useEffect(() => {
    fetchAccounts();
    fetchStatus();
    fetchPosts();
    fetchRecurringTasks();
    fetchHistory();
    // Handle OAuth callback results
    const urlParams = new URLSearchParams(window.location.search);
    const connected = urlParams.get("connected");
    const error = urlParams.get("error");
    if (connected) {
      setMessage(t.accountAdded + (connected !== "ok" ? ` (@${connected})` : ""));
      window.history.replaceState({}, "", window.location.pathname);
      setTimeout(() => setMessage(""), 5000);
    } else if (error) {
      setMessage(t.accountError + `: ${error}`);
      window.history.replaceState({}, "", window.location.pathname);
      setTimeout(() => setMessage(""), 5000);
    }
  }, []);

  // Re-fetch when switching accounts
  useEffect(() => {
    if (selectedAccountId !== undefined) {
      fetchStatus();
      fetchPosts();
      fetchRecentTweets();
    }
  }, [selectedAccountId]);

  const [connectingOAuth, setConnectingOAuth] = useState(false);

  async function connectWithX() {
    setConnectingOAuth(true);
    try {
      const res = await fetch("/api/x/auth");
      const data = await res.json();
      if (data.url) {
        window.location.href = data.url; // Redirect to X authorization page
      } else {
        setMessage(data.error || t.connectNeedKeys);
      }
    } catch {
      setMessage(t.accountError);
    }
    setConnectingOAuth(false);
    setTimeout(() => setMessage(""), 5000);
  }

  const [orgKeysAvailable, setOrgKeysAvailable] = useState(false);
  const [orgName, setOrgName] = useState("");
  const [legacyKeysAvailable, setLegacyKeysAvailable] = useState(false);
  const [importingKeys, setImportingKeys] = useState(false);

  async function fetchAccounts() {
    try {
      const res = await fetch("/api/x/accounts");
      const data = await res.json();
      if (data.accounts) {
        setAccounts(data.accounts);
        const def = data.accounts.find((a: XAccount) => a.is_default);
        if (def) setSelectedAccountId(def.id);
      }
      if (data.orgKeysAvailable) { setOrgKeysAvailable(true); setOrgName(data.orgName || ""); }
      if (data.legacyKeysAvailable) setLegacyKeysAvailable(true);
    } catch { /* ignore */ }
  }

  async function importKeys(source: "import_org" | "import_legacy") {
    setImportingKeys(true);
    try {
      const res = await fetch("/api/x/accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: source }),
      });
      const data = await res.json();
      if (data.success) {
        setMessage(t.accountAdded);
        fetchAccounts();
        fetchStatus();
        if (source === "import_org") setOrgKeysAvailable(false);
        if (source === "import_legacy") setLegacyKeysAvailable(false);
      } else {
        setMessage(t.accountError + (data.error ? `: ${data.error}` : ""));
      }
    } catch { setMessage(t.accountError); }
    setImportingKeys(false);
    setTimeout(() => setMessage(""), 5000);
  }

  async function addAccount() {
    if (!newLabel.trim() || !newApiKey.trim() || !newApiSecret.trim() || !newAccessToken.trim() || !newAccessTokenSecret.trim()) return;
    setAddingAccount(true);
    try {
      const res = await fetch("/api/x/accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "add",
          label: newLabel.trim(),
          api_key: newApiKey.trim(),
          api_secret: newApiSecret.trim(),
          access_token: newAccessToken.trim(),
          access_token_secret: newAccessTokenSecret.trim(),
        }),
      });
      const data = await res.json();
      if (data.success) {
        setMessage(t.accountAdded);
        setShowAddAccount(false);
        setNewLabel(""); setNewApiKey(""); setNewApiSecret(""); setNewAccessToken(""); setNewAccessTokenSecret("");
        fetchAccounts();
        fetchStatus();
      } else {
        setMessage(t.accountError + (data.error ? `: ${data.error}` : ""));
      }
    } catch { setMessage(t.accountError); }
    setAddingAccount(false);
    setTimeout(() => setMessage(""), 5000);
  }

  async function removeAccount(id: number) {
    if (!confirm(t.removeAccountConfirm)) return;
    await fetch("/api/x/accounts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "remove", id }),
    });
    setMessage(t.accountRemoved);
    setTimeout(() => setMessage(""), 3000);
    fetchAccounts();
    if (selectedAccountId === id) setSelectedAccountId(undefined);
  }

  function startEditAccount(a: XAccount) {
    setEditingAccountId(a.id);
    setEditLabel(a.label);
    setEditApiKey("");
    setEditApiSecret("");
    setEditAccessToken("");
    setEditAccessTokenSecret("");
  }

  function cancelEditAccount() {
    setEditingAccountId(null);
    setEditLabel("");
    setEditApiKey("");
    setEditApiSecret("");
    setEditAccessToken("");
    setEditAccessTokenSecret("");
  }

  async function saveEditAccount() {
    if (editingAccountId == null) return;
    setSavingEdit(true);
    try {
      const payload: Record<string, unknown> = { action: "update", id: editingAccountId };
      if (editLabel.trim()) payload.label = editLabel.trim();
      // Only send credentials if user typed all four
      if (editApiKey.trim() && editApiSecret.trim() && editAccessToken.trim() && editAccessTokenSecret.trim()) {
        payload.api_key = editApiKey.trim();
        payload.api_secret = editApiSecret.trim();
        payload.access_token = editAccessToken.trim();
        payload.access_token_secret = editAccessTokenSecret.trim();
      }
      const res = await fetch("/api/x/accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (data.success) {
        setMessage(t.accountAdded);
        cancelEditAccount();
        fetchAccounts();
        fetchStatus();
      } else {
        setMessage(t.accountError + (data.error ? `: ${data.error}` : ""));
      }
    } catch { setMessage(t.accountError); }
    setSavingEdit(false);
    setTimeout(() => setMessage(""), 5000);
  }

  async function setDefaultAccount(id: number) {
    await fetch("/api/x/accounts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "set_default", id }),
    });
    fetchAccounts();
  }

  async function fetchStatus() {
    try {
      const params = selectedAccountId ? `?accountId=${selectedAccountId}` : "";
      const res = await fetch(`/api/x/post${params}`);
      const data = await res.json();
      if (res.ok) {
        setStatus(data);
        if (data.connected) fetchRecentTweets();
      } else if (res.status === 401) {
        setStatus({ connected: false });
      } else {
        setStatus({ connected: false });
      }
    } catch {
      setStatus({ connected: false });
    } finally {
      setLoading(false);
    }
  }

  async function fetchRecentTweets() {
    setLoadingTweets(true);
    try {
      const acctParam = selectedAccountId ? `&accountId=${selectedAccountId}` : "";
      const res = await fetch(`/api/x/post?recentTweets=true${acctParam}`);
      const data = await res.json();
      if (data.tweets) setRecentTweets(data.tweets);
    } catch {
      // ignore
    } finally {
      setLoadingTweets(false);
    }
  }

  async function fetchPosts() {
    try {
      const res = await fetch("/api/x/post?listPosts=true");
      const data = await res.json();
      if (data.posts) setPosts(data.posts);
    } catch {
      // ignore
    }
  }

  async function fetchHistory() {
    try {
      const res = await fetch("/api/x/analyze");
      const data = await res.json();
      if (data.runs) setHistoryRuns(data.runs);
    } catch { /* ignore */ }
  }

  function loadHistoryRun(run: typeof historyRuns[0]) {
    if (run.result) {
      setAnalysis(run.result as typeof analysis);
      setPipelineSteps(run.steps || []);
      setSelectedVariant(0);
      // Scroll to the analysis section so the user can see the loaded results
      setTimeout(() => {
        document.getElementById("analysis-section")?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 100);
    }
  }

  async function handlePost() {
    if (!content.trim()) return;
    setPosting(true);
    setMessage("");
    try {
      const body: Record<string, unknown> = { content: content.trim() };
      if (selectedAccountId) body.accountId = selectedAccountId;
      if (mediaUrl.trim()) body.mediaUrl = mediaUrl.trim();

      if (scheduleMode && scheduledAt) {
        body.postImmediately = false;
        body.scheduledAt = new Date(scheduledAt).toISOString();
      }

      const res = await fetch("/api/x/post", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (data.success || data.tweetId) {
        setMessage(scheduleMode ? t.scheduled : t.posted);
        setContent("");
        setMediaUrl("");
        setScheduledAt("");
        fetchPosts();
      } else {
        setMessage(`${t.postFailed}: ${data.error}`);
      }
    } catch {
      setMessage(t.postFailed);
    } finally {
      setPosting(false);
    }
  }

  async function handleAnalyze() {
    setAnalyzing(true);
    setAnalysis(null);
    setSelectedVariant(0);
    try {
      const res = await fetch("/api/x/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic: aiTopic || undefined, industryKeyword: industryKeyword || undefined, generateImage: analyzeWithImage, locale, contentLocale }),
      });
      const data = await res.json();
      if (data.steps) setPipelineSteps(data.steps);
      if (res.ok) {
        setAnalysis(data);
        fetchHistory();
      } else {
        setMessage(`${t.analyzeFailed}: ${data.error}`);
      }
    } catch {
      setMessage(t.analyzeFailed);
    } finally {
      setAnalyzing(false);
    }
  }

  function useVariant(index: number) {
    const variant = analysis?.variants?.[index];
    if (variant) {
      setContent(variant.text);
      if (variant.generatedImageUrl) setMediaUrl(variant.generatedImageUrl);
    } else if (analysis?.samplePost) {
      setContent(analysis.samplePost);
    }
  }

  async function fetchRecurringTasks() {
    try {
      const res = await fetch("/api/x/recurring");
      const data = await res.json();
      if (res.ok && data.tasks) setRecurringTasks(data.tasks);
    } catch { /* ignore */ }
  }

  async function repeatVariant(index: number) {
    const variant = analysis?.variants?.[index];
    if (!variant) return;

    setMessage("");
    try {
      const res = await fetch("/api/x/recurring", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content: variant.text,
          mediaUrl: variant.generatedImageUrl || null,
          imagePrompt: variant.imagePrompt || null,
          tone: variant.tone || null,
          postsPerWeek: variant.estimatedCost?.postsPerWeek || 3,
          bestPostTimes: variant.bestPostTimes || [],
          variantLabel: variant.label,
        }),
      });
      const data = await res.json();
      if (res.ok && data.task) {
        setMessage(`${t.repeatCreated}: ${data.task.name}`);
        fetchRecurringTasks();
      } else {
        setMessage(`${t.postFailed}: ${data.error}`);
      }
    } catch {
      setMessage(t.postFailed);
    }
  }

  async function updateRecurringTask(id: number, updates: Record<string, unknown>) {
    try {
      const res = await fetch("/api/x/recurring", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "update", id, ...updates }),
      });
      if (res.ok) {
        fetchRecurringTasks();
      }
    } catch { /* ignore */ }
  }

  async function deleteRecurringTask(id: number) {
    try {
      await fetch(`/api/x/recurring?id=${id}`, { method: "DELETE" });
      fetchRecurringTasks();
    } catch { /* ignore */ }
  }

  async function handleGenerateImage() {
    if (!imagePrompt.trim()) return;
    setGeneratingImage(true);
    setGeneratedImage(null);
    setImageError("");
    try {
      const res = await fetch("/api/x/image", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: imagePrompt, aspect_ratio: imageAspect, model: imageModel }),
      });
      const data = await res.json();
      if (!res.ok) {
        setImageError(data.error || t.imageGenFailed);
        return;
      }
      if (data.status === "completed" && data.outputs?.[0]) {
        setGeneratedImage(data.outputs[0]);
        return;
      }
      // Poll for result
      if (data.status === "processing" && (data.pollUrl || data.taskId)) {
        const qs = data.pollUrl
          ? `pollUrl=${encodeURIComponent(data.pollUrl)}`
          : `taskId=${encodeURIComponent(data.taskId)}`;
        for (let i = 0; i < 30; i++) {
          await new Promise((r) => setTimeout(r, 2000));
          const pollRes = await fetch(`/api/x/image?${qs}`);
          const pollData = await pollRes.json();
          if (pollData.status === "completed" && pollData.outputs?.[0]) {
            setGeneratedImage(pollData.outputs[0]);
            return;
          }
          if (pollData.status === "failed") {
            setImageError(pollData.error || t.imageGenFailed);
            return;
          }
        }
        setImageError(t.imageGenFailed);
      }
    } catch {
      setImageError(t.imageGenFailed);
    } finally {
      setGeneratingImage(false);
    }
  }

  function useGeneratedImage() {
    if (generatedImage) {
      setMediaUrl(generatedImage);
    }
  }

  async function handleDelete(postId: number) {
    try {
      await fetch("/api/x/post", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ postId }),
      });
      fetchPosts();
    } catch {
      // ignore
    }
  }

  const charCount = content.length;
  const charLimit = 280;
  const isOverLimit = charCount > charLimit;

  if (!user) return null;

  return (
    <DashboardShell user={user} plan={undefined}>
      <div className="p-4 sm:p-6 max-w-4xl mx-auto space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{t.title}</h1>
          <p className="text-gray-500 mt-1">{t.subtitle}</p>
        </div>

        {loading ? (
          <div className="text-gray-500">{dict.common.loading}</div>
        ) : (
          <>
            {/* Account Switcher + Status */}
            <div className="bg-white rounded-xl border border-gray-200 p-5">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-lg font-semibold text-gray-800">{t.accountInfo}</h2>
                <div className="flex items-center gap-2">
                  {accounts.length > 0 && (
                    <select
                      value={selectedAccountId || ""}
                      onChange={(e) => setSelectedAccountId(e.target.value ? Number(e.target.value) : undefined)}
                      className="text-sm border border-gray-300 rounded-lg px-2 py-1 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      {accounts.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.label}{a.username ? ` (@${a.username})` : ""}{a.is_default ? ` ★` : ""}
                        </option>
                      ))}
                    </select>
                  )}
                  <button onClick={() => setShowAccountPanel(!showAccountPanel)} className="text-xs text-blue-600 hover:text-blue-800 cursor-pointer font-medium">{t.allAccounts}</button>
                </div>
              </div>

              {/* Current account status */}
              {status?.connected ? (
                <div className="flex items-center gap-3">
                  <span className="inline-flex items-center gap-1.5 text-sm font-medium text-green-700 bg-green-50 px-3 py-1 rounded-full">
                    <span className="w-2 h-2 bg-green-500 rounded-full" />
                    {t.connected}
                  </span>
                  <span className="text-sm text-gray-600">@{status.username}</span>
                  {status.name && <span className="text-sm text-gray-400">({status.name})</span>}
                </div>
              ) : accounts.length === 0 ? (
                <div className="space-y-3">
                  <span className="inline-flex items-center gap-1.5 text-sm font-medium text-red-700 bg-red-50 px-3 py-1 rounded-full">
                    <span className="w-2 h-2 bg-red-500 rounded-full" />
                    {t.notConnected}
                  </span>
                  <p className="text-sm text-gray-500">{t.connectDesc}</p>
                  <button
                    onClick={connectWithX}
                    disabled={connectingOAuth}
                    className="inline-flex items-center gap-2 bg-black hover:bg-gray-800 disabled:bg-gray-400 text-white px-5 py-2.5 rounded-lg text-sm font-medium cursor-pointer transition-colors"
                  >
                    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>
                    {connectingOAuth ? t.connecting : t.connectWithX}
                  </button>
                </div>
              ) : (
                <div className="space-y-2">
                  <span className="inline-flex items-center gap-1.5 text-sm font-medium text-yellow-700 bg-yellow-50 px-3 py-1 rounded-full">
                    <span className="w-2 h-2 bg-yellow-500 rounded-full" />
                    {t.notConnected}
                  </span>
                </div>
              )}

              {/* Account management panel */}
              {showAccountPanel && (
                <div className="mt-4 pt-4 border-t border-gray-100">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-sm font-semibold text-gray-700">{t.accounts} ({accounts.length})</h3>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={connectWithX}
                        disabled={connectingOAuth}
                        className="text-xs bg-black hover:bg-gray-800 disabled:bg-gray-400 text-white px-3 py-1 rounded-lg cursor-pointer font-medium flex items-center gap-1"
                      >
                        <svg className="w-3 h-3" viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>
                        {connectingOAuth ? t.connecting : t.connectWithX}
                      </button>
                      <button onClick={() => setShowAddAccount(true)} className="text-xs border border-gray-300 hover:bg-gray-50 text-gray-600 px-3 py-1 rounded-lg cursor-pointer font-medium">{t.addAccount}</button>
                    </div>
                  </div>

                  {accounts.length === 0 ? (
                    <p className="text-sm text-gray-400">{t.noAccount}</p>
                  ) : (
                    <div className="space-y-2">
                      {accounts.map((a) => (
                        <div key={a.id} className={`p-3 rounded-lg border ${selectedAccountId === a.id ? "border-blue-300 bg-blue-50/50" : "border-gray-100 bg-gray-50/50"}`}>
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <span className={`w-2 h-2 rounded-full ${a.status === "active" ? "bg-green-500" : "bg-red-400"}`} />
                              <span className="text-sm font-medium text-gray-800">{a.label}</span>
                              {a.username && <span className="text-xs text-gray-500">@{a.username}</span>}
                              {a.is_default && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-blue-100 text-blue-700 font-medium">{t.defaultAccount}</span>}
                            </div>
                            <div className="flex items-center gap-2">
                              {!a.is_default && (
                                <button onClick={() => setDefaultAccount(a.id)} className="text-[11px] text-blue-600 hover:text-blue-800 cursor-pointer">{t.setDefault}</button>
                              )}
                              <button onClick={() => startEditAccount(a)} className="text-[11px] text-gray-600 hover:text-gray-900 cursor-pointer">Edit</button>
                              <button onClick={() => removeAccount(a.id)} className="text-[11px] text-red-400 hover:text-red-600 cursor-pointer">{t.removeAccount}</button>
                            </div>
                          </div>
                          {editingAccountId === a.id && (
                            <div className="mt-3 pt-3 border-t border-gray-200 space-y-2">
                              <input type="text" value={editLabel} onChange={(e) => setEditLabel(e.target.value)} placeholder={t.accountLabelPlaceholder} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                              <p className="text-[11px] text-gray-500">Leave the 4 fields below empty to only update the label. Fill all 4 to replace API credentials.</p>
                              <div className="grid grid-cols-2 gap-2">
                                <input type="text" value={editApiKey} onChange={(e) => setEditApiKey(e.target.value)} placeholder={t.apiKey} className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                                <input type="text" value={editApiSecret} onChange={(e) => setEditApiSecret(e.target.value)} placeholder={t.apiSecret} className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                              </div>
                              <div className="grid grid-cols-2 gap-2">
                                <input type="text" value={editAccessToken} onChange={(e) => setEditAccessToken(e.target.value)} placeholder={t.accessToken} className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                                <input type="text" value={editAccessTokenSecret} onChange={(e) => setEditAccessTokenSecret(e.target.value)} placeholder={t.accessTokenSecret} className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                              </div>
                              <div className="flex justify-end gap-2 mt-2">
                                <button onClick={cancelEditAccount} className="text-sm text-gray-500 hover:text-gray-700 cursor-pointer">{dict.common.cancel}</button>
                                <button onClick={saveEditAccount} disabled={savingEdit} className="text-sm bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 text-white px-4 py-1.5 rounded-lg cursor-pointer font-medium">
                                  {savingEdit ? "Saving..." : "Save"}
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}

                  {/* One-click import from org or legacy keys */}
                  {(orgKeysAvailable || legacyKeysAvailable) && (
                    <div className="mt-3 flex flex-col gap-2">
                      {orgKeysAvailable && (
                        <button
                          onClick={() => importKeys("import_org")}
                          disabled={importingKeys}
                          className="w-full flex items-center justify-center gap-2 p-3 rounded-lg border-2 border-dashed border-blue-300 bg-blue-50/50 hover:bg-blue-100/50 text-sm font-medium text-blue-700 cursor-pointer transition-colors disabled:opacity-50"
                        >
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" /></svg>
                          {importingKeys ? t.addingAccount : `${t.switchAccount}: ${orgName || "Organization"}`}
                        </button>
                      )}
                      {legacyKeysAvailable && (
                        <button
                          onClick={() => importKeys("import_legacy")}
                          disabled={importingKeys}
                          className="w-full flex items-center justify-center gap-2 p-3 rounded-lg border-2 border-dashed border-gray-300 bg-gray-50/50 hover:bg-gray-100/50 text-sm font-medium text-gray-600 cursor-pointer transition-colors disabled:opacity-50"
                        >
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 5.25a3 3 0 013 3m3 0a6 6 0 01-7.029 5.912c-.563-.097-1.159.026-1.563.43L10.5 17.25H8.25v2.25H6v2.25H2.25v-2.818c0-.597.237-1.17.659-1.591l6.499-6.499c.404-.404.527-1 .43-1.563A6 6 0 1121.75 8.25z" /></svg>
                          {importingKeys ? t.addingAccount : `${t.switchAccount}: Settings API Keys`}
                        </button>
                      )}
                    </div>
                  )}

                  {/* Add account form */}
                  {showAddAccount && (
                    <div className="mt-3 p-4 bg-gray-50 rounded-lg border border-gray-200">
                      <h4 className="text-sm font-semibold text-gray-700 mb-3">{t.addAccount}</h4>
                      <div className="space-y-2">
                        <input type="text" value={newLabel} onChange={(e) => setNewLabel(e.target.value)} placeholder={t.accountLabelPlaceholder} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                        <div className="grid grid-cols-2 gap-2">
                          <input type="text" value={newApiKey} onChange={(e) => setNewApiKey(e.target.value)} placeholder={t.apiKey} className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                          <input type="text" value={newApiSecret} onChange={(e) => setNewApiSecret(e.target.value)} placeholder={t.apiSecret} className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <input type="text" value={newAccessToken} onChange={(e) => setNewAccessToken(e.target.value)} placeholder={t.accessToken} className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                          <input type="text" value={newAccessTokenSecret} onChange={(e) => setNewAccessTokenSecret(e.target.value)} placeholder={t.accessTokenSecret} className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                        </div>
                        <div className="flex justify-end gap-2 mt-2">
                          <button onClick={() => setShowAddAccount(false)} className="text-sm text-gray-500 hover:text-gray-700 cursor-pointer">{dict.common.cancel}</button>
                          <button onClick={addAccount} disabled={addingAccount || !newLabel.trim() || !newApiKey.trim()} className="text-sm bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 text-white px-4 py-1.5 rounded-lg cursor-pointer font-medium">
                            {addingAccount ? t.addingAccount : t.addAccount}
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* AI Strategy & Auto-Post */}
            {status?.connected && (
              <div id="analysis-section" className="bg-white rounded-xl border border-gray-200 p-5">
                <h2 className="text-lg font-semibold text-gray-800 mb-2">{t.aiStrategy}</h2>
                <p className="text-sm text-gray-500 mb-4">{t.aiStrategyDesc}</p>

                <div className="space-y-3 mb-4">
                  <div className="flex items-end gap-3">
                    <div className="flex-1">
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        {t.aiTopic}
                        <span className="text-gray-400 font-normal ml-1">({t.optional})</span>
                      </label>
                      <input
                        type="text"
                        value={aiTopic}
                        onChange={(e) => setAiTopic(e.target.value)}
                        placeholder={t.aiTopicPlaceholder}
                        className="w-full border border-gray-200 rounded-lg px-4 py-2 text-sm focus:ring-2 focus:ring-blue-200 focus:outline-none"
                      />
                    </div>
                    <div className="flex-1">
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        {t.industryKeyword}
                        <span className="text-gray-400 font-normal ml-1">({t.optional})</span>
                      </label>
                      <input
                        type="text"
                        value={industryKeyword}
                        onChange={(e) => setIndustryKeyword(e.target.value)}
                        placeholder={t.industryKeywordPlaceholder}
                        className="w-full border border-gray-200 rounded-lg px-4 py-2 text-sm focus:ring-2 focus:ring-blue-200 focus:outline-none"
                      />
                    </div>
                    <button
                      onClick={handleAnalyze}
                      disabled={analyzing}
                      className="px-5 py-2 bg-linear-to-r from-purple-600 to-blue-600 text-white text-sm font-medium rounded-lg hover:from-purple-700 hover:to-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all cursor-pointer whitespace-nowrap"
                    >
                      {analyzing ? t.analyzing : t.analyzeBtn}
                    </button>
                  </div>
                  <div className="flex items-center gap-4 flex-wrap">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={analyzeWithImage}
                        onChange={(e) => setAnalyzeWithImage(e.target.checked)}
                        className="rounded border-gray-300"
                      />
                      <span className="text-sm text-gray-700">{t.analyzeGenImage}</span>
                    </label>
                    <div className="flex items-center gap-1.5">
                      <span className="text-sm text-gray-600">{t.contentLocale}:</span>
                      <select
                        value={contentLocale}
                        onChange={(e) => setContentLocale(e.target.value)}
                        className="border border-gray-200 rounded-lg px-2 py-1 text-xs focus:ring-2 focus:ring-blue-200 focus:outline-none"
                      >
                        <option value="en">English</option>
                        <option value="zh">中文（简体）</option>
                        <option value="zh-TW">中文（繁體）</option>
                        <option value="fr">Français</option>
                        <option value="ja">日本語</option>
                        <option value="ko">한국어</option>
                        <option value="es">Español</option>
                        <option value="de">Deutsch</option>
                      </select>
                    </div>
                    {industryKeyword && (
                      <p className="text-xs text-gray-400">{t.industrySearchHint}</p>
                    )}
                  </div>
                </div>

                {/* Pipeline Steps */}
                {(analyzing || pipelineSteps.length > 0) && (
                  <div className="mb-4 bg-gray-50 rounded-lg p-4">
                    <h3 className="text-sm font-semibold text-gray-700 mb-2">{t.pipelineTitle}</h3>
                    <div className="space-y-1.5">
                      {(analyzing && pipelineSteps.length === 0
                        ? [
                            { key: "fetch_tweets", status: "running" },
                            { key: "detect_industry", status: "pending" },
                            { key: "search_industry", status: "pending" },
                            { key: "search_kb", status: "pending" },
                            { key: "ai_analysis", status: "pending" },
                            { key: "generate_images", status: "pending" },
                          ]
                        : pipelineSteps
                      ).map((step) => {
                        const STEP_LABELS: Record<string, string> = {
                          fetch_tweets: t.stepFetchTweets,
                          detect_industry: t.stepDetectIndustry,
                          search_industry: t.stepSearchIndustry,
                          search_kb: t.stepSearchKb,
                          ai_analysis: t.stepAiAnalysis,
                          generate_images: t.stepGenerateImages,
                        };
                        const icons: Record<string, string> = {
                          pending: "○",
                          running: "◉",
                          completed: "✓",
                          skipped: "—",
                          error: "✕",
                        };
                        const colors: Record<string, string> = {
                          pending: "text-gray-400",
                          running: "text-blue-600 animate-pulse",
                          completed: "text-green-600",
                          skipped: "text-gray-400",
                          error: "text-red-500",
                        };
                        return (
                          <div key={step.key} className="flex items-center gap-2 text-sm">
                            <span className={`w-4 text-center ${colors[step.status] || "text-gray-400"}`}>
                              {icons[step.status] || "○"}
                            </span>
                            <span className={step.status === "pending" ? "text-gray-400" : "text-gray-700"}>
                              {STEP_LABELS[step.key] || step.key}
                            </span>
                            {step.detail && (
                              <span className="text-xs text-gray-400 ml-auto truncate max-w-[200px]">{step.detail}</span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {analysis && (
                  <div className="space-y-4">
                    {/* Detected Industry */}
                    {analysis.detectedIndustry && (
                      <div className="flex items-center gap-2 text-sm">
                        <span className="px-2.5 py-1 bg-indigo-50 text-indigo-700 rounded-full text-xs font-medium">{t.detectedIndustry}: {analysis.detectedIndustry}</span>
                        {(analysis.searchKeywords?.length ?? 0) > 0 && (
                          <span className="text-xs text-gray-400">{t.autoSearched}: {analysis.searchKeywords!.join(", ")}</span>
                        )}
                      </div>
                    )}

                    {/* Performance Insights */}
                    <div className="bg-gray-50 rounded-lg p-4 space-y-3">
                      <h3 className="text-sm font-semibold text-gray-700">{t.performanceInsights}</h3>
                      {analysis.analysis?.bestPerforming && (
                        <div>
                          <span className="text-xs font-medium text-gray-500">{t.bestPerforming}</span>
                          <p className="text-sm text-gray-700 mt-0.5">{analysis.analysis.bestPerforming}</p>
                        </div>
                      )}
                      {analysis.analysis?.patterns && analysis.analysis.patterns.length > 0 && (
                        <div>
                          <span className="text-xs font-medium text-gray-500">{t.patterns}</span>
                          <ul className="mt-1 space-y-1">
                            {analysis.analysis.patterns.map((p, i) => (
                              <li key={i} className="text-sm text-gray-700 flex items-start gap-1.5">
                                <span className="text-purple-500 mt-0.5">&#8226;</span> {p}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                      <div className="flex gap-6 text-xs text-gray-500">
                        {analysis.analysis?.bestTime && (
                          <span>{t.bestTime}: <strong className="text-gray-700">{analysis.analysis.bestTime}</strong></span>
                        )}
                        {analysis.analysis?.engagementRate && (
                          <span>{t.avgEngagement}: <strong className="text-gray-700">{analysis.analysis.engagementRate}</strong></span>
                        )}
                      </div>
                    </div>

                    {/* Industry Insights */}
                    {analysis.industryInsights && (
                      <div className="bg-amber-50 rounded-lg p-4 space-y-3">
                        <h3 className="text-sm font-semibold text-amber-700">{t.industryInsightsTitle}</h3>
                        {analysis.industryInsights.topTrends && analysis.industryInsights.topTrends.length > 0 && (
                          <div>
                            <span className="text-xs font-medium text-amber-600">{t.topTrends}</span>
                            <ul className="mt-1 space-y-1">
                              {analysis.industryInsights.topTrends.map((trend, i) => (
                                <li key={i} className="text-sm text-gray-700 flex items-start gap-1.5">
                                  <span className="text-amber-500 mt-0.5">&#8226;</span> {trend}
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                        {analysis.industryInsights.gapAnalysis && (
                          <div>
                            <span className="text-xs font-medium text-amber-600">{t.gapAnalysis}</span>
                            <p className="text-sm text-gray-700 mt-0.5">{analysis.industryInsights.gapAnalysis}</p>
                          </div>
                        )}
                        {analysis.industryInsights.opportunities && (
                          <div>
                            <span className="text-xs font-medium text-amber-600">{t.opportunities}</span>
                            <p className="text-sm text-gray-700 mt-0.5">{analysis.industryInsights.opportunities}</p>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Industry Top Posts */}
                    {analysis.industryTweets && analysis.industryTweets.length > 0 && (
                      <div className="border border-amber-200 rounded-lg p-4">
                        <h3 className="text-sm font-semibold text-amber-700 mb-3">{t.industryTopPosts}</h3>
                        <div className="space-y-2">
                          {analysis.industryTweets.map((tweet, i) => (
                            <div key={i} className="bg-white rounded p-3 border border-amber-100">
                              <div className="flex items-start justify-between gap-2">
                                <p className="text-sm text-gray-800 flex-1 line-clamp-3">{tweet.text}</p>
                                {tweet.authorUsername && (
                                  <span className="text-xs text-gray-400 whitespace-nowrap">@{tweet.authorUsername}</span>
                                )}
                              </div>
                              {tweet.metrics && (
                                <div className="mt-1.5 flex gap-3 text-xs text-gray-500">
                                  {tweet.metrics.like_count != null && <span>{t.likes}: {tweet.metrics.like_count}</span>}
                                  {tweet.metrics.retweet_count != null && <span>{t.retweets}: {tweet.metrics.retweet_count}</span>}
                                  {tweet.metrics.reply_count != null && <span>{t.replies}: {tweet.metrics.reply_count}</span>}
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Knowledge Base indicator */}
                    {analysis.usedKnowledgeBase && (
                      <div className="flex items-center gap-1.5 text-xs text-green-600">
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                        {t.usedKnowledgeBase}
                      </div>
                    )}

                    {/* Strategy */}
                    {analysis.strategy && (
                      <div className="bg-blue-50 rounded-lg p-3">
                        <span className="text-xs font-medium text-blue-600">{t.recommendedStrategy}</span>
                        <p className="text-sm text-blue-800 mt-0.5">{analysis.strategy}</p>
                      </div>
                    )}

                    {/* A/B Test Variants */}
                    {analysis.variants && analysis.variants.length > 0 && (
                      <div className="space-y-3">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-semibold text-purple-600">{t.abTestTitle}</span>
                          <span className="text-xs text-gray-400">{t.abTestHint}</span>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                          {analysis.variants.map((variant, i) => (
                            <div
                              key={variant.label}
                              onClick={() => setSelectedVariant(i)}
                              className={`border-2 rounded-lg p-4 cursor-pointer transition-all ${
                                selectedVariant === i
                                  ? "border-purple-500 bg-purple-50 ring-1 ring-purple-200"
                                  : "border-gray-200 bg-white hover:border-purple-300"
                              }`}
                            >
                              <div className="flex items-center justify-between mb-2">
                                <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${
                                  selectedVariant === i ? "bg-purple-600 text-white" : "bg-gray-100 text-gray-600"
                                }`}>
                                  {variant.label}
                                </span>
                                {variant.tone && (
                                  <span className="text-xs text-gray-400">{variant.tone}</span>
                                )}
                              </div>
                              <p className="text-sm text-gray-800 whitespace-pre-wrap line-clamp-4">{variant.text}</p>
                              <span className="text-xs text-gray-400 mt-1 block">{variant.text.length}/280</span>
                              {variant.generatedImageUrl && (
                                <img src={variant.generatedImageUrl} alt="" className="mt-2 rounded-lg max-h-32 w-full object-contain" />
                              )}
                              {variant.bestPostTimes && variant.bestPostTimes.length > 0 && (
                                <div className="mt-2 pt-2 border-t border-gray-100">
                                  <span className="text-xs text-gray-500">{t.suggestedTimes}</span>
                                  <div className="flex flex-wrap gap-1 mt-1">
                                    {variant.bestPostTimes.map((time, ti) => (
                                      <span key={ti} className="text-xs px-1.5 py-0.5 bg-blue-50 text-blue-600 rounded">{time}</span>
                                    ))}
                                  </div>
                                </div>
                              )}
                              {variant.estimatedCost && (
                                <div className="mt-2 pt-2 border-t border-gray-100 space-y-0.5">
                                  <div className="flex items-center justify-between">
                                    <span className="text-xs text-gray-500">{t.estCost}</span>
                                    <span className="text-xs font-semibold text-green-700">{variant.estimatedCost.monthlyBudget}/mo</span>
                                  </div>
                                  <div className="text-xs text-gray-400">{variant.estimatedCost.postsPerWeek} {t.postsPerWeek}</div>
                                  <p className="text-xs text-gray-400 line-clamp-2">{variant.estimatedCost.breakdown}</p>
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                        <div className="flex gap-2">
                          <button
                            onClick={() => useVariant(selectedVariant)}
                            className="flex-1 py-2 bg-purple-600 text-white text-sm font-medium rounded-lg hover:bg-purple-700 transition-colors cursor-pointer"
                          >
                            {t.useVariant} {analysis.variants[selectedVariant]?.label}
                          </button>
                          <button
                            onClick={() => repeatVariant(selectedVariant)}
                            className="flex-1 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors cursor-pointer"
                          >
                            {t.repeatVariant} {analysis.variants[selectedVariant]?.label}
                          </button>
                        </div>
                      </div>
                    )}

                    {/* Legacy single sample post fallback */}
                    {!analysis.variants?.length && analysis.samplePost && (
                      <div className="border border-purple-200 rounded-lg p-4 bg-purple-50">
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-xs font-medium text-purple-600">{t.generatedSample}</span>
                          <button
                            onClick={() => useVariant(0)}
                            className="text-xs px-3 py-1 bg-purple-600 text-white rounded-full hover:bg-purple-700 transition-colors cursor-pointer"
                          >
                            {t.useAsPost}
                          </button>
                        </div>
                        <p className="text-sm text-gray-800 whitespace-pre-wrap">{analysis.samplePost}</p>
                        <span className="text-xs text-gray-400 mt-1 block">{analysis.samplePost.length}/280</span>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Recurring Tasks */}
            {status?.connected && recurringTasks.length > 0 && (
              <div className="bg-white rounded-xl border border-gray-200 p-5">
                <h2 className="text-lg font-semibold text-gray-800 mb-2">{t.recurringTitle}</h2>
                <p className="text-sm text-gray-500 mb-4">{t.recurringDesc}</p>

                <div className="space-y-3">
                  {recurringTasks.map((task) => (
                    <div key={task.id} className="border border-gray-200 rounded-lg p-4">
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <h3 className="text-sm font-semibold text-gray-800">{task.name}</h3>
                          {task.variant_label && (
                            <span className="text-[10px] px-1.5 py-0.5 bg-purple-50 text-purple-600 rounded-full font-medium">{task.variant_label}</span>
                          )}
                          <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${
                            task.status === "active" ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"
                          }`}>
                            {task.status === "active" ? t.recurringActive : t.recurringPaused}
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => updateRecurringTask(task.id, { status: task.status === "active" ? "paused" : "active" })}
                            className="text-xs text-gray-500 hover:text-gray-700 cursor-pointer"
                          >
                            {task.status === "active" ? t.recurringPause : t.recurringResume}
                          </button>
                          <button
                            onClick={() => deleteRecurringTask(task.id)}
                            className="text-xs text-red-400 hover:text-red-600 cursor-pointer"
                          >
                            {t.recurringDelete}
                          </button>
                        </div>
                      </div>

                      {/* Variant strategy info */}
                      <div className="flex flex-wrap items-center gap-3 text-xs text-gray-500">
                        {task.tone && <span className="px-1.5 py-0.5 bg-gray-100 rounded">{task.tone}</span>}
                        <span>{task.posts_per_week} {t.postsPerWeek}</span>
                        {task.best_post_times?.length > 0 && (
                          <div className="flex gap-1">
                            {task.best_post_times.map((time, i) => (
                              <span key={i} className="px-1.5 py-0.5 bg-blue-50 text-blue-600 rounded">{time}</span>
                            ))}
                          </div>
                        )}
                        {task.next_post_at && (
                          <span>{t.recurringNext}: {new Date(task.next_post_at).toLocaleString()}</span>
                        )}
                      </div>

                      {/* Last posted content — read-only reference */}
                      {task.last_posted_content ? (
                        <div className="mt-2 border-t border-gray-100 pt-2">
                          <span className="text-[10px] text-gray-400">{t.recurringLast}: {task.last_posted_at ? new Date(task.last_posted_at).toLocaleString() : "—"}</span>
                          <p className="text-sm text-gray-500 italic whitespace-pre-wrap line-clamp-3 mt-0.5">{task.last_posted_content}</p>
                        </div>
                      ) : task.last_posted_at ? (
                        <div className="mt-2 text-xs text-gray-400">
                          {t.recurringLast}: {new Date(task.last_posted_at).toLocaleString()}
                        </div>
                      ) : null}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Analysis History */}
            {status?.connected && historyRuns.length > 0 && (
              <div className="bg-white rounded-xl border border-gray-200 p-5">
                <div className="flex items-center justify-between mb-3">
                  <h2 className="text-lg font-semibold text-gray-800">{t.historyTitle}</h2>
                  <button
                    onClick={() => setShowHistory(!showHistory)}
                    className="text-xs text-blue-600 hover:text-blue-800 cursor-pointer"
                  >
                    {showHistory ? dict.reportsPage.close : `${t.historyViewResult} (${historyRuns.length})`}
                  </button>
                </div>
                {showHistory && (
                  <div className="space-y-2">
                    {historyRuns.map((run) => (
                      <div key={run.id} className="border border-gray-100 rounded-lg p-3 hover:bg-gray-50 transition-colors">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <span className={`w-2 h-2 rounded-full ${
                              run.status === "completed" ? "bg-green-500" : run.status === "running" ? "bg-blue-500 animate-pulse" : "bg-red-500"
                            }`} />
                            <span className="text-sm text-gray-700">
                              #{run.id}
                              {run.topic && <span className="text-gray-400 ml-1">— {run.topic}</span>}
                            </span>
                            {run.content_locale && run.content_locale !== "en" && (
                              <span className="text-[10px] px-1.5 py-0.5 bg-indigo-50 text-indigo-600 rounded">{run.content_locale}</span>
                            )}
                            <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${
                              run.status === "completed" ? "bg-green-100 text-green-700"
                                : run.status === "running" ? "bg-blue-100 text-blue-700"
                                : "bg-red-100 text-red-700"
                            }`}>
                              {run.status === "completed" ? t.historyCompleted : run.status === "running" ? t.historyRunning : t.historyError}
                            </span>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-gray-400">{new Date(run.created_at).toLocaleString()}</span>
                            {run.result && (
                              <button
                                onClick={() => loadHistoryRun(run)}
                                className="text-xs px-2 py-1 bg-blue-50 text-blue-600 rounded hover:bg-blue-100 cursor-pointer"
                              >
                                {t.historyViewResult}
                              </button>
                            )}
                          </div>
                        </div>
                        {run.error && (
                          <p className="text-xs text-red-500 mt-1">{run.error}</p>
                        )}
                        {/* Compact step indicators */}
                        <div className="flex gap-1 mt-2">
                          {(run.steps || []).map((step) => (
                            <span
                              key={step.key}
                              title={step.detail || step.key}
                              className={`w-3 h-1.5 rounded-full ${
                                step.status === "completed" ? "bg-green-400"
                                  : step.status === "skipped" ? "bg-gray-300"
                                  : step.status === "error" ? "bg-red-400"
                                  : step.status === "running" ? "bg-blue-400"
                                  : "bg-gray-200"
                              }`}
                            />
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Post Composer */}
            {status?.connected && (
              <div className="bg-white rounded-xl border border-gray-200 p-5">
                <h2 className="text-lg font-semibold text-gray-800 mb-4">{t.compose}</h2>

                <div className="space-y-4">
                  <div>
                    <div className="relative">
                      <textarea
                        value={content}
                        onChange={(e) => setContent(e.target.value)}
                        placeholder={t.composePlaceholder}
                        rows={4}
                        className={`w-full border rounded-lg px-4 py-3 text-sm focus:ring-2 focus:outline-none resize-none ${
                          isOverLimit
                            ? "border-red-300 focus:ring-red-200"
                            : "border-gray-200 focus:ring-blue-200"
                        }`}
                      />
                      <span
                        className={`absolute bottom-3 right-3 text-xs ${
                          isOverLimit ? "text-red-500 font-semibold" : "text-gray-400"
                        }`}
                      >
                        {charCount}/{charLimit}
                      </span>
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      {t.mediaUrl}
                      <span className="text-gray-400 font-normal ml-1">({t.optional})</span>
                    </label>
                    <input
                      type="url"
                      value={mediaUrl}
                      onChange={(e) => setMediaUrl(e.target.value)}
                      placeholder={t.mediaUrlPlaceholder}
                      className="w-full border border-gray-200 rounded-lg px-4 py-2 text-sm focus:ring-2 focus:ring-blue-200 focus:outline-none"
                    />
                  </div>

                  {/* Schedule toggle */}
                  <div className="flex items-center gap-3">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={scheduleMode}
                        onChange={(e) => setScheduleMode(e.target.checked)}
                        className="rounded border-gray-300"
                      />
                      <span className="text-sm text-gray-700">{t.schedulePost}</span>
                    </label>
                    {scheduleMode && (
                      <input
                        type="datetime-local"
                        value={scheduledAt}
                        onChange={(e) => setScheduledAt(e.target.value)}
                        className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:ring-2 focus:ring-blue-200 focus:outline-none"
                      />
                    )}
                  </div>

                  <div className="flex items-center gap-3">
                    <button
                      onClick={handlePost}
                      disabled={posting || !content.trim() || isOverLimit}
                      className="px-5 py-2 bg-black text-white text-sm font-medium rounded-lg hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors cursor-pointer"
                    >
                      {posting
                        ? t.posting
                        : scheduleMode
                          ? t.scheduleBtn
                          : t.postBtn}
                    </button>
                    {message && (
                      <span className={`text-sm ${message.includes("Failed") || message.includes("failed") ? "text-red-600" : "text-green-600"}`}>
                        {message}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* Image Generation */}
            {status?.connected && (
              <div className="bg-white rounded-xl border border-gray-200 p-5">
                <h2 className="text-lg font-semibold text-gray-800 mb-2">{t.imageGenTitle}</h2>
                <p className="text-sm text-gray-500 mb-4">{t.imageGenDesc}</p>

                <div className="space-y-3">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">{t.imageGenPrompt}</label>
                    <textarea
                      value={imagePrompt}
                      onChange={(e) => setImagePrompt(e.target.value)}
                      placeholder={t.imageGenPromptPlaceholder}
                      rows={2}
                      className="w-full border border-gray-200 rounded-lg px-4 py-2 text-sm focus:ring-2 focus:ring-blue-200 focus:outline-none resize-none"
                    />
                  </div>

                  <div className="flex items-end gap-3 flex-wrap">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">{t.imageGenModel}</label>
                      <select
                        value={imageModel}
                        onChange={(e) => setImageModel(e.target.value)}
                        className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-200 focus:outline-none"
                      >
                        <option value="bytedance/seedream-v4.5">Seedream 4.5</option>
                        <option value="bytedance/seedream-v4">Seedream 4</option>
                        <option value="bytedance/dreamina-v3.1/text-to-image">Dreamina 3.1</option>
                        <option value="wavespeed-ai/qwen-image/text-to-image">Qwen Image</option>
                        <option value="alibaba/wan-2.6/text-to-image">Wan 2.6 Image</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">{t.imageGenAspect}</label>
                      <select
                        value={imageAspect}
                        onChange={(e) => setImageAspect(e.target.value)}
                        className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-200 focus:outline-none"
                      >
                        <option value="1:1">1:1</option>
                        <option value="16:9">16:9</option>
                        <option value="9:16">9:16</option>
                      </select>
                    </div>
                    <button
                      onClick={handleGenerateImage}
                      disabled={generatingImage || !imagePrompt.trim()}
                      className="px-5 py-2 bg-linear-to-r from-pink-600 to-orange-500 text-white text-sm font-medium rounded-lg hover:from-pink-700 hover:to-orange-600 disabled:opacity-50 disabled:cursor-not-allowed transition-all cursor-pointer whitespace-nowrap"
                    >
                      {generatingImage ? t.imageGenerating : t.imageGenBtn}
                    </button>
                  </div>

                  {imageError && <p className="text-sm text-red-600">{imageError}</p>}

                  {generatedImage && (
                    <div className="border border-pink-200 rounded-lg p-4 bg-pink-50">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-medium text-pink-600">{t.imageGenResult}</span>
                        <button
                          onClick={useGeneratedImage}
                          className="text-xs px-3 py-1 bg-pink-600 text-white rounded-full hover:bg-pink-700 transition-colors cursor-pointer"
                        >
                          {t.imageUseAsMedia}
                        </button>
                      </div>
                      <img src={generatedImage} alt="Generated" className="rounded-lg max-h-64 w-full object-contain" />
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Recent Tweets from X */}
            {status?.connected && (
              <div className="bg-white rounded-xl border border-gray-200 p-5">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-lg font-semibold text-gray-800">{t.recentTweets}</h2>
                  <button
                    onClick={fetchRecentTweets}
                    disabled={loadingTweets}
                    className="text-xs text-blue-600 hover:text-blue-800 disabled:opacity-50 cursor-pointer"
                  >
                    {loadingTweets ? dict.common.loading : t.refresh}
                  </button>
                </div>
                {loadingTweets && recentTweets.length === 0 ? (
                  <p className="text-sm text-gray-400">{dict.common.loading}</p>
                ) : recentTweets.length === 0 ? (
                  <p className="text-sm text-gray-400">{t.noRecentTweets}</p>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {recentTweets.map((tweet) => (
                      <div key={tweet.id} className="border border-gray-100 rounded-lg p-4 flex flex-col">
                        <p className="text-sm text-gray-800 whitespace-pre-wrap flex-1 line-clamp-4">{tweet.text}</p>
                        {tweet.mediaUrl && (
                          <img src={tweet.mediaUrl} alt="" className="mt-2 rounded-lg max-h-36 w-full object-cover" />
                        )}
                        {tweet.metrics && (
                          <div className="mt-2 flex flex-wrap gap-3 text-xs text-gray-500">
                            {tweet.metrics.impression_count != null && <span>{t.impressions}: {tweet.metrics.impression_count.toLocaleString()}</span>}
                            {tweet.metrics.like_count != null && <span>{t.likes}: {tweet.metrics.like_count.toLocaleString()}</span>}
                            {tweet.metrics.retweet_count != null && <span>{t.retweets}: {tweet.metrics.retweet_count.toLocaleString()}</span>}
                            {tweet.metrics.reply_count != null && <span>{t.replies}: {tweet.metrics.reply_count.toLocaleString()}</span>}
                          </div>
                        )}
                        <div className="mt-2 flex items-center gap-3 text-xs text-gray-400">
                          {tweet.createdAt && <span>{new Date(tweet.createdAt).toLocaleString()}</span>}
                          <a
                            href={`https://x.com/i/status/${tweet.id}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-blue-500 hover:underline"
                          >
                            {t.viewOnX}
                          </a>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Post History */}
            <div className="bg-white rounded-xl border border-gray-200 p-5">
              <h2 className="text-lg font-semibold text-gray-800 mb-4">{t.history}</h2>
              {posts.length === 0 ? (
                <p className="text-sm text-gray-400">{t.noPosts}</p>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {posts.map((post) => (
                    <div key={post.id} className="border border-gray-100 rounded-lg p-4 flex flex-col">
                      <div className="flex items-start justify-between gap-3">
                        <p className="text-sm text-gray-800 whitespace-pre-wrap flex-1 line-clamp-4">{post.content}</p>
                        <div className="flex items-center gap-2 shrink-0">
                          <StatusBadge status={post.status} t={t} />
                          {(post.status === "draft" || post.status === "scheduled") && (
                            <button
                              onClick={() => handleDelete(post.id)}
                              className="text-xs text-red-500 hover:text-red-700 cursor-pointer"
                            >
                              {dict.common.delete}
                            </button>
                          )}
                        </div>
                      </div>

                      {/* Metrics for posted tweets */}
                      {post.status === "posted" && (post.impressions != null || post.likes != null) && (
                        <div className="mt-2 flex gap-4 text-xs text-gray-500">
                          {post.impressions != null && <span>{t.impressions}: {post.impressions}</span>}
                          {post.likes != null && <span>{t.likes}: {post.likes}</span>}
                          {post.retweets != null && <span>{t.retweets}: {post.retweets}</span>}
                          {post.replies != null && <span>{t.replies}: {post.replies}</span>}
                        </div>
                      )}

                      {post.error && (
                        <p className="mt-2 text-xs text-red-500">{post.error}</p>
                      )}

                      <div className="mt-2 flex items-center gap-3 text-xs text-gray-400">
                        {post.posted_at && <span>{t.postedAt}: {new Date(post.posted_at).toLocaleString()}</span>}
                        {post.scheduled_at && post.status === "scheduled" && (
                          <span>{t.scheduledFor}: {new Date(post.scheduled_at).toLocaleString()}</span>
                        )}
                        {!post.posted_at && !post.scheduled_at && (
                          <span>{new Date(post.created_at).toLocaleString()}</span>
                        )}
                        {post.tweet_id && (
                          <a
                            href={`https://x.com/i/status/${post.tweet_id}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-blue-500 hover:underline"
                          >
                            {t.viewOnX}
                          </a>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </DashboardShell>
  );
}

function StatusBadge({ status, t }: { status: string; t: Record<string, string> }) {
  const styles: Record<string, string> = {
    posted: "bg-green-50 text-green-700",
    scheduled: "bg-blue-50 text-blue-700",
    failed: "bg-red-50 text-red-700",
    draft: "bg-gray-50 text-gray-600",
  };
  const labels: Record<string, string> = {
    posted: t.statusPosted,
    scheduled: t.statusScheduled,
    failed: t.statusFailed,
    draft: t.statusDraft,
  };
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${styles[status] || styles.draft}`}>
      {labels[status] || status}
    </span>
  );
}
