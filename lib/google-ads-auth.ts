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
import { isReadOnlyUserId } from "@/lib/roles-server";

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

// ---------------------------------------------------------------------------
// Campaign tier. The campaign-scoped routes repeat an even larger block on
// top of the org tier: read-only gate → campaign ownership lookup → closed
// check. Several files even carry their own near-identical `loadCampaign`.

/** Superset of the campaign columns the routes read — one query fits all. */
export interface AuthedCampaignRow {
  id: number;
  platform_campaign_id: string;
  campaign_name: string;
  channel: string | null;
  daily_budget: number | null;
  currency: string | null;
  status: string | null;
  total_budget_cents: number | null;
  reserved_cents: number | null;
  spent_cents: number | null;
  closed: boolean;
}

export interface CampaignAuth extends OrgAuth {
  campaignId: number;
  campaign: AuthedCampaignRow;
}

export async function requireCampaign(
  req: NextRequest,
  params: Promise<{ id: string }>,
  opts: AuthOptions & {
    requestedOrgId?: unknown;
    /** true → reject read-only (sandbox/viewer) accounts with 403. */
    write?: boolean;
    /** true → skip the 409 on closed campaigns (default: reject). */
    allowClosed?: boolean;
  },
): Promise<CampaignAuth | AuthFailure> {
  const base = await requireOrg(req, opts);
  if ("response" in base) return base;

  if (opts.write && (await isReadOnlyUserId(base.sql, base.userId))) {
    return {
      response: NextResponse.json(
        { error: "Read-only account — writes are disabled" },
        { status: 403 },
      ),
    };
  }

  const { id } = await params;
  const campaignId = Number(id);
  if (!Number.isFinite(campaignId)) {
    return { response: NextResponse.json({ error: "Invalid id" }, { status: 400 }) };
  }

  const rows = await base.sql`
    SELECT id, platform_campaign_id, campaign_name, channel, daily_budget, currency, status,
           total_budget_cents, reserved_cents, spent_cents, closed
    FROM campaigns
    WHERE id = ${campaignId} AND org_id = ${base.orgId} AND platform = 'google'
  `;
  if (rows.length === 0) {
    return { response: NextResponse.json({ error: "Campaign not found" }, { status: 404 }) };
  }
  const campaign = rows[0] as unknown as AuthedCampaignRow;
  if (campaign.closed && !opts.allowClosed) {
    return { response: NextResponse.json({ error: "Campaign is closed" }, { status: 409 }) };
  }

  return { ...base, campaignId, campaign };
}
