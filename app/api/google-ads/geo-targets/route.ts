import { NextRequest, NextResponse } from "next/server";
import { auth0 } from "@/lib/auth0";
import { checkRateLimit } from "@/lib/rate-limit";
import { suggestGeoTargets } from "@/lib/google-ads";

export const dynamic = "force-dynamic";

function getIp(req: NextRequest): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}

export async function GET(req: NextRequest) {
  if (!checkRateLimit(getIp(req), { limit: 30, windowMs: 60_000 })) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  const session = await auth0.getSession();
  if (!session?.user?.email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

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
