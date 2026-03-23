import { NextRequest, NextResponse } from "next/server";
import { auth0 } from "@/lib/auth0";
import { getDb } from "@/lib/db";
import { encrypt, decrypt } from "@/lib/crypto";
import { TwitterApi } from "twitter-api-v2";

export const dynamic = "force-dynamic";

// GET: OAuth callback — X redirects here after user authorizes
export async function GET(req: NextRequest) {
  try {
    const session = await auth0.getSession();
    if (!session?.user) {
      return NextResponse.redirect(new URL("/api/auth/login", req.url));
    }

    const sql = getDb();
    const sub = session.user.sub;
    const users = await sql`SELECT id FROM users WHERE auth0_id = ${sub} LIMIT 1`;
    if (users.length === 0) {
      return NextResponse.redirect(new URL("/en/dashboard/x?error=user_not_found", req.url));
    }
    const userId = users[0].id as number;

    const oauthToken = req.nextUrl.searchParams.get("oauth_token");
    const oauthVerifier = req.nextUrl.searchParams.get("oauth_verifier");
    const denied = req.nextUrl.searchParams.get("denied");
    console.log("[X OAuth callback]", { oauthToken: oauthToken?.substring(0, 10), oauthVerifier: !!oauthVerifier, denied, userId });

    // User denied authorization
    if (denied) {
      // Clean up pending row
      await sql`DELETE FROM x_accounts WHERE user_id = ${userId} AND status = 'pending_oauth'`;
      return NextResponse.redirect(new URL("/en/dashboard/x?error=denied", req.url));
    }

    if (!oauthToken || !oauthVerifier) {
      await sql`DELETE FROM x_accounts WHERE user_id = ${userId} AND status = 'pending_oauth'`;
      return NextResponse.redirect(new URL("/en/dashboard/x?error=missing_params", req.url));
    }

    // Find the pending OAuth row to get consumer keys + oauth_token_secret
    const pendingRows = await sql`
      SELECT id, api_key, api_secret, access_token, access_token_secret
      FROM x_accounts
      WHERE user_id = ${userId} AND status = 'pending_oauth' AND access_token = ${oauthToken}
      ORDER BY created_at DESC LIMIT 1
    `;

    if (pendingRows.length === 0) {
      console.error("[X OAuth callback] no pending_oauth row found for", { userId, oauthToken });
      // Check if any pending rows exist at all
      const anyPending = await sql`SELECT id, access_token, status FROM x_accounts WHERE user_id = ${userId} AND status = 'pending_oauth'`;
      console.error("[X OAuth callback] all pending rows:", anyPending);
      return NextResponse.redirect(new URL("/en/dashboard/x?error=no_pending_auth", req.url));
    }

    const pending = pendingRows[0];
    const consumerKey = pending.api_key as string; // stored unencrypted during pending
    const consumerSecret = pending.api_secret as string;
    const oauthTokenSecret = pending.access_token_secret as string;

    // Exchange for access token
    const client = new TwitterApi({
      appKey: consumerKey,
      appSecret: consumerSecret,
      accessToken: oauthToken,
      accessSecret: oauthTokenSecret,
    });

    const { accessToken, accessSecret, screenName, userId: xUserId } = await client.login(oauthVerifier);
    console.log("[X OAuth callback] login success:", { screenName, xUserId });

    // Check if this X account already exists for this user (by x_user_id)
    const existingAcct = await sql`SELECT id FROM x_accounts WHERE user_id = ${userId} AND x_user_id = ${xUserId} AND status = 'active'`;

    if (existingAcct.length > 0) {
      // Update existing account with new tokens
      await sql`
        UPDATE x_accounts SET
          access_token = ${encrypt(accessToken)},
          access_token_secret = ${encrypt(accessSecret)},
          api_key = ${encrypt(consumerKey)},
          api_secret = ${encrypt(consumerSecret)},
          username = ${screenName || null},
          last_verified_at = NOW(),
          updated_at = NOW()
        WHERE id = ${existingAcct[0].id}
      `;
      // Remove pending row
      await sql`DELETE FROM x_accounts WHERE id = ${pending.id}`;
    } else {
      // Check if this is (will be) the only active account
      const activeCount = await sql`SELECT COUNT(*)::int as count FROM x_accounts WHERE user_id = ${userId} AND status = 'active'`;
      const isFirst = (activeCount[0].count as number) === 0;

      // Convert pending row to active account
      await sql`
        UPDATE x_accounts SET
          label = ${screenName ? `@${screenName}` : "X Account"},
          username = ${screenName || null},
          x_user_id = ${xUserId || null},
          api_key = ${encrypt(consumerKey)},
          api_secret = ${encrypt(consumerSecret)},
          access_token = ${encrypt(accessToken)},
          access_token_secret = ${encrypt(accessSecret)},
          is_default = ${isFirst},
          status = 'active',
          last_verified_at = NOW(),
          updated_at = NOW()
        WHERE id = ${pending.id}
      `;
    }

    // Clean up any other stale pending rows
    await sql`DELETE FROM x_accounts WHERE user_id = ${userId} AND status = 'pending_oauth'`;

    // Detect user locale from referer or default
    const locale = req.headers.get("accept-language")?.split(",")[0]?.split("-")[0] || "en";
    const dashLocale = ["zh", "fr"].includes(locale) ? locale : "en";

    return NextResponse.redirect(new URL(`/${dashLocale}/dashboard/x?connected=${screenName || "ok"}`, req.url));
  } catch (err) {
    console.error("[GET /api/x/auth/callback]", err);
    // Clean up on error
    try {
      const session = await auth0.getSession();
      if (session?.user) {
        const sql = getDb();
        const users = await sql`SELECT id FROM users WHERE auth0_id = ${session.user.sub} LIMIT 1`;
        if (users.length > 0) {
          await sql`DELETE FROM x_accounts WHERE user_id = ${users[0].id} AND status = 'pending_oauth'`;
        }
      }
    } catch { /* ignore */ }
    return NextResponse.redirect(new URL(`/en/dashboard/x?error=${encodeURIComponent(err instanceof Error ? err.message : "auth_failed")}`, req.url));
  }
}
