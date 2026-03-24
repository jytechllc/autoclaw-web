"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import { useUser } from "@auth0/nextjs-auth0/client";
import DashboardShell from "@/components/DashboardShell";
import type { Locale } from "@/lib/i18n";

const ETSY_STYLES = [
  { id: "product_white", en: "White Background Product", zh: "白底产品图", prompt: "Professional product photography on pure white background, centered, high-resolution, clean, e-commerce ready" },
  { id: "lifestyle", en: "Lifestyle Scene", zh: "场景图", prompt: "Beautiful lifestyle product photography, natural lighting, cozy aesthetic, styled setting, Instagram-worthy" },
  { id: "flat_lay", en: "Flat Lay", zh: "平铺展示", prompt: "Aesthetic flat lay product photography, top-down view, styled with props, soft neutral tones, Pinterest style" },
  { id: "mockup", en: "Mockup / In-Use", zh: "使用场景", prompt: "Product mockup showing item in use, realistic, professional, natural environment" },
  { id: "gift", en: "Gift Packaging", zh: "礼品包装", prompt: "Beautiful gift packaging presentation, wrapped with ribbon, elegant, festive, ready to gift" },
  { id: "handmade", en: "Handmade / Craft", zh: "手工制作", prompt: "Artisan handmade product, craft workshop setting, warm tones, showing texture and detail, authentic" },
  { id: "seasonal", en: "Seasonal / Holiday", zh: "节日主题", prompt: "Seasonal holiday themed product photography, festive decorations, warm and inviting" },
  { id: "custom", en: "Custom Prompt", zh: "自定义", prompt: "" },
];

interface GeneratedImage {
  url: string;
  prompt: string;
  style: string;
  timestamp: number;
}

