import { NextRequest, NextResponse } from "next/server";
import { auth0 } from "@/lib/auth0";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

async function ensureTiktokTokensTable() {
  const sql = getDb();
  await sql`
    CREATE TABLE IF NOT EXISTS tiktok_tokens (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      open_id VARCHAR(255) NOT NULL,
      access_token TEXT NOT NULL,
      refresh_token TEXT NOT NULL,
      expires_at TIMESTAMP NOT NULL,
      refresh_expires_at TIMESTAMP NOT NULL,
      scope TEXT,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )
  `;
}

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  const error = req.nextUrl.searchParams.get("error");

  if (error) {
    return NextResponse.redirect(
      new URL(`/en/dashboard?tiktok_error=${error}`, req.url)
    );
  }

  if (!code) {
    return NextResponse.redirect(
      new URL("/en/dashboard?tiktok_error=no_code", req.url)
    );
  }

  // Exchange code for access token
  const clientKey = process.env.TIKTOK_CLIENT_KEY;
  const clientSecret = process.env.TIKTOK_CLIENT_SECRET;

  if (!clientKey || !clientSecret) {
    return NextResponse.redirect(
      new URL("/en/dashboard?tiktok_error=missing_config", req.url)
    );
  }

  const codeVerifier = req.cookies.get("tiktok_pkce_verifier")?.value;
  if (!codeVerifier) {
    return NextResponse.redirect(
      new URL("/en/dashboard?tiktok_error=missing_pkce_verifier", req.url)
    );
  }

  try {
    const tokenRes = await fetch(
      "https://open.tiktokapis.com/v2/oauth/token/",
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_key: clientKey,
          client_secret: clientSecret,
          code,
          grant_type: "authorization_code",
          redirect_uri: `${req.nextUrl.origin}/api/tiktok/callback`,
          code_verifier: codeVerifier,
        }),
      }
    );

    const tokenData = await tokenRes.json();

    if (tokenData.error || !tokenData.access_token) {
      console.error("TikTok token error:", tokenData);
      return NextResponse.redirect(
        new URL(
          `/en/dashboard?tiktok_error=${tokenData.error || "token_failed"}`,
          req.url
        )
      );
    }

    // Save token to DB
    await ensureTiktokTokensTable();
    const sql = getDb();

    const expiresAt = new Date(
      Date.now() + tokenData.expires_in * 1000
    );
    const refreshExpiresAt = new Date(
      Date.now() + tokenData.refresh_expires_in * 1000
    );

    // Try to get current user session
    let userId: number | null = null;
    try {
      const session = await auth0.getSession();
      if (session) {
        const users =
          await sql`SELECT id FROM users WHERE auth0_id = ${session.user.sub} LIMIT 1`;
        if (users.length > 0) {
          userId = users[0].id;
        }
      }
    } catch (sessionErr) {
      console.warn("Could not get Auth0 session during TikTok callback:", sessionErr);
    }

    // If no session, fall back to first admin user
    if (!userId) {
      const admins = await sql`SELECT id FROM users WHERE role = 'admin' ORDER BY id ASC LIMIT 1`;
      if (admins.length > 0) {
        userId = admins[0].id;
      }
    }

    if (userId) {
      await sql`
        INSERT INTO tiktok_tokens (user_id, open_id, access_token, refresh_token, expires_at, refresh_expires_at, scope)
        VALUES (${userId}, ${tokenData.open_id}, ${tokenData.access_token}, ${tokenData.refresh_token}, ${expiresAt}, ${refreshExpiresAt}, ${tokenData.scope || ""})
        ON CONFLICT (user_id) DO UPDATE SET
          open_id = EXCLUDED.open_id,
          access_token = EXCLUDED.access_token,
          refresh_token = EXCLUDED.refresh_token,
          expires_at = EXCLUDED.expires_at,
          refresh_expires_at = EXCLUDED.refresh_expires_at,
          scope = EXCLUDED.scope,
          updated_at = NOW()
      `;
    } else {
      console.error("No user found to save TikTok token");
      return NextResponse.redirect(
        new URL("/en/dashboard?tiktok_error=no_user", req.url)
      );
    }

    const res = NextResponse.redirect(
      new URL("/en/dashboard?tiktok_success=true", req.url)
    );
    res.cookies.delete("tiktok_pkce_verifier");
    return res;
  } catch (err) {
    console.error("TikTok callback error:", err);
    return NextResponse.redirect(
      new URL("/en/dashboard?tiktok_error=server_error", req.url)
    );
  }
}
