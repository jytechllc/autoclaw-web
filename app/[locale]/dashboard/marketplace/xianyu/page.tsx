"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import { useUser } from "@auth0/nextjs-auth0/client";
import DashboardShell from "@/components/DashboardShell";
import type { Locale } from "@/lib/i18n";

const XIANYU_STYLES = [
  { id: "product_white", en: "White Background", zh: "白底商品图", prompt: "Professional product photo on pure white background, centered, high resolution, clean, Chinese e-commerce style, well-lit" },
  { id: "lifestyle_cn", en: "Chinese Lifestyle", zh: "中式生活场景", prompt: "Chinese lifestyle product photo, warm home setting, natural light, cozy, modern Chinese apartment aesthetic" },
  { id: "flat_lay", en: "Flat Lay Display", zh: "平铺展示", prompt: "Flat lay product display, top-down view, clean arrangement, soft background, e-commerce ready" },
  { id: "detail", en: "Detail Close-up", zh: "细节特写", prompt: "Extreme close-up product detail shot, showing texture and quality, macro photography, high resolution" },
  { id: "comparison", en: "Size Comparison", zh: "尺寸对比", prompt: "Product size comparison photo with common objects (hand, pen, phone), realistic scale reference, clean background" },
  { id: "unboxing", en: "Unboxing / Package", zh: "开箱包装", prompt: "Product unboxing presentation, neat packaging, showing all included items, clean layout, appealing" },
  { id: "secondhand", en: "Secondhand Item", zh: "二手闲置", prompt: "Honest secondhand item photo, natural lighting, showing actual condition, real home setting, no filters, authentic" },
  { id: "custom", en: "Custom Prompt", zh: "自定义", prompt: "" },
];

const MODELS = [
  { id: "flux-schnell", label: "Flux Schnell (免费, ~3s)" },
  { id: "sdxl", label: "SDXL (免费, HD 1024px)" },
  { id: "seedream", label: "Seedream v4.5" },
];

interface GeneratedImage {
  url: string;
  prompt: string;
  style: string;
  model: string;
  timestamp: number;
}

