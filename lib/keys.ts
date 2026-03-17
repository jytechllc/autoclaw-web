import { getDb } from "@/lib/db";
import { decrypt } from "@/lib/crypto";

/**
 * Get an API key for a user, falling back to org-level keys if the user doesn't have one.
 * Checks: user_api_keys → org_api_keys (via organization_members)
 */
export async function getUserKey(userId: number, service: string): Promise<string | null> {
  const sql = getDb();

  // 1. Check user's own keys
  const userKeys = await sql`
    SELECT api_key FROM user_api_keys WHERE user_id = ${userId} AND service = ${service} LIMIT 1
  `;
  if (userKeys.length > 0) return decrypt(userKeys[0].api_key);

  // 2. Fall back to org-level keys
  const orgKeys = await sql`
    SELECT ok.api_key FROM org_api_keys ok
    JOIN organization_members om ON ok.org_id = om.org_id
    WHERE om.user_id = ${userId} AND ok.service = ${service}
    LIMIT 1
  `;
  if (orgKeys.length > 0) return decrypt(orgKeys[0].api_key);

  return null;
}
