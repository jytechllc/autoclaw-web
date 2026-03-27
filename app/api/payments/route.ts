import { NextResponse } from "next/server";
import { auth0 } from "@/lib/auth0";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await auth0.getSession();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sql = getDb();
  const payments = await sql`
    SELECT p.order_no, p.transaction_id, p.payment_method, p.amount, p.currency, p.status, p.plan, p.paid_at, p.created_at
    FROM payments p
    JOIN users u ON u.id = p.user_id
    WHERE u.auth0_id = ${session.user.sub}
    ORDER BY p.created_at DESC
    LIMIT 50
  `;

  return NextResponse.json({ payments });
}