export default function EtsyPage() {
  const params = useParams();
  const locale = (params.locale as Locale) || "en";
  const isZh = locale === "zh" || locale === "zh-TW";
  const { user } = useUser();

  const [activeTab, setActiveTab] = useState<"generator" | "about">("generator");
  const [productName, setProductName] = useState("");
  const [productDesc, setProductDesc] = useState("");
  const [selectedStyle, setSelectedStyle] = useState("product_white");
  const [customPrompt, setCustomPrompt] = useState("");
  const [generating, setGenerating] = useState(false);
  const [images, setImages] = useState<GeneratedImage[]>([]);
  const [error, setError] = useState("");

  async function generateImage() {
    if (!productName.trim()) return;
    setGenerating(true);
    setError("");
    try {
      const style = ETSY_STYLES.find((s) => s.id === selectedStyle);
      const stylePrompt = selectedStyle === "custom" ? customPrompt : (style?.prompt || "");
      const res = await fetch("/api/etsy-image", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          product_name: productName,
          product_description: productDesc,
          style_prompt: stylePrompt,
          style_id: selectedStyle,
        }),
      });
      const data = await res.json();
      if (data.url) {
        setImages((prev) => [{ url: data.url, prompt: data.prompt, style: style?.en || selectedStyle, timestamp: Date.now() }, ...prev]);
      } else {
        setError(data.error || "Generation failed");
      }
    } catch {
      setError(isZh ? "生成失败，请重试" : "Generation failed, please retry");
    }
    setGenerating(false);
  }

  return (
    <DashboardShell user={user || {}}>
      <div className="max-w-[1200px] mx-auto p-4 sm:p-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
          <div>
            <h1 className="text-2xl font-bold">Etsy</h1>
            <p className="text-sm text-gray-500">{isZh ? "AI 生成 Etsy 产品图片 & 平台指南" : "AI Etsy Product Image Generator & Platform Guide"}</p>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 mb-6 border-b border-gray-200">
          <button onClick={() => setActiveTab("generator")} className={`px-4 py-2 text-sm font-medium border-b-2 cursor-pointer ${activeTab === "generator" ? "border-red-700 text-red-700" : "border-transparent text-gray-500 hover:text-gray-700"}`}>
            {isZh ? "图片生成器" : "Image Generator"}
          </button>
          <button onClick={() => setActiveTab("about")} className={`px-4 py-2 text-sm font-medium border-b-2 cursor-pointer ${activeTab === "about" ? "border-red-700 text-red-700" : "border-transparent text-gray-500 hover:text-gray-700"}`}>
            {isZh ? "平台指南" : "Platform Guide"}
          </button>
        </div>

        {/* Generator Tab */}
        {activeTab === "generator" && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Left: Controls */}
            <div className="space-y-4">
              <div className="bg-white border border-gray-200 rounded-xl p-5">
                <h2 className="font-semibold mb-3">{isZh ? "产品信息" : "Product Info"}</h2>
                <div className="space-y-3">
                  <div>
                    <label className="text-xs text-gray-500 block mb-1">{isZh ? "产品名称 *" : "Product Name *"}</label>
                    <input
                      type="text"
                      value={productName}
                      onChange={(e) => setProductName(e.target.value)}
                      placeholder={isZh ? "例如：手工编织围巾" : "e.g. Handmade Knitted Scarf"}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-gray-500 block mb-1">{isZh ? "产品描述（可选）" : "Description (optional)"}</label>
                    <textarea
                      value={productDesc}
                      onChange={(e) => setProductDesc(e.target.value)}
                      placeholder={isZh ? "材质、颜色、尺寸等细节..." : "Material, color, size details..."}
                      rows={2}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm resize-none"
                    />
                  </div>
                </div>
              </div>

              <div className="bg-white border border-gray-200 rounded-xl p-5">
                <h2 className="font-semibold mb-3">{isZh ? "图片风格" : "Image Style"}</h2>
                <div className="grid grid-cols-2 gap-2">
                  {ETSY_STYLES.map((style) => (
                    <button
                      key={style.id}
                      onClick={() => setSelectedStyle(style.id)}
                      className={`p-3 rounded-lg text-left text-sm border transition-colors cursor-pointer ${
                        selectedStyle === style.id
                          ? "border-red-700 bg-red-50 text-red-800"
                          : "border-gray-200 hover:border-gray-300 text-gray-600"
                      }`}
                    >
                      {isZh ? style.zh : style.en}
                    </button>
                  ))}
                </div>
                {selectedStyle === "custom" && (
                  <textarea
                    value={customPrompt}
                    onChange={(e) => setCustomPrompt(e.target.value)}
                    placeholder={isZh ? "描述你想要的图片风格..." : "Describe the image style you want..."}
                    rows={2}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm resize-none mt-3"
                  />
                )}
              </div>

              <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-2.5 text-xs text-amber-700">
                {isZh ? "Etsy 建议：主图 2000x2000px，至少 5 张图，第一张白底或浅色背景" : "Etsy tips: Main image 2000x2000px, at least 5 photos, first image on white/light background"}
              </div>

              <button
                onClick={generateImage}
                disabled={generating || !productName.trim()}
                className="w-full bg-red-700 hover:bg-red-800 disabled:bg-gray-300 text-white px-6 py-3 rounded-lg font-medium cursor-pointer"
              >
                {generating
                  ? (isZh ? "生成中...（约 15 秒）" : "Generating... (~15s)")
                  : (isZh ? "生成产品图片" : "Generate Product Image")}
              </button>

              {error && <p className="text-sm text-red-600">{error}</p>}
            </div>

            {/* Right: Generated Images */}
            <div>
              <h2 className="font-semibold mb-3">{isZh ? "生成结果" : "Generated Images"} ({images.length})</h2>
              {images.length === 0 ? (
                <div className="bg-gray-50 border border-gray-200 rounded-xl p-12 text-center text-gray-400">
                  <div className="text-4xl mb-3">🎨</div>
                  <p>{isZh ? "填写产品信息，选择风格，点击生成" : "Fill in product info, select style, click generate"}</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {images.map((img, i) => (
                    <div key={i} className="bg-white border border-gray-200 rounded-xl overflow-hidden">
                      <img src={img.url} alt={img.prompt} className="w-full aspect-square object-cover" />
                      <div className="p-3">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-[10px] px-2 py-0.5 rounded-full bg-orange-100 text-orange-700 font-medium">{img.style}</span>
                          <span className="text-[10px] text-gray-300">{new Date(img.timestamp).toLocaleTimeString()}</span>
                        </div>
                        <p className="text-xs text-gray-400 line-clamp-2">{img.prompt}</p>
                        <div className="flex gap-2 mt-2">
                          <a href={img.url} download target="_blank" rel="noopener noreferrer" className="text-xs text-blue-600 hover:text-blue-800 cursor-pointer">
                            {isZh ? "下载" : "Download"}
                          </a>
                          <button onClick={() => navigator.clipboard.writeText(img.url)} className="text-xs text-gray-500 hover:text-gray-700 cursor-pointer">
                            {isZh ? "复制链接" : "Copy URL"}
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* About Tab - Coming Soon features */}
        {activeTab === "about" && (
          <div className="max-w-[600px] mx-auto text-center py-12">
            <div className="text-6xl mb-6">🧶</div>
            <h2 className="text-2xl font-bold mb-3">{isZh ? "Etsy 平台整合" : "Etsy Platform Integration"}</h2>
            <p className="text-gray-500 mb-6">{isZh ? "更多功能即将上线" : "More features coming soon"}</p>
            <div className="bg-white border border-gray-200 rounded-xl p-6 text-left">
              <ul className="space-y-3 text-sm text-gray-600">
                <li className="flex items-start gap-2"><span className="text-green-500">&#10003;</span>{isZh ? "AI 产品图片生成" : "AI Product Image Generation"} <span className="text-green-600 text-xs font-medium ml-1">{isZh ? "已上线" : "Live"}</span></li>
                <li className="flex items-start gap-2"><span className="text-gray-300">&#9675;</span>{isZh ? "产品上架 — 从 AutoClaw 直接发布到 Etsy" : "Product Listing — Publish to Etsy shop"}</li>
                <li className="flex items-start gap-2"><span className="text-gray-300">&#9675;</span>{isZh ? "订单同步 — 实时同步 Etsy 订单到 CRM" : "Order Sync — Real-time to CRM"}</li>
                <li className="flex items-start gap-2"><span className="text-gray-300">&#9675;</span>{isZh ? "评价管理 — 监控和回复买家评价" : "Review Management"}</li>
                <li className="flex items-start gap-2"><span className="text-gray-300">&#9675;</span>{isZh ? "SEO 优化 — AI 生成标题、标签、描述" : "SEO — AI titles, tags, descriptions"}</li>
                <li className="flex items-start gap-2"><span className="text-gray-300">&#9675;</span>{isZh ? "竞品分析 — 分析同类目热销产品" : "Competitor Analysis"}</li>
              </ul>
            </div>
            <a href="https://www.etsy.com" target="_blank" rel="noopener noreferrer" className="inline-block mt-6 bg-orange-600 hover:bg-orange-700 text-white px-6 py-3 rounded-lg font-medium transition-colors">
              {isZh ? "访问 Etsy" : "Visit Etsy"} →
            </a>
          </div>
        )}
      </div>
    </DashboardShell>
  );
}
