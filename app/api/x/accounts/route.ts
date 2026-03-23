import { NextRequest, NextResponse } from "next/server";
import { auth0 } from "@/lib/auth0";
import { getDb } from "@/lib/db";
import { encrypt, decrypt } from "@/lib/crypto";
import { TwitterApi } from "twitter-api-v2";

export const dynamic = "force-dynamic";

// GET: List all X accounts for the current user
export async function GET() {
  try {
    const session = await auth0.getSession();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const sql = getDb();
    const sub = session.user.sub;
    const users = await sql`SELECT id FROM users WHERE auth0_id = ${sub} LIMIT 1`;
    if (users.length === 0) return NextResponse.json({ accounts: [] });
    const userId = users[0].id;

    const accounts = await sql`
      SELECT id, label, username, x_user_id, is_default, status, last_verified_at, created_at
      FROM x_accounts WHERE user_id = ${userId}
      ORDER BY is_default DESC, created_at ASC
    `;

    // Check if org-level Twitter keys are available for one-click import
    // Only show if not already imported (compare by decrypted access_token)
    let orgKeysAvailable = false;
    let orgName: string | null = null;
    try {
      const orgKeys = await sql`
        SELECT oak.service, oak.api_key, o.name as org_name FROM org_api_keys oak
        JOIN organizations o ON o.id = oak.org_id
        JOIN organization_members om ON om.org_id = oak.org_id
        WHERE om.user_id = ${userId}
          AND oak.service IN ('twitter_api_key', 'twitter_api_secret', 'twitter_access_token', 'twitter_access_token_secret')
      `;
      if (orgKeys.length >= 4) {
        orgName = orgKeys[0].org_name as string;
        // Check if this org's access_token is already in x_accounts
        const orgAccessToken = orgKeys.find((k) => k.service === "twitter_access_token");
        if (orgAccessToken && accounts.length > 0) {
          let alreadyImported = false;
          for (const acct of accounts) {
            try {
              const existing = await sql`SELECT access_token FROM x_accounts WHERE id = ${acct.id}`;
              if (existing[0] && decrypt(existing[0].access_token as string) === decrypt(orgAccessToken.api_key as string)) {
                alreadyImported = true;
                break;
              }
            } catch { /* skip */ }
          }
          orgKeysAvailable = !alreadyImported;
        } else {
          orgKeysAvailable = true;
        }
      }
    } catch { /* ignore */ }

    // Also check legacy user_api_keys (only show if not already imported)
    let legacyKeysAvailable = false;
    try {
      const legacyKeys = await sql`
        SELECT service, api_key FROM user_api_keys
        WHERE user_id = ${userId} AND service IN ('twitter_api_key', 'twitter_api_secret', 'twitter_access_token', 'twitter_access_token_secret')
      `;
      if (legacyKeys.length >= 4) {
        const legacyAccessToken = legacyKeys.find((k) => k.service === "twitter_access_token");
        if (legacyAccessToken && accounts.length > 0) {
          let alreadyImported = false;
          for (const acct of accounts) {
            try {
              const existing = await sql`SELECT access_token FROM x_accounts WHERE id = ${acct.id}`;
              if (existing[0] && decrypt(existing[0].access_token as string) === decrypt(legacyAccessToken.api_key as string)) {
                alreadyImported = true;
                break;
              }
            } catch { /* skip */ }
          }
          legacyKeysAvailable = !alreadyImported;
        } else {
          legacyKeysAvailable = true;
        }
      }
    } catch { /* ignore */ }

    return NextResponse.json({ accounts, orgKeysAvailable, orgName, legacyKeysAvailable });
  } catch (err) {
    console.error("[GET /api/x/accounts]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

// POST: Add, update, remove, or set default account
export async function POST(req: NextRequest) {
  try {
    const session = await auth0.getSession();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const sql = getDb();
    const sub = session.user.sub;
    const users = await sql`SELECT id FROM users WHERE auth0_id = ${sub} LIMIT 1`;
    if (users.length === 0) return NextResponse.json({ error: "User not found" }, { status: 404 });
    const userId = users[0].id as number;

    const body = await req.json();
    const { action } = body;

    // Add a new X account
    if (action === "add") {
      const { label, api_key, api_secret, access_token, access_token_secret } = body;
      if (!label || !api_key || !api_secret || !access_token || !access_token_secret) {
        return NextResponse.json({ error: "All fields are required" }, { status: 400 });
      }

      // Verify the credentials by connecting to X
      let username: string | undefined;
      let xUserId: string | undefined;
      try {
        const client = new TwitterApi({
          appKey: api_key,
          appSecret: api_secret,
          accessToken: access_token,
          accessSecret: access_token_secret,
        });
        try {
          const me = await client.v2.me();
          username = me.data.username;
          xUserId = me.data.id;
        } catch {
          // v2 failed, try v1
          try {
            const v1User = await client.v1.verifyCredentials();
            username = v1User.screen_name;
            xUserId = String(v1User.id);
          } catch {
            // Can still post with Free tier even if verify fails
          }
        }
      } catch (e) {
        return NextResponse.json({ error: `Credential verification failed: ${e instanceof Error ? e.message : e}` }, { status: 400 });
      }

      // Check if this is the first account — make it default
      const existing = await sql`SELECT COUNT(*)::int as count FROM x_accounts WHERE user_id = ${userId}`;
      const isFirst = (existing[0].count as number) === 0;

      const rows = await sql`
        INSERT INTO x_accounts (user_id, label, username, x_user_id, api_key, api_secret, access_token, access_token_secret, is_default, last_verified_at)
        VALUES (${userId}, ${label}, ${username || null}, ${xUserId || null}, ${encrypt(api_key)}, ${encrypt(api_secret)}, ${encrypt(access_token)}, ${encrypt(access_token_secret)}, ${isFirst}, NOW())
        RETURNING id
      `;

      return NextResponse.json({ success: true, id: rows[0].id, username, x_user_id: xUserId });
    }

    // Update account label
    if (action === "update") {
      const { id, label } = body;
      if (!id || !label) return NextResponse.json({ error: "id and label are required" }, { status: 400 });
      await sql`UPDATE x_accounts SET label = ${label}, updated_at = NOW() WHERE id = ${id} AND user_id = ${userId}`;
      return NextResponse.json({ success: true });
    }

    // Set default account
    if (action === "set_default") {
      const { id } = body;
      if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });
      // Clear all defaults, then set the chosen one
      await sql`UPDATE x_accounts SET is_default = false WHERE user_id = ${userId}`;
      await sql`UPDATE x_accounts SET is_default = true, updated_at = NOW() WHERE id = ${id} AND user_id = ${userId}`;
      return NextResponse.json({ success: true });
    }

    // Remove account
    if (action === "remove") {
      const { id } = body;
      if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });
      const acct = await sql`SELECT is_default FROM x_accounts WHERE id = ${id} AND user_id = ${userId}`;
      await sql`DELETE FROM x_accounts WHERE id = ${id} AND user_id = ${userId}`;
      // If deleted the default, promote the first remaining
      if (acct.length > 0 && acct[0].is_default) {
        await sql`
          UPDATE x_accounts SET is_default = true
          WHERE id = (SELECT id FROM x_accounts WHERE user_id = ${userId} ORDER BY created_at ASC LIMIT 1)
        `;
      }
      return NextResponse.json({ success: true });
    }

    // Import org-level or legacy keys as an x_account (one-click connect)
    if (action === "import_org" || action === "import_legacy") {
      let apiKey = "", apiSecret = "", accessToken = "", accessTokenSecret = "";
      let importLabel = "";

      if (action === "import_org") {
        const orgKeys = await sql`
          SELECT oak.service, oak.api_key, o.name as org_name FROM org_api_keys oak
          JOIN organizations o ON o.id = oak.org_id
          JOIN organization_members om ON om.org_id = oak.org_id
          WHERE om.user_id = ${userId}
            AND oak.service IN ('twitter_api_key', 'twitter_api_secret', 'twitter_access_token', 'twitter_access_token_secret')
        `;
        if (orgKeys.length < 4) return NextResponse.json({ error: "Org keys not found" }, { status: 404 });
        importLabel = `${orgKeys[0].org_name || "Organization"}`;
        for (const k of orgKeys) {
          const val = decrypt(k.api_key as string);
          if (k.service === "twitter_api_key") apiKey = val;
          else if (k.service === "twitter_api_secret") apiSecret = val;
          else if (k.service === "twitter_access_token") accessToken = val;
          else if (k.service === "twitter_access_token_secret") accessTokenSecret = val;
        }
      } else {
        const legacyKeys = await sql`
          SELECT service, api_key FROM user_api_keys
          WHERE user_id = ${userId} AND service IN ('twitter_api_key', 'twitter_api_secret', 'twitter_access_token', 'twitter_access_token_secret')
        `;
        if (legacyKeys.length < 4) return NextResponse.json({ error: "Legacy keys not found" }, { status: 404 });
        importLabel = "My Account";
        for (const k of legacyKeys) {
          const val = decrypt(k.api_key as string);
          if (k.service === "twitter_api_key") apiKey = val;
          else if (k.service === "twitter_api_secret") apiSecret = val;
          else if (k.service === "twitter_access_token") accessToken = val;
          else if (k.service === "twitter_access_token_secret") accessTokenSecret = val;
        }
      }

      // Verify credentials
      let username: string | undefined;
      let xUserId: string | undefined;
      try {
        const client = new TwitterApi({ appKey: apiKey, appSecret: apiSecret, accessToken, accessSecret: accessTokenSecret });
        try { const me = await client.v2.me(); username = me.data.username; xUserId = me.data.id; }
        catch { try { const v1 = await client.v1.verifyCredentials(); username = v1.screen_name; xUserId = String(v1.id); } catch { /* still proceed */ } }
      } catch { /* proceed anyway */ }

      const existing = await sql`SELECT COUNT(*)::int as count FROM x_accounts WHERE user_id = ${userId}`;
      const isFirst = (existing[0].count as number) === 0;

      const rows = await sql`
        INSERT INTO x_accounts (user_id, label, username, x_user_id, api_key, api_secret, access_token, access_token_secret, is_default, last_verified_at)
        VALUES (${userId}, ${body.label || importLabel}, ${username || null}, ${xUserId || null}, ${encrypt(apiKey)}, ${encrypt(apiSecret)}, ${encrypt(accessToken)}, ${encrypt(accessTokenSecret)}, ${isFirst}, NOW())
        RETURNING id
      `;
      return NextResponse.json({ success: true, id: rows[0].id, username, x_user_id: xUserId });
    }

    // Verify (re-check credentials)
    if (action === "verify") {
      const { id } = body;
      if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });
      const rows = await sql`SELECT api_key, api_secret, access_token, access_token_secret FROM x_accounts WHERE id = ${id} AND user_id = ${userId}`;
      if (rows.length === 0) return NextResponse.json({ error: "Account not found" }, { status: 404 });

      try {
        const client = new TwitterApi({
          appKey: decrypt(rows[0].api_key as string),
          appSecret: decrypt(rows[0].api_secret as string),
          accessToken: decrypt(rows[0].access_token as string),
          accessSecret: decrypt(rows[0].access_token_secret as string),
        });
        let username: string | undefined;
        let xUserId: string | undefined;
        try {
          const me = await client.v2.me();
          username = me.data.username;
          xUserId = me.data.id;
        } catch {
          const v1User = await client.v1.verifyCredentials();
          username = v1User.screen_name;
          xUserId = String(v1User.id);
        }
        await sql`UPDATE x_accounts SET username = ${username || null}, x_user_id = ${xUserId || null}, status = 'active', last_verified_at = NOW() WHERE id = ${id}`;
        return NextResponse.json({ success: true, username, x_user_id: xUserId });
      } catch (e) {
        await sql`UPDATE x_accounts SET status = 'error', updated_at = NOW() WHERE id = ${id}`;
        return NextResponse.json({ error: `Verification failed: ${e instanceof Error ? e.message : e}` }, { status: 400 });
      }
    }

    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  } catch (err) {
    console.error("[POST /api/x/accounts]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
