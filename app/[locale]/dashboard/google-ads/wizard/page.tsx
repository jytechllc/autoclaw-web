"use client";

// PMax Quick-Start Wizard — the novice-owner flow the whole Google Ads module
// is built around: enter your website + budget, AI drafts the entire
// Performance Max campaign (name, creative bundle, images pulled from the
// real page), owner reviews and approves once, AutoClaw creates everything.
// Campaign is created PAUSED so nothing spends until explicitly enabled.

import { useUser } from "@auth0/nextjs-auth0/client";
import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { getDictionary, type Locale } from "@/lib/i18n";
import DashboardShell from "@/components/DashboardShell";
import { useOrg } from "@/components/OrgContext";

type Step = 1 | 2 | 3;

interface ImageCandidate {
  url: string;
  width: number;
  height: number;
  /** aspect bucket measured client-side; Google validates authoritatively */
  kind: "landscape" | "square" | "other" | "pending" | "broken";
}

function classifyAspect(width: number, height: number): ImageCandidate["kind"] {
  if (!width || !height) return "broken";
  const ratio = width / height;
  if (ratio >= 1.6 && ratio <= 2.2) return "landscape"; // target 1.91:1
  if (ratio >= 0.8 && ratio <= 1.25) return "square"; // target 1:1
  return "other";
}

function linesToArray(s: string): string[] {
  return s
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
}

