import { NextRequest, NextResponse } from "next/server";
import { auth0 } from "@/lib/auth0";
import { getDb } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { checkRateLimit } from "@/lib/rate-limit";
import { createKeywords, type KeywordMatchType } from "@/lib/google-ads";
import { resolveOrgId } from "@/lib/credits";
import { isReadOnlyUserId } from "@/lib/roles-server";

export const dynamic = "force-dynamic";

function getIp(req: NextRequest): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}

const VALID_MATCH = new Set<KeywordMatchType>(["BROAD", "PHRASE", "EXACT"]);

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
  const rawKeywords = Array.isArray(body.keywords) ? body.keywords : [];

  if (!adGroupResourceName.startsWith("customers/")) {
    return NextResponse.json({ error: "Invalid adGroupResourceName" }, { status: 400 });
  }

  // Normalize input. Accept either { text, matchType } objects OR plain strings (default BROAD).
  const keywords = rawKeywords
    .map((k: unknown) => {
      if (typeof k === "string") return { text: k.trim(), matchType: "BROAD" as KeywordMatchType };
      if (k && typeof k === "object") {
        const obj = k as { text?: unknown; matchType?: unknown };
        const matchType = String(obj.matchType || "BROAD").toUpperCase() as KeywordMatchType;
        return { text: String(obj.text || "").trim(), matchType: VALID_MATCH.has(matchType) ? matchType : ("BROAD" as KeywordMatchType) };
      }
      return { text: "", matchType: "BROAD" as KeywordMatchType };
    })
    .filter((k: { text: string }) => k.text.length > 0 && k.text.length <= 80);

  if (keywords.length === 0) {
    return NextResponse.json({ error: "At least 1 valid keyword required (≤80 chars each)" }, { status: 400 });
  }
  if (keywords.length > 200) {
    return NextResponse.json({ error: "Up to 200 keywords per request" }, { status: 400 });
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
  if (rows[0].channel !== "SEARCH") {
    return NextResponse.json({ error: "Keywords can only be added to SEARCH channel campaigns" }, { status: 400 });
  }
  const campaignCustomer = String(rows[0].platform_campaign_id).split("/").slice(0, 2).join("/");
  if (!adGroupResourceName.startsWith(campaignCustomer)) {
    return NextResponse.json({ error: "Ad group does not belong to this campaign's customer" }, { status: 403 });
  }

  const result = await createKeywords(adGroupResourceName, keywords);

  logAudit({
    userId, userEmail,
    action: "google_ads.create_campaign",
    resourceType: "keyword", resourceId: campaignId,
    details: {
      sub_action: "create_keywords",
      adGroup: adGroupResourceName,
      requested: keywords.length,
      created: result.created,
      duplicatesIgnored: result.duplicatesIgnored.length,
      errors: result.errors.length,
    },
    ipAddress: ip,
  });

  return NextResponse.json({
    success: result.errors.length === 0 || result.created > 0,
    created: result.created,
    resourceNames: result.resourceNames,
    duplicatesIgnored: result.duplicatesIgnored,
    errors: result.errors,
  });
}
