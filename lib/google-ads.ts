const GOOGLE_ADS_API_VERSION = "v20";
const OAUTH_TOKEN_URL = "https://oauth2.googleapis.com/token";
const ADS_API_BASE = `https://googleads.googleapis.com/${GOOGLE_ADS_API_VERSION}`;

let cachedAccessToken: { token: string; expiresAt: number } | null = null;

export async function getAccessToken(): Promise<string> {
  if (cachedAccessToken && cachedAccessToken.expiresAt > Date.now() + 60_000) {
    return cachedAccessToken.token;
  }

  const clientId = process.env.GOOGLE_ADS_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_ADS_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_ADS_REFRESH_TOKEN;

  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error("Google Ads OAuth credentials not configured");
  }

  const res = await fetch(OAUTH_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });

  if (!res.ok) {
    throw new Error(`OAuth token request failed: ${res.status} ${await res.text()}`);
  }

  const data = (await res.json()) as { access_token: string; expires_in: number };
  cachedAccessToken = {
    token: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  };
  return data.access_token;
}

function adsHeaders(accessToken: string): Record<string, string> {
  const developerToken = process.env.GOOGLE_ADS_DEVELOPER_TOKEN;
  if (!developerToken) throw new Error("GOOGLE_ADS_DEVELOPER_TOKEN not configured");

  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    "developer-token": developerToken,
    "Content-Type": "application/json",
  };
  const loginCustomerId = process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID;
  if (loginCustomerId) headers["login-customer-id"] = loginCustomerId;
  return headers;
}

export async function adsMutate(customerId: string, endpoint: string, body: unknown): Promise<{ data: unknown; status: number }> {
  const accessToken = await getAccessToken();
  const url = `${ADS_API_BASE}/customers/${customerId}/${endpoint}`;
  const res = await fetch(url, {
    method: "POST",
    headers: adsHeaders(accessToken),
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { parsed = { error: text }; }
  return { data: parsed, status: res.status };
}

export interface AccountLinkInfo {
  resourceName: string;
  type: string;          // YOUTUBE_CHANNEL, MERCHANT_CENTER, ...
  status: string;        // ENABLED, PENDING_APPROVAL, REVOKED, REJECTED, ...
  details: Record<string, unknown>;
}

/** List all customers the OAuth refresh_token can access (including manager accounts). */
export async function listAccessibleCustomers(): Promise<string[]> {
  const accessToken = await getAccessToken();
  const developerToken = process.env.GOOGLE_ADS_DEVELOPER_TOKEN;
  if (!developerToken) throw new Error("GOOGLE_ADS_DEVELOPER_TOKEN not configured");

  const res = await fetch(`${ADS_API_BASE}/customers:listAccessibleCustomers`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "developer-token": developerToken,
    },
  });
  if (!res.ok) {
    throw new Error(`listAccessibleCustomers failed: ${res.status} ${await res.text()}`);
  }
  const data = (await res.json()) as { resourceNames?: string[] };
  // resourceNames are like "customers/1234567890"
  return (data.resourceNames || []).map((rn) => rn.replace("customers/", ""));
}

/** Get basic info (name, manager flag, currency) for a specific customer ID. */
export async function fetchCustomerInfo(customerId: string): Promise<{ id: string; name: string; manager: boolean; testAccount: boolean; currency: string; timeZone: string } | null> {
  try {
    type Row = {
      customer: {
        id?: string;
        descriptiveName?: string;
        manager?: boolean;
        testAccount?: boolean;
        currencyCode?: string;
        timeZone?: string;
      };
    };
    const rows = await adsSearchStream(customerId, `
      SELECT customer.id, customer.descriptive_name, customer.manager, customer.test_account,
             customer.currency_code, customer.time_zone
      FROM customer LIMIT 1
    `) as Row[];
    const c = rows[0]?.customer;
    if (!c) return null;
    return {
      id: c.id || customerId,
      name: c.descriptiveName || "",
      manager: !!c.manager,
      testAccount: !!c.testAccount,
      currency: c.currencyCode || "",
      timeZone: c.timeZone || "",
    };
  } catch {
    return null;
  }
}

/** Fetch all account links (YouTube, Merchant Center, etc.) for the configured customer. */
export async function fetchAccountLinks(): Promise<AccountLinkInfo[]> {
  const customerId = process.env.GOOGLE_ADS_CUSTOMER_ID;
  if (!customerId) throw new Error("GOOGLE_ADS_CUSTOMER_ID not configured");

  type Row = {
    accountLink: {
      resourceName: string;
      accountLinkId?: string;
      type?: string;
      status?: string;
    };
  };
  const rows = await adsSearchStream(customerId, `
    SELECT account_link.resource_name, account_link.account_link_id,
           account_link.type, account_link.status
    FROM account_link
  `) as Row[];

  return rows.map((r) => ({
    resourceName: r.accountLink.resourceName,
    type: r.accountLink.type || "",
    status: r.accountLink.status || "",
    details: {
      accountLinkId: r.accountLink.accountLinkId,
    },
  }));
}

/** Fetch linked YouTube channels specifically (separate resource in some API versions). */
export async function fetchYouTubeChannels(): Promise<Array<{ resourceName: string; channelId: string; channelName: string }>> {
  const customerId = process.env.GOOGLE_ADS_CUSTOMER_ID;
  if (!customerId) throw new Error("GOOGLE_ADS_CUSTOMER_ID not configured");

  // In v20, YouTube channels may be exposed via youtube_video_asset or via linked-account-specific resources.
  // Try the straightforward customer_user_access proxy first; if that fails, the link may not be exposed via search.
  // We attempt to query the youtube_channel_info sub-resource via customer.
  try {
    type Row = {
      customer: { id?: string };
    };
    // Fallback: just confirm we can read customer (no v20 resource exposes YT channel info via GAQL search).
    await adsSearchStream(customerId, `SELECT customer.id FROM customer LIMIT 1`) as Row[];
  } catch { /* ignore */ }
  return [];
}

export interface GeoTargetSuggestion {
  id: string;
  name: string;
  canonicalName: string;
  countryCode: string;
  targetType: string;   // e.g. Country, Region, City, Postal Code, Airport, etc.
  status: string;       // ENABLED / REMOVAL_PLANNED
}

/** Search Google Ads' global geo_target_constants by free-text. Powers state/city/postcode targeting. */
export async function suggestGeoTargets(query: string, locale = "en", countryCode?: string): Promise<GeoTargetSuggestion[]> {
  const accessToken = await getAccessToken();
  const developerToken = process.env.GOOGLE_ADS_DEVELOPER_TOKEN;
  if (!developerToken) throw new Error("GOOGLE_ADS_DEVELOPER_TOKEN not configured");

  const body: Record<string, unknown> = {
    locale,
    locationNames: { names: [query] },
  };
  if (countryCode) body.countryCode = countryCode;

  const res = await fetch(`${ADS_API_BASE}/geoTargetConstants:suggest`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "developer-token": developerToken,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`suggestGeoTargets failed: ${res.status} ${await res.text()}`);
  }
  // Response shape: { geoTargetConstantSuggestions: [{ geoTargetConstant: {...}, geoTargetConstantParents: [...], reach, ...}] }
  type Row = { geoTargetConstant?: { id?: string; name?: string; canonicalName?: string; countryCode?: string; targetType?: string; status?: string } };
  const data = (await res.json()) as { geoTargetConstantSuggestions?: Row[] };
  const suggestions = data.geoTargetConstantSuggestions || [];
  return suggestions.map((s) => {
    const g = s.geoTargetConstant || {};
    return {
      id: String(g.id || ""),
      name: g.name || "",
      canonicalName: g.canonicalName || "",
      countryCode: g.countryCode || "",
      targetType: g.targetType || "",
      status: g.status || "",
    };
  }).filter((g) => g.id && g.status !== "REMOVAL_PLANNED");
}

export async function adsSearchStream(customerId: string, query: string): Promise<unknown[]> {
  const accessToken = await getAccessToken();
  const url = `${ADS_API_BASE}/customers/${customerId}/googleAds:searchStream`;
  const res = await fetch(url, {
    method: "POST",
    headers: adsHeaders(accessToken),
    body: JSON.stringify({ query }),
  });
  if (!res.ok) {
    throw new Error(`searchStream failed: ${res.status} ${await res.text()}`);
  }
  const data = (await res.json()) as Array<{ results?: unknown[] }>;
  const rows: unknown[] = [];
  for (const chunk of data) {
    if (chunk.results) rows.push(...chunk.results);
  }
  return rows;
}

/** Common Google Ads geo_target_constants. ID = country code numeric. */
export const COUNTRIES: Array<{ id: string; code: string; name: string }> = [
  { id: "2840", code: "US", name: "United States" },
  { id: "2124", code: "CA", name: "Canada" },
  { id: "2826", code: "GB", name: "United Kingdom" },
  { id: "2036", code: "AU", name: "Australia" },
  { id: "2554", code: "NZ", name: "New Zealand" },
  { id: "2392", code: "JP", name: "Japan" },
  { id: "2410", code: "KR", name: "South Korea" },
  { id: "2156", code: "CN", name: "China" },
  { id: "2158", code: "TW", name: "Taiwan" },
  { id: "2344", code: "HK", name: "Hong Kong" },
  { id: "2702", code: "SG", name: "Singapore" },
  { id: "2356", code: "IN", name: "India" },
  { id: "2276", code: "DE", name: "Germany" },
  { id: "2250", code: "FR", name: "France" },
  { id: "2724", code: "ES", name: "Spain" },
  { id: "2380", code: "IT", name: "Italy" },
  { id: "2528", code: "NL", name: "Netherlands" },
  { id: "2484", code: "MX", name: "Mexico" },
  { id: "2076", code: "BR", name: "Brazil" },
  { id: "2784", code: "AE", name: "United Arab Emirates" },
];

export interface CreateCampaignInput {
  name: string;
  dailyBudget: number;
  channel?: "SEARCH" | "DISPLAY" | "SHOPPING" | "VIDEO" | "PERFORMANCE_MAX";
  /** Geo target constant IDs (e.g. ['2840','2124'] for US+CA). Empty = worldwide. */
  locationIds?: string[];
}

export interface CreateCampaignResult {
  budget: string | null;
  campaign: string | null;
  errors: Array<{ step: string; details: unknown }>;
}

export type AudienceApiType =
  | "AGE_RANGE"
  | "GENDER"
  | "PARENTAL_STATUS"
  | "INCOME_RANGE"
  | "USER_INTEREST"
  | "TOPIC"
  | "USER_LIST"
  | "CUSTOM_AUDIENCE";

export interface AudienceCriterionInput {
  apiType: AudienceApiType;
  value: string;
  negative?: boolean;
}