export default function XianyuPage() {
  const params = useParams();
  const locale = (params.locale as Locale) || "en";
  const isZh = locale === "zh" || locale === "zh-TW";
  const { user } = useUser();

  const [activeTab, setActiveTab] = useState<"generator" | "analyzer" | "tips">("generator");

  // Generator state
  const [productName, setProductName] = useState("");
  const [productDesc, setProductDesc] = useState("");
  const [selectedStyle, setSelectedStyle] = useState("product_white");
  const [customPrompt, setCustomPrompt] = useState("");
  const [selectedModel, setSelectedModel] = useState("sdxl");
  const [generating, setGenerating] = useState(false);
  const [generatedImages, setGeneratedImages] = useState<GeneratedImage[]>([]);
  const [error, setError] = useState("");

  // Analyzer state
  const [analyzeUrl, setAnalyzeUrl] = useState("");
  const [analyzeFile, setAnalyzeFile] = useState<File | null>(null);
  const [analyzePreview, setAnalyzePreview] = useState("");
  const [analyzing, setAnalyzing] = useState(false);
  const [analysisResult, setAnalysisResult] = useState("");

  // Describe state
  const [describingIdx, setDescribingIdx] = useState<number | null>(null);
  const [descriptions, setDescriptions] = useState<Record<number, string>>({});

  const t = {
    title: isZh ? "闲鱼" : "Xianyu",
    subtitle: isZh ? "闲鱼商品图片生成 & 优化工具" : "Xianyu product image generator & optimizer",
    generator: isZh ? "图片生成" : "Image Generator",
    analyzer: isZh ? "图片分析" : "Image Analyzer",
    tips: isZh ? "卖货技巧" : "Selling Tips",
    productName: isZh ? "商品名称" : "Product Name",
    productDesc: isZh ? "商品描述（可选）" : "Description (optional)",
    style: isZh ? "图片风格" : "Image Style",
    model: isZh ? "生成模型" : "Model",
    generate: isZh ? "生成商品图" : "Generate Image",
    generating: isZh ? "生成中..." : "Generating...",
    noImages: isZh ? "点击上方按钮生成商品图片" : "Click generate to create product images",
    analyzeTitle: isZh ? "分析现有图片" : "Analyze Existing Image",
    analyzeHint: isZh ? "上传或粘贴图片 URL，AI 将分析图片质量并给出优化建议" : "Upload or paste image URL for AI analysis",
    analyze: isZh ? "开始分析" : "Analyze",
    analyzing: isZh ? "分析中..." : "Analyzing...",
    describe: isZh ? "生成文案" : "Generate Copy",
    describing: isZh ? "生成中..." : "Generating...",
    saveToLibrary: isZh ? "存入素材库" : "Save to Library",
    saved: isZh ? "已保存" : "Saved",
  };

  async function handleGenerate() {
    if (!productName.trim() || generating) return;
    setGenerating(true);
    setError("");
    const style = XIANYU_STYLES.find((s) => s.id === selectedStyle);
    const stylePrompt = selectedStyle === "custom" ? customPrompt : (style?.prompt || "");

    try {
      const res = await fetch("/api/media-library", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "generate",
          prompt: `${stylePrompt}. Product: ${productName}${productDesc ? `. ${productDesc}` : ""}. For Xianyu (闲鱼) marketplace listing, Chinese e-commerce style.`,
          model: selectedModel,
          aspect_ratio: "1:1",
          tags: ["xianyu", selectedStyle],
        }),
      });
      const data = await res.json();
      if (data.error) {
        setError(data.error);
      } else if (data.image_url) {
        setGeneratedImages((prev) => [{
          url: data.image_url,
          prompt: stylePrompt,
          style: selectedStyle,
          model: data.model || selectedModel,
          timestamp: Date.now(),
        }, ...prev]);
      }
    } catch {
      setError("Generation failed");
    }
    setGenerating(false);
  }

  async function handleAnalyze() {
    if (!analyzeUrl && !analyzeFile) return;
    setAnalyzing(true);
    setAnalysisResult("");
    try {
      let imageData = analyzeUrl;
      if (analyzeFile) {
        const reader = new FileReader();
        imageData = await new Promise((resolve) => {
          reader.onload = () => resolve(reader.result as string);
          reader.readAsDataURL(analyzeFile);
        });
      }
      const res = await fetch("/api/media-library", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "describe", image_url: imageData }),
      });
      const data = await res.json();
      setAnalysisResult(data.description || data.error || "No result");
    } catch {
      setAnalysisResult("Analysis failed");
    }
    setAnalyzing(false);
  }

  async function handleDescribe(idx: number, imageUrl: string) {
    setDescribingIdx(idx);
    try {
      const res = await fetch("/api/media-library", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "describe", image_url: imageUrl }),
      });
      const data = await res.json();
      if (data.description) {
        const copy = isZh
          ? `【${productName}】${data.description}\n\n${data.tags?.map((t: string) => `#${t}`).join(" ") || ""}`
          : `${data.description}\n\n${data.tags?.map((t: string) => `#${t}`).join(" ") || ""}`;
        setDescriptions((prev) => ({ ...prev, [idx]: copy }));
      }
    } catch { /* ignore */ }
    setDescribingIdx(null);
  }

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <a href={`/auth/login?returnTo=/${locale}/dashboard/marketplace/xianyu`} className="bg-red-800 hover:bg-red-900 text-white px-6 py-3 rounded-lg font-medium transition-colors">
          {isZh ? "登录" : "Log In"}
        </a>
      </div>
    );
  }

  return (
    <DashboardShell user={user} plan={undefined}>
      <div className="p-4 sm:p-6 max-w-5xl mx-auto space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{t.title}</h1>
          <p className="text-gray-500 mt-1">{t.subtitle}</p>
        </div>

        {/* Tabs */}
        <div className="flex gap-2 border-b border-gray-200 pb-2">
          {(["generator", "analyzer", "tips"] as const).map((tab) => (
            <button key={tab} onClick={() => setActiveTab(tab)}
              className={`px-4 py-1.5 rounded-t-lg text-sm font-medium cursor-pointer ${activeTab === tab ? "bg-red-800 text-white" : "text-gray-500 hover:text-gray-700"}`}>
              {t[tab]}
            </button>
          ))}
        </div>

        {/* Generator Tab */}
        {activeTab === "generator" && (
          <div className="space-y-4">
            <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-3">
              <input
                value={productName}
                onChange={(e) => setProductName(e.target.value)}
                placeholder={t.productName}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
              />
              <input
                value={productDesc}
                onChange={(e) => setProductDesc(e.target.value)}
                placeholder={t.productDesc}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
              />
              <div className="flex flex-wrap gap-2">
                <div>
                  <label className="text-xs text-gray-500 font-medium">{t.style}</label>
                  <select value={selectedStyle} onChange={(e) => setSelectedStyle(e.target.value)} className="mt-1 block border border-gray-300 rounded-md px-3 py-1.5 text-xs">
                    {XIANYU_STYLES.map((s) => <option key={s.id} value={s.id}>{isZh ? s.zh : s.en}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs text-gray-500 font-medium">{t.model}</label>
                  <select value={selectedModel} onChange={(e) => setSelectedModel(e.target.value)} className="mt-1 block border border-gray-300 rounded-md px-3 py-1.5 text-xs">
                    {MODELS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
                  </select>
                </div>
              </div>
              {selectedStyle === "custom" && (
                <textarea value={customPrompt} onChange={(e) => setCustomPrompt(e.target.value)} placeholder={isZh ? "输入自定义提示词..." : "Enter custom prompt..."} rows={2} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm resize-none" />
              )}
              <button onClick={handleGenerate} disabled={!productName.trim() || generating}
                className="px-5 py-2 bg-red-800 text-white rounded-lg text-sm font-medium hover:bg-red-900 disabled:opacity-40 disabled:cursor-not-allowed">
                {generating ? t.generating : t.generate}
              </button>
              {error && <p className="text-xs text-red-600">{error}</p>}
            </div>

            {/* Generated images */}
            {generatedImages.length === 0 ? (
              <p className="text-center py-8 text-gray-400 text-sm">{t.noImages}</p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {generatedImages.map((img, idx) => (
                  <div key={idx} className="bg-white border border-gray-200 rounded-xl overflow-hidden">
                    <img src={img.url} alt={productName} className="w-full aspect-square object-cover" loading="lazy" />
                    <div className="p-3 space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] text-gray-400">{img.model} · {XIANYU_STYLES.find((s) => s.id === img.style)?.[isZh ? "zh" : "en"]}</span>
                        <div className="flex gap-2">
                          <button onClick={() => handleDescribe(idx, img.url)} disabled={describingIdx === idx}
                            className="text-xs text-blue-600 hover:underline disabled:opacity-40">
                            {describingIdx === idx ? t.describing : t.describe}
                          </button>
                          <a href={img.url} target="_blank" rel="noopener noreferrer" className="text-xs text-gray-500 hover:underline">
                            {isZh ? "打开原图" : "Open"}
                          </a>
                        </div>
                      </div>
                      {descriptions[idx] && (
                        <div className="bg-gray-50 rounded-lg p-2">
                          <p className="text-xs text-gray-700 whitespace-pre-wrap">{descriptions[idx]}</p>
                          <button onClick={() => navigator.clipboard.writeText(descriptions[idx])} className="text-[10px] text-blue-600 hover:underline mt-1">
                            {isZh ? "复制文案" : "Copy"}
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Analyzer Tab */}
        {activeTab === "analyzer" && (
          <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-3">
            <h3 className="font-medium text-gray-900">{t.analyzeTitle}</h3>
            <p className="text-xs text-gray-500">{t.analyzeHint}</p>
            <input value={analyzeUrl} onChange={(e) => setAnalyzeUrl(e.target.value)} placeholder={isZh ? "粘贴图片 URL..." : "Paste image URL..."} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
            <div className="text-xs text-gray-400">{isZh ? "或上传图片" : "Or upload"}</div>
            <input type="file" accept="image/*" onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) {
                setAnalyzeFile(file);
                setAnalyzePreview(URL.createObjectURL(file));
              }
            }} className="text-xs" />
            {analyzePreview && <img src={analyzePreview} alt="preview" className="w-32 h-32 object-cover rounded-lg" />}
            <button onClick={handleAnalyze} disabled={(!analyzeUrl && !analyzeFile) || analyzing}
              className="px-4 py-1.5 bg-red-800 text-white rounded-md text-sm hover:bg-red-900 disabled:opacity-40">
              {analyzing ? t.analyzing : t.analyze}
            </button>
            {analysisResult && (
              <div className="bg-gray-50 rounded-lg p-3 text-sm text-gray-700 whitespace-pre-wrap">{analysisResult}</div>
            )}
          </div>
        )}

        {/* Tips Tab */}
        {activeTab === "tips" && (
          <div className="bg-white border border-gray-200 rounded-xl p-5 prose prose-sm max-w-none">
            <h3>{isZh ? "闲鱼卖货技巧" : "Xianyu Selling Tips"}</h3>
            <h4>{isZh ? "📸 图片拍摄" : "📸 Photography"}</h4>
            <ul>
              <li>{isZh ? "首图最重要 — 白底或简洁背景，突出商品" : "First image matters most — white/clean background, highlight product"}</li>
              <li>{isZh ? "多角度拍摄 — 正面、侧面、细节、瑕疵（如有）" : "Multiple angles — front, side, details, flaws (if any)"}</li>
              <li>{isZh ? "自然光最佳 — 避免闪光灯造成的反光" : "Natural light is best — avoid flash glare"}</li>
              <li>{isZh ? "展示尺寸 — 用常见物品做参照" : "Show scale — use common objects for reference"}</li>
              <li>{isZh ? "最多 9 张图 — 充分利用每一张" : "Max 9 images — use every slot"}</li>
            </ul>
            <h4>{isZh ? "✍️ 文案撰写" : "✍️ Copywriting"}</h4>
            <ul>
              <li>{isZh ? "标题包含关键词 — 品牌+型号+核心卖点" : "Keywords in title — brand + model + key selling point"}</li>
              <li>{isZh ? "价格策略 — 定价略低于同类，或标注「可小刀」" : "Pricing — slightly below competitors, or note 'negotiable'"}</li>
              <li>{isZh ? "说明购买渠道和使用时长" : "State purchase source and usage duration"}</li>
              <li>{isZh ? "诚实描述瑕疵 — 增加买家信任" : "Honestly describe flaws — builds trust"}</li>
            </ul>
            <h4>{isZh ? "🚀 提升曝光" : "🚀 Boost Exposure"}</h4>
            <ul>
              <li>{isZh ? "每天「擦亮」宝贝 — 提升搜索排名" : "Daily 'polish' listing — boosts search ranking"}</li>
              <li>{isZh ? "设置合理分类和标签" : "Set proper categories and tags"}</li>
              <li>{isZh ? "及时回复买家消息 — 提高响应率" : "Reply quickly to messages — improves response rate"}</li>
              <li>{isZh ? "加入鱼塘（社区）— 获得更多流量" : "Join fish ponds (communities) — more traffic"}</li>
            </ul>
          </div>
        )}
      </div>
    </DashboardShell>
  );
}
