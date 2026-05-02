import { getDb } from "@/lib/db";
import { fetchCampaignSpend, setCampaignStatus } from "@/lib/google-ads";
import { applyPlatformMarkup, recordSpend, releaseReserve } from "@/lib/credits";

type Sql = ReturnType<typeof getDb>;

export interface SyncSummary {
  orgId: number;
  campaignsSynced: number;
  spendRecorded: Array<{ id: number; name: string; deltaCents: number; debitedCents: number }>;
  autoClosed: Array<{ id: number; name: string; spent: number; cap: number; reason: "cap_reached" | "remaining_below_daily" }>;
  errors: string[];
}

/**
 * Sync Google Ads spend for one org's campaigns:
 * 1. Pull cost_micros for all open Google campaigns
 * 2. Update spent_cents
 * 3. If spent >= cap → pause in Google Ads, mark closed, release any unspent reserve
 */
export async function syncOrgGoogleAdsSpend(sql: Sql, orgId: number): Promise<SyncSummary> {
  const summary: SyncSummary = { orgId, campaignsSynced: 0, spendRecorded: [], autoClosed: [], errors: [] };

  const orgRows = await sql`SELECT plan FROM organizations WHERE id = ${orgId}`;
  const plan = (orgRows[0]?.plan as string | null | undefined) ?? null;

  // Fetch all open Google campaigns for this org
  const campaigns = await sql`
    SELECT id, platform_campaign_id, campaign_name, total_budget_cents, spent_cents, reserved_cents, daily_budget, closed
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

    // Debit org-pool reserve to reflect actual spend.
    // Clamp to the per-campaign reserve (Google-side) so a Google overshoot can't drain unrelated reserves;
    // then mark up to platform-side before debiting `ad_credits`.
    const delta = newSpentCents - previousSpent;
    if (delta > 0) {
      const previousReserve = Number(c.reserved_cents || 0);
      const debitGoogle = Math.min(delta, previousReserve);
      if (debitGoogle > 0) {
        const debitPlatform = applyPlatformMarkup(debitGoogle, plan);
        try {
          await recordSpend(sql, orgId, debitPlatform, id, `Spend: ${c.campaign_name}`);
          summary.spendRecorded.push({ id, name: c.campaign_name as string, deltaCents: delta, debitedCents: debitPlatform });
        } catch (e) {
          summary.errors.push(`recordSpend failed for ${id}: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
      if (delta > debitGoogle) {
        summary.errors.push(`Spend overshoot for campaign ${id}: delta=${delta}¢, reserve=${previousReserve}¢ — Google reported more than the cap-reserved amount`);
      }
    }

    // Auto-close: either spent reached cap, OR remaining < daily budget (would overshoot in next day's spend)
    const dailyCents = Math.round(Number(c.daily_budget || 0) * 100);
    const remainingCents = Math.max(cap - newSpentCents, 0);
    const capReached = cap > 0 && newSpentCents >= cap;
    const remainingBelowDaily = cap > 0 && dailyCents > 0 && !capReached && remainingCents < dailyCents;
    if (capReached || remainingBelowDaily) {
      const reason: "cap_reached" | "remaining_below_daily" = capReached ? "cap_reached" : "remaining_below_daily";
      const pauseRes = await setCampaignStatus(resourceName, "PAUSED");
      if (!pauseRes.success) {
        summary.errors.push(`Auto-pause failed for ${id}: ${JSON.stringify(pauseRes.error)}`);
        continue;
      }
      // Release whatever's left in the per-campaign reserve back to the org pool.
      const previousReserve = Number(c.reserved_cents || 0);
      const leftoverReserve = Math.max(previousReserve - (newSpentCents - previousSpent), 0);
      if (leftoverReserve > 0) {
        const note = capReached
          ? `Auto-closed (cap reached): ${c.campaign_name}`
          : `Auto-closed (remaining $${(remainingCents / 100).toFixed(2)} < daily $${(dailyCents / 100).toFixed(2)}): ${c.campaign_name}`;
        await releaseReserve(sql, orgId, applyPlatformMarkup(leftoverReserve, plan), id, note);
      }
      await sql`UPDATE campaigns SET status = 'PAUSED', closed = true, reserved_cents = 0 WHERE id = ${id}`;
      summary.autoClosed.push({
        id,
        name: c.campaign_name as string,
        spent: newSpentCents,
        cap,
        reason,
      });
    }
  }

  return summary;
}

