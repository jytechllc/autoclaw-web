import { NextRequest, NextResponse } from "next/server";
import { auth0 } from "@/lib/auth0";
import { getDb } from "@/lib/db";
import { decrypt } from "@/lib/crypto";

export const dynamic = "force-dynamic";

const SYSTEM_WORKER_URL = process.env.WORKER_URL || "https://autoclaw-worker.jytech.workers.dev";
const SYSTEM_WORKER_SECRET = process.env.WORKER_AUTH_SECRET;

export async function POST(req: NextRequest) {
  const session = await auth0.getSession();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sql = getDb();
  const email = session.user.email as string;
  const { agent_id, task_index, action, mode, locale } = await req.json();

  // Verify user owns this agent
  const users = await sql`SELECT id FROM users WHERE email = ${email}`;
  if (users.length === 0) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }
  const userId = users[0].id;

  const emailDomain = email.split("@")[1] || "";
  const agents = await sql`
    SELECT aa.id, aa.project_id FROM agent_assignments aa
    JOIN projects p ON aa.project_id = p.id
    WHERE aa.id = ${agent_id} AND (
      p.user_id = ${userId}
      OR p.id IN (SELECT project_id FROM project_members WHERE user_id = ${userId})
      OR (p.domain IS NOT NULL AND p.domain != '' AND p.domain = ${emailDomain})
      OR p.org_id IN (SELECT org_id FROM organization_members WHERE user_id = ${userId})
    )
  `;
  if (agents.length === 0) {
    return NextResponse.json({ error: "Agent not found" }, { status: 404 });
  }

  // Resolve worker URL and secret: user BYOK first, then system fallback
  let workerUrl: string | undefined;
  let workerSecret: string | undefined;

  // Check user's BYOK worker config first
  const byokKeys = await sql`
    SELECT service, api_key FROM user_api_keys
    WHERE user_id = ${userId} AND service IN ('worker_url', 'worker_secret')
  `;
  for (const row of byokKeys) {
    if (row.service === "worker_url") workerUrl = decrypt(row.api_key);
    if (row.service === "worker_secret") workerSecret = decrypt(row.api_key);
  }

  // Fall back to system-level config if user hasn't configured BYOK worker
  if (!workerUrl) workerUrl = SYSTEM_WORKER_URL;
  if (!workerSecret) workerSecret = SYSTEM_WORKER_SECRET;

  if (!workerUrl || !workerSecret) {
    return NextResponse.json({ error: "Worker not configured. Add your Cloudflare Worker URL and Secret in Settings → API Keys." }, { status: 500 });
  }

  // Reset action: reset all tasks to pending (for restart mode), no worker call needed
  if (action === "reset") {
    const agentRows = await sql`SELECT config FROM agent_assignments WHERE id = ${agent_id}`;
    if (agentRows.length > 0) {
      const resetConfig = (agentRows[0].config as Record<string, unknown>) || {};
      const resetTasks = (resetConfig.tasks as { name: string; status: string; result?: string; model_used?: string; use_mode?: string }[]) || [];
      for (let j = 0; j < resetTasks.length; j++) {
        resetTasks[j].status = j === 0 ? "in_progress" : "pending";
        delete resetTasks[j].result;
        delete resetTasks[j].model_used;
        delete resetTasks[j].use_mode;
      }
      await sql`UPDATE agent_assignments SET config = ${JSON.stringify({ ...resetConfig, tasks: resetTasks })} WHERE id = ${agent_id}`;
    }
    return NextResponse.json({ success: true, message: "Tasks reset" });
  }

  const endpoint = action === "run-all" ? "/run-all" : "/execute";
  const body = action === "run-all"
    ? { agent_id, mode: mode || "continue", locale: locale || "en" }
    : { agent_id, task_index, project_id: agents[0].project_id, user_id: userId, caller_id: userId, locale: locale || "en" };

  try {
    const workerRes = await fetch(`${workerUrl}${endpoint}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${workerSecret}`,
      },
      body: JSON.stringify(body),
    });

    const result = await workerRes.json();
    return NextResponse.json(result, { status: workerRes.status });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: `Worker call failed: ${message}` }, { status: 502 });
  }
}
