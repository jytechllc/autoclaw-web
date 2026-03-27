"use client";

import { useState, useEffect, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import { useUser } from "@auth0/nextjs-auth0/client";
import QRCode from "qrcode";

export default function WeChatPayPage() {
  const searchParams = useSearchParams();
  const plan = searchParams.get("plan") || "growth";
  const { user, isLoading: userLoading } = useUser();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [orderData, setOrderData] = useState<{
    orderNo: string;
    qrCode: string;
    amount: number;
    plan: string;
  } | null>(null);
  const [paymentStatus, setPaymentStatus] = useState<string>("pending");
  const [qrCodeDataUrl, setQrCodeDataUrl] = useState<string | null>(null);

  // Create payment order
  useEffect(() => {
    if (userLoading) return;
    
    if (!user) {
      window.location.href = `/auth/login?returnTo=/wechat-pay?plan=${plan}`;
      return;
    }

    const createOrder = async () => {
      try {
        const response = await fetch("/api/wechat-pay", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ plan }),
        });

        if (!response.ok) {
          const errorData = await response.json();
          // Use detail message if available for configuration errors
          const errorMessage = errorData.detail || errorData.error || "Failed to create order";
          throw new Error(errorMessage);
        }

        const data = await response.json();
        setOrderData(data);

        // Generate QR code
        const qrDataUrl = await QRCode.toDataURL(data.qrCode, {
          width: 256,
          margin: 2,
        });
        setQrCodeDataUrl(qrDataUrl);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unknown error");
      } finally {
        setLoading(false);
      }
    };

    createOrder();
  }, [plan, user, userLoading]);

  // Poll payment status
  const checkPaymentStatus = useCallback(async () => {
    if (!orderData?.orderNo) return;

    try {
      const response = await fetch(`/api/wechat-pay/query?orderNo=${orderData.orderNo}`);
      if (!response.ok) return;

      const data = await response.json();
      setPaymentStatus(data.status);

      if (data.status === "success") {
        // Redirect to success page
        window.location.href = `/success?order_no=${orderData.orderNo}&method=wechat_pay`;
      }
    } catch (err) {
      console.error("Failed to check payment status:", err);
    }
  }, [orderData?.orderNo]);

  useEffect(() => {
    if (paymentStatus === "success" || paymentStatus === "closed") return;

    const interval = setInterval(checkPaymentStatus, 3000);
    return () => clearInterval(interval);
  }, [checkPaymentStatus, paymentStatus]);

  const planNames: Record<string, string> = {
    growth: "Growth",
    scale: "Scale",
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">Creating payment order...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center max-w-md mx-auto p-6">
          <div className="text-red-500 text-5xl mb-4">✕</div>
          <h1 className="text-xl font-semibold text-gray-900 mb-2">Payment Error</h1>
          <p className="text-gray-600 mb-4">{error}</p>
          <button
            onClick={() => window.location.reload()}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
          >
            Try Again
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 py-12 px-4">
      <div className="max-w-md mx-auto bg-white rounded-xl shadow-lg p-8">
        <h1 className="text-2xl font-bold text-center text-gray-900 mb-2">
          WeChat Pay
        </h1>
        <p className="text-center text-gray-600 mb-6">
          {planNames[plan] || plan} Plan - ¥{(orderData?.amount || 0) / 100}
        </p>

        {qrCodeDataUrl && (
          <div className="flex flex-col items-center">
            <div className="bg-white p-4 rounded-lg border-2 border-gray-200">
              <img
                src={qrCodeDataUrl}
                alt="WeChat Pay QR Code"
                className="w-64 h-64"
              />
            </div>
            <p className="mt-4 text-sm text-gray-600">
              Scan with WeChat to complete payment
            </p>
          </div>
        )}

        <div className="mt-6 text-center">
          <div className="inline-flex items-center space-x-2">
            <div
              className={`w-3 h-3 rounded-full ${
                paymentStatus === "pending"
                  ? "bg-yellow-400 animate-pulse"
                  : paymentStatus === "processing"
                  ? "bg-blue-400 animate-pulse"
                  : paymentStatus === "success"
                  ? "bg-green-400"
                  : "bg-gray-400"
              }`}
            />
            <span className="text-sm text-gray-600 capitalize">
              {paymentStatus === "pending" && "Waiting for payment..."}
              {paymentStatus === "processing" && "Processing payment..."}
              {paymentStatus === "success" && "Payment successful!"}
              {paymentStatus === "failed" && "Payment failed"}
              {paymentStatus === "closed" && "Payment cancelled"}
            </span>
          </div>
        </div>

        <div className="mt-6 text-center">
          <a
            href="/#pricing"
            className="text-sm text-gray-500 hover:text-gray-700 underline"
          >
            Cancel and return to pricing
          </a>
        </div>
      </div>
    </div>
  );
}
