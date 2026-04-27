import { getDb } from "@/lib/db";

type Sql = ReturnType<typeof getDb>;

/** Resolve the org to operate on. If requestedOrgId provided, verify the user belongs to it.
 *  Otherwise fall back to the user's first org (legacy behavior). */
export async function resolveOrgId(sql: Sql, userId: number, requestedOrgId?: number | null): Promise<number | null> {
  if (requestedOrgId && Number.isFinite(requestedOrgId)) {
    const rows = await sql`
      SELECT 1 FROM organization_members
      WHERE user_id = ${userId} AND org_id = ${requestedOrgId}
      LIMIT 1
    `;
    return rows.length > 0 ? requestedOrgId : null;
  }
  const rows = await sql`SELECT org_id FROM organization_members WHERE user_id = ${userId} ORDER BY org_id LIMIT 1`;
  return rows.length > 0 ? (rows[0].org_id as number) : null;
}

export interface AdCredits {
  org_id: number;
  balance_cents: number;
  reserved_cents: number;
  currency: string;
  updated_at: string;
}

export interface AdCreditTransaction {
  id: number;
  org_id: number;
  type: "topup" | "reserve" | "unreserve" | "spend" | "refund" | "adjustment";
  amount_cents: number;
  balance_after_cents: number;
  reserved_after_cents: number;
  reference_type: string | null;
  reference_id: string | null;
  note: string | null;
  created_at: string;
}

export async function ensureAdCreditsTables(sql: Sql) {
  await sql`
    CREATE TABLE IF NOT EXISTS ad_credits (
      org_id INTEGER PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
      balance_cents BIGINT NOT NULL DEFAULT 0,
      reserved_cents BIGINT NOT NULL DEFAULT 0,
      currency VARCHAR(10) NOT NULL DEFAULT 'USD',
      updated_at TIMESTAMP DEFAULT NOW()
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS ad_credit_transactions (
      id SERIAL PRIMARY KEY,
      org_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      type VARCHAR(20) NOT NULL,
      amount_cents BIGINT NOT NULL,
      balance_after_cents BIGINT NOT NULL,
      reserved_after_cents BIGINT NOT NULL,
      reference_type VARCHAR(50),
      reference_id VARCHAR(255),
      note TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS idx_ad_credit_tx_org ON ad_credit_transactions(org_id, created_at DESC)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_ad_credit_tx_ref ON ad_credit_transactions(reference_type, reference_id)`;
}

async function ensureRow(sql: Sql, orgId: number) {
  await sql`
    INSERT INTO ad_credits (org_id, balance_cents, reserved_cents, currency)
    VALUES (${orgId}, 0, 0, 'USD')
    ON CONFLICT (org_id) DO NOTHING
  `;
}

export async function getCredits(sql: Sql, orgId: number): Promise<AdCredits> {
  await ensureRow(sql, orgId);
  const rows = await sql`SELECT * FROM ad_credits WHERE org_id = ${orgId}`;
  return rows[0] as AdCredits;
}

export async function getRecentTransactions(sql: Sql, orgId: number, limit = 20): Promise<AdCreditTransaction[]> {
  const rows = await sql`
    SELECT * FROM ad_credit_transactions
    WHERE org_id = ${orgId}
    ORDER BY created_at DESC
    LIMIT ${limit}
  `;
  return rows as AdCreditTransaction[];
}

interface MutateOpts {
  referenceType?: string;
  referenceId?: string | number;
  note?: string;
}

async function logTx(
  sql: Sql,
  orgId: number,
  type: AdCreditTransaction["type"],
  amountCents: number,
  balanceAfter: number,
  reservedAfter: number,
  opts: MutateOpts = {}
) {
  await sql`
    INSERT INTO ad_credit_transactions
      (org_id, type, amount_cents, balance_after_cents, reserved_after_cents, reference_type, reference_id, note)
    VALUES
      (${orgId}, ${type}, ${amountCents}, ${balanceAfter}, ${reservedAfter},
       ${opts.referenceType || null}, ${opts.referenceId ? String(opts.referenceId) : null}, ${opts.note || null})
  `;
}

