"use client";

import { useUser } from "@auth0/nextjs-auth0/client";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { getDictionary, type Locale } from "@/lib/i18n";
import DashboardShell from "@/components/DashboardShell";

interface TikTokStatus {
  connected: boolean;
  openId?: string;
  expiresAt?: string;
  scope?: string;
  authUrl?: string;
  displayName?: string;
  username?: string;
  avatarUrl?: string;
}

interface GeneratedVideo {
  taskId: string;
  status: "processing" | "completed" | "failed";
  videoUrl?: string;
  prompt: string;
  model?: string;
  createdAt?: string;
}

export default function TikTokPage() {
  const { user } = useUser();
  const params = useParams();
  const locale = (params.locale as Locale) || "en";
  const dict = getDictionary(locale);
  const t = dict.tiktokPage;

  const [status, setStatus] = useState<TikTokStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [posting, setPosting] = useState(false);
  const [message, setMessage] = useState("");
  const [videoTitle, setVideoTitle] = useState("");
  const [videoUrl, setVideoUrl] = useState("");
  const [privacy, setPrivacy] = useState("PUBLIC_TO_EVERYONE");
  const [isAigc, setIsAigc] = useState(false);

  // Video generation state
  const [genPrompt, setGenPrompt] = useState("");
  const [genDuration, setGenDuration] = useState("5");
  const [genModel, setGenModel] = useState("wavespeed-ai/wan-2.2/t2v-480p-ultra-fast");
  const [generating, setGenerating] = useState(false);
  const [genVideos, setGenVideos] = useState<GeneratedVideo[]>([]);
  const [genMessage, setGenMessage] = useState("");
  const [xpilotKey, setXpilotKey] = useState<string | null>(null);
  const [videoModels, setVideoModels] = useState<{ id: string; label: string; tier: string; durations?: number[] }[]>([]);
  const [narrationEnabled, setNarrationEnabled] = useState(false);
  const [narrationText, setNarrationText] = useState("");
  const [narrationVoice, setNarrationVoice] = useState("nova");
  const [narrationStyle, setNarrationStyle] = useState("professional");
  const [genAudioEnabled, setGenAudioEnabled] = useState(false);

  useEffect(() => {
    fetchStatus();
    fetchXpilotKey();
    fetchModels();
    fetchVideoHistory();
  }, []);

  async function fetchStatus() {
    try {
      const res = await fetch("/api/tiktok/post");
      const data = await res.json();
      if (res.ok) {
        setStatus(data);
      } else if (res.status === 401) {
        setStatus({ connected: false });
      } else {
        setStatus({ connected: false, authUrl: data.authUrl });
      }
    } catch {
      setStatus({ connected: false });
    } finally {
      setLoading(false);
    }
  }

  async function fetchXpilotKey() {
    try {
      const res = await fetch("/api/api-keys");
      const data = await res.json();
      const key = data.keys?.find((k: { service: string }) => k.service === "xpilot");
      setXpilotKey(key ? "configured" : null);
    } catch {
      setXpilotKey(null);
    }
  }

  async function fetchModels() {
    try {
      const res = await fetch("/api/tiktok/generate?listModels=true");
      const data = await res.json();
      if (data.models) setVideoModels(data.models);
    } catch {
      // ignore
    }
  }

  async function fetchVideoHistory() {
    try {
      const res = await fetch("/api/tiktok/generate?listVideos=true");
      const data = await res.json();
      if (data.videos) {
        const history: GeneratedVideo[] = data.videos.map((v: { task_id: string; status: string; video_url?: string; blob_url?: string; proxy_url?: string; prompt: string; model?: string; created_at?: string }) => ({
          taskId: v.task_id,
          status: v.status as GeneratedVideo["status"],
          videoUrl: v.proxy_url || v.blob_url || v.video_url,
          prompt: v.prompt,
          model: v.model,
          createdAt: v.created_at,
        }));
        setGenVideos((prev) => {
          // Merge: keep in-progress items from current session, append history
          const currentTaskIds = new Set(prev.map((p) => p.taskId));
          const newHistory = history.filter((h: GeneratedVideo) => !currentTaskIds.has(h.taskId));
          return [...prev, ...newHistory];
        });
      }
    } catch {
      // ignore
    }
  }

  async function handlePost(mode: "direct" | "draft" = "direct") {
    if (!videoUrl) return;
    if (mode === "direct" && !videoTitle) return;
    setPosting(true);
    setMessage("");
    try {
      const res = await fetch("/api/tiktok/post", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: videoTitle,
          videoUrl,
          privacyLevel: privacy,
          mode,
          isAigc,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setMessage(data.message || t.posted);
        setVideoTitle("");
        setVideoUrl("");
      } else {
        setMessage(`${t.postFailed}: ${data.error}${data.details?.code ? ` (${data.details.code})` : ""}`);
      }
    } catch {
      setMessage(t.postFailed);
    } finally {
      setPosting(false);
    }
  }

  async function handleGenerate() {
    if (!genPrompt) return;
    setGenerating(true);
    setGenMessage("");
    try {
      const res = await fetch("/api/tiktok/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: genPrompt,
          duration: parseInt(genDuration),
          model: genModel,
          ...(narrationEnabled && narrationText ? {
            narration: { text: narrationText, voice: narrationVoice, style: narrationStyle },
          } : {}),
          ...(genAudioEnabled ? { generate_audio: true } : {}),
        }),
      });
      const data = await res.json();
      if (data.taskId) {
        const newVideo: GeneratedVideo = {
          taskId: data.taskId,
          status: "processing",
          prompt: genPrompt,
          model: genModel,
          createdAt: new Date().toISOString(),
        };
        setGenVideos((prev) => [newVideo, ...prev]);
        setGenMessage(t.genSubmitted);
        setGenPrompt("");
        pollVideoStatus(data.taskId, data.provider, data.pollUrl);
      } else {
        const errStr = typeof data.error === "string" ? data.error : JSON.stringify(data.error);
        setGenMessage(`${t.genFailed}: ${errStr}`);
      }
    } catch {
      setGenMessage(t.genFailed);
    } finally {
      setGenerating(false);
    }
  }

  async function pollVideoStatus(taskId: string, provider?: string, pollUrl?: string) {
    const maxAttempts = 60;
    for (let i = 0; i < maxAttempts; i++) {
      await new Promise((r) => setTimeout(r, 5000));
      try {
        const params = new URLSearchParams({ taskId });
        if (provider) params.set("provider", provider);
        if (pollUrl) params.set("pollUrl", pollUrl);
        const res = await fetch(`/api/tiktok/generate?${params.toString()}`);
        const data = await res.json();
        if (data.status === "completed" && data.videoUrl) {
          setGenVideos((prev) =>
            prev.map((v) =>
              v.taskId === taskId ? { ...v, status: "completed", videoUrl: data.videoUrl } : v
            )
          );
          return;
        } else if (data.status === "failed") {
          setGenVideos((prev) =>
            prev.map((v) => (v.taskId === taskId ? { ...v, status: "failed" } : v))
          );
          return;
        }
      } catch {
        // continue polling
      }
    }
    setGenVideos((prev) =>
      prev.map((v) => (v.taskId === taskId ? { ...v, status: "failed" } : v))
    );
  }

  async function handleConnect() {
    const clientKey = "sbawg8ocnk6tzdia9g";
    const redirectUri = `${window.location.origin}/api/tiktok/callback`;
    const scope = "user.info.basic,video.publish,video.upload";

    // PKCE: generate code_verifier and code_challenge (S256)
    const verifier = base64UrlEncode(crypto.getRandomValues(new Uint8Array(64)));
    const challengeBuf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
    const challenge = base64UrlEncode(new Uint8Array(challengeBuf));

    // Persist verifier so the callback (server) can use it. Cookie is fine for short-lived OAuth flow.
    document.cookie = `tiktok_pkce_verifier=${verifier}; Path=/; Max-Age=600; SameSite=Lax`;

    const authUrl = `https://www.tiktok.com/v2/auth/authorize/?client_key=${clientKey}&scope=${scope}&response_type=code&redirect_uri=${encodeURIComponent(redirectUri)}&state=xpilot&code_challenge=${challenge}&code_challenge_method=S256`;
    window.location.href = authUrl;
  }

  function base64UrlEncode(bytes: Uint8Array): string {
    let str = "";
    for (let i = 0; i < bytes.length; i++) str += String.fromCharCode(bytes[i]);
    return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }

  function useGeneratedVideo(video: GeneratedVideo) {
    if (video.videoUrl) {
      setVideoUrl(video.videoUrl);
      setVideoTitle(video.prompt.slice(0, 150) + " #xPilot #AIMarketing");
    }
  }

  if (!user) return null;

  return (
    <DashboardShell user={user}>
      <div className="max-w-4xl mx-auto space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{t.title}</h1>
          <p className="text-gray-500 mt-1">{t.subtitle}</p>
        </div>

        {/* Under Review Notice */}
        <div className="bg-blue-600 rounded-lg p-4 flex items-start gap-3">
          <svg className="w-5 h-5 text-white mt-0.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <span className="text-white text-sm font-semibold">{t.underReviewNotice}</span>
        </div>

        {/* Connection Status */}
        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">{t.accountInfo}</h2>
          {loading ? (
            <div className="text-gray-500">Loading...</div>
          ) : status?.connected ? (
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                {status.avatarUrl && (
                  <img src={status.avatarUrl} alt={status.displayName || "TikTok"} className="w-12 h-12 rounded-full border border-gray-200" referrerPolicy="no-referrer" />
                )}
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="inline-block w-3 h-3 rounded-full bg-green-500" />
                    <span className="text-green-700 font-medium">{t.connected}</span>
                  </div>
                  {status.displayName && (
                    <div className="text-base font-semibold text-gray-900 mt-1">{status.displayName}</div>
                  )}
                  {status.username && (
                    <div className="text-sm text-gray-500">@{status.username}</div>
                  )}
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                <div>
                  <span className="text-gray-500">{t.openId}:</span>
                  <span className="ml-2 text-gray-800 font-mono text-xs">{status.openId}</span>
                </div>
                <div>
                  <span className="text-gray-500">{t.scope}:</span>
                  <span className="ml-2 text-gray-800">{status.scope}</span>
                </div>
                <div>
                  <span className="text-gray-500">{t.expiresAt}:</span>
                  <span className="ml-2 text-gray-800">
                    {status.expiresAt
                      ? new Date(status.expiresAt).toLocaleString()
                      : "-"}
                  </span>
                </div>
              </div>
              <button
                onClick={handleConnect}
                className="mt-3 text-xs text-gray-500 hover:text-red-600 underline transition-colors"
              >
                Re-authorize
              </button>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <span className="inline-block w-3 h-3 rounded-full bg-red-500" />
                <span className="text-red-600 font-medium">{t.notConnected}</span>
              </div>
              <p className="text-gray-500 text-sm">{t.noAccount}</p>
              <button
                onClick={handleConnect}
                className="px-4 py-2 bg-[#fe2c55] hover:bg-[#e0274d] text-white rounded-lg font-medium transition-colors"
              >
                {t.authorize}
              </button>
            </div>
          )}
        </div>

        {/* AI Video Generation */}
        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <div className="flex items-center gap-2 mb-4">
            <h2 className="text-lg font-semibold text-gray-900">{t.genTitle}</h2>
            <span className="text-xs bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full font-medium">xPilot AI</span>
          </div>

          {!xpilotKey ? (
            <div className="text-center py-6">
              <p className="text-gray-500 text-sm mb-3">{t.genNeedKey}</p>
              <a
                href={`/${locale}/dashboard/settings`}
                className="inline-block px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg text-sm font-medium transition-colors"
              >
                {t.genConfigKey}
              </a>
            </div>
          ) : (
            <div className="space-y-4">
              <div>
                <label className="block text-sm text-gray-600 mb-1">{t.genPromptLabel}</label>
                <textarea
                  value={genPrompt}
                  onChange={(e) => setGenPrompt(e.target.value)}
                  placeholder={t.genPromptPlaceholder}
                  rows={3}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-purple-500 resize-none"
                />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm text-gray-600 mb-1">{t.genModel}</label>
                  <select
                    value={genModel}
                    onChange={(e) => {
                      const newModel = e.target.value;
                      setGenModel(newModel);
                      const durations = videoModels.find((m) => m.id === newModel)?.durations || [5, 8];
                      if (!durations.includes(parseInt(genDuration))) {
                        setGenDuration(String(durations[0]));
                      }
                    }}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-gray-900 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-purple-500 text-sm"
                  >
                    {videoModels.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.label} ({m.tier})
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm text-gray-600 mb-1">{t.genDuration}</label>
                  <select
                    value={genDuration}
                    onChange={(e) => setGenDuration(e.target.value)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-gray-900 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
                  >
                    {(videoModels.find((m) => m.id === genModel)?.durations || [5, 8]).map((d) => (
                      <option key={d} value={String(d)}>{d}s</option>
                    ))}
                  </select>
                </div>
                <div className="flex items-end">
                <button
                  onClick={handleGenerate}
                  disabled={generating || !genPrompt}
                  className="w-full px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {generating ? t.genGenerating : t.genGenerate}
                </button>
                </div>
              </div>

              {/* Narration / Voice-over */}
              <div className="border border-gray-200 rounded-lg p-4 space-y-3">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={narrationEnabled}
                    onChange={(e) => setNarrationEnabled(e.target.checked)}
                    className="rounded border-gray-300 text-purple-600 focus:ring-purple-500"
                  />
                  <span className="text-sm font-medium text-gray-700">Add Voice Narration</span>
                </label>

                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={genAudioEnabled}
                    onChange={(e) => setGenAudioEnabled(e.target.checked)}
                    className="rounded border-gray-300 text-purple-600 focus:ring-purple-500"
                  />
                  <span className="text-sm font-medium text-gray-700">Generate Audio</span>
                  <span className="text-xs text-gray-400">(Seedance / Kling / Wan 2.6)</span>
                </label>

                {narrationEnabled && (
                  <div className="space-y-3">
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">Narration Text</label>
                      <textarea
                        value={narrationText}
                        onChange={(e) => setNarrationText(e.target.value)}
                        placeholder="Text to be spoken over the video..."
                        rows={2}
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-purple-500 resize-none"
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs text-gray-500 mb-1">Voice</label>
                        <div className="flex gap-2">
                          <select
                            value={narrationVoice}
                            onChange={(e) => setNarrationVoice(e.target.value)}
                            className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
                          >
                            <option value="alloy">Alloy</option>
                            <option value="echo">Echo</option>
                            <option value="fable">Fable</option>
                            <option value="onyx">Onyx</option>
                            <option value="nova">Nova</option>
                            <option value="shimmer">Shimmer</option>
                          </select>
                          <button
                            type="button"
                            onClick={async () => {
                              try {
                                const res = await fetch(`/api/tts-sample?voice=${narrationVoice}`);
                                if (!res.ok) {
                                  const data = await res.json();
                                  setGenMessage(data.error || "Failed to play sample");
                                  return;
                                }
                                const blob = await res.blob();
                                const url = URL.createObjectURL(blob);
                                const audio = new Audio(url);
                                audio.play();
                                audio.onended = () => URL.revokeObjectURL(url);
                              } catch {
                                setGenMessage("Failed to play voice sample");
                              }
                            }}
                            className="px-3 py-2 border border-gray-300 rounded-lg text-gray-600 hover:bg-gray-50 transition-colors"
                            title="Preview voice"
                          >
                            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                              <path d="M8 5v14l11-7z" />
                            </svg>
                          </button>
                        </div>
                      </div>
                      <div>
                        <label className="block text-xs text-gray-500 mb-1">Style</label>
                        <select
                          value={narrationStyle}
                          onChange={(e) => setNarrationStyle(e.target.value)}
                          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
                        >
                          <option value="professional">Professional</option>
                          <option value="casual">Casual</option>
                          <option value="dramatic">Dramatic</option>
                          <option value="documentary">Documentary</option>
                          <option value="enthusiastic">Enthusiastic</option>
                        </select>
                      </div>
                    </div>
                  </div>
                )}
              </div>
              {genMessage && (
                <div className={`text-sm p-3 rounded-lg ${genMessage.includes(t.genFailed) ? "bg-red-50 text-red-600 border border-red-200" : "bg-purple-50 text-purple-700 border border-purple-200"}`}>
                  {genMessage}
                </div>
              )}

              {/* Generated Videos */}
              {genVideos.length > 0 && (
                <div className="space-y-3 mt-4">
                  <h3 className="text-sm font-medium text-gray-700">{t.genResults}</h3>
                  {genVideos.map((video) => (
                    <div key={video.taskId} className="border border-gray-200 rounded-lg p-4 space-y-2">
                      <p className="text-sm text-gray-700 line-clamp-2">{video.prompt}</p>
                      <div className="flex items-center gap-2 text-xs text-gray-400">
                        {video.model && <span>{video.model.split("/").pop()}</span>}
                        {video.createdAt && <span>· {new Date(video.createdAt).toLocaleString()}</span>}
                      </div>
                      <div className="flex items-center gap-3">
                        {video.status === "processing" && (
                          <span className="flex items-center gap-2 text-xs text-amber-600">
                            <span className="inline-block w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
                            {t.genProcessing}
                          </span>
                        )}
                        {video.status === "completed" && (
                          <>
                            <span className="flex items-center gap-2 text-xs text-green-600">
                              <span className="inline-block w-2 h-2 rounded-full bg-green-500" />
                              {t.genCompleted}
                            </span>
                            <a
                              href={video.videoUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-xs text-purple-600 hover:text-purple-800 underline"
                            >
                              {t.genPreview}
                            </a>
                            {status?.connected && (
                              <button
                                onClick={() => useGeneratedVideo(video)}
                                className="text-xs bg-[#fe2c55] hover:bg-[#e0274d] text-white px-3 py-1 rounded-lg transition-colors"
                              >
                                {t.genUseForPost}
                              </button>
                            )}
                          </>
                        )}
                        {video.status === "failed" && (
                          <span className="flex items-center gap-2 text-xs text-red-600">
                            <span className="inline-block w-2 h-2 rounded-full bg-red-500" />
                            {t.genFailed}
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Post Video Form */}
        {status?.connected && (
          <div className="bg-white rounded-lg border border-gray-200 p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">{t.postVideo}</h2>
            <div className="space-y-4">
              <div>
                <label className="block text-sm text-gray-600 mb-1">{t.videoTitle}</label>
                <input
                  type="text"
                  value={videoTitle}
                  onChange={(e) => setVideoTitle(e.target.value)}
                  placeholder="xPilot - AI Social Media Copilot #xPilot #AIMarketing"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-red-500"
                />
              </div>
              <div>
                <label className="block text-sm text-gray-600 mb-1">{t.videoUrl}</label>
                <input
                  type="url"
                  value={videoUrl}
                  onChange={(e) => setVideoUrl(e.target.value)}
                  placeholder="https://example.com/video.mp4"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-red-500"
                />
              </div>
              <div>
                <label className="block text-sm text-gray-600 mb-1">{t.privacy}</label>
                <select
                  value={privacy}
                  onChange={(e) => setPrivacy(e.target.value)}
                  className="border border-gray-300 rounded-lg px-3 py-2 text-gray-900 focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-red-500"
                >
                  <option value="PUBLIC_TO_EVERYONE">{t.privacyPublic}</option>
                  <option value="SELF_ONLY">{t.privacySelf}</option>
                  <option value="MUTUAL_FOLLOW_FRIENDS">{t.privacyFriends}</option>
                </select>
              </div>
              <div>
                <label className="flex items-start gap-2 text-sm text-gray-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={isAigc}
                    onChange={(e) => setIsAigc(e.target.checked)}
                    className="mt-0.5 rounded border-gray-300 text-[#fe2c55] focus:ring-[#fe2c55]"
                  />
                  <span>
                    <span className="font-medium">AI-generated content</span>
                    <span className="block text-xs text-gray-500 mt-0.5">
                      Required by TikTok if the video was created or significantly edited with AI tools. TikTok will display an &ldquo;AI-generated&rdquo; label on the post.
                    </span>
                  </span>
                </label>
              </div>
              {message && (
                <div
                  className={`text-sm p-3 rounded-lg ${
                    message.includes(t.posted)
                      ? "bg-green-50 text-green-700 border border-green-200"
                      : "bg-red-50 text-red-600 border border-red-200"
                  }`}
                >
                  {message}
                </div>
              )}
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => handlePost("direct")}
                  disabled={posting || !videoTitle || !videoUrl}
                  className="px-4 py-2 bg-[#fe2c55] hover:bg-[#e0274d] text-white rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {posting ? t.posting : t.postVideo}
                </button>
                <button
                  onClick={() => handlePost("draft")}
                  disabled={posting || !videoUrl}
                  title="Upload to your TikTok app drafts/inbox. Open the TikTok app to finalize and publish (works for unaudited apps)."
                  className="px-4 py-2 bg-white hover:bg-gray-50 text-gray-800 border border-gray-300 rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {posting ? "Uploading..." : "Save to TikTok Drafts"}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Data Notice */}
        {!loading && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex items-start gap-2">
            <svg className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <p className="text-xs text-amber-800 leading-relaxed">
              {t.dataNoticeShort}{" "}
              <a href={`/${locale}/terms`} className="text-amber-700 font-medium underline hover:text-amber-900">
                {t.viewTerms}
              </a>
            </p>
          </div>
        )}
      </div>
    </DashboardShell>
  );
}
