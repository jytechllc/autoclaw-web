import { NextResponse } from "next/server";
import { auth0 } from "@/lib/auth0";
import { getDb } from "@/lib/db";
import { decrypt } from "@/lib/crypto";

export const dynamic = "force-dynamic";

interface ServiceQuota {
  service: string;
  scope: "org" | "personal";
  configured: boolean;
  used?: number;
  limit?: number;
  remaining?: number;
  plan?: string;
  resetDate?: string;
  error?: string;
  exceeded?: boolean;
}

async function checkHunter(apiKey: string): Promise<Omit<ServiceQuota, "scope">> {
  try {
    const res = await fetch(`https://api.hunter.io/v2/account?api_key=${apiKey}`);
    if (!res.ok) return { service: "hunter", configured: true, error: `HTTP ${res.status}` };
    const data = await res.json();
    const d = data.data;
    const used = d?.requests?.searches?.used ?? 0;
    const limit = d?.requests?.searches?.available ?? 0;
    const remaining = limit - used;
    return {
      service: "hunter",
      configured: true,
      used, limit, remaining,
      exceeded: limit > 0 && remaining <= 0,
      plan: d?.plan_name || "free",
      resetDate: d?.reset_date || undefined,
    };
  } catch (e) {
    return { service: "hunter", configured: true, error: String(e) };
  }
}

async function checkApollo(apiKey: string): Promise<Omit<ServiceQuota, "scope">> {
  try {
    const res = await fetch("https://api.apollo.io/api/v1/auth/health", {
      headers: { "X-Api-Key": apiKey, "Content-Type": "application/json" },
    });
    if (!res.ok) return { service: "apollo", configured: true, error: `HTTP ${res.status}` };
    const data = await res.json();
    const used = data.credits_used ?? undefined;
    const limit = data.credits_limit ?? undefined;
    const remaining = data.credits_remaining ?? undefined;
    return {
      service: "apollo",
      configured: true,
      used, limit, remaining,
      exceeded: remaining != null && remaining <= 0,
      plan: data.plan?.name || undefined,
    };
  } catch (e) {
    return { service: "apollo", configured: true, error: String(e) };
  }
}

async function checkSnov(snovId: string, snovSecret: string): Promise<Omit<ServiceQuota, "scope">> {
  try {
    const tokenRes = await fetch("https://api.snov.io/v1/oauth/access_token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ grant_type: "client_credentials", client_id: snovId, client_secret: snovSecret }),
    });
    if (!tokenRes.ok) return { service: "snov", configured: true, error: `Auth failed: HTTP ${tokenRes.status}` };
    const tokenData = await tokenRes.json();
    const token = tokenData.access_token;
    if (!token) return { service: "snov", configured: true, error: "No access token" };

    const res = await fetch(`https://api.snov.io/v1/get-balance?access_token=${token}`);
    if (!res.ok) return { service: "snov", configured: true, error: `HTTP ${res.status}` };
    const data = await res.json();
    const used = data.credits_used ?? undefined;
    const limit = data.credits ?? undefined;
    const remaining = (limit ?? 0) - (used ?? 0);
    return {
      service: "snov",
      configured: true,
      used, limit, remaining,
      exceeded: limit != null && remaining <= 0,
      plan: data.plan || undefined,
    };
  } catch (e) {
    return { service: "snov", configured: true, error: String(e) };
  }
}

async function checkApify(apiToken: string): Promise<Omit<ServiceQuota, "scope">> {
  try {
    const res = await fetch(`https://api.apify.com/v2/users/me?token=${apiToken}`);
    if (!res.ok) return { service: "apify", configured: true, error: `HTTP ${res.status}` };
    const data = await res.json();
    const d = data.data;
    const plan = d?.plan;
    const usage = d?.usage;
    const usedCents = usage?.monthlyUsageUsd ? Math.round(usage.monthlyUsageUsd * 100) : undefined;
    const limitCents = plan?.monthlyUsageLimitUsd ? Math.round(plan.monthlyUsageLimitUsd * 100) : undefined;
    const remainingCents = limitCents != null && usedCents != null ? limitCents - usedCents : undefined;
    return {
      service: "apify",
      configured: true,
      used: usedCents, limit: limitCents, remaining: remainingCents,
      exceeded: remainingCents != null && remainingCents <= 0,
      plan: plan?.name || undefined,
    };
  } catch (e) {
    return { service: "apify", configured: true, error: String(e) };
  }
}

type CheckFn = (...args: string[]) => Promise<Omit<ServiceQuota, "scope">>;

/** Queue a check, tagging result with scope */
function enqueue(
  checks: Promise<void>[],
  list: ServiceQuota[],
  scope: "org" | "personal",
  fn: CheckFn,
  ...keys: string[]
) {
  checks.push(fn(...keys).then((q) => { list.push({ ...q, scope }); }));
}

