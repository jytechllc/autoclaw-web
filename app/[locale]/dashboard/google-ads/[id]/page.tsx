"use client";

import { useUser } from "@auth0/nextjs-auth0/client";
import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { getDictionary, type Locale } from "@/lib/i18n";
import DashboardShell from "@/components/DashboardShell";
import { useOrg } from "@/components/OrgContext";
import { COUNTRIES } from "@/lib/google-ads";
import { applyPlatformMarkup, paymentGatewayFee, platformFee, isPaidPlan } from "@/lib/billing";
import { toCsv, downloadCsv } from "@/lib/csv";

/**
 * Realistic-looking placeholder content for the PMAX asset group form.
 * One-click prefill — meets every Google Ads required minimum so the
 * form is submittable as-is. Useful for first-time UX and for recording
 * smooth Loom / Vercel-preview demos without typing 9 fields live.
 *
 * Images are stable Unsplash photos sized for PMAX aspect ratios. Final
 * URL points to our public homepage so the click-through is real.
 */
const DEMO_ASSET_GROUP_CONTENT = {
  name: "Demo Asset Group",
  businessName: "AutoClaw Demo",
  finalUrl: "https://autoclaw.com",
  headlines: [
    "Try AutoClaw Free",
    "AI Outbound Sales",
    "Boost Your Pipeline",
    "Book More Meetings",
  ].join("\n"),
  longHeadlines: [
    "Automate B2B outbound with AI agents that book meetings while you sleep",
  ].join("\n"),
  descriptions: [
    "Find leads, write personalized emails, book meetings. All on autopilot.",
    "AutoClaw replaces your SDR stack with one AI platform you control.",
  ].join("\n"),
  marketingImageUrls: [
    "https://images.unsplash.com/photo-1551434678-e076c223a692?w=1200&h=628&fit=crop",
  ].join("\n"),
  squareImageUrls: [
    "https://images.unsplash.com/photo-1551434678-e076c223a692?w=1200&h=1200&fit=crop",
  ].join("\n"),
  logoUrl: "",
} as const;

interface CampaignRow {
  id: number;
  platform_campaign_id: string;
  campaign_name: string;
  channel: string;
  daily_budget: string | number;
  currency: string;
  status: string;
  total_budget_cents: number | string | null;
  reserved_cents: number | string | null;
  spent_cents: number | string | null;
  closed: boolean;
  created_at: string;
  updated_at: string;
  project_id: number | null;
  project_name: string | null;
  project_website: string | null;
}

interface Detail {
  resourceName: string;
  name: string;
  status: string;
  channelType: string;
  startDate?: string;
  endDate?: string;
  optimizationScore?: number;
  metrics: { impressions: number; clicks: number; costMicros: number; conversions: number; ctr: number; avgCpcMicros: number };
  dailyMetrics?: Array<{ date: string; impressions: number; clicks: number; costMicros: number; conversions: number }>;
  locations: Array<{ id: string; name: string; bidModifier?: number }>;
  audiences: Array<{ category: string; label: string; negative: boolean; adGroupName: string; apiType: string; value: string }>;
  adGroups: Array<{ resourceName: string; name: string; status: string; cpcBidMicros: number }>;
  assetGroups?: Array<{ resourceName: string; name: string; status: string; adStrength: string; primaryStatus: string; primaryStatusReasons: string[]; finalUrls: string[] }>;
  keywords: Array<{ text: string; matchType: string }>;
  bidding?: { strategyType: string; targetCpaMicros: number; targetRoas: number };
  negativeKeywords?: Array<{ resourceName: string; text: string; matchType: string }>;
  adSchedules?: Array<{ resourceName: string; dayOfWeek: string; startHour: number; endHour: number }>;
  deviceModifiers?: Array<{ resourceName: string; device: string; bidModifier: number }>;
  sitelinks?: Array<{ resourceName: string; linkText: string; finalUrl: string; description1: string; description2: string }>;
  callouts?: Array<{ resourceName: string; text: string }>;
  structuredSnippets?: Array<{ resourceName: string; header: string; values: string[] }>;
  ads: Array<{
    resourceName: string;
    status: string;
    adId: string;
    name: string;
    type: string;
    headlines: string[];
    longHeadlines: string[];
    descriptions: string[];
    callToActions: string[];
    videos: Array<{ asset: string; youtubeVideoId: string; title: string }>;
    finalUrls: string[];
  }>;
}

type DemoApiType = "AGE_RANGE" | "GENDER" | "PARENTAL_STATUS" | "INCOME_RANGE";
type DemoCriterion = { apiType: DemoApiType; value: string; negative: boolean };

const DEMO_OPTIONS: { apiType: DemoApiType; title: string; options: Array<{ value: string; label: string }> }[] = [
  {
    apiType: "AGE_RANGE",
    title: "Age",
    options: [
      { value: "AGE_RANGE_18_24", label: "18-24" },
      { value: "AGE_RANGE_25_34", label: "25-34" },
      { value: "AGE_RANGE_35_44", label: "35-44" },
      { value: "AGE_RANGE_45_54", label: "45-54" },
      { value: "AGE_RANGE_55_64", label: "55-64" },
      { value: "AGE_RANGE_65_UP", label: "65+" },
      { value: "AGE_RANGE_UNDETERMINED", label: "Unknown" },
    ],
  },
  {
    apiType: "GENDER",
    title: "Gender",
    options: [
      { value: "MALE", label: "Male" },
      { value: "FEMALE", label: "Female" },
      { value: "UNDETERMINED", label: "Unknown" },
    ],
  },
  {
    apiType: "PARENTAL_STATUS",
    title: "Parental status",
    options: [
      { value: "PARENT", label: "Parent" },
      { value: "NOT_A_PARENT", label: "Not a parent" },
      { value: "UNDETERMINED", label: "Unknown" },
    ],
  },
  {
    apiType: "INCOME_RANGE",
    title: "Household income",
    options: [
      { value: "INCOME_RANGE_90_UP", label: "Top 10%" },
      { value: "INCOME_RANGE_80_90", label: "11-20%" },
      { value: "INCOME_RANGE_70_80", label: "21-30%" },
      { value: "INCOME_RANGE_60_70", label: "31-40%" },
      { value: "INCOME_RANGE_50_60", label: "41-50%" },
      { value: "INCOME_RANGE_0_50", label: "Lower 50%" },
      { value: "INCOME_RANGE_UNDETERMINED", label: "Unknown" },
    ],
  },
];

const DEMO_API_TYPES: DemoApiType[] = DEMO_OPTIONS.map((d) => d.apiType);

// Bid strategies selectable per channel (mirrors lib/google-ads.ts allowedBidStrategies).
type BidStrategyOption = "MANUAL_CPC" | "MAXIMIZE_CLICKS" | "MAXIMIZE_CONVERSIONS" | "TARGET_CPA" | "MAXIMIZE_CONVERSION_VALUE" | "TARGET_ROAS";
const ALL_BID_STRATEGIES: Array<{ value: BidStrategyOption; label: string }> = [
  { value: "MANUAL_CPC", label: "Manual CPC" },
  { value: "MAXIMIZE_CLICKS", label: "Maximize Clicks" },
  { value: "MAXIMIZE_CONVERSIONS", label: "Maximize Conversions" },
  { value: "TARGET_CPA", label: "Target CPA" },
  { value: "MAXIMIZE_CONVERSION_VALUE", label: "Maximize Conversion Value" },
  { value: "TARGET_ROAS", label: "Target ROAS" },
];
const CHANNEL_BID_OPTIONS: Record<string, BidStrategyOption[]> = {
  VIDEO: ["MAXIMIZE_CONVERSIONS", "TARGET_CPA"],
  PERFORMANCE_MAX: ["MAXIMIZE_CONVERSIONS", "TARGET_CPA", "MAXIMIZE_CONVERSION_VALUE", "TARGET_ROAS"],
  DEMAND_GEN: ["MAXIMIZE_CLICKS", "MAXIMIZE_CONVERSIONS", "TARGET_CPA", "MAXIMIZE_CONVERSION_VALUE", "TARGET_ROAS"],
};
function bidOptionsForChannel(channelType: string): Array<{ value: BidStrategyOption; label: string }> {
  const allowed = CHANNEL_BID_OPTIONS[channelType];
  return allowed ? ALL_BID_STRATEGIES.filter((o) => allowed.includes(o.value)) : ALL_BID_STRATEGIES;
}
/** Human label for Google's reported bidding_strategy_type + targets. */
function describeBidding(b?: { strategyType: string; targetCpaMicros: number; targetRoas: number }): string {
  if (!b?.strategyType) return "";
  const base: Record<string, string> = {
    MANUAL_CPC: "Manual CPC",
    TARGET_SPEND: "Maximize Clicks",
    MAXIMIZE_CONVERSIONS: "Maximize Conversions",
    MAXIMIZE_CONVERSION_VALUE: "Maximize Conversion Value",
    TARGET_CPA: "Target CPA",
    TARGET_ROAS: "Target ROAS",
  };
  let label = base[b.strategyType] || b.strategyType;
  if (b.targetCpaMicros > 0) label = `Target CPA $${(b.targetCpaMicros / 1_000_000).toFixed(2)}`;
  else if (b.targetRoas > 0) label = `Target ROAS ${(b.targetRoas * 100).toFixed(0)}%`;
  return label;
}
/** Channels where campaign-level negative keywords are supported (mirrors lib). */
const NEG_KW_CHANNELS = new Set(["SEARCH", "DISPLAY", "SHOPPING", "VIDEO"]);

/** Channels supporting ad schedules / day parting (mirrors lib). */
const AD_SCHEDULE_CHANNELS = new Set(["SEARCH", "DISPLAY", "SHOPPING", "VIDEO"]);
const SCHEDULE_DAYS = ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY"] as const;
type ScheduleDay = (typeof SCHEDULE_DAYS)[number];
type ScheduleRow = { dayOfWeek: ScheduleDay; startHour: number; endHour: number };
const DAY_SHORT: Record<string, string> = {
  MONDAY: "Mon", TUESDAY: "Tue", WEDNESDAY: "Wed", THURSDAY: "Thu",
  FRIDAY: "Fri", SATURDAY: "Sat", SUNDAY: "Sun",
};
function fmtHour(h: number): string {
  return `${String(h).padStart(2, "0")}:00`;
}

/** Channels supporting device bid adjustments (mirrors lib). */
const DEVICE_MOD_CHANNELS = new Set(["SEARCH", "DISPLAY", "SHOPPING"]);
const DEVICE_LIST = ["MOBILE", "DESKTOP", "TABLET"] as const;
type DeviceName = (typeof DEVICE_LIST)[number];
const DEVICE_ICON: Record<DeviceName, string> = { MOBILE: "📱", DESKTOP: "🖥️", TABLET: "📲" };
type DeviceModRow = { device: DeviceName; mode: "default" | "adjust" | "exclude"; percent: number };

function deviceRowsFromDetail(mods: Array<{ device: string; bidModifier: number }> | undefined): DeviceModRow[] {
  return DEVICE_LIST.map((d) => {
    const found = (mods || []).find((m) => m.device === d);
    if (!found) return { device: d, mode: "default" as const, percent: 0 };
    if (found.bidModifier === 0) return { device: d, mode: "exclude" as const, percent: 0 };
    const pct = Math.round((found.bidModifier - 1) * 100);
    return { device: d, mode: pct === 0 ? ("default" as const) : ("adjust" as const), percent: pct };
  });
}

