import { NextRequest, NextResponse } from "next/server";
import { createNativeOrder, getWechatPayPlans, generateOrderNo } from "@/lib/wechat-pay";
import { auth0 } from "@/lib/auth0";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    // WeChat Pay only available on *.yeoso.com
    const host = req.headers.get("host") || "";
    if (!host.includes("yeoso")) {
      return NextResponse.json({ error: "WeChat Pay is not available on this domain" }, { status: 403 });
    }

    const session = await auth0.getSession(req);
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { plan } = await req.json();
    const plans = getWechatPayPlans();

    if (!plan || !plans[plan]) {
      return NextResponse.json({ error: "Invalid plan" }, { status: 400 });
    }

    const planConfig = plans[plan];
    const orderNo = generateOrderNo();

    const result = await createNativeOrder({
      description: planConfig.description,
      outTradeNo: orderNo,
      notifyUrl: process.env.WECHAT_PAY_NOTIFY_URL!,
      amount: {
        total: planConfig.amount,
        currency: "CNY",
      },
      attach: JSON.stringify({
        plan,
        userId: session.user.sub,
        email: session.user.email,
      }),
    });

    if (!result.code_url) {
      throw new Error("Failed to generate WeChat Pay QR code");
    }

    return NextResponse.json({
      orderNo,
      qrCode: result.code_url,
      amount: planConfig.amount,
      plan,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("WeChat Pay error:", message);
    
    // Check if it's a configuration error
    if (message.includes("Missing WeChat Pay config")) {
      return NextResponse.json(
        { 
          error: "WeChat Pay is not configured", 
          detail: "Please contact support to enable WeChat Pay payments." 
        },
        { status: 503 }
      );
    }
    
    return NextResponse.json(
      { error: "Failed to create WeChat Pay order", detail: message },
      { status: 500 }
    );
  }
}
