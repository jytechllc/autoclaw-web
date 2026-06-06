import { NextRequest, NextResponse } from "next/server";
import { auth0 } from "@/lib/auth0";
import { getDb } from "@/lib/db";
import { getCredits, getRecentTransactions, resolveOrgId } from "@/lib/credits";
import { checkRateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

function getIp(req: NextRequest): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}

export async function GET(req: NextRequest) {
  if (!checkRateLimit(getIp(req), { limit: 60, windowMs: 60_000 })) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  const session = await auth0.getSession();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sql = getDb();

  const users = await sql`SELECT id FROM users WHERE email = ${session.user.email as string}`;
  if (users.length === 0) {
    return NextResponse.json({ credits: { balance_cents: 0, reserved_cents: 0, currency: "USD" }, transactions: [] });
  }
  const userId = users[0].id as number;

  const requestedOrgId = req.nextUrl.searchParams.get("org_id");
  const orgId = await resolveOrgId(sql, userId, requestedOrgId ? Number(requestedOrgId) : undefined);
  if (!orgId) {
    return NextResponse.json({ credits: { balance_cents: 0, reserved_cents: 0, currency: "USD" }, transactions: [] });
  }

  const credits = await getCredits(sql, orgId);
  const transactions = await getRecentTransactions(sql, orgId, 20);

  // Include the user's org role so the UI can hide write actions for viewers.
  const [mem] = await sql`
    SELECT role FROM organization_members WHERE org_id = ${orgId} AND user_id = ${userId}
  `;
  const memberRole = (mem?.role as string | null) ?? null;

  return NextResponse.json({ credits, transactions, orgId, memberRole });
}