export interface CampaignDetail {
  resourceName: string;
  name: string;
  status: string;
  channelType: string;
  startDate?: string;
  endDate?: string;
  optimizationScore?: number;
  metrics: {
    impressions: number;
    clicks: number;
    costMicros: number;
    conversions: number;
    ctr: number;
    avgCpcMicros: number;
  };
  /** Last 30 days, one entry per calendar day (zeros filled for days with no data). */
  dailyMetrics: Array<{
    date: string;        // YYYY-MM-DD
    impressions: number;
    clicks: number;
    costMicros: number;
    conversions: number;
  }>;
  /** bidModifier present only for campaign-level criteria (undefined = ad-group level / no data). */
  locations: Array<{ id: string; name: string; bidModifier?: number }>;
  audiences: Array<{
    category: string;
    label: string;
    negative: boolean;
    adGroupName: string;
    apiType: AudienceApiType | "";
    value: string;
  }>;
  adGroups: Array<{ resourceName: string; name: string; status: string; cpcBidMicros: number }>;
  /** Performance Max only — PMax has no ad groups, instead it has asset groups. Empty for other channels. */
  assetGroups: Array<{ resourceName: string; name: string; status: string; adStrength: string; primaryStatus: string; primaryStatusReasons: string[]; finalUrls: string[] }>;
  keywords: Array<{ text: string; matchType: string }>;
  /** Google's reported bidding strategy + targets (micros / ratio) when set. */
  bidding: { strategyType: string; targetCpaMicros: number; targetRoas: number };
  /** Campaign-level negative keywords. resourceName is needed for removal. */
  negativeKeywords: Array<{ resourceName: string; text: string; matchType: string }>;
  /** Day-parting intervals. Empty = runs at all times. bidModifier 1 = none. */
  adSchedules: Array<{ resourceName: string; dayOfWeek: string; startHour: number; endHour: number; bidModifier: number }>;
  /** Device bid adjustments. bidModifier 0 = excluded; empty = defaults. */
  deviceModifiers: Array<{ resourceName: string; device: string; bidModifier: number }>;
  /** Sitelink extensions attached to the campaign. resourceName = campaign_asset link (for removal). */
  sitelinks: Array<{ resourceName: string; linkText: string; finalUrl: string; description1: string; description2: string }>;
  /** Callout extensions. resourceName = campaign_asset link. */
  callouts: Array<{ resourceName: string; text: string }>;
  /** Structured snippet extensions. resourceName = campaign_asset link. */
  structuredSnippets: Array<{ resourceName: string; header: string; values: string[] }>;
  /** Call extensions. resourceName = campaign_asset link. */
  callAssets: Array<{ resourceName: string; countryCode: string; phoneNumber: string }>;
  /** Price extensions. resourceName = campaign_asset link. Offering prices in currency units. */
  prices: Array<{
    resourceName: string;
    type: string;
    priceQualifier: string;
    offerings: Array<{ header: string; description: string; price: number; currencyCode: string; unit: string; finalUrl: string }>;
  }>;
  /** Promotion extensions. resourceName = campaign_asset link. percentOff in whole percent (10 = 10%). */
  promotions: Array<{
    resourceName: string;
    promotionTarget: string;
    percentOff: number;
    moneyAmountOff: number;
    currencyCode: string;
    promotionCode: string;
    occasion: string;
    redemptionStartDate: string;
    redemptionEndDate: string;
    finalUrl: string;
  }>;
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

export async function fetchCampaignDetail(resourceName: string): Promise<CampaignDetail> {
  const customerId = process.env.GOOGLE_ADS_CUSTOMER_ID;
  if (!customerId) throw new Error("GOOGLE_ADS_CUSTOMER_ID not configured");

  const escaped = resourceName.replace(/'/g, "''");

  // Campaign settings + per-day metrics (last 30 days, one row per calendar day)
  type CampaignRow = {
    campaign: {
      name: string; status: string; advertisingChannelType: string; startDate?: string; endDate?: string; optimizationScore?: number;
      biddingStrategyType?: string;
      maximizeConversions?: { targetCpaMicros?: string };
      maximizeConversionValue?: { targetRoas?: number };
    };
    metrics?: { impressions?: string; clicks?: string; costMicros?: string; conversions?: number; ctr?: number; averageCpc?: string };
    segments?: { date?: string };
  };
  const campaignRows = await adsSearchStream(customerId, `
    SELECT campaign.name, campaign.status, campaign.advertising_channel_type, campaign.start_date, campaign.end_date, campaign.optimization_score,
           campaign.bidding_strategy_type, campaign.maximize_conversions.target_cpa_micros, campaign.maximize_conversion_value.target_roas,
           metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions, metrics.ctr, metrics.average_cpc,
           segments.date
    FROM campaign
    WHERE campaign.resource_name = '${escaped}' AND segments.date DURING LAST_30_DAYS
  `) as CampaignRow[];

  // Aggregate + capture per-day breakdown
  let impressions = 0, clicks = 0, costMicros = 0, conversions = 0;
  const byDate = new Map<string, { impressions: number; clicks: number; costMicros: number; conversions: number }>();
  for (const r of campaignRows) {
    const imp = Number(r.metrics?.impressions || 0);
    const clk = Number(r.metrics?.clicks || 0);
    const cost = Number(r.metrics?.costMicros || 0);
    const conv = Number(r.metrics?.conversions || 0);
    impressions += imp;
    clicks += clk;
    costMicros += cost;
    conversions += conv;
    const date = r.segments?.date;
    if (date) {
      const existing = byDate.get(date) || { impressions: 0, clicks: 0, costMicros: 0, conversions: 0 };
      byDate.set(date, {
        impressions: existing.impressions + imp,
        clicks: existing.clicks + clk,
        costMicros: existing.costMicros + cost,
        conversions: existing.conversions + conv,
      });
    }
  }
  // Fill in 30 contiguous days so the chart renders even when Google omits zero days.
  const dailyMetrics: CampaignDetail["dailyMetrics"] = [];
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  for (let i = 29; i >= 0; i--) {
    const d = new Date(today.getTime() - i * 86_400_000);
    const key = d.toISOString().slice(0, 10);
    const v = byDate.get(key) || { impressions: 0, clicks: 0, costMicros: 0, conversions: 0 };
    dailyMetrics.push({ date: key, ...v });
  }
  const first = campaignRows[0]?.campaign;

  // If no metric rows (campaign too new / paused with no impressions), still grab settings
  const settingsFallback = first ? null : await adsSearchStream(customerId, `
    SELECT campaign.name, campaign.status, campaign.advertising_channel_type, campaign.start_date, campaign.end_date, campaign.optimization_score,
           campaign.bidding_strategy_type, campaign.maximize_conversions.target_cpa_micros, campaign.maximize_conversion_value.target_roas
    FROM campaign WHERE campaign.resource_name = '${escaped}'
  `) as Array<{ campaign: CampaignRow["campaign"] }>;
  const camp = first || settingsFallback?.[0]?.campaign;

  // Location targeting — query BOTH campaign_criterion (for SEARCH/DISPLAY/etc.)
  // AND ad_group_criterion (for DEMAND_GEN / PMax which store location at ad-group level)
  const numericCampaignId = resourceName.split("/").pop() || "";
  type LocCritRow = {
    campaignCriterion: {
      type?: string;
      negative?: boolean;
      resourceName?: string;
      bidModifier?: number;
      location?: { geoTargetConstant?: string };
    };
  };
  type AGLocRow = {
    adGroupCriterion: {
      type?: string;
      negative?: boolean;
      location?: { geoTargetConstant?: string };
    };
  };
  const [locCritRows, agLocRows] = await Promise.all([
    adsSearchStream(customerId, `
      SELECT campaign_criterion.type, campaign_criterion.negative,
             campaign_criterion.resource_name, campaign_criterion.bid_modifier,
             campaign_criterion.location.geo_target_constant
      FROM campaign_criterion
      WHERE campaign.id = ${numericCampaignId} AND campaign_criterion.type = LOCATION
    `).catch(() => []) as Promise<LocCritRow[]>,
    adsSearchStream(customerId, `
      SELECT ad_group_criterion.type, ad_group_criterion.negative,
             ad_group_criterion.location.geo_target_constant
      FROM ad_group_criterion
      WHERE campaign.id = ${numericCampaignId} AND ad_group_criterion.type = LOCATION
    `).catch(() => []) as Promise<AGLocRow[]>,
  ]);
  const fromCampaign = (locCritRows as LocCritRow[])
    .filter((r) => !r.campaignCriterion.negative)
    .map((r) => r.campaignCriterion?.location?.geoTargetConstant)
    .filter(Boolean) as string[];
  const fromAdGroup = (agLocRows as AGLocRow[])
    .filter((r) => !r.adGroupCriterion.negative)
    .map((r) => r.adGroupCriterion?.location?.geoTargetConstant)
    .filter(Boolean) as string[];
  // Campaign-level criteria carry bid modifiers — keep a lookup by geo resource.
  const critByGeo = new Map<string, { bidModifier: number }>();
  for (const r of locCritRows as LocCritRow[]) {
    const geo = r.campaignCriterion?.location?.geoTargetConstant;
    if (geo && !r.campaignCriterion.negative) {
      critByGeo.set(geo, { bidModifier: Number(r.campaignCriterion.bidModifier ?? 1) });
    }
  }
  // Merge + dedupe
  const locResources = [...new Set([...fromCampaign, ...fromAdGroup])];
  let locations: Array<{ id: string; name: string; bidModifier?: number }> = [];
  if (locResources.length > 0) {
    type GeoRow = { geoTargetConstant: { resourceName?: string; id?: string; name?: string } };
    const inList = locResources.map((r) => `'${r}'`).join(",");
    const geoRows = await adsSearchStream(customerId, `
      SELECT geo_target_constant.resource_name, geo_target_constant.id, geo_target_constant.name
      FROM geo_target_constant
      WHERE geo_target_constant.resource_name IN (${inList})
    `) as GeoRow[];
    locations = geoRows.map((r) => ({
      id: String(r.geoTargetConstant.id || ""),
      name: String(r.geoTargetConstant.name || ""),
      bidModifier: critByGeo.get(r.geoTargetConstant.resourceName || "")?.bidModifier,
    }));
  }

  // Audience targeting — Demand Gen / Display / Video use multiple criterion types
  type AudienceRow = {
    adGroupCriterion: {
      type?: string;
      negative?: boolean;
      userInterest?: { userInterestCategory?: string };
      userList?: { userList?: string };
      customAudience?: { customAudience?: string };
      ageRange?: { type?: string };
      gender?: { type?: string };
      parentalStatus?: { type?: string };
      incomeRange?: { type?: string };
      topic?: { topic?: string };
    };
    adGroup?: { name?: string };
  };
  const audienceRows = await adsSearchStream(customerId, `
    SELECT ad_group_criterion.type, ad_group_criterion.negative,
           ad_group_criterion.user_interest.user_interest_category,
           ad_group_criterion.user_list.user_list,
           ad_group_criterion.custom_audience.custom_audience,
           ad_group_criterion.age_range.type,
           ad_group_criterion.gender.type,
           ad_group_criterion.parental_status.type,
           ad_group_criterion.income_range.type,
           ad_group_criterion.topic.topic,
           ad_group.name
    FROM ad_group_criterion
    WHERE campaign.id = ${numericCampaignId}
      AND ad_group_criterion.type IN (USER_INTEREST, USER_LIST, CUSTOM_AUDIENCE, AGE_RANGE, GENDER, PARENTAL_STATUS, INCOME_RANGE, TOPIC)
  `).catch(() => []) as AudienceRow[];

  // Resolve readable labels
  const userInterestRefs = new Set<string>();
  const userListRefs = new Set<string>();
  const customAudienceRefs = new Set<string>();
  const topicRefs = new Set<string>();
  for (const r of audienceRows) {
    const c = r.adGroupCriterion;
    if (c.userInterest?.userInterestCategory) userInterestRefs.add(c.userInterest.userInterestCategory);
    if (c.userList?.userList) userListRefs.add(c.userList.userList);
    if (c.customAudience?.customAudience) customAudienceRefs.add(c.customAudience.customAudience);
    if (c.topic?.topic) topicRefs.add(c.topic.topic);
  }

  const labelMap = new Map<string, string>();
  if (userInterestRefs.size > 0) {
    try {
      type Row = { userInterest: { resourceName: string; name?: string } };
      const inList = [...userInterestRefs].map((r) => `'${r}'`).join(",");
      const rows = await adsSearchStream(customerId, `
        SELECT user_interest.resource_name, user_interest.name
        FROM user_interest WHERE user_interest.resource_name IN (${inList})
      `) as Row[];
      for (const r of rows) labelMap.set(r.userInterest.resourceName, r.userInterest.name || r.userInterest.resourceName);
    } catch { /* ignore */ }
  }
  if (userListRefs.size > 0) {
    try {
      type Row = { userList: { resourceName: string; name?: string } };
      const inList = [...userListRefs].map((r) => `'${r}'`).join(",");
      const rows = await adsSearchStream(customerId, `
        SELECT user_list.resource_name, user_list.name
        FROM user_list WHERE user_list.resource_name IN (${inList})
      `) as Row[];
      for (const r of rows) labelMap.set(r.userList.resourceName, r.userList.name || r.userList.resourceName);
    } catch { /* ignore */ }
  }
  if (customAudienceRefs.size > 0) {
    try {
      type Row = { customAudience: { resourceName: string; name?: string } };
      const inList = [...customAudienceRefs].map((r) => `'${r}'`).join(",");
      const rows = await adsSearchStream(customerId, `
        SELECT custom_audience.resource_name, custom_audience.name
        FROM custom_audience WHERE custom_audience.resource_name IN (${inList})
      `) as Row[];
      for (const r of rows) labelMap.set(r.customAudience.resourceName, r.customAudience.name || r.customAudience.resourceName);
    } catch { /* ignore */ }
  }
  if (topicRefs.size > 0) {
    try {
      type Row = { topicConstant: { resourceName: string; path?: string[] } };
      const inList = [...topicRefs].map((r) => `'${r}'`).join(",");
      const rows = await adsSearchStream(customerId, `
        SELECT topic_constant.resource_name, topic_constant.path
        FROM topic_constant WHERE topic_constant.resource_name IN (${inList})
      `) as Row[];
      for (const r of rows) labelMap.set(r.topicConstant.resourceName, (r.topicConstant.path || []).join(" > "));
    } catch { /* ignore */ }
  }

  const audiences = audienceRows.map((r) => {
    const c = r.adGroupCriterion;
    let label = "";
    let category = c.type || "";
    let apiType: AudienceApiType | "" = "";
    let value = "";
    if (c.userInterest?.userInterestCategory) {
      value = c.userInterest.userInterestCategory;
      label = labelMap.get(value) || value;
      category = "User Interest";
      apiType = "USER_INTEREST";
    } else if (c.userList?.userList) {
      value = c.userList.userList;
      label = labelMap.get(value) || value;
      category = "User List";
      apiType = "USER_LIST";
    } else if (c.customAudience?.customAudience) {
      value = c.customAudience.customAudience;
      label = labelMap.get(value) || value;
      category = "Custom Audience";
      apiType = "CUSTOM_AUDIENCE";
    } else if (c.topic?.topic) {
      value = c.topic.topic;
      label = labelMap.get(value) || value;
      category = "Topic";
      apiType = "TOPIC";
    } else if (c.ageRange?.type) {
      value = c.ageRange.type;
      label = value.replace(/^AGE_RANGE_/, "").replace(/_/g, "-");
      category = "Age Range";
      apiType = "AGE_RANGE";
    } else if (c.gender?.type) {
      value = c.gender.type;
      label = value;
      category = "Gender";
      apiType = "GENDER";
    } else if (c.parentalStatus?.type) {
      value = c.parentalStatus.type;
      label = value;
      category = "Parental Status";
      apiType = "PARENTAL_STATUS";
    } else if (c.incomeRange?.type) {
      value = c.incomeRange.type;
      label = value.replace(/^INCOME_RANGE_/, "");
      category = "Income";
      apiType = "INCOME_RANGE";
    }
    return {
      category,
      label,
      negative: !!c.negative,
      adGroupName: r.adGroup?.name || "",
      apiType,
      value,
    };
  }).filter((a) => a.label);

  // Ad groups (filter by numeric campaign id)
  type AdGroupRow = { adGroup: { resourceName: string; name?: string; status?: string; cpcBidMicros?: string } };
  const adGroupRows = await adsSearchStream(customerId, `
    SELECT ad_group.resource_name, ad_group.name, ad_group.status, ad_group.cpc_bid_micros
    FROM ad_group WHERE campaign.id = ${numericCampaignId}
  `) as AdGroupRow[];
  const adGroups = adGroupRows.map((r) => ({
    resourceName: r.adGroup.resourceName,
    name: r.adGroup.name || "",
    status: r.adGroup.status || "",
    cpcBidMicros: Number(r.adGroup.cpcBidMicros || 0),
  }));

  // Keywords
  type KwRow = { adGroupCriterion: { keyword?: { text?: string; matchType?: string } } };
  const kwRows = await adsSearchStream(customerId, `
    SELECT ad_group_criterion.keyword.text, ad_group_criterion.keyword.match_type
    FROM keyword_view WHERE campaign.id = ${numericCampaignId}
  `) as KwRow[];
  const keywords = kwRows
    .map((r) => ({ text: r.adGroupCriterion.keyword?.text || "", matchType: r.adGroupCriterion.keyword?.matchType || "BROAD" }))
    .filter((k) => k.text);

  // Campaign-level negative keywords
  type NegKwRow = { campaignCriterion: { resourceName?: string; keyword?: { text?: string; matchType?: string } } };
  const negKwRows = await adsSearchStream(customerId, `
    SELECT campaign_criterion.resource_name, campaign_criterion.keyword.text, campaign_criterion.keyword.match_type
    FROM campaign_criterion
    WHERE campaign.id = ${numericCampaignId} AND campaign_criterion.type = KEYWORD AND campaign_criterion.negative = TRUE
  `).catch(() => []) as NegKwRow[];
  const negativeKeywords = negKwRows
    .map((r) => ({
      resourceName: r.campaignCriterion.resourceName || "",
      text: r.campaignCriterion.keyword?.text || "",
      matchType: r.campaignCriterion.keyword?.matchType || "BROAD",
    }))
    .filter((k) => k.text && k.resourceName);

  // Ad schedule (day parting) criteria
  type SchedRow = { campaignCriterion: { resourceName?: string; bidModifier?: number; adSchedule?: { dayOfWeek?: string; startHour?: number; endHour?: number } } };
  const schedRows = await adsSearchStream(customerId, `
    SELECT campaign_criterion.resource_name, campaign_criterion.bid_modifier,
           campaign_criterion.ad_schedule.day_of_week,
           campaign_criterion.ad_schedule.start_hour, campaign_criterion.ad_schedule.end_hour
    FROM campaign_criterion
    WHERE campaign.id = ${numericCampaignId} AND campaign_criterion.type = AD_SCHEDULE
  `).catch(() => []) as SchedRow[];
  const adSchedules = schedRows
    .map((r) => ({
      resourceName: r.campaignCriterion.resourceName || "",
      dayOfWeek: r.campaignCriterion.adSchedule?.dayOfWeek || "",
      startHour: Number(r.campaignCriterion.adSchedule?.startHour ?? 0),
      endHour: Number(r.campaignCriterion.adSchedule?.endHour ?? 24),
      bidModifier: Number(r.campaignCriterion.bidModifier ?? 1),
    }))
    .filter((s) => s.dayOfWeek);

  // Device bid adjustment criteria
  type DevRow = { campaignCriterion: { resourceName?: string; bidModifier?: number; device?: { type?: string } } };
  const devRows = await adsSearchStream(customerId, `
    SELECT campaign_criterion.resource_name, campaign_criterion.bid_modifier, campaign_criterion.device.type
    FROM campaign_criterion
    WHERE campaign.id = ${numericCampaignId} AND campaign_criterion.type = DEVICE
  `).catch(() => []) as DevRow[];
  const deviceModifiers = devRows
    .map((r) => ({
      resourceName: r.campaignCriterion.resourceName || "",
      device: r.campaignCriterion.device?.type || "",
      bidModifier: Number(r.campaignCriterion.bidModifier ?? 1),
    }))
    .filter((d) => d.device);

  // Sitelink extensions (campaign assets)
  type SitelinkRow = {
    campaignAsset: { resourceName?: string };
    asset?: { finalUrls?: string[]; sitelinkAsset?: { linkText?: string; description1?: string; description2?: string } };
  };
  const sitelinkRows = await adsSearchStream(customerId, `
    SELECT campaign_asset.resource_name, asset.final_urls,
           asset.sitelink_asset.link_text, asset.sitelink_asset.description1, asset.sitelink_asset.description2
    FROM campaign_asset
    WHERE campaign.id = ${numericCampaignId} AND campaign_asset.field_type = SITELINK
      AND campaign_asset.status != 'REMOVED'
  `).catch(() => []) as SitelinkRow[];
  const sitelinks = sitelinkRows
    .map((r) => ({
      resourceName: r.campaignAsset.resourceName || "",
      linkText: r.asset?.sitelinkAsset?.linkText || "",
      finalUrl: r.asset?.finalUrls?.[0] || "",
      description1: r.asset?.sitelinkAsset?.description1 || "",
      description2: r.asset?.sitelinkAsset?.description2 || "",
    }))
    .filter((s) => s.linkText && s.resourceName);

  // Callout + structured snippet extensions
  type CalloutRow = { campaignAsset: { resourceName?: string }; asset?: { calloutAsset?: { calloutText?: string } } };
  const calloutRows = await adsSearchStream(customerId, `
    SELECT campaign_asset.resource_name, asset.callout_asset.callout_text
    FROM campaign_asset
    WHERE campaign.id = ${numericCampaignId} AND campaign_asset.field_type = CALLOUT
      AND campaign_asset.status != 'REMOVED'
  `).catch(() => []) as CalloutRow[];
  const callouts = calloutRows
    .map((r) => ({
      resourceName: r.campaignAsset.resourceName || "",
      text: r.asset?.calloutAsset?.calloutText || "",
    }))
    .filter((c) => c.text && c.resourceName);

  type SnippetRow = { campaignAsset: { resourceName?: string }; asset?: { structuredSnippetAsset?: { header?: string; values?: string[] } } };
  const snippetRows = await adsSearchStream(customerId, `
    SELECT campaign_asset.resource_name, asset.structured_snippet_asset.header, asset.structured_snippet_asset.values
    FROM campaign_asset
    WHERE campaign.id = ${numericCampaignId} AND campaign_asset.field_type = STRUCTURED_SNIPPET
      AND campaign_asset.status != 'REMOVED'
  `).catch(() => []) as SnippetRow[];
  const structuredSnippets = snippetRows
    .map((r) => ({
      resourceName: r.campaignAsset.resourceName || "",
      header: r.asset?.structuredSnippetAsset?.header || "",
      values: r.asset?.structuredSnippetAsset?.values || [],
    }))
    .filter((s) => s.header && s.resourceName);

  type CallRow = { campaignAsset: { resourceName?: string }; asset?: { callAsset?: { countryCode?: string; phoneNumber?: string } } };
  const callRows = await adsSearchStream(customerId, `
    SELECT campaign_asset.resource_name, asset.call_asset.country_code, asset.call_asset.phone_number
    FROM campaign_asset
    WHERE campaign.id = ${numericCampaignId} AND campaign_asset.field_type = CALL
      AND campaign_asset.status != 'REMOVED'
  `).catch(() => []) as CallRow[];
  const callAssets = callRows
    .map((r) => ({
      resourceName: r.campaignAsset.resourceName || "",
      countryCode: r.asset?.callAsset?.countryCode || "",
      phoneNumber: r.asset?.callAsset?.phoneNumber || "",
    }))
    .filter((c) => c.phoneNumber && c.resourceName);

  type PriceRow = {
    campaignAsset: { resourceName?: string };
    asset?: {
      priceAsset?: {
        type?: string;
        priceQualifier?: string;
        priceOfferings?: Array<{
          header?: string;
          description?: string;
          price?: { currencyCode?: string; amountMicros?: string };
          unit?: string;
          finalUrl?: string;
        }>;
      };
    };
  };
  const priceRows = await adsSearchStream(customerId, `
    SELECT campaign_asset.resource_name, asset.price_asset.type,
           asset.price_asset.price_qualifier, asset.price_asset.price_offerings
    FROM campaign_asset
    WHERE campaign.id = ${numericCampaignId} AND campaign_asset.field_type = PRICE
      AND campaign_asset.status != 'REMOVED'
  `).catch(() => []) as PriceRow[];
  const prices = priceRows
    .map((r) => ({
      resourceName: r.campaignAsset.resourceName || "",
      type: r.asset?.priceAsset?.type || "",
      priceQualifier: r.asset?.priceAsset?.priceQualifier || "",
      offerings: (r.asset?.priceAsset?.priceOfferings || []).map((o) => ({
        header: o.header || "",
        description: o.description || "",
        price: Number(o.price?.amountMicros || 0) / 1_000_000,
        currencyCode: o.price?.currencyCode || "",
        unit: o.unit || "",
        finalUrl: o.finalUrl || "",
      })),
    }))
    .filter((p) => p.resourceName && p.offerings.length > 0);

  type PromotionRow = {
    campaignAsset: { resourceName?: string };
    asset?: {
      finalUrls?: string[];
      promotionAsset?: {
        promotionTarget?: string;
        percentOff?: string;
        moneyAmountOff?: { currencyCode?: string; amountMicros?: string };
        promotionCode?: string;
        occasion?: string;
        redemptionStartDate?: string;
        redemptionEndDate?: string;
      };
    };
  };
  const promotionRows = await adsSearchStream(customerId, `
    SELECT campaign_asset.resource_name, asset.final_urls,
           asset.promotion_asset.promotion_target, asset.promotion_asset.percent_off,
           asset.promotion_asset.money_amount_off.currency_code,
           asset.promotion_asset.money_amount_off.amount_micros,
           asset.promotion_asset.promotion_code, asset.promotion_asset.occasion,
           asset.promotion_asset.redemption_start_date, asset.promotion_asset.redemption_end_date
    FROM campaign_asset
    WHERE campaign.id = ${numericCampaignId} AND campaign_asset.field_type = PROMOTION
      AND campaign_asset.status != 'REMOVED'
  `).catch(() => []) as PromotionRow[];
  const promotions = promotionRows
    .map((r) => ({
      resourceName: r.campaignAsset.resourceName || "",
      promotionTarget: r.asset?.promotionAsset?.promotionTarget || "",
      // Google stores percent_off in micros: 1,000,000 = 100% → whole percent = /10,000.
      percentOff: Number(r.asset?.promotionAsset?.percentOff || 0) / 10_000,
      moneyAmountOff: Number(r.asset?.promotionAsset?.moneyAmountOff?.amountMicros || 0) / 1_000_000,
      currencyCode: r.asset?.promotionAsset?.moneyAmountOff?.currencyCode || "",
      promotionCode: r.asset?.promotionAsset?.promotionCode || "",
      occasion: r.asset?.promotionAsset?.occasion || "",
      redemptionStartDate: r.asset?.promotionAsset?.redemptionStartDate || "",
      redemptionEndDate: r.asset?.promotionAsset?.redemptionEndDate || "",
      finalUrl: r.asset?.finalUrls?.[0] || "",
    }))
    .filter((p) => p.promotionTarget && p.resourceName);

  // Ads — query fields for all common ad types (search / video / demand gen)
  type TextRow = { text: string };
  type AssetRef = { asset: string };
  type AdResponsiveSearch = { headlines?: TextRow[]; descriptions?: TextRow[] };
  type AdResponsiveVideo = { headlines?: TextRow[]; longHeadlines?: TextRow[]; descriptions?: TextRow[]; callToActions?: TextRow[]; videos?: AssetRef[] };
  type AdRow = {
    adGroupAd: {
      resourceName?: string;
      status?: string;
      ad: {
        id?: string;
        name?: string;
        type?: string;
        finalUrls?: string[];
        responsiveSearchAd?: AdResponsiveSearch;
        videoResponsiveAd?: AdResponsiveVideo;
        demandGenVideoResponsiveAd?: AdResponsiveVideo;
      };
    };
  };
  const adRows = await adsSearchStream(customerId, `
    SELECT ad_group_ad.resource_name, ad_group_ad.status,
           ad_group_ad.ad.id, ad_group_ad.ad.name, ad_group_ad.ad.type, ad_group_ad.ad.final_urls,
           ad_group_ad.ad.responsive_search_ad.headlines,
           ad_group_ad.ad.responsive_search_ad.descriptions,
           ad_group_ad.ad.video_responsive_ad.headlines,
           ad_group_ad.ad.video_responsive_ad.long_headlines,
           ad_group_ad.ad.video_responsive_ad.descriptions,
           ad_group_ad.ad.video_responsive_ad.call_to_actions,
           ad_group_ad.ad.video_responsive_ad.videos,
           ad_group_ad.ad.demand_gen_video_responsive_ad.headlines,
           ad_group_ad.ad.demand_gen_video_responsive_ad.long_headlines,
           ad_group_ad.ad.demand_gen_video_responsive_ad.descriptions,
           ad_group_ad.ad.demand_gen_video_responsive_ad.call_to_actions,
           ad_group_ad.ad.demand_gen_video_responsive_ad.videos
    FROM ad_group_ad WHERE campaign.id = ${numericCampaignId}
  `) as AdRow[];

  // Resolve video asset → YouTube info
  const allVideoAssets = new Set<string>();
  for (const r of adRows) {
    const ad = r.adGroupAd.ad;
    [...(ad.videoResponsiveAd?.videos || []), ...(ad.demandGenVideoResponsiveAd?.videos || [])]
      .forEach((v) => v.asset && allVideoAssets.add(v.asset));
  }
  const videoAssetMap = new Map<string, { youtubeVideoId: string; title: string }>();
  if (allVideoAssets.size > 0) {
    type AssetInfoRow = { asset: { resourceName: string; youtubeVideoAsset?: { youtubeVideoId?: string; youtubeVideoTitle?: string } } };
    const inList = [...allVideoAssets].map((r) => `'${r}'`).join(",");
    try {
      const assetRows = await adsSearchStream(customerId, `
        SELECT asset.resource_name, asset.youtube_video_asset.youtube_video_id, asset.youtube_video_asset.youtube_video_title
        FROM asset WHERE asset.resource_name IN (${inList})
      `) as AssetInfoRow[];
      for (const r of assetRows) {
        videoAssetMap.set(r.asset.resourceName, {
          youtubeVideoId: r.asset.youtubeVideoAsset?.youtubeVideoId || "",
          title: r.asset.youtubeVideoAsset?.youtubeVideoTitle || "",
        });
      }
    } catch { /* ignore */ }
  }

  const ads = adRows.map((r) => {
    const ad = r.adGroupAd.ad;
    const variant = ad.demandGenVideoResponsiveAd || ad.videoResponsiveAd || ad.responsiveSearchAd || {};
    const v = variant as AdResponsiveVideo & AdResponsiveSearch;
    const videos = (v.videos || []).map((vv) => {
      const info = videoAssetMap.get(vv.asset);
      return {
        asset: vv.asset,
        youtubeVideoId: info?.youtubeVideoId || "",
        title: info?.title || "",
      };
    });
    return {
      resourceName: r.adGroupAd.resourceName || "",
      status: r.adGroupAd.status || "",
      adId: ad.id || "",
      name: ad.name || "",
      type: ad.type || "",
      headlines: (v.headlines || []).map((h) => h.text),
      longHeadlines: (v.longHeadlines || []).map((h) => h.text),
      descriptions: (v.descriptions || []).map((d) => d.text),
      callToActions: (v.callToActions || []).map((c) => c.text),
      videos,
      finalUrls: ad.finalUrls || [],
    };
  });

  // Performance Max uses asset_group instead of ad_group; only query when relevant.
  const channelType = camp?.advertisingChannelType || "";
  let assetGroups: CampaignDetail["assetGroups"] = [];
  if (channelType === "PERFORMANCE_MAX") {
    type AssetGroupRow = {
      assetGroup: {
        resourceName: string;
        name?: string;
        status?: string;
        adStrength?: string;
        primaryStatus?: string;
        primaryStatusReasons?: string[];
        finalUrls?: string[];
      };
    };
    const agRows = await adsSearchStream(customerId, `
      SELECT asset_group.resource_name, asset_group.name, asset_group.status,
             asset_group.ad_strength, asset_group.primary_status, asset_group.primary_status_reasons,
             asset_group.final_urls
      FROM asset_group WHERE campaign.id = ${numericCampaignId}
    `) as AssetGroupRow[];
    assetGroups = agRows.map((r) => ({
      resourceName: r.assetGroup.resourceName,
      name: r.assetGroup.name || "",
      status: r.assetGroup.status || "",
      adStrength: r.assetGroup.adStrength || "",
      primaryStatus: r.assetGroup.primaryStatus || "",
      primaryStatusReasons: r.assetGroup.primaryStatusReasons || [],
      finalUrls: r.assetGroup.finalUrls || [],
    }));
  }

  return {
    resourceName,
    name: camp?.name || "",
    status: camp?.status || "",
    channelType,
    startDate: camp?.startDate,
    endDate: camp?.endDate,
    optimizationScore: camp?.optimizationScore,
    metrics: {
      impressions,
      clicks,
      costMicros,
      conversions,
      ctr: clicks && impressions ? clicks / impressions : 0,
      avgCpcMicros: clicks ? costMicros / clicks : 0,
    },
    dailyMetrics,
    locations,
    audiences,
    adGroups,
    assetGroups,
    keywords,
    bidding: {
      strategyType: camp?.biddingStrategyType || "",
      targetCpaMicros: Number(camp?.maximizeConversions?.targetCpaMicros || 0),
      targetRoas: Number(camp?.maximizeConversionValue?.targetRoas || 0),
    },
    negativeKeywords,
    adSchedules,
    deviceModifiers,
    sitelinks,
    callouts,
    structuredSnippets,
    callAssets,
    prices,
    promotions,
    ads,
  };
}

/** Replace all LOCATION criteria on a campaign with the given list.
 *  Auto-detects whether locations live at campaign_criterion (most types) or
 *  ad_group_criterion (DEMAND_GEN, PMax, etc.) and mutates at the correct level. */
export async function setCampaignLocations(campaignResourceName: string, locationIds: string[]): Promise<{ success: boolean; error?: unknown }> {
  const customerId = process.env.GOOGLE_ADS_CUSTOMER_ID;
  if (!customerId) throw new Error("GOOGLE_ADS_CUSTOMER_ID not configured");

  const numericCampaignId = campaignResourceName.split("/").pop() || "";

  // Detect channel type to pick the right targeting level
  type ChannelRow = { campaign: { advertisingChannelType?: string } };
  const channelRows = await adsSearchStream(customerId, `
    SELECT campaign.advertising_channel_type FROM campaign WHERE campaign.id = ${numericCampaignId}
  `) as ChannelRow[];
  const channelType = channelRows[0]?.campaign?.advertisingChannelType || "";
  const useAdGroupLevel = ["DEMAND_GEN", "PERFORMANCE_MAX"].includes(channelType);

  if (useAdGroupLevel) {
    // Demand Gen / PMax: location lives in ad_group_criterion. Operate per ad group.
    type AGRow = { adGroup: { resourceName: string } };
    const adGroups = await adsSearchStream(customerId, `
      SELECT ad_group.resource_name FROM ad_group WHERE campaign.id = ${numericCampaignId}
    `) as AGRow[];
    if (adGroups.length === 0) {
      return { success: false, error: "No ad groups in campaign — cannot set locations" };
    }
    type AGCRow = { adGroupCriterion: { resourceName: string } };
    const existingCriteria = await adsSearchStream(customerId, `
      SELECT ad_group_criterion.resource_name
      FROM ad_group_criterion
      WHERE campaign.id = ${numericCampaignId} AND ad_group_criterion.type = LOCATION
    `) as AGCRow[];

    const operations: Record<string, unknown>[] = [
      ...existingCriteria.map((r) => ({ remove: r.adGroupCriterion.resourceName })),
      // Create new LOCATION criteria for every ad group × every location
      ...adGroups.flatMap((ag) =>
        locationIds.map((id) => ({
          create: {
            adGroup: ag.adGroup.resourceName,
            location: { geoTargetConstant: `geoTargetConstants/${id}` },
          },
        }))
      ),
    ];
    if (operations.length === 0) return { success: true };
    const res = await adsMutate(customerId, "adGroupCriteria:mutate", { operations });
    if (res.status !== 200) return { success: false, error: res.data };
    return { success: true };
  }

  // Default: campaign_criterion (SEARCH/DISPLAY/SHOPPING/VIDEO)
  type CCRow = { campaignCriterion: { resourceName: string } };
  const existing = await adsSearchStream(customerId, `
    SELECT campaign_criterion.resource_name
    FROM campaign_criterion
    WHERE campaign.id = ${numericCampaignId} AND campaign_criterion.type = LOCATION
  `) as CCRow[];

  const operations: Record<string, unknown>[] = [
    ...existing.map((r) => ({ remove: r.campaignCriterion.resourceName })),
    ...locationIds.map((id) => ({
      create: {
        campaign: campaignResourceName,
        location: { geoTargetConstant: `geoTargetConstants/${id}` },
      },
    })),
  ];
  if (operations.length === 0) return { success: true };
  const res = await adsMutate(customerId, "campaignCriteria:mutate", { operations });
  if (res.status !== 200) return { success: false, error: res.data };
  return { success: true };
}

/** Replace all audience criteria of the given types on a campaign with the new list.
 *  Applies to ALL ad groups in the campaign (consistent with setCampaignLocations).
 *  Phase 1: supports demographic enums (AGE_RANGE/GENDER/PARENTAL_STATUS/INCOME_RANGE).
 *  Other types are rejected — extend in Phase 2/3. */
const PHASE_1_AUDIENCE_TYPES: AudienceApiType[] = ["AGE_RANGE", "GENDER", "PARENTAL_STATUS", "INCOME_RANGE"];

export async function setCampaignAudiences(
  campaignResourceName: string,
  criteria: AudienceCriterionInput[]
): Promise<{ success: boolean; error?: unknown }> {
  const customerId = process.env.GOOGLE_ADS_CUSTOMER_ID;
  if (!customerId) throw new Error("GOOGLE_ADS_CUSTOMER_ID not configured");

  const supportedTypes = new Set<AudienceApiType>(PHASE_1_AUDIENCE_TYPES);
  for (const c of criteria) {
    if (!supportedTypes.has(c.apiType)) {
      return { success: false, error: `Audience type ${c.apiType} not yet supported (Phase 1 = demographics only)` };
    }
  }

  const numericCampaignId = campaignResourceName.split("/").pop() || "";

  type AGRow = { adGroup: { resourceName: string } };
  const adGroups = await adsSearchStream(customerId, `
    SELECT ad_group.resource_name FROM ad_group WHERE campaign.id = ${numericCampaignId}
  `) as AGRow[];
  if (adGroups.length === 0) {
    return { success: false, error: "No ad groups in campaign — cannot set audiences" };
  }

  const managedTypeList = [...supportedTypes].join(", ");
  type AGCRow = { adGroupCriterion: { resourceName: string } };
  const existing = await adsSearchStream(customerId, `
    SELECT ad_group_criterion.resource_name
    FROM ad_group_criterion
    WHERE campaign.id = ${numericCampaignId}
      AND ad_group_criterion.type IN (${managedTypeList})
  `) as AGCRow[];

  const buildCriterion = (c: AudienceCriterionInput): Record<string, unknown> => {
    switch (c.apiType) {
      case "AGE_RANGE":        return { ageRange: { type: c.value } };
      case "GENDER":           return { gender: { type: c.value } };
      case "PARENTAL_STATUS":  return { parentalStatus: { type: c.value } };
      case "INCOME_RANGE":     return { incomeRange: { type: c.value } };
      default:                 return {};
    }
  };

  const operations: Record<string, unknown>[] = [
    ...existing.map((r) => ({ remove: r.adGroupCriterion.resourceName })),
    ...adGroups.flatMap((ag) =>
      criteria.map((c) => ({
        create: {
          adGroup: ag.adGroup.resourceName,
          negative: c.negative ?? false,
          ...buildCriterion(c),
        },
      }))
    ),
  ];

  if (operations.length === 0) return { success: true };

  const res = await adsMutate(customerId, "adGroupCriteria:mutate", { operations });
  if (res.status !== 200) return { success: false, error: res.data };
  return { success: true };
}

export async function setCampaignStatus(resourceName: string, status: "ENABLED" | "PAUSED"): Promise<{ success: boolean; error?: unknown }> {
  const customerId = process.env.GOOGLE_ADS_CUSTOMER_ID;
  if (!customerId) throw new Error("GOOGLE_ADS_CUSTOMER_ID not configured");

  const res = await adsMutate(customerId, "campaigns:mutate", {
    operations: [{
      update: { resourceName, status },
      updateMask: "status",
    }],
  });
  if (res.status === 200) return { success: true };
  return { success: false, error: res.data };
}

/** Update the daily budget (in USD) of a campaign. Looks up the campaign_budget resource and mutates it. */
export async function setCampaignDailyBudget(campaignResourceName: string, newDailyBudgetUsd: number): Promise<{ success: boolean; error?: unknown }> {
  const customerId = process.env.GOOGLE_ADS_CUSTOMER_ID;
  if (!customerId) throw new Error("GOOGLE_ADS_CUSTOMER_ID not configured");

  const numericCampaignId = campaignResourceName.split("/").pop() || "";
  type Row = { campaign: { campaignBudget?: string } };
  const rows = await adsSearchStream(customerId, `
    SELECT campaign.campaign_budget FROM campaign WHERE campaign.id = ${numericCampaignId}
  `) as Row[];
  const budgetResource = rows[0]?.campaign?.campaignBudget;
  if (!budgetResource) return { success: false, error: "Could not find campaign budget resource" };

  const amountMicros = String(Math.round(newDailyBudgetUsd * 1_000_000));
  const res = await adsMutate(customerId, "campaignBudgets:mutate", {
    operations: [{
      update: { resourceName: budgetResource, amountMicros },
      updateMask: "amount_micros",
    }],
  });
  if (res.status !== 200) return { success: false, error: res.data };
  return { success: true };
}

/** Update the start/end date on a campaign. Dates in YYYY-MM-DD. */
export async function setCampaignSchedule(campaignResourceName: string, startDate: string | null, endDate: string | null): Promise<{ success: boolean; error?: unknown }> {
  const customerId = process.env.GOOGLE_ADS_CUSTOMER_ID;
  if (!customerId) throw new Error("GOOGLE_ADS_CUSTOMER_ID not configured");

  const update: Record<string, unknown> = { resourceName: campaignResourceName };
  const masks: string[] = [];
  if (startDate !== null) { update.startDate = startDate; masks.push("start_date"); }
  if (endDate !== null) { update.endDate = endDate; masks.push("end_date"); }
  if (masks.length === 0) return { success: true };

  const res = await adsMutate(customerId, "campaigns:mutate", {
    operations: [{ update, updateMask: masks.join(",") }],
  });
  if (res.status !== 200) return { success: false, error: res.data };
  return { success: true };
}

export async function renameCampaign(resourceName: string, name: string): Promise<{ success: boolean; error?: unknown }> {
  const customerId = process.env.GOOGLE_ADS_CUSTOMER_ID;
  if (!customerId) throw new Error("GOOGLE_ADS_CUSTOMER_ID not configured");

  const res = await adsMutate(customerId, "campaigns:mutate", {
    operations: [{
      update: { resourceName, name },
      updateMask: "name",
    }],
  });
  if (res.status === 200) return { success: true };
  return { success: false, error: res.data };
}

export interface CampaignSpend {
  resourceName: string;
  costMicros: number;
  impressions: number;
  clicks: number;
  conversions: number;
}

export interface GoogleAdsCampaignSummary {
  resourceName: string;
  id: string;
  name: string;
  status: string;
  channelType: string;
  startDate?: string;
  endDate?: string;
  metrics: { costMicros: number; impressions: number; clicks: number };
}

/** List EVERY campaign on the configured Google Ads customer (regardless of who created it).
 *  Used by AutoClaw's "import / claim existing campaign" flow. */
export async function listAllCampaigns(): Promise<GoogleAdsCampaignSummary[]> {
  const customerId = process.env.GOOGLE_ADS_CUSTOMER_ID;
  if (!customerId) throw new Error("GOOGLE_ADS_CUSTOMER_ID not configured");

  type Row = {
    campaign: { resourceName: string; id?: string; name?: string; status?: string; advertisingChannelType?: string; startDate?: string; endDate?: string };
    metrics?: { costMicros?: string; impressions?: string; clicks?: string };
  };
  const rows = await adsSearchStream(customerId, `
    SELECT campaign.resource_name, campaign.id, campaign.name, campaign.status,
           campaign.advertising_channel_type, campaign.start_date, campaign.end_date,
           metrics.cost_micros, metrics.impressions, metrics.clicks
    FROM campaign WHERE segments.date DURING LAST_30_DAYS
  `) as Row[];

  // Aggregate per campaign (one row per day)
  const map = new Map<string, GoogleAdsCampaignSummary>();
  for (const r of rows) {
    const key = r.campaign.resourceName;
    const existing = map.get(key) || {
      resourceName: r.campaign.resourceName,
      id: r.campaign.id || "",
      name: r.campaign.name || "",
      status: r.campaign.status || "",
      channelType: r.campaign.advertisingChannelType || "",
      startDate: r.campaign.startDate,
      endDate: r.campaign.endDate,
      metrics: { costMicros: 0, impressions: 0, clicks: 0 },
    };
    existing.metrics.costMicros += Number(r.metrics?.costMicros || 0);
    existing.metrics.impressions += Number(r.metrics?.impressions || 0);
    existing.metrics.clicks += Number(r.metrics?.clicks || 0);
    map.set(key, existing);
  }
  // Also include campaigns with no metric activity (e.g. PAUSED never run)
  if (map.size === 0) {
    const fallback = await adsSearchStream(customerId, `
      SELECT campaign.resource_name, campaign.id, campaign.name, campaign.status,
             campaign.advertising_channel_type, campaign.start_date, campaign.end_date
      FROM campaign
    `) as Row[];
    for (const r of fallback) {
      map.set(r.campaign.resourceName, {
        resourceName: r.campaign.resourceName,
        id: r.campaign.id || "",
        name: r.campaign.name || "",
        status: r.campaign.status || "",
        channelType: r.campaign.advertisingChannelType || "",
        startDate: r.campaign.startDate,
        endDate: r.campaign.endDate,
        metrics: { costMicros: 0, impressions: 0, clicks: 0 },
      });
    }
  }
  return [...map.values()];
}

/** Fetch spend for all (or specific) campaigns over a Google Ads date-range keyword.
 *  Defaults to LAST_30_DAYS (the historical behavior of fetchCampaignSpend). */
export async function fetchCampaignSpend(
  resourceNames?: string[],
  dateRange: "LAST_7_DAYS" | "LAST_30_DAYS" = "LAST_30_DAYS",
): Promise<CampaignSpend[]> {
  const customerId = process.env.GOOGLE_ADS_CUSTOMER_ID;
  if (!customerId) throw new Error("GOOGLE_ADS_CUSTOMER_ID not configured");

  const filter = resourceNames && resourceNames.length > 0
    ? `AND campaign.resource_name IN (${resourceNames.map((r) => `'${r.replace(/'/g, "''")}'`).join(",")})`
    : "";
  const query = `
    SELECT campaign.resource_name, metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.conversions
    FROM campaign
    WHERE segments.date DURING ${dateRange} ${filter}
  `.trim();

