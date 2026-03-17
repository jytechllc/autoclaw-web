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
  if (!agentId) {
    return NextResponse.json({ error: "agent_id required" }, { status: 400 });
  }

  const sql = getDb();
  const email = session.user.email as string;

  // Verify user can access this agent (own project, shared project, or org project)
  const users = await sql`SELECT id FROM users WHERE email = ${email}`;
  if (users.length === 0) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }
  const userId = users[0].id;
  const emailDomain = email.split("@")[1] || "";

  const agents = await sql`
    SELECT aa.id, aa.config, aa.agent_type, aa.status as agent_status
    FROM agent_assignments aa
    JOIN projects p ON aa.project_id = p.id
    WHERE aa.id = ${agentId} AND (
      p.user_id = ${userId}
      OR p.id IN (SELECT project_id FROM project_members WHERE user_id = ${userId})
      OR (p.domain IS NOT NULL AND p.domain != '' AND p.domain = ${emailDomain})
      OR p.org_id IN (SELECT org_id FROM organization_members WHERE user_id = ${userId})
    )
  `;
  if (agents.length === 0) {
    return NextResponse.json({ error: "Agent not found" }, { status: 404 });
  }

  const reports = await sql`
    SELECT task_name, summary, metrics, created_at
    FROM agent_reports
    WHERE agent_assignment_id = ${agentId}
    ORDER BY created_at DESC
    LIMIT 20
  `;

  // Also return task statuses from config — these contain error details
  // even when saveReport wasn't called (e.g. older code or report write failure)
  const config = (agents[0].config as { tasks?: { name: string; status: string; result?: string; model_used?: string; use_mode?: string }[] }) || {};
  const tasks = (config.tasks || []).map((t, i) => ({
    index: i,
    name: t.name,
    status: t.status,
    result: t.result || null,
    model_used: t.model_used || null,
    use_mode: t.use_mode || null,
  }));

  return NextResponse.json({
    agent_type: agents[0].agent_type,
    agent_status: agents[0].agent_status,
    tasks,
    reports: reports.map((r) => ({
      task_name: r.task_name,
      summary: r.summary,
      metrics: r.metrics || {},
      created_at: r.created_at,
    })),
  });
}
