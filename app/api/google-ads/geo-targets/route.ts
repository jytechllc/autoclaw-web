import { NextRequest, NextResponse } from "next/server";
import { suggestGeoTargets } from "@/lib/google-ads";
import { requireSession } from "@/lib/google-ads-auth";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const auth = await requireSession(req, { limit: 30 });
  if ("response" in auth) return auth.response;

  const q = req.nextUrl.searchParams.get("q")?.trim() || "";
  const countryCode = req.nextUrl.searchParams.get("country") || undefined;
  const locale = req.nextUrl.searchParams.get("locale") || "en";

  if (q.length < 2) return NextResponse.json({ suggestions: [] });

  try {
    const suggestions = await suggestGeoTargets(q, locale, countryCode);
    return NextResponse.json({ suggestions });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
