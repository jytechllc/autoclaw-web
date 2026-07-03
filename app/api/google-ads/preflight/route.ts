import { NextRequest, NextResponse } from "next/server";
import { auth0 } from "@/lib/auth0";
import { getDb } from "@/lib/db";
import { checkRateLimit } from "@/lib/rate-limit";
import { adsSearchStream } from "@/lib/google-ads";
import {
  checkEnvVars,
  checkCustomer,
  checkBilling,
  checkConversions,
  checkLedger,
  checkAiProviders,
  summarizePreflight,
  REQUIRED_ADS_ENV,
  OPTIONAL_ADS_ENV,
  type PreflightCheck,
} from "@/lib/google-ads-preflight";

export const dynamic = "force-dynamic";

function getIp(req: NextRequest): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}

const AI_PROVIDER_ENVS = ["CEREBRAS_API_KEY", "NVIDIA_API_KEY", "GOOGLE_AI_API", "OPENROUTER_API_KEY", "XPILOT_API_KEY", "AWS_ACCESS_KEY_ID"];

/**
 * GET — automated launch preflight. Runs the machine-checkable subset of
 * docs/google-ads-launch-checklist.md: env completeness, API connectivity,
 * account kind, billing, conversion inventory, ledger invariants, AI keys.
 * Read-only everywhere; human-eyes items stay in the manual checklist.
 */
export async function GET(req: NextRequest) {
  if (!checkRateLimit(getIp(req), { limit: 10, windowMs: 60_000 })) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }
  const session = await auth0.getSession();
  if (!session?.user?.email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const checks: PreflightCheck[] = [];

  // 1. Env completeness (never echo values — names only).
  const present = new Set(
    [...REQUIRED_ADS_ENV, ...OPTIONAL_ADS_ENV].filter((k) => Boolean(process.env[k] && String(process.env[k]).trim()))
  );
  checks.push(...checkEnvVars(present));

  const customerId = process.env.GOOGLE_ADS_CUSTOMER_ID;

  // 2. API connectivity + account kind.
  if (customerId) {
    try {
      type Row = { customer: { descriptiveName?: string; currencyCode?: string; manager?: boolean; testAccount?: boolean } };
      const rows = await adsSearchStream(customerId, `
        SELECT customer.descriptive_name, customer.currency_code, customer.manager, customer.test_account
        FROM customer LIMIT 1
      `) as Row[];
      const c = rows[0]?.customer;
      checks.push(...checkCustomer({
        ok: Boolean(c),
        error: c ? undefined : "Customer query returned no rows",
        descriptiveName: c?.descriptiveName,
        currencyCode: c?.currencyCode,
        manager: c?.manager,
        testAccount: c?.testAccount,
      }));
    } catch (e) {
      checks.push(...checkCustomer({ ok: false, error: e instanceof Error ? e.message : String(e) }));
    }

    // 3. Billing.
    try {
      type BRow = { billingSetup: { status?: string } };
      const rows = await adsSearchStream(customerId, `
        SELECT billing_setup.status FROM billing_setup
      `) as BRow[];
      checks.push(checkBilling({ ok: true, statuses: rows.map((r) => r.billingSetup.status || "UNKNOWN") }));
    } catch (e) {
      checks.push(checkBilling({ ok: false, error: e instanceof Error ? e.message : String(e), statuses: [] }));
    }

    // 4. Conversion actions.
    try {
      type CRow = { conversionAction: { status?: string } };
      const rows = await adsSearchStream(customerId, `
        SELECT conversion_action.status FROM conversion_action
        WHERE conversion_action.status = 'ENABLED'
      `) as CRow[];
      checks.push(checkConversions({ ok: true, enabledCount: rows.length }));
    } catch (e) {
      checks.push(checkConversions({ ok: false, error: e instanceof Error ? e.message : String(e), enabledCount: 0 }));
    }
  } else {
    checks.push(...checkCustomer({ ok: false, error: "GOOGLE_ADS_CUSTOMER_ID not set" }));
  }

  // 5. Ledger invariants (DB, read-only).
  try {
    const sql = getDb();
    const rows = await sql`
      SELECT
        COUNT(*)::int AS orgs,
        COUNT(*) FILTER (WHERE balance_cents < 0)::int AS neg_balance,
        COUNT(*) FILTER (WHERE reserved_cents < 0)::int AS neg_reserved
      FROM ad_credits
    `;
    checks.push(checkLedger({
      ok: true,
      orgs: Number(rows[0]?.orgs || 0),
      negativeBalances: Number(rows[0]?.neg_balance || 0),
      negativeReserved: Number(rows[0]?.neg_reserved || 0),
    }));
  } catch (e) {
    checks.push(checkLedger({ ok: false, error: e instanceof Error ? e.message : String(e), negativeBalances: 0, negativeReserved: 0, orgs: 0 }));
  }

  // 6. AI provider chain.
  const providerCount = AI_PROVIDER_ENVS.filter((k) => Boolean(process.env[k] && String(process.env[k]).trim())).length;
  checks.push(checkAiProviders(providerCount));

  return NextResponse.json({
    success: true,
    summary: summarizePreflight(checks),
    checks,
    manualChecklist: "docs/google-ads-launch-checklist.md",
    timestamp: new Date().toISOString(),
  });
}
