import { NextRequest, NextResponse } from "next/server";
import { getWechatPayConfig, verifyWebhookSignature, decryptWebhook } from "@/lib/wechat-pay";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const body = await req.text();
    const signature = req.headers.get("wechatpay-signature") || "";
    const timestamp = req.headers.get("wechatpay-timestamp") || "";
    const nonce = req.headers.get("wechatpay-nonce") || "";
    const serial = req.headers.get("wechatpay-serial") || "";

    const config = getWechatPayConfig();

    // Verify webhook signature (simplified - should verify against WeChat Pay certificates)
    // In production, you should fetch and verify against WeChat Pay's platform certificates
    console.log("WeChat Pay webhook received:", { timestamp, nonce, serial });

    // Parse notification
    const notification = JSON.parse(body);
    const resource = notification.resource;

    if (!resource) {
      return NextResponse.json({ code: "FAIL", message: "Invalid notification" }, { status: 400 });
    }

    // Decrypt the resource
    const decrypted = decryptWebhook(
      resource.ciphertext,
      resource.associated_data,
      resource.nonce,
      config.apiV3Key
    );

    const paymentData = JSON.parse(decrypted);

    const {
      out_trade_no: orderNo,
      transaction_id: transactionId,
      trade_state: tradeState,
      success_time: successTime,
      amount,
      attach,
    } = paymentData;

    // Parse attach data
    const attachData = JSON.parse(attach || "{}");
    const { plan, userId, email } = attachData;

    // Only process successful payments
    if (tradeState === "SUCCESS") {
      // Update user subscription in database
      await db.query(
        `UPDATE users
         SET plan = $1,
             updated_at = NOW(),
             wechat_order_no = $2,
             wechat_transaction_id = $3,
             payment_method = 'wechat_pay',
             subscription_status = 'active'
         WHERE auth0_id = $4`,
        [plan, orderNo, transactionId, userId]
      );

      // Log payment record
      await db.query(
        `INSERT INTO payments (
          user_id,
          order_no,
          transaction_id,
          payment_method,
          amount,
          currency,
          status,
          paid_at,
          plan
        ) VALUES (
          (SELECT id FROM users WHERE auth0_id = $1),
          $2, $3, 'wechat_pay', $4, 'CNY', 'success', $5, $6
        )
        ON CONFLICT (order_no) DO UPDATE SET
          status = 'success',
          transaction_id = $3,
          paid_at = $5`,
        [userId, orderNo, transactionId, amount.total, successTime, plan]
      );

      console.log(`WeChat Pay success: ${orderNo}, user: ${userId}, plan: ${plan}`);
    }

    // Return success response to WeChat Pay
    return NextResponse.json({ code: "SUCCESS", message: "OK" });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("WeChat Pay webhook error:", message);
    return NextResponse.json({ code: "FAIL", message: "Processing error" }, { status: 500 });
  }
}
