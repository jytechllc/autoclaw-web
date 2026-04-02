import { NextRequest, NextResponse } from "next/server";
import { auth0 } from "@/lib/auth0";
import { getDb } from "@/lib/db";
import { getUserKey } from "@/lib/keys";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const session = await auth0.getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const service = req.nextUrl.searchParams.get("service");
  if (!service) {
    return NextResponse.json({ error: "service param required" }, { status: 400 });
  }

  const sql = getDb();
  const sub = session.user.sub;
  const users = await sql`SELECT id FROM users WHERE auth0_id = ${sub} LIMIT 1`;
  if (users.length === 0) {
    return NextResponse.json({ available: false });
  }

  const key = await getUserKey(users[0].id as number, service);
  return NextResponse.json({ available: !!key });
}
