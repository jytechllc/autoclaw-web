"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { useUser } from "@auth0/nextjs-auth0/client";
import DashboardShell from "@/components/DashboardShell";
import type { Locale } from "@/lib/i18n";

interface MediaItem {
  id: number;
  title: string;
  description: string;
  image_url: string;
  model: string;
  provider: string;
  prompt: string;
  tags: string[];
  created_at: string;
}

const MODELS = [
  { id: "flux-schnell", label: "Flux Schnell (Free, ~3s)", provider: "Black Forest Labs" },
  { id: "sdxl", label: "SDXL (Free, HD 1024px)", provider: "Stability AI" },
  { id: "seedream", label: "Seedream v4.5", provider: "ByteDance" },
  { id: "nano-banana-2", label: "Nano Banana 2", provider: "Google" },
];

const ASPECT_RATIOS = [
  { id: "1:1", label: "1:1" },
  { id: "16:9", label: "16:9" },
  { id: "9:16", label: "9:16" },
  { id: "4:3", label: "4:3" },
  { id: "3:4", label: "3:4" },
];

export default function MediaLibraryPage() {
  const { user } = useUser();
  const params = useParams();
  const locale = (params.locale as Locale) || "en";
  const isZh = locale === "zh" || locale === "zh-TW";

  const [items, setItems] = useState<MediaItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [describing, setDescribing] = useState<number | null>(null);

  // Generate form
  const [prompt, setPrompt] = useState("");
  const [model, setModel] = useState("flux-schnell");
  const [aspectRatio, setAspectRatio] = useState("1:1");
  const [message, setMessage] = useState("");
  const [previewItem, setPreviewItem] = useState<MediaItem | null>(null);
  const [search, setSearch] = useState("");

  const t = {
    title: isZh ? "素材库" : "Media Library",
    subtitle: isZh ? "AI 图片生成 & 素材管理" : "AI image generation & media management",
    generate: isZh ? "生成图片" : "Generate Image",
    generating: isZh ? "生成中..." : "Generating...",
    prompt: isZh ? "描述你想要的图片" : "Describe the image you want",
    model: isZh ? "模型" : "Model",
    ratio: isZh ? "比例" : "Aspect Ratio",
    noItems: isZh ? "素材库为空。生成你的第一张图片！" : "No media yet. Generate your first image!",
    describe: isZh ? "AI 描述" : "AI Describe",
    describing: isZh ? "分析中..." : "Analyzing...",
    delete: isZh ? "删除" : "Delete",
    deleteConfirm: isZh ? "确定删除这张图片？" : "Delete this image?",
    search: isZh ? "搜索素材..." : "Search media...",
    close: isZh ? "关闭" : "Close",
    tags: isZh ? "标签" : "Tags",
    generatedWith: isZh ? "生成模型" : "Generated with",
    promptLabel: isZh ? "生成提示词" : "Prompt",
  };

  async function fetchItems() {
    setLoading(true);
    try {
      const q = search ? `&q=${encodeURIComponent(search)}` : "";
      const res = await fetch(`/api/media-library?${q}`);
      const data = await res.json();
      setItems(data.items || []);
    } catch { /* ignore */ }
    setLoading(false);
  }

  useEffect(() => {
    if (user) fetchItems();
  }, [user]);

  async function handleGenerate() {
    if (!prompt.trim() || generating) return;
    setGenerating(true);
    setMessage("");
    try {
      const res = await fetch("/api/media-library", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "generate", prompt: prompt.trim(), model, aspect_ratio: aspectRatio }),
      });
      const data = await res.json();
      if (data.error) {
        setMessage(data.error);
      } else {
        setPrompt("");
        setMessage("");
        // Auto-describe with GLM-4.6V
        fetchItems();
        if (data.id) {
          setDescribing(data.id);
          try {
            await fetch("/api/media-library", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ action: "describe", id: data.id, image_url: data.image_url }),
            });
          } catch { /* non-critical */ }
          setDescribing(null);
          fetchItems();
        }
      }
    } catch {
      setMessage("Generation failed");
    }
    setGenerating(false);
  }

  async function handleDescribe(item: MediaItem) {
    setDescribing(item.id);
    try {
      await fetch("/api/media-library", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "describe", id: item.id, image_url: item.image_url }),
      });
      fetchItems();
    } catch { /* ignore */ }
    setDescribing(null);
  }

  async function handleDelete(id: number) {
    if (!confirm(t.deleteConfirm)) return;
    await fetch("/api/media-library", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "delete", id }),
    });
    fetchItems();
  }

  function handleSearch() {
    fetchItems();
  }

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <a href={`/auth/login?returnTo=/${locale}/dashboard/media-library`} className="bg-red-800 hover:bg-red-900 text-white px-6 py-3 rounded-lg font-medium transition-colors">
          {isZh ? "登录" : "Log In"}
        </a>
      </div>
    );
  }

  return (
    <DashboardShell user={user} plan={undefined}>
      <div className="p-4 sm:p-6 max-w-6xl mx-auto space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{t.title}</h1>
          <p className="text-gray-500 mt-1">{t.subtitle}</p>
        </div>

        {/* Generate form */}
        <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-3">
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder={t.prompt}
            rows={2}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm resize-none focus:ring-2 focus:ring-red-500 focus:border-transparent"
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleGenerate(); } }}
          />
          <div className="flex flex-wrap items-center gap-3">
            <select value={model} onChange={(e) => setModel(e.target.value)} className="border border-gray-300 rounded-md px-3 py-1.5 text-xs">
              {MODELS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
            </select>
            <select value={aspectRatio} onChange={(e) => setAspectRatio(e.target.value)} className="border border-gray-300 rounded-md px-3 py-1.5 text-xs">
              {ASPECT_RATIOS.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
            </select>
            <button
              onClick={handleGenerate}
              disabled={!prompt.trim() || generating}
              className="px-4 py-1.5 bg-red-800 text-white rounded-md text-xs font-medium hover:bg-red-900 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {generating ? t.generating : t.generate}
            </button>
          </div>
          {message && <p className="text-xs text-red-600">{message}</p>}
        </div>

        {/* Search */}
        <div className="flex gap-2">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") handleSearch(); }}
            placeholder={t.search}
            className="flex-1 border border-gray-300 rounded-md px-3 py-1.5 text-sm"
          />
          <button onClick={handleSearch} className="px-4 py-1.5 bg-gray-100 rounded-md text-xs hover:bg-gray-200">
            {isZh ? "搜索" : "Search"}
          </button>
        </div>

        {/* Gallery */}
        {loading ? (
          <p className="text-center py-12 text-gray-400">{isZh ? "加载中..." : "Loading..."}</p>
        ) : items.length === 0 ? (
          <p className="text-center py-12 text-gray-400">{t.noItems}</p>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
            {items.map((item) => (
              <div key={item.id} className="group relative bg-white border border-gray-200 rounded-lg overflow-hidden hover:shadow-md transition-shadow">
                <div className="aspect-square relative cursor-pointer" onClick={() => setPreviewItem(item)}>
                  <img src={item.image_url} alt={item.title || item.prompt} className="w-full h-full object-cover" loading="lazy" />
                  {describing === item.id && (
                    <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
                      <span className="text-white text-xs">{t.describing}</span>
                    </div>
                  )}
                </div>
                <div className="p-2 space-y-1">
                  <p className="text-xs font-medium text-gray-800 truncate">{item.title || item.prompt?.slice(0, 50)}</p>
                  {item.description && <p className="text-[10px] text-gray-500 line-clamp-2">{item.description}</p>}
                  <div className="flex items-center gap-1 flex-wrap">
                    {item.tags?.map((tag, i) => (
                      <span key={i} className="text-[9px] bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded-full">{tag}</span>
                    ))}
                  </div>
                  <div className="flex gap-1 pt-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button onClick={() => handleDescribe(item)} className="text-[10px] text-blue-600 hover:underline">{t.describe}</button>
                    <button onClick={() => handleDelete(item.id)} className="text-[10px] text-red-500 hover:underline">{t.delete}</button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Preview modal */}
        {previewItem && (
          <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setPreviewItem(null)}>
            <div className="bg-white rounded-xl shadow-xl max-w-3xl w-full max-h-[90vh] overflow-hidden" onClick={(e) => e.stopPropagation()}>
              <div className="flex flex-col md:flex-row">
                <div className="md:w-2/3 bg-gray-100">
                  <img src={previewItem.image_url} alt={previewItem.title} className="w-full h-full object-contain max-h-[60vh]" />
                </div>
                <div className="md:w-1/3 p-4 space-y-3 overflow-y-auto max-h-[60vh]">
                  <h3 className="font-medium text-gray-900">{previewItem.title || "Untitled"}</h3>
                  {previewItem.description && <p className="text-sm text-gray-600">{previewItem.description}</p>}
                  <div>
                    <p className="text-[10px] text-gray-400 font-medium uppercase">{t.promptLabel}</p>
                    <p className="text-xs text-gray-700 mt-0.5">{previewItem.prompt}</p>
                  </div>
                  <div>
                    <p className="text-[10px] text-gray-400 font-medium uppercase">{t.generatedWith}</p>
                    <p className="text-xs text-gray-700 mt-0.5">{previewItem.model}</p>
                  </div>
                  {previewItem.tags?.length > 0 && (
                    <div>
                      <p className="text-[10px] text-gray-400 font-medium uppercase">{t.tags}</p>
                      <div className="flex flex-wrap gap-1 mt-0.5">
                        {previewItem.tags.map((tag, i) => (
                          <span key={i} className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">{tag}</span>
                        ))}
                      </div>
                    </div>
                  )}
                  <div className="flex gap-2 pt-2">
                    <a href={previewItem.image_url} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-600 hover:underline">
                      {isZh ? "打开原图" : "Open original"}
                    </a>
                    <button onClick={() => handleDescribe(previewItem)} className="text-xs text-blue-600 hover:underline">
                      {describing === previewItem.id ? t.describing : t.describe}
                    </button>
                  </div>
                  <button onClick={() => setPreviewItem(null)} className="w-full mt-2 px-4 py-1.5 border border-gray-300 rounded-md text-xs hover:bg-gray-50">{t.close}</button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </DashboardShell>
  );
}