  type Row = { campaign: { resourceName: string }; metrics: { costMicros?: string; impressions?: string; clicks?: string; conversions?: number } };
  const rows = await adsSearchStream(customerId, query) as Row[];

  // Aggregate (one row per campaign per day → sum)
  const byCampaign = new Map<string, CampaignSpend>();
  for (const r of rows) {
    const key = r.campaign.resourceName;
    const existing = byCampaign.get(key) || { resourceName: key, costMicros: 0, impressions: 0, clicks: 0, conversions: 0 };
    existing.costMicros += Number(r.metrics?.costMicros || 0);
    existing.impressions += Number(r.metrics?.impressions || 0);
    existing.clicks += Number(r.metrics?.clicks || 0);
    existing.conversions += Number(r.metrics?.conversions || 0);
    byCampaign.set(key, existing);
  }
  return [...byCampaign.values()];
}

export async function createCampaign(input: CreateCampaignInput): Promise<CreateCampaignResult> {
  const customerId = process.env.GOOGLE_ADS_CUSTOMER_ID;
  if (!customerId) throw new Error("GOOGLE_ADS_CUSTOMER_ID not configured");

  const channel = (input.channel || "SEARCH").toUpperCase() as "SEARCH" | "DISPLAY" | "SHOPPING" | "VIDEO" | "PERFORMANCE_MAX";
  const out: CreateCampaignResult = { budget: null, campaign: null, errors: [] };

  // 1. Budget
  const budgetMicros = String(Math.round(input.dailyBudget * 1_000_000));
  const budgetRes = await adsMutate(customerId, "campaignBudgets:mutate", {
    operations: [{ create: {
      name: `${input.name} Budget`,
      amountMicros: budgetMicros,
      deliveryMethod: "STANDARD",
      explicitlyShared: false,
    } }],
  });
  if (budgetRes.status !== 200) {
    out.errors.push({ step: "budget", details: budgetRes.data });
    return out;
  }
  out.budget = (budgetRes.data as { results?: Array<{ resourceName?: string }> }).results?.[0]?.resourceName || null;

  // 2. Campaign (PAUSED by default)
  // Channel-appropriate bidding:
  //   SEARCH/DISPLAY/SHOPPING → manualCpc
  //   VIDEO → maximizeConversions (manualCpc not allowed for VIDEO)
  //   PERFORMANCE_MAX → maximizeConversions (Smart Bidding required; manualCpc not allowed for PMAX)
  // We also set explicit start/end dates to avoid Google's default end-date bug.
  // PMAX note: this creates the campaign shell only. Asset groups, audience signals,
  // and conversion goals are added via separate endpoints (see docs/google-ads-audit.md PR #2c-d).
  const today = new Date();
  const startDate = today.toISOString().slice(0, 10); // YYYY-MM-DD
  const endDateObj = new Date(today.getTime() + 365 * 24 * 60 * 60 * 1000);
  const endDate = endDateObj.toISOString().slice(0, 10);

  const campaignCreate: Record<string, unknown> = {
    name: input.name,
    status: "PAUSED",
    advertisingChannelType: channel,
    campaignBudget: out.budget,
    startDate,
    endDate,
    contains_eu_political_advertising: 2,
  };
  if (channel === "VIDEO" || channel === "PERFORMANCE_MAX") {
    campaignCreate.maximizeConversions = {};
  } else {
    campaignCreate.manualCpc = {};
  }
  const campaignRes = await adsMutate(customerId, "campaigns:mutate", {
    operations: [{ create: campaignCreate }],
  });
  if (campaignRes.status !== 200) {
    out.errors.push({ step: "campaign", details: campaignRes.data });
    return out;
  }
  out.campaign = (campaignRes.data as { results?: Array<{ resourceName?: string }> }).results?.[0]?.resourceName || null;

  // 2.5 Apply location targeting (campaign criteria)
  if (input.locationIds && input.locationIds.length > 0 && out.campaign) {
    const locationOps = input.locationIds.map((id) => ({
      create: {
        campaign: out.campaign,
        location: { geoTargetConstant: `geoTargetConstants/${id}` },
      },
    }));
    const locRes = await adsMutate(customerId, "campaignCriteria:mutate", { operations: locationOps });
    if (locRes.status !== 200) {
      out.errors.push({ step: "locations", details: locRes.data });
    }
  }

  return out;
}