function formatUsd(cents: number | string | null | undefined): string {
  return `$${(Number(cents || 0) / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fromMicros(micros: number): number {
  return micros / 1_000_000;
}

export default function CampaignDetailPage() {
  const { user } = useUser();
  const params = useParams();
  const router = useRouter();
  const locale = (params.locale as Locale) || "en";
  const campaignId = params.id as string;
  const dict = getDictionary(locale);
  const t = dict.googleAdsPage;
  const { activeOrg, isReadOnly } = useOrg();

  const [campaign, setCampaign] = useState<CampaignRow | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [googleAdsUrl, setGoogleAdsUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [actioning, setActioning] = useState(false);
  const [toast, setToast] = useState("");

  // Rename
  const [editingName, setEditingName] = useState(false);
  const [nameInput, setNameInput] = useState("");
  const [renaming, setRenaming] = useState(false);

  // Generic field edit state
  const [editingField, setEditingField] = useState<"totalBudget" | "dailyBudget" | "schedule" | null>(null);
  const [fieldInputA, setFieldInputA] = useState("");
  const [fieldInputB, setFieldInputB] = useState("");
  const [savingField, setSavingField] = useState(false);

  async function handleSaveField() {
    if (!editingField) return;
    setSavingField(true);
    let body: Record<string, unknown> = { orgId: activeOrg?.id };
    if (editingField === "totalBudget") {
      const n = Number(fieldInputA);
      if (!Number.isFinite(n) || n <= 0) { setSavingField(false); setToast(t.invalidBudget || "Invalid"); setTimeout(() => setToast(""), 3000); return; }
      body = { ...body, action: "set_total_budget", totalBudget: n };
    } else if (editingField === "dailyBudget") {
      const n = Number(fieldInputA);
      if (!Number.isFinite(n) || n <= 0) { setSavingField(false); setToast(t.invalidBudget || "Invalid"); setTimeout(() => setToast(""), 3000); return; }
      body = { ...body, action: "set_daily_budget", dailyBudget: n };
    } else if (editingField === "schedule") {
      body = { ...body, action: "set_schedule", startDate: fieldInputA || null, endDate: fieldInputB || null };
    }
    try {
      const res = await fetch(`/api/google-ads/campaigns/${campaignId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        if (data.dailyAdjusted) {
          setToast(`${t.updated || "Updated"} · ${t.dailyAutoLowered || "Daily budget auto-lowered"} $${data.dailyAdjusted.from.toFixed(2)} → $${data.dailyAdjusted.to.toFixed(2)}`);
        } else {
          setToast(t.updated || "Updated");
        }
        setEditingField(null);
        fetchData();
        setTimeout(() => setToast(""), 5000);
      } else if (res.status === 402) {
        setToast(`${t.insufficientCredits || "Insufficient credits"} (${formatUsd(data.balanceCents)} / ${formatUsd(data.requestedCents)})`);
        setTimeout(() => setToast(""), 4000);
      } else {
        setToast(data.error || "Update failed");
        setTimeout(() => setToast(""), 4000);
      }
    } catch (e) {
      setToast(e instanceof Error ? e.message : "Update failed");
      setTimeout(() => setToast(""), 3000);
    }
    setSavingField(false);
  }

  // Locations edit
  const [editingLocations, setEditingLocations] = useState(false);
  const [editLocations, setEditLocations] = useState<Array<{ id: string; name: string; targetType?: string }>>([]);
  const [savingLocations, setSavingLocations] = useState(false);
  const [geoQuery, setGeoQuery] = useState("");
  const [geoSuggestions, setGeoSuggestions] = useState<Array<{ id: string; name: string; canonicalName: string; targetType: string }>>([]);
  const [geoSearching, setGeoSearching] = useState(false);

  // Debounced geo search
  useEffect(() => {
    if (!editingLocations || geoQuery.trim().length < 2) {
      setGeoSuggestions([]);
      return;
    }
    const ctrl = new AbortController();
    const timer = setTimeout(async () => {
      setGeoSearching(true);
      try {
        const res = await fetch(`/api/google-ads/geo-targets?q=${encodeURIComponent(geoQuery)}`, { signal: ctrl.signal });
        const data = await res.json();
        setGeoSuggestions(data.suggestions || []);
      } catch { /* ignore */ }
      setGeoSearching(false);
    }, 300);
    return () => { clearTimeout(timer); ctrl.abort(); };
  }, [geoQuery, editingLocations]);

  function openLocationEdit() {
    setEditLocations(detail?.locations || []);
    setGeoQuery("");
    setGeoSuggestions([]);
    setEditingLocations(true);
  }

  async function handleSaveLocations() {
    setSavingLocations(true);
    try {
      const res = await fetch(`/api/google-ads/campaigns/${campaignId}/locations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          locationIds: editLocations.map((l) => l.id),
          orgId: activeOrg?.id,
        }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setToast(t.locationsUpdated || "Locations updated");
        setEditingLocations(false);
        fetchData();
        setTimeout(() => setToast(""), 3000);
      } else {
        setToast(data.error || "Update failed");
        setTimeout(() => setToast(""), 4000);
      }
    } catch (e) {
      setToast(e instanceof Error ? e.message : "Update failed");
      setTimeout(() => setToast(""), 3000);
    }
    setSavingLocations(false);
  }

  // Audiences edit (Phase 1: demographics only — AGE_RANGE / GENDER / PARENTAL_STATUS / INCOME_RANGE)
  const [editingAudiences, setEditingAudiences] = useState(false);
  const [editAudiences, setEditAudiences] = useState<DemoCriterion[]>([]);
  const [savingAudiences, setSavingAudiences] = useState(false);

  function openAudienceEdit() {
    const demos = (detail?.audiences || [])
      .filter((a) => DEMO_API_TYPES.includes(a.apiType as DemoApiType))
      .map((a) => ({ apiType: a.apiType as DemoApiType, value: a.value, negative: a.negative }));
    // Dedupe — same audience gets one row per ad group, collapse to single chip
    const dedup = new Map<string, DemoCriterion>();
    for (const c of demos) dedup.set(`${c.apiType}|${c.value}`, c);
    setEditAudiences([...dedup.values()]);
    setEditingAudiences(true);
  }

  function toggleAudience(apiType: DemoApiType, value: string) {
    const key = `${apiType}|${value}`;
    const idx = editAudiences.findIndex((a) => `${a.apiType}|${a.value}` === key);
    if (idx >= 0) {
      setEditAudiences(editAudiences.filter((_, i) => i !== idx));
    } else {
      setEditAudiences([...editAudiences, { apiType, value, negative: false }]);
    }
  }

  async function handleSaveAudiences() {
    setSavingAudiences(true);
    try {
      const res = await fetch(`/api/google-ads/campaigns/${campaignId}/audiences`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ audiences: editAudiences, orgId: activeOrg?.id }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setToast("Audiences updated");
        setEditingAudiences(false);
        fetchData();
        setTimeout(() => setToast(""), 3000);
      } else {
        setToast(data.error || "Update failed");
        setTimeout(() => setToast(""), 4000);
      }
    } catch (e) {
      setToast(e instanceof Error ? e.message : "Update failed");
      setTimeout(() => setToast(""), 3000);
    }
    setSavingAudiences(false);
  }

  // Ad group create
  const [showAgForm, setShowAgForm] = useState(false);
  const [agName, setAgName] = useState("");
  const [agCpcBid, setAgCpcBid] = useState("1.00");
  const [agSubmitting, setAgSubmitting] = useState(false);
  const [agError, setAgError] = useState("");

  // PMAX Asset Group create (KAN-53c)
  const [showAssetForm, setShowAssetForm] = useState(false);
  const [assetName, setAssetName] = useState("");
  const [assetHeadlines, setAssetHeadlines] = useState("");
  const [assetLongHeadlines, setAssetLongHeadlines] = useState("");
  const [assetDescriptions, setAssetDescriptions] = useState("");
  const [assetBusinessName, setAssetBusinessName] = useState("");
  const [assetFinalUrl, setAssetFinalUrl] = useState("");
  const [assetMarketingImageUrls, setAssetMarketingImageUrls] = useState("");
  const [assetSquareImageUrls, setAssetSquareImageUrls] = useState("");
  const [assetLogoUrl, setAssetLogoUrl] = useState("");
  const [assetSubmitting, setAssetSubmitting] = useState(false);
  const [assetError, setAssetError] = useState("");

  // Ad create per-ad-group (Search Ad)
  const [adFormFor, setAdFormFor] = useState<string | null>(null); // adGroupResourceName
  const [adHeadlines, setAdHeadlines] = useState("");
  const [adDescriptions, setAdDescriptions] = useState("");
  const [adFinalUrl, setAdFinalUrl] = useState("");
  const [adSubmitting, setAdSubmitting] = useState(false);
  const [adError, setAdError] = useState("");

  // Video Ad form state
  const [vYoutubeUrl, setVYoutubeUrl] = useState("");
  const [vShortHeadlines, setVShortHeadlines] = useState("");
  const [vLongHeadline, setVLongHeadline] = useState("");
  const [vDescriptions, setVDescriptions] = useState("");
  const [vCta, setVCta] = useState("Subscribe");
  const [vFinalUrl, setVFinalUrl] = useState("");

  // Auto-generate copy from landing page
  const [genCopyLoading, setGenCopyLoading] = useState(false);

  // Keyword input form (per ad group, Search only)
  const [kwFormFor, setKwFormFor] = useState<string | null>(null);
  const [kwText, setKwText] = useState("");
  const [kwMatchType, setKwMatchType] = useState<"BROAD" | "PHRASE" | "EXACT">("BROAD");
  const [kwSubmitting, setKwSubmitting] = useState(false);
  const [kwError, setKwError] = useState("");

  // Display ad form
  const [dMarketingImages, setDMarketingImages] = useState("");
  const [dSquareImages, setDSquareImages] = useState("");
  const [dLogoUrl, setDLogoUrl] = useState("");
  const [dHeadlines, setDHeadlines] = useState("");
  const [dLongHeadline, setDLongHeadline] = useState("");
  const [dDescriptions, setDDescriptions] = useState("");
  const [dBusinessName, setDBusinessName] = useState("");
  const [dFinalUrl, setDFinalUrl] = useState("");

  const fetchData = useCallback(async () => {
    setLoading(true);
    const orgQuery = activeOrg ? `?org_id=${activeOrg.id}` : "";
    try {
      const res = await fetch(`/api/google-ads/campaigns/${campaignId}${orgQuery}`);
      const data = await res.json();
      if (res.ok) {
        setCampaign(data.campaign);
        setDetail(data.detail);
        setDetailError(data.detailError);
        setGoogleAdsUrl(data.googleAdsUrl);
      } else {
        setDetailError(data.error || "Failed to load");
      }
    } catch (e) {
      setDetailError(e instanceof Error ? e.message : "Failed to load");
    }
    setLoading(false);
  }, [campaignId, activeOrg]);

  useEffect(() => {
    if (user) fetchData();
  }, [user, fetchData]);

  async function handleAction(action: "pause" | "enable" | "close") {
    if (action === "close" && !window.confirm(t.confirmClose || "Close and refund?")) return;
    setActioning(true);
    try {
      const res = await fetch(`/api/google-ads/campaigns/${campaignId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, orgId: activeOrg?.id }),
      });
      const data = await res.json();
      if (res.ok) {
        const note = data.releasedCents > 0 ? ` · ${t.refunded} ${formatUsd(data.releasedCents)}` : "";
        setToast(`${t[`action_${action}` as "action_pause" | "action_enable" | "action_close"]}${note}`);
        fetchData();
      } else {
        setToast(data.error || "Action failed");
      }
      setTimeout(() => setToast(""), 3000);
    } catch (e) {
      setToast(e instanceof Error ? e.message : "Action failed");
      setTimeout(() => setToast(""), 3000);
    }
    setActioning(false);
  }

  async function handleRename() {
    const newName = nameInput.trim();
    if (!newName || newName === campaign?.campaign_name) {
      setEditingName(false);
      return;
    }
    setRenaming(true);
    try {
      const res = await fetch(`/api/google-ads/campaigns/${campaignId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "rename", name: newName, orgId: activeOrg?.id }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setToast(t.renameDone || "Renamed");
        setEditingName(false);
        fetchData();
        setTimeout(() => setToast(""), 3000);
      } else {
        setToast(data.error || "Rename failed");
        setTimeout(() => setToast(""), 3000);
      }
    } catch (e) {
      setToast(e instanceof Error ? e.message : "Rename failed");
      setTimeout(() => setToast(""), 3000);
    }
    setRenaming(false);
  }

  async function handleCreateAdGroup() {
    if (!agName.trim() || Number(agCpcBid) <= 0) return;
    setAgSubmitting(true);
    setAgError("");
    try {
      const res = await fetch(`/api/google-ads/campaigns/${campaignId}/ad-groups`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: agName.trim(),
          cpcBidUsd: Number(agCpcBid),
          orgId: activeOrg?.id,
        }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setToast(t.adGroupCreated || "Ad group created");
        setShowAgForm(false);
        setAgName("");
        setAgCpcBid("1.00");
        fetchData();
        setTimeout(() => setToast(""), 3000);
      } else {
        setAgError(typeof data.details === "object" ? JSON.stringify(data.details, null, 2) : (data.error || "Failed"));
      }
    } catch (e) {
      setAgError(e instanceof Error ? e.message : "Failed");
    }
    setAgSubmitting(false);
  }

  function handleFillDemoAssetGroup() {
    setAssetName(DEMO_ASSET_GROUP_CONTENT.name);
    setAssetBusinessName(DEMO_ASSET_GROUP_CONTENT.businessName);
    setAssetFinalUrl(DEMO_ASSET_GROUP_CONTENT.finalUrl);
    setAssetHeadlines(DEMO_ASSET_GROUP_CONTENT.headlines);
    setAssetLongHeadlines(DEMO_ASSET_GROUP_CONTENT.longHeadlines);
    setAssetDescriptions(DEMO_ASSET_GROUP_CONTENT.descriptions);
    setAssetMarketingImageUrls(DEMO_ASSET_GROUP_CONTENT.marketingImageUrls);
    setAssetSquareImageUrls(DEMO_ASSET_GROUP_CONTENT.squareImageUrls);
    setAssetLogoUrl(DEMO_ASSET_GROUP_CONTENT.logoUrl);
    setAssetError("");
  }

  async function handleCreateAssetGroup() {
    // Split textareas into arrays (one item per line, trimmed, non-empty)
    const split = (s: string) => s.split("\n").map((x) => x.trim()).filter(Boolean);
    const headlines = split(assetHeadlines);
    const longHeadlines = split(assetLongHeadlines);
    const descriptions = split(assetDescriptions);
    const marketingImageUrls = split(assetMarketingImageUrls);
    const squareMarketingImageUrls = split(assetSquareImageUrls);

    // Light client-side check before hitting the server-side validator.
    if (!assetName.trim() || headlines.length < 3 || longHeadlines.length < 1 ||
        descriptions.length < 2 || !assetBusinessName.trim() ||
        !/^https?:\/\//i.test(assetFinalUrl) ||
        marketingImageUrls.length < 1 || squareMarketingImageUrls.length < 1) {
      setAssetError(
        t.assetGroupValidation ||
        "Need: name, ≥3 headlines, ≥1 long headline, ≥2 descriptions, business name, http(s) final URL, ≥1 marketing image, ≥1 square image."
      );
      return;
    }

    setAssetSubmitting(true);
    setAssetError("");
    try {
      const res = await fetch(`/api/google-ads/campaigns/${campaignId}/asset-groups`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: assetName.trim(),
          headlines,
          longHeadlines,
          descriptions,
          businessName: assetBusinessName.trim(),
          finalUrl: assetFinalUrl.trim(),
          marketingImageUrls,
          squareMarketingImageUrls,
          logoImageUrl: assetLogoUrl.trim() || undefined,
          orgId: activeOrg?.id,
        }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setToast(t.assetGroupCreated || "Asset group created");
        setShowAssetForm(false);
        setAssetName("");
        setAssetHeadlines("");
        setAssetLongHeadlines("");
        setAssetDescriptions("");
        setAssetBusinessName("");
        setAssetFinalUrl("");
        setAssetMarketingImageUrls("");
        setAssetSquareImageUrls("");
        setAssetLogoUrl("");
        fetchData();
        setTimeout(() => setToast(""), 3500);
        if (data.warnings) {
          alert(
            `${t.assetGroupCreatedWithWarnings || "Asset group created with warnings"}:\n\n` +
            JSON.stringify(data.warnings, null, 2)
          );
        }
      } else {
        setAssetError(
          Array.isArray(data.details)
            ? data.details.join("\n")
            : typeof data.details === "object"
              ? JSON.stringify(data.details, null, 2)
              : (data.error || "Failed")
        );
      }
    } catch (e) {
      setAssetError(e instanceof Error ? e.message : "Failed");
    }
    setAssetSubmitting(false);
  }

  async function handleCreateAd() {
    if (!adFormFor) return;
    const headlines = adHeadlines.split("\n").map((s) => s.trim()).filter(Boolean);
    const descriptions = adDescriptions.split("\n").map((s) => s.trim()).filter(Boolean);
    const finalUrl = adFinalUrl.trim();
    if (headlines.length < 3 || descriptions.length < 2 || !/^https?:\/\//i.test(finalUrl)) {
      setAdError(t.adValidation || "Need at least 3 headlines (one per line), 2 descriptions, and a valid URL.");
      return;
    }
    setAdSubmitting(true);
    setAdError("");
    try {
      const res = await fetch(`/api/google-ads/campaigns/${campaignId}/ads`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          adGroupResourceName: adFormFor,
          headlines, descriptions, finalUrl,
          orgId: activeOrg?.id,
        }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setToast(t.adCreated || "Ad created");
        setAdFormFor(null);
        setAdHeadlines("");
        setAdDescriptions("");
        setAdFinalUrl("");
        fetchData();
        setTimeout(() => setToast(""), 3000);
      } else {
        setAdError(typeof data.details === "object" ? JSON.stringify(data.details, null, 2) : (data.error || "Failed"));
      }
    } catch (e) {
      setAdError(e instanceof Error ? e.message : "Failed");
    }
    setAdSubmitting(false);
  }

  async function handleAddKeywords() {
    if (!kwFormFor) return;
    // Lines starting with [exact]/[phrase]/[broad] override the form match type for that line.
    const lines = kwText.split("\n").map((s) => s.trim()).filter(Boolean);
    if (lines.length === 0) {
      setKwError(t.kwValidation || "Enter at least 1 keyword (one per line)");
      return;
    }
    const keywords = lines.map((line) => {
      const m = line.match(/^\[(exact|phrase|broad)\]\s*(.+)$/i);
      if (m) return { text: m[2].trim(), matchType: m[1].toUpperCase() as "EXACT" | "PHRASE" | "BROAD" };
      return { text: line, matchType: kwMatchType };
    }).filter((k) => k.text.length > 0 && k.text.length <= 80);

    if (keywords.length === 0) {
      setKwError(t.kwValidation || "No valid keywords (each must be 1-80 chars)");
      return;
    }

    setKwSubmitting(true);
    setKwError("");
    try {
      const res = await fetch(`/api/google-ads/campaigns/${campaignId}/keywords`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ adGroupResourceName: kwFormFor, keywords, orgId: activeOrg?.id }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        const dupes = Array.isArray(data.duplicatesIgnored) ? data.duplicatesIgnored.length : 0;
        const errs = Array.isArray(data.errors) ? data.errors.length : 0;
        const parts: string[] = [`${data.created} ${t.kwCreated || "keywords created"}`];
        if (dupes > 0) parts.push(`${dupes} ${t.kwDuplicatesIgnored || "duplicates ignored"}`);
        if (errs > 0) parts.push(`${errs} ${t.kwErrored || "failed"}`);
        setToast(parts.join(" · "));
        setKwFormFor(null);
        setKwText("");
        fetchData();
        setTimeout(() => setToast(""), 4000);
      } else {
        setKwError(typeof data.errors === "object" ? JSON.stringify(data.errors, null, 2) : (data.error || "Failed"));
      }
    } catch (e) {
      setKwError(e instanceof Error ? e.message : "Failed");
    }
    setKwSubmitting(false);
  }

  // Bid strategy edit
  const [editingBid, setEditingBid] = useState(false);
  const [bidType, setBidType] = useState<BidStrategyOption>("MAXIMIZE_CONVERSIONS");
  const [bidTarget, setBidTarget] = useState("");
  const [savingBid, setSavingBid] = useState(false);

  function openBidEditor() {
    const st = detail?.bidding?.strategyType || "";
    if (detail?.bidding?.targetCpaMicros) {
      setBidType("TARGET_CPA");
      setBidTarget((detail.bidding.targetCpaMicros / 1_000_000).toFixed(2));
    } else if (detail?.bidding?.targetRoas) {
      setBidType("TARGET_ROAS");
      setBidTarget(String(detail.bidding.targetRoas));
    } else {
      const mapped: Record<string, BidStrategyOption> = {
        MANUAL_CPC: "MANUAL_CPC",
        TARGET_SPEND: "MAXIMIZE_CLICKS",
        MAXIMIZE_CONVERSIONS: "MAXIMIZE_CONVERSIONS",
        MAXIMIZE_CONVERSION_VALUE: "MAXIMIZE_CONVERSION_VALUE",
      };
      const options = bidOptionsForChannel(detail?.channelType || "");
      setBidType(mapped[st] || options[0]?.value || "MAXIMIZE_CONVERSIONS");
      setBidTarget("");
    }
    setEditingBid(true);
  }

  async function handleSaveBidStrategy() {
    const needsTarget = bidType === "TARGET_CPA" || bidType === "TARGET_ROAS";
    const target = Number(bidTarget);
    if (needsTarget && (!Number.isFinite(target) || target <= 0)) {
      setToast(t.bidTargetInvalid || "Enter a valid target > 0");
      setTimeout(() => setToast(""), 3000);
      return;
    }
    setSavingBid(true);
    try {
      const body: Record<string, unknown> = { type: bidType, orgId: activeOrg?.id };
      if (bidType === "TARGET_CPA") body.targetCpa = target;
      if (bidType === "TARGET_ROAS") body.targetRoas = target;
      const res = await fetch(`/api/google-ads/campaigns/${campaignId}/bid-strategy`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setToast(t.updated || "Updated");
        setEditingBid(false);
        fetchData();
        setTimeout(() => setToast(""), 4000);
      } else {
        setToast(typeof data.details === "string" ? data.details : (data.error || "Update failed"));
        setTimeout(() => setToast(""), 5000);
      }
    } catch (e) {
      setToast(e instanceof Error ? e.message : "Update failed");
      setTimeout(() => setToast(""), 3000);
    }
    setSavingBid(false);
  }

  // Negative keywords
  const [negKwFormOpen, setNegKwFormOpen] = useState(false);
  const [negKwText, setNegKwText] = useState("");
  const [negKwMatchType, setNegKwMatchType] = useState<"BROAD" | "PHRASE" | "EXACT">("BROAD");
  const [negKwSubmitting, setNegKwSubmitting] = useState(false);
  const [negKwError, setNegKwError] = useState("");
  const [removingNegKw, setRemovingNegKw] = useState<string | null>(null);

  async function handleAddNegativeKeywords() {
    const lines = negKwText.split("\n").map((s) => s.trim()).filter(Boolean);
    if (lines.length === 0) {
      setNegKwError(t.kwValidation || "Enter at least 1 keyword (one per line)");
      return;
    }
    const keywords = lines.map((line) => {
      const m = line.match(/^\[(exact|phrase|broad)\]\s*(.+)$/i);
      if (m) return { text: m[2].trim(), matchType: m[1].toUpperCase() as "EXACT" | "PHRASE" | "BROAD" };
      return { text: line, matchType: negKwMatchType };
    }).filter((k) => k.text.length > 0 && k.text.length <= 80);
    if (keywords.length === 0) {
      setNegKwError(t.kwValidation || "No valid keywords (each must be 1-80 chars)");
      return;
    }

    setNegKwSubmitting(true);
    setNegKwError("");
    try {
      const res = await fetch(`/api/google-ads/campaigns/${campaignId}/negative-keywords`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keywords, orgId: activeOrg?.id }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        const dupes = Array.isArray(data.duplicatesIgnored) ? data.duplicatesIgnored.length : 0;
        const errs = Array.isArray(data.errors) ? data.errors.length : 0;
        const parts: string[] = [`${data.created} ${t.negKwCreated || "negative keywords added"}`];
        if (dupes > 0) parts.push(`${dupes} ${t.kwDuplicatesIgnored || "duplicates ignored"}`);
        if (errs > 0) parts.push(`${errs} ${t.kwErrored || "failed"}`);
        setToast(parts.join(" · "));
        setNegKwFormOpen(false);
        setNegKwText("");
        fetchData();
        setTimeout(() => setToast(""), 4000);
      } else {
        setNegKwError(typeof data.errors === "object" ? JSON.stringify(data.errors, null, 2) : (data.error || "Failed"));
      }
    } catch (e) {
      setNegKwError(e instanceof Error ? e.message : "Failed");
    }
    setNegKwSubmitting(false);
  }

  async function handleRemoveNegativeKeyword(resourceName: string) {
    setRemovingNegKw(resourceName);
    try {
      const res = await fetch(`/api/google-ads/campaigns/${campaignId}/negative-keywords`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resourceName, orgId: activeOrg?.id }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setToast(t.negKwRemoved || "Negative keyword removed");
        fetchData();
        setTimeout(() => setToast(""), 3000);
      } else {
        setToast(data.error || "Remove failed");
        setTimeout(() => setToast(""), 4000);
      }
    } catch (e) {
      setToast(e instanceof Error ? e.message : "Remove failed");
      setTimeout(() => setToast(""), 3000);
    }
    setRemovingNegKw(null);
  }

  // Ad schedule / day parting
  const [editingSchedule, setEditingSchedule] = useState(false);
  const [scheduleRows, setScheduleRows] = useState<ScheduleRow[]>([]);
  const [savingSchedule, setSavingSchedule] = useState(false);
  const [scheduleError, setScheduleError] = useState("");

  function openScheduleEditor() {
    const existing = (detail?.adSchedules || []).map((s) => ({
      dayOfWeek: (SCHEDULE_DAYS.includes(s.dayOfWeek as ScheduleDay) ? s.dayOfWeek : "MONDAY") as ScheduleDay,
      startHour: s.startHour,
      endHour: s.endHour,
    }));
    setScheduleRows(existing);
    setScheduleError("");
    setEditingSchedule(true);
  }

  function applyBusinessHoursPreset() {
    setScheduleRows((["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY"] as ScheduleDay[]).map((d) => ({
      dayOfWeek: d, startHour: 9, endHour: 18,
    })));
  }

  async function handleSaveSchedule() {
    setSavingSchedule(true);
    setScheduleError("");
    try {
      const res = await fetch(`/api/google-ads/campaigns/${campaignId}/ad-schedule`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ schedules: scheduleRows, orgId: activeOrg?.id }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setToast(t.updated || "Updated");
        setEditingSchedule(false);
        fetchData();
        setTimeout(() => setToast(""), 4000);
      } else {
        setScheduleError(typeof data.details === "string" ? data.details : (data.error || "Update failed"));
      }
    } catch (e) {
      setScheduleError(e instanceof Error ? e.message : "Update failed");
    }
    setSavingSchedule(false);
  }

  // Sitelinks
  type SitelinkRow = { linkText: string; finalUrl: string; description1: string; description2: string };
  const emptySitelinkRow: SitelinkRow = { linkText: "", finalUrl: "", description1: "", description2: "" };
  const [sitelinkFormOpen, setSitelinkFormOpen] = useState(false);
  const [sitelinkRows, setSitelinkRows] = useState<SitelinkRow[]>([emptySitelinkRow, emptySitelinkRow]);
  const [sitelinkSubmitting, setSitelinkSubmitting] = useState(false);
  const [sitelinkError, setSitelinkError] = useState("");
  const [removingSitelink, setRemovingSitelink] = useState<string | null>(null);

  async function handleAddSitelinks() {
    const filled = sitelinkRows.filter((r) => r.linkText.trim() || r.finalUrl.trim());
    if (filled.length === 0) {
      setSitelinkError(t.slValidation || "Fill in at least one sitelink (text + URL)");
      return;
    }
    setSitelinkSubmitting(true);
    setSitelinkError("");
    try {
      const res = await fetch(`/api/google-ads/campaigns/${campaignId}/sitelinks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sitelinks: filled.map((r) => ({
            linkText: r.linkText.trim(),
            finalUrl: r.finalUrl.trim(),
            description1: r.description1.trim() || undefined,
            description2: r.description2.trim() || undefined,
          })),
          orgId: activeOrg?.id,
        }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setToast(`${data.created} ${t.slCreated || "sitelinks added"}`);
        setSitelinkFormOpen(false);
        setSitelinkRows([emptySitelinkRow, emptySitelinkRow]);
        fetchData();
        setTimeout(() => setToast(""), 4000);
      } else {
        setSitelinkError(typeof data.details === "object" ? JSON.stringify(data.details, null, 2) : (data.details || data.error || "Failed"));
      }
    } catch (e) {
      setSitelinkError(e instanceof Error ? e.message : "Failed");
    }
    setSitelinkSubmitting(false);
  }

  async function handleRemoveSitelink(resourceName: string) {
    setRemovingSitelink(resourceName);
    try {
      const res = await fetch(`/api/google-ads/campaigns/${campaignId}/sitelinks`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resourceName, orgId: activeOrg?.id }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setToast(t.slRemoved || "Sitelink removed");
        fetchData();
        setTimeout(() => setToast(""), 3000);
      } else {
        setToast(data.error || "Remove failed");
        setTimeout(() => setToast(""), 4000);
      }
    } catch (e) {
      setToast(e instanceof Error ? e.message : "Remove failed");
      setTimeout(() => setToast(""), 3000);
    }
    setRemovingSitelink(null);
  }

  // Search terms report
  type SearchTermStat = { term: string; status: string; impressions: number; clicks: number; costMicros: number; conversions: number };
  const [searchTerms, setSearchTerms] = useState<SearchTermStat[] | null>(null);
  const [termsLoading, setTermsLoading] = useState(false);
  const [termsError, setTermsError] = useState("");
  const [addingNegTerm, setAddingNegTerm] = useState<string | null>(null);

  async function handleLoadSearchTerms() {
    setTermsLoading(true);
    setTermsError("");
    try {
      const res = await fetch(`/api/google-ads/campaigns/${campaignId}/search-terms${activeOrg ? `?org_id=${activeOrg.id}` : ""}`);
      const data = await res.json();
      if (res.ok) setSearchTerms(data.terms || []);
      else setTermsError(data.error || "Failed to load");
    } catch (e) {
      setTermsError(e instanceof Error ? e.message : "Failed to load");
    }
    setTermsLoading(false);
  }

  async function handleAddTermAsNegative(term: string) {
    setAddingNegTerm(term);
    try {
      const res = await fetch(`/api/google-ads/campaigns/${campaignId}/negative-keywords`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keywords: [{ text: term, matchType: "EXACT" }], orgId: activeOrg?.id }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setToast(`"${term}" ${t.termNegAdded || "added as negative keyword"}`);
        fetchData();
        setTimeout(() => setToast(""), 4000);
      } else {
        setToast(data.error || "Failed");
        setTimeout(() => setToast(""), 4000);
      }
    } catch (e) {
      setToast(e instanceof Error ? e.message : "Failed");
      setTimeout(() => setToast(""), 3000);
    }
    setAddingNegTerm(null);
  }

  // Location bid adjustments
  type LocModRow = { geoId: string; name: string; percent: number };
  const [editingLocMods, setEditingLocMods] = useState(false);
  const [locModRows, setLocModRows] = useState<LocModRow[]>([]);
  const [savingLocMods, setSavingLocMods] = useState(false);
  const [locModError, setLocModError] = useState("");

  function campaignLevelLocations() {
    return (detail?.locations || []).filter((l) => l.bidModifier !== undefined);
  }

  function openLocModEditor() {
    setLocModRows(campaignLevelLocations().map((l) => ({
      geoId: l.id,
      name: l.name,
      percent: Math.round(((l.bidModifier ?? 1) - 1) * 100),
    })));
    setLocModError("");
    setEditingLocMods(true);
  }

  async function handleSaveLocMods() {
    setSavingLocMods(true);
    setLocModError("");
    try {
      const res = await fetch(`/api/google-ads/campaigns/${campaignId}/location-modifiers`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          modifiers: locModRows.map((r) => ({ geoId: r.geoId, percent: r.percent })),
          orgId: activeOrg?.id,
        }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setToast(t.updated || "Updated");
        setEditingLocMods(false);
        fetchData();
        setTimeout(() => setToast(""), 4000);
      } else {
        setLocModError(typeof data.details === "string" ? data.details : (data.error || "Update failed"));
      }
    } catch (e) {
      setLocModError(e instanceof Error ? e.message : "Update failed");
    }
    setSavingLocMods(false);
  }

  // AI generation for sitelinks + callouts (uses the owner project's website)
  const [genExtLoading, setGenExtLoading] = useState<"sitelinks" | "callouts" | null>(null);

  async function handleGenerateExtensions(target: "sitelinks" | "callouts") {
    const site = campaign?.project_website || "";
    if (!/^https?:\/\//i.test(site)) {
      setToast(t.extGenNoSite || "Assign an owner project with a website first");
      setTimeout(() => setToast(""), 4000);
      return;
    }
    setGenExtLoading(target);
    try {
      const res = await fetch("/api/google-ads/ad-copy/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: site, mode: "extensions", locale }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        if (target === "sitelinks" && Array.isArray(data.sitelinks) && data.sitelinks.length > 0) {
          setSitelinkRows(data.sitelinks.map((s: { linkText: string; finalUrl: string; description1?: string; description2?: string }) => ({
            linkText: s.linkText || "",
            finalUrl: s.finalUrl || "",
            description1: s.description1 || "",
            description2: s.description2 || "",
          })));
          setToast(`${data.sitelinks.length} ${t.extGenFilled || "suggestions filled in — review before adding"}`);
        } else if (target === "callouts" && Array.isArray(data.callouts) && data.callouts.length > 0) {
          setCalloutText(data.callouts.join("\n"));
          setToast(`${data.callouts.length} ${t.extGenFilled || "suggestions filled in — review before adding"}`);
        } else {
          setToast(t.extGenEmpty || "AI found nothing usable for this target");
        }
        setTimeout(() => setToast(""), 4000);
      } else {
        setToast(data.error || "Generation failed");
        setTimeout(() => setToast(""), 4000);
      }
    } catch (e) {
      setToast(e instanceof Error ? e.message : "Generation failed");
      setTimeout(() => setToast(""), 3000);
    }
    setGenExtLoading(null);
  }

  // Callouts + structured snippets
  const SNIPPET_HEADERS = ["Amenities", "Brands", "Courses", "Degree programs", "Destinations", "Featured hotels", "Insurance coverage", "Models", "Neighborhoods", "Service catalog", "Shows", "Styles", "Types"];
  const [extFormOpen, setExtFormOpen] = useState<"callout" | "snippet" | null>(null);
  const [calloutText, setCalloutText] = useState("");
  const [snippetHeader, setSnippetHeader] = useState("Service catalog");
  const [snippetValues, setSnippetValues] = useState("");
  const [extSubmitting, setExtSubmitting] = useState(false);
  const [extError, setExtError] = useState("");
  const [removingExt, setRemovingExt] = useState<string | null>(null);

  async function handleAddExtension() {
    if (!extFormOpen) return;
    setExtSubmitting(true);
    setExtError("");
    const body: Record<string, unknown> = { kind: extFormOpen, orgId: activeOrg?.id };
    if (extFormOpen === "callout") {
      const texts = calloutText.split("\n").map((s) => s.trim()).filter(Boolean);
      if (texts.length === 0) { setExtError(t.extCalloutValidation || "Enter at least 1 callout (one per line, ≤25 chars)"); setExtSubmitting(false); return; }
      body.texts = texts;
    } else {
      const values = snippetValues.split("\n").map((s) => s.trim()).filter(Boolean);
      if (values.length < 3) { setExtError(t.extSnippetValidation || "Enter at least 3 values (one per line, ≤25 chars)"); setExtSubmitting(false); return; }
      body.header = snippetHeader;
      body.values = values;
    }
    try {
      const res = await fetch(`/api/google-ads/campaigns/${campaignId}/extensions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setToast(t.updated || "Updated");
        setExtFormOpen(null);
        setCalloutText("");
        setSnippetValues("");
        fetchData();
        setTimeout(() => setToast(""), 4000);
      } else {
        setExtError(typeof data.details === "string" ? data.details : JSON.stringify(data.details || data.error || "Failed", null, 2));
      }
    } catch (e) {
      setExtError(e instanceof Error ? e.message : "Failed");
    }
    setExtSubmitting(false);
  }

  async function handleRemoveExtension(resourceName: string) {
    setRemovingExt(resourceName);
    try {
      const res = await fetch(`/api/google-ads/campaigns/${campaignId}/extensions`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resourceName, orgId: activeOrg?.id }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setToast(t.updated || "Updated");
        fetchData();
        setTimeout(() => setToast(""), 3000);
      } else {
        setToast(data.error || "Remove failed");
        setTimeout(() => setToast(""), 4000);
      }
    } catch (e) {
      setToast(e instanceof Error ? e.message : "Remove failed");
      setTimeout(() => setToast(""), 3000);
    }
    setRemovingExt(null);
  }

  // Device bid adjustments
  const [editingDevices, setEditingDevices] = useState(false);
  const [deviceRows, setDeviceRows] = useState<DeviceModRow[]>([]);
  const [savingDevices, setSavingDevices] = useState(false);
  const [deviceError, setDeviceError] = useState("");

  function openDeviceEditor() {
    setDeviceRows(deviceRowsFromDetail(detail?.deviceModifiers));
    setDeviceError("");
    setEditingDevices(true);
  }

  async function handleSaveDevices() {
    setSavingDevices(true);
    setDeviceError("");
    const modifiers = deviceRows
      .filter((r) => r.mode !== "default")
      .map((r) => ({
        device: r.device,
        percent: r.mode === "adjust" ? r.percent : 0,
        exclude: r.mode === "exclude",
      }));
    try {
      const res = await fetch(`/api/google-ads/campaigns/${campaignId}/device-modifiers`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ modifiers, orgId: activeOrg?.id }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setToast(t.updated || "Updated");
        setEditingDevices(false);
        fetchData();
        setTimeout(() => setToast(""), 4000);
      } else {
        setDeviceError(typeof data.details === "string" ? data.details : (data.error || "Update failed"));
      }
    } catch (e) {
      setDeviceError(e instanceof Error ? e.message : "Update failed");
    }
    setSavingDevices(false);
  }

  // AI optimization recommendations (PR #2 follow-up)
  type Rec = { category: string; priority: string; title: string; rationale: string; action: string; metric?: string };
  const [recs, setRecs] = useState<Rec[] | null>(null);
  const [recsLoading, setRecsLoading] = useState(false);
  const [recsError, setRecsError] = useState("");
  const [recsGeneratedAt, setRecsGeneratedAt] = useState<string | null>(null);

  async function handleGenerateRecommendations() {
    setRecsLoading(true);
    setRecsError("");
    try {
      const res = await fetch(`/api/google-ads/campaigns/${campaignId}/recommendations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orgId: activeOrg?.id, locale }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setRecs(data.recommendations || []);
        setRecsGeneratedAt(data.generatedAt || null);
      } else {
        setRecsError(data.error || "Failed to generate recommendations");
      }
    } catch (e) {
      setRecsError(e instanceof Error ? e.message : "Failed to generate recommendations");
    }
    setRecsLoading(false);
  }

  async function handleGenerateCopy(channel: "DISPLAY" | "SEARCH" | "VIDEO", url: string) {
    if (!/^https?:\/\//i.test(url.trim())) {
      setAdError(t.adCopyNeedsUrl || "Enter a valid http(s) Final URL first");
      return;
    }
    setGenCopyLoading(true);
    setAdError("");
    try {
      const res = await fetch("/api/google-ads/ad-copy/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: url.trim(), channel, locale }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setAdError(data.error || "Failed to generate copy");
        setGenCopyLoading(false);
        return;
      }
      const headlines: string[] = Array.isArray(data.headlines) ? data.headlines : [];
      const longHeadline: string = data.longHeadline || "";
      const descriptions: string[] = Array.isArray(data.descriptions) ? data.descriptions : [];
      const businessName: string = data.businessName || "";

      if (channel === "DISPLAY") {
        setDHeadlines(headlines.join("\n"));
        setDLongHeadline(longHeadline.slice(0, 90));
        setDDescriptions(descriptions.join("\n"));
        setDBusinessName(businessName.slice(0, 25));
      } else if (channel === "SEARCH") {
        setAdHeadlines(headlines.join("\n"));
        setAdDescriptions(descriptions.join("\n"));
        // If the AI suggested keywords too, open the keyword form for the same ad group
        // and pre-fill the textarea (user can edit before submit).
        const generatedKeywords: Array<{ text: string; matchType: string }> = Array.isArray(data.keywords) ? data.keywords : [];
        if (generatedKeywords.length > 0 && adFormFor) {
          setKwFormFor(adFormFor);
          setKwText(generatedKeywords.map((k) => `[${(k.matchType || "BROAD").toLowerCase()}] ${k.text}`).join("\n"));
        }
      } else if (channel === "VIDEO") {
        // Video short headlines are ≤15 chars; clip just in case the AI overshot
        setVShortHeadlines(headlines.map((h) => h.slice(0, 15)).join("\n"));
        setVLongHeadline(longHeadline.slice(0, 90));
        setVDescriptions(descriptions.join("\n"));
      }

      const warnings: string[] = Array.isArray(data.warnings) ? data.warnings : [];
      if (warnings.length > 0) {
        setToast(`${t.adCopyGenerated || "Copy generated"} — ${warnings.join("; ")}`);
      } else {
        setToast(t.adCopyGenerated || "Copy generated from landing page");
      }
      setTimeout(() => setToast(""), 4000);
    } catch (e) {
      setAdError(e instanceof Error ? e.message : "Failed to generate copy");
    }
    setGenCopyLoading(false);
  }

  async function handleCreateDisplayAd() {
    if (!adFormFor) return;
    const marketingImageUrls = dMarketingImages.split("\n").map((s) => s.trim()).filter(Boolean);
    const squareMarketingImageUrls = dSquareImages.split("\n").map((s) => s.trim()).filter(Boolean);
    const headlines = dHeadlines.split("\n").map((s) => s.trim()).filter(Boolean);
    const descriptions = dDescriptions.split("\n").map((s) => s.trim()).filter(Boolean);
    const finalUrl = dFinalUrl.trim();
    const businessName = dBusinessName.trim();
    const longHeadline = dLongHeadline.trim();
    const logoImageUrl = dLogoUrl.trim();

    if (
      marketingImageUrls.length === 0 ||
      squareMarketingImageUrls.length === 0 ||
      headlines.length === 0 ||
      !longHeadline ||
      descriptions.length === 0 ||
      !businessName ||
      !/^https?:\/\//i.test(finalUrl)
    ) {
      setAdError(t.displayAdValidation || "Need ≥1 landscape image URL, ≥1 square image URL, ≥1 headline, long headline, ≥1 description, business name, and a valid http(s) URL");
      return;
    }
    setAdSubmitting(true);
    setAdError("");
    try {
      const res = await fetch(`/api/google-ads/campaigns/${campaignId}/display-ads`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          adGroupResourceName: adFormFor,
          marketingImageUrls,
          squareMarketingImageUrls,
          logoImageUrl: logoImageUrl || undefined,
          headlines,
          longHeadline,
          descriptions,
          businessName,
          finalUrl,
          orgId: activeOrg?.id,
        }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setToast(t.displayAdCreated || "Display ad created");
        setAdFormFor(null);
        setDMarketingImages(""); setDSquareImages(""); setDLogoUrl("");
        setDHeadlines(""); setDLongHeadline(""); setDDescriptions("");
        setDBusinessName(""); setDFinalUrl("");
        fetchData();
        setTimeout(() => setToast(""), 3000);
      } else {
        setAdError(typeof data.details === "object" ? JSON.stringify(data.details, null, 2) : (data.error || "Failed"));
      }
    } catch (e) {
      setAdError(e instanceof Error ? e.message : "Failed");
    }
    setAdSubmitting(false);
  }

  async function handleCreateVideoAd() {
    if (!adFormFor) return;
    const headlines = vShortHeadlines.split("\n").map((s) => s.trim()).filter(Boolean);
    const descriptions = vDescriptions.split("\n").map((s) => s.trim()).filter(Boolean);
    if (!vYoutubeUrl.trim() || !vLongHeadline.trim() || descriptions.length < 1 || !/^https?:\/\//i.test(vFinalUrl.trim())) {
      setAdError(t.videoAdValidation || "Need YouTube URL, long headline, at least 1 description, and a valid http(s) URL");
      return;
    }
    setAdSubmitting(true);
    setAdError("");
    try {
      const res = await fetch(`/api/google-ads/campaigns/${campaignId}/video-ads`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          adGroupResourceName: adFormFor,
          youtubeUrl: vYoutubeUrl.trim(),
          headlines,
          longHeadline: vLongHeadline.trim(),
          descriptions,
          callToAction: vCta,
          finalUrl: vFinalUrl.trim(),
          orgId: activeOrg?.id,
        }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setToast(t.videoAdCreated || "Video ad created");
        setAdFormFor(null);
        setVYoutubeUrl(""); setVShortHeadlines(""); setVLongHeadline(""); setVDescriptions(""); setVFinalUrl("");
        fetchData();
        setTimeout(() => setToast(""), 3000);
      } else {
        setAdError(typeof data.details === "object" ? JSON.stringify(data.details, null, 2) : (data.error || "Failed"));
      }
    } catch (e) {
      setAdError(e instanceof Error ? e.message : "Failed");
    }
    setAdSubmitting(false);
  }

  if (!user) return null;

  if (loading) {
    return (
      <DashboardShell user={user} plan={undefined}>
        <div className="p-8 text-center text-gray-400">{t.loading}</div>
      </DashboardShell>
    );
  }

  if (!campaign) {
    return (
      <DashboardShell user={user} plan={undefined}>
        <div className="p-8 max-w-3xl mx-auto">
          <p className="text-gray-500 mb-3">{detailError || t.notFound || "Not found"}</p>
          <button onClick={() => router.push(`/${locale}/dashboard/google-ads`)} className="text-sm text-red-700 hover:underline cursor-pointer">
            ← {t.backToCampaigns || "Back to campaigns"}
          </button>
        </div>
      </DashboardShell>
    );
  }

  // closed campaigns and read-only (sandbox/viewer) accounts get a view-only page
  const canEdit = !campaign.closed && !isReadOnly;

  const cap = Number(campaign.total_budget_cents || 0);
  const spent = Number(campaign.spent_cents || 0);
  const pct = cap > 0 ? Math.min(100, (spent / cap) * 100) : 0;
  const m = detail?.metrics;

  return (
    <DashboardShell user={user} plan={undefined}>
      <div className="p-4 sm:p-6 max-w-5xl mx-auto space-y-5">
        <Link href={`/${locale}/dashboard/google-ads`} className="text-sm text-gray-500 hover:text-gray-700">
          ← {t.backToCampaigns || "Back to campaigns"}
        </Link>

        {toast && (
          <div className="fixed top-4 right-4 z-50 bg-green-600 text-white px-4 py-2 rounded-lg shadow-lg text-sm">{toast}</div>
        )}

        {/* Header */}
        <div className="bg-white rounded-xl border border-gray-200 p-5 sm:p-6">
          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
            <div className="flex-1 min-w-0">
              {editingName && canEdit ? (
                <div className="flex items-center gap-2">
                  <input
                    autoFocus
                    value={nameInput}
                    onChange={(e) => setNameInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleRename();
                      if (e.key === "Escape") setEditingName(false);
                    }}
                    className="text-2xl font-bold text-gray-900 px-2 py-1 border-2 border-red-500 rounded outline-none w-full"
                    maxLength={255}
                  />
                  <button
                    onClick={handleRename}
                    disabled={renaming || !nameInput.trim()}
                    className="text-xs px-3 py-1.5 bg-red-800 text-white rounded hover:bg-red-900 disabled:opacity-50 cursor-pointer"
                  >
                    {renaming ? (t.creating || "Saving...") : (t.save || "Save")}
                  </button>
                  <button
                    onClick={() => setEditingName(false)}
                    className="text-xs px-3 py-1.5 border border-gray-300 rounded hover:bg-gray-50 cursor-pointer"
                  >
                    {t.cancel || "Cancel"}
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-2 group">
                  <h1 className="text-2xl font-bold text-gray-900">{campaign.campaign_name}</h1>
                  {canEdit && (
                    <button
                      onClick={() => { setNameInput(campaign.campaign_name); setEditingName(true); }}
                      className="text-xs text-gray-400 hover:text-gray-700 opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
                      title={t.renameTooltip || "Rename"}
                    >
                      ✏️ {t.rename || "Rename"}
                    </button>
                  )}
                </div>
              )}
              <div className="flex flex-wrap gap-2 mt-2 text-xs">
                {campaign.project_name && (
                  <span className="px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700 border border-indigo-200" title={campaign.project_website ? `Owner project — ${campaign.project_website}` : "Owner project"}>
                    {t.ownerProject || "Owner"}: {campaign.project_name}
                  </span>
                )}
                <span
                  className="px-2 py-0.5 rounded-full bg-gray-50 text-gray-500 font-mono border border-gray-200 cursor-pointer hover:bg-gray-100"
                  title={`${campaign.platform_campaign_id}\nClick to copy`}
                  onClick={() => {
                    if (campaign.platform_campaign_id) {
                      navigator.clipboard.writeText(campaign.platform_campaign_id.split("/").pop() || campaign.platform_campaign_id);
                    }
                  }}
                >
                  ID: {campaign.platform_campaign_id?.split("/").pop() || campaign.platform_campaign_id}
                </span>
                <span className="px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">{campaign.channel}</span>
                <span className={`px-2 py-0.5 rounded-full ${
                  campaign.closed ? "bg-gray-200 text-gray-600" :
                  campaign.status === "PAUSED" ? "bg-yellow-50 text-yellow-700" :
                  campaign.status === "ENABLED" ? "bg-green-50 text-green-700" :
                  "bg-gray-100 text-gray-600"
                }`}>{campaign.closed ? (t.statusClosed || "CLOSED") : campaign.status}</span>
                {editingField === "schedule" ? (
                  <div className="flex items-center gap-1">
                    <input type="date" value={fieldInputA} onChange={(e) => setFieldInputA(e.target.value)} className="text-xs px-1 py-0.5 border border-red-500 rounded outline-none" />
                    <span>→</span>
                    <input type="date" value={fieldInputB} onChange={(e) => setFieldInputB(e.target.value)} className="text-xs px-1 py-0.5 border border-red-500 rounded outline-none" />
                    <button onClick={handleSaveField} disabled={savingField} className="text-xs px-2 py-0.5 bg-red-800 text-white rounded hover:bg-red-900 cursor-pointer">{savingField ? "..." : (t.save || "Save")}</button>
                    <button onClick={() => setEditingField(null)} className="text-xs px-1 text-gray-400 cursor-pointer">×</button>
                  </div>
                ) : (
                  detail?.startDate && (
                    <span className="text-gray-500 inline-flex items-center gap-1">
                      📅 {detail.startDate}{detail.endDate && detail.endDate !== "9999-12-31" ? ` → ${detail.endDate}` : ` → ${t.noEndDate || "no end"}`}
                      {canEdit && (
                        <button
                          onClick={() => { setFieldInputA(detail.startDate || ""); setFieldInputB(detail.endDate && detail.endDate !== "9999-12-31" ? detail.endDate : ""); setEditingField("schedule"); }}
                          className="text-gray-400 hover:text-gray-700 cursor-pointer"
                        >✏️</button>
                      )}
                    </span>
                  )
                )}
                {editingBid ? (
                  <div className="flex items-center gap-1 flex-wrap">
                    <select
                      value={bidType}
                      onChange={(e) => { setBidType(e.target.value as BidStrategyOption); setBidTarget(""); }}
                      className="text-xs px-1 py-0.5 border border-red-500 rounded outline-none bg-white"
                    >
                      {bidOptionsForChannel(detail?.channelType || "").map((o) => (
                        <option key={o.value} value={o.value}>{o.label}</option>
                      ))}
                    </select>
                    {(bidType === "TARGET_CPA" || bidType === "TARGET_ROAS") && (
                      <input
                        type="number"
                        min="0"
                        step={bidType === "TARGET_CPA" ? "0.01" : "0.1"}
                        value={bidTarget}
                        onChange={(e) => setBidTarget(e.target.value)}
                        placeholder={bidType === "TARGET_CPA" ? (t.bidTargetCpaPlaceholder || "CPA $") : (t.bidTargetRoasPlaceholder || "ROAS, 4 = 400%")}
                        className="text-xs px-1 py-0.5 border border-red-500 rounded outline-none w-28"
                      />
                    )}
                    <button onClick={handleSaveBidStrategy} disabled={savingBid} className="text-xs px-2 py-0.5 bg-red-800 text-white rounded hover:bg-red-900 cursor-pointer">{savingBid ? "..." : (t.save || "Save")}</button>
                    <button onClick={() => setEditingBid(false)} className="text-xs px-1 text-gray-400 cursor-pointer">×</button>
                  </div>
                ) : (
                  detail?.bidding?.strategyType && (
                    <span className="px-2 py-0.5 rounded-full bg-sky-50 text-sky-700 border border-sky-200 inline-flex items-center gap-1" title={t.bidStrategyLabel || "Bid strategy"}>
                      🎯 {describeBidding(detail.bidding)}
                      {canEdit && (
                        <button onClick={openBidEditor} className="text-sky-400 hover:text-sky-700 cursor-pointer">✏️</button>
                      )}
                    </span>
                  )
                )}
              </div>
            </div>
            <div className="flex items-center gap-2">
              {canEdit && (
                <>
                  {campaign.status === "PAUSED" ? (
                    <button onClick={() => handleAction("enable")} disabled={actioning} className="text-xs px-3 py-1.5 border border-green-200 text-green-700 rounded-lg hover:bg-green-50 disabled:opacity-50 cursor-pointer">{t.action_enable || "Enable"}</button>
                  ) : (
                    <button onClick={() => handleAction("pause")} disabled={actioning} className="text-xs px-3 py-1.5 border border-amber-200 text-amber-700 rounded-lg hover:bg-amber-50 disabled:opacity-50 cursor-pointer">{t.action_pause || "Pause"}</button>
                  )}
                  <button onClick={() => handleAction("close")} disabled={actioning} className="text-xs px-3 py-1.5 border border-red-200 text-red-700 rounded-lg hover:bg-red-50 disabled:opacity-50 cursor-pointer">{t.action_close || "Close"}</button>
                </>
              )}
              {googleAdsUrl && (
                <a
                  href={googleAdsUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs px-3 py-1.5 border border-gray-200 rounded-lg hover:bg-gray-50 cursor-pointer text-gray-600"
                >
                  {t.openInGoogleAds || "Open in Google Ads ↗"}
                </a>
              )}
            </div>
          </div>
        </div>

        {/* Performance metrics (last 30 days) */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-sm font-semibold text-gray-700">{t.metricsTitle || "Performance (last 30 days)"}</h2>
            {(detail?.dailyMetrics?.length || 0) > 0 && (
              <button
                onClick={() => {
                  const csv = toCsv(
                    ["Date", "Impressions", "Clicks", "Cost (USD)", "Conversions"],
                    (detail?.dailyMetrics || []).map((d) => [
                      d.date,
                      d.impressions,
                      d.clicks,
                      (d.costMicros / 1_000_000).toFixed(2),
                      d.conversions,
                    ])
                  );
                  const slug = (campaign.campaign_name || `campaign-${campaignId}`).replace(/[^\w一-鿿-]+/g, "-").slice(0, 40);
                  downloadCsv(`${slug}-daily-30d-${new Date().toISOString().slice(0, 10)}`, csv);
                }}
                className="text-xs px-3 py-1.5 border border-gray-200 rounded-lg hover:bg-gray-50 cursor-pointer"
              >
                ⬇ {t.exportCsv || "Export CSV"}
              </button>
            )}
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3 mb-3">
            <Stat label={t.metricImpressions || "Impressions"} value={m ? m.impressions.toLocaleString() : "—"} />
            <Stat label={t.metricClicks || "Clicks"} value={m ? m.clicks.toLocaleString() : "—"} />
            <Stat label={t.metricCtr || "CTR"} value={m ? `${(m.ctr * 100).toFixed(2)}%` : "—"} />
            <Stat label={t.metricConversions || "Conversions"} value={m ? m.conversions.toFixed(1) : "—"} />
            <Stat label={t.metricCost || "Cost"} value={m ? `$${fromMicros(m.costMicros).toFixed(2)}` : "—"} />
            <Stat label={t.metricAvgCpc || "Avg CPC"} value={m ? `$${fromMicros(m.avgCpcMicros).toFixed(2)}` : "—"} />
          </div>
          <DailyChart data={detail?.dailyMetrics || []} t={t} />
          {detailError && (
            <p className="text-xs text-amber-600 mt-2">⚠️ {t.detailError || "Could not load live metrics"}: {detailError}</p>
          )}
        </div>

        {/* Budget */}
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h2 className="text-sm font-semibold text-gray-700 mb-3">{t.budgetSection || "Budget"}</h2>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div>
              <div className="text-xs text-gray-500 mb-0.5 flex items-center gap-1">
                {t.dailyBudget}
                {canEdit && editingField !== "dailyBudget" && (
                  <button
                    onClick={() => { setFieldInputA(String(Number(campaign.daily_budget))); setEditingField("dailyBudget"); }}
                    className="text-gray-400 hover:text-gray-700 cursor-pointer"
                  >✏️</button>
                )}
              </div>
              {editingField === "dailyBudget" ? (
                <div className="flex items-center gap-1">
                  <span className="text-sm">$</span>
                  <input
                    type="number" min="1" step="1" autoFocus
                    value={fieldInputA}
                    onChange={(e) => setFieldInputA(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") handleSaveField(); if (e.key === "Escape") setEditingField(null); }}
                    className="w-20 px-2 py-1 border border-red-500 rounded text-base font-semibold outline-none"
                  />
                  <button onClick={handleSaveField} disabled={savingField} className="text-xs px-2 py-1 bg-red-800 text-white rounded hover:bg-red-900 cursor-pointer">{savingField ? "..." : (t.save || "Save")}</button>
                  <button onClick={() => setEditingField(null)} className="text-xs px-1 text-gray-400 cursor-pointer">×</button>
                </div>
              ) : (
                <div className="text-base font-semibold text-gray-900">${Number(campaign.daily_budget).toFixed(2)}</div>
              )}
              {(() => {
                const remainingCapCents = Math.max(cap - spent, 0);
                if (cap === 0 || remainingCapCents === 0) return null;
                const today = new Date();
                today.setHours(0, 0, 0, 0);
                const endDate = detail?.endDate ? new Date(detail.endDate) : new Date(today.getTime() + 30 * 86_400_000);
                const remainingDays = Math.max(Math.ceil((endDate.getTime() - today.getTime()) / 86_400_000), 1);
                const impliedDaily = remainingCapCents / 100 / remainingDays;
                const exceeds = Number(campaign.daily_budget) > impliedDaily;
                return (
                  <div className={`text-xs mt-1 ${exceeds ? "text-amber-600" : "text-gray-400"}`} title={t.dailyCapTooltip || `Implied daily cap = remaining cap ($${(remainingCapCents/100).toFixed(2)}) / remaining days (${remainingDays})`}>
                    {exceeds ? "⚠️ " : ""}
                    {t.dailyCapImplied || "Cap implies"} ≤${impliedDaily.toFixed(2)}/day · {remainingDays}d {t.daysRemaining || "left"}
                  </div>
                );
              })()}
            </div>
            <div>
              <div className="text-xs text-gray-500 mb-0.5 flex items-center gap-1">
                {t.totalBudget || "Cap"}
                {canEdit && editingField !== "totalBudget" && (
                  <button
                    onClick={() => { setFieldInputA(String((Number(campaign.total_budget_cents) || 0) / 100)); setEditingField("totalBudget"); }}
                    className="text-gray-400 hover:text-gray-700 cursor-pointer"
                  >✏️</button>
                )}
              </div>
              {editingField === "totalBudget" ? (
                <div className="flex items-center gap-1">
                  <span className="text-sm">$</span>
                  <input
                    type="number" min="1" step="1" autoFocus
                    value={fieldInputA}
                    onChange={(e) => setFieldInputA(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") handleSaveField(); if (e.key === "Escape") setEditingField(null); }}
                    className="w-20 px-2 py-1 border border-red-500 rounded text-base font-semibold outline-none"
                  />
                  <button onClick={handleSaveField} disabled={savingField} className="text-xs px-2 py-1 bg-red-800 text-white rounded hover:bg-red-900 cursor-pointer">{savingField ? "..." : (t.save || "Save")}</button>
                  <button onClick={() => setEditingField(null)} className="text-xs px-1 text-gray-400 cursor-pointer">×</button>
                </div>
              ) : (
                <div className="text-base font-semibold text-gray-900">{formatUsd(campaign.total_budget_cents)}</div>
              )}
            </div>
            <Stat label={t.spent || "Spent (incl. fees)"} value={formatUsd(applyPlatformMarkup(Number(campaign.spent_cents || 0), activeOrg?.plan ?? null))} />
            <Stat label={t.reserved || "Reserved (incl. fees)"} value={formatUsd(applyPlatformMarkup(Number(campaign.reserved_cents || 0), activeOrg?.plan ?? null))} />
          </div>
          {cap > 0 && (() => {
            const orgPlan = activeOrg?.plan ?? null;
            const platformFeeWaived = isPaidPlan(orgPlan);
            const capPlatform = applyPlatformMarkup(cap, orgPlan);
            const gatewaySpent = paymentGatewayFee(spent);
            const platformSpent = platformFee(spent, orgPlan);
            const adPctOfBar = Math.min(100, (spent / capPlatform) * 100);
            const gatewayPctOfBar = Math.min(100 - adPctOfBar, (gatewaySpent / capPlatform) * 100);
            const platformPctOfBar = Math.min(100 - adPctOfBar - gatewayPctOfBar, (platformSpent / capPlatform) * 100);
            const adColor = pct >= 100 ? "bg-red-500" : pct >= 80 ? "bg-amber-500" : "bg-emerald-500";
            const gatewayColor = pct >= 100 ? "bg-red-300" : pct >= 80 ? "bg-amber-300" : "bg-emerald-300";
            const platformColor = "bg-slate-400";
            return (
              <div className="mt-3">
                <div className="w-full h-2 bg-gray-100 rounded-full overflow-hidden flex">
                  <div className={`h-full ${adColor}`} style={{ width: `${adPctOfBar}%` }} title={`Ad spend: ${formatUsd(spent)}`} />
                  <div className={`h-full ${gatewayColor}`} style={{ width: `${gatewayPctOfBar}%` }} title={`Payment gateway fee (2.9%): ${formatUsd(gatewaySpent)}`} />
                  {!platformFeeWaived && (
                    <div className={`h-full ${platformColor}`} style={{ width: `${platformPctOfBar}%` }} title={`Platform fee (5%): ${formatUsd(platformSpent)}`} />
                  )}
                </div>
                <div className="flex items-center flex-wrap gap-x-3 gap-y-1 text-xs text-gray-500 mt-1.5">
                  <span>{pct.toFixed(1)}% {t.ofCapUsed || "of cap used"}</span>
                  <span className="flex items-center gap-1.5">
                    <span className={`inline-block w-2 h-2 rounded-sm ${adColor}`} /> {t.legendAdSpend || "Ad spend"} {formatUsd(spent)}
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className={`inline-block w-2 h-2 rounded-sm ${gatewayColor}`} /> {t.legendPaymentGatewayFee || "Payment gateway fee (2.9%)"} {formatUsd(gatewaySpent)}
                  </span>
                  {platformFeeWaived ? (
                    <span className="text-emerald-700 font-medium">{t.platformFeeWaived || "Platform fee waived (subscription plan)"}</span>
                  ) : (
                    <span className="flex items-center gap-1.5">
                      <span className={`inline-block w-2 h-2 rounded-sm ${platformColor}`} /> {t.legendPlatformFee || "Platform fee (5%)"} {formatUsd(platformSpent)}
                    </span>
                  )}
                </div>
              </div>
            );
          })()}
        </div>

        {/* AI optimization recommendations */}
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-gray-700">✨ {t.recsSection || "AI Optimization Recommendations"}</h2>
            {!isReadOnly && (
              <button
                onClick={handleGenerateRecommendations}
                disabled={recsLoading}
                className="text-xs px-3 py-1.5 border border-purple-200 text-purple-700 rounded-lg hover:bg-purple-50 disabled:opacity-50 cursor-pointer"
              >
                {recsLoading
                  ? (t.recsGenerating || "Analyzing…")
                  : recs
                    ? (t.recsRegenerate || "Regenerate")
                    : (t.recsGenerate || "Generate")}
              </button>
            )}
          </div>
          {!recs && !recsLoading && !recsError && (
            <p className="text-xs text-gray-400">{t.recsEmptyHint || "Analyzes this campaign's 30-day performance and suggests ranked, concrete optimizations."}</p>
          )}
          {recsError && <pre className="text-xs text-red-600 bg-red-50 p-2 rounded whitespace-pre-wrap break-all">{recsError}</pre>}
          {recs && recs.length > 0 && (
            <div className="space-y-3">
              {recs.map((r, i) => (
                <div key={i} className="border border-gray-100 rounded-lg p-3">
                  <div className="flex flex-wrap items-center gap-2 mb-1">
                    <span className={`px-1.5 py-0.5 text-xs rounded-full font-medium ${
                      r.priority === "HIGH" ? "bg-red-50 text-red-700" :
                      r.priority === "MEDIUM" ? "bg-amber-50 text-amber-700" :
                      "bg-gray-100 text-gray-600"
                    }`}>{r.priority}</span>
                    <span className="px-1.5 py-0.5 bg-purple-50 text-purple-700 text-xs rounded-full">{r.category}</span>
                    {r.metric && <span className="px-1.5 py-0.5 bg-blue-50 text-blue-700 text-xs rounded-full">→ {r.metric}</span>}
                    <span className="font-medium text-gray-800 text-sm">{r.title}</span>
                  </div>
                  <p className="text-xs text-gray-600 mb-1">{r.rationale}</p>
                  <p className="text-xs text-gray-800">▸ <span className="font-medium">{t.recsAction || "Action"}:</span> {r.action}</p>
                </div>
              ))}
              {recsGeneratedAt && (
                <p className="text-[11px] text-gray-400">{t.recsGeneratedAt || "Generated"}: {new Date(recsGeneratedAt).toLocaleString()}</p>
              )}
            </div>
          )}
        </div>

        {/* Targeting */}
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-gray-700">{t.targetingSection || "Targeting"}</h2>
            {canEdit && !editingLocations && (
              <button
                onClick={openLocationEdit}
                className="text-xs text-gray-400 hover:text-gray-700 cursor-pointer"
                title={t.editLocations || "Edit locations"}
              >
                ✏️ {t.editLocations || "Edit"}
              </button>
            )}
          </div>

          {!editingLocations ? (
            <div className="space-y-3">
              <div className="text-sm">
                <span className="text-xs text-gray-500">{t.locations || "Locations"}: </span>
                {detail?.locations?.length ? (
                  <div className="inline-flex flex-wrap gap-1.5 mt-1">
                    {detail.locations.map((l) => (
                      <span key={l.id} className="px-2 py-0.5 bg-blue-50 text-blue-700 text-xs rounded-full">{l.name}</span>
                    ))}
                  </div>
                ) : (
                  <span className="text-amber-700">⚠️ {t.locationsWorldwide || "Worldwide (no targeting set — may waste budget)"}</span>
                )}
              </div>

              {/* Audiences */}
              <div className="text-sm pt-2 border-t border-gray-100">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-gray-500">{t.audiences || "Audiences"}:</span>
                  {canEdit && !editingAudiences && (
                    <button
                      onClick={openAudienceEdit}
                      className="text-xs text-gray-400 hover:text-gray-700 cursor-pointer"
                      title="Edit demographic audiences"
                    >
                      ✏️ Edit
                    </button>
                  )}
                </div>
                {!editingAudiences ? (
                  detail?.audiences?.length ? (
                    <div className="space-y-1.5 mt-1">
                      {Object.entries(
                        detail.audiences.reduce<Record<string, typeof detail.audiences>>((acc, a) => {
                          (acc[a.category] = acc[a.category] || []).push(a);
                          return acc;
                        }, {})
                      ).map(([cat, items]) => {
                        const dedup = Array.from(new Map(items.map((a) => [`${a.apiType}|${a.value}|${a.negative}`, a])).values());
                        return (
                          <div key={cat}>
                            <span className="text-xs text-gray-400">{cat}:</span>
                            <span className="inline-flex flex-wrap gap-1 ml-1.5">
                              {dedup.map((a, i) => (
                                <span
                                  key={i}
                                  className={`px-2 py-0.5 text-xs rounded-full ${
                                    a.negative ? "bg-red-50 text-red-700 line-through" : "bg-purple-50 text-purple-700"
                                  }`}
                                  title={a.adGroupName ? `Ad group: ${a.adGroupName}` : undefined}
                                >
                                  {a.label}
                                </span>
                              ))}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <span className="text-amber-700">⚠️ {t.audiencesEmpty || "No audience signals set — recommended for Demand Gen / Display / Video"}</span>
                  )
                ) : (
                  <div className="space-y-3 mt-2">
                    <p className="text-[11px] text-gray-500">
                      Phase 1 supports demographic targeting. Selections apply to all {detail?.adGroups?.length || 0} ad group{(detail?.adGroups?.length || 0) === 1 ? "" : "s"} in this campaign.
                    </p>
                    {DEMO_OPTIONS.map((group) => (
                      <div key={group.apiType}>
                        <div className="text-xs text-gray-500 mb-1">{group.title}</div>
                        <div className="flex flex-wrap gap-1.5">
                          {group.options.map((opt) => {
                            const selected = editAudiences.some((a) => a.apiType === group.apiType && a.value === opt.value);
                            const existing = editAudiences.find((a) => a.apiType === group.apiType && a.value === opt.value);
                            const isNeg = existing?.negative === true;
                            return (
                              <button
                                type="button"
                                key={opt.value}
                                onClick={() => toggleAudience(group.apiType, opt.value)}
                                className={`text-xs px-2.5 py-1 rounded-full border transition-colors cursor-pointer ${
                                  selected
                                    ? isNeg
                                      ? "bg-red-50 text-red-700 border-red-200 line-through"
                                      : "bg-purple-50 text-purple-700 border-purple-200"
                                    : "bg-white text-gray-600 border-gray-200 hover:bg-gray-50"
                                }`}
                                title={isNeg ? "Currently excluded — click to remove" : undefined}
                              >
                                {opt.label}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                    <p className="text-[11px] text-gray-400">
                      Note: User Lists / Custom Audiences / Interests / Topics on this campaign (if any) are preserved — only demographics are replaced by saving here.
                    </p>
                    <div className="flex gap-2 pt-1">
                      <button
                        onClick={handleSaveAudiences}
                        disabled={savingAudiences}
                        className="bg-red-800 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-red-900 disabled:opacity-50 cursor-pointer"
                      >
                        {savingAudiences ? "..." : (t.save || "Save")}
                      </button>
                      <button
                        onClick={() => setEditingAudiences(false)}
                        className="px-4 py-2 border border-gray-300 rounded-lg text-sm hover:bg-gray-50 cursor-pointer"
                      >
                        {t.cancel || "Cancel"}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              {/* Selected locations */}
              {editLocations.length > 0 ? (
                <div className="flex flex-wrap gap-1.5">
                  {editLocations.map((l) => (
                    <span key={l.id} className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full bg-blue-50 text-blue-700 border border-blue-200">
                      {l.name}
                      {l.targetType && <span className="text-blue-400 text-[10px]">{l.targetType}</span>}
                      <button
                        type="button"
                        onClick={() => setEditLocations(editLocations.filter((x) => x.id !== l.id))}
                        className="text-blue-400 hover:text-blue-700 cursor-pointer"
                      >×</button>
                    </span>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-amber-700">⚠️ {t.locationsWorldwide || "Worldwide (no targeting set)"}</p>
              )}

              {/* Search */}
              <div className="relative">
                <input
                  value={geoQuery}
                  onChange={(e) => setGeoQuery(e.target.value)}
                  placeholder={t.searchLocation || "Search state, city, postal code, DMA..."}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm outline-none focus:ring-2 focus:ring-red-500"
                />
                {geoQuery.trim().length >= 2 && (geoSearching || geoSuggestions.length > 0) && (
                  <div className="absolute z-10 mt-1 w-full bg-white border border-gray-200 rounded-lg shadow-lg max-h-64 overflow-y-auto">
                    {geoSearching && <div className="px-3 py-2 text-xs text-gray-400">{t.searching || "Searching..."}</div>}
                    {!geoSearching && geoSuggestions.length === 0 && <div className="px-3 py-2 text-xs text-gray-400">{t.noResults || "No results"}</div>}
                    {geoSuggestions.map((s) => {
                      const already = editLocations.some((sel) => sel.id === s.id);
                      return (
                        <button
                          type="button"
                          key={s.id}
                          disabled={already}
                          onClick={() => {
                            setEditLocations([...editLocations, { id: s.id, name: s.canonicalName || s.name, targetType: s.targetType }]);
                            setGeoQuery("");
                            setGeoSuggestions([]);
                          }}
                          className={`w-full text-left px-3 py-2 text-sm flex items-center justify-between gap-2 ${already ? "text-gray-400 cursor-not-allowed" : "hover:bg-gray-50 cursor-pointer"}`}
                        >
                          <span className="truncate">{s.canonicalName || s.name}</span>
                          <span className="text-xs text-gray-400 shrink-0">{s.targetType}</span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Quick country chips */}
              <div>
                <div className="text-xs text-gray-400 mb-1">{t.quickSelectCountries || "Quick-select countries"}:</div>
                <div className="flex flex-wrap gap-1.5">
                  {COUNTRIES.map((country) => {
                    const selected = editLocations.some((l) => l.id === country.id);
                    return (
                      <button
                        type="button"
                        key={country.id}
                        onClick={() => {
                          if (selected) {
                            setEditLocations(editLocations.filter((l) => l.id !== country.id));
                          } else {
                            setEditLocations([...editLocations, { id: country.id, name: country.name, targetType: "Country" }]);
                          }
                        }}
                        className={`text-xs px-2.5 py-1 rounded-full border transition-colors cursor-pointer ${
                          selected
                            ? "bg-blue-50 text-blue-700 border-blue-200"
                            : "bg-white text-gray-600 border-gray-200 hover:bg-gray-50"
                        }`}
                      >
                        {country.name}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Save / cancel */}
              <div className="flex gap-2 pt-1">
                <button
                  onClick={handleSaveLocations}
                  disabled={savingLocations}
                  className="bg-red-800 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-red-900 disabled:opacity-50 cursor-pointer"
                >
                  {savingLocations ? "..." : (t.save || "Save")}
                </button>
                <button
                  onClick={() => setEditingLocations(false)}
                  className="px-4 py-2 border border-gray-300 rounded-lg text-sm hover:bg-gray-50 cursor-pointer"
                >
                  {t.cancel || "Cancel"}
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Asset Groups (Performance Max only — PMax has no ad groups) */}
        {campaign.channel === "PERFORMANCE_MAX" && (
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-gray-700">
                {t.assetGroupsSection || "Asset Groups"}
                {detail?.assetGroups && ` (${detail.assetGroups.length})`}
              </h2>
              <div className="flex items-center gap-3">
                {canEdit && (
                  <button
                    onClick={() => { setShowAssetForm(!showAssetForm); setAssetError(""); }}
                    className="text-xs px-3 py-1.5 bg-red-800 text-white rounded-lg hover:bg-red-900 cursor-pointer"
                  >
                    {showAssetForm ? (t.cancel || "Cancel") : `+ ${t.addAssetGroup || "Add Asset Group"}`}
                  </button>
                )}
                <a
                  href={googleAdsUrl || "#"}
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs text-blue-700 hover:underline"
                  title={t.pmaxEditInGoogleHint || "Performance Max assets can only be edited in Google Ads"}
                >
                  {t.pmaxEditInGoogle || "Edit in Google Ads ↗"}
                </a>
              </div>
            </div>
            <p className="text-xs text-gray-500 mb-3">
              {t.pmaxReadOnlyNote || "Performance Max uses asset groups (not ad groups). AutoClaw shows them read-only — to edit assets, audience signals, or pause individual asset groups, use Google Ads directly."}
            </p>

            {showAssetForm && (
              <div className="border border-gray-200 rounded-lg p-3 mb-3 space-y-3 bg-gray-50">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-xs text-blue-700 bg-blue-50 border border-blue-200 px-2 py-1.5 rounded flex-1">
                    ℹ️ {t.assetGroupFormHint || "Asset group will be created PAUSED. Required: ≥3 headlines, ≥1 long headline, ≥2 descriptions, business name, final URL, ≥1 landscape image, ≥1 square image."}
                  </p>
                  <button
                    type="button"
                    onClick={handleFillDemoAssetGroup}
                    className="shrink-0 text-xs px-2.5 py-1.5 border border-gray-300 rounded-lg hover:bg-white cursor-pointer"
                    title={t.useDemoContentHint || "Fill the form with a working PMAX example so you can review or demo without typing"}
                  >
                    ✨ {t.useDemoContent || "Use demo content"}
                  </button>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <input
                    value={assetName}
                    onChange={(e) => setAssetName(e.target.value)}
                    placeholder={t.assetGroupName || "Asset group name"}
                    className="px-3 py-2 border border-gray-300 rounded-lg text-sm outline-none focus:ring-2 focus:ring-red-500"
                  />
                  <input
                    value={assetBusinessName}
                    onChange={(e) => setAssetBusinessName(e.target.value)}
                    placeholder={`${t.businessName || "Business name"} (≤25 chars)`}
                    maxLength={25}
                    className="px-3 py-2 border border-gray-300 rounded-lg text-sm outline-none focus:ring-2 focus:ring-red-500"
                  />
                </div>
                <input
                  value={assetFinalUrl}
                  onChange={(e) => setAssetFinalUrl(e.target.value)}
                  placeholder={t.finalUrlPlaceholder || "https://your-landing-page.com"}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm outline-none focus:ring-2 focus:ring-red-500"
                />
                <textarea
                  value={assetHeadlines}
                  onChange={(e) => setAssetHeadlines(e.target.value)}
                  placeholder={t.pmaxHeadlinesPlaceholder || "Headlines (≥3, one per line, ≤30 chars each)"}
                  rows={4}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm outline-none focus:ring-2 focus:ring-red-500"
                />
                <textarea
                  value={assetLongHeadlines}
                  onChange={(e) => setAssetLongHeadlines(e.target.value)}
                  placeholder={t.pmaxLongHeadlinesPlaceholder || "Long headlines (≥1, one per line, ≤90 chars each)"}
                  rows={2}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm outline-none focus:ring-2 focus:ring-red-500"
                />
                <textarea
                  value={assetDescriptions}
                  onChange={(e) => setAssetDescriptions(e.target.value)}
                  placeholder={t.pmaxDescriptionsPlaceholder || "Descriptions (≥2, one per line, ≤90 chars each, ≥1 should be ≤60 chars)"}
                  rows={3}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm outline-none focus:ring-2 focus:ring-red-500"
                />
                <textarea
                  value={assetMarketingImageUrls}
                  onChange={(e) => setAssetMarketingImageUrls(e.target.value)}
                  placeholder={t.marketingImagesPlaceholder || "Landscape image URLs (1.91:1, ≥1, one per line, public PNG/JPEG)"}
                  rows={2}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm outline-none focus:ring-2 focus:ring-red-500"
                />
                <textarea
                  value={assetSquareImageUrls}
                  onChange={(e) => setAssetSquareImageUrls(e.target.value)}
                  placeholder={t.squareImagesPlaceholder || "Square image URLs (1:1, ≥1, one per line, public PNG/JPEG)"}
                  rows={2}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm outline-none focus:ring-2 focus:ring-red-500"
                />
                <input
                  value={assetLogoUrl}
                  onChange={(e) => setAssetLogoUrl(e.target.value)}
                  placeholder={t.logoUrlPlaceholder || "Logo URL (1:1, optional)"}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm outline-none focus:ring-2 focus:ring-red-500"
                />
                {assetError && (
                  <pre className="text-xs text-red-600 bg-red-50 p-2 rounded whitespace-pre-wrap break-all">{assetError}</pre>
                )}
                <div className="flex gap-2">
                  <button
                    onClick={handleCreateAssetGroup}
                    disabled={assetSubmitting}
                    className="bg-red-800 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-red-900 disabled:opacity-50 cursor-pointer"
                  >
                    {assetSubmitting ? (t.creating || "Creating...") : (t.create || "Create")}
                  </button>
                  <button onClick={() => { setShowAssetForm(false); setAssetError(""); }} className="px-4 py-2 border border-gray-300 rounded-lg text-sm hover:bg-gray-50 cursor-pointer">
                    {t.cancel || "Cancel"}
                  </button>
                </div>
              </div>
            )}

            {!detail?.assetGroups || detail.assetGroups.length === 0 ? (
              <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 px-3 py-2 rounded-lg">
                ⚠️ {t.pmaxNoAssetGroups || "No asset groups found yet."}
              </p>
            ) : (
              <div className="space-y-2">
                {detail.assetGroups.map((ag) => (
                  <div key={ag.resourceName} className="border border-gray-100 rounded-lg px-3 py-2 text-sm">
                    <div className="flex flex-wrap items-center gap-2 mb-1">
                      <span className="font-medium text-gray-800">{ag.name || "(unnamed)"}</span>
                      <span className={`px-1.5 py-0.5 text-xs rounded-full ${
                        ag.status === "ENABLED" ? "bg-green-50 text-green-700" :
                        ag.status === "PAUSED" ? "bg-yellow-50 text-yellow-700" :
                        "bg-gray-100 text-gray-600"
                      }`}>{ag.status}</span>
                      {ag.adStrength && (
                        <span className={`px-1.5 py-0.5 text-xs rounded-full ${
                          ag.adStrength === "EXCELLENT" ? "bg-emerald-50 text-emerald-700" :
                          ag.adStrength === "GOOD" ? "bg-emerald-50 text-emerald-700" :
                          ag.adStrength === "AVERAGE" ? "bg-amber-50 text-amber-700" :
                          ag.adStrength === "POOR" ? "bg-red-50 text-red-700" :
                          "bg-gray-100 text-gray-600"
                        }`}>{t.assetGroupStrength || "Ad strength"}: {ag.adStrength}</span>
                      )}
                      {ag.primaryStatus && ag.primaryStatus !== ag.status && (
                        <span className="px-1.5 py-0.5 bg-blue-50 text-blue-700 text-xs rounded-full">{ag.primaryStatus}</span>
                      )}
                    </div>
                    {ag.finalUrls.length > 0 && (
                      <div className="text-xs text-gray-500 truncate">
                        → {ag.finalUrls.slice(0, 2).join(", ")}{ag.finalUrls.length > 2 ? ` +${ag.finalUrls.length - 2}` : ""}
                      </div>
                    )}
                    {ag.primaryStatusReasons.length > 0 && (
                      <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 px-2 py-1.5 rounded mt-1.5">
                        ⏳ {ag.primaryStatusReasons.map((r) => r.replace(/_/g, " ").toLowerCase()).join(" · ")}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Ad Groups (hidden for PMax) */}
        {campaign.channel !== "PERFORMANCE_MAX" && (
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-gray-700">{t.adGroupsSection || "Ad Groups"} {detail?.adGroups && `(${detail.adGroups.length})`}</h2>
            {canEdit && (
              <button
                onClick={() => { setShowAgForm(!showAgForm); setAgError(""); }}
                className="text-xs px-3 py-1.5 bg-red-800 text-white rounded-lg hover:bg-red-900 cursor-pointer"
              >
                {showAgForm ? (t.cancel || "Cancel") : `+ ${t.addAdGroup || "Add Ad Group"}`}
              </button>
            )}
          </div>

          {showAgForm && (
            <div className="border border-gray-200 rounded-lg p-3 mb-3 space-y-2">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <input
                  value={agName}
                  onChange={(e) => setAgName(e.target.value)}
                  placeholder={t.adGroupName || "Ad group name"}
                  className="px-3 py-2 border border-gray-300 rounded-lg text-sm outline-none focus:ring-2 focus:ring-red-500"
                />
                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-500">{t.cpcBid || "Default CPC bid"} $</span>
                  <input
                    value={agCpcBid}
                    onChange={(e) => setAgCpcBid(e.target.value)}
                    type="number"
                    min="0.01"
                    step="0.01"
                    className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm outline-none focus:ring-2 focus:ring-red-500"
                  />
                </div>
              </div>
              {agError && (
                <pre className="text-xs text-red-600 bg-red-50 p-2 rounded whitespace-pre-wrap break-all">{agError}</pre>
              )}
              <div className="flex gap-2">
                <button
                  onClick={handleCreateAdGroup}
                  disabled={agSubmitting || !agName.trim() || Number(agCpcBid) <= 0}
                  className="bg-red-800 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-red-900 disabled:opacity-50 cursor-pointer"
                >
                  {agSubmitting ? (t.creating || "Creating...") : (t.create || "Create")}
                </button>
                <button onClick={() => { setShowAgForm(false); setAgError(""); }} className="px-4 py-2 border border-gray-300 rounded-lg text-sm hover:bg-gray-50 cursor-pointer">
                  {t.cancel || "Cancel"}
                </button>
              </div>
            </div>
          )}

          {!detail?.adGroups || detail.adGroups.length === 0 ? (
            <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 px-3 py-2 rounded-lg">
              ⚠️ {t.noAdGroupsWarning || "No ad groups yet. Add one before this campaign can serve ads."}
            </p>
          ) : (
            <div className="space-y-1.5">
              {detail.adGroups.map((ag) => (
                <div key={ag.resourceName} className="border border-gray-100 rounded-lg">
                  <div className="flex items-center justify-between px-3 py-2 text-sm">
                    <div>
                      <span className="font-medium text-gray-800">{ag.name}</span>
                      <span className={`ml-2 px-1.5 py-0.5 text-xs rounded-full ${
                        ag.status === "PAUSED" ? "bg-yellow-50 text-yellow-700" :
                        ag.status === "ENABLED" ? "bg-green-50 text-green-700" :
                        "bg-gray-100 text-gray-600"
                      }`}>{ag.status}</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-xs text-gray-500">CPC ${(ag.cpcBidMicros / 1_000_000).toFixed(2)}</span>
                      {canEdit && campaign.channel === "SEARCH" && (
                        <button
                          onClick={() => {
                            setKwFormFor(kwFormFor === ag.resourceName ? null : ag.resourceName);
                            setKwError("");
                          }}
                          className="text-xs px-2 py-1 border border-emerald-200 text-emerald-700 rounded hover:bg-emerald-50 cursor-pointer"
                        >
                          {kwFormFor === ag.resourceName ? (t.cancel || "Cancel") : `+ ${t.addKeywords || "Add Keywords"}`}
                        </button>
                      )}
                      {canEdit && (
                        <button
                          onClick={() => {
                            setAdFormFor(adFormFor === ag.resourceName ? null : ag.resourceName);
                            setAdError("");
                          }}
                          className="text-xs px-2 py-1 border border-blue-200 text-blue-700 rounded hover:bg-blue-50 cursor-pointer"
                        >
                          {adFormFor === ag.resourceName ? (t.cancel || "Cancel") : `+ ${t.addAd || "Add Ad"}`}
                        </button>
                      )}
                    </div>
                  </div>

                  {kwFormFor === ag.resourceName && campaign.channel === "SEARCH" && (
                    <div className="border-t border-gray-100 p-3 bg-gray-50 space-y-2">
                      <div className="text-xs font-semibold text-gray-700 mb-2">
                        {t.kwHeading || "Add Keywords"} <span className="font-normal text-gray-400">· ad group: {ag.name}</span>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-2">
                        <div>
                          <label className="block text-xs text-gray-500 mb-1">{t.kwLabel || "Keywords (one per line, ≤80 chars each). Prefix with [exact] / [phrase] / [broad] to override the default."}</label>
                          <textarea
                            value={kwText}
                            onChange={(e) => setKwText(e.target.value)}
                            rows={5}
                            placeholder={"vietnamese pho san francisco\n[phrase] cheap pho mission district\n[exact] $2 vietnamese pho"}
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm outline-none focus:ring-2 focus:ring-emerald-500 font-mono"
                          />
                          <div className="text-xs text-gray-400 mt-0.5">
                            {kwText.split("\n").filter((s) => s.trim()).length} {t.lines || "lines"}
                          </div>
                        </div>
                        <div>
                          <label className="block text-xs text-gray-500 mb-1">{t.kwDefaultMatchType || "Default match type"}</label>
                          <select
                            value={kwMatchType}
                            onChange={(e) => setKwMatchType(e.target.value as "BROAD" | "PHRASE" | "EXACT")}
                            className="w-full sm:w-32 px-3 py-2 border border-gray-300 rounded-lg text-sm cursor-pointer"
                          >
                            <option value="BROAD">Broad</option>
                            <option value="PHRASE">Phrase</option>
                            <option value="EXACT">Exact</option>
                          </select>
                        </div>
                      </div>
                      {kwError && <pre className="text-xs text-red-600 bg-red-50 p-2 rounded whitespace-pre-wrap break-all">{kwError}</pre>}
                      <div className="flex gap-2">
                        <button
                          onClick={handleAddKeywords}
                          disabled={kwSubmitting}
                          className="bg-emerald-700 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-emerald-800 disabled:opacity-50 cursor-pointer"
                        >
                          {kwSubmitting ? (t.creating || "Creating...") : (t.kwSubmit || "Add Keywords")}
                        </button>
                        <button onClick={() => { setKwFormFor(null); setKwError(""); }} className="px-4 py-2 border border-gray-300 rounded-lg text-sm hover:bg-gray-50 cursor-pointer">
                          {t.cancel || "Cancel"}
                        </button>
                      </div>
                    </div>
                  )}

                  {adFormFor === ag.resourceName && campaign.channel !== "VIDEO" && campaign.channel !== "DISPLAY" && (
                    <div className="border-t border-gray-100 p-3 bg-gray-50 space-y-2">
                      <div className="flex items-center justify-between mb-2">
                        <div className="text-xs font-semibold text-gray-700">
                          {t.searchAdHeading || "Responsive Search Ad"} <span className="font-normal text-gray-400">· channel: {campaign.channel}</span>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleGenerateCopy("SEARCH", adFinalUrl)}
                          disabled={genCopyLoading || !adFinalUrl.trim()}
                          className="text-xs px-2 py-1 border border-violet-200 text-violet-700 rounded hover:bg-violet-50 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                          title={t.adCopyGenerateHint || "Auto-generate headlines & descriptions from the Final URL"}
                        >
                          {genCopyLoading ? (t.adCopyGenerating || "Generating…") : `✨ ${t.adCopyGenerate || "Generate from URL"}`}
                        </button>
                      </div>
                      <div>
                        <label className="block text-xs text-gray-500 mb-1">{t.adHeadlinesLabel || "Headlines (one per line, 3-15 lines, max 30 chars each)"}</label>
                        <textarea
                          value={adHeadlines}
                          onChange={(e) => setAdHeadlines(e.target.value)}
                          rows={4}
                          placeholder={t.headlinesPlaceholder || "Best Online Tutoring\nTry It Free Today\n..."}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm outline-none focus:ring-2 focus:ring-red-500 font-mono"
                        />
                        <div className="text-xs text-gray-400 mt-0.5">
                          {adHeadlines.split("\n").filter((s) => s.trim()).length} {t.lines || "lines"}
                        </div>
                      </div>
                      <div>
                        <label className="block text-xs text-gray-500 mb-1">{t.adDescriptionsLabel || "Descriptions (one per line, 2-4 lines, max 90 chars each)"}</label>
                        <textarea
                          value={adDescriptions}
                          onChange={(e) => setAdDescriptions(e.target.value)}
                          rows={3}
                          placeholder={t.descriptionsPlaceholder || "Personalized AI tutoring for K-12. Free trial.\n..."}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm outline-none focus:ring-2 focus:ring-red-500 font-mono"
                        />
                        <div className="text-xs text-gray-400 mt-0.5">
                          {adDescriptions.split("\n").filter((s) => s.trim()).length} {t.lines || "lines"}
                        </div>
                      </div>
                      <div>
                        <label className="block text-xs text-gray-500 mb-1">{t.adFinalUrlLabel || "Final URL"}</label>
                        <input
                          value={adFinalUrl}
                          onChange={(e) => setAdFinalUrl(e.target.value)}
                          placeholder="https://example.com/landing"
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm outline-none focus:ring-2 focus:ring-red-500"
                        />
                      </div>
                      {adError && <pre className="text-xs text-red-600 bg-red-50 p-2 rounded whitespace-pre-wrap break-all">{adError}</pre>}
                      <div className="flex gap-2">
                        <button
                          onClick={handleCreateAd}
                          disabled={adSubmitting}
                          className="bg-red-800 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-red-900 disabled:opacity-50 cursor-pointer"
                        >
                          {adSubmitting ? (t.creating || "Creating...") : (t.create || "Create")}
                        </button>
                        <button onClick={() => { setAdFormFor(null); setAdError(""); }} className="px-4 py-2 border border-gray-300 rounded-lg text-sm hover:bg-gray-50 cursor-pointer">
                          {t.cancel || "Cancel"}
                        </button>
                      </div>
                    </div>
                  )}

                  {adFormFor === ag.resourceName && campaign.channel === "DISPLAY" && (
                    <div className="border-t border-gray-100 p-3 bg-gray-50 space-y-2">
                      <div className="flex items-center justify-between mb-2">
                        <div className="text-xs font-semibold text-gray-700">
                          {t.displayAdHeading || "Responsive Display Ad"} <span className="font-normal text-gray-400">· channel: DISPLAY</span>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleGenerateCopy("DISPLAY", dFinalUrl)}
                          disabled={genCopyLoading || !dFinalUrl.trim()}
                          className="text-xs px-2 py-1 border border-violet-200 text-violet-700 rounded hover:bg-violet-50 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                          title={t.adCopyGenerateHint || "Auto-generate headlines, descriptions, and business name from the Final URL"}
                        >
                          {genCopyLoading ? (t.adCopyGenerating || "Generating…") : `✨ ${t.adCopyGenerate || "Generate from URL"}`}
                        </button>
                      </div>
                      <div>
                        <label className="block text-xs text-gray-500 mb-1">{t.displayMarketingImagesLabel || "Landscape image URLs (one per line, ≥1, recommended 1200×628 PNG/JPG, max 5 MB each)"}</label>
                        <textarea
                          value={dMarketingImages}
                          onChange={(e) => setDMarketingImages(e.target.value)}
                          rows={2}
                          placeholder={"https://cdn.example.com/banner-1200x628.jpg"}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm outline-none focus:ring-2 focus:ring-red-500 font-mono"
                        />
                        <div className="text-xs text-gray-400 mt-0.5">
                          {dMarketingImages.split("\n").filter((s) => s.trim()).length} {t.lines || "lines"}
                        </div>
                      </div>
                      <div>
                        <label className="block text-xs text-gray-500 mb-1">{t.displaySquareImagesLabel || "Square image URLs (one per line, ≥1, recommended 1200×1200 PNG/JPG)"}</label>
                        <textarea
                          value={dSquareImages}
                          onChange={(e) => setDSquareImages(e.target.value)}
                          rows={2}
                          placeholder={"https://cdn.example.com/square-1200x1200.jpg"}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm outline-none focus:ring-2 focus:ring-red-500 font-mono"
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-gray-500 mb-1">{t.displayLogoLabel || "Logo URL (optional, recommended 1200×1200 or 1200×300)"}</label>
                        <input
                          value={dLogoUrl}
                          onChange={(e) => setDLogoUrl(e.target.value)}
                          placeholder="https://cdn.example.com/logo.png"
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm outline-none focus:ring-2 focus:ring-red-500"
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-gray-500 mb-1">{t.displayHeadlinesLabel || "Headlines (one per line, 1-5 lines, max 30 chars each)"}</label>
                        <textarea
                          value={dHeadlines}
                          onChange={(e) => setDHeadlines(e.target.value)}
                          rows={3}
                          placeholder={t.headlinesPlaceholder || "Best Online Tutoring\nTry It Free Today\n..."}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm outline-none focus:ring-2 focus:ring-red-500 font-mono"
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-gray-500 mb-1">{t.longHeadlineLabel || "Long headline (max 90 chars)"}</label>
                        <input
                          value={dLongHeadline}
                          onChange={(e) => setDLongHeadline(e.target.value.slice(0, 90))}
                          placeholder="AI Tutoring for K-12 — Personalized, Affordable"
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm outline-none focus:ring-2 focus:ring-red-500"
                          maxLength={90}
                        />
                        <div className="text-xs text-gray-400 mt-0.5">{dLongHeadline.length}/90</div>
                      </div>
                      <div>
                        <label className="block text-xs text-gray-500 mb-1">{t.displayDescriptionsLabel || "Descriptions (one per line, 1-5 lines, max 90 chars each)"}</label>
                        <textarea
                          value={dDescriptions}
                          onChange={(e) => setDDescriptions(e.target.value)}
                          rows={3}
                          placeholder={t.descriptionsPlaceholder || "Personalized AI tutoring for K-12. Free trial.\n..."}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm outline-none focus:ring-2 focus:ring-red-500 font-mono"
                        />
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        <div>
                          <label className="block text-xs text-gray-500 mb-1">{t.displayBusinessNameLabel || "Business name (max 25 chars)"}</label>
                          <input
                            value={dBusinessName}
                            onChange={(e) => setDBusinessName(e.target.value.slice(0, 25))}
                            placeholder="AutoClaw"
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm outline-none focus:ring-2 focus:ring-red-500"
                            maxLength={25}
                          />
                          <div className="text-xs text-gray-400 mt-0.5">{dBusinessName.length}/25</div>
                        </div>
                        <div>
                          <label className="block text-xs text-gray-500 mb-1">{t.adFinalUrlLabel || "Final URL"}</label>
                          <input
                            value={dFinalUrl}
                            onChange={(e) => setDFinalUrl(e.target.value)}
                            placeholder="https://example.com/landing"
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm outline-none focus:ring-2 focus:ring-red-500"
                          />
                        </div>
                      </div>
                      {adError && <pre className="text-xs text-red-600 bg-red-50 p-2 rounded whitespace-pre-wrap break-all">{adError}</pre>}
                      <div className="flex gap-2">
                        <button
                          onClick={handleCreateDisplayAd}
                          disabled={adSubmitting}
                          className="bg-red-800 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-red-900 disabled:opacity-50 cursor-pointer"
                        >
                          {adSubmitting ? (t.creating || "Creating...") : (t.create || "Create")}
                        </button>
                        <button onClick={() => { setAdFormFor(null); setAdError(""); }} className="px-4 py-2 border border-gray-300 rounded-lg text-sm hover:bg-gray-50 cursor-pointer">
                          {t.cancel || "Cancel"}
                        </button>
                      </div>
                    </div>
                  )}

                  {adFormFor === ag.resourceName && campaign.channel === "VIDEO" && (
                    <div className="border-t border-gray-100 p-3 bg-gray-50 space-y-2">
                      <div className="flex items-center justify-between mb-2">
                        <div className="text-xs font-semibold text-gray-700">
                          {t.videoAdHeading || "Video Responsive Ad"} <span className="font-normal text-gray-400">· channel: VIDEO</span>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleGenerateCopy("VIDEO", vFinalUrl)}
                          disabled={genCopyLoading || !vFinalUrl.trim()}
                          className="text-xs px-2 py-1 border border-violet-200 text-violet-700 rounded hover:bg-violet-50 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                          title={t.adCopyGenerateHint || "Auto-generate headlines and descriptions from the Final URL"}
                        >
                          {genCopyLoading ? (t.adCopyGenerating || "Generating…") : `✨ ${t.adCopyGenerate || "Generate from URL"}`}
                        </button>
                      </div>
                      <div>
                        <label className="block text-xs text-gray-500 mb-1">{t.youtubeUrlLabel || "YouTube video URL or ID"}</label>
                        <input
                          value={vYoutubeUrl}
                          onChange={(e) => setVYoutubeUrl(e.target.value)}
                          placeholder="https://youtube.com/watch?v=MGoN28MHzeY"
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm outline-none focus:ring-2 focus:ring-red-500"
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-gray-500 mb-1">{t.longHeadlineLabel || "Long headline (max 90 chars)"}</label>
                        <input
                          value={vLongHeadline}
                          onChange={(e) => setVLongHeadline(e.target.value.slice(0, 90))}
                          placeholder="AI Voice Assistant for Teachers — Try Merlyn Free"
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm outline-none focus:ring-2 focus:ring-red-500"
                          maxLength={90}
                        />
                        <div className="text-xs text-gray-400 mt-0.5">{vLongHeadline.length}/90</div>
                      </div>
                      <div>
                        <label className="block text-xs text-gray-500 mb-1">{t.shortHeadlinesLabel || "Short headlines (one per line, 1-5 lines, max 15 chars each — used in some formats)"}</label>
                        <textarea
                          value={vShortHeadlines}
                          onChange={(e) => setVShortHeadlines(e.target.value)}
                          rows={3}
                          placeholder={"Try Merlyn\nAI for Teachers\nFree Trial"}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm outline-none focus:ring-2 focus:ring-red-500 font-mono"
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-gray-500 mb-1">{t.adDescriptionsLabel || "Descriptions (one per line, max 90 chars each)"}</label>
                        <textarea
                          value={vDescriptions}
                          onChange={(e) => setVDescriptions(e.target.value)}
                          rows={3}
                          placeholder="Voice-controlled AI for K-12 classrooms.\nSee how teachers save 10 hrs/week."
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm outline-none focus:ring-2 focus:ring-red-500 font-mono"
                        />
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        <div>
                          <label className="block text-xs text-gray-500 mb-1">{t.ctaLabel || "Call to action"}</label>
                          <select
                            value={vCta}
                            onChange={(e) => setVCta(e.target.value)}
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm cursor-pointer"
                          >
                            <option value="Subscribe">Subscribe</option>
                            <option value="Learn More">Learn More</option>
                            <option value="Try Free">Try Free</option>
                            <option value="Sign Up">Sign Up</option>
                            <option value="Watch More">Watch More</option>
                            <option value="Get Started">Get Started</option>
                          </select>
                        </div>
                        <div>
                          <label className="block text-xs text-gray-500 mb-1">{t.adFinalUrlLabel || "Final URL"}</label>
                          <input
                            value={vFinalUrl}
                            onChange={(e) => setVFinalUrl(e.target.value)}
                            placeholder="https://www.youtube.com/@merlynforeducation"
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm outline-none focus:ring-2 focus:ring-red-500"
                          />
                        </div>
                      </div>
                      {adError && <pre className="text-xs text-red-600 bg-red-50 p-2 rounded whitespace-pre-wrap break-all">{adError}</pre>}
                      <div className="flex gap-2">
                        <button
                          onClick={handleCreateVideoAd}
                          disabled={adSubmitting}
                          className="bg-red-800 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-red-900 disabled:opacity-50 cursor-pointer"
                        >
                          {adSubmitting ? (t.creating || "Creating...") : (t.create || "Create")}
                        </button>
                        <button onClick={() => { setAdFormFor(null); setAdError(""); }} className="px-4 py-2 border border-gray-300 rounded-lg text-sm hover:bg-gray-50 cursor-pointer">
                          {t.cancel || "Cancel"}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
        )}

        {/* Keywords */}
        {detail?.keywords && detail.keywords.length > 0 && (
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <h2 className="text-sm font-semibold text-gray-700 mb-3">{t.keywordsSection || "Keywords"} ({detail.keywords.length})</h2>
            <div className="flex flex-wrap gap-1.5">
              {detail.keywords.map((kw, i) => (
                <span key={i} className="px-2 py-0.5 bg-gray-100 text-gray-700 text-xs rounded-full">
                  {kw.text} <span className="text-gray-400">[{kw.matchType}]</span>
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Ad schedule / day parting */}
        {detail && AD_SCHEDULE_CHANNELS.has(detail.channelType) && (
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-gray-700">
                ⏰ {t.schedSection || "Ad Schedule"} {(detail.adSchedules?.length || 0) > 0 ? `(${detail.adSchedules?.length})` : ""}
              </h2>
              {canEdit && !editingSchedule && (
                <button
                  onClick={openScheduleEditor}
                  className="text-xs px-3 py-1.5 border border-gray-300 rounded-lg hover:bg-gray-50 cursor-pointer"
                >
                  ✏️ {t.schedEdit || "Edit"}
                </button>
              )}
            </div>

            {!editingSchedule && (
              (detail.adSchedules?.length || 0) === 0 ? (
                <p className="text-xs text-gray-400">{t.schedAllTimes || "Running at all times. Add intervals to only serve on specific days/hours."}</p>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {(detail.adSchedules || []).map((s) => (
                    <span key={s.resourceName} className="px-2 py-0.5 bg-sky-50 text-sky-700 text-xs rounded-full">
                      {DAY_SHORT[s.dayOfWeek] || s.dayOfWeek} {fmtHour(s.startHour)}–{fmtHour(s.endHour)}
                    </span>
                  ))}
                </div>
              )
            )}

            {editingSchedule && (
              <div className="space-y-3">
                <div className="flex flex-wrap gap-2">
                  <button onClick={applyBusinessHoursPreset} className="text-xs px-2 py-1 border border-gray-200 rounded hover:bg-gray-50 cursor-pointer text-gray-600">
                    {t.schedPresetBusiness || "Mon–Fri 9–18"}
                  </button>
                  <button onClick={() => setScheduleRows([])} className="text-xs px-2 py-1 border border-gray-200 rounded hover:bg-gray-50 cursor-pointer text-gray-600">
                    {t.schedClear || "Clear (run at all times)"}
                  </button>
                </div>
                {scheduleRows.map((row, i) => (
                  <div key={i} className="flex items-center gap-2 flex-wrap">
                    <select
                      value={row.dayOfWeek}
                      onChange={(e) => setScheduleRows(scheduleRows.map((r, j) => j === i ? { ...r, dayOfWeek: e.target.value as ScheduleDay } : r))}
                      className="text-xs px-2 py-1 border border-gray-300 rounded outline-none bg-white"
                    >
                      {SCHEDULE_DAYS.map((d) => <option key={d} value={d}>{DAY_SHORT[d]}</option>)}
                    </select>
                    <select
                      value={row.startHour}
                      onChange={(e) => setScheduleRows(scheduleRows.map((r, j) => j === i ? { ...r, startHour: Number(e.target.value) } : r))}
                      className="text-xs px-2 py-1 border border-gray-300 rounded outline-none bg-white"
                    >
                      {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{fmtHour(h)}</option>)}
                    </select>
                    <span className="text-xs text-gray-400">→</span>
                    <select
                      value={row.endHour}
                      onChange={(e) => setScheduleRows(scheduleRows.map((r, j) => j === i ? { ...r, endHour: Number(e.target.value) } : r))}
                      className="text-xs px-2 py-1 border border-gray-300 rounded outline-none bg-white"
                    >
                      {Array.from({ length: 24 }, (_, h) => <option key={h + 1} value={h + 1}>{fmtHour(h + 1)}</option>)}
                    </select>
                    <button
                      onClick={() => setScheduleRows(scheduleRows.filter((_, j) => j !== i))}
                      className="text-xs text-gray-400 hover:text-red-600 cursor-pointer"
                    >×</button>
                  </div>
                ))}
                <button
                  onClick={() => setScheduleRows([...scheduleRows, { dayOfWeek: "MONDAY", startHour: 9, endHour: 18 }])}
                  className="text-xs px-2 py-1 border border-dashed border-gray-300 rounded hover:bg-gray-50 cursor-pointer text-gray-500"
                >
                  + {t.schedAddInterval || "Add interval"}
                </button>
                {scheduleError && <pre className="text-xs text-red-600 bg-red-50 p-2 rounded whitespace-pre-wrap break-all">{scheduleError}</pre>}
                <div className="flex gap-2">
                  <button
                    onClick={handleSaveSchedule}
                    disabled={savingSchedule}
                    className="bg-red-800 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-red-900 disabled:opacity-50 cursor-pointer"
                  >
                    {savingSchedule ? (t.creating || "Saving...") : (t.save || "Save")}
                  </button>
                  <button onClick={() => setEditingSchedule(false)} className="px-4 py-2 border border-gray-300 rounded-lg text-sm hover:bg-gray-50 cursor-pointer">
                    {t.cancel || "Cancel"}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Sitelinks — SEARCH only */}
        {detail && detail.channelType === "SEARCH" && (
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-gray-700">
                🔗 {t.slSection || "Sitelinks"} ({detail.sitelinks?.length || 0})
              </h2>
              {canEdit && (
                <button
                  onClick={() => { setSitelinkFormOpen(!sitelinkFormOpen); setSitelinkError(""); }}
                  className="text-xs px-3 py-1.5 border border-gray-300 rounded-lg hover:bg-gray-50 cursor-pointer"
                >
                  {sitelinkFormOpen ? (t.cancel || "Cancel") : `+ ${t.slAdd || "Add Sitelinks"}`}
                </button>
              )}
            </div>
            {(detail.sitelinks?.length || 0) === 0 && !sitelinkFormOpen && (
              <p className="text-xs text-gray-400">{t.slEmpty || "No sitelinks yet. Google shows them under your ad and needs at least 2 to serve — they typically lift CTR."}</p>
            )}
            {(detail.sitelinks?.length || 0) > 0 && (
              <div className="space-y-2">
                {(detail.sitelinks || []).map((s) => (
                  <div key={s.resourceName} className="flex items-start gap-2 border border-gray-100 rounded-lg p-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-blue-700 truncate">{s.linkText}</span>
                        <a href={s.finalUrl} target="_blank" rel="noreferrer" className="text-xs text-gray-400 hover:text-gray-700 truncate">{s.finalUrl}</a>
                      </div>
                      {(s.description1 || s.description2) && (
                        <p className="text-xs text-gray-500 truncate">{[s.description1, s.description2].filter(Boolean).join(" · ")}</p>
                      )}
                    </div>
                    {canEdit && (
                      <button
                        onClick={() => handleRemoveSitelink(s.resourceName)}
                        disabled={removingSitelink === s.resourceName}
                        className="text-gray-300 hover:text-red-600 cursor-pointer disabled:opacity-50 shrink-0"
                        title={t.negKwRemove || "Remove"}
                      >
                        {removingSitelink === s.resourceName ? "…" : "×"}
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
            {sitelinkFormOpen && (
              <div className="mt-4 border-t border-gray-100 pt-4 space-y-3">
                {sitelinkRows.map((row, i) => (
                  <div key={i} className="grid grid-cols-1 sm:grid-cols-2 gap-2 border border-gray-100 rounded-lg p-3 relative">
                    <input
                      value={row.linkText}
                      onChange={(e) => setSitelinkRows(sitelinkRows.map((r, j) => j === i ? { ...r, linkText: e.target.value } : r))}
                      maxLength={25}
                      placeholder={`${t.slLinkText || "Link text"} (≤25)`}
                      className="px-3 py-2 border border-gray-300 rounded-lg text-sm outline-none focus:ring-2 focus:ring-red-500"
                    />
                    <input
                      value={row.finalUrl}
                      onChange={(e) => setSitelinkRows(sitelinkRows.map((r, j) => j === i ? { ...r, finalUrl: e.target.value } : r))}
                      placeholder="https://…"
                      className="px-3 py-2 border border-gray-300 rounded-lg text-sm outline-none focus:ring-2 focus:ring-red-500"
                    />
                    <input
                      value={row.description1}
                      onChange={(e) => setSitelinkRows(sitelinkRows.map((r, j) => j === i ? { ...r, description1: e.target.value } : r))}
                      maxLength={35}
                      placeholder={`${t.slDesc1 || "Description 1"} (≤35, ${t.slOptional || "optional"})`}
                      className="px-3 py-2 border border-gray-300 rounded-lg text-sm outline-none focus:ring-2 focus:ring-red-500"
                    />
                    <input
                      value={row.description2}
                      onChange={(e) => setSitelinkRows(sitelinkRows.map((r, j) => j === i ? { ...r, description2: e.target.value } : r))}
                      maxLength={35}
                      placeholder={`${t.slDesc2 || "Description 2"} (≤35, ${t.slOptional || "optional"})`}
                      className="px-3 py-2 border border-gray-300 rounded-lg text-sm outline-none focus:ring-2 focus:ring-red-500"
                    />
                    {sitelinkRows.length > 1 && (
                      <button
                        onClick={() => setSitelinkRows(sitelinkRows.filter((_, j) => j !== i))}
                        className="absolute top-1 right-2 text-gray-300 hover:text-red-600 cursor-pointer"
                      >×</button>
                    )}
                  </div>
                ))}
                <div className="flex gap-2">
                  <button
                    onClick={() => setSitelinkRows([...sitelinkRows, { linkText: "", finalUrl: "", description1: "", description2: "" }])}
                    className="text-xs px-2 py-1 border border-dashed border-gray-300 rounded hover:bg-gray-50 cursor-pointer text-gray-500"
                  >
                    + {t.slAddRow || "Add another"}
                  </button>
                  <button
                    onClick={() => handleGenerateExtensions("sitelinks")}
                    disabled={genExtLoading !== null}
                    className="text-xs px-2 py-1 border border-purple-200 text-purple-700 rounded hover:bg-purple-50 disabled:opacity-50 cursor-pointer"
                  >
                    {genExtLoading === "sitelinks" ? (t.adCopyGenerating || "Generating…") : `✨ ${t.extGenerate || "Generate from site"}`}
                  </button>
                </div>
                {sitelinkError && <pre className="text-xs text-red-600 bg-red-50 p-2 rounded whitespace-pre-wrap break-all">{sitelinkError}</pre>}
                <div className="flex gap-2">
                  <button
                    onClick={handleAddSitelinks}
                    disabled={sitelinkSubmitting}
                    className="bg-red-800 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-red-900 disabled:opacity-50 cursor-pointer"
                  >
                    {sitelinkSubmitting ? (t.creating || "Adding...") : (t.slAdd || "Add Sitelinks")}
                  </button>
                  <button onClick={() => { setSitelinkFormOpen(false); setSitelinkError(""); }} className="px-4 py-2 border border-gray-300 rounded-lg text-sm hover:bg-gray-50 cursor-pointer">
                    {t.cancel || "Cancel"}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Search terms report — SEARCH only */}
        {detail && detail.channelType === "SEARCH" && (
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-gray-700">
                🔍 {t.termsSection || "Search Terms (last 30 days)"}{searchTerms ? ` (${searchTerms.length})` : ""}
              </h2>
              <button
                onClick={handleLoadSearchTerms}
                disabled={termsLoading}
                className="text-xs px-3 py-1.5 border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50 cursor-pointer"
              >
                {termsLoading ? (t.loading || "Loading...") : searchTerms ? (t.termsRefresh || "Refresh") : (t.termsLoad || "Load")}
              </button>
            </div>
            {!searchTerms && !termsLoading && !termsError && (
              <p className="text-xs text-gray-400">{t.termsHint || "See the actual queries that triggered your ads — spot waste and add negatives in one click."}</p>
            )}
            {termsError && <pre className="text-xs text-red-600 bg-red-50 p-2 rounded whitespace-pre-wrap break-all">{termsError}</pre>}
            {searchTerms && searchTerms.length === 0 && (
              <p className="text-xs text-gray-400">{t.termsEmpty || "No search terms recorded in the last 30 days."}</p>
            )}
            {searchTerms && searchTerms.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="text-gray-500">
                    <tr className="border-b border-gray-100">
                      <th className="text-left py-1.5 pr-2">{t.termsColTerm || "Search term"}</th>
                      <th className="text-right py-1.5 px-2">{t.metricImpressions || "Impressions"}</th>
                      <th className="text-right py-1.5 px-2">{t.metricClicks || "Clicks"}</th>
                      <th className="text-right py-1.5 px-2">{t.metricCost || "Cost"}</th>
                      <th className="text-right py-1.5 px-2">{t.metricConversions || "Conversions"}</th>
                      {canEdit && <th className="py-1.5 pl-2"></th>}
                    </tr>
                  </thead>
                  <tbody>
                    {searchTerms.map((st) => {
                      const alreadyNegative = (detail.negativeKeywords || []).some(
                        (nk) => nk.text.toLowerCase() === st.term.toLowerCase()
                      );
                      return (
                        <tr key={st.term} className="border-b border-gray-50">
                          <td className="py-1.5 pr-2 text-gray-800">{st.term}</td>
                          <td className="py-1.5 px-2 text-right text-gray-600">{st.impressions.toLocaleString()}</td>
                          <td className="py-1.5 px-2 text-right text-gray-600">{st.clicks.toLocaleString()}</td>
                          <td className="py-1.5 px-2 text-right text-gray-600">${(st.costMicros / 1_000_000).toFixed(2)}</td>
                          <td className="py-1.5 px-2 text-right text-gray-600">{st.conversions}</td>
                          {canEdit && (
                            <td className="py-1.5 pl-2 text-right">
                              {alreadyNegative ? (
                                <span className="text-gray-300">{t.termsAlreadyNeg || "excluded"}</span>
                              ) : (
                                <button
                                  onClick={() => handleAddTermAsNegative(st.term)}
                                  disabled={addingNegTerm === st.term}
                                  className="px-2 py-0.5 border border-red-200 text-red-700 rounded hover:bg-red-50 disabled:opacity-50 cursor-pointer whitespace-nowrap"
                                  title={t.termsAddNegTooltip || "Add as EXACT negative keyword"}
                                >
                                  {addingNegTerm === st.term ? "…" : `− ${t.termsAddNeg || "Negative"}`}
                                </button>
                              )}
                            </td>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* Callouts + structured snippets — SEARCH only */}
        {detail && detail.channelType === "SEARCH" && (
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-gray-700">
                📣 {t.extSection || "Callouts & Snippets"} ({(detail.callouts?.length || 0) + (detail.structuredSnippets?.length || 0)})
              </h2>
              {canEdit && (
                <div className="flex gap-2">
                  <button
                    onClick={() => { setExtFormOpen(extFormOpen === "callout" ? null : "callout"); setExtError(""); }}
                    className="text-xs px-3 py-1.5 border border-gray-300 rounded-lg hover:bg-gray-50 cursor-pointer"
                  >
                    {extFormOpen === "callout" ? (t.cancel || "Cancel") : `+ ${t.extAddCallout || "Callouts"}`}
                  </button>
                  <button
                    onClick={() => { setExtFormOpen(extFormOpen === "snippet" ? null : "snippet"); setExtError(""); }}
                    className="text-xs px-3 py-1.5 border border-gray-300 rounded-lg hover:bg-gray-50 cursor-pointer"
                  >
                    {extFormOpen === "snippet" ? (t.cancel || "Cancel") : `+ ${t.extAddSnippet || "Snippet"}`}
                  </button>
                </div>
              )}
            </div>

            {(detail.callouts?.length || 0) === 0 && (detail.structuredSnippets?.length || 0) === 0 && !extFormOpen && (
              <p className="text-xs text-gray-400">{t.extEmpty || "Callouts are short selling points (\"Free shipping\"); snippets list your offerings under a header. Both lift CTR at no extra cost."}</p>
            )}

            {(detail.callouts?.length || 0) > 0 && (
              <div className="flex flex-wrap gap-1.5 mb-2">
                {(detail.callouts || []).map((c) => (
                  <span key={c.resourceName} className="px-2 py-0.5 bg-emerald-50 text-emerald-700 text-xs rounded-full inline-flex items-center gap-1">
                    {c.text}
                    {canEdit && (
                      <button
                        onClick={() => handleRemoveExtension(c.resourceName)}
                        disabled={removingExt === c.resourceName}
                        className="text-emerald-400 hover:text-emerald-800 cursor-pointer disabled:opacity-50"
                      >
                        {removingExt === c.resourceName ? "…" : "×"}
                      </button>
                    )}
                  </span>
                ))}
              </div>
            )}

            {(detail.structuredSnippets?.length || 0) > 0 && (
              <div className="space-y-1.5">
                {(detail.structuredSnippets || []).map((s) => (
                  <div key={s.resourceName} className="flex items-center gap-2 text-xs">
                    <span className="font-medium text-gray-700">{s.header}:</span>
                    <span className="text-gray-500 truncate">{s.values.join(" · ")}</span>
                    {canEdit && (
                      <button
                        onClick={() => handleRemoveExtension(s.resourceName)}
                        disabled={removingExt === s.resourceName}
                        className="text-gray-300 hover:text-red-600 cursor-pointer disabled:opacity-50"
                      >
                        {removingExt === s.resourceName ? "…" : "×"}
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}

            {extFormOpen === "callout" && (
              <div className="mt-4 border-t border-gray-100 pt-4 space-y-3">
                <div className="flex items-center justify-between">
                  <label className="block text-xs text-gray-500">{t.extCalloutLabel || "Callouts (one per line, ≤25 chars each)"}</label>
                  <button
                    onClick={() => handleGenerateExtensions("callouts")}
                    disabled={genExtLoading !== null}
                    className="text-xs px-2 py-1 border border-purple-200 text-purple-700 rounded hover:bg-purple-50 disabled:opacity-50 cursor-pointer"
                  >
                    {genExtLoading === "callouts" ? (t.adCopyGenerating || "Generating…") : `✨ ${t.extGenerate || "Generate from site"}`}
                  </button>
                </div>
                <textarea
                  value={calloutText}
                  onChange={(e) => setCalloutText(e.target.value)}
                  rows={3}
                  placeholder={"Free shipping\n24/7 support\nPrice match"}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm outline-none focus:ring-2 focus:ring-red-500"
                />
                {extError && <pre className="text-xs text-red-600 bg-red-50 p-2 rounded whitespace-pre-wrap break-all">{extError}</pre>}
                <div className="flex gap-2">
                  <button onClick={handleAddExtension} disabled={extSubmitting} className="bg-red-800 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-red-900 disabled:opacity-50 cursor-pointer">
                    {extSubmitting ? (t.creating || "Adding...") : (t.extAddCallout || "Add Callouts")}
                  </button>
                  <button onClick={() => setExtFormOpen(null)} className="px-4 py-2 border border-gray-300 rounded-lg text-sm hover:bg-gray-50 cursor-pointer">{t.cancel || "Cancel"}</button>
                </div>
              </div>
            )}

            {extFormOpen === "snippet" && (
              <div className="mt-4 border-t border-gray-100 pt-4 space-y-3">
                <div className="flex items-center gap-2">
                  <label className="text-xs text-gray-500">{t.extSnippetHeader || "Header"}:</label>
                  <select
                    value={snippetHeader}
                    onChange={(e) => setSnippetHeader(e.target.value)}
                    className="text-xs px-2 py-1 border border-gray-300 rounded outline-none bg-white"
                  >
                    {SNIPPET_HEADERS.map((h) => <option key={h} value={h}>{h}</option>)}
                  </select>
                </div>
                <label className="block text-xs text-gray-500">{t.extSnippetLabel || "Values (one per line, 3-10 total, ≤25 chars each)"}</label>
                <textarea
                  value={snippetValues}
                  onChange={(e) => setSnippetValues(e.target.value)}
                  rows={4}
                  placeholder={"SEO\nPPC management\nEmail marketing"}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm outline-none focus:ring-2 focus:ring-red-500"
                />
                {extError && <pre className="text-xs text-red-600 bg-red-50 p-2 rounded whitespace-pre-wrap break-all">{extError}</pre>}
                <div className="flex gap-2">
                  <button onClick={handleAddExtension} disabled={extSubmitting} className="bg-red-800 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-red-900 disabled:opacity-50 cursor-pointer">
                    {extSubmitting ? (t.creating || "Adding...") : (t.extAddSnippet || "Add Snippet")}
                  </button>
                  <button onClick={() => setExtFormOpen(null)} className="px-4 py-2 border border-gray-300 rounded-lg text-sm hover:bg-gray-50 cursor-pointer">{t.cancel || "Cancel"}</button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Location bid adjustments — campaign-level criteria only */}
        {detail && DEVICE_MOD_CHANNELS.has(detail.channelType) && campaignLevelLocations().length > 0 && (
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-gray-700">📍 {t.locModSection || "Location Bid Adjustments"}</h2>
              {canEdit && !editingLocMods && (
                <button
                  onClick={openLocModEditor}
                  className="text-xs px-3 py-1.5 border border-gray-300 rounded-lg hover:bg-gray-50 cursor-pointer"
                >
                  ✏️ {t.schedEdit || "Edit"}
                </button>
              )}
            </div>

            {!editingLocMods && (
              <div className="flex flex-wrap gap-1.5">
                {campaignLevelLocations().map((l) => {
                  const pct = Math.round(((l.bidModifier ?? 1) - 1) * 100);
                  return (
                    <span
                      key={l.id}
                      className={`px-2 py-0.5 text-xs rounded-full ${
                        pct > 0 ? "bg-green-50 text-green-700" :
                        pct < 0 ? "bg-amber-50 text-amber-700" :
                        "bg-gray-100 text-gray-600"
                      }`}
                    >
                      {l.name}{pct !== 0 ? ` ${pct > 0 ? "+" : ""}${pct}%` : ""}
                    </span>
                  );
                })}
              </div>
            )}

            {editingLocMods && (
              <div className="space-y-3">
                {locModRows.map((row, i) => (
                  <div key={row.geoId} className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs text-gray-700 min-w-32">{row.name}</span>
                    <input
                      type="number" min="-90" max="900" step="1"
                      value={row.percent}
                      onChange={(e) => setLocModRows(locModRows.map((r, j) => j === i ? { ...r, percent: Number(e.target.value) } : r))}
                      className="text-xs px-2 py-1 border border-gray-300 rounded outline-none w-20"
                    />
                    <span className="text-xs text-gray-400">% (−90 … +900, 0 = {t.devDefault || "default"})</span>
                  </div>
                ))}
                {locModError && <pre className="text-xs text-red-600 bg-red-50 p-2 rounded whitespace-pre-wrap break-all">{locModError}</pre>}
                <div className="flex gap-2">
                  <button
                    onClick={handleSaveLocMods}
                    disabled={savingLocMods}
                    className="bg-red-800 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-red-900 disabled:opacity-50 cursor-pointer"
                  >
                    {savingLocMods ? (t.creating || "Saving...") : (t.save || "Save")}
                  </button>
                  <button onClick={() => setEditingLocMods(false)} className="px-4 py-2 border border-gray-300 rounded-lg text-sm hover:bg-gray-50 cursor-pointer">
                    {t.cancel || "Cancel"}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Device bid adjustments */}
        {detail && DEVICE_MOD_CHANNELS.has(detail.channelType) && (
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-gray-700">📱 {t.devSection || "Device Bid Adjustments"}</h2>
              {canEdit && !editingDevices && (
                <button
                  onClick={openDeviceEditor}
                  className="text-xs px-3 py-1.5 border border-gray-300 rounded-lg hover:bg-gray-50 cursor-pointer"
                >
                  ✏️ {t.schedEdit || "Edit"}
                </button>
              )}
            </div>

            {!editingDevices && (
              <div className="flex flex-wrap gap-1.5">
                {deviceRowsFromDetail(detail.deviceModifiers).map((r) => (
                  <span
                    key={r.device}
                    className={`px-2 py-0.5 text-xs rounded-full ${
                      r.mode === "exclude" ? "bg-red-50 text-red-700 line-through" :
                      r.mode === "adjust" ? (r.percent > 0 ? "bg-green-50 text-green-700" : "bg-amber-50 text-amber-700") :
                      "bg-gray-100 text-gray-600"
                    }`}
                  >
                    {DEVICE_ICON[r.device]} {r.device}
                    {r.mode === "adjust" ? ` ${r.percent > 0 ? "+" : ""}${r.percent}%` : r.mode === "exclude" ? "" : ` ${t.devDefault || "default"}`}
                  </span>
                ))}
              </div>
            )}

            {editingDevices && (
              <div className="space-y-3">
                {deviceRows.map((row, i) => (
                  <div key={row.device} className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs text-gray-700 w-24">{DEVICE_ICON[row.device]} {row.device}</span>
                    <select
                      value={row.mode}
                      onChange={(e) => setDeviceRows(deviceRows.map((r, j) => j === i ? { ...r, mode: e.target.value as DeviceModRow["mode"] } : r))}
                      className="text-xs px-2 py-1 border border-gray-300 rounded outline-none bg-white"
                    >
                      <option value="default">{t.devDefault || "default"}</option>
                      <option value="adjust">{t.devAdjust || "adjust bid"}</option>
                      <option value="exclude">{t.devExclude || "exclude"}</option>
                    </select>
                    {row.mode === "adjust" && (
                      <>
                        <input
                          type="number" min="-90" max="900" step="1"
                          value={row.percent}
                          onChange={(e) => setDeviceRows(deviceRows.map((r, j) => j === i ? { ...r, percent: Number(e.target.value) } : r))}
                          className="text-xs px-2 py-1 border border-gray-300 rounded outline-none w-20"
                        />
                        <span className="text-xs text-gray-400">% (−90 … +900)</span>
                      </>
                    )}
                  </div>
                ))}
                {deviceError && <pre className="text-xs text-red-600 bg-red-50 p-2 rounded whitespace-pre-wrap break-all">{deviceError}</pre>}
                <div className="flex gap-2">
                  <button
                    onClick={handleSaveDevices}
                    disabled={savingDevices}
                    className="bg-red-800 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-red-900 disabled:opacity-50 cursor-pointer"
                  >
                    {savingDevices ? (t.creating || "Saving...") : (t.save || "Save")}
                  </button>
                  <button onClick={() => setEditingDevices(false)} className="px-4 py-2 border border-gray-300 rounded-lg text-sm hover:bg-gray-50 cursor-pointer">
                    {t.cancel || "Cancel"}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Negative keywords — campaign level */}
        {detail && NEG_KW_CHANNELS.has(detail.channelType) && (
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-gray-700">
                {t.negKwSection || "Negative Keywords"} ({detail.negativeKeywords?.length || 0})
              </h2>
              {canEdit && (
                <button
                  onClick={() => { setNegKwFormOpen(!negKwFormOpen); setNegKwError(""); }}
                  className="text-xs px-3 py-1.5 border border-gray-300 rounded-lg hover:bg-gray-50 cursor-pointer"
                >
                  {negKwFormOpen ? (t.cancel || "Cancel") : `+ ${t.negKwAdd || "Add Negative Keywords"}`}
                </button>
              )}
            </div>
            {(detail.negativeKeywords?.length || 0) === 0 && !negKwFormOpen && (
              <p className="text-xs text-gray-400">{t.negKwEmpty || "No negative keywords yet. Add terms you never want to match on."}</p>
            )}
            <div className="flex flex-wrap gap-1.5">
              {(detail.negativeKeywords || []).map((kw) => (
                <span key={kw.resourceName} className="px-2 py-0.5 bg-red-50 text-red-700 text-xs rounded-full inline-flex items-center gap-1">
                  {kw.text} <span className="text-red-400">[{kw.matchType}]</span>
                  {canEdit && (
                    <button
                      onClick={() => handleRemoveNegativeKeyword(kw.resourceName)}
                      disabled={removingNegKw === kw.resourceName}
                      className="text-red-400 hover:text-red-800 cursor-pointer disabled:opacity-50"
                      title={t.negKwRemove || "Remove"}
                    >
                      {removingNegKw === kw.resourceName ? "…" : "×"}
                    </button>
                  )}
                </span>
              ))}
            </div>
            {negKwFormOpen && (
              <div className="mt-4 border-t border-gray-100 pt-4 space-y-3">
                <div>
                  <label className="block text-xs text-gray-500 mb-1">
                    {t.kwLabel || "Keywords (one per line, ≤80 chars each). Prefix with [exact] / [phrase] / [broad] to override the default."}
                  </label>
                  <textarea
                    value={negKwText}
                    onChange={(e) => setNegKwText(e.target.value)}
                    rows={4}
                    placeholder={"free\n[exact] cheap alternative\n[phrase] refund"}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm outline-none focus:ring-2 focus:ring-red-500 font-mono"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <label className="text-xs text-gray-500">{t.kwDefaultMatchType || "Default match type"}:</label>
                  <select
                    value={negKwMatchType}
                    onChange={(e) => setNegKwMatchType(e.target.value as "BROAD" | "PHRASE" | "EXACT")}
                    className="text-xs px-2 py-1 border border-gray-300 rounded outline-none bg-white"
                  >
                    <option value="BROAD">BROAD</option>
                    <option value="PHRASE">PHRASE</option>
                    <option value="EXACT">EXACT</option>
                  </select>
                </div>
                {negKwError && <pre className="text-xs text-red-600 bg-red-50 p-2 rounded whitespace-pre-wrap break-all">{negKwError}</pre>}
                <div className="flex gap-2">
                  <button
                    onClick={handleAddNegativeKeywords}
                    disabled={negKwSubmitting}
                    className="bg-red-800 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-red-900 disabled:opacity-50 cursor-pointer"
                  >
                    {negKwSubmitting ? (t.creating || "Adding...") : (t.negKwAdd || "Add Negative Keywords")}
                  </button>
                  <button onClick={() => { setNegKwFormOpen(false); setNegKwError(""); }} className="px-4 py-2 border border-gray-300 rounded-lg text-sm hover:bg-gray-50 cursor-pointer">
                    {t.cancel || "Cancel"}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Ads */}
        {detail?.ads && detail.ads.length > 0 && (
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <h2 className="text-sm font-semibold text-gray-700 mb-3">{t.adsSection || "Ads"} ({detail.ads.length})</h2>
            <div className="space-y-4">
              {detail.ads.map((ad, i) => (
                <div key={i} className="border border-gray-100 rounded-lg p-4">
                  {/* Header */}
                  <div className="flex flex-wrap items-center gap-2 mb-3">
                    <span className="font-medium text-gray-800">{ad.name || `Ad #${i + 1}`}</span>
                    <span className={`px-1.5 py-0.5 text-xs rounded-full ${
                      ad.status === "ENABLED" ? "bg-green-50 text-green-700" :
                      ad.status === "PAUSED" ? "bg-yellow-50 text-yellow-700" :
                      "bg-gray-100 text-gray-600"
                    }`}>{ad.status}</span>
                    {ad.type && <span className="px-1.5 py-0.5 bg-blue-50 text-blue-700 text-xs rounded-full">{ad.type}</span>}
                  </div>

                  {/* Videos */}
                  {ad.videos.length > 0 && (
                    <div className="mb-3 grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {ad.videos.map((v, idx) => (
                        <div key={idx} className="flex gap-2 items-start bg-gray-50 rounded p-2">
                          {v.youtubeVideoId ? (
                            <a href={`https://www.youtube.com/watch?v=${v.youtubeVideoId}`} target="_blank" rel="noreferrer" className="shrink-0">
                              <img src={`https://i.ytimg.com/vi/${v.youtubeVideoId}/default.jpg`} alt={v.title} className="w-24 h-auto rounded" />
                            </a>
                          ) : null}
                          <div className="text-xs min-w-0">
                            {v.title && <div className="text-gray-800 truncate font-medium">{v.title}</div>}
                            {v.youtubeVideoId && (
                              <a href={`https://www.youtube.com/watch?v=${v.youtubeVideoId}`} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline break-all">
                                youtube.com/watch?v={v.youtubeVideoId}
                              </a>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Headlines */}
                  {ad.headlines.length > 0 && (
                    <div className="mb-2">
                      <div className="text-xs text-gray-500 mb-1">{t.headlines || "Headlines"} ({ad.headlines.length})</div>
                      <div className="flex flex-wrap gap-1">
                        {ad.headlines.map((h, idx) => (
                          <span key={idx} className="text-xs px-2 py-0.5 bg-gray-100 rounded text-gray-800">{h}</span>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Long headlines */}
                  {ad.longHeadlines.length > 0 && (
                    <div className="mb-2">
                      <div className="text-xs text-gray-500 mb-1">{t.longHeadlineLabel || "Long headlines"} ({ad.longHeadlines.length})</div>
                      <ul className="text-sm text-gray-700 space-y-0.5">
                        {ad.longHeadlines.map((h, idx) => <li key={idx}>• {h}</li>)}
                      </ul>
                    </div>
                  )}

                  {/* Descriptions */}
                  {ad.descriptions.length > 0 && (
                    <div className="mb-2">
                      <div className="text-xs text-gray-500 mb-1">{t.descriptions || "Descriptions"} ({ad.descriptions.length})</div>
                      <ul className="text-sm text-gray-600 space-y-0.5">
                        {ad.descriptions.map((d, idx) => <li key={idx}>• {d}</li>)}
                      </ul>
                    </div>
                  )}

                  {/* CTA */}
                  {ad.callToActions.length > 0 && (
                    <div className="mb-2">
                      <span className="text-xs text-gray-500">{t.ctaLabel || "Call to action"}: </span>
                      {ad.callToActions.map((c, idx) => (
                        <span key={idx} className="text-xs px-2 py-0.5 bg-emerald-50 text-emerald-700 rounded ml-1">{c}</span>
                      ))}
                    </div>
                  )}

                  {/* Final URL */}
                  {ad.finalUrls.length > 0 && (
                    <div className="text-xs pt-2 border-t border-gray-100 mt-2">
                      <span className="text-gray-500">{t.finalUrl || "Final URL"}: </span>
                      {ad.finalUrls.map((url, idx) => (
                        <a key={idx} href={url} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline break-all">{url}</a>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>

            <p className="text-xs text-gray-400 mt-3">
              ℹ️ {t.adImmutableNote || "Ad creative content (headlines, descriptions, videos) is immutable in Google Ads — to change them, create a new ad and remove the old one."}
            </p>
          </div>
        )}
      </div>
    </DashboardShell>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs text-gray-500 mb-0.5">{label}</div>
      <div className="text-base font-semibold text-gray-900">{value}</div>
    </div>
  );
}

interface DailyMetric { date: string; impressions: number; clicks: number; costMicros: number; conversions: number }
type ChartMetric = "costMicros" | "impressions" | "clicks" | "conversions";

function DailyChart({ data, t }: { data: DailyMetric[]; t: Record<string, string> }) {
  const [metric, setMetric] = useState<ChartMetric>("costMicros");
  if (data.length === 0) return null;

  const values = data.map((d) => d[metric] as number);
  const max = Math.max(...values);
  const totalImp = data.reduce((s, d) => s + d.impressions, 0);
  const allZero = max === 0;

  const W = 600;
  const H = 100;
  const padL = 28;
  const padR = 8;
  const padT = 8;
  const padB = 18;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;
  const barW = innerW / data.length;

  const fmt = (v: number) => {
    if (metric === "costMicros") return `$${(v / 1_000_000).toFixed(2)}`;
    if (metric === "conversions") return v.toFixed(1);
    return v.toLocaleString();
  };
  const fmtAxis = (v: number) => {
    if (metric === "costMicros") return `$${Math.round(v / 1_000_000)}`;
    if (v >= 1000) return `${(v / 1000).toFixed(1)}k`;
    return String(Math.round(v));
  };

  const metricOptions: Array<{ id: ChartMetric; label: string }> = [
    { id: "costMicros",  label: t.metricCost || "Cost" },
    { id: "impressions", label: t.metricImpressions || "Impressions" },
    { id: "clicks",      label: t.metricClicks || "Clicks" },
    { id: "conversions", label: t.metricConversions || "Conversions" },
  ];

  // Y-axis ticks: 0, mid, max
  const yMax = allZero ? 1 : max;
  const ticks = [yMax, yMax / 2, 0];

  return (
    <div className="bg-white border border-gray-100 rounded-xl p-3 mt-2 relative">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs text-gray-500">{t.dailyTrend || "Daily trend"}</span>
        <div className="flex gap-1">
          {metricOptions.map((opt) => (
            <button
              key={opt.id}
              onClick={() => setMetric(opt.id)}
              className={`text-xs px-2 py-0.5 rounded cursor-pointer ${metric === opt.id ? "bg-emerald-100 text-emerald-800 font-medium" : "text-gray-500 hover:bg-gray-100"}`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>
      <div className="relative">
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" preserveAspectRatio="none">
          {ticks.map((tv, i) => {
            const y = padT + (1 - tv / yMax) * innerH;
            return (
              <g key={i}>
                <line x1={padL} y1={y} x2={W - padR} y2={y} stroke="#e5e7eb" strokeWidth={1} strokeDasharray={i === ticks.length - 1 ? "0" : "2 3"} />
                <text x={padL - 4} y={y + 3} textAnchor="end" fontSize={9} fill="#9ca3af">{fmtAxis(tv)}</text>
              </g>
            );
          })}
          {data.map((d, i) => {
            const v = d[metric] as number;
            const x = padL + i * barW + 1;
            const w = Math.max(barW - 2, 1);
            const h = allZero ? 0 : (v / yMax) * innerH;
            const y = padT + innerH - h;
            return (
              <rect key={d.date} x={x} y={y} width={w} height={h || 0.5} fill={v > 0 ? "#10b981" : "#e5e7eb"}>
                <title>{`${d.date} · ${fmt(v)}`}</title>
              </rect>
            );
          })}
          {[0, Math.floor(data.length / 2), data.length - 1].map((i) => (
            <text key={i} x={padL + i * barW + barW / 2} y={H - 4} textAnchor="middle" fontSize={9} fill="#9ca3af">
              {data[i]?.date.slice(5) /* MM-DD */}
            </text>
          ))}
        </svg>
        {allZero && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="text-xs text-gray-400 bg-white/80 px-2 py-1 rounded">
              {totalImp === 0 ? (t.chartNoTrafficYet || "No traffic yet — Google may still be reviewing the campaign") : (t.chartZeroForMetric || "No data for this metric in the last 30 days")}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
