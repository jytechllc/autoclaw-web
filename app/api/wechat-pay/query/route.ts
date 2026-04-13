import { NextRequest, NextResponse } from "next/server";
import { queryOrder } from "@/lib/wechat-pay";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    // WeChat Pay only available on *.yeoso.com
    const host = req.headers.get("host") || "";
    if (!host.includes("yeoso")) {
      return NextResponse.json({ error: "WeChat Pay is not available on this domain" }, { status: 403 });
    }

    const { searchParams } = new URL(req.url);
    const orderNo = searchParams.get("orderNo");

    if (!orderNo) {
      return NextResponse.json({ error: "Order number is required" }, { status: 400 });
    }

    const result = await queryOrder(orderNo);

    // Map WeChat Pay trade state to our status
    const tradeStateMap: Record<string, string> = {
      SUCCESS: "success",
      REFUND: "refunded",
      NOTPAY: "pending",
      CLOSED: "closed",
      REVOKED: "revoked",
      USERPAYING: "processing",
      PAYERROR: "failed",
    };

    return NextResponse.json({
      orderNo,
      status: tradeStateMap[result.trade_state] || "unknown",
      tradeState: result.trade_state,
      amount: result.amount?.total,
      paidAt: result.success_time,
      transactionId: result.transaction_id,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("WeChat Pay query error:", message);
    return NextResponse.json(
      { error: "Failed to query order status", detail: message },
      { status: 500 }
    );
  }
}
