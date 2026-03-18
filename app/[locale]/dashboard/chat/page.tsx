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

  function refreshQuota() {
    fetch("/api/status")
      .then((r) => r.json())
      .then((data) => {
        if (data.user) setQuota({ ...data.user, nextResetUtc: data.nextResetUtc });
      })
      .catch(() => {});
  }

  useEffect(() => {
    if (!user) return;
    fetch("/api/chat")
      .then((r) => r.json())
      .then((data) => setMessages(data.messages || []));
    fetch("/api/models")
      .then((r) => r.json())
      .then((data) => setModels(data.models || []));
    refreshQuota();
  }, [user]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const [toolStatus, setToolStatus] = useState<string>("");

  async function doSendMessage(userMsg: string) {
    setSending(true);
    setToolStatus("");
    const tempMsg: ChatMessage = { id: Date.now(), role: "user", content: userMsg, created_at: new Date().toISOString() };
    setMessages((prev) => [...prev, tempMsg]);
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: userMsg, model: selectedModel !== "auto" ? selectedModel : undefined, locale }),
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
                  if (evt.type === "step") setToolStatus(evt.message);
                  if (evt.type === "done") { finalReply = evt.reply; setToolStatus(""); }
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
        <h1 className="text-2xl font-bold mb-6">{td.title}</h1>

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
              <div key={msg.id} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"} gap-2`}>
                {msg.role === "assistant" && (
                  <div className="w-7 h-7 rounded-full bg-red-100 flex items-center justify-center shrink-0 mt-1 text-sm">🦞</div>
                )}
                <div className={`max-w-[80%] rounded-lg px-4 py-3 text-sm ${msg.role === "user" ? "bg-red-800 text-white" : "bg-gray-50 text-gray-800 border border-gray-200"}`}>
                  <div className={`prose prose-sm max-w-none [&>p]:my-1 [&>ul]:my-1 [&>ol]:my-1 [&>h1]:text-base [&>h2]:text-sm [&>h3]:text-sm [&_table]:text-xs [&_table]:border-collapse [&_th]:border [&_th]:px-2 [&_th]:py-1 [&_td]:border [&_td]:px-2 [&_td]:py-1 ${msg.role === "user" ? "prose-invert [&_th]:border-red-300 [&_td]:border-red-200 [&_th]:bg-red-400/30 [&_a]:text-red-100" : "prose-gray [&_th]:border-gray-300 [&_th]:bg-gray-50 [&_td]:border-gray-200"}`}>
                    <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw]}>{msg.content}</ReactMarkdown>
                  </div>
                </div>
              </div>
            ))}
            {sending && (
              <div className="flex justify-start">
                <div className="bg-gray-100 text-gray-500 rounded-lg px-4 py-3 text-sm">
                  <span className="animate-pulse">{toolStatus || td.thinking}</span>
                </div>
              </div>
            )}
            <div ref={chatEndRef} />
          </div>
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
      </div>
    </DashboardShell>
  );
}