export interface ReconcileSummary {
  orgId: number;
  campaignsChecked: number;
  missedSpendRecorded: Array<{ id: number; name: string; missedCents: number }>;
  poolDriftCents: number;
  errors: string[];
}

/**
 * Verify our ledger matches reality. Two checks:
 * 1. For every Google campaign, sum(spend tx) should equal campaigns.spent_cents — if not, record the missed delta.
 * 2. ad_credits.reserved_cents should equal SUM(campaigns.reserved_cents) for closed=false — if not, report drift.
 *
 * Designed to be safe to run repeatedly: idempotent once spend is caught up.
 * Run after syncOrgGoogleAdsSpend so per-campaign spent_cents is fresh.
 */
export async function reconcileOrgSpend(sql: Sql, orgId: number): Promise<ReconcileSummary> {
  const summary: ReconcileSummary = { orgId, campaignsChecked: 0, missedSpendRecorded: [], poolDriftCents: 0, errors: [] };

  const orgRows = await sql`SELECT plan FROM organizations WHERE id = ${orgId}`;
  const plan = (orgRows[0]?.plan as string | null | undefined) ?? null;

  // Per-campaign: spent_cents vs SUM of recorded spend transactions
  const rows = await sql`
    SELECT c.id, c.campaign_name, c.spent_cents,
           COALESCE((
             SELECT -SUM(t.amount_cents)
             FROM ad_credit_transactions t
             WHERE t.org_id = c.org_id
               AND t.type = 'spend'
               AND t.reference_type = 'campaign'
               AND t.reference_id = c.id::text
           ), 0) AS recorded_spend_cents
    FROM campaigns c
    WHERE c.org_id = ${orgId} AND c.platform = 'google'
  `;

  for (const r of rows) {
    summary.campaignsChecked += 1;
    const id = Number(r.id);
    const name = String(r.campaign_name || "");
    const spentGoogle = Number(r.spent_cents || 0);                 // Google-side
    const recordedPlatform = Number(r.recorded_spend_cents || 0);   // platform-side (post-markup)
    const expectedPlatform = applyPlatformMarkup(spentGoogle, plan);
    const missed = expectedPlatform - recordedPlatform;
    if (missed > 0) {
      try {
        await recordSpend(sql, orgId, missed, id, `Reconcile: catch-up spend for ${name}`);
        summary.missedSpendRecorded.push({ id, name, missedCents: missed });
      } catch (e) {
        summary.errors.push(`reconcile recordSpend failed for ${id}: ${e instanceof Error ? e.message : String(e)}`);
      }
    } else if (missed < 0) {
      // We've recorded more spend than the campaign reports — possible if Google revised cost downward (rare)
      summary.errors.push(`Negative missed spend for campaign ${id}: recorded=${recordedPlatform}¢ (platform) > expected=${expectedPlatform}¢ (markup of spent=${spentGoogle}¢)`);
    }
  }

  // Org-pool drift: ad_credits.reserved (platform-side) should equal markup of sum(open campaigns.reserved) (Google-side)
  const driftRows = await sql`
    SELECT
      COALESCE((SELECT reserved_cents FROM ad_credits WHERE org_id = ${orgId}), 0) AS pool_reserved,
      COALESCE((SELECT SUM(reserved_cents) FROM campaigns WHERE org_id = ${orgId} AND platform = 'google' AND closed = false), 0) AS campaign_reserved_google
  `;
  if (driftRows.length > 0) {
    const poolReserved = Number(driftRows[0].pool_reserved);
    const campaignReservedGoogle = Number(driftRows[0].campaign_reserved_google);
    const expectedPoolReserved = applyPlatformMarkup(campaignReservedGoogle, plan);
    const drift = poolReserved - expectedPoolReserved;
    summary.poolDriftCents = drift;
    if (drift !== 0) {
      summary.errors.push(`Pool drift: ad_credits.reserved=${poolReserved}¢ (platform) but expected=${expectedPoolReserved}¢ (markup of sum=${campaignReservedGoogle}¢ Google) — diff=${drift}¢`);
    }
  }

  return summary;
}
