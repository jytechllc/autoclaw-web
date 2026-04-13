import { getDb } from "@/lib/db";

export type AuditAction =
  | "login"
  | "project.create"
  | "project.update"
  | "project.delete"
  | "agent.activate"
  | "agent.deactivate"
  | "agent.config_update"
  | "blocker.resolve"
  | "settings.update"
  | "execute.task"
  | "subscribe.register"
  | "org.create"
  | "org.add_member"
  | "org.remove_member"
  | "org.assign_project"
  | "org.rename"
  | "org.update_role"
  | "org.join"
  | "org.delete"
  | "apikey.upsert"
  | "apikey.delete"
  | "apikey.reveal"
  | "platform_apikey.create"
  | "platform_apikey.revoke"
  | "org_apikey.upsert"
  | "org_apikey.reveal"
  | "org_apikey.delete"
  | "project.set_role"
  | "recruiting.create_candidate"
  | "recruiting.update_candidate"
  | "recruiting.move_candidate"
  | "recruiting.delete_candidate"
  | "recruiting.create_position"
  | "recruiting.update_position"
  | "recruiting.delete_position"
  | "recruiting.create_interview"
  | "recruiting.update_interview"
  | "recruiting.delete_interview";

interface AuditLogParams {
  userId: number | null;
  userEmail: string;
  action: AuditAction;
  resourceType?: string;
  resourceId?: number;
  details?: Record<string, unknown>;
  ipAddress?: string;
}

export async function logAudit(params: AuditLogParams) {
  try {
    const sql = getDb();
    await sql`
      INSERT INTO audit_logs (user_id, user_email, action, resource_type, resource_id, details, ip_address)
      VALUES (
        ${params.userId},
        ${params.userEmail},
        ${params.action},
        ${params.resourceType || null},
        ${params.resourceId || null},
        ${JSON.stringify(params.details || {})},
        ${params.ipAddress || null}
      )
    `;
  } catch (e) {
    console.error("Audit log failed:", e);
  }
}
