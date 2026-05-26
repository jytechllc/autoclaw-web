import { getDb } from "@/lib/db";

export interface WorkflowStepDef {
  kind: "send_email" | "wait" | "stop_if_replied" | "enrich" | "notify";
  template_id?: number;
  delay_seconds?: number;
}

export interface WorkflowDefinition {
  trigger?: { type: string };
  steps: WorkflowStepDef[];
}

/**
 * Compile a workflow into scheduled_emails for every contact in its project.
 * Used when a workflow is activated: enrolls each existing contact at step 0,
 * computes run_at as NOW() + cumulative delay across preceding wait steps,
 * and inserts one row per send_email step.
 *
 * Returns count of scheduled rows created.
 */
export async function enqueueWorkflowForContacts(workflowId: number): Promise<number> {
  const sql = getDb();
  const wfRows = await sql`SELECT * FROM workflows WHERE id = ${workflowId}`;
  if (wfRows.length === 0) return 0;
  const wf = wfRows[0] as { id: number; project_id: number | null; user_id: number; definition: WorkflowDefinition };
  const def = (typeof wf.definition === "string" ? JSON.parse(wf.definition) : wf.definition) as WorkflowDefinition;
  if (!def?.steps?.length) return 0;

  const contacts = wf.project_id
    ? await sql`SELECT id FROM contacts WHERE project_id = ${wf.project_id} AND user_id = ${wf.user_id}`
    : await sql`SELECT id FROM contacts WHERE user_id = ${wf.user_id}`;

  // Auto-bind unbound send_email steps to user's templates in order (template_id was null when
  // the UI compiled the definition; on activation, snap to the user's seeded sequence).
  const sendStepIndices: number[] = [];
  def.steps.forEach((s, i) => { if (s.kind === "send_email" && !s.template_id) sendStepIndices.push(i); });
  if (sendStepIndices.length > 0) {
    const tpls = await sql`SELECT id FROM email_templates WHERE user_id = ${wf.user_id} ORDER BY id ASC LIMIT ${sendStepIndices.length}`;
    sendStepIndices.forEach((stepIdx, n) => {
      if (tpls[n]) def.steps[stepIdx].template_id = tpls[n].id as number;
    });
  }

  let total = 0;
  for (const c of contacts) {
    const contactId = c.id as number;
    // Idempotent enrollment
    const existing = await sql`SELECT id FROM workflow_runs WHERE workflow_id = ${workflowId} AND contact_id = ${contactId}`;
    let runId: number;
    if (existing.length) {
      runId = existing[0].id as number;
    } else {
      const ins = await sql`
        INSERT INTO workflow_runs (workflow_id, contact_id, current_step, status)
        VALUES (${workflowId}, ${contactId}, 0, 'running')
        RETURNING id
      `;
      runId = ins[0].id as number;
    }

    let cumulativeSeconds = 0;
    for (let i = 0; i < def.steps.length; i++) {
      const step = def.steps[i];
      if (step.kind === "wait") {
        cumulativeSeconds += step.delay_seconds || 0;
        continue;
      }
      if (step.kind === "send_email" && step.template_id) {
        const runAt = new Date(Date.now() + cumulativeSeconds * 1000).toISOString();
        // Skip if already scheduled (idempotent re-activation)
        const dup = await sql`SELECT id FROM scheduled_emails WHERE workflow_run_id = ${runId} AND step_index = ${i}`;
        if (dup.length === 0) {
          await sql`
            INSERT INTO scheduled_emails (workflow_run_id, workflow_id, contact_id, template_id, step_index, run_at, status)
            VALUES (${runId}, ${workflowId}, ${contactId}, ${step.template_id}, ${i}, ${runAt}, 'pending')
          `;
          total++;
        }
      }
    }
  }
  return total;
}
