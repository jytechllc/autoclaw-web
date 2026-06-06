// Central role / capability model shared by client and server.
//
// Org member roles (highest → lowest privilege):
//   owner > admin > operator > member > viewer > domain
// A "read-only" account is one that is viewer/domain (or unknown) in ALL of its
// orgs — i.e. a dedicated sandbox/demo account. Such accounts get a locked-down,
// read-only UI: no writes, and several sections hidden entirely.

export type OrgRole = "owner" | "admin" | "operator" | "member" | "viewer" | "domain";

export const ROLE_RANK: Record<string, number> = {
  owner: 5,
  admin: 4,
  operator: 3,
  member: 2,
  viewer: 1,
  domain: 0,
};

/** A role that can only read, never write. */
export function isReadOnlyRole(role?: string | null): boolean {
  const r = (role ?? "").toLowerCase();
  return r === "" || r === "viewer" || r === "domain";
}

/**
 * Is this account read-only across the board? True only when the user has at
 * least one org membership and EVERY membership is a read-only role. Users who
 * are member+ in any org (real staff) are never treated as read-only here.
 */
export function isReadOnlyUser(roles: Array<string | null | undefined>): boolean {
  const real = roles.filter((r) => r != null);
  return real.length > 0 && real.every(isReadOnlyRole);
}

/** Dashboard sections fully hidden / blocked for read-only accounts. */
export const READONLY_HIDDEN_PREFIXES = [
  "marketplace",   // 市场
  "settings",      // 组织/团队设置
  "billing",       // 账单
  "usage",         // 计费用量
] as const;

/** API path fragments whose mutations AND reads are blocked for read-only accounts. */
export const READONLY_BLOCKED_API_PREFIXES = [
  "/api/api-keys",
  "/api/marketplace",
  "/api/billing",
  "/api/team-members",
] as const;

/** Can this account see monetary spend / budget figures (ad cost, billing)? */
export function canViewSpend(readOnly: boolean): boolean {
  return !readOnly;
}

/** Does a dashboard path belong to a section hidden from read-only accounts? */
export function isHiddenForReadOnly(pathnameAfterDashboard: string): boolean {
  const seg = pathnameAfterDashboard.replace(/^\/+/, "").split(/[/?#]/)[0];
  return (READONLY_HIDDEN_PREFIXES as readonly string[]).includes(seg);
}
