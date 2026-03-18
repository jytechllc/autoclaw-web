"use client";

import { useUser } from "@auth0/nextjs-auth0/client";
import { useEffect, useState, useRef } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import { getDictionary, type Locale } from "@/lib/i18n";
import DashboardShell from "@/components/DashboardShell";

interface ChatMessage {
  id: number;
  role: "user" | "assistant";
  content: string;
  agent_type?: string;
  created_at: string;
}

interface ModelOption {
  id: string;
  name: string;
  provider: string;
  costPer1MInput: number;
  costPer1MOutput: number;
  requiresByok?: string;
  available: boolean;
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return String(n);
}

// Detect common API key patterns in user input
const SECRET_PATTERNS: { name: string; pattern: RegExp }[] = [
  { name: "OpenAI", pattern: /\bsk-[A-Za-z0-9_-]{20,}/ },
  { name: "Anthropic", pattern: /\bsk-ant-[A-Za-z0-9_-]{20,}/ },
  { name: "Google AI", pattern: /\bAIza[A-Za-z0-9_-]{30,}/ },
  { name: "Stripe", pattern: /\b[sr]k_(test|live)_[A-Za-z0-9]{20,}/ },
  { name: "AWS", pattern: /\bAKIA[A-Z0-9]{16}/ },
  { name: "GitHub", pattern: /\bgh[ps]_[A-Za-z0-9]{36,}/ },
  { name: "Brevo/SendGrid", pattern: /\bSG\.[A-Za-z0-9_-]{20,}/ },
  { name: "Vercel", pattern: /\bvercel_[A-Za-z0-9_-]{20,}/ },
  { name: "Generic API key", pattern: /\b[A-Za-z0-9_-]{32,64}\b/ },
];

// Check if message looks like a BYOK add command
const BYOK_COMMAND_PATTERN = /(?:add|set)\s+(?:my\s+)?(?:key\s+\S+\s+(?:to|for)\s+\S+|\S+\s+key\s+\S+)/i;

function detectSecretKey(text: string): string | null {
  // If it's a BYOK command, that's intentional — still warn but with different message
  if (BYOK_COMMAND_PATTERN.test(text)) return "byok_command";
  for (const { name, pattern } of SECRET_PATTERNS) {
    if (pattern.test(text)) return name;
  }
  return null;
}

function formatCost(inputCost: number, outputCost: number): string {
  if (inputCost === 0 && outputCost === 0) return "Free";
  const avg = (inputCost + outputCost) / 2;
  if (avg < 50) return "$";
  if (avg < 300) return "$$";
  return "$$$";
}