export async function addTopup(sql: Sql, orgId: number, amountCents: number, stripeSessionId: string): Promise<AdCredits> {
  await ensureRow(sql, orgId);
  // Idempotent: if a transaction with this stripe session already exists, do nothing
  const existing = await sql`
    SELECT id FROM ad_credit_transactions
    WHERE reference_type = 'stripe_session' AND reference_id = ${stripeSessionId}
  `;
  if (existing.length > 0) {
    return getCredits(sql, orgId);
  }
  const updated = await sql`
    UPDATE ad_credits
    SET balance_cents = balance_cents + ${amountCents}, updated_at = NOW()
    WHERE org_id = ${orgId}
    RETURNING balance_cents, reserved_cents
  `;
  const balanceAfter = Number(updated[0].balance_cents);
  const reservedAfter = Number(updated[0].reserved_cents);
  await logTx(sql, orgId, "topup", amountCents, balanceAfter, reservedAfter, {
    referenceType: "stripe_session",
    referenceId: stripeSessionId,
    note: `Top-up via Stripe`,
  });
  return getCredits(sql, orgId);
}

export class InsufficientCreditsError extends Error {
  constructor(public readonly balanceCents: number, public readonly requestedCents: number) {
    super(`Insufficient credits: balance=${balanceCents}, requested=${requestedCents}`);
  }
}

export async function reserveForCampaign(sql: Sql, orgId: number, amountCents: number, campaignName: string): Promise<AdCredits> {
  await ensureRow(sql, orgId);
  // Atomic: only update if balance sufficient
  const updated = await sql`
    UPDATE ad_credits
    SET balance_cents = balance_cents - ${amountCents},
        reserved_cents = reserved_cents + ${amountCents},
        updated_at = NOW()
    WHERE org_id = ${orgId} AND balance_cents >= ${amountCents}
    RETURNING balance_cents, reserved_cents
  `;
  if (updated.length === 0) {
    const current = await getCredits(sql, orgId);
    throw new InsufficientCreditsError(current.balance_cents, amountCents);
  }
  const balanceAfter = Number(updated[0].balance_cents);
  const reservedAfter = Number(updated[0].reserved_cents);
  await logTx(sql, orgId, "reserve", -amountCents, balanceAfter, reservedAfter, {
    referenceType: "campaign",
    note: `Reserve for campaign: ${campaignName}`,
  });
  return getCredits(sql, orgId);
}

export async function attachReserveReference(sql: Sql, orgId: number, campaignId: number, amountCents: number) {
  // Update the most recent reserve tx for this org with the campaign id
  await sql`
    UPDATE ad_credit_transactions
    SET reference_id = ${String(campaignId)}
    WHERE id = (
      SELECT id FROM ad_credit_transactions
      WHERE org_id = ${orgId} AND type = 'reserve' AND reference_type = 'campaign' AND reference_id IS NULL
      ORDER BY created_at DESC LIMIT 1
    ) AND amount_cents = ${-amountCents}
  `;
}

export async function releaseReserve(sql: Sql, orgId: number, amountCents: number, campaignId: number, note: string) {
  if (amountCents <= 0) return;
  const updated = await sql`
    UPDATE ad_credits
    SET balance_cents = balance_cents + ${amountCents},
        reserved_cents = reserved_cents - ${amountCents},
        updated_at = NOW()
    WHERE org_id = ${orgId}
    RETURNING balance_cents, reserved_cents
  `;
  const balanceAfter = Number(updated[0]?.balance_cents || 0);
  const reservedAfter = Number(updated[0]?.reserved_cents || 0);
  await logTx(sql, orgId, "unreserve", amountCents, balanceAfter, reservedAfter, {
    referenceType: "campaign",
    referenceId: String(campaignId),
    note,
  });
}
