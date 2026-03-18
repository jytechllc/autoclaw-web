import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  const sql = getDb();
  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString().slice(0, 10);

  // Read all platform costs from cache (synced daily by GitHub Action)
  const cached = await sql`
    SELECT platform, service_name, SUM(cost)::numeric as cost, SUM(quantity)::numeric as quantity,
           MAX(unit) as unit, MAX(synced_at) as synced_at
    FROM platform_costs
    WHERE period_start >= ${monthStart}
    GROUP BY platform, service_name
    ORDER BY platform, SUM(cost) DESC
  `;

  if (cached.length === 0) {
    return NextResponse.json({ platforms: [], note: "No data yet. Run sync-billing cron first." });
  }

  // Group by platform
  const platforms = new Map<string, { services: { name: string; cost: number; quantity: number; unit: string }[]; totalGross: number }>();
  for (const row of cached) {
    const p = row.platform as string;
    if (!platforms.has(p)) platforms.set(p, { services: [], totalGross: 0 });
    const entry = platforms.get(p)!;
    const cost = Math.round(Number(row.cost) * 10000) / 10000;
    entry.services.push({
      name: row.service_name as string,
      cost,
      quantity: Math.round(Number(row.quantity) * 100) / 100,
      unit: (row.unit as string) || "",
    });
    entry.totalGross += cost;
  }

  const result = Array.from(platforms.entries()).map(([name, data]) => ({
    platform: name,
    services: data.services.filter((s) => s.cost > 0 || s.quantity > 0),
    totalGross: Math.round(data.totalGross * 10000) / 10000,
  }));

  const syncedAt = cached[0]?.synced_at;

  return NextResponse.json({ platforms: result, monthStart, syncedAt });
}
