import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { auth0 } from "@/lib/auth0";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const sessionId = req.nextUrl.searchParams.get("session_id");
  if (!sessionId) {
    return NextResponse.json({ error: "Missing session_id" }, { status: 400 });
  }

  if (!process.env.STRIPE_SECRET_KEY) {
    return NextResponse.json({ error: "Stripe not configured" }, { status: 503 });
  }

  const session = await auth0.getSession(req);
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
    const checkout = await stripe.checkout.sessions.retrieve(sessionId);

    if (checkout.payment_status !== "paid") {
      return NextResponse.json({ status: checkout.payment_status });
    }

    const sql = getDb();

    // Get user id
    const users = await sql`SELECT id FROM users WHERE auth0_id = ${session.user.sub}`;
    if (users.length === 0) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const userId = users[0].id;
    const plan = checkout.metadata?.plan || (checkout.amount_total && checkout.amount_total >= 9900 ? "scale" : "growth");
    const orderNo = `stripe_${checkout.id}`;

    // Upsert payment record
    await sql`INSERT INTO payments (user_id, order_no, transaction_id, payment_method, amount, currency, status, plan, paid_at)
      VALUES (${userId}, ${orderNo}, ${checkout.payment_intent as string}, 'stripe', ${checkout.amount_total || 0}, ${(checkout.currency || "usd").toUpperCase()}, 'success', ${plan}, NOW())
      ON CONFLICT (order_no) DO UPDATE SET status = 'success', transaction_id = ${checkout.payment_intent as string}, paid_at = NOW()`;

    return NextResponse.json({
      status: "success",
      plan,
      amount: checkout.amount_total,
      currency: checkout.currency,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("Checkout verify error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
