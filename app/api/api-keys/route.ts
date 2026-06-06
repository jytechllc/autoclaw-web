import { NextRequest, NextResponse } from "next/server";
import { auth0 } from "@/lib/auth0";
import { getDb } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { checkRateLimit } from "@/lib/rate-limit";
import { encrypt, decrypt, maskKey } from "@/lib/crypto";
import { createHash, randomBytes } from "crypto";
import { apiKeyActionSchema, parseOrError } from "@/lib/validations";
import { isReadOnlyUserId } from "@/lib/roles-server";

export const dynamic = "force-dynamic";

function getIp(req: NextRequest): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}

async function ensureApiKeysTable() {
  const sql = getDb();
  await sql`
    CREATE TABLE IF NOT EXISTS api_keys (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      key_hash VARCHAR(64) NOT NULL,
      key_prefix VARCHAR(10) NOT NULL,
      name VARCHAR(255),
      scopes TEXT[] DEFAULT '{"read"}',
      last_used_at TIMESTAMP,
      expires_at TIMESTAMP,
      created_at TIMESTAMP DEFAULT NOW(),
      revoked_at TIMESTAMP
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS idx_api_keys_user ON api_keys(user_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_api_keys_hash ON api_keys(key_hash)`;
}

export async function GET(req: NextRequest) {
  const ip = getIp(req);
  if (!checkRateLimit(ip, { limit: 30, windowMs: 60_000 })) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  const session = await auth0.getSession();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sql = getDb();
  const email = session.user.email as string;

  const users = await sql`SELECT id FROM users WHERE email = ${email}`;
  if (users.length === 0) {
    return NextResponse.json({ keys: [], platformKeys: [] });
  }

  const userId = users[0].id;
  // Read-only (sandbox/viewer) accounts have no API-keys view permission.
  if (await isReadOnlyUserId(sql, userId as number)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Existing service keys (user_api_keys table)
  const rawKeys = await sql`
    SELECT id, service, label, api_key, updated_at
    FROM user_api_keys
    WHERE user_id = ${userId}
    ORDER BY service ASC
  `;
  const keys = rawKeys.map((k) => {
    let masked_key = "****";
    try {
      masked_key = maskKey(decrypt(k.api_key as string));
    } catch {
      // Legacy plaintext key — mask directly
      const raw = k.api_key as string;
      masked_key = maskKey(raw);
    }
    return { id: k.id, service: k.service, label: k.label, masked_key, updated_at: k.updated_at };
  });

  // Platform API keys (api_keys table)
  await ensureApiKeysTable();
  const platformKeys = await sql`
    SELECT id, key_prefix, name, scopes, last_used_at, expires_at, created_at, revoked_at
    FROM api_keys
    WHERE user_id = ${userId}
    ORDER BY created_at DESC
  `;

  // Org-level keys: ensure table exists, then fetch for orgs user is admin/operator of
  await sql`
    CREATE TABLE IF NOT EXISTS org_api_keys (
      id SERIAL PRIMARY KEY,
      org_id INTEGER REFERENCES organizations(id) ON DELETE CASCADE,
      service VARCHAR(50) NOT NULL,
      api_key TEXT NOT NULL,
      label VARCHAR(255),
      created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW(),
      UNIQUE(org_id, service)
    )
  `;
  const orgKeys = await sql`
    SELECT ok.id, ok.org_id, ok.service, ok.label, ok.api_key, ok.updated_at, o.name as org_name
    FROM org_api_keys ok
    JOIN organizations o ON ok.org_id = o.id
    JOIN organization_members om ON om.org_id = o.id AND om.user_id = ${userId}
    WHERE om.role IN ('admin', 'operator')
    ORDER BY o.name, ok.service
  `;
  const orgKeysFormatted = orgKeys.map((k) => {
    let masked_key = "****";
    try {
      masked_key = maskKey(decrypt(k.api_key as string));
    } catch {
      masked_key = maskKey(k.api_key as string);
    }
    return { id: k.id, org_id: k.org_id, org_name: k.org_name, service: k.service, label: k.label, masked_key, updated_at: k.updated_at };
  });

  return NextResponse.json({ keys, platformKeys, orgKeys: orgKeysFormatted });
}

export async function POST(req: NextRequest) {
  const ip = getIp(req);
  if (!checkRateLimit(ip, { limit: 20, windowMs: 60_000 })) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  const session = await auth0.getSession();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sql = getDb();
  const email = session.user.email as string;

  const users = await sql`SELECT id FROM users WHERE email = ${email}`;
  if (users.length === 0) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = users[0].id;
  // Read-only (sandbox/viewer) accounts cannot manage API keys.
  if (await isReadOnlyUserId(sql, userId as number)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const contentType = req.headers.get("content-type");
  if (!contentType?.includes("application/json")) {
    return NextResponse.json({ error: "Content-Type must be application/json" }, { status: 415 });
  }

  const body = await req.json();

  const parsed = parseOrError(apiKeyActionSchema, body);
  if ("error" in parsed) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }
  const { action } = parsed.data;

  // --- Existing service key actions ---

  if (action === "upsert") {
    const { service, api_key, label } = parsed.data as { service: string; api_key: string; label?: string | null; action: string };

    const encryptedKey = encrypt(api_key.trim());

    await sql`
      INSERT INTO user_api_keys (user_id, service, api_key, label, updated_at)
      VALUES (${userId}, ${service}, ${encryptedKey}, ${label || null}, NOW())
      ON CONFLICT (user_id, service)
      DO UPDATE SET api_key = ${encryptedKey}, label = ${label || null}, updated_at = NOW()
    `;

    logAudit({
      userId,
      userEmail: email,
      action: "apikey.upsert",
      resourceType: "api_key",
      resourceId: null as unknown as number,
      details: { service },
      ipAddress: ip,
    });

    return NextResponse.json({ message: "API key saved" });
  }

  if (action === "reveal") {
    const { service } = parsed.data as { service: string; action: string };

    const rows = await sql`
      SELECT api_key FROM user_api_keys WHERE user_id = ${userId} AND service = ${service} LIMIT 1
    `;
    if (rows.length === 0) {
      return NextResponse.json({ error: "Key not found" }, { status: 404 });
    }

    let plainKey: string;
    try {
      plainKey = decrypt(rows[0].api_key as string);
    } catch {
      plainKey = rows[0].api_key as string;
    }

    logAudit({
      userId,
      userEmail: email,
      action: "apikey.reveal",
      resourceType: "api_key",
      resourceId: null as unknown as number,
      details: { service },
      ipAddress: ip,
    });

    return NextResponse.json({ api_key: plainKey });
  }

  if (action === "delete") {
    const { service } = parsed.data as { service: string; action: string };

    await sql`DELETE FROM user_api_keys WHERE user_id = ${userId} AND service = ${service}`;

    logAudit({
      userId,
      userEmail: email,
      action: "apikey.delete",
      resourceType: "api_key",
      resourceId: null as unknown as number,
      details: { service },
      ipAddress: ip,
    });

    return NextResponse.json({ message: "API key deleted" });
  }

  // --- Platform API key actions (api_keys table) ---

  if (action === "create") {
    await ensureApiKeysTable();

    const { name, scopes, expires_at } = parsed.data as { name?: string | null; scopes?: string[]; expires_at?: string | null; action: string };
    const keyScopes: string[] = Array.isArray(scopes) ? scopes : ["read"];

    // Generate key: ac_live_ + 32 random hex chars
    const rawKey = "ac_live_" + randomBytes(16).toString("hex");
    const keyHash = createHash("sha256").update(rawKey).digest("hex");
    const keyPrefix = rawKey.substring(0, 10);

    const expiresAt = expires_at ? new Date(expires_at) : null;

    const inserted = await sql`
      INSERT INTO api_keys (user_id, key_hash, key_prefix, name, scopes, expires_at)
      VALUES (${userId}, ${keyHash}, ${keyPrefix}, ${name || null}, ${keyScopes}, ${expiresAt})
      RETURNING id, key_prefix, name, scopes, expires_at, created_at
    `;

    logAudit({
      userId,
      userEmail: email,
      action: "platform_apikey.create",
      resourceType: "api_key",
      resourceId: inserted[0].id as number,
      details: { key_prefix: keyPrefix, scopes: keyScopes },
      ipAddress: ip,
    });

    // Return the full key ONCE - it cannot be retrieved again
    return NextResponse.json({
      key: rawKey,
      ...inserted[0],
    });
  }

  if (action === "revoke") {
    await ensureApiKeysTable();

    const { key_id } = parsed.data as { key_id: number; action: string };

    const existing = await sql`
      SELECT id FROM api_keys WHERE id = ${key_id} AND user_id = ${userId} AND revoked_at IS NULL
    `;
    if (existing.length === 0) {
      return NextResponse.json({ error: "Key not found or already revoked" }, { status: 404 });
    }

    await sql`UPDATE api_keys SET revoked_at = NOW() WHERE id = ${key_id}`;

    logAudit({
      userId,
      userEmail: email,
      action: "platform_apikey.revoke",
      resourceType: "api_key",
      resourceId: key_id,
      details: {},
      ipAddress: ip,
    });

    return NextResponse.json({ message: "API key revoked" });
  }

  // --- Org-level API key actions ---

  async function ensureOrgApiKeysTable() {
    await sql`
      CREATE TABLE IF NOT EXISTS org_api_keys (
        id SERIAL PRIMARY KEY,
        org_id INTEGER REFERENCES organizations(id) ON DELETE CASCADE,
        service VARCHAR(50) NOT NULL,
        api_key TEXT NOT NULL,
        label VARCHAR(255),
        created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(org_id, service)
      )
    `;
    await sql`CREATE INDEX IF NOT EXISTS idx_org_api_keys_org ON org_api_keys(org_id)`;
  }

  if (action === "org_upsert") {
    await ensureOrgApiKeysTable();
    const { org_id, service, api_key, label } = body;
    if (!org_id || !service || !api_key) {
      return NextResponse.json({ error: "org_id, service, and api_key required" }, { status: 400 });
    }

    // Verify user is admin/operator of this org
    const membership = await sql`SELECT role FROM organization_members WHERE org_id = ${org_id} AND user_id = ${userId}`;
    if (membership.length === 0 || !["admin", "operator"].includes(membership[0].role as string)) {
      return NextResponse.json({ error: "Only org admins or operators can manage org API keys" }, { status: 403 });
    }

    const encryptedKey = encrypt(api_key.trim());
    await sql`
      INSERT INTO org_api_keys (org_id, service, api_key, label, created_by, updated_at)
      VALUES (${org_id}, ${service}, ${encryptedKey}, ${label || null}, ${userId}, NOW())
      ON CONFLICT (org_id, service)
      DO UPDATE SET api_key = ${encryptedKey}, label = ${label || null}, updated_at = NOW()
    `;

    logAudit({ userId, userEmail: email, action: "org_apikey.upsert", resourceType: "org_api_key", resourceId: org_id, details: { service }, ipAddress: ip });
    return NextResponse.json({ message: "Org API key saved" });
  }

  if (action === "org_reveal") {
    await ensureOrgApiKeysTable();
    const { org_id, service } = body;
    if (!org_id || !service) {
      return NextResponse.json({ error: "org_id and service required" }, { status: 400 });
    }

    const membership = await sql`SELECT role FROM organization_members WHERE org_id = ${org_id} AND user_id = ${userId}`;
    if (membership.length === 0 || !["admin", "operator"].includes(membership[0].role as string)) {
      return NextResponse.json({ error: "Only org admins or operators can reveal org API keys" }, { status: 403 });
    }

    const rows = await sql`SELECT api_key FROM org_api_keys WHERE org_id = ${org_id} AND service = ${service} LIMIT 1`;
    if (rows.length === 0) {
      return NextResponse.json({ error: "Key not found" }, { status: 404 });
    }

    let plainKey: string;
    try { plainKey = decrypt(rows[0].api_key as string); } catch { plainKey = rows[0].api_key as string; }

    logAudit({ userId, userEmail: email, action: "org_apikey.reveal", resourceType: "org_api_key", resourceId: org_id, details: { service }, ipAddress: ip });
    return NextResponse.json({ api_key: plainKey });
  }

  if (action === "org_delete") {
    await ensureOrgApiKeysTable();
    const { org_id, service } = body;
    if (!org_id || !service) {
      return NextResponse.json({ error: "org_id and service required" }, { status: 400 });
    }

    const membership = await sql`SELECT role FROM organization_members WHERE org_id = ${org_id} AND user_id = ${userId}`;
    if (membership.length === 0 || !["admin", "operator"].includes(membership[0].role as string)) {
      return NextResponse.json({ error: "Only org admins or operators can delete org API keys" }, { status: 403 });
    }

    await sql`DELETE FROM org_api_keys WHERE org_id = ${org_id} AND service = ${service}`;

    logAudit({ userId, userEmail: email, action: "org_apikey.delete", resourceType: "org_api_key", resourceId: org_id, details: { service }, ipAddress: ip });
    return NextResponse.json({ message: "Org API key deleted" });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
