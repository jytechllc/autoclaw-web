#!/usr/bin/env node
/**
 * Grant a user: enterprise plan + global super-admin (role='admin') + owner of
 * an organization. Idempotent. Reviewable alternative to ad-hoc SQL.
 *
 * Verified values (lib/db.ts PLAN_RANK + app role checks):
 *   plan 'enterprise' = top tier;  global super-admin = users.role 'admin';
 *   org top role = organization_members.role 'owner'.
 *
 * Usage:
 *   node scripts/grant-enterprise-admin.mjs <email> [orgName]
 *   # defaults: orgName="JYTech"
 * Env: DATABASE_URL (prod Neon). NOTE: this is a privileged production write.
 */
import { neon } from "@neondatabase/serverless";
import { readFileSync } from "fs";

const email = process.argv[2] || "panpanpan3898@gmail.com";
const orgName = process.argv[3] || "JYTech";

// Self-load DATABASE_URL from .env.local / .env so the run command is a single
// clean `node scripts/grant-enterprise-admin.mjs` (no shell env-sourcing).
if (!process.env.DATABASE_URL) {
  for (const f of [".env.local", ".env"]) {
    try {
      const m = readFileSync(f, "utf8").match(/^DATABASE_URL=(.*)$/m);
      if (m) { process.env.DATABASE_URL = m[1].replace(/^["']|["']$/g, "").trim(); break; }
    } catch { /* next */ }
  }
}
if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL not found in env or .env.local/.env");
  process.exit(1);
}
const sql = neon(process.env.DATABASE_URL);

// Read-only search:  node scripts/grant-enterprise-admin.mjs --find <term>
if (process.argv[2] === "--find") {
  const term = `%${process.argv[3] || ""}%`;
  const orgs = await sql`SELECT id, name, plan, domain FROM organizations WHERE name ILIKE ${term} OR domain ILIKE ${term}`;
  const users = await sql`SELECT id, email, plan, role FROM users WHERE email ILIKE ${term}`;
  console.log("组织(orgs):", orgs.length ? JSON.stringify(orgs, null, 2) : "无匹配");
  console.log("用户(users):", users.length ? JSON.stringify(users, null, 2) : "无匹配");
  process.exit(0);
}

// Read-only check:  node scripts/grant-enterprise-admin.mjs --check <email>
if (process.argv[2] === "--check") {
  const target = process.argv[3];
  const [u] = await sql`SELECT id, email, plan, role, auth0_id FROM users WHERE email = ${target}`;
  if (!u) { console.log(`${target}: 用户不存在`); process.exit(0); }
  const mems = await sql`
    SELECT om.role AS org_role, o.name AS org_name, o.plan AS org_plan
    FROM organization_members om JOIN organizations o ON o.id = om.org_id
    WHERE om.user_id = ${u.id}`;
  const isSuperAdmin = u.role === "admin";
  console.log(`${target}:`);
  console.log(`  plan=${u.plan}  role=${u.role}  auth0=${u.auth0_id ? "已绑定" : "未登录绑定"}`);
  console.log(`  全局总管理员(role='admin')? ${isSuperAdmin ? "✅ 是" : "❌ 否"}`);
  console.log(`  组织成员:`, mems.length ? JSON.stringify(mems) : "无");
  process.exit(0);
}

// 1) Upsert user → enterprise + global super-admin
const [user] = await sql`
  INSERT INTO users (email, plan, role)
  VALUES (${email}, 'enterprise', 'admin')
  ON CONFLICT (email) DO UPDATE SET plan = 'enterprise', role = 'admin'
  RETURNING id, email, plan, role, auth0_id
`;
console.log("user:", JSON.stringify(user));

// 2) Ensure org exists + is enterprise
let [org] = await sql`SELECT id, name, plan FROM organizations WHERE name ILIKE ${"%" + orgName + "%"} LIMIT 1`;
if (!org) {
  [org] = await sql`INSERT INTO organizations (name, plan) VALUES (${orgName}, 'enterprise') RETURNING id, name, plan`;
  console.log("org created:", JSON.stringify(org));
} else {
  [org] = await sql`UPDATE organizations SET plan = 'enterprise' WHERE id = ${org.id} RETURNING id, name, plan`;
  console.log("org updated:", JSON.stringify(org));
}

// 3) Add user as ADMIN of the org (org-level top role is 'admin', not 'owner')
const [mem] = await sql`
  INSERT INTO organization_members (org_id, user_id, role)
  VALUES (${org.id}, ${user.id}, 'admin')
  ON CONFLICT (org_id, user_id) DO UPDATE SET role = 'admin'
  RETURNING org_id, user_id, role
`;
console.log("membership:", JSON.stringify(mem));

console.log(`\n✅ ${email}: plan=enterprise, role=admin (global), org-admin of "${org.name}" (org ${org.id}).`);
console.log("提醒: 该用户需用此邮箱通过 Auth0 登录一次以绑定 auth0_id。");
