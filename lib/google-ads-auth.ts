// Shared request-auth helpers for the Google Ads API routes.
//
// Every route under app/api/google-ads/ used to open with the same ~20 lines:
// getIp → checkRateLimit → auth0.getSession → users lookup → resolveOrgId
// (audit D-5). These helpers collapse that into one call with two tiers:
//
//   requireSession — rate limit + login. For routes that only proxy the shared
//                    Google Ads account and read no org data (geo-targets,
//                    diagnose, ad-copy/generate).
//   requireOrg     — requireSession + users row + resolveOrgId. For everything
//                    that touches campaigns / credits / org-scoped tables.
//
// Both return a discriminated union: check `if ("response" in auth)` and
// return the ready-made NextResponse on failure. Routes with bespoke behavior
// (e.g. campaigns GET returns an empty list instead of 401) can keep their
// own flow — this is a convenience, not a straitjacket.

import { NextRequest, NextResponse } from "next/server";
import { auth0 } from "@/lib/auth0";
import { getDb } from "@/lib/db";
import { checkRateLimit } from "@/lib/rate-limit";
import { resolveOrgId } from "@/lib/credits";

export function getIp(req: NextRequest): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}

export interface SessionAuth {
  ip: string;
  userEmail: string;
}

export interface OrgAuth extends SessionAuth {
  sql: ReturnType<typeof getDb>;
  userId: number;
  orgId: number;
}

export type AuthFailure = { response: NextResponse };

interface AuthOptions {
  /** Requests per window per IP. */
  limit: number;
  /** Window in ms; defaults to one minute like every existing route. */
  windowMs?: number;
}

export async function requireSession(
  req: NextRequest,
  opts: AuthOptions,
): Promise<SessionAuth | AuthFailure> {
  const ip = getIp(req);
  if (!checkRateLimit(ip, { limit: opts.limit, windowMs: opts.windowMs ?? 60_000 })) {
    return { response: NextResponse.json({ error: "Too many requests" }, { status: 429 }) };
  }
  const session = await auth0.getSession();
  if (!session?.user?.email) {
    return { response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  return { ip, userEmail: session.user.email as string };
}

export async function requireOrg(
  req: NextRequest,
  opts: AuthOptions & {
    /** Org the caller asked for (query param or body field); undefined = default org. */
    requestedOrgId?: unknown;
  },
): Promise<OrgAuth | AuthFailure> {
  const base = await requireSession(req, opts);
  if ("response" in base) return base;

  const sql = getDb();
  const users = await sql`SELECT id FROM users WHERE email = ${base.userEmail}`;
  if (users.length === 0) {
    return { response: NextResponse.json({ error: "User not found" }, { status: 404 }) };
  }
  const userId = users[0].id as number;

  const requested = opts.requestedOrgId ? Number(opts.requestedOrgId) : undefined;
  const orgId = await resolveOrgId(sql, userId, requested);
  if (!orgId) {
    return {
      response: NextResponse.json(
        { error: requested ? "Forbidden — not a member of that org" : "No organization found" },
        { status: requested ? 403 : 400 },
      ),
    };
  }

  return { ...base, sql, userId, orgId };
}