/** Extract a YouTube video ID from common URL forms. */
export function extractYouTubeVideoId(url: string): string | null {
  const cleaned = url.trim();
  // Bare ID
  if (/^[a-zA-Z0-9_-]{11}$/.test(cleaned)) return cleaned;
  const patterns = [
    /[?&]v=([a-zA-Z0-9_-]{11})/,        // youtube.com/watch?v=ID
    /youtu\.be\/([a-zA-Z0-9_-]{11})/,    // youtu.be/ID
    /youtube\.com\/embed\/([a-zA-Z0-9_-]{11})/,
    /youtube\.com\/shorts\/([a-zA-Z0-9_-]{11})/,
  ];
  for (const p of patterns) {
    const m = cleaned.match(p);
    if (m) return m[1];
  }
  return null;
}

/** Create (or reuse) a YouTube video asset for use in video ads. */
export async function createYouTubeVideoAsset(youtubeVideoId: string): Promise<{ resourceName: string | null; error?: unknown }> {
  const customerId = process.env.GOOGLE_ADS_CUSTOMER_ID;
  if (!customerId) throw new Error("GOOGLE_ADS_CUSTOMER_ID not configured");

  const res = await adsMutate(customerId, "assets:mutate", {
    operations: [{ create: {
      type: "YOUTUBE_VIDEO",
      youtubeVideoAsset: { youtubeVideoId },
    } }],
  });
  if (res.status !== 200) return { resourceName: null, error: res.data };
  const resourceName = (res.data as { results?: Array<{ resourceName?: string }> }).results?.[0]?.resourceName || null;
  return { resourceName };
}

export interface CreateVideoAdInput {
  adGroupResourceName: string;
  youtubeVideoId: string;
  /** 1-5 short headlines, ≤15 chars each (used by some video formats) */
  headlines: string[];
  /** Required, ≤90 chars (used by in-feed and other formats) */
  longHeadline: string;
  /** 1-5 descriptions, ≤90 chars each */
  descriptions: string[];
  /** ≤10 chars, e.g. "Subscribe", "Try Free" */
  callToAction?: string;
  finalUrl: string;
}

export async function createVideoAd(input: CreateVideoAdInput): Promise<{ resourceName: string | null; error?: unknown }> {
  const customerId = process.env.GOOGLE_ADS_CUSTOMER_ID;
  if (!customerId) throw new Error("GOOGLE_ADS_CUSTOMER_ID not configured");

  // 1. Create YouTube video asset
  const assetRes = await createYouTubeVideoAsset(input.youtubeVideoId);
  if (!assetRes.resourceName) return { resourceName: null, error: { step: "asset", details: assetRes.error } };

  // 2. Create video responsive ad (works across In-Feed, In-Stream, Bumper formats)
  const headlines = input.headlines.slice(0, 5).map((h) => ({ text: h.slice(0, 15) }));
  const descriptions = input.descriptions.slice(0, 5).map((d) => ({ text: d.slice(0, 90) }));
  if (headlines.length === 0) headlines.push({ text: "Watch" });

  const adBody: Record<string, unknown> = {
    headlines,
    longHeadlines: [{ text: input.longHeadline.slice(0, 90) }],
    descriptions,
    videos: [{ asset: assetRes.resourceName }],
  };
  if (input.callToAction) {
    adBody.callToActions = [{ text: input.callToAction.slice(0, 10) }];
  }

  const res = await adsMutate(customerId, "adGroupAds:mutate", {
    operations: [{ create: {
      adGroup: input.adGroupResourceName,
      status: "PAUSED",
      ad: {
        finalUrls: [input.finalUrl],
        videoResponsiveAd: adBody,
      },
    } }],
  });
  if (res.status !== 200) return { resourceName: null, error: { step: "ad", details: res.data } };
  return { resourceName: (res.data as { results?: Array<{ resourceName?: string }> }).results?.[0]?.resourceName || null };
}

/**
 * Fetch an image from a public URL and upload it as a Google Ads IMAGE asset.
 * Returns the asset resourceName, reusable across responsive display ads.
 */
export async function createImageAssetFromUrl(url: string): Promise<{ resourceName: string | null; error?: unknown }> {
  const customerId = process.env.GOOGLE_ADS_CUSTOMER_ID;
  if (!customerId) throw new Error("GOOGLE_ADS_CUSTOMER_ID not configured");

  if (!/^https?:\/\//i.test(url)) return { resourceName: null, error: "Image URL must start with http:// or https://" };

  let imgRes: Response;
  try {
    imgRes = await fetch(url, { redirect: "follow" });
  } catch (e) {
    return { resourceName: null, error: { step: "fetch", details: e instanceof Error ? e.message : String(e) } };
  }
  if (!imgRes.ok) return { resourceName: null, error: { step: "fetch", status: imgRes.status } };

  const contentType = (imgRes.headers.get("content-type") || "").toLowerCase();
  if (!/^image\/(png|jpeg|jpg|gif)$/.test(contentType)) {
    return { resourceName: null, error: `Unsupported image type: ${contentType || "unknown"} (need PNG/JPEG/GIF)` };
  }
  const buf = Buffer.from(await imgRes.arrayBuffer());
  // Google Ads accepts up to 5 MB per image asset.
  if (buf.byteLength > 5 * 1024 * 1024) {
    return { resourceName: null, error: `Image too large: ${(buf.byteLength / 1024 / 1024).toFixed(2)} MB (max 5 MB)` };
  }
  const data = buf.toString("base64");

  const res = await adsMutate(customerId, "assets:mutate", {
    operations: [{ create: {
      type: "IMAGE",
      imageAsset: { data },
    } }],
  });
  if (res.status !== 200) return { resourceName: null, error: res.data };
  const resourceName = (res.data as { results?: Array<{ resourceName?: string }> }).results?.[0]?.resourceName || null;
  return { resourceName };
}

export interface CreateResponsiveDisplayAdInput {
  adGroupResourceName: string;
  /** ≥1 landscape image URLs (1.91:1, recommended 1200×628). Max 15. */
  marketingImageUrls: string[];
  /** ≥1 square image URLs (1:1, recommended 1200×1200). Max 15. */
  squareMarketingImageUrls: string[];
  /** Optional landscape logo URL (4:1) */
  logoImageUrl?: string;
  /** 1-5 short headlines, ≤30 chars each */
  headlines: string[];
  /** 1 long headline, ≤90 chars */
  longHeadline: string;
  /** 1-5 descriptions, ≤90 chars each */
  descriptions: string[];
  /** Required, ≤25 chars */
  businessName: string;
  finalUrl: string;
}

export async function createResponsiveDisplayAd(input: CreateResponsiveDisplayAdInput): Promise<{ resourceName: string | null; error?: unknown }> {
  const customerId = process.env.GOOGLE_ADS_CUSTOMER_ID;
  if (!customerId) throw new Error("GOOGLE_ADS_CUSTOMER_ID not configured");

  if (input.marketingImageUrls.length === 0) return { resourceName: null, error: "At least 1 marketing (landscape) image required" };
  if (input.squareMarketingImageUrls.length === 0) return { resourceName: null, error: "At least 1 square marketing image required" };
  if (input.headlines.length === 0) return { resourceName: null, error: "At least 1 headline required" };
  if (!input.longHeadline.trim()) return { resourceName: null, error: "Long headline required" };
  if (input.descriptions.length === 0) return { resourceName: null, error: "At least 1 description required" };
  if (!input.businessName.trim()) return { resourceName: null, error: "Business name required" };
  if (!/^https?:\/\//i.test(input.finalUrl)) return { resourceName: null, error: "Final URL must start with http:// or https://" };

  // Upload each image as an asset; collect resourceNames. Stop on first error.
  async function uploadAll(urls: string[]): Promise<{ resourceNames: string[]; error?: unknown }> {
    const out: string[] = [];
    for (const u of urls) {
      const r = await createImageAssetFromUrl(u);
      if (!r.resourceName) return { resourceNames: out, error: { url: u, details: r.error } };
      out.push(r.resourceName);
    }
    return { resourceNames: out };
  }

  const marketing = await uploadAll(input.marketingImageUrls.slice(0, 15));
  if (marketing.error) return { resourceName: null, error: { step: "marketingImages", details: marketing.error } };

  const squares = await uploadAll(input.squareMarketingImageUrls.slice(0, 15));
  if (squares.error) return { resourceName: null, error: { step: "squareMarketingImages", details: squares.error } };

  let logoResource: string | null = null;
  if (input.logoImageUrl && input.logoImageUrl.trim()) {
    const r = await createImageAssetFromUrl(input.logoImageUrl.trim());
    if (!r.resourceName) return { resourceName: null, error: { step: "logo", details: r.error } };
    logoResource = r.resourceName;
  }

  const adBody: Record<string, unknown> = {
    headlines: input.headlines.slice(0, 5).map((h) => ({ text: h.slice(0, 30) })),
    longHeadline: { text: input.longHeadline.slice(0, 90) },
    descriptions: input.descriptions.slice(0, 5).map((d) => ({ text: d.slice(0, 90) })),
    businessName: input.businessName.slice(0, 25),
    marketingImages: marketing.resourceNames.map((rn) => ({ asset: rn })),
    squareMarketingImages: squares.resourceNames.map((rn) => ({ asset: rn })),
  };
  if (logoResource) {
    adBody.logoImages = [{ asset: logoResource }];
  }

  const res = await adsMutate(customerId, "adGroupAds:mutate", {
    operations: [{ create: {
      adGroup: input.adGroupResourceName,
      status: "PAUSED",
      ad: {
        finalUrls: [input.finalUrl],
        responsiveDisplayAd: adBody,
      },
    } }],
  });
  if (res.status !== 200) return { resourceName: null, error: { step: "ad", details: res.data } };
  return { resourceName: (res.data as { results?: Array<{ resourceName?: string }> }).results?.[0]?.resourceName || null };
}

export interface CreateResponsiveSearchAdInput {
  adGroupResourceName: string;
  headlines: string[];   // 3-15, max 30 chars each
  descriptions: string[]; // 2-4, max 90 chars each
  finalUrls: string[];
}

export async function createResponsiveSearchAd(input: CreateResponsiveSearchAdInput): Promise<{ resourceName: string | null; error?: unknown }> {
  const customerId = process.env.GOOGLE_ADS_CUSTOMER_ID;
  if (!customerId) throw new Error("GOOGLE_ADS_CUSTOMER_ID not configured");

  const headlines = input.headlines.slice(0, 15).map((h) => ({ text: h.slice(0, 30) }));
  const descriptions = input.descriptions.slice(0, 4).map((d) => ({ text: d.slice(0, 90) }));

  if (headlines.length < 3) return { resourceName: null, error: "At least 3 headlines required" };
  if (descriptions.length < 2) return { resourceName: null, error: "At least 2 descriptions required" };
  if (input.finalUrls.length === 0) return { resourceName: null, error: "Final URL required" };

  const res = await adsMutate(customerId, "adGroupAds:mutate", {
    operations: [{ create: {
      adGroup: input.adGroupResourceName,
      status: "PAUSED",
      ad: {
        responsiveSearchAd: { headlines, descriptions },
        finalUrls: input.finalUrls,
      },
    } }],
  });
  if (res.status !== 200) return { resourceName: null, error: res.data };
  return { resourceName: (res.data as { results?: Array<{ resourceName?: string }> }).results?.[0]?.resourceName || null };
}

export type KeywordMatchType = "BROAD" | "PHRASE" | "EXACT";

export interface KeywordInput {
  text: string;
  matchType?: KeywordMatchType;  // default BROAD
}

export interface CreateKeywordsResult {
  created: number;
  resourceNames: string[];
  errors: Array<{ keyword: string; details: unknown }>;
  /** Keywords Google rejected for being identical to ones already in the ad group. */
  duplicatesIgnored: string[];
}

/**
 * Add keyword criteria to an ad group. Each keyword becomes its own
 * `ad_group_criterion` of type KEYWORD. Caller has already validated that the
 * ad group belongs to a SEARCH-channel campaign on this customer.
 */
export async function createKeywords(adGroupResourceName: string, keywords: KeywordInput[]): Promise<CreateKeywordsResult> {
  const customerId = process.env.GOOGLE_ADS_CUSTOMER_ID;
  if (!customerId) throw new Error("GOOGLE_ADS_CUSTOMER_ID not configured");

  const out: CreateKeywordsResult = { created: 0, resourceNames: [], errors: [], duplicatesIgnored: [] };
  const cleaned = keywords
    .map((k) => ({ text: (k.text || "").trim(), matchType: (k.matchType || "BROAD").toUpperCase() as KeywordMatchType }))
    .filter((k) => k.text.length > 0 && k.text.length <= 80);
  if (cleaned.length === 0) return out;

  // partialFailure lets Google accept the valid ones and tell us which failed
  // (e.g. duplicates) instead of rejecting the whole batch.
  const operations = cleaned.map((k) => ({
    create: {
      adGroup: adGroupResourceName,
      status: "ENABLED",
      keyword: { text: k.text, matchType: k.matchType },
    },
  }));

  const res = await adsMutate(customerId, "adGroupCriteria:mutate", {
    operations,
    partialFailure: true,
  });
  const data = res.data as {
    results?: Array<{ resourceName?: string }>;
    partialFailureError?: { details?: Array<{ errors?: Array<{ message?: string; location?: { fieldPathElements?: Array<{ index?: number }> }; errorCode?: { criterionError?: string } }> }> };
  };

  if (res.status !== 200) {
    out.errors.push({ keyword: "(batch)", details: res.data });
    return out;
  }

  // Collect indexes that failed (so we can map back to which keyword text errored).
  const failedIndexes = new Map<number, string>();
  const detailsList = data.partialFailureError?.details || [];
  for (const d of detailsList) {
    for (const err of d.errors || []) {
      const idx = err.location?.fieldPathElements?.[0]?.index;
      if (typeof idx === "number") {
        failedIndexes.set(idx, err.errorCode?.criterionError || err.message || "unknown");
      }
    }
  }

  for (let i = 0; i < cleaned.length; i++) {
    const r = data.results?.[i];
    if (failedIndexes.has(i)) {
      const reason = failedIndexes.get(i) || "";
      // Treat duplicates as "ignored" rather than user-facing errors.
      if (/EXISTS|DUPLICATE/i.test(reason)) {
        out.duplicatesIgnored.push(cleaned[i].text);
      } else {
        out.errors.push({ keyword: cleaned[i].text, details: reason });
      }
      continue;
    }
    if (r?.resourceName) {
      out.created += 1;
      out.resourceNames.push(r.resourceName);
    }
  }

  return out;
}

export interface CreateAdGroupInput {
  campaignResourceName: string;
  name: string;
  channel?: "SEARCH" | "DISPLAY" | "SHOPPING" | "VIDEO";
  cpcBidUsd?: number;
}

export async function createAdGroup(input: CreateAdGroupInput): Promise<{ resourceName: string | null; error?: unknown }> {
  const customerId = process.env.GOOGLE_ADS_CUSTOMER_ID;
  if (!customerId) throw new Error("GOOGLE_ADS_CUSTOMER_ID not configured");

  const channel = (input.channel || "SEARCH").toUpperCase();
  const cpcBid = input.cpcBidUsd ?? 1;
  const res = await adsMutate(customerId, "adGroups:mutate", {
    operations: [{ create: {
      name: input.name,
      campaign: input.campaignResourceName,
      status: "PAUSED",
      type: channel === "SEARCH" ? "SEARCH_STANDARD" : channel === "DISPLAY" ? "DISPLAY_STANDARD" : channel === "SHOPPING" ? "SHOPPING_PRODUCT_ADS" : "SEARCH_STANDARD",
      cpcBidMicros: String(Math.round(cpcBid * 1_000_000)),
    } }],
  });
  if (res.status !== 200) {
    return { resourceName: null, error: res.data };
  }
  const resourceName = (res.data as { results?: Array<{ resourceName?: string }> }).results?.[0]?.resourceName || null;
  return { resourceName };
}

// ============================================================
// PMAX Asset Groups (KAN-53) — scaffold
// ============================================================
// PMAX campaigns have no ad groups. Instead, asset groups bundle
// headlines, descriptions, images, logos, and (optional) videos under
// one PMAX campaign. A PMAX campaign needs at least one asset group
// meeting Google-Ads-required minimums before it can serve.
//
// This is the contract scaffold. Backend API wiring lands in PR #18b;
// UI lands in PR #18c. See docs/google-ads-audit.md PR #2c and KAN-53.

/** Creative payload for a single PMAX asset group. */
export interface AssetGroupAssetSpec {
  /** 3-15 short headlines, ≤30 chars each */
  headlines: string[];
  /** 1-5 long headlines, ≤90 chars each */
  longHeadlines: string[];
  /** 2-5 descriptions, ≤90 chars each (Google requires ≥1 ≤60 chars too) */
  descriptions: string[];
  /** Business name, ≤25 chars, required */
  businessName: string;
  /** Landing page URL, required, must start with http(s) */
  finalUrl: string;
  /** ≥1 landscape image URL (1.91:1, 1200×628 recommended) */
  marketingImageUrls: string[];
  /** ≥1 square image URL (1:1, 1200×1200 recommended) */
  squareMarketingImageUrls: string[];
  /** Optional 1:1 logo image URL */
  logoImageUrl?: string;
  /** Optional 4:1 landscape logo image URL */
  landscapeLogoImageUrl?: string;
  /** Optional YouTube video IDs to attach as video assets */
  youtubeVideoIds?: string[];
}

export interface CreateAssetGroupInput {
  /** Parent PMAX campaign resourceName (e.g. "customers/123/campaigns/456") */
  campaignResourceName: string;
  /** Display name shown in Google Ads UI */
  name: string;
  /** Creative payload */
  assets: AssetGroupAssetSpec;
}

export interface CreateAssetGroupResult {
  /** Asset group resourceName, e.g. "customers/123/assetGroups/789" */
  assetGroup: string | null;
  /** Resource names of every created asset (for follow-up linking / DB persistence) */
  assetResourceNames: Array<{ field: string; resourceName: string }>;
  /** Step-by-step errors — asset group can be partially created */
  errors: Array<{ step: string; details: unknown }>;
}

/**
 * Create a Performance Max asset group with required-minimum assets.
 *
 * **NOT YET IMPLEMENTED** — scaffold only. Lands in PR #18b (KAN-53).
 *
 * When implemented, this will:
 *   1. Upload all image URLs as Google Ads IMAGE assets via
 *      `createImageAssetFromUrl()` (reused).
 *   2. Create text assets (`assets:mutate`) for headlines, long
 *      headlines, descriptions, business name.
 *   3. Create the asset group itself (`assetGroups:mutate`).
 *   4. Link each asset to the asset group via `assetGroupAssets:mutate`
 *      with the correct `field_type` (HEADLINE, MARKETING_IMAGE, etc.).
 *
 * Throws on call so any accidental wiring is caught immediately, not
 * silently no-op'd.
 */
/**
 * Create a Performance Max asset group with required-minimum assets.
 *
 * Choreography (5 stages):
 *   1. Validate input against Google Ads hard minimums (fail fast).
 *   2. Upload every image URL as a Google Ads IMAGE asset (parallel).
 *   3. Create text assets (headlines / long headlines / descriptions /
 *      business name) in a single batched assets:mutate call.
 *   4. Create the asset_group itself (PAUSED), pointing at the campaign.
 *   5. Link every created asset to the asset group with the correct
 *      Google Ads field_type via assetGroupAssets:mutate.
 *
 * Errors are accumulated step-by-step in `result.errors`; the asset
 * group can be partially created (e.g. group exists but some asset
 * links failed). Callers should surface warnings instead of treating
 * any error as total failure.
 */
export async function createAssetGroup(input: CreateAssetGroupInput): Promise<CreateAssetGroupResult> {
  const customerId = process.env.GOOGLE_ADS_CUSTOMER_ID;
  if (!customerId) throw new Error("GOOGLE_ADS_CUSTOMER_ID not configured");

  const out: CreateAssetGroupResult = { assetGroup: null, assetResourceNames: [], errors: [] };
  const a = input.assets;

  // 1. Validate — fail fast before burning any API quota
  const validation = validateAssetGroupInput(input);
  if (!validation.valid) {
    out.errors.push({ step: "validation", details: validation.errors });
    return out;
  }

  // 2. Upload images in parallel (each createImageAssetFromUrl makes its own assets:mutate call)
  type ImageJob = { field: string; url: string };
  const imageJobs: ImageJob[] = [
    ...a.marketingImageUrls.map((url) => ({ field: "MARKETING_IMAGE", url })),
    ...a.squareMarketingImageUrls.map((url) => ({ field: "SQUARE_MARKETING_IMAGE", url })),
  ];
  if (a.logoImageUrl) imageJobs.push({ field: "LOGO", url: a.logoImageUrl });
  if (a.landscapeLogoImageUrl) imageJobs.push({ field: "LANDSCAPE_LOGO", url: a.landscapeLogoImageUrl });

  const imageResults = await Promise.all(
    imageJobs.map(async (job) => {
      const r = await createImageAssetFromUrl(job.url);
      return { ...job, resourceName: r.resourceName, error: r.error };
    })
  );
  for (const r of imageResults) {
    if (r.resourceName) {
      out.assetResourceNames.push({ field: r.field, resourceName: r.resourceName });
    } else {
      out.errors.push({ step: `image:${r.field}`, details: { url: r.url, error: r.error } });
    }
  }

  // Bail if we lost a required image — asset group would be unservable
  const hasMarketing = out.assetResourceNames.some((x) => x.field === "MARKETING_IMAGE");
  const hasSquare = out.assetResourceNames.some((x) => x.field === "SQUARE_MARKETING_IMAGE");
  if (!hasMarketing || !hasSquare) {
    out.errors.push({ step: "images:insufficient", details: "At least 1 marketing image and 1 square marketing image must upload successfully." });
    return out;
  }

  // 3. Create text assets in one batched call
  type TextSpec = { field: string; text: string };
  const textSpecs: TextSpec[] = [
    ...a.headlines.map((text) => ({ field: "HEADLINE", text })),
    ...a.longHeadlines.map((text) => ({ field: "LONG_HEADLINE", text })),
    ...a.descriptions.map((text) => ({ field: "DESCRIPTION", text })),
    { field: "BUSINESS_NAME", text: a.businessName },
  ];
  const textRes = await adsMutate(customerId, "assets:mutate", {
    operations: textSpecs.map((s) => ({
      create: { type: "TEXT", textAsset: { text: s.text } },
    })),
  });
  if (textRes.status !== 200) {
    out.errors.push({ step: "text_assets", details: textRes.data });
    return out;
  }
  const textResults = (textRes.data as { results?: Array<{ resourceName?: string }> }).results || [];
  textSpecs.forEach((spec, i) => {
    const rn = textResults[i]?.resourceName;
    if (rn) out.assetResourceNames.push({ field: spec.field, resourceName: rn });
  });

  // 3b. (Optional) YouTube video assets
  if (a.youtubeVideoIds && a.youtubeVideoIds.length > 0) {
    const videoResults = await Promise.all(
      a.youtubeVideoIds.map((vid) => createYouTubeVideoAsset(vid))
    );
    videoResults.forEach((r, i) => {
      if (r.resourceName) {
        out.assetResourceNames.push({ field: "YOUTUBE_VIDEO", resourceName: r.resourceName });
      } else {
        out.errors.push({ step: `video:${a.youtubeVideoIds![i]}`, details: r.error });
      }
    });
  }

  // 4. Create the asset group itself (PAUSED so it can't accidentally serve)
  const agRes = await adsMutate(customerId, "assetGroups:mutate", {
    operations: [{
      create: {
        campaign: input.campaignResourceName,
        name: input.name,
        finalUrls: [a.finalUrl],
        status: "PAUSED",
      },
    }],
  });
  if (agRes.status !== 200) {
    out.errors.push({ step: "asset_group", details: agRes.data });
    return out;
  }
  out.assetGroup = (agRes.data as { results?: Array<{ resourceName?: string }> }).results?.[0]?.resourceName || null;
  if (!out.assetGroup) {
    out.errors.push({ step: "asset_group", details: "No resourceName returned from assetGroups:mutate" });
    return out;
  }

  // 5. Link every uploaded asset to the asset group with its field type
  const linkOps = out.assetResourceNames.map((asset) => ({
    create: {
      assetGroup: out.assetGroup,
      asset: asset.resourceName,
      fieldType: asset.field,
    },
  }));
  if (linkOps.length > 0) {
    const linkRes = await adsMutate(customerId, "assetGroupAssets:mutate", { operations: linkOps });
    if (linkRes.status !== 200) {
      // Partial failure — asset group exists, just surface as warning
      out.errors.push({ step: "asset_group_assets", details: linkRes.data });
    }
  }

  return out;
}

/**
 * Validate a PMAX asset group input against Google Ads hard minimums
 * BEFORE calling the API — fails fast so we don't burn API quota or
 * end up with half-created asset groups.
 *
 * Google Ads PMAX asset group requirements (codified here):
 *   - Headlines:               3-15 items, each ≤30 chars
 *   - Long headlines:          1-5  items, each ≤90 chars
 *   - Descriptions:            2-5  items, each ≤90 chars,
 *                              and ≥1 must be ≤60 chars (short description slot)
 *   - Business name:           required, ≤25 chars
 *   - Final URL:               required, must start with http(s)
 *   - Marketing images:        ≥1 landscape URL
 *   - Square marketing images: ≥1 square URL
 *   - Logo / landscape logo:   optional
 *   - YouTube videos:          optional
 *
 * Returns { valid, errors }. `errors` is an empty array on success and
 * a list of human-readable strings on failure (intended for surfacing
 * to the UI before submission).
 */
export function validateAssetGroupInput(input: CreateAssetGroupInput): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  const a = input.assets;

  // Name + campaign
  if (!input.name || !input.name.trim()) errors.push("Asset group name is required.");
  if (!input.campaignResourceName || !input.campaignResourceName.startsWith("customers/")) {
    errors.push("campaignResourceName must be a Google Ads resource name like 'customers/123/campaigns/456'.");
  }

  // Headlines
  if (!Array.isArray(a.headlines) || a.headlines.length < 3) {
    errors.push("Headlines: at least 3 required.");
  } else if (a.headlines.length > 15) {
    errors.push("Headlines: at most 15 allowed.");
  } else if (a.headlines.some((h) => !h || h.length > 30)) {
    errors.push("Headlines: each must be 1-30 characters.");
  }

  // Long headlines
  if (!Array.isArray(a.longHeadlines) || a.longHeadlines.length < 1) {
    errors.push("Long headlines: at least 1 required.");
  } else if (a.longHeadlines.length > 5) {
    errors.push("Long headlines: at most 5 allowed.");
  } else if (a.longHeadlines.some((h) => !h || h.length > 90)) {
    errors.push("Long headlines: each must be 1-90 characters.");
  }

  // Descriptions
  if (!Array.isArray(a.descriptions) || a.descriptions.length < 2) {
    errors.push("Descriptions: at least 2 required.");
  } else if (a.descriptions.length > 5) {
    errors.push("Descriptions: at most 5 allowed.");
  } else if (a.descriptions.some((d) => !d || d.length > 90)) {
    errors.push("Descriptions: each must be 1-90 characters.");
  } else if (!a.descriptions.some((d) => d.length <= 60)) {
    errors.push("Descriptions: at least one must be ≤60 characters (short description slot).");
  }

  // Business name
  if (!a.businessName || !a.businessName.trim()) {
    errors.push("Business name is required.");
  } else if (a.businessName.length > 25) {
    errors.push("Business name: must be ≤25 characters.");
  }

  // Final URL
  if (!a.finalUrl || !/^https?:\/\//i.test(a.finalUrl)) {
    errors.push("Final URL is required and must start with http:// or https://.");
  }

  // Images
  if (!Array.isArray(a.marketingImageUrls) || a.marketingImageUrls.length < 1) {
    errors.push("Marketing images (landscape 1.91:1): at least 1 required.");
  }
  if (!Array.isArray(a.squareMarketingImageUrls) || a.squareMarketingImageUrls.length < 1) {
    errors.push("Square marketing images (1:1): at least 1 required.");
  }

  return { valid: errors.length === 0, errors };
}

// ---------------------------------------------------------------------------
// Bid strategy (PR #3)
// ---------------------------------------------------------------------------

/** Campaign-level bidding strategies we expose. TARGET_CPA / TARGET_ROAS are
 *  implemented as MaximizeConversions / MaximizeConversionValue with a target,
 *  per Google's standard→smart bidding migration (standalone targetCpa /
 *  targetRoas campaign fields are deprecated). */
export type BidStrategyType =
  | "MANUAL_CPC"
  | "MAXIMIZE_CLICKS"
  | "MAXIMIZE_CONVERSIONS"
  | "TARGET_CPA"
  | "MAXIMIZE_CONVERSION_VALUE"
  | "TARGET_ROAS";

export const BID_STRATEGY_TYPES: BidStrategyType[] = [
  "MANUAL_CPC",
  "MAXIMIZE_CLICKS",
  "MAXIMIZE_CONVERSIONS",
  "TARGET_CPA",
  "MAXIMIZE_CONVERSION_VALUE",
  "TARGET_ROAS",
];

export interface BidStrategyInput {
  type: BidStrategyType;
  /** Required for TARGET_CPA. Average cost you're willing to pay per conversion, in USD. */
  targetCpaUsd?: number;
  /** Required for TARGET_ROAS. Conversion value per dollar spent, e.g. 4 = 400%. Google allows 0.01–1000. */
  targetRoas?: number;
}

/** Which strategies each channel accepts. Channels not listed fall back to ALL. */
const CHANNEL_BID_STRATEGIES: Record<string, BidStrategyType[]> = {
  // Manual CPC is not allowed for VIDEO; clicks-based smart bidding isn't either.
  VIDEO: ["MAXIMIZE_CONVERSIONS", "TARGET_CPA"],
  // PMax requires Smart Bidding (conversions or conversion value).
  PERFORMANCE_MAX: ["MAXIMIZE_CONVERSIONS", "TARGET_CPA", "MAXIMIZE_CONVERSION_VALUE", "TARGET_ROAS"],
  // Demand Gen supports smart bidding + clicks, no manual CPC.
  DEMAND_GEN: ["MAXIMIZE_CLICKS", "MAXIMIZE_CONVERSIONS", "TARGET_CPA", "MAXIMIZE_CONVERSION_VALUE", "TARGET_ROAS"],
};

export function allowedBidStrategies(channelType: string): BidStrategyType[] {
  return CHANNEL_BID_STRATEGIES[channelType] || BID_STRATEGY_TYPES;
}

/** Pure validation — kept separate from the API call so it can be unit-tested. */
export function validateBidStrategyInput(channelType: string, input: BidStrategyInput): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!BID_STRATEGY_TYPES.includes(input.type)) {
    errors.push(`type must be one of: ${BID_STRATEGY_TYPES.join(", ")}`);
    return { valid: false, errors };
  }

  const allowed = allowedBidStrategies(channelType);
  if (!allowed.includes(input.type)) {
    errors.push(`${input.type} is not supported for ${channelType || "this"} campaigns. Allowed: ${allowed.join(", ")}`);
  }

  if (input.type === "TARGET_CPA") {
    if (!Number.isFinite(input.targetCpaUsd) || (input.targetCpaUsd as number) <= 0) {
      errors.push("targetCpaUsd is required for TARGET_CPA and must be > 0.");
    } else if ((input.targetCpaUsd as number) > 100_000) {
      errors.push("targetCpaUsd is unreasonably high (max $100,000).");
    }
  } else if (input.targetCpaUsd !== undefined) {
    errors.push("targetCpaUsd is only valid with type TARGET_CPA.");
  }

  if (input.type === "TARGET_ROAS") {
    if (!Number.isFinite(input.targetRoas) || (input.targetRoas as number) <= 0) {
      errors.push("targetRoas is required for TARGET_ROAS and must be > 0.");
    } else if ((input.targetRoas as number) > 1000) {
      errors.push("targetRoas must be ≤1000 (Google's limit).");
    }
  } else if (input.targetRoas !== undefined) {
    errors.push("targetRoas is only valid with type TARGET_ROAS.");
  }

  return { valid: errors.length === 0, errors };
}

