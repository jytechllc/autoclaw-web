import { NextRequest, NextResponse } from "next/server";
import { auth0 } from "@/lib/auth0";
import { getDb } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { checkRateLimit } from "@/lib/rate-limit";
import { createResponsiveDisplayAd } from "@/lib/google-ads";
import { resolveOrgId } from "@/lib/credits";
import { isReadOnlyUserId } from "@/lib/roles-server";

export const dynamic = "force-dynamic";

function getIp(req: NextRequest): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}

function parseUrls(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  return input.map((u) => String(u || "").trim()).filter((u) => /^https?:\/\//i.test(u));
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ip = getIp(req);
  // Image fetching is heavier than text-only ad creation — keep limit modest.
  if (!checkRateLimit(ip, { limit: 10, windowMs: 60_000 })) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }
  const session = await auth0.getSession();
  if (!session?.user?.email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const campaignId = Number(id);
  if (!Number.isFinite(campaignId)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

  const body = await req.json().catch(() => ({}));
  const adGroupResourceName = String(body.adGroupResourceName || "").trim();
  const marketingImageUrls = parseUrls(body.marketingImageUrls);
  const squareMarketingImageUrls = parseUrls(body.squareMarketingImageUrls);
  const logoImageUrl = String(body.logoImageUrl || "").trim() || undefined;
  const headlines: string[] = Array.isArray(body.headlines) ? body.headlines.map(String).map((s: string) => s.trim()).filter(Boolean) : [];
  const longHeadline = String(body.longHeadline || "").trim();
  const descriptions: string[] = Array.isArray(body.descriptions) ? body.descriptions.map(String).map((s: string) => s.trim()).filter(Boolean) : [];
  const businessName = String(body.businessName || "").trim();
  const finalUrl = String(body.finalUrl || "").trim();

  if (!adGroupResourceName.startsWith("customers/")) {
    return NextResponse.json({ error: "Invalid adGroupResourceName" }, { status: 400 });
  }
  if (marketingImageUrls.length === 0) return NextResponse.json({ error: "At least 1 marketing image URL (landscape, http(s)) required" }, { status: 400 });
  if (squareMarketingImageUrls.length === 0) return NextResponse.json({ error: "At least 1 square marketing image URL required" }, { status: 400 });
  if (headlines.length === 0) return NextResponse.json({ error: "At least 1 headline required (max 30 chars each)" }, { status: 400 });
  if (!longHeadline) return NextResponse.json({ error: "Long headline required (max 90 chars)" }, { status: 400 });
  if (descriptions.length === 0) return NextResponse.json({ error: "At least 1 description required (max 90 chars each)" }, { status: 400 });
  if (!businessName) return NextResponse.json({ error: "Business name required (max 25 chars)" }, { status: 400 });
  if (!/^https?:\/\//i.test(finalUrl)) return NextResponse.json({ error: "Final URL must start with http:// or https://" }, { status: 400 });
  if (logoImageUrl && !/^https?:\/\//i.test(logoImageUrl)) {
    return NextResponse.json({ error: "Logo URL must start with http:// or https://" }, { status: 400 });
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

  const rows = await sql`
    SELECT platform_campaign_id, channel, closed FROM campaigns
    WHERE id = ${campaignId} AND org_id = ${orgId} AND platform = 'google'
  `;
  if (rows.length === 0) return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
  if (rows[0].closed) return NextResponse.json({ error: "Campaign is closed" }, { status: 409 });
  if (rows[0].channel !== "DISPLAY") {
    return NextResponse.json({ error: "Display ads can only be created for DISPLAY channel campaigns" }, { status: 400 });
  }

  const campaignCustomer = String(rows[0].platform_campaign_id).split("/").slice(0, 2).join("/");
  if (!adGroupResourceName.startsWith(campaignCustomer)) {
    return NextResponse.json({ error: "Ad group does not belong to this campaign's customer" }, { status: 403 });
  }

  const result = await createResponsiveDisplayAd({
    adGroupResourceName,
    marketingImageUrls,
    squareMarketingImageUrls,
    logoImageUrl,
    headlines,
    longHeadline,
    descriptions,
    businessName,
    finalUrl,
  });

  if (!result.resourceName) {
    return NextResponse.json({ error: "Failed to create display ad", details: result.error }, { status: 502 });
  }

  logAudit({
    userId, userEmail,
    action: "google_ads.create_campaign",
    resourceType: "display_ad", resourceId: campaignId,
    details: {
      sub_action: "create_display_ad",
      adGroup: adGroupResourceName,
      marketingImages: marketingImageUrls.length,
      squareMarketingImages: squareMarketingImageUrls.length,
      hasLogo: Boolean(logoImageUrl),
      resourceName: result.resourceName,
    },
    ipAddress: ip,
  });

  return NextResponse.json({ success: true, resourceName: result.resourceName });
}
