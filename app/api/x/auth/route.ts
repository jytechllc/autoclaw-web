import { NextRequest, NextResponse } from "next/server";
import { auth0 } from "@/lib/auth0";
import { getDb } from "@/lib/db";
import { decrypt } from "@/lib/crypto";
import { TwitterApi } from "twitter-api-v2";

export const dynamic = "force-dynamic";

// Resolve the app's consumer keys (API Key + Secret) from org or user BYOK
async function getConsumerKeys(userId: number): Promise<{ apiKey: string; apiSecret: string } | null> {
  const sql = getDb();

  // 1. Check x_accounts for any existing account's consumer keys (reuse them)
  try {
    const existing = await sql`SELECT api_key, api_secret FROM x_accounts WHERE user_id = ${userId} AND status = 'active' LIMIT 1`;
    if (existing.length > 0) {
      return { apiKey: decrypt(existing[0].api_key as string), apiSecret: decrypt(existing[0].api_secret as string) };
    }
  } catch { /* continue */ }

  // 2. Org-level keys
  try {
    const orgKeys = await sql`
      SELECT oak.service, oak.api_key FROM org_api_keys oak
      JOIN organization_members om ON om.org_id = oak.org_id
      WHERE om.user_id = ${userId} AND oak.service IN ('twitter_api_key', 'twitter_api_secret')
    `;
    const map: Record<string, string> = {};
    for (const k of orgKeys) {
      try { map[k.service as string] = decrypt(k.api_key as string); } catch { /* skip */ }
    }
    if (map.twitter_api_key && map.twitter_api_secret) {
      return { apiKey: map.twitter_api_key, apiSecret: map.twitter_api_secret };
    }
  } catch { /* continue */ }

  // 3. User's own BYOK keys
  try {
    const userKeys = await sql`
      SELECT service, api_key FROM user_api_keys
      WHERE user_id = ${userId} AND service IN ('twitter_api_key', 'twitter_api_secret')
    `;
    const map: Record<string, string> = {};
    for (const k of userKeys) {
      try { map[k.service as string] = decrypt(k.api_key as string); } catch { /* skip */ }
    }
    if (map.twitter_api_key && map.twitter_api_secret) {
      return { apiKey: map.twitter_api_key, apiSecret: map.twitter_api_secret };
    }
  } catch { /* continue */ }

  // 4. Platform-level fallback (env vars) — enables true one-click login
  if (process.env.X_API_KEY && process.env.X_API_SECRET) {
    return { apiKey: process.env.X_API_KEY, apiSecret: process.env.X_API_SECRET };
  }

  return null;
}

// GET: Initiate OAuth 1.0a flow — returns the X authorization URL
export async function GET(req: NextRequest) {
  try {
    const session = await auth0.getSession();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const sql = getDb();
    const sub = session.user.sub;
    const users = await sql`SELECT id FROM users WHERE auth0_id = ${sub} LIMIT 1`;
    if (users.length === 0) return NextResponse.json({ error: "User not found" }, { status: 404 });
    const userId = users[0].id as number;

    const consumer = await getConsumerKeys(userId);
    if (!consumer) {
      return NextResponse.json({ error: "No X API consumer keys found. Your organization admin needs to configure X API Key & Secret first." }, { status: 400 });
    }

    // Build callback URL
    const origin = req.headers.get("origin") || req.nextUrl.origin;
    const callbackUrl = `${origin}/api/x/auth/callback`;

    const client = new TwitterApi({ appKey: consumer.apiKey, appSecret: consumer.apiSecret });
    let authLink;
    try {
      authLink = await client.generateAuthLink(callbackUrl, { linkMode: "authorize" });
    } catch (oauthErr: unknown) {
      // Extract raw response for debugging
      let rawBody = "";
      try {
        const e = oauthErr as { data?: unknown; rawContent?: string };
        rawBody = e.rawContent || JSON.stringify(e.data) || "";
      } catch { /* ignore */ }
      console.error("[X OAuth request_token failed]", "code:", (oauthErr as { code?: number }).code, "raw:", rawBody);
      return NextResponse.json({
        error: "X OAuth request_token failed",
        code: (oauthErr as { code?: number }).code,
        raw: rawBody,
        callbackUrl,
        hint: "Go to X Developer Portal → App Settings → User Authentication Settings. Enable OAuth 1.0a, set Type to 'Web App', add callback URL: " + callbackUrl,
      }, { status: 400 });
    }

    // Clean up any stale pending_oauth rows for this user (prev attempts that didn't complete)
    await sql`DELETE FROM x_accounts WHERE user_id = ${userId} AND status = 'pending_oauth'`;

    // Store oauth_token_secret temporarily (needed for callback)
    // Use a simple DB table or in-memory store — we'll use a temp row in x_accounts with status='pending_oauth'
    await sql`
      INSERT INTO x_accounts (user_id, label, api_key, api_secret, access_token, access_token_secret, status)
      VALUES (${userId}, 'pending_oauth', ${consumer.apiKey}, ${consumer.apiSecret}, ${authLink.oauth_token}, ${authLink.oauth_token_secret}, 'pending_oauth')
    `;

    return NextResponse.json({ url: authLink.url, oauth_token: authLink.oauth_token });
  } catch (err: unknown) {
    console.error("[GET /api/x/auth]", JSON.stringify(err, Object.getOwnPropertyNames(err as object), 2));
    // Extract detailed error from twitter-api-v2
    const detail = (err && typeof err === "object" && "data" in err) ? JSON.stringify((err as { data: unknown }).data) : "";
    const code = (err && typeof err === "object" && "code" in err) ? (err as { code: number }).code : "";
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({
      error: `OAuth failed (${code}): ${msg}`,
      detail,
      hint: code === 403
        ? "Check X Developer Portal: 1) App must have OAuth 1.0a enabled with Read+Write permissions. 2) Callback URL must be configured. 3) App must not be suspended."
        : undefined,
    }, { status: 500 });
  }
}
