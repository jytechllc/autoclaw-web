import { NextRequest, NextResponse } from "next/server";
import { auth0 } from "@/lib/auth0";
import { getDb } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { checkRateLimit } from "@/lib/rate-limit";
import {
  createAssetGroup,
  validateAssetGroupInput,
  type CreateAssetGroupInput,
} from "@/lib/google-ads";
import { resolveOrgId } from "@/lib/credits";

export const dynamic = "force-dynamic";

function getIp(req: NextRequest): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}

/** Strip empties and coerce input arrays from the request body. */
function toStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.map((x) => String(x ?? "").trim()).filter((s) => s.length > 0);
}

/**
 * POST /api/google-ads/campaigns/[id]/asset-groups
 *
 * Creates a new PMAX asset group + uploads creative assets via the
 * Google Ads API and persists the result to local DB. Caller must
 * be a member of the campaign's org, and the campaign must be of
 * channel PERFORMANCE_MAX.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ip = getIp(req);
  if (!checkRateLimit(ip, { limit: 15, windowMs: 60_000 })) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  const session = await auth0.getSession();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const campaignId = Number(id);
  if (!Number.isFinite(campaignId)) {
    return NextResponse.json({ error: "Invalid campaign id" }, { status: 400 });
  }

  const body = await req.json().catch(() => ({}));

  // Build the typed input. Extra defensive coercion for arrays.
  const input: CreateAssetGroupInput = {
    campaignResourceName: "", // filled after DB lookup below
    name: String(body.name || "").trim(),
    assets: {
      headlines: toStringArray(body.headlines),
      longHeadlines: toStringArray(body.longHeadlines),
      descriptions: toStringArray(body.descriptions),
      businessName: String(body.businessName || "").trim(),
      finalUrl: String(body.finalUrl || "").trim(),
      marketingImageUrls: toStringArray(body.marketingImageUrls),
      squareMarketingImageUrls: toStringArray(body.squareMarketingImageUrls),
      logoImageUrl: body.logoImageUrl ? String(body.logoImageUrl).trim() : undefined,
      landscapeLogoImageUrl: body.landscapeLogoImageUrl ? String(body.landscapeLogoImageUrl).trim() : undefined,
      youtubeVideoIds: toStringArray(body.youtubeVideoIds),
    },
  };

  const sql = getDb();
  const userEmail = session.user.email as string;
  const users = await sql`SELECT id FROM users WHERE email = ${userEmail}`;
  if (users.length === 0) return NextResponse.json({ error: "User not found" }, { status: 404 });
  const userId = users[0].id as number;

  const requestedOrgId = body.orgId ? Number(body.orgId) : undefined;
  const orgId = await resolveOrgId(sql, userId, requestedOrgId);
  if (!orgId) return NextResponse.json({ error: "No organization found" }, { status: 400 });

  const rows = await sql`
    SELECT id, platform_campaign_id, campaign_name, channel, closed
    FROM campaigns
    WHERE id = ${campaignId} AND org_id = ${orgId} AND platform = 'google'
  `;
  if (rows.length === 0) return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
  const c = rows[0];
  if (c.closed) return NextResponse.json({ error: "Campaign is closed" }, { status: 409 });
  if (c.channel !== "PERFORMANCE_MAX") {
    return NextResponse.json({ error: "Asset groups only apply to PERFORMANCE_MAX campaigns" }, { status: 400 });
  }

  input.campaignResourceName = c.platform_campaign_id as string;

  // Client-side already validates, but server is the source of truth.
  const v = validateAssetGroupInput(input);
  if (!v.valid) {
    return NextResponse.json({ error: "Validation failed", details: v.errors }, { status: 400 });
  }

  // Call Google Ads
  let result;
  try {
    result = await createAssetGroup(input);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }

  if (!result.assetGroup) {
    return NextResponse.json(
      { error: "Failed to create asset group", details: result.errors },
      { status: 502 }
    );
  }

  // Persist asset_group + assets to local DB
  // (best effort — DB persistence failure is not user-facing fatal since
  // the group already exists in Google Ads; surface as warning)
  let assetGroupRowId: number | null = null;
  try {
    const insertedAg = await sql`
      INSERT INTO asset_groups
        (campaign_id, platform_asset_group_id, name, final_url, status, created_by)
      VALUES
        (${Number(c.id)}, ${result.assetGroup}, ${input.name}, ${input.assets.finalUrl}, 'PAUSED', ${userId})
      ON CONFLICT (campaign_id, platform_asset_group_id) DO UPDATE
        SET name = EXCLUDED.name, final_url = EXCLUDED.final_url, updated_at = NOW()
      RETURNING id
    `;
    assetGroupRowId = Number(insertedAg[0]?.id) || null;

    if (assetGroupRowId && result.assetResourceNames.length > 0) {
      // One row per (asset_group, field_type, platform_asset_id).
      // We only persist the platform reference for now; the actual text /
      // image URL / video ID lives in Google Ads and can be re-fetched
      // when needed. Keeps this PR small and avoids drift between the two
      // sources of truth.
      for (const a of result.assetResourceNames) {
        await sql`
          INSERT INTO assets
            (asset_group_id, platform_asset_id, field_type, uploaded_by)
          VALUES
            (${assetGroupRowId}, ${a.resourceName}, ${a.field}, ${userId})
        `;
      }
    }
  } catch (e) {
    result.errors.push({ step: "db_persist", details: e instanceof Error ? e.message : String(e) });
  }

  logAudit({
    userId,
    userEmail,
    action: "google_ads.create_asset_group",
    resourceType: "asset_group",
    resourceId: assetGroupRowId ?? campaignId,
    details: {
      name: input.name,
      campaignId,
      platformAssetGroupId: result.assetGroup,
      assetCount: result.assetResourceNames.length,
      warningCount: result.errors.length,
    },
    ipAddress: ip,
  });

  return NextResponse.json({
    success: true,
    assetGroupId: assetGroupRowId,
    platformAssetGroupId: result.assetGroup,
    assetCount: result.assetResourceNames.length,
    warnings: result.errors.length > 0 ? result.errors : undefined,
  });
}
