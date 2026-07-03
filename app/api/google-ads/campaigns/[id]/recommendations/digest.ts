// Pure selection logic for the nightly recommendation digest cron.
// Kept free of server imports so it can be unit-tested directly.

export interface DigestCandidate {
  id: number;
  status: string | null;
  closed: boolean;
  /** lifetime platform spend in cents — proxy for "money at stake" */
  spentCents: number;
  /** when the latest stored digest was generated, null if never */
  generatedAt: string | Date | null;
}

export interface DigestSelectionOptions {
  /** LLM calls per org per run (cost bound). Default 3. */
  maxPerOrg?: number;
  /** Digests younger than this are fresh and skipped. Default 20h — lets a
   *  daily cron refresh even when runs drift a little earlier. */
  maxAgeHours?: number;
}

/** True when a stored digest is stale (or missing) and worth regenerating. */
export function isDigestStale(
  generatedAt: string | Date | null,
  now: Date,
  maxAgeHours = 20,
): boolean {
  if (!generatedAt) return true;
  const ts = generatedAt instanceof Date ? generatedAt.getTime() : Date.parse(generatedAt);
  if (!Number.isFinite(ts)) return true;
  return now.getTime() - ts > maxAgeHours * 3_600_000;
}

/** Pick which campaigns of one org get an LLM call this run:
 *  ENABLED, not closed, digest stale — highest spend first, capped.
 *  ENABLED-only is deliberate: paused campaigns aren't burning money, and
 *  the owner sees a fresh digest generated on demand when they open one. */
export function selectCampaignsForDigest(
  rows: DigestCandidate[],
  now: Date,
  opts: DigestSelectionOptions = {},
): number[] {
  const maxPerOrg = opts.maxPerOrg ?? 3;
  const maxAgeHours = opts.maxAgeHours ?? 20;
  return rows
    .filter(
      (r) =>
        !r.closed &&
        String(r.status || "").toUpperCase() === "ENABLED" &&
        isDigestStale(r.generatedAt, now, maxAgeHours),
    )
    .sort((a, b) => b.spentCents - a.spentCents)
    .slice(0, Math.max(0, maxPerOrg))
    .map((r) => r.id);
}
