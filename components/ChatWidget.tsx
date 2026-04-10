"use client";

import { useEffect, useRef, useState } from "react";
import { useParams, usePathname } from "next/navigation";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { getDictionary, type Locale } from "@/lib/i18n";

interface ChatMessage {
  id: number;
  role: "user" | "assistant";
  content: string;
  created_at: string;
}

interface Conversation {
  id: number;
  title: string;
  message_count: number;
  updated_at: string;
}

export default function ChatWidget() {
  const params = useParams();
  const pathname = usePathname();
  const locale = (params.locale as Locale) || "en";
  const dict = getDictionary(locale);
  const td = dict.dashboard;
  const tc = dict.common;

  const [open, setOpen] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConvId, setActiveConvId] = useState<number | null>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);

  const isChatPage = pathname?.endsWith("/dashboard/chat");

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
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }

  useEffect(() => {
    if (!open || loaded) return;
    fetchConversations();
    loadMessages(null);
  }, [open, loaded]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

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
        setShowHistory(false);
        fetchConversations();
      }
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
        loadMessages(null);
      }
      fetchConversations();
    } catch { /* ignore */ }
  }

  function switchConversation(convId: number | null) {
    setActiveConvId(convId);
    loadMessages(convId);
    setShowHistory(false);
  }

  async function autoNameConversation(convId: number, firstMessage: string) {
    const title = firstMessage.length > 50
      ? firstMessage.slice(0, 50).trimEnd() + "…"
      : firstMessage;
    try {
      await fetch("/api/conversations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "rename", conversation_id: convId, title }),
      });
    } catch { /* ignore */ }
  }

  async function sendMessage(e: React.FormEvent) {
    e.preventDefault();
    if (!input.trim() || sending) return;
    const userMsg = input.trim();
    const isFirstMessage = messages.length === 0 && activeConvId !== null;
    setInput("");
    setSending(true);
    const tempMsg: ChatMessage = { id: Date.now(), role: "user", content: userMsg, created_at: new Date().toISOString() };
    setMessages((prev) => [...prev, tempMsg]);
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: userMsg,
          locale,
          conversation_id: activeConvId ? String(activeConvId) : undefined,
        }),
      });

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
                  if (evt.type === "done") finalReply = evt.reply;
                } catch { /* skip */ }
              }
            }
          }
        }
        if (finalReply) {
          setMessages((prev) => [...prev, { id: Date.now() + 1, role: "assistant", content: finalReply, created_at: new Date().toISOString() }]);
        }
      } else {
        const data = await res.json();
        if (data.reply) {
          setMessages((prev) => [...prev, { id: Date.now() + 1, role: "assistant", content: data.reply, created_at: new Date().toISOString() }]);
        }
      }
    } catch {
      setMessages((prev) => [...prev, { id: Date.now() + 1, role: "assistant", content: td.errorMsg, created_at: new Date().toISOString() }]);
    } finally {
      setSending(false);
      if (isFirstMessage && activeConvId) {
        await autoNameConversation(activeConvId, userMsg);
      }
      fetchConversations();
    }
  }

  if (isChatPage) return null;

  return (
    <>
      {/* Floating button */}
      {!open && (
        <button
          onClick={() => setOpen(true)}
          className="fixed bottom-6 right-6 z-50 w-14 h-14 bg-red-100 hover:bg-red-200 text-red-600 rounded-full shadow-lg flex items-center justify-center transition-all hover:scale-105 cursor-pointer text-2xl"
          title={tc.chat}
        >
          🦞
        </button>
      )}

      {/* Chat panel */}
      {open && (
        <div className={`fixed z-50 bg-white shadow-2xl border border-gray-200 flex flex-col overflow-hidden transition-all duration-300 ${
          fullscreen
            ? "inset-0 rounded-none"
            : "bottom-6 right-6 w-[360px] max-w-[calc(100vw-2rem)] h-[500px] max-h-[calc(100vh-6rem)] rounded-xl"
        }`}>
          {/* Header */}
          <div className="px-4 py-3 bg-red-700 text-white flex items-center justify-between shrink-0">
            <div className="flex items-center gap-2">
              <span className="font-semibold text-sm">{tc.chat}</span>
              {activeConvId !== null && (
                <span className="text-white/60 text-xs truncate max-w-[120px]">
                  — {conversations.find((c) => c.id === activeConvId)?.title || ""}
                </span>
              )}
            </div>
            <div className="flex items-center gap-1">
              {/* New conversation */}
              <button
                onClick={handleNewConversation}
                className="text-white/70 hover:text-white cursor-pointer p-1"
                title={td.chatNewConv || "New Chat"}
              >
                <svg className="w-4.5 h-4.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
              </button>
              {/* History toggle */}
              <button
                onClick={() => { setShowHistory((v) => !v); if (!showHistory) fetchConversations(); }}
                className={`p-1 cursor-pointer ${showHistory ? "text-white" : "text-white/70 hover:text-white"}`}
                title={td.chatConversations || "Conversations"}
              >
                <svg className="w-4.5 h-4.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </button>
              {/* Fullscreen toggle */}
              <button onClick={() => setFullscreen((f) => !f)} className="text-white/70 hover:text-white cursor-pointer p-1" title={fullscreen ? "Minimize" : "Fullscreen"}>
                {fullscreen ? (
                  <svg className="w-4.5 h-4.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 9L4 4m0 0v4m0-4h4m6 6l5 5m0 0v-4m0 4h-4M9 15l-5 5m0 0v-4m0 4h4m6-6l5-5m0 0v4m0-4h-4" />
                  </svg>
                ) : (
                  <svg className="w-4.5 h-4.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4m0 0h4M4 4l5 5m11-5h-4m4 0v4m0-4l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5h-4m4 0v-4m0 4l-5-5" />
                  </svg>
                )}
              </button>
              {/* Close */}
              <button onClick={() => { setOpen(false); setFullscreen(false); setShowHistory(false); }} className="text-white/70 hover:text-white cursor-pointer p-1">
                <svg className="w-4.5 h-4.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>

          {/* Body: history sidebar + messages */}
          <div className="flex-1 flex min-h-0">
            {/* History sidebar */}
            {showHistory && (
              <div className="w-48 shrink-0 border-r border-gray-200 flex flex-col bg-gray-50 overflow-hidden">
                <div className="px-3 py-2 border-b border-gray-100 flex items-center justify-between">
                  <span className="text-[11px] font-medium text-gray-500 uppercase tracking-wide">{td.chatConversations || "History"}</span>
                </div>
                <div className="flex-1 overflow-y-auto">
                  {/* General (default) */}
                  <button
                    type="button"
                    onClick={() => switchConversation(null)}
                    className={`w-full text-left px-3 py-2 text-xs border-b border-gray-100 hover:bg-gray-100 transition-colors cursor-pointer ${activeConvId === null ? "bg-red-50 text-red-800 font-medium" : "text-gray-700"}`}
                  >
                    <div className="truncate">{td.chatGeneral || "General"}</div>
                  </button>
                  {conversations.map((conv) => (
                    <div
                      key={conv.id}
                      className={`group relative border-b border-gray-100 ${activeConvId === conv.id ? "bg-red-50" : "hover:bg-gray-100"}`}
                    >
                      <button
                        type="button"
                        onClick={() => switchConversation(conv.id)}
                        className={`w-full text-left px-3 py-2 text-xs cursor-pointer ${activeConvId === conv.id ? "text-red-800 font-medium" : "text-gray-700"}`}
                      >
                        <div className="truncate pr-5">{conv.title}</div>
                        <div className="text-[10px] text-gray-400 mt-0.5">{conv.message_count} msgs</div>
                      </button>
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); handleDeleteConversation(conv.id); }}
                        className="absolute right-1.5 top-1/2 -translate-y-1/2 hidden group-hover:block text-gray-400 hover:text-red-500 p-0.5 cursor-pointer"
                        title="Delete"
                      >
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </button>
                    </div>
                  ))}
                  {conversations.length === 0 && (
                    <p className="text-[11px] text-gray-400 text-center py-4">{td.chatNoConv || "No conversations yet"}</p>
                  )}
                </div>
              </div>
            )}

            {/* Messages area */}
            <div className="flex-1 flex flex-col min-w-0">
              <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
                {messages.length === 0 && loaded && (
                  <div className="text-center mt-8">
                    <div className="text-2xl mb-2">🦞</div>
                    <p className="text-xs text-gray-400">{td.typeMessage}</p>
                  </div>
                )}
                {messages.map((msg) => (
                  <div key={msg.id} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"} gap-1.5`}>
                    {msg.role === "assistant" && (
                      <div className="w-6 h-6 rounded-full bg-red-100 flex items-center justify-center shrink-0 mt-1 text-xs">🦞</div>
                    )}
                    <div
                      className={`max-w-[75%] px-3 py-2 rounded-lg text-sm ${
                        msg.role === "user"
                          ? "bg-red-700 text-white"
                          : "bg-gray-50 text-gray-800 border border-gray-200"
                      }`}
                    >
                      <div className={`prose prose-sm max-w-none [&>p]:my-0.5 [&>ul]:my-0.5 [&>ol]:my-0.5 [&>h1]:text-sm [&>h2]:text-sm [&>h3]:text-xs [&_pre]:text-xs [&_code]:text-xs ${msg.role === "user" ? "prose-invert" : "prose-gray"}`}>
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.content}</ReactMarkdown>
                      </div>
                    </div>
                  </div>
                ))}
                {sending && (
                  <div className="flex justify-start">
                    <div className="bg-gray-100 text-gray-400 px-3 py-2 rounded-lg text-sm">
                      <span className="animate-pulse">...</span>
                    </div>
                  </div>
                )}
                <div ref={chatEndRef} />
              </div>

              {/* Input */}
              <form onSubmit={sendMessage} className="px-3 py-3 border-t border-gray-200 flex gap-2 shrink-0">
                <input
                  type="text"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder={td.typeMessage}
                  className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent"
                  disabled={sending}
                />
                <button
                  type="submit"
                  disabled={sending || !input.trim()}
                  className="bg-red-700 hover:bg-red-800 disabled:bg-gray-300 text-white px-3 py-2 rounded-lg text-sm font-medium transition-colors cursor-pointer"
                >
                  {tc.send}
                </button>
              </form>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
