"use client";

import { useEffect, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { getDictionary } from "@/lib/i18n";

function SuccessContent({
  t,
  locale,
}: {
  t: {
    verifyingPayment: string;
    verificationFailed: string;
    paymentSuccessful: string;
    thankYouSubscribe: string;
    accountUpgraded: string;
    plan: string;
    orderNumber: string;
    goToDashboard: string;
    returnHome: string;
  };
  locale: string;
}) {
  const searchParams = useSearchParams();
  const sessionId = searchParams.get("session_id");
  const orderNo = searchParams.get("order_no");
  const method = searchParams.get("method");

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [paymentInfo, setPaymentInfo] = useState<{
    plan?: string;
    amount?: number;
    status?: string;
  } | null>(null);

  useEffect(() => {
    const verifyPayment = async () => {
      try {
        if (method === "wechat_pay" && orderNo) {
          const response = await fetch(`/api/wechat-pay/query?orderNo=${orderNo}`);
          if (response.ok) {
            const data = await response.json();
            setPaymentInfo({
              plan: data.plan,
              amount: data.amount,
              status: data.status,
            });
          } else {
            let errorMessage = t.verificationFailed;
            try {
              const errorData = await response.json();
              if (errorData.error) {
                errorMessage = errorData.error;
              }
            } catch {
              errorMessage = `${t.verificationFailed} (${response.status})`;
            }
            setError(errorMessage);
          }
        } else if (sessionId) {
          setPaymentInfo({ status: "success" });
        } else {
          setPaymentInfo({ status: "success" });
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unknown error");
      } finally {
        setLoading(false);
      }
    };

    verifyPayment();
  }, [sessionId, orderNo, method, t.verificationFailed]);

  if (loading) {
    return (
      <div className="text-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-green-600 mx-auto"></div>
        <p className="mt-4 text-gray-600">{t.verifyingPayment}</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center">
        <div className="text-red-500 text-5xl mb-4">✕</div>
        <h1 className="text-xl font-semibold text-gray-900 mb-2">{t.verificationFailed}</h1>
        <p className="text-gray-600 mb-4">{error}</p>
        <Link
          href={`/${locale}`}
          className="inline-block px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700"
        >
          {t.returnHome}
        </Link>
      </div>
    );
  }

  const isWechatPay = method === "wechat_pay";
  const amountText = isWechatPay && paymentInfo?.amount
    ? `¥${(paymentInfo.amount / 100).toFixed(2)}`
    : "";

  return (
    <>
      <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-6">
        <svg className="w-8 h-8 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
        </svg>
      </div>
      <h1 className="text-3xl font-bold mb-4">{t.paymentSuccessful}</h1>
      <p className="text-gray-500 mb-8">
        {t.thankYouSubscribe}{amountText && ` (${amountText})`}.{t.accountUpgraded}
      </p>

      {paymentInfo?.plan && (
        <div className="bg-gray-50 rounded-lg p-4 mb-6 text-left max-w-sm mx-auto">
          <p className="text-sm text-gray-500">{t.plan}</p>
          <p className="font-semibold capitalize">{paymentInfo.plan}</p>
          {orderNo && (
            <>
              <p className="text-sm text-gray-500 mt-2">{t.orderNumber}</p>
              <p className="font-mono text-sm">{orderNo}</p>
            </>
          )}
        </div>
      )}

      <div className="space-y-3">
        <Link
          href={`/${locale}/dashboard`}
          className="block w-full px-4 py-3 bg-red-800 text-white rounded-lg hover:bg-red-900 font-medium"
        >
          {t.goToDashboard}
        </Link>
        <Link
          href={`/${locale}`}
          className="block w-full px-4 py-3 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 font-medium"
        >
          {t.returnHome}
        </Link>
      </div>
    </>
  );
}

export default function SuccessPage({
  params,
}: {
  params: { locale: string };
}) {
  const dict = getDictionary(params.locale);

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="max-w-md text-center px-6">
        <Suspense fallback={
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-green-600 mx-auto"></div>
            <p className="mt-4 text-gray-600">Loading...</p>
          </div>
        }>
          <SuccessContent
            t={{
              verifyingPayment: dict.landing?.verifyingPayment || "Verifying payment...",
              verificationFailed: dict.landing?.verificationFailed || "Verification Failed",
              paymentSuccessful: dict.landing?.paymentSuccessful || "Payment Successful!",
              thankYouSubscribe: dict.landing?.thankYouSubscribe || "Thank you for subscribing to AutoClaw",
              accountUpgraded: dict.landing?.accountUpgraded || "Your account has been upgraded.",
              plan: dict.landing?.plan || "Plan",
              orderNumber: dict.landing?.orderNumber || "Order Number",
              goToDashboard: dict.landing?.goToDashboard || "Go to Dashboard",
              returnHome: dict.landing?.returnHome || "Return Home",
            }}
            locale={params.locale}
          />
        </Suspense>
      </div>
    </div>
  );
}
