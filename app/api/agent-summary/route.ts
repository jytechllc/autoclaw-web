import { NextResponse } from "next/server";
import { auth0 } from "@/lib/auth0";
import { getDb, resolveUserPlan } from "@/lib/db";

export const dynamic = "force-dynamic";

// Lightweight summary of all projects + agents for the overview cards
export async function GET() {
  const session = await auth0.getSession();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const sql = getDb();
  const email = session.user.email as string;
  const users = await sql`SELECT id, plan FROM users WHERE email = ${email}`;
  if (users.length === 0) return NextResponse.json({ projects: [] });
  const userId = users[0].id as number;
  const plan = await resolveUserPlan(sql, userId, (users[0].plan as string) || "starter", email);

  // Get all accessible projects with agent summary counts
  const emailDomain = email.split("@")[1] || "";
  const projects = await sql`
    SELECT DISTINCT p.id, p.name, p.website, p.domain, p.description,
      (SELECT COUNT(*)::int FROM agent_assignments aa WHERE aa.project_id = p.id AND aa.status = 'active') as agent_count,
      (SELECT COUNT(*)::int FROM contacts c WHERE c.project_id = p.id) as contact_count
    FROM projects p
    LEFT JOIN project_members pm ON pm.project_id = p.id AND pm.user_id = ${userId}
    LEFT JOIN organization_members om ON p.org_id = om.org_id AND om.user_id = ${userId}
    WHERE p.user_id = ${userId}
      OR pm.user_id = ${userId}
      OR om.user_id = ${userId}
      ${emailDomain ? sql`OR (p.domain IS NOT NULL AND p.domain != '' AND p.domain = ${emailDomain})` : sql``}
    ORDER BY p.id DESC
  `;

  const projectIds = projects.map((p) => p.id as number);
  if (projectIds.length === 0) return NextResponse.json({ projects: [], plan });

  // Get agent task summaries per project (single query)
  const agentSummaries = await sql`
    SELECT
      aa.project_id,
      aa.id as agent_id,
      aa.agent_type,
      aa.status,
      aa.config,
      aa.created_at
    FROM agent_assignments aa
    WHERE aa.project_id = ANY(${projectIds}) AND aa.status = 'active'
    ORDER BY aa.project_id, aa.id
  `;

  // Get recent errors (last 7 days)
  const recentErrors = await sql`
    SELECT aa.project_id, COUNT(*)::int as error_count
    FROM agent_assignments aa
    WHERE aa.project_id = ANY(${projectIds})
      AND aa.status = 'active'
      AND aa.config::text LIKE '%"error"%'
    GROUP BY aa.project_id
  `;
  const errorMap = Object.fromEntries(recentErrors.map((r) => [r.project_id, r.error_count]));

  // Get pending review emails per project
  const pendingReviews = await sql`
    SELECT project_id, COUNT(*)::int as pending_count
    FROM email_logs
    WHERE user_id = ${userId} AND status = 'pending_review' AND project_id = ANY(${projectIds})
    GROUP BY project_id
  `;
  const pendingMap = Object.fromEntries(pendingReviews.map((r) => [r.project_id, r.pending_count]));

  // Build per-project summary
  const projectSummaries = projects.map((p) => {
    const pid = p.id as number;
    const agents = agentSummaries.filter((a) => a.project_id === pid);

    // Count task statuses across all agents in this project
    let totalTasks = 0;
    let completedTasks = 0;
    let inProgressTasks = 0;
    let errorTasks = 0;
    let recurringTasks = 0;
    let lastActivity: string | null = null;

    for (const agent of agents) {
      const config = agent.config as { tasks?: { status: string; name?: string }[] } | null;
      const tasks = config?.tasks || [];
      for (const task of tasks) {
        totalTasks++;
        if (task.status === "completed") completedTasks++;
        else if (task.status === "in_progress") inProgressTasks++;
        else if (task.status === "error") errorTasks++;
        else if (task.status === "recurring") recurringTasks++;
      }
      const updatedAt = agent.created_at as string;
      if (!lastActivity || updatedAt > lastActivity) lastActivity = updatedAt;
    }

    return {
      id: pid,
      name: p.name,
      website: p.website,
      description: p.description,
      agentCount: p.agent_count as number,
      contactCount: p.contact_count as number,
      totalTasks,
      completedTasks,
      inProgressTasks,
      errorTasks,
      recurringTasks,
      pendingReviews: (pendingMap[pid] as number) || 0,
      agentErrors: (errorMap[pid] as number) || 0,
      lastActivity,
      agents: agents.map((a) => {
        const config = a.config as { tasks?: { status: string; name?: string; result?: string }[] } | null;
        const tasks = config?.tasks || [];
        const completed = tasks.filter((t) => t.status === "completed").length;
        const errors = tasks.filter((t) => t.status === "error").length;
        const inProgress = tasks.filter((t) => t.status === "in_progress").length;
        return {
          id: a.agent_id,
          type: a.agent_type,
          taskProgress: `${completed}/${tasks.length}`,
          errors,
          inProgress,
          lastError: tasks.find((t) => t.status === "error")?.result?.slice(0, 100),
        };
      }),
    };
  });

  return NextResponse.json({ projects: projectSummaries, plan });
}
