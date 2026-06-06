#!/usr/bin/env node
/**
 * Create a read-only sandbox/demo account.
 *  1) Auth0: create a Username-Password (Database) connection user (email pre-verified).
 *  2) DB:    upsert users row (NON-admin) + add as 'viewer' member of the target org.
 *
 * Idempotent. Reviewable alternative to ad-hoc actions.
 * Usage:  node scripts/create-sandbox-account.mjs <email> <password> [orgName]
 * Env (from .env.local): AUTH0_DOMAIN, AUTH0_CLIENT_ID, AUTH0_CLIENT_SECRET, DATABASE_URL
 */
import { readFileSync } from "fs";
import { neon } from "@neondatabase/serverless";

const email = process.argv[2];
const password = process.argv[3];
const orgName = process.argv[4] || "JYTech";
if (!email || !password) { console.error("usage: <email> <password> [orgName]"); process.exit(1); }

const env = {};
for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "").trim();
}
const domain = env.AUTH0_DOMAIN;

// 1) Management API token (client_credentials).
// Prefer a dedicated M2M app (AUTH0_MGMT_CLIENT_ID/SECRET) authorized for the
// Management API; the regular web-app client is usually NOT granted that API.
const mgmtId = env.AUTH0_MGMT_CLIENT_ID || env.AUTH0_CLIENT_ID;
const mgmtSecret = env.AUTH0_MGMT_CLIENT_SECRET || env.AUTH0_CLIENT_SECRET;
const tokRes = await fetch(`https://${domain}/oauth/token`, {
  method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({
    client_id: mgmtId, client_secret: mgmtSecret,
    audience: `https://${domain}/api/v2/`, grant_type: "client_credentials",
  }),
});
const tokJson = await tokRes.json();
if (!tokRes.ok) { console.error("MGMT TOKEN FAIL", tokRes.status, JSON.stringify(tokJson)); process.exit(1); }
const token = tokJson.access_token;
const authH = { authorization: `Bearer ${token}` };
console.log("✅ mgmt token acquired");

// 2) Find a Database (auth0 strategy) connection
const connRes = await fetch(`https://${domain}/api/v2/connections?strategy=auth0&fields=name,strategy`, { headers: authH });
const conns = await connRes.json();
if (!connRes.ok || !Array.isArray(conns) || conns.length === 0) {
  console.error("No Database connection available:", connRes.status, JSON.stringify(conns)); process.exit(1);
}
const connection = conns.find((c) => c.name === "Username-Password-Authentication")?.name || conns[0].name;
console.log("✅ using Auth0 DB connection:", connection);

// 3) Create (or find existing) Auth0 user
let auth0Id = null;
const createRes = await fetch(`https://${domain}/api/v2/users`, {
  method: "POST", headers: { ...authH, "content-type": "application/json" },
  body: JSON.stringify({
    email, password, connection,
    email_verified: true, verify_email: false,
    name: "JYTech Sandbox", user_metadata: { sandbox: true, readonly: true },
  }),
});
const createJson = await createRes.json();
if (createRes.ok) {
  auth0Id = createJson.user_id;
  console.log("✅ Auth0 user created:", auth0Id);
} else if (createRes.status === 409) {
  console.log("ℹ️  Auth0 user already exists — updating password");
  const lookup = await fetch(`https://${domain}/api/v2/users-by-email?email=${encodeURIComponent(email)}`, { headers: authH });
  const existing = await lookup.json();
  auth0Id = existing[0]?.user_id;
  if (auth0Id) {
    const upd = await fetch(`https://${domain}/api/v2/users/${encodeURIComponent(auth0Id)}`, {
      method: "PATCH", headers: { ...authH, "content-type": "application/json" },
      body: JSON.stringify({ password, connection }),
    });
    console.log(upd.ok ? "✅ password reset on existing user" : `⚠️ password update failed ${upd.status} ${JSON.stringify(await upd.json())}`);
  }
} else {
  console.error("Auth0 create FAIL", createRes.status, JSON.stringify(createJson)); process.exit(1);
}

// 4) DB seed: users row (non-admin) + viewer member of org
const sql = neon(env.DATABASE_URL);
const [user] = await sql`
  INSERT INTO users (email, name, plan, role, auth0_id)
  VALUES (${email}, 'JYTech Sandbox', 'starter', 'user', ${auth0Id})
  ON CONFLICT (email) DO UPDATE SET auth0_id = EXCLUDED.auth0_id, name = 'JYTech Sandbox'
  RETURNING id, email, plan, role
`;
console.log("✅ db user:", JSON.stringify(user));

const [org] = await sql`SELECT id, name FROM organizations WHERE name ILIKE ${"%" + orgName + "%"} ORDER BY id LIMIT 1`;
if (!org) { console.error(`❌ org "${orgName}" not found — no membership granted`); process.exit(1); }
const [mem] = await sql`
  INSERT INTO organization_members (org_id, user_id, role)
  VALUES (${org.id}, ${user.id}, 'viewer')
  ON CONFLICT (org_id, user_id) DO UPDATE SET role = 'viewer'
  RETURNING org_id, user_id, role
`;
console.log("✅ membership:", JSON.stringify(mem), "→ org:", org.name);
console.log(`\n🎉 Sandbox ready: ${email} = read-only 'viewer' of "${org.name}" (org ${org.id}).`);
