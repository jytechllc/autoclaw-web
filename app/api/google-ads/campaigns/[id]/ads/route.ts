import { NextRequest, NextResponse } from "next/server";
import { auth0 } from "@/lib/auth0";
import { getDb } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { checkRateLimit } from "@/lib/rate-limit";
import { createResponsiveSearchAd } from "@/lib/google-ads";
import { resolveOrgId } from "@/lib/credits";
import { isReadOnlyUserId } from "@/lib/roles-server";

export const dynamic = "force-dynamic";

function getIp(req: NextRequest): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ip = getIp(req);
  if (!checkRateLimit(ip, { limit: 30, windowMs: 60_000 })) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  const session = await auth0.getSession();
  if (!session?.user?.email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const campaignId = Number(id);
  if (!Number.isFinite(campaignId)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

  const body = await req.json().catch(() => ({}));
  const adGroupResourceName = String(body.adGroupResourceName || "").trim();
  const headlines: string[] = Array.isArray(body.headlines) ? body.headlines.filter((h: string) => h && h.trim()) : [];
  const descriptions: string[] = Array.isArray(body.descriptions) ? body.descriptions.filter((d: string) => d && d.trim()) : [];
  const finalUrl = String(body.finalUrl || "").trim();

  if (!adGroupResourceName.startsWith("customers/")) {
    return NextResponse.json({ error: "Invalid adGroupResourceName" }, { status: 400 });
  }
  if (headlines.length < 3) return NextResponse.json({ error: "At least 3 headlines required (max 30 chars each)" }, { status: 400 });
  if (descriptions.length < 2) return NextResponse.json({ error: "At least 2 descriptions required (max 90 chars each)" }, { status: 400 });
  if (!finalUrl || !/^https?:\/\//i.test(finalUrl)) {
    return NextResponse.json({ error: "Final URL must start with http:// or https://" }, { status: 400 });
  }

  const sql = getDb();
  const userEmail = session.user.email as string;
  const users = await sql`SELECT id FROM users WHERE email = ${userEmail}`;
  if (users.length === 0) return NextResponse.json({ error: "User not found" }, { status: 404 });
  const userId = users[0].id as number;
  if (await isReadOnlyUserId(sql, userId)) {
    return NextResponse.json({ error: "Read-only account — writes are disabled" }, { status: 403 });
  }

  const requestedOrgId = body.orgId ? Number(body.orgId) : undefined;
  const orgId = await resolveOrgId(sql, userId, requestedOrgId);
  if (!orgId) return NextResponse.json({ error: "No organization found" }, { status: 400 });

  // Auth: campaign must belong to this org + the ad group must belong to this campaign
  const rows = await sql`
    SELECT platform_campaign_id, closed FROM campaigns
    WHERE id = ${campaignId} AND org_id = ${orgId} AND platform = 'google'
  `;
  if (rows.length === 0) return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
  if (rows[0].closed) return NextResponse.json({ error: "Campaign is closed" }, { status: 409 });
  const campaignResource = rows[0].platform_campaign_id as string;
  // Ad group resource name format: customers/{cust}/adGroups/{id} — check that customer matches campaign's customer prefix
  const campaignCustomer = campaignResource.split("/").slice(0, 2).join("/");
  if (!adGroupResourceName.startsWith(campaignCustomer)) {
    return NextResponse.json({ error: "Ad group does not belong to this campaign's customer" }, { status: 403 });
  }

  const result = await createResponsiveSearchAd({
    adGroupResourceName,
    headlines,
    descriptions,
    finalUrls: [finalUrl],
  });

  if (!result.resourceName) {
    return NextResponse.json({ error: "Failed to create ad", details: result.error }, { status: 502 });
  }

  logAudit({
    userId, userEmail,
    action: "google_ads.create_campaign",
    resourceType: "ad", resourceId: campaignId,
    details: { sub_action: "create_ad", adGroup: adGroupResourceName, headlines: headlines.length, resourceName: result.resourceName },
    ipAddress: ip,
  });

  return NextResponse.json({ success: true, resourceName: result.resourceName });
}