export default function ChatPage() {
  const params = useParams();
  const locale = (params.locale as Locale) || "en";
  const dict = getDictionary(locale);
  const td = dict.dashboard;
  const tc = dict.common;

  const { user, isLoading: userLoading } = useUser();

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [secretWarning, setSecretWarning] = useState<string | null>(null);
  const [pendingMessage, setPendingMessage] = useState<string | null>(null);
  const [selectedModel, setSelectedModel] = useState("auto");
  const [models, setModels] = useState<ModelOption[]>([]);
  const [quota, setQuota] = useState<{
    todayTokens: number; dailyTokenLimit: number; remainingTokens: number | null;
    plan: string; unlimited: boolean; nextResetUtc: string;
  } | null>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Conversation state
  interface Conversation { id: number; title: string; message_count: number; updated_at: string }
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConvId, setActiveConvId] = useState<number | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [renamingId, setRenamingId] = useState<number | null>(null);
  const [renameTitle, setRenameTitle] = useState("");

  function refreshQuota() {
    fetch("/api/status")
      .then((r) => r.json())
      .then((data) => {
        if (data.user) setQuota({ ...data.user, nextResetUtc: data.nextResetUtc });
      })
      .catch(() => {});
  }

  function fetchConversations() {
    fetch("/api/conversations")
      .then((r) => r.json())
      .then((data) => setConversations(data.conversations || []))
      .catch(() => {});
  }

  function loadMessages(convId: number | null) {
    const url = convId ? `/api/chat?conversation_id=${convId}` : "/api/chat";
    fetch(url)
      .then((r) => r.json())
      .then((data) => {
        setMessages(data.messages || []);
        setToolExecutions(data.toolExecutions || []);
      });
  }

  async function handleNewConversation() {
    try {
      const res = await fetch("/api/conversations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "create", title: td.chatNewConv || "New Chat" }),
      });
      const data = await res.json();
      if (data.conversation) {
        setActiveConvId(data.conversation.id);
        setMessages([]);
        fetchConversations();
      }
    } catch { /* ignore */ }
  }

  async function handleRenameConversation(convId: number) {
    if (!renameTitle.trim()) return;
    try {
      await fetch("/api/conversations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "rename", conversation_id: convId, title: renameTitle.trim() }),
      });
      setRenamingId(null);
      fetchConversations();
    } catch { /* ignore */ }
  }

  async function handleDeleteConversation(convId: number) {
    try {
      await fetch("/api/conversations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "delete", conversation_id: convId }),
      });
      if (activeConvId === convId) {
        setActiveConvId(null);
        setMessages([]);
      }
      fetchConversations();
    } catch { /* ignore */ }
  }

  function switchConversation(convId: number | null) {
    setActiveConvId(convId);
    loadMessages(convId);
    setSidebarOpen(false);
  }

  useEffect(() => {
    if (!user) return;
    fetchConversations();
    loadMessages(null);
    fetch("/api/models")
      .then((r) => r.json())
      .then((data) => setModels(data.models || []));
    refreshQuota();
  }, [user]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const [toolStatus, setToolStatus] = useState<string>("");
  const [toolSteps, setToolSteps] = useState<{ label: string; done: boolean; error?: boolean; errorDetail?: string }[]>([]);

  interface ToolExecution {
    id: number; tool_name: string; status: string;
    result_summary?: string; error_message?: string; duration_ms?: number; created_at: string;
  }
  const [toolExecutions, setToolExecutions] = useState<ToolExecution[]>([]);
  const [copiedId, setCopiedId] = useState<number | null>(null);
  const [savingKbId, setSavingKbId] = useState<number | null>(null);
  const [savedKbId, setSavedKbId] = useState<number | null>(null);
  const [shareToast, setShareToast] = useState<string | null>(null);

  function handleCopy(msg: ChatMessage) {
    navigator.clipboard.writeText(msg.content).then(() => {
      setCopiedId(msg.id);
      setTimeout(() => setCopiedId(null), 2000);
    });
  }

  function handleShare(msg: ChatMessage) {
    const text = msg.content;
    if (navigator.share) {
      navigator.share({ title: "AutoClaw AI", text }).catch(() => {});
    } else {
      navigator.clipboard.writeText(text).then(() => {
        setShareToast(td.chatShareCopied || "Link copied!");
        setTimeout(() => setShareToast(null), 2000);
      });
    }
  }

  async function handleSaveToKb(msg: ChatMessage) {
    setSavingKbId(msg.id);
    try {
      const title = `Chat: ${msg.content.slice(0, 60).replace(/[#*|_\n]/g, "").trim()}...`;
      const res = await fetch("/api/knowledge-base", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "add_text", title, text: msg.content, scope: "personal" }),
      });
      if (res.ok) {
        setSavedKbId(msg.id);
        setTimeout(() => setSavedKbId(null), 3000);
      }
    } catch { /* ignore */ } finally {
      setSavingKbId(null);
    }
  }

  async function doSendMessage(userMsg: string) {
    setSending(true);
    setToolStatus("");
    setToolSteps([]);
    const tempMsg: ChatMessage = { id: Date.now(), role: "user", content: userMsg, created_at: new Date().toISOString() };
    setMessages((prev) => [...prev, tempMsg]);
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: userMsg,
          model: selectedModel !== "auto" ? selectedModel : undefined,
          locale,
          conversation_id: activeConvId ? String(activeConvId) : undefined,
        }),
      });

      // Check if streaming (SSE) response
      if (res.headers.get("content-type")?.includes("text/event-stream")) {
        const reader = res.body?.getReader();
        const decoder = new TextDecoder();
        let finalReply = "";
        if (reader) {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            const text = decoder.decode(value, { stream: true });
            for (const line of text.split("\n")) {
              if (line.startsWith("data: ")) {
                try {
                  const evt = JSON.parse(line.slice(6));
                  if (evt.type === "step") {
                    const stepMsg = evt.message as string;
                    setToolStatus(stepMsg);
                    // Skip terminal/internal labels from the visible step list
                    const skipLabels = ["Done!", "完成！", "Terminé !"];
                    const isError = stepMsg?.startsWith("error:");
                    if (stepMsg && !skipLabels.includes(stepMsg)) {
                      setToolSteps((prev) => {
                        if (isError) {
                          // Mark the last running step as failed
                          return prev.map((s, i) => i === prev.length - 1 && !s.done ? { ...s, done: true, error: true } : s);
                        }
                        // Mark previous steps as done, add new one
                        const updated = prev.map((s) => ({ ...s, done: true }));
                        if (!updated.some((s) => s.label === stepMsg)) {
                          updated.push({ label: stepMsg, done: false });
                        }
                        return updated;
                      });
                    }
                  }
                  if (evt.type === "step_error") {
                    // Tool failed — mark last step as error with detail
                    setToolSteps((prev) => {
                      const updated = [...prev];
                      if (updated.length > 0) {
                        const last = updated[updated.length - 1];
                        updated[updated.length - 1] = { ...last, done: true, error: true, errorDetail: evt.error };
                      } else {
                        updated.push({ label: evt.tool || "Unknown tool", done: true, error: true, errorDetail: evt.error });
                      }
                      return updated;
                    });
                  }
                  if (evt.type === "done") {
                    finalReply = evt.reply;
                    setToolStatus("");
                    setToolSteps([]);
                  }
                } catch { /* skip */ }
              }
            }
          }
        }
        if (finalReply) {
          setMessages((prev) => [...prev, { id: Date.now() + 1, role: "assistant", content: finalReply, agent_type: "autoclaw", created_at: new Date().toISOString() }]);
        }
      } else {
        const data = await res.json();
        if (data.reply) {
          setMessages((prev) => [...prev, { id: Date.now() + 1, role: "assistant", content: data.reply, agent_type: "autoclaw", created_at: new Date().toISOString() }]);
        }
      }
    } catch {
      setMessages((prev) => [...prev, { id: Date.now() + 1, role: "assistant", content: td.errorMsg, created_at: new Date().toISOString() }]);
    } finally {
      setSending(false);
      setToolStatus("");
      refreshQuota();
      fetchConversations();
    }
  }

  async function sendMessage(e: React.FormEvent) {
    e.preventDefault();
    if (!input.trim() || sending) return;
    const userMsg = input.trim();

    // Check for secret keys before sending
    const detected = detectSecretKey(userMsg);
    if (detected && !pendingMessage) {
      if (detected === "byok_command") {
        setSecretWarning("byok");
      } else {
        setSecretWarning(detected);
      }
      setPendingMessage(userMsg);
      return;
    }

    setInput("");
    setSecretWarning(null);
    setPendingMessage(null);
    await doSendMessage(userMsg);
  }

  function confirmSendSecret() {
    if (pendingMessage) {
      setInput("");
      setSecretWarning(null);
      const msg = pendingMessage;
      setPendingMessage(null);
      doSendMessage(msg);
    }
  }

  function cancelSendSecret() {
    setSecretWarning(null);
    setPendingMessage(null);
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
          <h1 className="text-2xl font-bold mb-4">{td.signInDashboard}</h1>
          <a href={`/auth/login?returnTo=/${locale}/dashboard/reports`} className="bg-red-800 hover:bg-red-900 text-white px-6 py-3 rounded-lg font-medium transition-colors">{tc.logIn}</a>
        </div>
      </div>
    );
  }

  return (
    <DashboardShell user={user} fullHeight>
      <div className="px-4 sm:px-6 py-6 flex-1 flex flex-col min-h-0">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold">{td.chatPageTitle || "AI Chat"}</h1>
          <button
            type="button"
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="sm:hidden text-gray-500 hover:text-gray-700 p-1.5 rounded-lg hover:bg-gray-100 cursor-pointer"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h7" /></svg>
          </button>
        </div>

        <div className="flex-1 flex gap-4 min-h-0">
          {/* Conversation sidebar */}
          <div className={`${sidebarOpen ? "fixed inset-0 z-40 bg-black/30 sm:relative sm:bg-transparent" : "hidden"} sm:block sm:w-56 shrink-0`}>
            <div className={`${sidebarOpen ? "absolute right-0 top-0 h-full w-64 bg-white shadow-lg sm:shadow-none sm:relative sm:w-full" : ""} flex flex-col bg-white rounded-lg border border-gray-200 overflow-hidden h-full`}>
              <div className="p-3 border-b border-gray-100 flex items-center justify-between">
                <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">{td.chatConversations || "Conversations"}</span>
                <button
                  type="button"
                  onClick={handleNewConversation}
                  className="text-xs bg-red-800 hover:bg-red-900 text-white px-2 py-1 rounded cursor-pointer"
                  title={td.chatNewConv || "New Chat"}
                >
                  + {td.chatNew || "New"}
                </button>
              </div>
              <div className="flex-1 overflow-y-auto">
                {/* Default (no conversation) */}
                <button
                  type="button"
                  onClick={() => switchConversation(null)}
                  className={`w-full text-left px-3 py-2.5 text-sm border-b border-gray-50 hover:bg-gray-50 transition-colors cursor-pointer ${activeConvId === null ? "bg-red-50 text-red-800 font-medium" : "text-gray-700"}`}
                >
                  <div className="truncate">{td.chatGeneral || "General"}</div>
                </button>
                {conversations.map((conv) => (
                  <div
                    key={conv.id}
                    className={`group relative border-b border-gray-50 ${activeConvId === conv.id ? "bg-red-50" : "hover:bg-gray-50"}`}
                  >
                    {renamingId === conv.id ? (
                      <div className="px-3 py-2 flex gap-1">
                        <input
                          type="text"
                          value={renameTitle}
                          onChange={(e) => setRenameTitle(e.target.value)}
                          onKeyDown={(e) => { if (e.key === "Enter") handleRenameConversation(conv.id); if (e.key === "Escape") setRenamingId(null); }}
                          className="flex-1 text-xs border border-gray-300 rounded px-1.5 py-1 min-w-0"
                          autoFocus
                        />
                        <button type="button" onClick={() => handleRenameConversation(conv.id)} className="text-xs text-red-800 cursor-pointer">OK</button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => switchConversation(conv.id)}
                        className={`w-full text-left px-3 py-2.5 text-sm cursor-pointer ${activeConvId === conv.id ? "text-red-800 font-medium" : "text-gray-700"}`}
                      >
                        <div className="truncate pr-10">{conv.title}</div>
                        <div className="text-[10px] text-gray-400 mt-0.5">{conv.message_count} msgs</div>
                      </button>
                    )}
                    {renamingId !== conv.id && (
                      <div className="absolute right-1 top-1/2 -translate-y-1/2 hidden group-hover:flex gap-0.5">
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); setRenamingId(conv.id); setRenameTitle(conv.title); }}
                          className="text-gray-400 hover:text-gray-600 p-1 cursor-pointer"
                          title="Rename"
                        >
                          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
                        </button>
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); handleDeleteConversation(conv.id); }}
                          className="text-gray-400 hover:text-red-500 p-1 cursor-pointer"
                          title="Delete"
                        >
                          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
            {/* Mobile overlay close */}
            {sidebarOpen && <div className="sm:hidden absolute inset-0 -z-10" onClick={() => setSidebarOpen(false)} />}
          </div>

          {/* Chat area */}
          <div className="flex-1 flex flex-col bg-white rounded-lg border border-gray-200 overflow-hidden min-h-0">
          {/* Daily quota bar */}
          {quota && !quota.unlimited && (
            <div className="px-4 py-2 border-b border-gray-100 bg-gray-50 flex items-center gap-3 shrink-0">
              <span className="text-xs text-gray-500 shrink-0">{td.quotaDaily}</span>
              <div className="flex-1 bg-gray-200 rounded-full h-2 overflow-hidden max-w-xs">
                <div
                  className={`h-full rounded-full transition-all duration-500 ${
                    quota.todayTokens / quota.dailyTokenLimit > 0.9 ? "bg-red-500" :
                    quota.todayTokens / quota.dailyTokenLimit > 0.7 ? "bg-yellow-500" : "bg-green-500"
                  }`}
                  style={{ width: `${Math.min(100, (quota.todayTokens / quota.dailyTokenLimit) * 100)}%` }}
                />
              </div>
              <span className="text-xs font-mono text-gray-600 shrink-0">
                {formatTokens(quota.remainingTokens ?? 0)} {td.quotaRemaining}
              </span>
            </div>
          )}
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {messages.length === 0 && (
              <div className="text-center py-12 text-gray-400">
                <div className="text-4xl mb-4">🦞</div>
                <p className="text-lg font-medium text-gray-600 mb-2">{td.welcomeTitle}</p>
                <p className="text-sm">{td.welcomeMsg}</p>
              </div>
            )}
            {messages.map((msg) => (
              <div key={msg.id} className={`group flex ${msg.role === "user" ? "justify-end" : "justify-start"} gap-2`}>
                {msg.role === "assistant" && (
                  <div className="w-7 h-7 rounded-full bg-red-100 flex items-center justify-center shrink-0 mt-1 text-sm">🦞</div>
                )}
                <div className="flex flex-col max-w-[80%]">
                  <div className={`rounded-lg px-4 py-3 text-sm ${msg.role === "user" ? "bg-red-800 text-white" : "bg-gray-50 text-gray-800 border border-gray-200"}`}>
                    <div className={`prose prose-sm max-w-none [&>p]:my-1 [&>ul]:my-1 [&>ol]:my-1 [&>h1]:text-base [&>h2]:text-sm [&>h3]:text-sm [&_table]:text-xs [&_table]:border-collapse [&_th]:border [&_th]:px-2 [&_th]:py-1 [&_td]:border [&_td]:px-2 [&_td]:py-1 ${msg.role === "user" ? "prose-invert [&_th]:border-red-300 [&_td]:border-red-200 [&_th]:bg-red-400/30 [&_a]:text-red-100" : "prose-gray [&_th]:border-gray-300 [&_th]:bg-gray-50 [&_td]:border-gray-200"}`}>
                      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw]}>{msg.content}</ReactMarkdown>
                    </div>
                  </div>
                  {/* Action bar for assistant messages */}
                  {msg.role === "assistant" && (
                    <div className="flex items-center gap-1 mt-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      {/* Copy */}
                      <button
                        type="button"
                        onClick={() => handleCopy(msg)}
                        className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600 px-1.5 py-0.5 rounded hover:bg-gray-100 transition-colors cursor-pointer"
                        title={td.chatCopy || "Copy"}
                      >
                        {copiedId === msg.id ? (
                          <><svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg><span>{td.chatCopied || "Copied!"}</span></>
                        ) : (
                          <><svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><rect x="9" y="9" width="13" height="13" rx="2" strokeWidth={2} /><path strokeWidth={2} d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" /></svg><span>{td.chatCopy || "Copy"}</span></>
                        )}
                      </button>
                      {/* Share */}
                      <button
                        type="button"
                        onClick={() => handleShare(msg)}
                        className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600 px-1.5 py-0.5 rounded hover:bg-gray-100 transition-colors cursor-pointer"
                        title={td.chatShare || "Share"}
                      >
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 12v8a2 2 0 002 2h12a2 2 0 002-2v-8M16 6l-4-4-4 4M12 2v13" /></svg>
                        <span>{td.chatShare || "Share"}</span>
                      </button>
                      {/* Save to Knowledge Base */}
                      <button
                        type="button"
                        onClick={() => handleSaveToKb(msg)}
                        disabled={savingKbId === msg.id || savedKbId === msg.id}
                        className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600 px-1.5 py-0.5 rounded hover:bg-gray-100 transition-colors cursor-pointer disabled:opacity-50"
                        title={td.chatSaveKb || "Save to Knowledge Base"}
                      >
                        {savedKbId === msg.id ? (
                          <><svg className="w-3.5 h-3.5 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg><span className="text-green-500">{td.chatSavedKb || "Saved!"}</span></>
                        ) : savingKbId === msg.id ? (
                          <><svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth={4} /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg><span>{td.chatSavingKb || "Saving..."}</span></>
                        ) : (
                          <><svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z" /><polyline strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} points="17 21 17 13 7 13 7 21" /><polyline strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} points="7 3 7 8 15 8" /></svg><span>{td.chatSaveKb || "Save to KB"}</span></>
                        )}
                      </button>
                    </div>
                  )}
                </div>
              </div>
            ))}
            {sending && (
              <div className="flex justify-start gap-2">
                <div className="w-7 h-7 rounded-full bg-red-100 flex items-center justify-center shrink-0 mt-1 text-sm">🦞</div>
                <div className="bg-gray-50 border border-gray-200 text-gray-600 rounded-lg px-4 py-3 text-sm min-w-[200px]">
                  {toolSteps.length > 0 ? (
                    <div className="space-y-1.5">
                      {toolSteps.map((step, i) => (
                        <div key={i} className="flex flex-col gap-0.5">
                          <div className="flex items-center gap-2">
                            {step.error ? (
                              <svg className="w-3.5 h-3.5 text-red-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" /></svg>
                            ) : step.done ? (
                              <svg className="w-3.5 h-3.5 text-green-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" /></svg>
                            ) : (
                              <svg className="w-3.5 h-3.5 text-red-800 animate-spin shrink-0" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth={4} /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>
                            )}
                            <span className={step.error ? "text-red-500" : step.done ? "text-gray-400" : "text-gray-700 font-medium"}>{step.label}</span>
                          </div>
                          {step.error && step.errorDetail && (
                            <div className="ml-5.5 text-[11px] text-red-400 bg-red-50 rounded px-2 py-1 break-all" style={{ marginLeft: "22px" }}>{step.errorDetail}</div>
                          )}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <span className="animate-pulse">{td.thinking}</span>
                  )}
                </div>
              </div>
            )}
            <div ref={chatEndRef} />
          </div>
          {/* Tool execution history */}
          {toolExecutions.length > 0 && !sending && (
            <div className="border-t border-gray-100 px-4 py-2 bg-gray-50/50">
              <details className="text-xs">
                <summary className="cursor-pointer text-gray-500 hover:text-gray-700 select-none">
                  {td.chatToolHistory || "Tool executions"} ({toolExecutions.length})
                </summary>
                <div className="mt-2 space-y-1 max-h-32 overflow-y-auto">
                  {toolExecutions.map((t) => (
                    <div key={t.id} className="flex items-center gap-2 text-[11px]">
                      {t.status === "done" ? (
                        <span className="text-green-500">●</span>
                      ) : t.status === "error" ? (
                        <span className="text-red-500">●</span>
                      ) : (
                        <span className="text-yellow-500">●</span>
                      )}
                      <span className="font-mono text-gray-600">{t.tool_name}</span>
                      {t.duration_ms != null && <span className="text-gray-400">{(t.duration_ms / 1000).toFixed(1)}s</span>}
                      {t.status === "error" && t.error_message && (
                        <span className="text-red-400 truncate max-w-[200px]" title={t.error_message}>{t.error_message}</span>
                      )}
                      {t.status === "done" && t.result_summary && (
                        <span className="text-gray-400 truncate max-w-[200px]" title={t.result_summary}>{t.result_summary.slice(0, 60)}...</span>
                      )}
                    </div>
                  ))}
                </div>
              </details>
            </div>
          )}
          <div className="border-t border-gray-200 px-4 pt-2 pb-1">
            <div className="flex items-center gap-2">
              <select
                value={selectedModel}
                onChange={(e) => setSelectedModel(e.target.value)}
                className="text-xs border border-gray-200 rounded-md px-2 py-1 text-gray-600 bg-white focus:outline-none focus:ring-1 focus:ring-red-500 cursor-pointer"
              >
                <option value="auto">{td.modelAuto}</option>
                {models.map((m) => (
                  <option key={m.id} value={m.id} disabled={!m.available}>
                    {m.name} ({formatCost(m.costPer1MInput, m.costPer1MOutput)}) {!m.available ? `— ${td.modelNeedsByok}` : ""}
                  </option>
                ))}
              </select>
              {selectedModel !== "auto" && (
                <span className="text-xs text-gray-400">
                  {(() => {
                    const m = models.find((x) => x.id === selectedModel);
                    if (!m) return "";
                    if (m.costPer1MInput === 0) return td.modelFree;
                    return `$${(m.costPer1MInput / 100).toFixed(2)}/${td.modelMInput} · $${(m.costPer1MOutput / 100).toFixed(2)}/${td.modelMOutput}`;
                  })()}
                </span>
              )}
            </div>
          </div>
          {secretWarning && (
            <div className="mx-4 mb-2 rounded-lg border border-yellow-300 bg-yellow-50 p-3">
              <div className="flex items-start gap-2">
                <svg className="w-5 h-5 text-yellow-600 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
                </svg>
                <div className="flex-1 text-sm">
                  {secretWarning === "byok" ? (
                    <p className="text-yellow-800">
                      <strong>{td.secretWarningByokTitle || "API key detected."}</strong>{" "}
                      {td.secretWarningByokBody || "Your key will be encrypted and stored securely. The key in your message will be redacted from chat history."}
                    </p>
                  ) : (
                    <p className="text-yellow-800">
                      <strong>{td.secretWarningTitle || "Possible secret key detected"}</strong>{" "}
                      ({secretWarning}).{" "}
                      {td.secretWarningBody || "Sending API keys in chat is not recommended. Use Settings > BYOK to add keys securely instead."}
                    </p>
                  )}
                  <div className="flex gap-2 mt-2">
                    <button
                      type="button"
                      onClick={confirmSendSecret}
                      className="text-xs bg-yellow-600 hover:bg-yellow-700 text-white px-3 py-1 rounded font-medium transition-colors cursor-pointer"
                    >
                      {td.secretSendAnyway || "Send anyway"}
                    </button>
                    <button
                      type="button"
                      onClick={cancelSendSecret}
                      className="text-xs bg-white hover:bg-gray-100 text-gray-700 border border-gray-300 px-3 py-1 rounded font-medium transition-colors cursor-pointer"
                    >
                      {td.secretCancel || "Cancel"}
                    </button>
                    {secretWarning !== "byok" && (
                      <Link
                        href={`/${locale}/dashboard/settings`}
                        className="text-xs text-yellow-700 underline hover:text-yellow-900 py-1"
                      >
                        {td.secretGoSettings || "Go to Settings"}
                      </Link>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}
          <form onSubmit={sendMessage} className="px-4 pb-4 pt-2 flex gap-3 items-end">
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => {
                setInput(e.target.value);
                const el = e.target;
                el.style.height = "auto";
                el.style.height = Math.min(el.scrollHeight, 128) + "px";
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  sendMessage(e);
                }
              }}
              placeholder={td.typeMessage}
              rows={1}
              className="flex-1 border border-gray-300 rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent resize-none max-h-32 overflow-y-auto"
              disabled={sending}
            />
            <button type="submit" disabled={sending || !input.trim()} className="bg-red-800 hover:bg-red-900 disabled:bg-gray-300 text-white px-5 py-2.5 rounded-lg text-sm font-medium transition-colors cursor-pointer shrink-0">
              {tc.send}
            </button>
          </form>
        </div>
        </div>{/* close flex sidebar+chat wrapper */}
      </div>
      {/* Share toast */}
      {shareToast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-gray-800 text-white text-sm px-4 py-2 rounded-lg shadow-lg z-50 animate-fade-in">
          {shareToast}
        </div>
      )}
    </DashboardShell>
  );
}
