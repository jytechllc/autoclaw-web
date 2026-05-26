import { NextRequest, NextResponse } from "next/server";
import { auth0 } from "@/lib/auth0";
import { getDb } from "@/lib/db";
import { enqueueWorkflowForContacts } from "@/lib/workflow-engine";

export const dynamic = "force-dynamic";

async function resolveUserId(): Promise<number | null> {
  const session = await auth0.getSession();
  if (!session?.user?.email) return null;
  const sql = getDb();
  const rows = await sql`SELECT id FROM users WHERE email = ${session.user.email as string}`;
  return rows.length ? (rows[0].id as number) : null;
}

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const userId = await resolveUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const sql = getDb();
  const rows = await sql`SELECT * FROM workflows WHERE id = ${Number(id)} AND user_id = ${userId}`;
  if (rows.length === 0) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ workflow: rows[0] });
}

export async function PUT(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const userId = await resolveUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json();
  const { name, description, definition, status, project_id } = body || {};
  const sql = getDb();
  const rows = await sql`
    UPDATE workflows
    SET name = COALESCE(${name ?? null}, name),
        description = COALESCE(${description ?? null}, description),
        definition = COALESCE(${definition ? JSON.stringify(definition) : null}::jsonb, definition),
        status = COALESCE(${status ?? null}, status),
        project_id = COALESCE(${project_id ?? null}, project_id),
        updated_at = NOW()
    WHERE id = ${Number(id)} AND user_id = ${userId}
    RETURNING *
  `;
  if (rows.length === 0) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // If transitioning to active, enqueue scheduled emails for all project contacts.
  if (status === "active") {
    const enqueued = await enqueueWorkflowForContacts(rows[0].id as number);
    return NextResponse.json({ workflow: rows[0], enqueued });
  }
  return NextResponse.json({ workflow: rows[0] });
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const userId = await resolveUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const sql = getDb();
  const rows = await sql`DELETE FROM workflows WHERE id = ${Number(id)} AND user_id = ${userId} RETURNING id`;
  if (rows.length === 0) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
