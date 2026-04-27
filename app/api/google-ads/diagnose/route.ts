import { NextRequest, NextResponse } from "next/server";
import { auth0 } from "@/lib/auth0";
import { fetchAccountLinks, adsSearchStream, listAccessibleCustomers, fetchCustomerInfo } from "@/lib/google-ads";
import { checkRateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

function getIp(req: NextRequest): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}

/** Diagnose Google Ads account state — used to check YouTube channel link, billing, etc. */
export async function GET(req: NextRequest) {
  if (!checkRateLimit(getIp(req), { limit: 30, windowMs: 60_000 })) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }
  const session = await auth0.getSession();
  if (!session?.user?.email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const customerId = process.env.GOOGLE_ADS_CUSTOMER_ID;

  const out: Record<string, unknown> = {
    customerId,
    loginCustomerId: process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID || null,
  };

  // 1. Customer info — proves API connectivity
  try {
    type CustomerRow = {
      customer: {
        id?: string;
        descriptiveName?: string;
        currencyCode?: string;
        timeZone?: string;
        manager?: boolean;
        testAccount?: boolean;
      };
    };
    const customer = await adsSearchStream(customerId!, `
      SELECT customer.id, customer.descriptive_name, customer.currency_code,
             customer.time_zone, customer.manager, customer.test_account
      FROM customer LIMIT 1
    `) as CustomerRow[];
    out.customer = customer[0]?.customer || null;
  } catch (e) {
    out.customerError = e instanceof Error ? e.message : String(e);
  }

  // 2. Account links (YouTube, Merchant Center, etc.)
  try {
    const links = await fetchAccountLinks();
    out.accountLinks = links;
    out.youtubeLinks = links.filter((l) => l.type === "YOUTUBE_CHANNEL");
  } catch (e) {
    out.accountLinksError = e instanceof Error ? e.message : String(e);
  }

  // 2.5 List all customers OAuth can access — includes the manager (dev token owner)
  try {
    const accessibleIds = await listAccessibleCustomers();
    out.accessibleCustomerIds = accessibleIds;
    // Probe each one to find which are managers (dev token owner candidates)
    const probes = await Promise.all(
      accessibleIds.slice(0, 20).map(async (id) => {
        const info = await fetchCustomerInfo(id);
        return info || { id, name: "(no access)", manager: false, testAccount: false, currency: "", timeZone: "" };
      })
    );
    out.accessibleCustomers = probes;
    out.managerCandidates = probes.filter((p) => p.manager).map((p) => ({ id: p.id, name: p.name }));
  } catch (e) {
    out.accessibleCustomersError = e instanceof Error ? e.message : String(e);
  }

  // 2.7 Manager links — who manages this customer?
  try {
    type Row = {
      customerManagerLink: {
        managerCustomer?: string;
        status?: string;
        managerLinkId?: string;
      };
    };
    const rows = await adsSearchStream(customerId!, `
      SELECT customer_manager_link.manager_customer,
             customer_manager_link.status,
             customer_manager_link.manager_link_id
      FROM customer_manager_link
    `) as Row[];
    out.managerLinks = rows.map((r) => ({
      managerCustomer: r.customerManagerLink.managerCustomer,
      status: r.customerManagerLink.status,
      managerLinkId: r.customerManagerLink.managerLinkId,
    }));
  } catch (e) {
    out.managerLinksError = e instanceof Error ? e.message : String(e);
  }

  // 2.8 Customer users — show all users + their roles
  try {
    type Row = {
      customerUserAccess: {
        userId?: string;
        emailAddress?: string;
        accessRole?: string;
        accessCreationDateTime?: string;
      };
    };
    const rows = await adsSearchStream(customerId!, `
      SELECT customer_user_access.user_id, customer_user_access.email_address,
             customer_user_access.access_role, customer_user_access.access_creation_date_time
      FROM customer_user_access
    `) as Row[];
    out.users = rows.map((r) => r.customerUserAccess);
  } catch (e) {
    out.usersError = e instanceof Error ? e.message : String(e);
  }

  // 2.9 Debug: campaign criteria dump (use ?campaign=<numericId> to inspect)
  const debugCampaignId = req.nextUrl.searchParams.get("campaign");
  if (debugCampaignId) {
    try {
      type CritRow = {
        campaignCriterion: {
          resourceName?: string;
          criterionId?: string;
          type?: string;
          negative?: boolean;
          status?: string;
          location?: { geoTargetConstant?: string };
          language?: { languageConstant?: string };
          proximity?: unknown;
        };
      };
      // No type filter — show EVERYTHING
      const allCrit = await adsSearchStream(customerId!, `
        SELECT campaign_criterion.resource_name, campaign_criterion.criterion_id,
               campaign_criterion.type, campaign_criterion.negative, campaign_criterion.status,
               campaign_criterion.location.geo_target_constant,
               campaign_criterion.language.language_constant
        FROM campaign_criterion WHERE campaign.id = ${debugCampaignId}
      `) as CritRow[];
      out.debugCampaignId = debugCampaignId;
      out.debugAllCriteria = allCrit.map((r) => r.campaignCriterion);
      out.debugCriteriaCountByType = allCrit.reduce((acc, r) => {
        const t = r.campaignCriterion.type || "UNKNOWN";
        acc[t] = (acc[t] || 0) + 1;
        return acc;
      }, {} as Record<string, number>);
    } catch (e) {
      out.debugCriteriaError = e instanceof Error ? e.message : String(e);
    }

    // Also check ad_group_criterion (some Demand Gen targeting at ad group level)
    try {
      type AGRow = {
        adGroupCriterion: {
          resourceName?: string;
          type?: string;
          location?: { geoTargetConstant?: string };
          listingGroup?: unknown;
        };
        adGroup: { resourceName: string; name?: string };
      };
      const agcRows = await adsSearchStream(customerId!, `
        SELECT ad_group_criterion.resource_name, ad_group_criterion.type,
               ad_group_criterion.location.geo_target_constant,
               ad_group.resource_name, ad_group.name
        FROM ad_group_criterion WHERE campaign.id = ${debugCampaignId}
      `) as AGRow[];
      out.debugAdGroupCriteria = agcRows;
    } catch (e) {
      out.debugAdGroupCriteriaError = e instanceof Error ? e.message : String(e);
    }

    // Demand Gen / PMax: asset groups + signals
    try {
      type AssetGroupRow = { assetGroup: { resourceName?: string; name?: string; status?: string } };
      const agRows = await adsSearchStream(customerId!, `
        SELECT asset_group.resource_name, asset_group.name, asset_group.status
        FROM asset_group WHERE campaign.id = ${debugCampaignId}
      `) as AssetGroupRow[];
      out.debugAssetGroups = agRows.map((r) => r.assetGroup);
    } catch (e) {
      out.debugAssetGroupsError = e instanceof Error ? e.message : String(e);
    }

    // Debug: ad_group_ad structure for Demand Gen
    try {
      type AdRow = {
        adGroupAd: {
          resourceName?: string;
          status?: string;
          ad?: Record<string, unknown>;
        };
        adGroup?: { resourceName?: string; name?: string };
      };
      const adRows = await adsSearchStream(customerId!, `
        SELECT ad_group_ad.resource_name, ad_group_ad.status, ad_group_ad.ad.id, ad_group_ad.ad.type,
               ad_group_ad.ad.name, ad_group_ad.ad.final_urls,
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
               ad_group_ad.ad.demand_gen_video_responsive_ad.videos,
               ad_group_ad.ad.demand_gen_video_responsive_ad.call_to_actions,
               ad_group.resource_name, ad_group.name
        FROM ad_group_ad WHERE campaign.id = ${debugCampaignId}
      `) as AdRow[];
      out.debugAds = adRows;
    } catch (e) {
      out.debugAdsError = e instanceof Error ? e.message : String(e);
    }

    // Campaign settings — geo_target_type
    try {
      type CampaignSettings = {
        campaign: {
          geoTargetTypeSetting?: { positiveGeoTargetType?: string; negativeGeoTargetType?: string };
          networkSettings?: Record<string, unknown>;
          advertisingChannelType?: string;
          advertisingChannelSubType?: string;
        };
      };
      const csRows = await adsSearchStream(customerId!, `
        SELECT campaign.geo_target_type_setting.positive_geo_target_type,
               campaign.geo_target_type_setting.negative_geo_target_type,
               campaign.advertising_channel_type, campaign.advertising_channel_sub_type
        FROM campaign WHERE campaign.id = ${debugCampaignId}
      `) as CampaignSettings[];
      out.debugCampaignSettings = csRows[0]?.campaign;
    } catch (e) {
      out.debugCampaignSettingsError = e instanceof Error ? e.message : String(e);
    }
  }

  // 3. Billing setup status
  try {
    type BillingRow = {
      billingSetup: { id?: string; status?: string; startDateTime?: string };
    };
    const billing = await adsSearchStream(customerId!, `
      SELECT billing_setup.id, billing_setup.status, billing_setup.start_date_time
      FROM billing_setup
    `) as BillingRow[];
    out.billingSetups = billing.map((b) => b.billingSetup);
  } catch (e) {
    out.billingError = e instanceof Error ? e.message : String(e);
  }

  return NextResponse.json(out, { status: 200 });
}