/** Switch a campaign's bidding strategy. Detects the channel type first and
 *  validates the combination before mutating. */
export async function setCampaignBidStrategy(
  campaignResourceName: string,
  input: BidStrategyInput
): Promise<{ success: boolean; error?: unknown }> {
  const customerId = process.env.GOOGLE_ADS_CUSTOMER_ID;
  if (!customerId) throw new Error("GOOGLE_ADS_CUSTOMER_ID not configured");

  const numericCampaignId = campaignResourceName.split("/").pop() || "";
  type ChannelRow = { campaign: { advertisingChannelType?: string } };
  const channelRows = await adsSearchStream(customerId, `
    SELECT campaign.advertising_channel_type FROM campaign WHERE campaign.id = ${numericCampaignId}
  `) as ChannelRow[];
  const channelType = channelRows[0]?.campaign?.advertisingChannelType || "";

  const validation = validateBidStrategyInput(channelType, input);
  if (!validation.valid) return { success: false, error: validation.errors.join(" ") };

  const update: Record<string, unknown> = { resourceName: campaignResourceName };
  let mask = "";
  switch (input.type) {
    case "MANUAL_CPC":
      update.manualCpc = {};
      mask = "manual_cpc";
      break;
    case "MAXIMIZE_CLICKS":
      update.targetSpend = {};
      mask = "target_spend";
      break;
    case "MAXIMIZE_CONVERSIONS":
      update.maximizeConversions = {};
      mask = "maximize_conversions";
      break;
    case "TARGET_CPA":
      update.maximizeConversions = { targetCpaMicros: String(Math.round((input.targetCpaUsd as number) * 1_000_000)) };
      mask = "maximize_conversions";
      break;
    case "MAXIMIZE_CONVERSION_VALUE":
      update.maximizeConversionValue = {};
      mask = "maximize_conversion_value";
      break;
    case "TARGET_ROAS":
      update.maximizeConversionValue = { targetRoas: input.targetRoas };
      mask = "maximize_conversion_value";
      break;
  }

  const res = await adsMutate(customerId, "campaigns:mutate", {
    operations: [{ update, updateMask: mask }],
  });
  if (res.status !== 200) return { success: false, error: res.data };
  return { success: true };
}

// ---------------------------------------------------------------------------
// Campaign-level negative keywords (PR #3)
// ---------------------------------------------------------------------------

/** Channels where campaign-level negative keyword criteria are supported.
 *  PMax negatives have separate semantics (account-level lists) — excluded for now. */
const NEGATIVE_KEYWORD_CHANNELS = new Set(["SEARCH", "DISPLAY", "SHOPPING", "VIDEO"]);

export function channelSupportsNegativeKeywords(channelType: string): boolean {
  return NEGATIVE_KEYWORD_CHANNELS.has(channelType);
}

/** Add negative keywords at the campaign level. Mirrors createKeywords():
 *  partialFailure so duplicates don't sink the batch. */
export async function addCampaignNegativeKeywords(
  campaignResourceName: string,
  keywords: KeywordInput[]
): Promise<CreateKeywordsResult> {
  const customerId = process.env.GOOGLE_ADS_CUSTOMER_ID;
  if (!customerId) throw new Error("GOOGLE_ADS_CUSTOMER_ID not configured");

  const out: CreateKeywordsResult = { created: 0, resourceNames: [], errors: [], duplicatesIgnored: [] };
  const cleaned = keywords
    .map((k) => ({ text: (k.text || "").trim(), matchType: (k.matchType || "BROAD").toUpperCase() as KeywordMatchType }))
    .filter((k) => k.text.length > 0 && k.text.length <= 80);
  if (cleaned.length === 0) return out;

  const operations = cleaned.map((k) => ({
    create: {
      campaign: campaignResourceName,
      negative: true,
      keyword: { text: k.text, matchType: k.matchType },
    },
  }));

  const res = await adsMutate(customerId, "campaignCriteria:mutate", {
    operations,
    partialFailure: true,
  });
  const data = res.data as {
    results?: Array<{ resourceName?: string }>;
    partialFailureError?: { details?: Array<{ errors?: Array<{ message?: string; location?: { fieldPathElements?: Array<{ index?: number }> }; errorCode?: { criterionError?: string } }> }> };
  };

  if (res.status !== 200) {
    out.errors.push({ keyword: "(batch)", details: res.data });
    return out;
  }

  const failedIndexes = new Map<number, string>();
  for (const d of data.partialFailureError?.details || []) {
    for (const err of d.errors || []) {
      const idx = err.location?.fieldPathElements?.[0]?.index;
      if (typeof idx === "number") {
        failedIndexes.set(idx, err.errorCode?.criterionError || err.message || "unknown");
      }
    }
  }

  for (let i = 0; i < cleaned.length; i++) {
    const r = data.results?.[i];
    if (failedIndexes.has(i)) {
      const reason = failedIndexes.get(i) || "";
      if (/EXISTS|DUPLICATE/i.test(reason)) {
        out.duplicatesIgnored.push(cleaned[i].text);
      } else {
        out.errors.push({ keyword: cleaned[i].text, details: reason });
      }
      continue;
    }
    if (r?.resourceName) {
      out.created += 1;
      out.resourceNames.push(r.resourceName);
    }
  }

  return out;
}

// ---------------------------------------------------------------------------
// Ad schedule / day parting
// ---------------------------------------------------------------------------

export const AD_SCHEDULE_DAYS = [
  "MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY",
] as const;
export type AdScheduleDay = (typeof AD_SCHEDULE_DAYS)[number];

export interface AdScheduleInput {
  dayOfWeek: AdScheduleDay;
  /** 0-23. Whole hours only — Google also allows :15/:30/:45, deferred. */
  startHour: number;
  /** 1-24 (24 = end of day). Must be > startHour. */
  endHour: number;
}

/** Channels where campaign-level AD_SCHEDULE criteria apply. PMax / Demand Gen
 *  schedule automatically and reject the criterion. */
const AD_SCHEDULE_CHANNELS = new Set(["SEARCH", "DISPLAY", "SHOPPING", "VIDEO"]);

export function channelSupportsAdSchedule(channelType: string): boolean {
  return AD_SCHEDULE_CHANNELS.has(channelType);
}

