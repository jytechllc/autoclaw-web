import { NextRequest, NextResponse } from "next/server";
import { auth0 } from "@/lib/auth0";
import { getDb } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { checkRateLimit } from "@/lib/rate-limit";
import { resolveOrgId } from "@/lib/credits";
import { isReadOnlyUserId } from "@/lib/roles-server";
import {
  generateCampaignRecommendations,
  persistDigest,
  RecommendationGenerationError,
  type CampaignRecRow,
} from "./generate";

export const dynamic = "force-dynamic";

function getIp(req: NextRequest): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}

interface AuthedCampaign {
  campaign: CampaignRecRow;
  campaignId: number;
  userId: number;
  userEmail: string;
  orgId: number;
}

/** Session → user → org → campaign ownership. Shared by GET and POST.
 *  Does NOT gate read-only accounts — GET is a pure read; POST adds the gate. */
async function loadAuthedCampaign(
  params: Promise<{ id: string }>,
  requestedOrgIdRaw: unknown,
): Promise<{ error: NextResponse } | AuthedCampaign> {
  const session = await auth0.getSession();
  if (!session?.user?.email) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }

  const { id } = await params;
  const campaignId = Number(id);
  if (!Number.isFinite(campaignId)) {
    return { error: NextResponse.json({ error: "Invalid id" }, { status: 400 }) };
  }

  const sql = getDb();
  const userEmail = session.user.email as string;
  const users = await sql`SELECT id FROM users WHERE email = ${userEmail}`;
  if (users.length === 0) return { error: NextResponse.json({ error: "User not found" }, { status: 404 }) };
  const userId = users[0].id as number;

  const requestedOrgId = requestedOrgIdRaw ? Number(requestedOrgIdRaw) : undefined;
  const orgId = await resolveOrgId(sql, userId, requestedOrgId);
  if (!orgId) return { error: NextResponse.json({ error: "No organization found" }, { status: 400 }) };

  const rows = await sql`
    SELECT id, platform_campaign_id, campaign_name, channel, daily_budget, currency, status,
           total_budget_cents, spent_cents
    FROM campaigns
    WHERE id = ${campaignId} AND org_id = ${orgId} AND platform = 'google'
  `;
  if (rows.length === 0) return { error: NextResponse.json({ error: "Campaign not found" }, { status: 404 }) };

  return { campaign: rows[0] as unknown as CampaignRecRow, campaignId, userId, userEmail, orgId };
}

// GET — return the latest stored digest (cron- or manually generated).
// Pure read: read-only accounts may see it too.
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!checkRateLimit(getIp(req), { limit: 60, windowMs: 60_000 })) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  const loaded = await loadAuthedCampaign(params, req.nextUrl.searchParams.get("orgId") || undefined);
  if ("error" in loaded) return loaded.error;
  const { campaignId } = loaded;

  const sql = getDb();
  let rows;
  try {
    rows = await sql`
      SELECT recommendations, source, provider, model, generated_at
      FROM campaign_recommendations WHERE campaign_id = ${campaignId}
    `;
  } catch {
    // Table may not exist yet on a fresh deployment — same as "no digest".
    return NextResponse.json({ success: true, digest: null });
  }
  if (rows.length === 0) return NextResponse.json({ success: true, digest: null });

  const r = rows[0];
  return NextResponse.json({
    success: true,
    digest: {
      recommendations: r.recommendations,
      source: r.source,
      provider: r.provider,
      model: r.model,
      generatedAt: r.generated_at,
    },
  });
}

// POST — generate AI optimization recommendations for one campaign.
// AI-backed and it writes an audit row, so POST (not GET-generate).
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ip = getIp(req);
  // AI calls are expensive — keep the limit tight (matches ad-copy/generate).
  if (!checkRateLimit(ip, { limit: 10, windowMs: 60_000 })) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  const body = await req.json().catch(() => ({}));
  const locale = String(body.locale || "en").trim();

  const loaded = await loadAuthedCampaign(params, body.orgId);
  if ("error" in loaded) return loaded.error;
  const { campaign, campaignId, userId, userEmail, orgId } = loaded;

  const sql = getDb();
  if (await isReadOnlyUserId(sql, userId)) {
    return NextResponse.json({ error: "Read-only account — writes are disabled" }, { status: 403 });
  }

  let generated;
  try {
    generated = await generateCampaignRecommendations(campaign, locale);
  } catch (e) {
    if (e instanceof RecommendationGenerationError) {
      return NextResponse.json({ error: e.message }, { status: 502 });
    }
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }

  // Persist as the latest digest so it survives reloads and shows up like a
  // cron one. Best-effort — persistence failure must not eat the response.
  try {
    await persistDigest(sql, campaignId, orgId, "manual", generated.recommendations, generated.provider, generated.model);
  } catch (e) {
    console.warn(`[recommendations] persist failed for campaign ${campaignId}: ${e instanceof Error ? e.message : String(e)}`);
  }

  logAudit({
    userId,
    userEmail,
    action: "google_ads.recommendations",
    resourceType: "campaign",
    resourceId: campaignId,
    details: { count: generated.recommendations.length, provider: generated.provider, model: generated.model },
    ipAddress: ip,
  });

  return NextResponse.json({
    success: true,
    campaignId,
    generatedAt: new Date().toISOString(),
    recommendations: generated.recommendations,
    provider: generated.provider,
    model: generated.model,
  });
}
