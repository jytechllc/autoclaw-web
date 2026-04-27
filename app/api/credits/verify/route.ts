import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { auth0 } from "@/lib/auth0";
import { getDb } from "@/lib/db";
import { ensureAdCreditsTables, addTopup } from "@/lib/credits";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const sessionId = req.nextUrl.searchParams.get("session_id");
  if (!sessionId) {
    return NextResponse.json({ error: "Missing session_id" }, { status: 400 });
  }
  if (!process.env.STRIPE_SECRET_KEY) {
    return NextResponse.json({ error: "Stripe not configured" }, { status: 500 });
  }

  const auth = await auth0.getSession(req);
  if (!auth?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  const checkout = await stripe.checkout.sessions.retrieve(sessionId);

  if (checkout.metadata?.type !== "ad_credits_topup") {
    return NextResponse.json({ error: "Not a top-up session" }, { status: 400 });
  }
  if (checkout.payment_status !== "paid") {
    return NextResponse.json({ status: checkout.payment_status });
  }

  const orgIdStr = checkout.metadata.org_id;
  if (!orgIdStr) {
    return NextResponse.json({ error: "Missing org_id metadata" }, { status: 500 });
  }
  const orgId = Number(orgIdStr);

  // Authorization: ensure the requester is a member of the org being credited
  const sql = getDb();
  const users = await sql`SELECT id FROM users WHERE email = ${auth.user.email as string}`;
  if (users.length === 0) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }
  const userId = users[0].id as number;
  const member = await sql`SELECT 1 FROM organization_members WHERE user_id = ${userId} AND org_id = ${orgId}`;
  if (member.length === 0) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  await ensureAdCreditsTables(sql);
  const amountCents = checkout.amount_total || 0;
  const credits = await addTopup(sql, orgId, amountCents, sessionId);

  return NextResponse.json({
    status: "success",
    amountCents,
    credits,
  });
}
