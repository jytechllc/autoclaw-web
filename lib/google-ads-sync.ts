import { getDb } from "@/lib/db";
import { fetchCampaignSpend, setCampaignStatus } from "@/lib/google-ads";
import { releaseReserve } from "@/lib/credits";

type Sql = ReturnType<typeof getDb>;

export interface SyncSummary {
  orgId: number;
  campaignsSynced: number;
  autoClosed: Array<{ id: number; name: string; spent: number; cap: number }>;
  errors: string[];
}

/**
 * Sync Google Ads spend for one org's campaigns:
 * 1. Pull cost_micros for all open Google campaigns
 * 2. Update spent_cents
 * 3. If spent >= cap → pause in Google Ads, mark closed, release any unspent reserve
 */
export async function syncOrgGoogleAdsSpend(sql: Sql, orgId: number): Promise<SyncSummary> {
  const summary: SyncSummary = { orgId, campaignsSynced: 0, autoClosed: [], errors: [] };

  // Fetch all open Google campaigns for this org
  const campaigns = await sql`
    SELECT id, platform_campaign_id, campaign_name, total_budget_cents, spent_cents, reserved_cents, closed
    FROM campaigns
    WHERE org_id = ${orgId} AND platform = 'google' AND closed = false
  `;
  if (campaigns.length === 0) return summary;

  const resourceNames = campaigns.map((c) => c.platform_campaign_id as string).filter(Boolean);
  let spendRows;
  try {
    spendRows = await fetchCampaignSpend(resourceNames);
  } catch (e) {
    summary.errors.push(`fetchCampaignSpend: ${e instanceof Error ? e.message : String(e)}`);
    return summary;
  }

  const spendByResource = new Map(spendRows.map((s) => [s.resourceName, s]));

  for (const c of campaigns) {
    const id = c.id as number;
    const resourceName = c.platform_campaign_id as string;
    const cap = Number(c.total_budget_cents || 0);
    const spend = spendByResource.get(resourceName);
    if (!spend) continue;

    // cost_micros → cents (1 USD = 1_000_000 micros = 100 cents → divide by 10_000)
    const newSpentCents = Math.round(spend.costMicros / 10_000);
    const previousSpent = Number(c.spent_cents || 0);

    if (newSpentCents === previousSpent) {
      summary.campaignsSynced += 1;
      continue;
    }

    // reserved_cents = max(cap - spent, 0)
    const newReserved = Math.max(cap - newSpentCents, 0);
    await sql`
      UPDATE campaigns
      SET spent_cents = ${newSpentCents}, reserved_cents = ${newReserved}, updated_at = NOW()
      WHERE id = ${id}
    `;
    summary.campaignsSynced += 1;

    // Auto-close if spent reached cap
    if (cap > 0 && newSpentCents >= cap) {
      const pauseRes = await setCampaignStatus(resourceName, "PAUSED");
      if (!pauseRes.success) {
        summary.errors.push(`Auto-pause failed for ${id}: ${JSON.stringify(pauseRes.error)}`);
        continue;
      }
      // Any leftover reserve (if cap was set higher than actual spend somehow) goes back
      const previousReserve = Number(c.reserved_cents || 0);
      const remainingReserve = Math.max(previousReserve - (newSpentCents - previousSpent), 0);
      if (remainingReserve > 0) {
        await releaseReserve(sql, orgId, remainingReserve, id, `Auto-closed (cap reached): ${c.campaign_name}`);
      }
      await sql`UPDATE campaigns SET status = 'PAUSED', closed = true, reserved_cents = 0 WHERE id = ${id}`;
      summary.autoClosed.push({
        id,
        name: c.campaign_name as string,
        spent: newSpentCents,
        cap,
      });
    }
  }

  return summary;
}
