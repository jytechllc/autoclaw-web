import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { auth0 } from "@/lib/auth0";
import { getDb } from "@/lib/db";
import { checkRateLimit } from "@/lib/rate-limit";
import { logAudit } from "@/lib/audit";
import { resolveOrgId } from "@/lib/credits";

export const dynamic = "force-dynamic";

const MIN_TOPUP_USD = 10;
const MAX_TOPUP_USD = 50000;

function getIp(req: NextRequest): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}

export async function POST(req: NextRequest) {
  const ip = getIp(req);
  if (!checkRateLimit(ip, { limit: 30, windowMs: 60_000 })) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  if (!process.env.STRIPE_SECRET_KEY) {
    return NextResponse.json({ error: "Stripe not configured" }, { status: 500 });
  }

  const session = await auth0.getSession();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const amountUsd = Number(body.amountUsd);
  const locale = (body.locale as string) || "en";
  // Sanitize return path: must be a same-origin absolute path
  const rawReturnPath = (body.returnPath as string) || `/${locale}/dashboard/google-ads`;
  const returnPath = rawReturnPath.startsWith("/") && !rawReturnPath.startsWith("//")
    ? rawReturnPath
    : `/${locale}/dashboard/google-ads`;

  if (!Number.isFinite(amountUsd) || amountUsd < MIN_TOPUP_USD || amountUsd > MAX_TOPUP_USD) {
    return NextResponse.json({ error: `Amount must be between $${MIN_TOPUP_USD} and $${MAX_TOPUP_USD}` }, { status: 400 });
  }

  const sql = getDb();
  const userEmail = session.user.email as string;
  const users = await sql`SELECT id FROM users WHERE email = ${userEmail}`;
  if (users.length === 0) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }
  const userId = users[0].id as number;

  const requestedOrgId = body.orgId ? Number(body.orgId) : undefined;
  const orgId = await resolveOrgId(sql, userId, requestedOrgId);
  if (!orgId) {
    return NextResponse.json({ error: requestedOrgId ? "Forbidden — not a member of that org" : "No organization found" }, { status: 400 });
  }

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  const amountCents = Math.round(amountUsd * 100);

  const checkout = await stripe.checkout.sessions.create({
    mode: "payment",
    payment_method_types: ["card"],
    line_items: [{
      price_data: {
        currency: "usd",
        product_data: { name: "Google Ads Credit Top-up" },
        unit_amount: amountCents,
      },
      quantity: 1,
    }],
    success_url: `${req.nextUrl.origin}${returnPath}?topup=success&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${req.nextUrl.origin}${returnPath}?topup=cancel`,
    metadata: {
      type: "ad_credits_topup",
      org_id: String(orgId),
      user_email: userEmail,
    },
    customer_email: userEmail,
  });

  logAudit({
    userId,
    userEmail,
    action: "google_ads.topup",
    resourceType: "ad_credits",
    details: { amountUsd, sessionId: checkout.id },
    ipAddress: ip,
  });

  return NextResponse.json({ url: checkout.url, sessionId: checkout.id });
}
