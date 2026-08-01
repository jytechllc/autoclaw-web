import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/google-ads-auth";
import { generateKeywordIdeas } from "@/lib/google-ads-keywords";

export const dynamic = "force-dynamic";

/** POST — real Keyword Planner numbers for a set of seed keywords and/or a
 *  landing page URL.
 *  Body: { keywords?: string[], url?: string, geoTargetIds?: string[],
 *          locale?: string, limit?: number }
 *  Returns: { success, ideas: KeywordIdea[] } where each idea carries
 *  avgMonthlySearches, competition and the top-of-page bid range in USD.
 *
 *  Session tier (like geo-targets): proxies the shared Google Ads customer,
 *  reads no org data. Tight rate limit — Keyword Planner has its own API
 *  quota and each call is a real Google round-trip. */
export async function POST(req: NextRequest) {
  const auth = await requireSession(req, { limit: 10 });
  if ("response" in auth) return auth.response;

  const body = await req.json().catch(() => ({}));
  const keywords = Array.isArray(body.keywords)
    ? (body.keywords as unknown[]).map((k) => String(k).trim()).filter(Boolean).slice(0, 20)
    : [];
  const url = String(body.url || "").trim();
  if (url && !/^https?:\/\//i.test(url)) {
    return NextResponse.json({ error: "url must start with http:// or https://" }, { status: 400 });
  }
  if (keywords.length === 0 && !url) {
    return NextResponse.json({ error: "Provide keywords[] and/or url" }, { status: 400 });
  }
  const geoTargetIds = Array.isArray(body.geoTargetIds)
    ? (body.geoTargetIds as unknown[]).map((g) => String(g).replace(/\D/g, "")).filter(Boolean).slice(0, 10)
    : undefined;
  const locale = String(body.locale || "en").trim();
  const limit = Number(body.limit) || 50;

  try {
    const ideas = await generateKeywordIdeas({ keywords, pageUrl: url || undefined, geoTargetIds, locale, limit });
    return NextResponse.json({ success: true, ideas });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 502 },
    );
  }
}
