import { NextRequest, NextResponse } from "next/server";
import { auth0 } from "@/lib/auth0";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

async function resolveUserId(): Promise<number | null> {
  const session = await auth0.getSession();
  if (!session?.user?.email) return null;
  const sql = getDb();
  const rows = await sql`SELECT id FROM users WHERE email = ${session.user.email as string}`;
  return rows.length ? (rows[0].id as number) : null;
}

export async function GET(req: NextRequest) {
  try {
    const userId = await resolveUserId();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const sql = getDb();
    const url = new URL(req.url);
    const projectId = url.searchParams.get("project_id");
    const rows = projectId
      ? await sql`SELECT * FROM workflows WHERE user_id = ${userId} AND project_id = ${Number(projectId)} ORDER BY updated_at DESC`
      : await sql`SELECT * FROM workflows WHERE user_id = ${userId} ORDER BY updated_at DESC`;
    return NextResponse.json({ workflows: rows });
  } catch (err) {
    console.error("[GET /api/workflows]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const userId = await resolveUserId();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const body = await req.json();
    const { name, description, project_id, definition, status } = body || {};
    if (!name) return NextResponse.json({ error: "name required" }, { status: 400 });
    const sql = getDb();
    const rows = await sql`
      INSERT INTO workflows (user_id, project_id, name, description, status, definition)
      VALUES (${userId}, ${project_id || null}, ${name}, ${description || ""}, ${status || "draft"}, ${JSON.stringify(definition || {})}::jsonb)
      RETURNING *
    `;
    return NextResponse.json({ workflow: rows[0] }, { status: 201 });
  } catch (err) {
    console.error("[POST /api/workflows]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
