// Server-only role helpers (DB-backed). Keep DB imports out of lib/roles.ts,
// which is imported by client components.
import type { NeonQueryFunction } from "@neondatabase/serverless";
import { isReadOnlyUser } from "./roles";

type Sql = NeonQueryFunction<false, false>;

/**
 * Is this user a dedicated read-only (sandbox/viewer) account?
 * Global super-admins (users.role='admin') are never read-only. Otherwise the
 * user is read-only when every org membership is a read-only role (viewer/domain).
 */
export async function isReadOnlyUserId(sql: Sql, userId: number): Promise<boolean> {
  const u = await sql`SELECT role FROM users WHERE id = ${userId}`;
  if (u.length > 0 && u[0].role === "admin") return false;
  const mems = await sql`SELECT role FROM organization_members WHERE user_id = ${userId}`;
  return isReadOnlyUser(mems.map((m) => m.role as string | null));
}
