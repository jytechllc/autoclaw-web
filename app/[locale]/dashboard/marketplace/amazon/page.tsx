"use client";

import { useParams } from "next/navigation";
import { useUser } from "@auth0/nextjs-auth0/client";
import DashboardShell from "@/components/DashboardShell";
import type { Locale } from "@/lib/i18n";

export default function AmazonMarketplacePage() {
  const params = useParams();
  const locale = (params.locale as Locale) || "en";
  const isZh = locale === "zh" || locale === "zh-TW";
  const { user } = useUser();

  return (
    <DashboardShell user={user || {}}>
      <div className="max-w-[900px] mx-auto p-4 sm:p-6">
        <div className="mb-8">
          <h1 className="text-2xl font-bold">{isZh ? "Amazon 索评完全指南" : "Complete Guide to Amazon Review Requests"}</h1>
          <p className="text-sm text-gray-500 mt-1">{isZh ? "掌握索评策略，提升 Review 转化率从 2% 到 8%+" : "Master review request strategy to boost review conversion from 2% to 8%+"}</p>
        </div>

        <article className="prose prose-gray max-w-none space-y-8">

          {/* Core Insight */}
          <div className="bg-gradient-to-r from-red-50 to-orange-50 border border-red-200 rounded-xl p-6 not-prose">
            <h2 className="text-lg font-bold text-red-800 mb-2">{isZh ? "核心洞察" : "Core Insight"}</h2>
            <p className="text-red-700 text-lg font-medium">
              {isZh
                ? "索评的最佳时机 = 用户已经满意，但还没忘记你"
                : "Best time to request = Customer is satisfied, but hasn't forgotten you yet"}
            </p>
            <p className="text-red-600 text-sm mt-2">
              {isZh
                ? "触发逻辑：下单 → 收货 → 使用 → 形成判断 → 索评（卡在\"刚形成判断那一刻\"）"
                : "Trigger: Order → Delivery → Use → Form opinion → Request (catch the exact moment)"}
            </p>
          </div>

          {/* Amazon Rules */}
          <section>
            <h2 className="text-xl font-semibold">{isZh ? "一、Amazon 官方规则（硬限制）" : "1. Amazon Official Rules"}</h2>
            <div className="bg-white border border-gray-200 rounded-xl p-5 mt-3 not-prose">
              <ul className="space-y-2 text-sm">
                <li className="flex items-start gap-2"><span className="text-red-500 font-bold">*</span>{isZh ? "只能在发货后 5–30 天内发送" : "Can only send 5-30 days after delivery"}</li>
                <li className="flex items-start gap-2"><span className="text-red-500 font-bold">*</span>{isZh ? "每个订单只能发一次索评请求" : "Only ONE request per order"}</li>
                <li className="flex items-start gap-2"><span className="text-red-500 font-bold">*</span>{isZh ? "不能提供激励换取好评" : "Cannot incentivize positive reviews"}</li>
                <li className="flex items-start gap-2"><span className="text-red-500 font-bold">*</span>{isZh ? "不能要求修改或删除差评" : "Cannot ask to modify or remove negative reviews"}</li>
              </ul>
            </div>
          </section>

          {/* Conversion Data */}
          <section>
            <h2 className="text-xl font-semibold">{isZh ? "二、转化率数据" : "2. Conversion Rate Data"}</h2>
            <p className="text-sm text-gray-600">{isZh ? "数据来源: eDesk, FeedbackWhiz 行业调研" : "Source: eDesk, FeedbackWhiz industry research"}</p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-3 not-prose">
              <div className="text-center p-4 bg-green-50 rounded-xl border border-green-200">
                <p className="text-2xl font-bold text-green-600">~6.2%</p>
                <p className="text-xs text-gray-500 mt-1">{isZh ? "第 5-7 天" : "Day 5-7"}</p>
                <p className="text-[10px] text-green-600 mt-0.5">{isZh ? "黄金窗口" : "Golden window"}</p>
              </div>
              <div className="text-center p-4 bg-yellow-50 rounded-xl border border-yellow-200">
                <p className="text-2xl font-bold text-yellow-600">~4.1%</p>
                <p className="text-xs text-gray-500 mt-1">{isZh ? "第 8-10 天" : "Day 8-10"}</p>
              </div>
              <div className="text-center p-4 bg-orange-50 rounded-xl border border-orange-200">
                <p className="text-2xl font-bold text-orange-600">~2.1%</p>
                <p className="text-xs text-gray-500 mt-1">{isZh ? "第 10-14 天" : "Day 10-14"}</p>
                <p className="text-[10px] text-orange-600 mt-0.5">{isZh ? "明显下降" : "Sharp decline"}</p>
              </div>
              <div className="text-center p-4 bg-red-50 rounded-xl border border-red-200">
                <p className="text-2xl font-bold text-red-500">~1.2%</p>
                <p className="text-xs text-gray-500 mt-1">{isZh ? "第 20+ 天" : "Day 20+"}</p>
              </div>
            </div>
          </section>

          {/* By Product Type */}
          <section>
            <h2 className="text-xl font-semibold">{isZh ? "三、按产品类型优化时间" : "3. Optimize Timing by Product Type"}</h2>
            <div className="overflow-x-auto mt-3 not-prose">
              <table className="w-full text-sm border border-gray-200 rounded-xl overflow-hidden">
                <thead>
                  <tr className="bg-gray-50">
                    <th className="text-left px-4 py-3 font-medium">{isZh ? "产品类型" : "Product Type"}</th>
                    <th className="text-left px-4 py-3 font-medium">{isZh ? "关怀时间" : "Care Message"}</th>
                    <th className="text-left px-4 py-3 font-medium">{isZh ? "索评时间" : "Review Request"}</th>
                    <th className="text-left px-4 py-3 font-medium">{isZh ? "原因" : "Why"}</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-t">
                    <td className="px-4 py-3">🥤 {isZh ? "快消品（食品/小商品）" : "Fast Consumer (food, small items)"}</td>
                    <td className="px-4 py-3 text-blue-600">{isZh ? "第 2 天" : "Day 2"}</td>
                    <td className="px-4 py-3 text-green-600 font-medium">{isZh ? "第 5 天" : "Day 5"}</td>
                    <td className="px-4 py-3 text-gray-500 text-xs">{isZh ? "已用完，记忆还新" : "Used quickly, memory fresh"}</td>
                  </tr>
                  <tr className="border-t bg-gray-50">
                    <td className="px-4 py-3">📱 {isZh ? "普通产品（电子/家居）" : "Standard (electronics, home)"}</td>
                    <td className="px-4 py-3 text-blue-600">{isZh ? "第 3 天" : "Day 3"}</td>
                    <td className="px-4 py-3 text-green-600 font-medium">{isZh ? "第 7 天" : "Day 7"}</td>
                    <td className="px-4 py-3 text-gray-500 text-xs">{isZh ? "需要体验时间" : "Needs experience time"}</td>
                  </tr>
                  <tr className="border-t">
                    <td className="px-4 py-3">🛋️ {isZh ? "大件/高客单价" : "High-value / Large items"}</td>
                    <td className="px-4 py-3 text-blue-600">{isZh ? "第 5 天" : "Day 5"}</td>
                    <td className="px-4 py-3 text-green-600 font-medium">{isZh ? "第 14 天" : "Day 14"}</td>
                    <td className="px-4 py-3 text-gray-500 text-xs">{isZh ? "需要长期使用评估" : "Needs long-term use"}</td>
                  </tr>
                  <tr className="border-t bg-gray-50">
                    <td className="px-4 py-3">💊 {isZh ? "功效类（补剂/护肤）" : "Efficacy (supplements, skincare)"}</td>
                    <td className="px-4 py-3 text-blue-600">{isZh ? "第 7 天" : "Day 7"}</td>
                    <td className="px-4 py-3 text-green-600 font-medium">{isZh ? "第 21 天" : "Day 21"}</td>
                    <td className="px-4 py-3 text-gray-500 text-xs">{isZh ? "需要看到效果" : "Needs to see results"}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>

          {/* Two-Stage Strategy */}
          <section>
            <h2 className="text-xl font-semibold">{isZh ? "四、两段式触发策略（推荐）" : "4. Two-Stage Strategy (Recommended)"}</h2>
            <p className="text-sm text-gray-600">{isZh ? "转化率最高的组合方式" : "Highest conversion combination"}</p>
            <div className="flex flex-col sm:flex-row items-center gap-4 mt-4 not-prose">
              <div className="flex-1 w-full bg-blue-50 border border-blue-200 rounded-xl p-6 text-center">
                <div className="text-3xl mb-2">💬</div>
                <h3 className="font-semibold text-blue-800 text-lg">{isZh ? "第 1 阶段：关怀" : "Stage 1: Care"}</h3>
                <p className="text-sm text-blue-600 mt-2">{isZh ? "发货后第 3 天" : "Day 3 after delivery"}</p>
                <div className="mt-3 text-left text-xs text-blue-700 bg-blue-100 rounded-lg p-3">
                  <p className="font-medium mb-1">{isZh ? "要点：" : "Key points:"}</p>
                  <ul className="space-y-1 list-disc pl-3">
                    <li>{isZh ? "不要索评，只问候关怀" : "Do NOT ask for review — just check in"}</li>
                    <li>{isZh ? "询问是否收到、是否有问题" : "Ask if received, any issues"}</li>
                    <li>{isZh ? "提供解决方案，减少差评风险" : "Offer solutions, reduce negative review risk"}</li>
                    <li>{isZh ? "建立好感和信任" : "Build rapport and trust"}</li>
                  </ul>
                </div>
              </div>
              <div className="text-2xl text-gray-300 rotate-90 sm:rotate-0">→</div>
              <div className="flex-1 w-full bg-green-50 border border-green-200 rounded-xl p-6 text-center">
                <div className="text-3xl mb-2">⭐</div>
                <h3 className="font-semibold text-green-800 text-lg">{isZh ? "第 2 阶段：索评" : "Stage 2: Review"}</h3>
                <p className="text-sm text-green-600 mt-2">{isZh ? "发货后第 7 天" : "Day 7 after delivery"}</p>
                <div className="mt-3 text-left text-xs text-green-700 bg-green-100 rounded-lg p-3">
                  <p className="font-medium mb-1">{isZh ? "要点：" : "Key points:"}</p>
                  <ul className="space-y-1 list-disc pl-3">
                    <li>{isZh ? "使用 Amazon 官方 \"Request a Review\" 按钮" : "Use Amazon's official \"Request a Review\" button"}</li>
                    <li>{isZh ? "或通过 SP-API Solicitations 接口自动触发" : "Or auto-trigger via SP-API Solicitations endpoint"}</li>
                    <li>{isZh ? "合规且转化率最高" : "Most compliant and highest conversion"}</li>
                  </ul>
                </div>
              </div>
            </div>
          </section>

          {/* How to Request */}
          <section>
            <h2 className="text-xl font-semibold">{isZh ? "五、如何发送索评" : "5. How to Send Review Requests"}</h2>

            <div className="space-y-4 mt-3 not-prose">
              {/* Manual */}
              <div className="bg-white border border-gray-200 rounded-xl p-5">
                <h3 className="font-medium mb-2">{isZh ? "方法 1：手动操作（免费）" : "Method 1: Manual (Free)"}</h3>
                <ol className="space-y-2 text-sm text-gray-600 list-decimal pl-5">
                  <li>{isZh ? "登录 Seller Central → 订单管理" : "Login Seller Central → Manage Orders"}</li>
                  <li>{isZh ? "找到目标订单 → 点击 \"Request a Review\"" : "Find target order → Click \"Request a Review\""}</li>
                  <li>{isZh ? "确认发送 → Amazon 自动发送标准化邮件" : "Confirm → Amazon sends standardized email"}</li>
                </ol>
                <p className="text-xs text-gray-400 mt-2">{isZh ? "适合小卖家，订单少时可以手动操作" : "Good for small sellers with few orders"}</p>
              </div>

              {/* SP-API */}
              <div className="bg-white border border-gray-200 rounded-xl p-5">
                <h3 className="font-medium mb-2">{isZh ? "方法 2：Amazon SP-API 自动化（免费）" : "Method 2: Amazon SP-API Automation (Free)"}</h3>
                <p className="text-sm text-gray-600 mb-3">{isZh ? "通过 Solicitations API 自动触发 \"Request a Review\"，完全免费" : "Auto-trigger via Solicitations API — completely free"}</p>
                <div className="bg-gray-900 rounded-lg p-4 text-xs font-mono text-green-400 overflow-x-auto">
                  <p className="text-gray-500"># {isZh ? "对订单发起索评" : "Request review for an order"}</p>
                  <p>POST /solicitations/v1/orders/{'{'}<span className="text-yellow-300">orderId</span>{'}'}/solicitations/productReviewAndSellerFeedback</p>
                </div>
                <div className="mt-3 text-xs text-gray-500">
                  <p className="font-medium">{isZh ? "申请步骤：" : "Setup steps:"}</p>
                  <ol className="list-decimal pl-4 mt-1 space-y-1">
                    <li>{isZh ? "注册 Amazon 开发者账号" : "Register Amazon Developer account"}</li>
                    <li>{isZh ? "创建 AWS IAM 角色" : "Create AWS IAM role"}</li>
                    <li>{isZh ? "在 Seller Central 注册应用，勾选 Solicitations 权限" : "Register app in Seller Central, select Solicitations permission"}</li>
                    <li>{isZh ? "通过 OAuth 获取 refresh_token" : "Get refresh_token via OAuth"}</li>
                    <li>{isZh ? "审核通过后即可调用（3-5 工作日）" : "Ready to use after approval (3-5 business days)"}</li>
                  </ol>
                </div>
              </div>

              {/* Third Party Tools */}
              <div className="bg-white border border-gray-200 rounded-xl p-5">
                <h3 className="font-medium mb-2">{isZh ? "方法 3：第三方工具" : "Method 3: Third-Party Tools"}</h3>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-left text-gray-500">
                        <th className="pb-2 font-medium">{isZh ? "工具" : "Tool"}</th>
                        <th className="pb-2 font-medium">{isZh ? "免费额度" : "Free Tier"}</th>
                        <th className="pb-2 font-medium">{isZh ? "特点" : "Features"}</th>
                      </tr>
                    </thead>
                    <tbody className="text-gray-600">
                      <tr className="border-b"><td className="py-2 font-medium">SageMailer</td><td className="py-2">200 {isZh ? "封/月" : "emails/mo"}</td><td className="py-2 text-xs">{isZh ? "自动触发 Request a Review" : "Auto-trigger Request a Review"}</td></tr>
                      <tr className="border-b"><td className="py-2 font-medium">AMZFinder</td><td className="py-2">100 {isZh ? "封/月" : "emails/mo"}</td><td className="py-2 text-xs">{isZh ? "索评 + 差评监控" : "Review request + negative review monitoring"}</td></tr>
                      <tr className="border-b"><td className="py-2 font-medium">FeedbackWhiz</td><td className="py-2">{isZh ? "30天试用" : "30-day trial"}</td><td className="py-2 text-xs">{isZh ? "按 SKU 分策略，灵活配置" : "Per-SKU strategy, flexible config"}</td></tr>
                      <tr className="border-b"><td className="py-2 font-medium">Jungle Scout</td><td className="py-2">{isZh ? "7天试用" : "7-day trial"}</td><td className="py-2 text-xs">{isZh ? "内置 Review Automation" : "Built-in Review Automation"}</td></tr>
                      <tr><td className="py-2 font-medium">Cashback Alert</td><td className="py-2">{isZh ? "免费基础版" : "Free basic"}</td><td className="py-2 text-xs">{isZh ? "索评 + 退款监控" : "Review + refund monitoring"}</td></tr>
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </section>

          {/* Advanced Tips */}
          <section>
            <h2 className="text-xl font-semibold">{isZh ? "六、高阶玩法：Review 增长系统" : "6. Advanced: Review Growth System"}</h2>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-3 not-prose">
              <div className="bg-white border border-gray-200 rounded-xl p-5">
                <div className="text-2xl mb-2">📦</div>
                <h3 className="font-medium text-sm">{isZh ? "包装引导" : "Packaging"}</h3>
                <p className="text-xs text-gray-500 mt-1">{isZh ? "在包装内放一张精美的感谢卡，引导用户扫码联系客服（不能直接索评）。建立售后通道，减少差评。" : "Include a thank-you card guiding users to contact support (not review). Build after-sales channel to reduce negative reviews."}</p>
              </div>
              <div className="bg-white border border-gray-200 rounded-xl p-5">
                <div className="text-2xl mb-2">🛡️</div>
                <h3 className="font-medium text-sm">{isZh ? "差评防御" : "Negative Review Defense"}</h3>
                <p className="text-xs text-gray-500 mt-1">{isZh ? "关怀消息在索评前发送，先拦截不满客户。提供解决方案后，不满客户不会留差评。比索评更重要。" : "Send care messages before review requests. Intercept unhappy customers first. More important than getting reviews."}</p>
              </div>
              <div className="bg-white border border-gray-200 rounded-xl p-5">
                <div className="text-2xl mb-2">📊</div>
                <h3 className="font-medium text-sm">{isZh ? "数据优化" : "Data Optimization"}</h3>
                <p className="text-xs text-gray-500 mt-1">{isZh ? "跟踪每个 SKU 的索评转化率，针对低转化 SKU 调整触发时间。目标：从 2% 提升到 8%+。" : "Track review conversion per SKU, adjust timing for low performers. Target: improve from 2% to 8%+."}</p>
              </div>
            </div>
          </section>

          {/* Coming Soon */}
          <div className="bg-gray-50 border border-gray-200 rounded-xl p-6 text-center not-prose">
            <p className="text-2xl mb-2">🚀</p>
            <h3 className="font-semibold">{isZh ? "自动化索评功能即将上线" : "Automated Review Request Coming Soon"}</h3>
            <p className="text-sm text-gray-500 mt-1">{isZh ? "我们正在集成 Amazon SP-API，届时可以在 AutoClaw 中一键自动索评" : "We're integrating Amazon SP-API for one-click automated review requests in AutoClaw"}</p>
          </div>

        </article>
      </div>
    </DashboardShell>
  );
}