/** Pure validation — unit-tested. Google limits: ≤6 intervals per day, no overlaps. */
export function validateAdScheduleInput(schedules: AdScheduleInput[]): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!Array.isArray(schedules)) return { valid: false, errors: ["schedules must be an array."] };
  if (schedules.length > 42) errors.push("Too many intervals (max 6 per day × 7 days).");

  const byDay = new Map<string, Array<{ start: number; end: number }>>();
  schedules.forEach((s, i) => {
    const label = `schedules[${i}]`;
    if (!AD_SCHEDULE_DAYS.includes(s.dayOfWeek)) {
      errors.push(`${label}: dayOfWeek must be one of ${AD_SCHEDULE_DAYS.join(", ")}.`);
      return;
    }
    if (!Number.isInteger(s.startHour) || s.startHour < 0 || s.startHour > 23) {
      errors.push(`${label}: startHour must be an integer 0-23.`);
      return;
    }
    if (!Number.isInteger(s.endHour) || s.endHour < 1 || s.endHour > 24) {
      errors.push(`${label}: endHour must be an integer 1-24.`);
      return;
    }
    if (s.endHour <= s.startHour) {
      errors.push(`${label}: endHour must be after startHour.`);
      return;
    }
    const list = byDay.get(s.dayOfWeek) || [];
    list.push({ start: s.startHour, end: s.endHour });
    byDay.set(s.dayOfWeek, list);
  });

  for (const [day, list] of byDay) {
    if (list.length > 6) errors.push(`${day}: at most 6 intervals per day.`);
    const sorted = [...list].sort((a, b) => a.start - b.start);
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i].start < sorted[i - 1].end) {
        errors.push(`${day}: intervals overlap (${sorted[i - 1].start}-${sorted[i - 1].end} and ${sorted[i].start}-${sorted[i].end}).`);
        break;
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

/** Replace ALL ad-schedule criteria on a campaign. Empty list = run at all times. */
export async function setCampaignAdSchedule(
  campaignResourceName: string,
  schedules: AdScheduleInput[]
): Promise<{ success: boolean; error?: unknown }> {
  const customerId = process.env.GOOGLE_ADS_CUSTOMER_ID;
  if (!customerId) throw new Error("GOOGLE_ADS_CUSTOMER_ID not configured");

  const numericCampaignId = campaignResourceName.split("/").pop() || "";

  type ChannelRow = { campaign: { advertisingChannelType?: string } };
  const channelRows = await adsSearchStream(customerId, `
    SELECT campaign.advertising_channel_type FROM campaign WHERE campaign.id = ${numericCampaignId}
  `) as ChannelRow[];
  const channelType = channelRows[0]?.campaign?.advertisingChannelType || "";
  if (!channelSupportsAdSchedule(channelType)) {
    return { success: false, error: `Ad schedules are not supported for ${channelType || "this"} campaigns` };
  }

  const validation = validateAdScheduleInput(schedules);
  if (!validation.valid) return { success: false, error: validation.errors.join(" ") };

  type CCRow = { campaignCriterion: { resourceName: string } };
  const existing = await adsSearchStream(customerId, `
    SELECT campaign_criterion.resource_name
    FROM campaign_criterion
    WHERE campaign.id = ${numericCampaignId} AND campaign_criterion.type = AD_SCHEDULE
  `) as CCRow[];

  const operations: Record<string, unknown>[] = [
    ...existing.map((r) => ({ remove: r.campaignCriterion.resourceName })),
    ...schedules.map((s) => ({
      create: {
        campaign: campaignResourceName,
        adSchedule: {
          dayOfWeek: s.dayOfWeek,
          startHour: s.startHour,
          startMinute: "ZERO",
          endHour: s.endHour,
          endMinute: "ZERO",
        },
      },
    })),
  ];
  if (operations.length === 0) return { success: true };

  const res = await adsMutate(customerId, "campaignCriteria:mutate", { operations });
  if (res.status !== 200) return { success: false, error: res.data };
  return { success: true };
}

// ---------------------------------------------------------------------------
// Asset library (read-only, slice 1)
// ---------------------------------------------------------------------------

export interface AccountAsset {
  resourceName: string;
  id: string;
  type: string;
  /** Human-readable primary label (link text, callout text, video title, …). */
  label: string;
  /** Secondary detail (URL, snippet values, video id, …). */
  detail: string;
  /** Thumbnail/image URL when available. */
  imageUrl?: string;
  /** Number of campaigns this asset is attached to (campaign_asset links). */
  campaignCount: number;
}

export interface RawAssetRow {
  asset?: {
    resourceName?: string;
    id?: string;
    type?: string;
    name?: string;
    finalUrls?: string[];
    imageAsset?: { fullSize?: { url?: string; widthPixels?: number; heightPixels?: number } };
    textAsset?: { text?: string };
    sitelinkAsset?: { linkText?: string; description1?: string };
    calloutAsset?: { calloutText?: string };
    structuredSnippetAsset?: { header?: string; values?: string[] };
    youtubeVideoAsset?: { youtubeVideoId?: string; youtubeVideoTitle?: string };
  };
}

/** Normalize raw GAQL asset rows into display-ready entries. Pure — unit-tested. */
export function normalizeAssetRows(rows: RawAssetRow[], usage: Map<string, number>): AccountAsset[] {
  const out: AccountAsset[] = [];
  for (const r of rows) {
    const a = r.asset;
    if (!a?.resourceName) continue;
    const type = a.type || "UNKNOWN";
    let label = a.name || "";
    let detail = "";
    let imageUrl: string | undefined;
    switch (type) {
      case "IMAGE":
        imageUrl = a.imageAsset?.fullSize?.url;
        detail = a.imageAsset?.fullSize?.widthPixels && a.imageAsset?.fullSize?.heightPixels
          ? `${a.imageAsset.fullSize.widthPixels}×${a.imageAsset.fullSize.heightPixels}`
          : "";
        label = label || "Image";
        break;
      case "SITELINK":
        label = a.sitelinkAsset?.linkText || label || "Sitelink";
        detail = a.finalUrls?.[0] || a.sitelinkAsset?.description1 || "";
        break;
      case "CALLOUT":
        label = a.calloutAsset?.calloutText || label || "Callout";
        break;
      case "STRUCTURED_SNIPPET":
        label = a.structuredSnippetAsset?.header || label || "Snippet";
        detail = (a.structuredSnippetAsset?.values || []).join(" · ");
        break;
      case "YOUTUBE_VIDEO":
        label = a.youtubeVideoAsset?.youtubeVideoTitle || label || "YouTube video";
        detail = a.youtubeVideoAsset?.youtubeVideoId || "";
        if (a.youtubeVideoAsset?.youtubeVideoId) {
          imageUrl = `https://i.ytimg.com/vi/${a.youtubeVideoAsset.youtubeVideoId}/default.jpg`;
        }
        break;
      case "TEXT":
        label = a.textAsset?.text || label || "Text";
        break;
      default:
        label = label || type;
    }
    if (!label) continue;
    out.push({
      resourceName: a.resourceName,
      id: String(a.id || ""),
      type,
      label,
      detail,
      imageUrl,
      campaignCount: usage.get(a.resourceName) || 0,
    });
  }
  // Most-used first, then by type for stable grouping.
  return out.sort((x, y) => y.campaignCount - x.campaignCount || x.type.localeCompare(y.type));
}

/** Map an asset type to the campaign_asset field type it attaches as.
 *  Returns null for types that don't attach at campaign level (images/videos
 *  ride on ads, not campaign assets). Pure — unit-tested. */
export function assetTypeToFieldType(assetType: string): "SITELINK" | "CALLOUT" | "STRUCTURED_SNIPPET" | null {
  switch (assetType) {
    case "SITELINK": return "SITELINK";
    case "CALLOUT": return "CALLOUT";
    case "STRUCTURED_SNIPPET": return "STRUCTURED_SNIPPET";
    default: return null;
  }
}

/** Attach an EXISTING asset to a campaign (the reuse half of the asset
 *  library). Field type is derived from the asset's actual type server-side —
 *  never trusted from the client. Duplicate links are treated as success. */
export async function attachAssetToCampaign(
  campaignResourceName: string,
  assetResourceName: string
): Promise<{ success: boolean; alreadyAttached?: boolean; error?: unknown }> {
  const customerId = process.env.GOOGLE_ADS_CUSTOMER_ID;
  if (!customerId) throw new Error("GOOGLE_ADS_CUSTOMER_ID not configured");

  if (!/^customers\/\d+\/assets\/\d+$/.test(assetResourceName)) {
    return { success: false, error: "Invalid asset resource name" };
  }

  // Look up the asset's real type.
  type AssetRow = { asset: { type?: string } };
  const escaped = assetResourceName.replace(/'/g, "''");
  const assetRows = await adsSearchStream(customerId, `
    SELECT asset.type FROM asset WHERE asset.resource_name = '${escaped}'
  `) as AssetRow[];
  if (assetRows.length === 0) return { success: false, error: "Asset not found" };
  const fieldType = assetTypeToFieldType(assetRows[0].asset.type || "");
  if (!fieldType) {
    return { success: false, error: `Asset type ${assetRows[0].asset.type || "UNKNOWN"} cannot be attached at campaign level` };
  }

  const res = await adsMutate(customerId, "campaignAssets:mutate", {
    operations: [{ create: { campaign: campaignResourceName, asset: assetResourceName, fieldType } }],
  });
  if (res.status !== 200) {
    // Google rejects duplicate campaign_asset links — that's the desired end state anyway.
    const detail = JSON.stringify(res.data || "");
    if (/DUPLICATE|ALREADY_EXISTS/i.test(detail)) {
      return { success: true, alreadyAttached: true };
    }
    return { success: false, error: res.data };
  }
  return { success: true };
}

/** List account assets with per-asset campaign usage counts. */
export async function fetchAccountAssets(limit = 200): Promise<AccountAsset[]> {
  const customerId = process.env.GOOGLE_ADS_CUSTOMER_ID;
  if (!customerId) throw new Error("GOOGLE_ADS_CUSTOMER_ID not configured");

  const rows = await adsSearchStream(customerId, `
    SELECT asset.resource_name, asset.id, asset.type, asset.name, asset.final_urls,
           asset.image_asset.full_size.url, asset.image_asset.full_size.width_pixels, asset.image_asset.full_size.height_pixels,
           asset.text_asset.text,
           asset.sitelink_asset.link_text, asset.sitelink_asset.description1,
           asset.callout_asset.callout_text,
           asset.structured_snippet_asset.header, asset.structured_snippet_asset.values,
           asset.youtube_video_asset.youtube_video_id, asset.youtube_video_asset.youtube_video_title
    FROM asset
    WHERE asset.type IN (IMAGE, SITELINK, CALLOUT, STRUCTURED_SNIPPET, YOUTUBE_VIDEO, TEXT)
    LIMIT ${Math.min(Math.max(limit, 1), 500)}
  `) as RawAssetRow[];

  // Usage: count campaign_asset links per asset (non-removed).
  type LinkRow = { campaignAsset: { asset?: string } };
  const linkRows = await adsSearchStream(customerId, `
    SELECT campaign_asset.asset
    FROM campaign_asset
    WHERE campaign_asset.status != 'REMOVED'
  `).catch(() => []) as LinkRow[];
  const usage = new Map<string, number>();
  for (const l of linkRows) {
    const key = l.campaignAsset?.asset;
    if (key) usage.set(key, (usage.get(key) || 0) + 1);
  }

  return normalizeAssetRows(rows, usage);
}

// ---------------------------------------------------------------------------
// Location bid adjustments
// ---------------------------------------------------------------------------

export interface LocationModifierInput {
  /** Numeric geo target constant id (matches CampaignDetail.locations[].id). */
  geoId: string;
  /** Bid adjustment percent: -90..900. 0 = reset to no adjustment. */
  percent: number;
}

/** Same channel rule as device modifiers: campaign-criterion-level channels only.
 *  (PMax/DemandGen store locations at ad-group level with no modifier support.) */
export function channelSupportsLocationModifiers(channelType: string): boolean {
  return channelSupportsDeviceModifiers(channelType);
}

/** Pure validation — unit-tested. */
export function validateLocationModifiers(modifiers: LocationModifierInput[]): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!Array.isArray(modifiers) || modifiers.length === 0) {
    return { valid: false, errors: ["At least one modifier is required."] };
  }
  const seen = new Set<string>();
  modifiers.forEach((m, i) => {
    const label = `modifiers[${i}]`;
    if (!/^\d+$/.test(String(m.geoId || ""))) {
      errors.push(`${label}: geoId must be a numeric geo target constant id.`);
      return;
    }
    if (seen.has(m.geoId)) {
      errors.push(`${label}: duplicate geoId ${m.geoId}.`);
      return;
    }
    seen.add(m.geoId);
    if (!Number.isFinite(m.percent) || m.percent < -90 || m.percent > 900) {
      errors.push(`${label}: percent must be between -90 and 900.`);
    }
  });
  return { valid: errors.length === 0, errors };
}

/** Update bid modifiers on EXISTING campaign-level LOCATION criteria.
 *  Only geo ids currently targeted can be adjusted (this mutates criteria,
 *  it does not add/remove targeting — that stays with setCampaignLocations). */
export async function setCampaignLocationModifiers(
  campaignResourceName: string,
  modifiers: LocationModifierInput[]
): Promise<{ success: boolean; updated: number; error?: unknown }> {
  const customerId = process.env.GOOGLE_ADS_CUSTOMER_ID;
  if (!customerId) throw new Error("GOOGLE_ADS_CUSTOMER_ID not configured");

  const numericCampaignId = campaignResourceName.split("/").pop() || "";

  type ChannelRow = { campaign: { advertisingChannelType?: string } };
  const channelRows = await adsSearchStream(customerId, `
    SELECT campaign.advertising_channel_type FROM campaign WHERE campaign.id = ${numericCampaignId}
  `) as ChannelRow[];
  const channelType = channelRows[0]?.campaign?.advertisingChannelType || "";
  if (!channelSupportsLocationModifiers(channelType)) {
    return { success: false, updated: 0, error: `Location bid adjustments are not supported for ${channelType || "this"} campaigns` };
  }

  const validation = validateLocationModifiers(modifiers);
  if (!validation.valid) return { success: false, updated: 0, error: validation.errors.join(" ") };

  // Map geo id → existing criterion resource name
  type CCRow = { campaignCriterion: { resourceName: string; location?: { geoTargetConstant?: string } } };
  const existing = await adsSearchStream(customerId, `
    SELECT campaign_criterion.resource_name, campaign_criterion.location.geo_target_constant
    FROM campaign_criterion
    WHERE campaign.id = ${numericCampaignId} AND campaign_criterion.type = LOCATION
      AND campaign_criterion.negative = FALSE
  `) as CCRow[];
  const byGeoId = new Map<string, string>();
  for (const r of existing) {
    const geoId = (r.campaignCriterion.location?.geoTargetConstant || "").split("/").pop() || "";
    if (geoId) byGeoId.set(geoId, r.campaignCriterion.resourceName);
  }

  const missing = modifiers.filter((m) => !byGeoId.has(m.geoId)).map((m) => m.geoId);
  if (missing.length > 0) {
    return { success: false, updated: 0, error: `Not targeted by this campaign: geo id(s) ${missing.join(", ")}` };
  }

  const operations = modifiers.map((m) => ({
    update: {
      resourceName: byGeoId.get(m.geoId),
      bidModifier: Math.round((1 + m.percent / 100) * 100) / 100,
    },
    updateMask: "bid_modifier",
  }));

  const res = await adsMutate(customerId, "campaignCriteria:mutate", { operations });
  if (res.status !== 200) return { success: false, updated: 0, error: res.data };
  return { success: true, updated: operations.length };
}

// ---------------------------------------------------------------------------
// Sitelink extensions (campaign assets)
// ---------------------------------------------------------------------------

export interface SitelinkInput {
  /** Visible link text, 1-25 chars. */
  linkText: string;
  finalUrl: string;
  /** Optional description lines — Google requires both or neither, ≤35 chars each. */
  description1?: string;
  description2?: string;
}

/** Sitelinks are a Search feature (PMax consumes them via asset groups — deferred). */
const SITELINK_CHANNELS = new Set(["SEARCH"]);

export function channelSupportsSitelinks(channelType: string): boolean {
  return SITELINK_CHANNELS.has(channelType);
}

/** Pure validation — unit-tested. Google serves sitelinks only when a campaign
 *  has ≥2, so we enforce that on create batches too. */
export function validateSitelinkInput(sitelinks: SitelinkInput[]): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!Array.isArray(sitelinks) || sitelinks.length === 0) {
    return { valid: false, errors: ["At least one sitelink is required."] };
  }
  if (sitelinks.length > 20) errors.push("At most 20 sitelinks per campaign.");

  const seen = new Set<string>();
  sitelinks.forEach((s, i) => {
    const label = `sitelinks[${i}]`;
    const text = (s.linkText || "").trim();
    if (!text) errors.push(`${label}: linkText is required.`);
    else if (text.length > 25) errors.push(`${label}: linkText must be ≤25 characters.`);
    else if (seen.has(text.toLowerCase())) errors.push(`${label}: duplicate linkText "${text}".`);
    else seen.add(text.toLowerCase());

    if (!s.finalUrl || !/^https?:\/\//i.test(s.finalUrl)) {
      errors.push(`${label}: finalUrl must start with http:// or https://.`);
    }

    const d1 = (s.description1 || "").trim();
    const d2 = (s.description2 || "").trim();
    if ((d1 && !d2) || (!d1 && d2)) {
      errors.push(`${label}: descriptions must be provided together (both or neither).`);
    }
    if (d1.length > 35) errors.push(`${label}: description1 must be ≤35 characters.`);
    if (d2.length > 35) errors.push(`${label}: description2 must be ≤35 characters.`);
  });

  return { valid: errors.length === 0, errors };
}

export interface CreateSitelinksResult {
  created: number;
  errors: Array<{ linkText: string; details: unknown }>;
}

/** Create sitelink assets and attach them to a campaign (two-step:
 *  assets:mutate → campaignAssets:mutate with fieldType SITELINK). */
export async function createCampaignSitelinks(
  campaignResourceName: string,
  sitelinks: SitelinkInput[]
): Promise<CreateSitelinksResult> {
  const customerId = process.env.GOOGLE_ADS_CUSTOMER_ID;
  if (!customerId) throw new Error("GOOGLE_ADS_CUSTOMER_ID not configured");

  const out: CreateSitelinksResult = { created: 0, errors: [] };

  const validation = validateSitelinkInput(sitelinks);
  if (!validation.valid) {
    out.errors.push({ linkText: "(batch)", details: validation.errors.join(" ") });
    return out;
  }

  // Step 1: create the sitelink assets
  const assetOps = sitelinks.map((s) => {
    const sitelinkAsset: Record<string, unknown> = { linkText: s.linkText.trim() };
    const d1 = (s.description1 || "").trim();
    const d2 = (s.description2 || "").trim();
    if (d1 && d2) {
      sitelinkAsset.description1 = d1;
      sitelinkAsset.description2 = d2;
    }
    return { create: { sitelinkAsset, finalUrls: [s.finalUrl] } };
  });
  const assetRes = await adsMutate(customerId, "assets:mutate", { operations: assetOps });
  if (assetRes.status !== 200) {
    out.errors.push({ linkText: "(assets)", details: assetRes.data });
    return out;
  }
  const assetNames = ((assetRes.data as { results?: Array<{ resourceName?: string }> })?.results || [])
    .map((r) => r.resourceName)
    .filter(Boolean) as string[];

  // Step 2: link them to the campaign
  const linkOps = assetNames.map((asset) => ({
    create: { campaign: campaignResourceName, asset, fieldType: "SITELINK" },
  }));
  const linkRes = await adsMutate(customerId, "campaignAssets:mutate", { operations: linkOps });
  if (linkRes.status !== 200) {
    out.errors.push({ linkText: "(campaign link)", details: linkRes.data });
    return out;
  }

  out.created = assetNames.length;
  return out;
}

/** Detach a sitelink from a campaign (removes the campaign_asset link;
 *  the underlying asset stays in the account for reuse). */
export async function removeCampaignSitelink(
  campaignAssetResourceName: string
): Promise<{ success: boolean; error?: unknown }> {
  const customerId = process.env.GOOGLE_ADS_CUSTOMER_ID;
  if (!customerId) throw new Error("GOOGLE_ADS_CUSTOMER_ID not configured");

  if (!/^customers\/\d+\/campaignAssets\/\d+~\d+~SITELINK$/.test(campaignAssetResourceName)) {
    return { success: false, error: "Invalid campaign asset resource name" };
  }

  const res = await adsMutate(customerId, "campaignAssets:mutate", {
    operations: [{ remove: campaignAssetResourceName }],
  });
  if (res.status !== 200) return { success: false, error: res.data };
  return { success: true };
}