export async function GET() {
  try {
    const session = await auth0.getSession();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const sql = getDb();
    const email = session.user.email as string;
    const users = await sql`SELECT id FROM users WHERE email = ${email}`;
    if (users.length === 0) {
      return NextResponse.json({ org: [], personal: [] });
    }
    const userId = users[0].id as number;

    // Fetch user's personal BYOK keys
    const byokRows = await sql`
      SELECT service, api_key, CASE WHEN user_id = ${userId} THEN 'personal' ELSE 'org' END as source
      FROM user_api_keys
      WHERE service IN ('apify', 'hunter', 'apollo', 'snov_id', 'snov_secret')
      AND (user_id = ${userId} OR user_id IN (
        SELECT om2.user_id FROM organization_members om1
        JOIN organization_members om2 ON om1.org_id = om2.org_id
        WHERE om1.user_id = ${userId} AND om2.role = 'admin'
      ))
      ORDER BY service, CASE WHEN user_id = ${userId} THEN 0 ELSE 1 END
    `;

    const personalKeys: Record<string, string> = {};
    const orgKeys: Record<string, string> = {};
    for (const row of byokRows) {
      const svc = row.service as string;
      const src = row.source as string;
      try {
        const key = decrypt(row.api_key as string);
        if (src === "personal" && !personalKeys[svc]) personalKeys[svc] = key;
        else if (src === "org" && !orgKeys[svc]) orgKeys[svc] = key;
      } catch { /* skip */ }
    }

    // Org-level keys: env vars or org-admin BYOK
    const orgHunter = process.env.HUNTER_API_KEY || orgKeys.hunter;
    const orgApollo = process.env.APOLLO_API_KEY || orgKeys.apollo;
    const orgSnovId = process.env.SNOV_API_ID || orgKeys.snov_id;
    const orgSnovSecret = process.env.SNOV_API_SECRET || orgKeys.snov_secret;
    const orgApify = process.env.APIFY_API_TOKEN || orgKeys.apify;

    // Personal-level: user's own BYOK keys (what the user actually uses at runtime)
    // Runtime priority: personal BYOK > env var (same as chat route)
    const myHunter = personalKeys.hunter || orgHunter;
    const myApollo = personalKeys.apollo || orgApollo;
    const mySnovId = personalKeys.snov_id || orgSnovId;
    const mySnovSecret = personalKeys.snov_secret || orgSnovSecret;
    const myApify = personalKeys.apify || orgApify;

    const orgServices: ServiceQuota[] = [];
    const personalServices: ServiceQuota[] = [];
    const checks: Promise<void>[] = [];

    // --- Org checks (env vars only — platform-level keys) ---
    const envHunter = process.env.HUNTER_API_KEY;
    const envApollo = process.env.APOLLO_API_KEY;
    const envSnovId = process.env.SNOV_API_ID;
    const envSnovSecret = process.env.SNOV_API_SECRET;
    const envApify = process.env.APIFY_API_TOKEN;

    if (envHunter) enqueue(checks, orgServices, "org", checkHunter, envHunter);
    else orgServices.push({ service: "hunter", scope: "org", configured: false });

    if (envApollo) enqueue(checks, orgServices, "org", checkApollo, envApollo);
    else orgServices.push({ service: "apollo", scope: "org", configured: false });

    if (envSnovId && envSnovSecret) enqueue(checks, orgServices, "org", checkSnov, envSnovId, envSnovSecret);
    else orgServices.push({ service: "snov", scope: "org", configured: false });

    if (envApify) enqueue(checks, orgServices, "org", checkApify, envApify);
    else orgServices.push({ service: "apify", scope: "org", configured: false });

    // --- Personal checks (what the user actually uses — BYOK overrides env) ---
    if (myHunter) enqueue(checks, personalServices, "personal", checkHunter, myHunter);
    else personalServices.push({ service: "hunter", scope: "personal", configured: false });

    if (myApollo) enqueue(checks, personalServices, "personal", checkApollo, myApollo);
    else personalServices.push({ service: "apollo", scope: "personal", configured: false });

    if (mySnovId && mySnovSecret) enqueue(checks, personalServices, "personal", checkSnov, mySnovId, mySnovSecret);
    else personalServices.push({ service: "snov", scope: "personal", configured: false });

    if (myApify) enqueue(checks, personalServices, "personal", checkApify, myApify);
    else personalServices.push({ service: "apify", scope: "personal", configured: false });

    await Promise.all(checks);

    const order = ["hunter", "apollo", "snov", "apify"];
    const sort = (a: ServiceQuota, b: ServiceQuota) => order.indexOf(a.service) - order.indexOf(b.service);
    orgServices.sort(sort);
    personalServices.sort(sort);

    return NextResponse.json({ org: orgServices, personal: personalServices });
  } catch (err) {
    console.error("[GET /api/enrichment-quota]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
