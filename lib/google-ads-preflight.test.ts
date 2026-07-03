import { describe, it, expect } from "vitest";
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
} from "./google-ads-preflight";

describe("checkEnvVars", () => {
  it("passes when everything is set", () => {
    const all = new Set<string>([...REQUIRED_ADS_ENV, ...OPTIONAL_ADS_ENV]);
    const [required, optional] = checkEnvVars(all);
    expect(required.status).toBe("pass");
    expect(optional.status).toBe("pass");
  });

  it("fails required and warns optional, naming the missing vars", () => {
    const [required, optional] = checkEnvVars(new Set(["GOOGLE_ADS_CLIENT_ID"]));
    expect(required.status).toBe("fail");
    expect(required.detail).toContain("GOOGLE_ADS_REFRESH_TOKEN");
    expect(optional.status).toBe("warn");
    expect(optional.detail).toContain("CRON_SECRET");
  });
});

describe("checkCustomer", () => {
  it("fails on probe error", () => {
    const [conn] = checkCustomer({ ok: false, error: "401 unauthorized" });
    expect(conn.status).toBe("fail");
    expect(conn.detail).toContain("401");
  });

  it("fails account_kind for manager accounts, warns for test accounts", () => {
    const managerChecks = checkCustomer({ ok: true, manager: true });
    expect(managerChecks.find((c) => c.id === "account_kind")?.status).toBe("fail");
    const testChecks = checkCustomer({ ok: true, testAccount: true });
    expect(testChecks.find((c) => c.id === "account_kind")?.status).toBe("warn");
    const normal = checkCustomer({ ok: true, descriptiveName: "Acme", currencyCode: "USD" });
    expect(normal.every((c) => c.status === "pass")).toBe(true);
  });
});

describe("checkBilling / checkConversions / checkLedger / checkAiProviders", () => {
  it("billing needs an APPROVED setup", () => {
    expect(checkBilling({ ok: true, statuses: ["APPROVED", "CANCELLED"] }).status).toBe("pass");
    expect(checkBilling({ ok: true, statuses: ["PENDING"] }).status).toBe("fail");
    expect(checkBilling({ ok: true, statuses: [] }).status).toBe("fail");
    expect(checkBilling({ ok: false, error: "boom", statuses: [] }).status).toBe("fail");
  });

  it("conversions warn (not fail) when absent", () => {
    expect(checkConversions({ ok: true, enabledCount: 2 }).status).toBe("pass");
    expect(checkConversions({ ok: true, enabledCount: 0 }).status).toBe("warn");
    expect(checkConversions({ ok: false, error: "x", enabledCount: 0 }).status).toBe("warn");
  });

  it("ledger fails on any negative balance/reserved", () => {
    expect(checkLedger({ ok: true, orgs: 3, negativeBalances: 0, negativeReserved: 0 }).status).toBe("pass");
    expect(checkLedger({ ok: true, orgs: 3, negativeBalances: 1, negativeReserved: 0 }).status).toBe("fail");
    expect(checkLedger({ ok: false, error: "no table", orgs: 0, negativeBalances: 0, negativeReserved: 0 }).status).toBe("fail");
  });

  it("AI providers: 0 fail, 1 warn (no fallback), 2+ pass", () => {
    expect(checkAiProviders(0).status).toBe("fail");
    expect(checkAiProviders(1).status).toBe("warn");
    expect(checkAiProviders(3).status).toBe("pass");
  });
});

describe("summarizePreflight", () => {
  const mk = (status: PreflightCheck["status"]): PreflightCheck => ({ id: "x", label: "x", status, detail: "" });

  it("any fail dominates; else warn; else pass — with correct counts", () => {
    expect(summarizePreflight([mk("pass"), mk("warn"), mk("fail")])).toEqual({ status: "fail", pass: 1, warn: 1, fail: 1, total: 3 });
    expect(summarizePreflight([mk("pass"), mk("warn")])).toEqual({ status: "warn", pass: 1, warn: 1, fail: 0, total: 2 });
    expect(summarizePreflight([mk("pass"), mk("pass")])).toEqual({ status: "pass", pass: 2, warn: 0, fail: 0, total: 2 });
  });
});