// ---------------------------------------------------------------------------
// Search terms report
// ---------------------------------------------------------------------------

export interface SearchTermStat {
  term: string;
  /** Whether the term is already added/excluded/none, per Google. */
  status: string;
  impressions: number;
  clicks: number;
  costMicros: number;
  conversions: number;
}

export interface SearchTermRawRow {
  searchTermView?: { searchTerm?: string; status?: string };
  metrics?: { impressions?: string; clicks?: string; costMicros?: string; conversions?: number };
}

/** Aggregate raw search_term_view rows (may repeat per segment) into unique
 *  terms sorted by impressions desc. Pure — unit-tested. */
export function aggregateSearchTermRows(rows: SearchTermRawRow[], limit = 100): SearchTermStat[] {
  const byTerm = new Map<string, SearchTermStat>();
  for (const r of rows) {
    const term = (r.searchTermView?.searchTerm || "").trim();
    if (!term) continue;
    const existing = byTerm.get(term.toLowerCase()) || {
      term,
      status: r.searchTermView?.status || "",
      impressions: 0,
      clicks: 0,
      costMicros: 0,
      conversions: 0,
    };
    existing.impressions += Number(r.metrics?.impressions || 0);
    existing.clicks += Number(r.metrics?.clicks || 0);
    existing.costMicros += Number(r.metrics?.costMicros || 0);
    existing.conversions += Number(r.metrics?.conversions || 0);
    byTerm.set(term.toLowerCase(), existing);
  }
  return [...byTerm.values()]
    .sort((a, b) => b.impressions - a.impressions)
    .slice(0, Math.max(1, limit));
}

/** Last-30-days search terms for a campaign, aggregated and ranked. */
export async function fetchSearchTerms(campaignResourceName: string, limit = 100): Promise<SearchTermStat[]> {
  const customerId = process.env.GOOGLE_ADS_CUSTOMER_ID;
  if (!customerId) throw new Error("GOOGLE_ADS_CUSTOMER_ID not configured");

  const numericCampaignId = campaignResourceName.split("/").pop() || "";
  const rows = await adsSearchStream(customerId, `
    SELECT search_term_view.search_term, search_term_view.status,
           metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions
    FROM search_term_view
    WHERE campaign.id = ${numericCampaignId} AND segments.date DURING LAST_30_DAYS
    ORDER BY metrics.impressions DESC
    LIMIT 500
  `) as SearchTermRawRow[];

  return aggregateSearchTermRows(rows, limit);
}

// ---------------------------------------------------------------------------
// Callout + structured snippet extensions (campaign assets)
// ---------------------------------------------------------------------------

/** Google's fixed set of structured-snippet headers (API expects the EN text). */
export const STRUCTURED_SNIPPET_HEADERS = [
  "Amenities", "Brands", "Courses", "Degree programs", "Destinations",
  "Featured hotels", "Insurance coverage", "Models", "Neighborhoods",
  "Service catalog", "Shows", "Styles", "Types",
] as const;
export type StructuredSnippetHeader = (typeof STRUCTURED_SNIPPET_HEADERS)[number];

export interface StructuredSnippetInput {
  header: StructuredSnippetHeader;
  /** 3-10 values, each ≤25 chars. */
  values: string[];
}

/** Callouts and snippets ride the same SEARCH-only rule as sitelinks. */
export function channelSupportsTextExtensions(channelType: string): boolean {
  return channelSupportsSitelinks(channelType);
}

/** Pure validation for callout texts — unit-tested. */
export function validateCalloutInput(texts: string[]): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!Array.isArray(texts) || texts.length === 0) {
    return { valid: false, errors: ["At least one callout is required."] };
  }
  if (texts.length > 20) errors.push("At most 20 callouts per batch.");
  const seen = new Set<string>();
  texts.forEach((raw, i) => {
    const text = (raw || "").trim();
    const label = `callouts[${i}]`;
    if (!text) errors.push(`${label}: text is required.`);
    else if (text.length > 25) errors.push(`${label}: text must be ≤25 characters.`);
    else if (seen.has(text.toLowerCase())) errors.push(`${label}: duplicate "${text}".`);
    else seen.add(text.toLowerCase());
  });
  return { valid: errors.length === 0, errors };
}

/** Pure validation for a structured snippet — unit-tested. */
export function validateStructuredSnippetInput(input: StructuredSnippetInput): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!STRUCTURED_SNIPPET_HEADERS.includes(input.header)) {
    errors.push(`header must be one of: ${STRUCTURED_SNIPPET_HEADERS.join(", ")}`);
  }
  const values = (input.values || []).map((v) => (v || "").trim()).filter(Boolean);
  if (values.length < 3) errors.push("At least 3 values required (Google's minimum).");
  if (values.length > 10) errors.push("At most 10 values allowed.");
  const seen = new Set<string>();
  values.forEach((v, i) => {
    if (v.length > 25) errors.push(`values[${i}]: must be ≤25 characters.`);
    else if (seen.has(v.toLowerCase())) errors.push(`values[${i}]: duplicate "${v}".`);
    else seen.add(v.toLowerCase());
  });
  return { valid: errors.length === 0, errors };
}

/** Create callout assets and attach them to a campaign. */
export async function createCampaignCallouts(
  campaignResourceName: string,
  texts: string[]
): Promise<{ created: number; error?: unknown }> {
  const customerId = process.env.GOOGLE_ADS_CUSTOMER_ID;
  if (!customerId) throw new Error("GOOGLE_ADS_CUSTOMER_ID not configured");

  const validation = validateCalloutInput(texts);
  if (!validation.valid) return { created: 0, error: validation.errors.join(" ") };

  const assetRes = await adsMutate(customerId, "assets:mutate", {
    operations: texts.map((t) => ({ create: { calloutAsset: { calloutText: t.trim() } } })),
  });
  if (assetRes.status !== 200) return { created: 0, error: assetRes.data };
  const assetNames = ((assetRes.data as { results?: Array<{ resourceName?: string }> })?.results || [])
    .map((r) => r.resourceName)
    .filter(Boolean) as string[];

  const linkRes = await adsMutate(customerId, "campaignAssets:mutate", {
    operations: assetNames.map((asset) => ({
      create: { campaign: campaignResourceName, asset, fieldType: "CALLOUT" },
    })),
  });
  if (linkRes.status !== 200) return { created: 0, error: linkRes.data };
  return { created: assetNames.length };
}

/** Create one structured-snippet asset and attach it to a campaign. */
export async function createCampaignStructuredSnippet(
  campaignResourceName: string,
  input: StructuredSnippetInput
): Promise<{ created: number; error?: unknown }> {
  const customerId = process.env.GOOGLE_ADS_CUSTOMER_ID;
  if (!customerId) throw new Error("GOOGLE_ADS_CUSTOMER_ID not configured");

  const validation = validateStructuredSnippetInput(input);
  if (!validation.valid) return { created: 0, error: validation.errors.join(" ") };

  const values = input.values.map((v) => v.trim()).filter(Boolean);
  const assetRes = await adsMutate(customerId, "assets:mutate", {
    operations: [{ create: { structuredSnippetAsset: { header: input.header, values } } }],
  });
  if (assetRes.status !== 200) return { created: 0, error: assetRes.data };
  const assetName = (assetRes.data as { results?: Array<{ resourceName?: string }> })?.results?.[0]?.resourceName;
  if (!assetName) return { created: 0, error: "Asset created but no resource name returned" };

  const linkRes = await adsMutate(customerId, "campaignAssets:mutate", {
    operations: [{ create: { campaign: campaignResourceName, asset: assetName, fieldType: "STRUCTURED_SNIPPET" } }],
  });
  if (linkRes.status !== 200) return { created: 0, error: linkRes.data };
  return { created: 1 };
}

/** Pure validation for a call asset — unit-tested. */
export function validateCallAssetInput(input: { countryCode: string; phoneNumber: string }): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  const cc = (input.countryCode || "").trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(cc)) {
    errors.push("countryCode must be a 2-letter ISO code (e.g. US, CN).");
  }
  const digits = (input.phoneNumber || "").replace(/[\s\-().+]/g, "");
  if (!/^\d{7,15}$/.test(digits)) {
    errors.push("phoneNumber must contain 7-15 digits (separators allowed).");
  }
  return { valid: errors.length === 0, errors };
}

/** Create a call asset and attach it to a campaign (call extension). */
export async function createCampaignCallAsset(
  campaignResourceName: string,
  input: { countryCode: string; phoneNumber: string }
): Promise<{ created: number; error?: unknown }> {
  const customerId = process.env.GOOGLE_ADS_CUSTOMER_ID;
  if (!customerId) throw new Error("GOOGLE_ADS_CUSTOMER_ID not configured");

  const validation = validateCallAssetInput(input);
  if (!validation.valid) return { created: 0, error: validation.errors.join(" ") };

  const assetRes = await adsMutate(customerId, "assets:mutate", {
    operations: [{
      create: {
        callAsset: {
          countryCode: input.countryCode.trim().toUpperCase(),
          phoneNumber: input.phoneNumber.trim(),
        },
      },
    }],
  });
  if (assetRes.status !== 200) return { created: 0, error: assetRes.data };
  const assetName = (assetRes.data as { results?: Array<{ resourceName?: string }> })?.results?.[0]?.resourceName;
  if (!assetName) return { created: 0, error: "Asset created but no resource name returned" };

  const linkRes = await adsMutate(customerId, "campaignAssets:mutate", {
    operations: [{ create: { campaign: campaignResourceName, asset: assetName, fieldType: "CALL" } }],
  });
  if (linkRes.status !== 200) return { created: 0, error: linkRes.data };
  return { created: 1 };
}

// ---------------------------------------------------------------------------
// Promotion extensions
// ---------------------------------------------------------------------------

/** Curated PromotionExtensionOccasion values (v20 enum subset — the common ones). */
export const PROMOTION_OCCASIONS = [
  "NONE",
  "NEW_YEARS",
  "CHINESE_NEW_YEAR",
  "VALENTINES_DAY",
  "EASTER",
  "MOTHERS_DAY",
  "FATHERS_DAY",
  "BACK_TO_SCHOOL",
  "HALLOWEEN",
  "SINGLES_DAY",
  "BLACK_FRIDAY",
  "CYBER_MONDAY",
  "CHRISTMAS",
  "BOXING_DAY",
  "SPRING_SALE",
  "SUMMER_SALE",
  "FALL_SALE",
  "WINTER_SALE",
  "END_OF_SEASON",
] as const;
export type PromotionOccasion = (typeof PROMOTION_OCCASIONS)[number];

export interface PromotionInput {
  /** The promoted item, e.g. "All running shoes". ≤20 chars (Google UI limit). */
  promotionTarget: string;
  /** Whole percent 1..100. Exactly one of percentOff / moneyAmountOff. */
  percentOff?: number;
  /** Money discount, in account currency units (e.g. 15 = $15 off). */
  moneyAmountOff?: number;
  /** ISO-4217 code for moneyAmountOff. Default USD. */
  currencyCode?: string;
  /** Optional promo code, ≤15 chars. Mutually exclusive with ordersOverAmount. */
  promotionCode?: string;
  /** Optional min order value ("on orders over $X"), account currency units. */
  ordersOverAmount?: number;
  /** BCP-47 language of the promotion text, e.g. "en", "zh". Default "en". */
  languageCode?: string;
  occasion?: string;
  /** YYYY-MM-DD. Both or neither; end ≥ start. */
  redemptionStartDate?: string;
  redemptionEndDate?: string;
  /** Landing page for the promotion. Required. */
  finalUrl: string;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Pure validation for a promotion asset — unit-tested. */
export function validatePromotionInput(input: PromotionInput): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  const target = (input.promotionTarget || "").trim();
  if (!target) errors.push("promotionTarget is required.");
  else if (target.length > 20) errors.push("promotionTarget must be ≤20 characters.");

  const hasPercent = input.percentOff !== undefined && input.percentOff !== null;
  const hasMoney = input.moneyAmountOff !== undefined && input.moneyAmountOff !== null;
  if (hasPercent === hasMoney) {
    errors.push("Exactly one of percentOff or moneyAmountOff is required.");
  } else if (hasPercent) {
    const pct = Number(input.percentOff);
    if (!Number.isFinite(pct) || pct < 1 || pct > 100) errors.push("percentOff must be between 1 and 100.");
  } else {
    const amt = Number(input.moneyAmountOff);
    if (!Number.isFinite(amt) || amt <= 0) errors.push("moneyAmountOff must be > 0.");
    const cur = (input.currencyCode || "USD").trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(cur)) errors.push("currencyCode must be a 3-letter ISO code.");
  }

  if (input.promotionCode && input.ordersOverAmount) {
    errors.push("promotionCode and ordersOverAmount are mutually exclusive.");
  }
  if (input.promotionCode && input.promotionCode.trim().length > 15) {
    errors.push("promotionCode must be ≤15 characters.");
  }
  if (input.ordersOverAmount !== undefined && input.ordersOverAmount !== null) {
    const over = Number(input.ordersOverAmount);
    if (!Number.isFinite(over) || over <= 0) errors.push("ordersOverAmount must be > 0.");
  }

  const lang = (input.languageCode || "en").trim();
  if (!/^[a-z]{2,3}(-[A-Za-z]{2,4})?$/.test(lang)) {
    errors.push('languageCode must be a BCP-47 code like "en" or "zh-CN".');
  }
  if (input.occasion && !(PROMOTION_OCCASIONS as readonly string[]).includes(input.occasion)) {
    errors.push(`occasion must be one of: ${PROMOTION_OCCASIONS.join(", ")}`);
  }

  const start = (input.redemptionStartDate || "").trim();
  const end = (input.redemptionEndDate || "").trim();
  if (Boolean(start) !== Boolean(end)) {
    errors.push("redemptionStartDate and redemptionEndDate must be provided together.");
  } else if (start && end) {
    if (!DATE_RE.test(start) || !DATE_RE.test(end)) errors.push("Redemption dates must be YYYY-MM-DD.");
    else if (end < start) errors.push("redemptionEndDate must be on or after redemptionStartDate.");
  }

  if (!/^https?:\/\//i.test((input.finalUrl || "").trim())) {
    errors.push("finalUrl must start with http:// or https://");
  }

  return { valid: errors.length === 0, errors };
}

/** Create one promotion asset and attach it to a campaign (promotion extension). */
export async function createCampaignPromotion(
  campaignResourceName: string,
  input: PromotionInput
): Promise<{ created: number; error?: unknown }> {
  const customerId = process.env.GOOGLE_ADS_CUSTOMER_ID;
  if (!customerId) throw new Error("GOOGLE_ADS_CUSTOMER_ID not configured");

  const validation = validatePromotionInput(input);
  if (!validation.valid) return { created: 0, error: validation.errors.join(" ") };

  const promotionAsset: Record<string, unknown> = {
    promotionTarget: input.promotionTarget.trim(),
    languageCode: (input.languageCode || "en").trim(),
  };
  if (input.percentOff !== undefined && input.percentOff !== null) {
    // Google expects micros: 1,000,000 = 100% → whole percent × 10,000.
    promotionAsset.percentOff = String(Math.round(Number(input.percentOff) * 10_000));
  } else {
    promotionAsset.moneyAmountOff = {
      currencyCode: (input.currencyCode || "USD").trim().toUpperCase(),
      amountMicros: String(Math.round(Number(input.moneyAmountOff) * 1_000_000)),
    };
  }
  if (input.promotionCode?.trim()) promotionAsset.promotionCode = input.promotionCode.trim();
  if (input.ordersOverAmount) {
    promotionAsset.ordersOverAmount = {
      currencyCode: (input.currencyCode || "USD").trim().toUpperCase(),
      amountMicros: String(Math.round(Number(input.ordersOverAmount) * 1_000_000)),
    };
  }
  if (input.occasion && input.occasion !== "NONE") promotionAsset.occasion = input.occasion;
  if (input.redemptionStartDate?.trim()) {
    promotionAsset.redemptionStartDate = input.redemptionStartDate.trim();
    promotionAsset.redemptionEndDate = (input.redemptionEndDate || "").trim();
  }

  const assetRes = await adsMutate(customerId, "assets:mutate", {
    operations: [{
      create: {
        finalUrls: [input.finalUrl.trim()],
        promotionAsset,
      },
    }],
  });
  if (assetRes.status !== 200) return { created: 0, error: assetRes.data };
  const assetName = (assetRes.data as { results?: Array<{ resourceName?: string }> })?.results?.[0]?.resourceName;
  if (!assetName) return { created: 0, error: "Asset created but no resource name returned" };

  const linkRes = await adsMutate(customerId, "campaignAssets:mutate", {
    operations: [{ create: { campaign: campaignResourceName, asset: assetName, fieldType: "PROMOTION" } }],
  });
  if (linkRes.status !== 200) return { created: 0, error: linkRes.data };
  return { created: 1 };
}

// ---------------------------------------------------------------------------
// Price extensions
// ---------------------------------------------------------------------------

/** PriceExtensionType enum (v20). */
export const PRICE_TYPES = [
  "BRANDS",
  "EVENTS",
  "LOCATIONS",
  "NEIGHBORHOODS",
  "PRODUCT_CATEGORIES",
  "PRODUCT_TIERS",
  "SERVICES",
  "SERVICE_CATEGORIES",
  "SERVICE_TIERS",
] as const;
export type PriceType = (typeof PRICE_TYPES)[number];

/** PriceExtensionPriceQualifier enum (v20). NONE = show the bare price. */
export const PRICE_QUALIFIERS = ["NONE", "FROM", "UP_TO", "AVERAGE"] as const;
export type PriceQualifier = (typeof PRICE_QUALIFIERS)[number];

/** PriceExtensionPriceUnit enum (v20). NONE = flat price. */
export const PRICE_UNITS = ["NONE", "PER_HOUR", "PER_DAY", "PER_WEEK", "PER_MONTH", "PER_YEAR", "PER_NIGHT"] as const;
export type PriceUnit = (typeof PRICE_UNITS)[number];

export interface PriceOfferingInput {
  /** e.g. "Basic plan". ≤25 chars. */
  header: string;
  /** e.g. "Up to 5 users". ≤25 chars. */
  description: string;
  /** Price in account currency units (e.g. 29.99). Must be > 0. */
  price: number;
  unit?: PriceUnit | string;
  /** Landing page for this offering. Required, http(s). */
  finalUrl: string;
}

export interface PriceAssetInput {
  type: PriceType | string;
  priceQualifier?: PriceQualifier | string;
  /** ISO-4217, default USD. Shared by all offerings. */
  currencyCode?: string;
  /** BCP-47 language of the texts, default "en". */
  languageCode?: string;
  /** 3-8 offerings (Google's hard limits). */
  offerings: PriceOfferingInput[];
}

/** Pure validation for a price asset — unit-tested. */
export function validatePriceAssetInput(input: PriceAssetInput): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!(PRICE_TYPES as readonly string[]).includes(String(input.type || ""))) {
    errors.push(`type must be one of: ${PRICE_TYPES.join(", ")}`);
  }
  const qualifier = String(input.priceQualifier || "NONE");
  if (!(PRICE_QUALIFIERS as readonly string[]).includes(qualifier)) {
    errors.push(`priceQualifier must be one of: ${PRICE_QUALIFIERS.join(", ")}`);
  }
  const cur = (input.currencyCode || "USD").trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(cur)) errors.push("currencyCode must be a 3-letter ISO code.");
  const lang = (input.languageCode || "en").trim();
  if (!/^[a-z]{2,3}(-[A-Za-z]{2,4})?$/.test(lang)) {
    errors.push('languageCode must be a BCP-47 code like "en" or "zh-CN".');
  }

  const offerings = input.offerings || [];
  if (offerings.length < 3 || offerings.length > 8) {
    errors.push("Between 3 and 8 price offerings required (Google's limits).");
  }
  const seenHeaders = new Set<string>();
  offerings.forEach((o, i) => {
    const label = `offerings[${i}]`;
    const header = (o.header || "").trim();
    const description = (o.description || "").trim();
    if (!header) errors.push(`${label}: header is required.`);
    else if (header.length > 25) errors.push(`${label}: header must be ≤25 characters.`);
    else if (seenHeaders.has(header.toLowerCase())) errors.push(`${label}: duplicate header "${header}".`);
    else seenHeaders.add(header.toLowerCase());
    if (!description) errors.push(`${label}: description is required.`);
    else if (description.length > 25) errors.push(`${label}: description must be ≤25 characters.`);
    const price = Number(o.price);
    if (!Number.isFinite(price) || price <= 0) errors.push(`${label}: price must be > 0.`);
    const unit = String(o.unit || "NONE");
    if (!(PRICE_UNITS as readonly string[]).includes(unit)) {
      errors.push(`${label}: unit must be one of: ${PRICE_UNITS.join(", ")}`);
    }
    if (!/^https?:\/\//i.test((o.finalUrl || "").trim())) {
      errors.push(`${label}: finalUrl must start with http:// or https://`);
    }
  });

  return { valid: errors.length === 0, errors };
}

