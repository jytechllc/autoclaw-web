"use client";

import { useParams } from "next/navigation";
import { useUser } from "@auth0/nextjs-auth0/client";
import DashboardShell from "@/components/DashboardShell";
import type { Locale } from "@/lib/i18n";

export default function DKWholesalePage() {
  const params = useParams();
  const locale = (params.locale as Locale) || "en";
  const isZh = locale === "zh" || locale === "zh-TW";
  const { user } = useUser();

  return (
    <DashboardShell user={user || {}}>
      <div className="max-w-[800px] mx-auto p-4 sm:p-6">
        <div className="text-center py-20">
          <div className="text-6xl mb-6">🏪</div>
          <h1 className="text-3xl font-bold mb-3">DK Wholesale</h1>
          <p className="text-gray-500 text-lg mb-6">
            {isZh
              ? "B2B 批发平台整合即将上线"
              : "B2B Wholesale Platform Integration Coming Soon"}
          </p>

          <div className="bg-white border border-gray-200 rounded-xl p-6 max-w-lg mx-auto text-left">
            <h2 className="font-semibold mb-3">{isZh ? "即将支持" : "Coming Soon"}</h2>
            <ul className="space-y-3 text-sm text-gray-600">
              <li className="flex items-start gap-2">
                <span className="text-green-500 mt-0.5">&#10003;</span>
                {isZh ? "产品同步 — 一键同步 AutoClaw 产品到 DK Wholesale" : "Product Sync — Sync AutoClaw products to DK Wholesale"}
              </li>
              <li className="flex items-start gap-2">
                <span className="text-green-500 mt-0.5">&#10003;</span>
                {isZh ? "库存管理 — 实时同步库存数量" : "Inventory Management — Real-time inventory sync"}
              </li>
              <li className="flex items-start gap-2">
                <span className="text-green-500 mt-0.5">&#10003;</span>
                {isZh ? "订单追踪 — 跟踪 DK Wholesale 订单状态" : "Order Tracking — Track DK Wholesale order status"}
              </li>
              <li className="flex items-start gap-2">
                <span className="text-green-500 mt-0.5">&#10003;</span>
                {isZh ? "价格管理 — 统一管理多渠道价格" : "Pricing — Unified multi-channel pricing"}
              </li>
            </ul>
          </div>

          <a
            href="https://beta.dkwholesale.us/en"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-block mt-6 bg-red-700 hover:bg-red-800 text-white px-6 py-3 rounded-lg font-medium transition-colors"
          >
            {isZh ? "访问 DK Wholesale" : "Visit DK Wholesale"} →
          </a>
        </div>
      </div>
    </DashboardShell>
  );
}
