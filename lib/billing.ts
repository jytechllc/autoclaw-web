/**
 * Shared billing constants — safe to import from both server and client code.
 *
 * Kept separate from `lib/credits.ts` (which pulls in DB types) so that React
 * client components can compute markup-adjusted display values without bundling
 * Postgres dependencies.
 */

/**
 * Markup is split into two transparent components shown to the user:
 *   1. Payment Gateway Fee — pass-through of the underlying processor's percentage
 *      cost (Stripe US card: 2.9%; the $0.30 fixed per-topup is absorbed). Always charged.
 *   2. Platform Fee — AutoClaw margin. Charged on pay-as-you-go orgs (5%);
 *      waived on subscription plans where the user already pays a monthly fee.
 *
 * Total markup applied at every ad-platform ↔ pool boundary is the sum.
 */
export const PAYMENT_GATEWAY_FEE_BPS = 290;
export const PLATFORM_FEE_BPS_PAYG = 500;

/**
 * Subscription plans where the platform fee is waived because the customer
 * already pays a monthly fee. Anything not in this set falls back to PAYG.
 */
const PAID_PLANS = new Set(["enterprise", "scale", "growth", "pro", "premium", "paid"]);

export function isPaidPlan(plan: string | null | undefined): boolean {
  return PAID_PLANS.has((plan || "").toLowerCase());
}

export function platformFeeBps(plan: string | null | undefined): number {
  return isPaidPlan(plan) ? 0 : PLATFORM_FEE_BPS_PAYG;
}

/** Round-up cents-only fee component, sign-preserving. */
function feeCents(googleCents: number, bps: number): number {
  if (bps === 0) return 0;
  const sign = googleCents < 0 ? -1 : 1;
  return sign * Math.ceil(Math.abs(googleCents) * bps / 10000);
}

/** Pass-through of the payment processor fee (cents). Always applied. */
export function paymentGatewayFee(googleCents: number): number {
  return feeCents(googleCents, PAYMENT_GATEWAY_FEE_BPS);
}

/** AutoClaw platform margin (cents). Plan-aware: 0 for paid subscribers, 5% for PAYG. */
export function platformFee(googleCents: number, plan: string | null | undefined): number {
  return feeCents(googleCents, platformFeeBps(plan));
}

/**
 * Convert a Google-side amount to the platform-side amount the user is billed:
 * ad cost + gateway fee + (platform fee if PAYG). Sum-of-rounded-parts so UI
 * breakdown stays penny-exact with what we debit.
 */
export function applyPlatformMarkup(googleCents: number, plan: string | null | undefined): number {
  return googleCents + paymentGatewayFee(googleCents) + platformFee(googleCents, plan);
}