/** Create one price asset and attach it to a campaign (price extension). */
export async function createCampaignPriceAsset(
  campaignResourceName: string,
  input: PriceAssetInput
): Promise<{ created: number; error?: unknown }> {
  const customerId = process.env.GOOGLE_ADS_CUSTOMER_ID;
  if (!customerId) throw new Error("GOOGLE_ADS_CUSTOMER_ID not configured");

  const validation = validatePriceAssetInput(input);
  if (!validation.valid) return { created: 0, error: validation.errors.join(" ") };

  const currencyCode = (input.currencyCode || "USD").trim().toUpperCase();
  const priceAsset: Record<string, unknown> = {
    type: input.type,
    languageCode: (input.languageCode || "en").trim(),
    priceOfferings: input.offerings.map((o) => ({
      header: o.header.trim(),
      description: o.description.trim(),
      price: { currencyCode, amountMicros: String(Math.round(Number(o.price) * 1_000_000)) },
      ...(o.unit && o.unit !== "NONE" ? { unit: o.unit } : {}),
      finalUrl: o.finalUrl.trim(),
    })),
  };
  if (input.priceQualifier && input.priceQualifier !== "NONE") {
    priceAsset.priceQualifier = input.priceQualifier;
  }

  const assetRes = await adsMutate(customerId, "assets:mutate", {
    operations: [{ create: { priceAsset } }],
  });
  if (assetRes.status !== 200) return { created: 0, error: assetRes.data };
  const assetName = (assetRes.data as { results?: Array<{ resourceName?: string }> })?.results?.[0]?.resourceName;
  if (!assetName) return { created: 0, error: "Asset created but no resource name returned" };

  const linkRes = await adsMutate(customerId, "campaignAssets:mutate", {
    operations: [{ create: { campaign: campaignResourceName, asset: assetName, fieldType: "PRICE" } }],
  });
  if (linkRes.status !== 200) return { created: 0, error: linkRes.data };
  return { created: 1 };
}

/** Detach a callout / structured-snippet / call / promotion asset from a campaign (asset kept for reuse). */
export async function removeCampaignExtensionAsset(
  campaignAssetResourceName: string
): Promise<{ success: boolean; error?: unknown }> {
  const customerId = process.env.GOOGLE_ADS_CUSTOMER_ID;
  if (!customerId) throw new Error("GOOGLE_ADS_CUSTOMER_ID not configured");

  if (!/^customers\/\d+\/campaignAssets\/\d+~\d+~(CALLOUT|STRUCTURED_SNIPPET|CALL|PROMOTION|PRICE)$/.test(campaignAssetResourceName)) {
    return { success: false, error: "Invalid campaign asset resource name" };
  }

  const res = await adsMutate(customerId, "campaignAssets:mutate", {
    operations: [{ remove: campaignAssetResourceName }],
  });
  if (res.status !== 200) return { success: false, error: res.data };
  return { success: true };
}

// ---------------------------------------------------------------------------
// Device bid adjustments
// ---------------------------------------------------------------------------

export const DEVICE_TYPES = ["MOBILE", "DESKTOP", "TABLET"] as const;
export type DeviceType = (typeof DEVICE_TYPES)[number];

export interface DeviceModifierInput {
  device: DeviceType;
  /** Bid adjustment percent: -90..900. 0 = no adjustment. Use `exclude` to opt out entirely. */
  percent: number;
  /** true = don't serve on this device at all (Google: bid_modifier 0). */
  exclude?: boolean;
}

/** Channels supporting campaign-level device bid modifiers. VIDEO allows only
 *  -100% (exclusion) semantics and PMax/DemandGen none — kept out for now. */
const DEVICE_MODIFIER_CHANNELS = new Set(["SEARCH", "DISPLAY", "SHOPPING"]);

export function channelSupportsDeviceModifiers(channelType: string): boolean {
  return DEVICE_MODIFIER_CHANNELS.has(channelType);
}

/** Pure validation — unit-tested. */
export function validateDeviceModifiers(modifiers: DeviceModifierInput[]): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!Array.isArray(modifiers)) return { valid: false, errors: ["modifiers must be an array."] };

  const seen = new Set<string>();
  modifiers.forEach((m, i) => {
    const label = `modifiers[${i}]`;
    if (!DEVICE_TYPES.includes(m.device)) {
      errors.push(`${label}: device must be one of ${DEVICE_TYPES.join(", ")}.`);
      return;
    }
    if (seen.has(m.device)) {
      errors.push(`${label}: duplicate device ${m.device}.`);
      return;
    }
    seen.add(m.device);
    if (m.exclude) return; // percent ignored when excluding
    if (!Number.isFinite(m.percent) || m.percent < -90 || m.percent > 900) {
      errors.push(`${label}: percent must be between -90 and 900 (Google's bid modifier range).`);
    }
  });

  if (modifiers.length > 0 && modifiers.every((m) => m.exclude)) {
    errors.push("At least one device must remain enabled.");
  }

  return { valid: errors.length === 0, errors };
}

/** Replace ALL device criteria on a campaign. Empty list = no adjustments
 *  (all devices, default bids). percent→factor: factor = 1 + percent/100;
 *  exclude → bid_modifier 0 (Google's device opt-out). */
export async function setCampaignDeviceModifiers(
  campaignResourceName: string,
  modifiers: DeviceModifierInput[]
): Promise<{ success: boolean; error?: unknown }> {
  const customerId = process.env.GOOGLE_ADS_CUSTOMER_ID;
  if (!customerId) throw new Error("GOOGLE_ADS_CUSTOMER_ID not configured");

  const numericCampaignId = campaignResourceName.split("/").pop() || "";

  type ChannelRow = { campaign: { advertisingChannelType?: string } };
  const channelRows = await adsSearchStream(customerId, `
    SELECT campaign.advertising_channel_type FROM campaign WHERE campaign.id = ${numericCampaignId}
  `) as ChannelRow[];
  const channelType = channelRows[0]?.campaign?.advertisingChannelType || "";
  if (!channelSupportsDeviceModifiers(channelType)) {
    return { success: false, error: `Device bid adjustments are not supported for ${channelType || "this"} campaigns` };
  }

  const validation = validateDeviceModifiers(modifiers);
  if (!validation.valid) return { success: false, error: validation.errors.join(" ") };

  type CCRow = { campaignCriterion: { resourceName: string } };
  const existing = await adsSearchStream(customerId, `
    SELECT campaign_criterion.resource_name
    FROM campaign_criterion
    WHERE campaign.id = ${numericCampaignId} AND campaign_criterion.type = DEVICE
  `) as CCRow[];

  const operations: Record<string, unknown>[] = [
    ...existing.map((r) => ({ remove: r.campaignCriterion.resourceName })),
    ...modifiers
      // percent 0 without exclude = default behavior → no criterion needed
      .filter((m) => m.exclude || m.percent !== 0)
      .map((m) => ({
        create: {
          campaign: campaignResourceName,
          device: { type: m.device },
          bidModifier: m.exclude ? 0 : Math.round((1 + m.percent / 100) * 100) / 100,
        },
      })),
  ];
  if (operations.length === 0) return { success: true };

  const res = await adsMutate(customerId, "campaignCriteria:mutate", { operations });
  if (res.status !== 200) return { success: false, error: res.data };
  return { success: true };
}

// ---------------------------------------------------------------------------
// Ad-schedule interval bid modifiers
// ---------------------------------------------------------------------------

export interface ScheduleModifierInput {
  /** The AD_SCHEDULE campaign criterion resource name (from CampaignDetail.adSchedules). */
  criterionResourceName: string;
  /** Bid adjustment percent: -90..900. 0 = reset to no adjustment. */
  percent: number;
}

/** Same channel rule as the other campaign-criterion modifiers. */
export function channelSupportsScheduleModifiers(channelType: string): boolean {
  return channelSupportsDeviceModifiers(channelType);
}

/** Pure validation — unit-tested. */
export function validateScheduleModifiers(modifiers: ScheduleModifierInput[]): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!Array.isArray(modifiers) || modifiers.length === 0) {
    return { valid: false, errors: ["At least one modifier is required."] };
  }
  const seen = new Set<string>();
  modifiers.forEach((m, i) => {
    const label = `modifiers[${i}]`;
    if (!/^customers\/\d+\/campaignCriteria\/\d+~\d+$/.test(m.criterionResourceName || "")) {
      errors.push(`${label}: criterionResourceName must be a campaign criterion resource name.`);
      return;
    }
    if (seen.has(m.criterionResourceName)) {
      errors.push(`${label}: duplicate criterion.`);
      return;
    }
    seen.add(m.criterionResourceName);
    if (!Number.isFinite(m.percent) || m.percent < -90 || m.percent > 900) {
      errors.push(`${label}: percent must be between -90 and 900.`);
    }
  });
  return { valid: errors.length === 0, errors };
}

/** Update bid modifiers on EXISTING ad-schedule criteria. Note: the
 *  replace-all schedule editor recreates criteria, which resets modifiers —
 *  callers should surface that (documented on the ⏰ card + checklist). */
export async function setCampaignScheduleModifiers(
  campaignResourceName: string,
  modifiers: ScheduleModifierInput[]
): Promise<{ success: boolean; updated: number; error?: unknown }> {
  const customerId = process.env.GOOGLE_ADS_CUSTOMER_ID;
  if (!customerId) throw new Error("GOOGLE_ADS_CUSTOMER_ID not configured");

  const numericCampaignId = campaignResourceName.split("/").pop() || "";

  type ChannelRow = { campaign: { advertisingChannelType?: string } };
  const channelRows = await adsSearchStream(customerId, `
    SELECT campaign.advertising_channel_type FROM campaign WHERE campaign.id = ${numericCampaignId}
  `) as ChannelRow[];
  const channelType = channelRows[0]?.campaign?.advertisingChannelType || "";
  if (!channelSupportsScheduleModifiers(channelType)) {
    return { success: false, updated: 0, error: `Schedule bid adjustments are not supported for ${channelType || "this"} campaigns` };
  }

  const validation = validateScheduleModifiers(modifiers);
  if (!validation.valid) return { success: false, updated: 0, error: validation.errors.join(" ") };

  // Every criterion must be an AD_SCHEDULE criterion of THIS campaign.
  type CCRow = { campaignCriterion: { resourceName: string } };
  const existing = await adsSearchStream(customerId, `
    SELECT campaign_criterion.resource_name
    FROM campaign_criterion
    WHERE campaign.id = ${numericCampaignId} AND campaign_criterion.type = AD_SCHEDULE
  `) as CCRow[];
  const valid = new Set(existing.map((r) => r.campaignCriterion.resourceName));
  const unknown = modifiers.filter((m) => !valid.has(m.criterionResourceName));
  if (unknown.length > 0) {
    return { success: false, updated: 0, error: `Not ad-schedule criteria of this campaign: ${unknown.map((m) => m.criterionResourceName).join(", ")}` };
  }

  const operations = modifiers.map((m) => ({
    update: {
      resourceName: m.criterionResourceName,
      bidModifier: Math.round((1 + m.percent / 100) * 100) / 100,
    },
    updateMask: "bid_modifier",
  }));

  const res = await adsMutate(customerId, "campaignCriteria:mutate", { operations });
  if (res.status !== 200) return { success: false, updated: 0, error: res.data };
  return { success: true, updated: operations.length };
}

// ---------------------------------------------------------------------------
// Conversion tracking — conversion actions (PR #4a)
// ---------------------------------------------------------------------------

/** Common website-conversion categories we expose (subset of Google's enum). */
export const CONVERSION_ACTION_CATEGORIES = [
  "PURCHASE",
  "SIGNUP",
  "LEAD",
  "SUBMIT_LEAD_FORM",
  "CONTACT",
  "PAGE_VIEW",
  "DOWNLOAD",
  "ADD_TO_CART",
  "BEGIN_CHECKOUT",
  "SUBSCRIBE_PAID",
] as const;
export type ConversionActionCategory = (typeof CONVERSION_ACTION_CATEGORIES)[number];

export const CONVERSION_COUNTING_TYPES = ["ONE_PER_CLICK", "MANY_PER_CLICK"] as const;
export type ConversionCountingType = (typeof CONVERSION_COUNTING_TYPES)[number];

export interface CreateConversionActionInput {
  name: string;
  category: ConversionActionCategory;
  /** ONE_PER_CLICK for leads/signups (dedupe), MANY_PER_CLICK for purchases. */
  countingType: ConversionCountingType;
  /** Optional fixed value per conversion, in USD. Omit for "no value". */
  defaultValueUsd?: number;
  /** Click-through lookback window. Google default is 30; allowed 1-90. */
  clickLookbackDays?: number;
}

export interface ConversionActionSummary {
  resourceName: string;
  id: string;
  name: string;
  category: string;
  status: string;
  type: string;
  countingType: string;
  primaryForGoal: boolean;
  /** gtag snippets (global site tag + event snippet) for WEBPAGE actions. */
  tagSnippets: Array<{ type: string; pageFormat: string; globalSiteTag: string; eventSnippet: string }>;
}

/** Pure validation — kept separate from the API call so it can be unit-tested. */
export function validateConversionActionInput(input: CreateConversionActionInput): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  const name = (input.name || "").trim();
  if (!name) errors.push("name is required.");
  else if (name.length > 100) errors.push("name must be ≤100 characters.");

  if (!CONVERSION_ACTION_CATEGORIES.includes(input.category)) {
    errors.push(`category must be one of: ${CONVERSION_ACTION_CATEGORIES.join(", ")}`);
  }
  if (!CONVERSION_COUNTING_TYPES.includes(input.countingType)) {
    errors.push(`countingType must be one of: ${CONVERSION_COUNTING_TYPES.join(", ")}`);
  }

  if (input.defaultValueUsd !== undefined) {
    if (!Number.isFinite(input.defaultValueUsd) || input.defaultValueUsd < 0) {
      errors.push("defaultValueUsd must be ≥ 0.");
    } else if (input.defaultValueUsd > 1_000_000) {
      errors.push("defaultValueUsd is unreasonably high (max $1,000,000).");
    }
  }

  if (input.clickLookbackDays !== undefined) {
    if (!Number.isInteger(input.clickLookbackDays) || input.clickLookbackDays < 1 || input.clickLookbackDays > 90) {
      errors.push("clickLookbackDays must be an integer between 1 and 90.");
    }
  }

  return { valid: errors.length === 0, errors };
}

/** List all non-removed conversion actions on the account, including gtag snippets. */
export async function listConversionActions(): Promise<ConversionActionSummary[]> {
  const customerId = process.env.GOOGLE_ADS_CUSTOMER_ID;
  if (!customerId) throw new Error("GOOGLE_ADS_CUSTOMER_ID not configured");

  type Row = {
    conversionAction: {
      resourceName: string;
      id?: string;
      name?: string;
      category?: string;
      status?: string;
      type?: string;
      countingType?: string;
      primaryForGoal?: boolean;
      tagSnippets?: Array<{ type?: string; pageFormat?: string; globalSiteTag?: string; eventSnippet?: string }>;
    };
  };
  const rows = await adsSearchStream(customerId, `
    SELECT conversion_action.resource_name, conversion_action.id, conversion_action.name,
           conversion_action.category, conversion_action.status, conversion_action.type,
           conversion_action.counting_type, conversion_action.primary_for_goal,
           conversion_action.tag_snippets
    FROM conversion_action
    WHERE conversion_action.status != 'REMOVED'
    ORDER BY conversion_action.id
  `) as Row[];

  return rows.map((r) => ({
    resourceName: r.conversionAction.resourceName,
    id: String(r.conversionAction.id || ""),
    name: r.conversionAction.name || "",
    category: r.conversionAction.category || "",
    status: r.conversionAction.status || "",
    type: r.conversionAction.type || "",
    countingType: r.conversionAction.countingType || "",
    primaryForGoal: !!r.conversionAction.primaryForGoal,
    tagSnippets: (r.conversionAction.tagSnippets || [])
      .filter((t) => (t.pageFormat || "") === "HTML")
      .map((t) => ({
        type: t.type || "",
        pageFormat: t.pageFormat || "",
        globalSiteTag: t.globalSiteTag || "",
        eventSnippet: t.eventSnippet || "",
      })),
  }));
}

/** Create a WEBPAGE conversion action. Returns the new resource + its gtag
 *  snippets (fetched in a follow-up query — mutate doesn't return snippets). */
export async function createConversionAction(
  input: CreateConversionActionInput
): Promise<{ action: ConversionActionSummary | null; error?: unknown }> {
  const customerId = process.env.GOOGLE_ADS_CUSTOMER_ID;
  if (!customerId) throw new Error("GOOGLE_ADS_CUSTOMER_ID not configured");

  const validation = validateConversionActionInput(input);
  if (!validation.valid) return { action: null, error: validation.errors.join(" ") };

  const create: Record<string, unknown> = {
    name: input.name.trim(),
    type: "WEBPAGE",
    category: input.category,
    status: "ENABLED",
    countingType: input.countingType,
    valueSettings: input.defaultValueUsd !== undefined
      ? { defaultValue: input.defaultValueUsd, alwaysUseDefaultValue: true }
      : { defaultValue: 0, alwaysUseDefaultValue: false },
  };
  if (input.clickLookbackDays !== undefined) {
    create.clickThroughLookbackWindowDays = input.clickLookbackDays;
  }

  const res = await adsMutate(customerId, "conversionActions:mutate", {
    operations: [{ create }],
  });
  if (res.status !== 200) return { action: null, error: res.data };

  const resourceName = (res.data as { results?: Array<{ resourceName?: string }> })?.results?.[0]?.resourceName;
  if (!resourceName) return { action: null, error: "Mutate succeeded but returned no resource name" };

  // Fetch back with snippets so the caller can show the gtag install code immediately.
  try {
    const all = await listConversionActions();
    const created = all.find((a) => a.resourceName === resourceName);
    if (created) return { action: created };
  } catch { /* fall through to minimal response */ }
  return {
    action: {
      resourceName,
      id: resourceName.split("/").pop() || "",
      name: input.name.trim(),
      category: input.category,
      status: "ENABLED",
      type: "WEBPAGE",
      countingType: input.countingType,
      primaryForGoal: false,
      tagSnippets: [],
    },
  };
}

/** Pause / re-enable / remove a conversion action. */
export async function setConversionActionStatus(
  resourceName: string,
  status: "ENABLED" | "PAUSED" | "REMOVED"
): Promise<{ success: boolean; error?: unknown }> {
  const customerId = process.env.GOOGLE_ADS_CUSTOMER_ID;
  if (!customerId) throw new Error("GOOGLE_ADS_CUSTOMER_ID not configured");

  if (!/^customers\/\d+\/conversionActions\/\d+$/.test(resourceName)) {
    return { success: false, error: "Invalid conversion action resource name" };
  }

  const res = await adsMutate(customerId, "conversionActions:mutate", {
    operations: [{
      update: { resourceName, status },
      updateMask: "status",
    }],
  });
  if (res.status !== 200) return { success: false, error: res.data };
  return { success: true };
}

/** Remove a single campaign-level negative keyword criterion by resource name. */
export async function removeCampaignNegativeKeyword(
  criterionResourceName: string
): Promise<{ success: boolean; error?: unknown }> {
  const customerId = process.env.GOOGLE_ADS_CUSTOMER_ID;
  if (!customerId) throw new Error("GOOGLE_ADS_CUSTOMER_ID not configured");

  if (!/^customers\/\d+\/campaignCriteria\/\d+~\d+$/.test(criterionResourceName)) {
    return { success: false, error: "Invalid campaign criterion resource name" };
  }

  const res = await adsMutate(customerId, "campaignCriteria:mutate", {
    operations: [{ remove: criterionResourceName }],
  });
  if (res.status !== 200) return { success: false, error: res.data };
  return { success: true };
}