export default function PmaxWizardPage() {
  const { user } = useUser();
  const params = useParams();
  const router = useRouter();
  const locale = (params.locale as Locale) || "en";
  const dict = getDictionary(locale);
  const t = dict.googleAdsPage;
  const { activeOrg, isReadOnly } = useOrg();

  const [step, setStep] = useState<Step>(1);
  const [error, setError] = useState("");

  // Step 1 — inputs
  const [url, setUrl] = useState("");
  const [dailyBudget, setDailyBudget] = useState("10");
  const [totalBudget, setTotalBudget] = useState("100");
  const [generating, setGenerating] = useState(false);

  // Step 2 — AI draft (all editable)
  const [campaignName, setCampaignName] = useState("");
  const [businessName, setBusinessName] = useState("");
  const [headlinesText, setHeadlinesText] = useState("");
  const [longHeadlinesText, setLongHeadlinesText] = useState("");
  const [descriptionsText, setDescriptionsText] = useState("");
  const [candidates, setCandidates] = useState<ImageCandidate[]>([]);
  const [selectedLandscape, setSelectedLandscape] = useState<Set<string>>(new Set());
  const [selectedSquare, setSelectedSquare] = useState<Set<string>>(new Set());
  const [manualLandscape, setManualLandscape] = useState("");
  const [manualSquare, setManualSquare] = useState("");
  const [draftWarnings, setDraftWarnings] = useState<string[]>([]);

  // Step 3 — creation
  const [creating, setCreating] = useState(false);
  const [createdCampaignId, setCreatedCampaignId] = useState<number | null>(null);
  const [createWarning, setCreateWarning] = useState("");

  // Redirect read-only accounts — this page is write-only by nature.
  useEffect(() => {
    if (isReadOnly) router.replace(`/${locale}/dashboard/google-ads`);
  }, [isReadOnly, router, locale]);

  // Measure candidate image aspect ratios in the browser (no server download).
  useEffect(() => {
    candidates.forEach((c, i) => {
      if (c.kind !== "pending") return;
      const img = new Image();
      img.onload = () => {
        setCandidates((prev) => {
          const next = [...prev];
          if (next[i]?.url === c.url) {
            next[i] = { ...next[i], width: img.naturalWidth, height: img.naturalHeight, kind: classifyAspect(img.naturalWidth, img.naturalHeight) };
          }
          return next;
        });
      };
      img.onerror = () => {
        setCandidates((prev) => {
          const next = [...prev];
          if (next[i]?.url === c.url) next[i] = { ...next[i], kind: "broken" };
          return next;
        });
      };
      img.src = c.url;
    });
  }, [candidates]);

  // Pre-select the first qualifying image per bucket once measured.
  useEffect(() => {
    if (selectedLandscape.size === 0) {
      const first = candidates.find((c) => c.kind === "landscape");
      if (first) setSelectedLandscape(new Set([first.url]));
    }
    if (selectedSquare.size === 0) {
      const first = candidates.find((c) => c.kind === "square");
      if (first) setSelectedSquare(new Set([first.url]));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candidates]);

  async function handleGenerate() {
    setError("");
    if (!/^https?:\/\//i.test(url.trim())) {
      setError(t.wizardUrlInvalid || "Enter your website URL starting with http:// or https://");
      return;
    }
    const daily = Number(dailyBudget);
    const total = Number(totalBudget);
    if (!Number.isFinite(daily) || daily <= 0 || !Number.isFinite(total) || total < daily) {
      setError(t.wizardBudgetInvalid || "Daily budget must be > 0 and total budget ≥ daily budget");
      return;
    }
    setGenerating(true);
    try {
      const res = await fetch("/api/google-ads/ad-copy/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "pmax", url: url.trim(), locale }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setError(data.error || "Generation failed");
        setGenerating(false);
        return;
      }
      setCampaignName(String(data.campaignName || ""));
      setBusinessName(String(data.businessName || ""));
      setHeadlinesText((data.headlines || []).join("\n"));
      setLongHeadlinesText((data.longHeadlines || []).join("\n"));
      setDescriptionsText((data.descriptions || []).join("\n"));
      setCandidates(
        (Array.isArray(data.images) ? (data.images as string[]) : []).map((u) => ({ url: u, width: 0, height: 0, kind: "pending" as const }))
      );
      setSelectedLandscape(new Set());
      setSelectedSquare(new Set());
      setDraftWarnings(Array.isArray(data.warnings) ? data.warnings : []);
      setStep(2);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    setGenerating(false);
  }

  function toggle(set: Set<string>, url: string, apply: (s: Set<string>) => void) {
    const next = new Set(set);
    if (next.has(url)) next.delete(url);
    else next.add(url);
    apply(next);
  }

  const headlines = linesToArray(headlinesText);
  const longHeadlines = linesToArray(longHeadlinesText);
  const descriptions = linesToArray(descriptionsText);
  const landscapeUrls = [...selectedLandscape, ...linesToArray(manualLandscape)];
  const squareUrls = [...selectedSquare, ...linesToArray(manualSquare)];

  const draftValid =
    campaignName.trim().length > 0 &&
    businessName.trim().length > 0 &&
    headlines.length >= 3 &&
    longHeadlines.length >= 1 &&
    descriptions.length >= 2 &&
    landscapeUrls.length >= 1 &&
    squareUrls.length >= 1;

  async function handleCreate() {
    setError("");
    setCreating(true);
    setCreateWarning("");
    try {
      // 1. Create the PMax campaign shell (reserves credits, PAUSED).
      const campRes = await fetch("/api/google-ads/campaigns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: campaignName.trim(),
          dailyBudget: Number(dailyBudget),
          totalBudget: Number(totalBudget),
          channel: "PERFORMANCE_MAX",
          orgId: activeOrg?.id,
        }),
      });
      const campData = await campRes.json();
      if (campRes.status === 402) {
        setError(t.wizardInsufficient || "Not enough ad credits — top up on the Google Ads page first.");
        setCreating(false);
        return;
      }
      if (!campRes.ok || !campData.success) {
        setError(campData.error || "Campaign creation failed");
        setCreating(false);
        return;
      }
      const campaignId = Number(campData.campaignId);
      setCreatedCampaignId(campaignId);

      // 2. Attach the asset group with the approved creative.
      const agRes = await fetch(`/api/google-ads/campaigns/${campaignId}/asset-groups`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: `${campaignName.trim()} Assets`,
          headlines,
          longHeadlines,
          descriptions,
          businessName: businessName.trim(),
          finalUrl: url.trim(),
          marketingImageUrls: landscapeUrls,
          squareMarketingImageUrls: squareUrls,
          orgId: activeOrg?.id,
        }),
      });
      const agData = await agRes.json();
      if (!agRes.ok || !agData.success) {
        // Campaign exists but creative failed — surface, don't dead-end.
        setCreateWarning(agData.error || (t.wizardCreatedWithWarnings || "Created, but the asset group failed — finish it on the campaign page."));
      } else if (agData.warnings) {
        setCreateWarning(t.wizardCreatedWithWarnings || "Created, but some assets failed — check the campaign page.");
      }
      setStep(3);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    setCreating(false);
  }

  if (!user) return null;

  const stepLabels = [
    t.wizardStep1 || "Website & budget",
    t.wizardStep2 || "Review AI draft",
    t.wizardStep3 || "Done",
  ];

  return (
    <DashboardShell user={user} plan={undefined}>
      <div className="p-4 sm:p-6 max-w-3xl mx-auto space-y-6">
        <div>
          <Link href={`/${locale}/dashboard/google-ads`} className="text-sm text-gray-500 hover:text-gray-800">
            ← {t.title}
          </Link>
          <h1 className="text-2xl font-bold text-gray-900 mt-2">🚀 {t.wizardTitle || "PMax Quick Start"}</h1>
          <p className="text-gray-500 mt-1">{t.wizardSubtitle || "Two questions. AI builds the whole campaign — you just approve."}</p>
        </div>

        {/* Step indicator */}
        <div className="flex items-center gap-2">
          {stepLabels.map((label, i) => (
            <div key={label} className="flex items-center gap-2">
              <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium ${step === i + 1 ? "bg-red-800 text-white" : step > i + 1 ? "bg-green-100 text-green-800" : "bg-gray-100 text-gray-500"}`}>
                <span>{step > i + 1 ? "✓" : i + 1}</span>
                <span>{label}</span>
              </div>
              {i < stepLabels.length - 1 && <span className="text-gray-300">—</span>}
            </div>
          ))}
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-800 rounded-lg p-3 text-sm">{error}</div>
        )}

        {/* ============ STEP 1 ============ */}
        {step === 1 && (
          <div className="bg-white border border-gray-200 rounded-xl p-5 space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t.wizardUrlLabel || "Your website or landing page"}</label>
              <input
                type="url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://your-store.com"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{t.dailyBudget || "Daily budget"} ($)</label>
                <input type="number" min="1" value={dailyBudget} onChange={(e) => setDailyBudget(e.target.value)} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{t.totalBudget || "Total budget cap"} ($)</label>
                <input type="number" min="1" value={totalBudget} onChange={(e) => setTotalBudget(e.target.value)} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
              </div>
            </div>
            <p className="text-xs text-gray-500">{t.wizardBudgetHint || "Reserved from your ad credits. The campaign auto-pauses when the cap is reached — you can never overspend."}</p>
            <button
              onClick={handleGenerate}
              disabled={generating}
              className="w-full bg-red-800 text-white px-4 py-2.5 rounded-lg text-sm font-medium hover:bg-red-900 transition cursor-pointer disabled:opacity-50"
            >
              {generating ? (t.wizardGenerating || "AI is reading your site and drafting the campaign…") : (t.wizardGenerate || "✨ Let AI build my campaign")}
            </button>
          </div>
        )}

        {/* ============ STEP 2 ============ */}
        {step === 2 && (
          <div className="space-y-4">
            {draftWarnings.length > 0 && (
              <div className="bg-amber-50 border border-amber-200 text-amber-800 rounded-lg p-3 text-xs space-y-1">
                {draftWarnings.map((w) => <div key={w}>⚠️ {w}</div>)}
              </div>
            )}

            <div className="bg-white border border-gray-200 rounded-xl p-5 space-y-4">
              <div className="grid sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{t.wizardCampaignName || "Campaign name"}</label>
                  <input value={campaignName} onChange={(e) => setCampaignName(e.target.value)} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{t.businessName || "Business name"}</label>
                  <input value={businessName} maxLength={25} onChange={(e) => setBusinessName(e.target.value)} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{t.pmaxHeadlinesPlaceholder || "Headlines (≥3, one per line, ≤30 chars each)"} <span className="text-gray-400">({headlines.length})</span></label>
                <textarea value={headlinesText} onChange={(e) => setHeadlinesText(e.target.value)} rows={6} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{t.pmaxLongHeadlinesPlaceholder || "Long headlines (≥1, one per line, ≤90 chars each)"} <span className="text-gray-400">({longHeadlines.length})</span></label>
                <textarea value={longHeadlinesText} onChange={(e) => setLongHeadlinesText(e.target.value)} rows={3} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{t.pmaxDescriptionsPlaceholder || "Descriptions (≥2, one per line, ≤90 chars each)"} <span className="text-gray-400">({descriptions.length})</span></label>
                <textarea value={descriptionsText} onChange={(e) => setDescriptionsText(e.target.value)} rows={4} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono" />
              </div>
            </div>

            {/* Image pickers */}
            <div className="bg-white border border-gray-200 rounded-xl p-5 space-y-4">
              <p className="text-xs text-gray-500">{t.wizardImagesHint || "Images pulled from your website. Google needs ≥1 landscape (1.91:1) and ≥1 square (1:1) image; wrong ratios may be rejected."}</p>
              {(["landscape", "square"] as const).map((bucket) => {
                const selected = bucket === "landscape" ? selectedLandscape : selectedSquare;
                const setSelected = bucket === "landscape" ? setSelectedLandscape : setSelectedSquare;
                const manual = bucket === "landscape" ? manualLandscape : manualSquare;
                const setManual = bucket === "landscape" ? setManualLandscape : setManualSquare;
                const matching = candidates.filter((c) => c.kind === bucket);
                const others = candidates.filter((c) => c.kind === "other" || c.kind === "pending");
                return (
                  <div key={bucket}>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      {bucket === "landscape" ? (t.wizardImagesLandscape || "Landscape images (pick ≥1)") : (t.wizardImagesSquare || "Square images (pick ≥1)")}
                      <span className="text-gray-400 ml-1">({selected.size + linesToArray(manual).length})</span>
                    </label>
                    {matching.length + others.length > 0 ? (
                      <div className="flex flex-wrap gap-2">
                        {[...matching, ...others].map((c) => (
                          <button
                            key={c.url}
                            type="button"
                            onClick={() => toggle(selected, c.url, setSelected)}
                            className={`relative border-2 rounded-lg overflow-hidden w-28 h-20 bg-gray-50 cursor-pointer ${selected.has(c.url) ? "border-green-600" : "border-gray-200 hover:border-gray-400"}`}
                            title={`${c.width}×${c.height}${c.kind !== bucket ? " ⚠️" : ""}`}
                          >
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={c.url} alt="" className="w-full h-full object-cover" />
                            {selected.has(c.url) && <span className="absolute top-0.5 right-0.5 bg-green-600 text-white text-xs rounded-full w-5 h-5 flex items-center justify-center">✓</span>}
                            {c.kind !== bucket && c.kind !== "pending" && <span className="absolute bottom-0.5 left-0.5 bg-amber-500 text-white text-[10px] rounded px-1">⚠</span>}
                          </button>
                        ))}
                      </div>
                    ) : (
                      <p className="text-xs text-amber-700">{t.wizardNoImages || "No usable images found on the page — paste public image URLs below (one per line)"}</p>
                    )}
                    <textarea
                      value={manual}
                      onChange={(e) => setManual(e.target.value)}
                      rows={1}
                      placeholder={bucket === "landscape" ? "https://…/banner-1200x628.jpg" : "https://…/square-1200x1200.jpg"}
                      className="mt-2 w-full border border-gray-200 rounded-lg px-3 py-1.5 text-xs font-mono"
                    />
                  </div>
                );
              })}
            </div>

            <div className="flex items-center gap-3">
              <button onClick={() => setStep(1)} className="border border-gray-300 px-4 py-2.5 rounded-lg text-sm font-medium hover:bg-gray-50 transition cursor-pointer">
                {t.wizardBack || "← Back"}
              </button>
              <button
                onClick={handleCreate}
                disabled={!draftValid || creating}
                className="flex-1 bg-green-600 text-white px-4 py-2.5 rounded-lg text-sm font-medium hover:bg-green-700 transition cursor-pointer disabled:opacity-50"
              >
                {creating ? (t.wizardCreating || "Creating campaign & uploading assets…") : (t.wizardCreate || "✅ Approve & create campaign")}
              </button>
            </div>
            {!draftValid && (
              <p className="text-xs text-gray-500">{t.assetGroupValidation || "Need: name, ≥3 headlines, ≥1 long headline, ≥2 descriptions, business name, ≥1 landscape image, ≥1 square image."}</p>
            )}
          </div>
        )}

        {/* ============ STEP 3 ============ */}
        {step === 3 && (
          <div className="bg-white border border-gray-200 rounded-xl p-8 text-center space-y-4">
            <div className="text-5xl">🎉</div>
            <h2 className="text-xl font-bold text-gray-900">{t.wizardDoneTitle || "Campaign created"}</h2>
            {createWarning && (
              <div className="bg-amber-50 border border-amber-200 text-amber-800 rounded-lg p-3 text-sm text-left">⚠️ {createWarning}</div>
            )}
            <p className="text-sm text-gray-600 max-w-md mx-auto">
              {t.wizardDoneNote || "It starts PAUSED so nothing is spent yet. Open the campaign, give it a final look, and hit Enable when you're ready."}
            </p>
            <div className="flex items-center justify-center gap-3">
              <Link href={`/${locale}/dashboard/google-ads`} className="border border-gray-300 px-4 py-2 rounded-lg text-sm font-medium hover:bg-gray-50 transition">
                {t.title}
              </Link>
              {createdCampaignId && (
                <Link href={`/${locale}/dashboard/google-ads/${createdCampaignId}`} className="bg-red-800 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-red-900 transition">
                  {t.wizardGoDetail || "Open campaign →"}
                </Link>
              )}
            </div>
          </div>
        )}
      </div>
    </DashboardShell>
  );
}
