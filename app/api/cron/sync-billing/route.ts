import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const CRON_SECRET = process.env.CRON_SECRET;

async function syncVercel(sql: ReturnType<typeof getDb>) {
  const token = process.env.VERCEL_TOKEN;
  if (!token) return { platform: "vercel", error: "VERCEL_TOKEN not configured" };

  const teamId = "team_d8TD8al7Effx9Oumnn3xomTj";
  const now = new Date();
  const yesterday = new Date(now);
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  const from = new Date(Date.UTC(yesterday.getUTCFullYear(), yesterday.getUTCMonth(), yesterday.getUTCDate())).toISOString();
  const to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
  const periodStart = from.slice(0, 10);
  const periodEnd = to.slice(0, 10);

  const res = await fetch(
    `https://api.vercel.com/v1/billing/charges?teamId=${teamId}&from=${from}&to=${to}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!res.ok) return { platform: "vercel", error: `API ${res.status}` };

  const text = await res.text();
  const lines = text.split("\n").filter(Boolean);
  const byService = new Map<string, { cost: number; quantity: number; unit: string }>();
  let totalCost = 0;

  for (const line of lines) {
    try {
      const c = JSON.parse(line);
      const svc = c.ServiceName || "unknown";
      const prev = byService.get(svc) || { cost: 0, quantity: 0, unit: "" };
      prev.cost += c.BilledCost || 0;
      prev.quantity += c.ConsumedQuantity || 0;
      prev.unit = c.ConsumedUnit || prev.unit;
      byService.set(svc, prev);
      totalCost += c.BilledCost || 0;
    } catch { /* skip */ }
  }

  let upserted = 0;
  for (const [serviceName, data] of byService) {
    if (data.cost === 0 && data.quantity === 0) continue;
    await sql`
      INSERT INTO platform_costs (platform, service_name, cost, quantity, unit, period_start, period_end)
      VALUES ('vercel', ${serviceName}, ${data.cost}, ${data.quantity}, ${data.unit}, ${periodStart}, ${periodEnd})
      ON CONFLICT (platform, service_name, period_start, period_end)
      DO UPDATE SET cost = ${data.cost}, quantity = ${data.quantity}, unit = ${data.unit}, synced_at = NOW()
    `;
    upserted++;
  }

  return { platform: "vercel", period: `${periodStart} ~ ${periodEnd}`, services: upserted, totalCost: Math.round(totalCost * 10000) / 10000 };
}

async function syncGitHub(sql: ReturnType<typeof getDb>) {
  const token = process.env.GITHUB_BILLING_TOKEN || process.env.GITHUB_TOKEN;
  if (!token) return { platform: "github", error: "No GitHub token" };

  const res = await fetch("https://api.github.com/users/dotku/settings/billing/usage", {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
  });
  if (!res.ok) return { platform: "github", error: `API ${res.status}` };

  const data = await res.json() as { usageItems?: { date: string; product: string; sku: string; quantity: number; unitType: string; pricePerUnit: number; grossAmount: number; netAmount: number; repositoryName: string }[] };
  const items = data.usageItems || [];

  // Aggregate by product+sku for this month
  const now = new Date();
  const monthStart = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-01`;
  const periodEnd = now.toISOString().slice(0, 10);

  const byService = new Map<string, { grossCost: number; netCost: number; quantity: number; unit: string }>();
  for (const item of items) {
    if (item.date < monthStart) continue;
    const key = item.sku;
    const prev = byService.get(key) || { grossCost: 0, netCost: 0, quantity: 0, unit: "" };
    prev.grossCost += item.grossAmount;
    prev.netCost += item.netAmount;
    prev.quantity += item.quantity;
    prev.unit = item.unitType;
    byService.set(key, prev);
  }

  let upserted = 0;
  for (const [serviceName, d] of byService) {
    if (d.grossCost === 0 && d.quantity === 0) continue;
    // Store grossCost as cost (what it would cost without free tier)
    // Store netCost (actual charge) in detail via unit field suffix
    const unitWithNet = d.netCost > 0 ? `${d.unit} (net: $${d.netCost.toFixed(4)})` : `${d.unit} (free tier)`;
    await sql`
      INSERT INTO platform_costs (platform, service_name, cost, quantity, unit, period_start, period_end)
      VALUES ('github', ${serviceName}, ${d.grossCost}, ${d.quantity}, ${unitWithNet}, ${monthStart}, ${periodEnd})
      ON CONFLICT (platform, service_name, period_start, period_end)
      DO UPDATE SET cost = ${d.grossCost}, quantity = ${d.quantity}, unit = ${unitWithNet}, synced_at = NOW()
    `;
    upserted++;
  }

  return { platform: "github", period: `${monthStart} ~ ${periodEnd}`, services: upserted, items: items.length };
}

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  if (CRON_SECRET && authHeader !== `Bearer ${CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sql = getDb();

  const [vercelResult, githubResult] = await Promise.all([
    syncVercel(sql).catch((e) => ({ platform: "vercel", error: `${e}` })),
    syncGitHub(sql).catch((e) => ({ platform: "github", error: `${e}` })),
  ]);

  return NextResponse.json({ ok: true, vercel: vercelResult, github: githubResult });
}
