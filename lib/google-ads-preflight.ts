// Pure helpers for the launch-preflight endpoint. The route gathers facts
// (env, API probes, DB probes) and calls these to classify + summarize, so
// the grading logic is unit-testable without any I/O.
//
// Relationship to docs/google-ads-launch-checklist.md: this automates the
// machine-checkable subset (connectivity, billing, env completeness, DB
// invariants). Items that need human eyes (watching an ad serve, seeing
// auto-pause fire) stay manual in the checklist.

export type PreflightStatus = "pass" | "warn" | "fail";

export interface PreflightCheck {
  id: string;
  label: string;
  status: PreflightStatus;
  detail: string;
}

/** Required / optional env sets for the Google Ads module. */
export const REQUIRED_ADS_ENV = [
  "GOOGLE_ADS_CLIENT_ID",
  "GOOGLE_ADS_CLIENT_SECRET",
  "GOOGLE_ADS_REFRESH_TOKEN",
  "GOOGLE_ADS_DEVELOPER_TOKEN",
  "GOOGLE_ADS_CUSTOMER_ID",
] as const;

export const OPTIONAL_ADS_ENV = [
  "GOOGLE_ADS_LOGIN_CUSTOMER_ID",
  "CRON_SECRET",
  "BREVO_API_KEY",
  "GOOGLE_ADS_DIGEST_LOCALE",
] as const;

/** Classify env completeness. `present` = names of set variables. */
export function checkEnvVars(present: Set<string>): PreflightCheck[] {
  const checks: PreflightCheck[] = [];
  const missingRequired = REQUIRED_ADS_ENV.filter((k) => !present.has(k));
  checks.push({
    id: "env_required",
    label: "Google Ads API credentials (env)",
    status: missingRequired.length === 0 ? "pass" : "fail",
    detail:
      missingRequired.length === 0
        ? `All ${REQUIRED_ADS_ENV.length} required variables set`
        : `Missing: ${missingRequired.join(", ")}`,
  });
  const missingOptional = OPTIONAL_ADS_ENV.filter((k) => !present.has(k));
  checks.push({
    id: "env_optional",
    label: "Optional env (cron auth, email, MCC login)",
    status: missingOptional.length === 0 ? "pass" : "warn",
    detail:
      missingOptional.length === 0
        ? "All optional variables set"
        : `Not set (features degrade): ${missingOptional.join(", ")}`,
  });
  return checks;
}

/** Grade the customer probe result. */
export function checkCustomer(customer: {
  ok: boolean;
  error?: string;
  descriptiveName?: string;
  currencyCode?: string;
  manager?: boolean;
  testAccount?: boolean;
}): PreflightCheck[] {
  if (!customer.ok) {
    return [{
      id: "api_connectivity",
      label: "API connectivity (customer query)",
      status: "fail",
      detail: customer.error || "Customer query failed",
    }];
  }
  const checks: PreflightCheck[] = [{
    id: "api_connectivity",
    label: "API connectivity (customer query)",
    status: "pass",
    detail: `${customer.descriptiveName || "(unnamed)"} · ${customer.currencyCode || "?"}`,
  }];
  checks.push({
    id: "account_kind",
    label: "Account can serve ads",
    status: customer.manager ? "fail" : customer.testAccount ? "warn" : "pass",
    detail: customer.manager
      ? "This is a MANAGER account — campaigns cannot serve from it. Point GOOGLE_ADS_CUSTOMER_ID at a client account."
      : customer.testAccount
        ? "TEST account — API calls work but ads never serve. Fine for dry-runs; switch before launch."
        : "Regular client account",
  });
  return checks;
}

/** Grade billing setups (from billing_setup GAQL). */
export function checkBilling(billing: { ok: boolean; error?: string; statuses: string[] }): PreflightCheck {
  if (!billing.ok) {
    return {
      id: "billing",
      label: "Billing setup",
      status: "fail",
      detail: billing.error || "billing_setup query failed",
    };
  }
  const approved = billing.statuses.filter((s) => s === "APPROVED").length;
  return {
    id: "billing",
    label: "Billing setup",
    status: approved > 0 ? "pass" : "fail",
    detail: approved > 0
      ? `${approved} approved billing setup(s)`
      : billing.statuses.length > 0
        ? `Setups exist but none APPROVED (${billing.statuses.join(", ")}) — ads cannot spend`
        : "No billing setup — ads cannot spend",
  };
}

/** Grade conversion-action inventory. */
export function checkConversions(conv: { ok: boolean; error?: string; enabledCount: number }): PreflightCheck {
  if (!conv.ok) {
    return { id: "conversions", label: "Conversion tracking", status: "warn", detail: conv.error || "conversion_action query failed" };
  }
  return {
    id: "conversions",
    label: "Conversion tracking",
    status: conv.enabledCount > 0 ? "pass" : "warn",
    detail: conv.enabledCount > 0
      ? `${conv.enabledCount} enabled conversion action(s)`
      : "No enabled conversion actions — Smart Bidding and PMax will underperform; create one in Conversions",
  };
}

/** Grade ad-credits ledger invariants. */
export function checkLedger(ledger: {
  ok: boolean;
  error?: string;
  negativeBalances: number;
  negativeReserved: number;
  orgs: number;
}): PreflightCheck {
  if (!ledger.ok) {
    return { id: "ledger", label: "Ad-credits ledger invariants", status: "fail", detail: ledger.error || "ledger query failed" };
  }
  const bad = ledger.negativeBalances + ledger.negativeReserved;
  return {
    id: "ledger",
    label: "Ad-credits ledger invariants",
    status: bad === 0 ? "pass" : "fail",
    detail: bad === 0
      ? `${ledger.orgs} org ledger(s), no negative balance/reserved`
      : `${ledger.negativeBalances} negative balance(s), ${ledger.negativeReserved} negative reserved — investigate before launch`,
  };
}

/** Grade the AI provider chain (for recommendations / wizard / ad copy). */
export function checkAiProviders(providerCount: number): PreflightCheck {
  return {
    id: "ai_providers",
    label: "AI provider keys",
    status: providerCount > 0 ? (providerCount > 1 ? "pass" : "warn") : "fail",
    detail: providerCount === 0
      ? "No LLM provider keys set — wizard, recommendations, and ad-copy generation will fail"
      : providerCount === 1
        ? "1 provider configured — works, but no fallback if it errors"
        : `${providerCount} providers configured (fallback chain available)`,
  };
}

export interface PreflightSummary {
  status: PreflightStatus;
  pass: number;
  warn: number;
  fail: number;
  total: number;
}

/** Overall grade: any fail → fail; else any warn → warn; else pass. */
export function summarizePreflight(checks: PreflightCheck[]): PreflightSummary {
  const pass = checks.filter((c) => c.status === "pass").length;
  const warn = checks.filter((c) => c.status === "warn").length;
  const fail = checks.filter((c) => c.status === "fail").length;
  return {
    status: fail > 0 ? "fail" : warn > 0 ? "warn" : "pass",
    pass,
    warn,
    fail,
    total: checks.length,
  };
}
