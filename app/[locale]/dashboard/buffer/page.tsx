"use client";

import { useUser } from "@auth0/nextjs-auth0/client";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { getDictionary, type Locale } from "@/lib/i18n";
import DashboardShell from "@/components/DashboardShell";
import { useOrg } from "@/components/OrgContext";

interface BufferProfile {
  id: string;
  service: string;
  formatted_service: string;
  avatar: string;
  service_username: string;
}

interface BufferPost {
  id: string;
  text: string;
  status: string;
  created_at: string;
  due_at?: string;
  sent_at?: string;
  external_link?: string;
  channel_name?: string;
  channel_service?: string;
}

interface GeneratedVideo {
  taskId: string;
  status: "processing" | "completed" | "failed";
  videoUrl?: string;
  prompt: string;
  model?: string;
  createdAt?: string;
}

interface MediaItem {
  id: number;
  url: string;
  type: "image" | "video";
  title?: string;
  prompt?: string;
  created_at?: string;
}

export default function BufferPage() {
  const { user } = useUser();
  const params = useParams();
  const locale = (params.locale as Locale) || "en";
  const dict = getDictionary(locale);
  const t = dict.bufferPage;
  const tt = dict.tiktokPage;
  const { activeOrg } = useOrg();

  const [hasKey, setHasKey] = useState<boolean | null>(null);
  const [keySource, setKeySource] = useState<"personal" | "org" | null>(null);
  const [activeOrgName, setActiveOrgName] = useState<string | null>(null);

  const [profiles, setProfiles] = useState<BufferProfile[]>([]);
  const [posts, setPosts] = useState<BufferPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [posting, setPosting] = useState(false);
  const [message, setMessage] = useState("");

  // Compose form
  const [text, setText] = useState("");
  const [mediaUrl, setMediaUrl] = useState("");
  const [mediaType, setMediaType] = useState<"video" | "image" | "">("");
  const [selectedProfiles, setSelectedProfiles] = useState<string[]>(() => {
    try { const saved = localStorage.getItem("buffer_selected_profiles"); return saved ? JSON.parse(saved) : []; } catch { return []; }
  });
  // Per-channel post type settings
  const [channelPostTypes, setChannelPostTypes] = useState<Record<string, string>>(() => {
    try { const saved = localStorage.getItem("buffer_channel_post_types"); return saved ? JSON.parse(saved) : {}; } catch { return {}; }
  });
  const [scheduleNow, setScheduleNow] = useState(true);
  const [scheduledAt, setScheduledAt] = useState("");

  // xPilot video generation
  const [xpilotKey, setXpilotKey] = useState<string | null>(null);
  const [genPrompt, setGenPrompt] = useState("");
  const [genDuration, setGenDuration] = useState("5");
  const [genModel, setGenModel] = useState("wavespeed-ai/wan-2.2/t2v-480p-ultra-fast");
  const [generating, setGenerating] = useState(false);
  const [genVideos, setGenVideos] = useState<GeneratedVideo[]>([]);
  const [genMessage, setGenMessage] = useState("");
  const [videoModels, setVideoModels] = useState<{ id: string; label: string; tier: string; durations?: number[]; costPer5s?: number }[]>([]);

  // Media library
  const [mediaItems, setMediaItems] = useState<MediaItem[]>([]);
  const [mediaLibOpen, setMediaLibOpen] = useState(false);

  // Image generation (free)
  const [imgPrompt, setImgPrompt] = useState("");
  const [imgModel, setImgModel] = useState("flux-schnell");
  const [imgAspect, setImgAspect] = useState("1:1");
  const [imgGenerating, setImgGenerating] = useState(false);
  const [imgMessage, setImgMessage] = useState("");

  // Tab for generation section
  const [genTab, setGenTab] = useState<"image" | "video">("image");

  const activeOrgId = activeOrg?.id;

  // Reload when activeOrg changes
  useEffect(() => {
    setLoading(true);
    setProfiles([]);
    setPosts([]);
    setSelectedProfiles([]);
    setHasKey(null);
    const qs = activeOrgId ? `&org_id=${activeOrgId}` : "";
    loadBuffer(qs);
    fetchXpilotKey();
    fetchModels();
    fetchVideoHistory();
    fetchMediaLibrary();
  }, [activeOrgId]);

  async function fetchXpilotKey() {
    try {
      const res = await fetch("/api/check-key?service=xpilot");
      const data = await res.json();
      setXpilotKey(data.available ? "configured" : null);
    } catch { setXpilotKey(null); }
  }

  async function fetchModels() {
    try {
      const res = await fetch("/api/tiktok/generate?listModels=true");
      const data = await res.json();
      if (data.models) setVideoModels(data.models);
    } catch { /* ignore */ }
  }

  async function fetchVideoHistory() {
    try {
      const res = await fetch("/api/tiktok/generate?listVideos=true");
      const data = await res.json();
      if (data.videos) {
        const history: GeneratedVideo[] = data.videos.map((v: { task_id: string; status: string; video_url?: string; blob_url?: string; proxy_url?: string; prompt: string; model?: string; created_at?: string }) => ({
          taskId: v.task_id,
          status: v.status as GeneratedVideo["status"],
          videoUrl: v.blob_url || v.proxy_url || v.video_url,
          prompt: v.prompt,
          model: v.model,
          createdAt: v.created_at,
        }));
        setGenVideos((prev) => {
          const currentTaskIds = new Set(prev.map((p) => p.taskId));
          const newHistory = history.filter((h: GeneratedVideo) => !currentTaskIds.has(h.taskId));
          return [...prev, ...newHistory];
        });
      }
    } catch { /* ignore */ }
  }

  async function fetchMediaLibrary() {
    try {
      // Fetch images from media library
      const imgRes = await fetch("/api/media-library");
      const imgData = await imgRes.json();
      const images: MediaItem[] = (imgData.items || []).map((i: { id: number; url: string; title?: string; prompt?: string; created_at?: string }) => ({
        id: i.id, url: i.url, type: "image" as const, title: i.title, prompt: i.prompt, created_at: i.created_at,
      }));

      // Fetch videos from generated_videos
      const vidRes = await fetch("/api/tiktok/generate?listVideos=true");
      const vidData = await vidRes.json();
      const videos: MediaItem[] = (vidData.videos || [])
        .filter((v: { status: string; blob_url?: string; video_url?: string }) => v.status === "completed" && (v.blob_url || v.video_url))
        .map((v: { task_id: string; blob_url?: string; video_url?: string; prompt: string; created_at?: string }, i: number) => ({
          id: -(i + 1), url: v.blob_url || v.video_url || "", type: "video" as const, title: undefined, prompt: v.prompt, created_at: v.created_at,
        }));

      setMediaItems([...videos, ...images]);
    } catch { /* ignore */ }
  }

  async function loadBuffer(qs: string) {
    try {
      const res = await fetch(`/api/buffer?action=profiles${qs}`);
      const data = await res.json();
      if (res.ok) {
        if (data.profiles) {
          setProfiles(data.profiles);
          setSelectedProfiles(data.profiles.map((p: BufferProfile) => p.id));
        }
        if (data.source) setKeySource(data.source);
        if (data.orgName) setActiveOrgName(data.orgName);
        else setActiveOrgName(null);
        setHasKey(true);
        fetchPosts(qs);
      } else {
        if (data.error) setMessage(data.error);
        setHasKey(false);
        setLoading(false);
      }
    } catch {
      setHasKey(false);
      setLoading(false);
    }
  }

  async function fetchPosts(qs?: string) {
    const q = qs ?? (activeOrgId ? `&org_id=${activeOrgId}` : "");
    try {
      const res = await fetch(`/api/buffer?action=posts${q}`);
      const data = await res.json();
      if (data.posts) setPosts(data.posts);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }

  async function handlePost() {
    if (!text.trim() || selectedProfiles.length === 0) return;
    setPosting(true);
    setMessage("");
    try {
      const res = await fetch("/api/buffer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: text.trim(),
          profile_ids: selectedProfiles,
          now: scheduleNow,
          scheduled_at: !scheduleNow && scheduledAt ? scheduledAt : undefined,
          org_id: activeOrgId,
          media_url: mediaUrl.trim() || undefined,
          media_type: mediaType || undefined,
          channel_services: Object.fromEntries(
            profiles.filter((p) => selectedProfiles.includes(p.id)).map((p) => [p.id, p.service])
          ),
          channel_post_types: channelPostTypes,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setMessage(t.postSuccess);
        setText("");
        setMediaUrl("");
        setMediaType("");
        fetchPosts();
      } else {
        setMessage(`${t.postFailed}: ${data.error || "Unknown error"}`);
      }
    } catch {
      setMessage(t.postFailed);
    } finally {
      setPosting(false);
    }
  }

  async function handleGenerate() {
    const prompt = genPrompt.trim();
    if (!prompt) return;
    setGenerating(true);
    setGenMessage("");
    try {
      const res = await fetch("/api/tiktok/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt,
          duration: parseInt(genDuration),
          model: genModel,
        }),
      });
      const data = await res.json();
      if (data.taskId) {
        const newVideo: GeneratedVideo = {
          taskId: data.taskId,
          status: "processing",
          prompt,
          model: genModel,
          createdAt: new Date().toISOString(),
        };
        setGenVideos((prev) => [newVideo, ...prev]);
        setGenMessage(tt.genSubmitted);
        setGenPrompt("");
        pollVideoStatus(data.taskId, data.provider, data.pollUrl);
      } else {
        const errStr = typeof data.error === "string" ? data.error : JSON.stringify(data.error);
        setGenMessage(`${tt.genFailed}: ${errStr}`);
      }
    } catch {
      setGenMessage(tt.genFailed);
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
            prev.map((v) => v.taskId === taskId ? { ...v, status: "completed", videoUrl: data.videoUrl } : v)
          );
          return;
        } else if (data.status === "failed") {
          setGenVideos((prev) =>
            prev.map((v) => v.taskId === taskId ? { ...v, status: "failed" } : v)
          );
          return;
        }
      } catch { /* continue */ }
    }
    setGenVideos((prev) =>
      prev.map((v) => v.taskId === taskId ? { ...v, status: "failed" } : v)
    );
  }

  async function handleImageGenerate() {
    const prompt = imgPrompt.trim();
    if (!prompt) return;
    setImgGenerating(true);
    setImgMessage("");
    try {
      const res = await fetch("/api/media-library", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "generate", prompt, model: imgModel, aspect_ratio: imgAspect }),
      });
      const data = await res.json();
      const imgUrl = data.url || data.image_url;
      if (imgUrl) {
        setMediaUrl(imgUrl);
        setMediaType("image");
        if (!text) setText(prompt.slice(0, 150));
        setImgMessage(locale === "zh" || locale === "zh-TW" ? "图片已生成并填入！" : "Image generated!");
        setImgPrompt("");
        fetchMediaLibrary();
      } else {
        setImgMessage(data.error || "Failed to generate image");
      }
    } catch {
      setImgMessage("Failed to generate image");
    } finally {
      setImgGenerating(false);
    }
  }

  function useGeneratedVideo(video: GeneratedVideo) {
    if (video.videoUrl) {
      setMediaUrl(video.videoUrl);
      setMediaType("video");
      if (!text) setText(video.prompt.slice(0, 150) + " #xPilot #AIMarketing");
    }
  }

  function toggleProfile(id: string) {
    setSelectedProfiles((prev) =>
      prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id]
    );
  }

  const [aiSuggesting, setAiSuggesting] = useState(false);

  if (!user) return null;

  async function aiSuggest(type: "post" | "image" | "video") {
    const selected = profiles.filter((p) => selectedProfiles.includes(p.id));
    if (selected.length === 0) return;
    setAiSuggesting(true);
    try {
      const res = await fetch("/api/buffer/suggest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          channels: selected.map((p) => ({ service: p.service, username: p.service_username })),
          type,
          locale,
          org_name: activeOrg?.name || activeOrgName,
          org_id: activeOrgId,
          media_type: mediaType || undefined,
        }),
      });
      const data = await res.json();
      if (data.suggestion) {
        if (type === "post") setText(data.suggestion);
        else if (type === "image") setImgPrompt(data.suggestion);
        else if (type === "video") setGenPrompt(data.suggestion);
      }
    } catch { /* ignore */ }
    finally { setAiSuggesting(false); }
  }

  const hasVideoChannel = profiles.some((p) => ["tiktok", "youtube"].includes(p.service));
  const hasImageChannel = profiles.some((p) => ["instagram", "facebook", "twitter", "linkedin", "pinterest", "threads", "bluesky"].includes(p.service));

  function estimateCost() {
    const model = videoModels.find((m) => m.id === genModel);
    if (!model?.costPer5s) return null;
    const dur = parseInt(genDuration);
    const cost = Math.ceil(dur / 5) * model.costPer5s;
    return cost;
  }

  return (
    <DashboardShell user={user}>
      <div className="p-4 sm:p-6 max-w-3xl mx-auto space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">{t.title}</h1>
            <p className="text-gray-500 mt-1">{t.subtitle}</p>
          </div>
          {hasKey && keySource && (
            <span className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium shrink-0 ${
              keySource === "org" ? "bg-blue-50 text-blue-700 border border-blue-200" : "bg-gray-50 text-gray-600 border border-gray-200"
            }`}>
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                {keySource === "org" ? (
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                ) : (
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                )}
              </svg>
              {keySource === "org" && activeOrgName ? activeOrgName : keySource === "org" ? "Org" : (locale === "zh" || locale === "zh-TW" ? "个人密钥" : "Personal Key")}
            </span>
          )}
        </div>

        {/* No API key */}
        {hasKey === false && (
          <div className="bg-white rounded-xl border border-gray-200 p-8 text-center">
            <div className="inline-flex items-center justify-center w-16 h-16 bg-blue-50 rounded-full mb-4">
              <svg className="w-8 h-8 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
            </div>
            <h2 className="text-lg font-semibold text-gray-900 mb-2">{t.setupTitle}</h2>
            <p className="text-gray-500 text-sm mb-4 max-w-md mx-auto">{t.setupDesc}</p>
            {message && <p className="text-xs text-red-500 mb-3">{message}</p>}
            <a href={`/${locale}/dashboard/settings`} className="inline-block px-5 py-2.5 bg-red-800 hover:bg-red-900 text-white rounded-lg text-sm font-medium transition-colors">
              {t.configureKey}
            </a>
          </div>
        )}

        {/* Loading */}
        {hasKey === null && loading && (
          <div className="bg-white rounded-xl border border-gray-200 p-8 text-center">
            <p className="text-gray-500">Loading...</p>
          </div>
        )}

        {/* Connected */}
        {hasKey && (
          <>
            {/* Channels */}
            {profiles.length > 0 && (
              <div className="bg-white rounded-xl border border-gray-200 p-6">
                <h2 className="text-lg font-semibold text-gray-900 mb-3">{t.channels}</h2>
                <div className="space-y-3">
                  {profiles.map((profile) => {
                    const isSelected = selectedProfiles.includes(profile.id);
                    const svc = profile.service;
                    const needsType = ["instagram", "facebook", "youtube"].includes(svc);
                    const typeOptions: { value: string; label: string }[] =
                      svc === "instagram" ? [{ value: "post", label: "Post" }, { value: "reel", label: "Reel" }, { value: "story", label: "Story" }]
                      : svc === "facebook" ? [{ value: "post", label: "Post" }, { value: "reel", label: "Reel" }]
                      : svc === "youtube" ? [{ value: "short", label: "Short" }]
                      : [];

                    return (
                      <div key={profile.id} className={`rounded-lg border transition-colors ${isSelected ? "border-red-300 bg-red-50/50" : "border-gray-200"}`}>
                        <button
                          onClick={() => toggleProfile(profile.id)}
                          className="w-full flex items-center gap-3 px-4 py-3 cursor-pointer"
                        >
                          {/* Checkbox */}
                          <span className={`w-5 h-5 rounded border-2 flex items-center justify-center shrink-0 ${isSelected ? "bg-red-600 border-red-600" : "border-gray-300"}`}>
                            {isSelected && (
                              <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                              </svg>
                            )}
                          </span>
                          {profile.avatar && <img src={profile.avatar} alt="" className="w-8 h-8 rounded-full" />}
                          <div className="text-left flex-1">
                            <span className="font-medium text-sm text-gray-900">{profile.service_username}</span>
                            <span className="text-xs text-gray-400 capitalize ml-2">{profile.formatted_service}</span>
                          </div>
                        </button>
                        {/* Channel-specific settings */}
                        {isSelected && needsType && (
                          <div className="px-4 pb-3 pt-0 flex items-center gap-2 ml-8">
                            <span className="text-xs text-gray-500">
                              {locale === "zh" || locale === "zh-TW" ? "发布类型：" : "Post type:"}
                            </span>
                            <div className="flex gap-1">
                              {typeOptions.map((opt) => (
                                <button
                                  key={opt.value}
                                  onClick={() => setChannelPostTypes((prev) => ({ ...prev, [profile.id]: opt.value }))}
                                  className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors cursor-pointer ${
                                    (channelPostTypes[profile.id] || typeOptions[0].value) === opt.value
                                      ? "bg-red-600 text-white"
                                      : "bg-white text-gray-600 border border-gray-200 hover:border-gray-300"
                                  }`}
                                >
                                  {opt.label}
                                </button>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* AI Content Generation */}
            {(hasVideoChannel || hasImageChannel) && (
              <div className="bg-white rounded-xl border border-gray-200 p-6">
                <h2 className="text-lg font-semibold text-gray-900 mb-4">
                  {locale === "zh" ? "AI 内容生成" : locale === "zh-TW" ? "AI 內容生成" : "AI Content Generation"}
                </h2>

                {/* Tabs */}
                <div className="flex gap-1 mb-4 bg-gray-100 rounded-lg p-1">
                  <button
                    onClick={() => setGenTab("image")}
                    className={`flex-1 px-3 py-1.5 rounded-md text-sm font-medium transition-colors cursor-pointer ${
                      genTab === "image" ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"
                    }`}
                  >
                    {locale === "zh" || locale === "zh-TW" ? "图片" : "Image"}
                    <span className="ml-1 text-xs text-green-600 font-normal">Free</span>
                  </button>
                  <button
                    onClick={() => setGenTab("video")}
                    className={`flex-1 px-3 py-1.5 rounded-md text-sm font-medium transition-colors cursor-pointer ${
                      genTab === "video" ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"
                    }`}
                  >
                    {locale === "zh" || locale === "zh-TW" ? "视频" : "Video"}
                    <span className="ml-1 text-xs text-purple-600 font-normal">xPilot</span>
                  </button>
                </div>

                {/* AI generate prompt for current tab */}
                {selectedProfiles.length > 0 && (
                  <button
                    onClick={() => aiSuggest(genTab === "image" ? "image" : "video")}
                    disabled={aiSuggesting}
                    className="mb-3 flex items-center gap-1.5 px-3 py-1.5 bg-purple-50 text-purple-700 border border-purple-200 rounded-lg text-xs font-medium hover:bg-purple-100 transition-colors cursor-pointer disabled:opacity-50"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
                    </svg>
                    {aiSuggesting ? "..." : (locale === "zh" || locale === "zh-TW"
                      ? `AI 生成${genTab === "image" ? "图片" : "视频"} Prompt`
                      : `AI Generate ${genTab === "image" ? "Image" : "Video"} Prompt`)}
                  </button>
                )}

                {/* Image Generation (Free) */}
                {genTab === "image" && (
                  <div className="space-y-4">
                    <div>
                      <label className="block text-sm text-gray-600 mb-1">
                        {locale === "zh" || locale === "zh-TW" ? "描述你想要的图片" : "Describe the image you want"}
                      </label>
                      <textarea
                        value={imgPrompt}
                        onChange={(e) => setImgPrompt(e.target.value)}
                        placeholder={locale === "zh" || locale === "zh-TW" ? "描述你想要的图片..." : "Describe the image you want..."}
                        rows={2}
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-green-500 resize-none"
                      />
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      <div>
                        <label className="block text-sm text-gray-600 mb-1">
                          {locale === "zh" || locale === "zh-TW" ? "模型" : "Model"}
                        </label>
                        <select
                          value={imgModel}
                          onChange={(e) => setImgModel(e.target.value)}
                          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-green-500"
                        >
                          <option value="flux-schnell">Flux Schnell (Fast)</option>
                          <option value="sdxl">SDXL (High Quality)</option>
                          <option value="gemini">Gemini (Google)</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-sm text-gray-600 mb-1">
                          {locale === "zh" || locale === "zh-TW" ? "比例" : "Aspect Ratio"}
                        </label>
                        <select
                          value={imgAspect}
                          onChange={(e) => setImgAspect(e.target.value)}
                          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-green-500"
                        >
                          <option value="1:1">1:1 (Instagram)</option>
                          <option value="4:3">4:3 (Landscape)</option>
                          <option value="3:4">3:4 (Portrait)</option>
                          <option value="16:9">16:9 (Wide)</option>
                          <option value="9:16">9:16 (Story/Reel)</option>
                        </select>
                      </div>
                      <div className="flex items-end">
                        <div className="w-full">
                          <button
                            onClick={handleImageGenerate}
                            disabled={imgGenerating}
                            className="w-full px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            {imgGenerating
                              ? (locale === "zh" || locale === "zh-TW" ? "生成中..." : "Generating...")
                              : (locale === "zh" || locale === "zh-TW" ? "生成图片" : "Generate Image")}
                          </button>
                          <p className="text-xs text-green-600 mt-1 text-center font-medium">
                            {locale === "zh" || locale === "zh-TW" ? "免费" : "Free"}
                          </p>
                        </div>
                      </div>
                    </div>
                    {imgMessage && (
                      <div className={`text-sm p-3 rounded-lg ${imgMessage.includes("Failed") ? "bg-red-50 text-red-600 border border-red-200" : "bg-green-50 text-green-700 border border-green-200"}`}>
                        {imgMessage}
                      </div>
                    )}
                    {/* Preview generated image */}
                    {mediaUrl && mediaType === "image" && (
                      <div className="border border-gray-200 rounded-lg p-2">
                        <img src={mediaUrl} alt="Generated" className="w-full max-h-60 object-contain rounded" />
                      </div>
                    )}
                  </div>
                )}

                {/* Video Generation (xPilot) */}
                {genTab === "video" && (
                  <>
                    {!xpilotKey ? (
                      <div className="text-center py-4">
                        <p className="text-gray-500 text-sm mb-3">{tt.genNeedKey}</p>
                        <a href={`/${locale}/dashboard/settings`} className="inline-block px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg text-sm font-medium transition-colors">
                          {tt.genConfigKey}
                        </a>
                      </div>
                    ) : (
                      <div className="space-y-4">
                        <div>
                          <label className="block text-sm text-gray-600 mb-1">{tt.genPromptLabel}</label>
                          <textarea
                            value={genPrompt}
                            onChange={(e) => setGenPrompt(e.target.value)}
                            placeholder={locale === "zh" || locale === "zh-TW" ? "描述你想要的视频..." : "Describe the video you want..."}
                            rows={2}
                            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-purple-500 resize-none"
                          />
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                          <div>
                            <label className="block text-sm text-gray-600 mb-1">{tt.genModel}</label>
                            <select
                              value={genModel}
                              onChange={(e) => {
                                const m = e.target.value;
                                setGenModel(m);
                                const durations = videoModels.find((v) => v.id === m)?.durations || [5, 8];
                                if (!durations.includes(parseInt(genDuration))) setGenDuration(String(durations[0]));
                              }}
                              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-gray-900 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-purple-500 text-sm"
                            >
                              {videoModels.map((m) => (
                                <option key={m.id} value={m.id}>{m.label} ({m.tier})</option>
                              ))}
                            </select>
                          </div>
                          <div>
                            <label className="block text-sm text-gray-600 mb-1">{tt.genDuration}</label>
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
                            <div className="w-full">
                              <button
                                onClick={handleGenerate}
                                disabled={generating}
                                className="w-full px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                              >
                                {generating ? tt.genGenerating : tt.genGenerate}
                              </button>
                              {estimateCost() !== null && (
                                <p className="text-xs text-gray-400 mt-1 text-center">
                                  ~${((estimateCost() as number) / 100).toFixed(2)} {locale === "zh" || locale === "zh-TW" ? "预估费用" : "est. cost"}
                                </p>
                              )}
                            </div>
                          </div>
                        </div>
                        {genMessage && (
                          <div className={`text-sm p-3 rounded-lg ${genMessage.includes(tt.genFailed) ? "bg-red-50 text-red-600 border border-red-200" : "bg-purple-50 text-purple-700 border border-purple-200"}`}>
                            {genMessage}
                          </div>
                        )}

                        {/* Generated Videos */}
                        {genVideos.length > 0 && (
                          <div className="space-y-3 mt-2">
                            <h3 className="text-sm font-medium text-gray-700">{tt.genResults}</h3>
                            {genVideos.map((video) => (
                              <div key={video.taskId} className="border border-gray-200 rounded-lg p-3 space-y-2">
                                <p className="text-sm text-gray-700 line-clamp-2">{video.prompt}</p>
                                <div className="flex items-center gap-2 text-xs text-gray-400">
                                  {video.model && <span>{video.model.split("/").pop()}</span>}
                                  {video.createdAt && <span>· {new Date(video.createdAt).toLocaleString()}</span>}
                                </div>
                                <div className="flex items-center gap-3">
                                  {video.status === "processing" && (
                                    <span className="flex items-center gap-2 text-xs text-amber-600">
                                      <span className="inline-block w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
                                      {tt.genProcessing}
                                    </span>
                                  )}
                                  {video.status === "completed" && (
                                    <>
                                      <span className="flex items-center gap-2 text-xs text-green-600">
                                        <span className="inline-block w-2 h-2 rounded-full bg-green-500" />
                                        {tt.genCompleted}
                                      </span>
                                      <a href={video.videoUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-purple-600 hover:text-purple-800 underline">
                                        {tt.genPreview}
                                      </a>
                                      <button
                                        onClick={() => useGeneratedVideo(video)}
                                        className="text-xs bg-red-800 hover:bg-red-900 text-white px-3 py-1 rounded-lg transition-colors"
                                      >
                                        {locale === "zh" || locale === "zh-TW" ? "用于发帖" : "Use for Post"}
                                      </button>
                                    </>
                                  )}
                                  {video.status === "failed" && (
                                    <span className="flex items-center gap-2 text-xs text-red-600">
                                      <span className="inline-block w-2 h-2 rounded-full bg-red-500" />
                                      {tt.genFailed}
                                    </span>
                                  )}
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </>
                )}
              </div>
            )}

            {/* Compose */}
            <div className="bg-white rounded-xl border border-gray-200 p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold text-gray-900">{t.compose}</h2>
                {selectedProfiles.length > 0 && (
                  <button
                    onClick={() => aiSuggest("post")}
                    disabled={aiSuggesting}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-purple-50 text-purple-700 border border-purple-200 rounded-lg text-xs font-medium hover:bg-purple-100 transition-colors cursor-pointer disabled:opacity-50"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
                    </svg>
                    {aiSuggesting ? "..." : (locale === "zh" || locale === "zh-TW" ? "AI 生成文案" : "AI Generate")}
                  </button>
                )}
              </div>
              <div className="space-y-4">
                <textarea
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  placeholder={t.composePlaceholder}
                  rows={4}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-red-500 resize-none"
                />
                {/* Media URL */}
                <div>
                  <label className="block text-sm text-gray-600 mb-1">
                    {locale === "zh" ? "媒体 URL（图片或视频）" : locale === "zh-TW" ? "媒體 URL（圖片或影片）" : "Media URL (image or video)"}
                  </label>
                  <div className="flex gap-2">
                    <input
                      type="url"
                      value={mediaUrl}
                      onChange={(e) => { setMediaUrl(e.target.value); if (!mediaType) setMediaType(""); }}
                      placeholder="https://example.com/video.mp4"
                      className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-red-500"
                    />
                    <select
                      value={mediaType}
                      onChange={(e) => setMediaType(e.target.value as "video" | "image" | "")}
                      className="border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-red-500"
                    >
                      <option value="">{locale === "zh" ? "自动检测" : locale === "zh-TW" ? "自動偵測" : "Auto"}</option>
                      <option value="video">{locale === "zh" || locale === "zh-TW" ? "视频" : "Video"}</option>
                      <option value="image">{locale === "zh" || locale === "zh-TW" ? "图片" : "Image"}</option>
                    </select>
                  </div>
                </div>
                {/* Media Library Picker */}
                {mediaItems.length > 0 && (
                  <div>
                    <button
                      onClick={() => setMediaLibOpen(!mediaLibOpen)}
                      className="text-sm text-purple-600 hover:text-purple-800 font-medium cursor-pointer flex items-center gap-1"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                      </svg>
                      {locale === "zh" ? "从媒体库选择" : locale === "zh-TW" ? "從媒體庫選擇" : "Choose from Media Library"}
                      <span className="text-xs text-gray-400">({mediaItems.length})</span>
                      <svg className={`w-3 h-3 transition-transform ${mediaLibOpen ? "rotate-180" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                      </svg>
                    </button>
                    {mediaLibOpen && (
                      <div className="mt-2 grid grid-cols-3 sm:grid-cols-4 gap-2 max-h-60 overflow-y-auto border border-gray-200 rounded-lg p-2">
                        {mediaItems.map((item) => (
                          <button
                            key={`${item.type}-${item.id}`}
                            onClick={() => {
                              setMediaUrl(item.url);
                              setMediaType(item.type);
                              setMediaLibOpen(false);
                              if (!text && item.prompt) setText(item.prompt.slice(0, 150));
                            }}
                            className={`relative group rounded-lg overflow-hidden border-2 transition-colors cursor-pointer aspect-square ${
                              mediaUrl === item.url ? "border-red-500" : "border-transparent hover:border-gray-300"
                            }`}
                          >
                            {item.type === "video" ? (
                              <div className="w-full h-full bg-gray-900 flex flex-col items-center justify-center">
                                <svg className="w-8 h-8 text-white/70" fill="currentColor" viewBox="0 0 24 24">
                                  <path d="M8 5v14l11-7z" />
                                </svg>
                                <span className="text-white/50 text-[10px] mt-1 px-1 text-center line-clamp-2">{item.prompt?.slice(0, 40)}</span>
                              </div>
                            ) : (
                              <img src={item.url} alt={item.title || ""} className="w-full h-full object-cover" />
                            )}
                            <span className={`absolute top-1 right-1 text-[10px] font-bold px-1 rounded ${
                              item.type === "video" ? "bg-purple-600 text-white" : "bg-blue-600 text-white"
                            }`}>
                              {item.type === "video" ? "VID" : "IMG"}
                            </span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                <div className="flex flex-col sm:flex-row gap-3">
                  <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
                    <input type="radio" checked={scheduleNow} onChange={() => setScheduleNow(true)} className="text-red-600 focus:ring-red-500" />
                    {t.publishNow}
                  </label>
                  <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
                    <input type="radio" checked={!scheduleNow} onChange={() => setScheduleNow(false)} className="text-red-600 focus:ring-red-500" />
                    {t.schedule}
                  </label>
                  {!scheduleNow && (
                    <input type="datetime-local" value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)} className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-red-500" />
                  )}
                </div>
                {message && (
                  <div className={`text-sm p-3 rounded-lg ${message.includes(t.postFailed) ? "bg-red-50 text-red-600 border border-red-200" : "bg-green-50 text-green-700 border border-green-200"}`}>
                    {message}
                  </div>
                )}
                <button
                  onClick={handlePost}
                  disabled={posting || !text.trim() || selectedProfiles.length === 0}
                  className="px-5 py-2.5 bg-red-800 hover:bg-red-900 text-white rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {posting ? t.publishing : scheduleNow ? t.publishNow : t.schedulePost}
                </button>
              </div>
            </div>

            {/* Posts */}
            <div className="bg-white rounded-xl border border-gray-200 p-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-4">{t.scheduledPosts}</h2>
              {loading ? (
                <p className="text-gray-500 text-sm">Loading...</p>
              ) : posts.length === 0 ? (
                <p className="text-gray-400 text-sm">{t.noPosts}</p>
              ) : (
                <div className="space-y-3">
                  {posts.map((post) => (
                    <div key={post.id} className="border border-gray-200 rounded-lg p-4">
                      <p className="text-sm text-gray-700 line-clamp-3">{post.text}</p>
                      <div className="flex flex-wrap items-center gap-2 mt-2 text-xs text-gray-400">
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full font-medium ${
                          post.status === "sent" ? "bg-green-100 text-green-700" : post.status === "buffer" ? "bg-blue-100 text-blue-700" : post.status === "error" ? "bg-red-100 text-red-700" : "bg-gray-100 text-gray-600"
                        }`}>
                          {post.status === "sent" ? t.statusSent : post.status === "buffer" ? t.statusQueued : post.status}
                        </span>
                        {post.channel_service && (
                          <span className="px-2 py-0.5 rounded-full bg-gray-100 text-gray-500 capitalize">{post.channel_service}</span>
                        )}
                        {post.sent_at && <span>{new Date(post.sent_at).toLocaleString()}</span>}
                        {!post.sent_at && post.due_at && <span>{new Date(post.due_at).toLocaleString()}</span>}
                        {!post.sent_at && !post.due_at && post.created_at && <span>{new Date(post.created_at).toLocaleString()}</span>}
                        {post.external_link && (
                          <a
                            href={post.external_link}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-blue-600 hover:text-blue-800 underline font-medium"
                          >
                            {locale === "zh" || locale === "zh-TW" ? "查看帖子" : "View Post"} →
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

        {/* Features when no key */}
        {hasKey === false && (
          <div className="bg-white rounded-xl border border-gray-200 p-6">
            <h2 className="text-lg font-semibold text-gray-800 mb-4">{t.features}</h2>
            <ul className="space-y-3">
              {[t.featMultiChannel, t.featScheduling, t.featAnalytics, t.featAiContent, t.featTeam].map((feat, i) => (
                <li key={i} className="flex items-center gap-3 text-sm text-gray-600">
                  <span className="w-5 h-5 rounded-full bg-gray-100 flex items-center justify-center text-gray-400 text-xs">{i + 1}</span>
                  {feat}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </DashboardShell>
  );
}
