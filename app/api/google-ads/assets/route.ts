import { NextRequest, NextResponse } from "next/server";
import { auth0 } from "@/lib/auth0";
import { getDb } from "@/lib/db";
import { checkRateLimit } from "@/lib/rate-limit";
import { fetchAccountAssets } from "@/lib/google-ads";
import { resolveOrgId } from "@/lib/credits";

export const dynamic = "force-dynamic";

function getIp(req: NextRequest): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}

/** GET — read-only account asset library with campaign usage counts.
 *  Open to viewers (no spend data here), same trust boundary as diagnose. */
export async function GET(req: NextRequest) {
  if (!checkRateLimit(getIp(req), { limit: 30, windowMs: 60_000 })) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }
  const session = await auth0.getSession();
  if (!session?.user?.email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const sql = getDb();
  const users = await sql`SELECT id FROM users WHERE email = ${session.user.email as string}`;
  if (users.length === 0) return NextResponse.json({ error: "User not found" }, { status: 404 });
  const userId = users[0].id as number;

  const requestedOrgId = req.nextUrl.searchParams.get("org_id");
  const orgId = await resolveOrgId(sql, userId, requestedOrgId ? Number(requestedOrgId) : undefined);
  if (!orgId) return NextResponse.json({ error: "No organization found" }, { status: 400 });

  try {
    const assets = await fetchAccountAssets(200);
    return NextResponse.json({ assets });
  } catch (e) {
    return NextResponse.json(
      { error: `Failed to load assets: ${e instanceof Error ? e.message : String(e)}` },
      { status: 502 }
    );
  }
}
