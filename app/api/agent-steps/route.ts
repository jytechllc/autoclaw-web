import { NextRequest, NextResponse } from "next/server";
import { auth0 } from "@/lib/auth0";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const session = await auth0.getSession();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const agentId = req.nextUrl.searchParams.get("agent_id");
  const taskIndex = req.nextUrl.searchParams.get("task_index");

  if (!agentId) {
    return NextResponse.json({ error: "agent_id required" }, { status: 400 });
  }

  const sql = getDb();

  const steps = taskIndex !== null
    ? await sql`
        SELECT step_key, status, detail, created_at
        FROM agent_steps
        WHERE agent_id = ${Number(agentId)} AND task_index = ${Number(taskIndex)}
        ORDER BY created_at ASC
      `
    : await sql`
        SELECT task_index, step_key, status, detail, created_at
        FROM agent_steps
        WHERE agent_id = ${Number(agentId)}
        ORDER BY created_at ASC
      `;

  return NextResponse.json({ steps });
}
