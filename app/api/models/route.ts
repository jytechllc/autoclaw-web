import { NextResponse } from "next/server";
import { auth0 } from "@/lib/auth0";
import { getDb } from "@/lib/db";
import { AVAILABLE_MODELS, DEFAULT_MODEL } from "@/lib/ai";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await auth0.getSession();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sql = getDb();
  const email = session.user.email as string;

  const users = await sql`SELECT id FROM users WHERE email = ${email}`;
  if (users.length === 0) {
    return NextResponse.json({ models: AVAILABLE_MODELS.filter((m) => !m.requiresByok), defaultModel: DEFAULT_MODEL });
  }

  // Check which BYOK keys the user has
  const byokServices = await sql`
    SELECT service FROM user_api_keys
    WHERE user_id = ${users[0].id} AND service IN ('openai', 'anthropic', 'google', 'alibaba', 'cerebras')
  `;
  const hasByok = new Set(byokServices.map((r) => r.service as string));

  // Return all models, marking which are available
  const models = AVAILABLE_MODELS.map((m) => ({
    ...m,
    available: !m.requiresByok || hasByok.has(m.requiresByok),
  }));

  return NextResponse.json({ models, defaultModel: DEFAULT_MODEL });
}
