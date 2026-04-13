"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";

function isWeChat(): boolean {
  if (typeof navigator === "undefined") return false;
  return /MicroMessenger/i.test(navigator.userAgent);
}

export default function WeChatGuard() {
  const [show, setShow] = useState(false);
  const pathname = usePathname();

  useEffect(() => {
    // Only block WeChat on pages that require Auth0 login (dashboard)
    // Public pages like /careers, /changelog, homepage etc. work fine in WeChat
    const needsAuth = pathname?.includes("/dashboard") || pathname?.includes("/auth");
    setShow(isWeChat() && !!needsAuth);
  }, [pathname]);

  if (!show) return null;

  return (
    <div className="fixed inset-0 z-[9999] bg-white flex items-center justify-center p-6">
      <div className="max-w-sm text-center">
        <div className="text-5xl mb-6">🌐</div>
        <h2 className="text-xl font-bold text-gray-900 mb-3">
          请使用系统浏览器打开
        </h2>
        <p className="text-sm text-gray-500 mb-6 leading-relaxed">
          微信内置浏览器不支持第三方登录。请点击右上角菜单
          <span className="inline-block mx-1 font-bold text-gray-700">⋯</span>
          选择「在浏览器中打开」或复制链接到 Safari / Chrome 打开。
        </p>
        <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 mb-4">
          <p className="text-xs text-gray-400 mb-1">当前页面链接</p>
          <p className="text-sm text-gray-700 font-mono break-all select-all">
            {typeof window !== "undefined" ? window.location.href : ""}
          </p>
        </div>
        <button
          onClick={() => {
            if (typeof navigator !== "undefined" && navigator.clipboard) {
              navigator.clipboard.writeText(window.location.href);
            }
          }}
          className="bg-red-800 hover:bg-red-900 text-white px-6 py-2.5 rounded-lg text-sm font-medium transition-colors"
        >
          复制链接
        </button>
      </div>
    </div>
  );
}
