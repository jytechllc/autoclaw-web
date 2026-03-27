import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";

function getStripe() {
  return new Stripe(process.env.STRIPE_SECRET_KEY!);
}

function getPlans(): Record<string, { priceId: string }> {
  return {
    growth: { priceId: process.env.STRIPE_GROWTH_PRICE_ID! },
    scale: { priceId: process.env.STRIPE_SCALE_PRICE_ID! },
  };
}

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const { plan } = await req.json();
    const plans = getPlans();

    if (!plan || !plans[plan]) {
      return NextResponse.json({ error: "Invalid plan" }, { status: 400 });
    }

    if (!process.env.STRIPE_SECRET_KEY) {
      return NextResponse.json({ error: "Stripe not configured" }, { status: 500 });
    }

    const stripe = getStripe();
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      payment_method_types: ["card"],
      line_items: [{ price: plans[plan].priceId, quantity: 1 }],
      success_url: `${req.nextUrl.origin}/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${req.nextUrl.origin}/#pricing`,
      allow_promotion_codes: true,
      metadata: { plan },
    });

    return NextResponse.json({ url: session.url });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("Checkout error:", message);
    return NextResponse.json({ error: "Failed to create checkout session", detail: message }, { status: 500 });
  }
}
