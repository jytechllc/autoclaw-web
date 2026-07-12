import Link from "next/link";
import { notFound } from "next/navigation";
import { isValidLocale } from "@/lib/i18n";
import { getStockSimData, STARTING_CAPITAL, type LeaderboardRow } from "@/lib/stock-sim";

export const revalidate = 300; // refresh from S3 at most every 5 minutes

export const metadata = {
  title: "LLM Trading Arena – AutoClaw",
  description:
    "Four AI models, $50K virtual capital each, real market quotes. A live experiment comparing LLM decision quality — updated every trading day.",
};

const t = {
  en: {
    heading: "LLM Trading Arena",
    tagline:
      "Four AI models each manage $50,000 of virtual capital against real market quotes. Every trading day they research, decide, and trade on their own. Same rules, same money — whose judgment wins?",
    disclaimer: "Research experiment with virtual fills. Not investment advice, no real brokerage.",
    backtestNote:
      "History before 2026-07-05 is a backtest replay: one end-of-day decision per trading day at historical closing prices, with news results date-bounded to the simulated day. Live daily trading since then.",
    leaderboard: "Leaderboard",
    model: "Model",
    vendor: "Vendor",
    nav: "NAV",
    day: "Day",
    week: "Week",
    month: "Month",
    total: "Total",
    asOf: "as of",
    tradingDays: "trading days",
    noData: "No trading days recorded yet — the first session runs on the next market weekday at 4:15pm ET.",
    positions: "Positions",
    allCash: "all cash",
    cash: "Cash",
    recentTrades: "Recent trades",
    noTrades: "no executed trades yet",
    lastNote: "Latest journal note",
    spend: "Bedrock spend this month",
    budget: "budget cap",
    backHome: "← AutoClaw home",
  },
  zh: {
    heading: "大模型炒股竞技场",
    tagline:
      "四个 AI 模型各自管理 $50,000 虚拟本金，用真实行情撮合。每个交易日它们自主研究、决策、下单。同样的规则、同样的资金——谁的判断更好？",
    disclaimer: "研究实验，全程虚拟撮合。非投资建议，不接真实券商。",
    backtestNote:
      "2026-07-05 之前的历史为回测重放：每个交易日一次收盘决策，按当日历史收盘价撮合，新闻检索限定在模拟日期之前。此后为每日实盘模拟。",
    leaderboard: "排行榜",
    model: "模型",
    vendor: "厂商",
    nav: "净值",
    day: "日",
    week: "周",
    month: "月",
    total: "总",
    asOf: "截至",
    tradingDays: "个交易日",
    noData: "暂无交易日记录——首个交易日将在下个交易日（美东 16:15）自动运行。",
    positions: "持仓",
    allCash: "全部现金",
    cash: "现金",
    recentTrades: "近期成交",
    noTrades: "暂无实际成交",
    lastNote: "最新交易日志",
    spend: "本月 Bedrock 开销",
    budget: "预算上限",
    backHome: "← 返回 AutoClaw 首页",
  },
} as const;

type Dict = (typeof t)[keyof typeof t];

function fmtPct(v: number | null): string {
  if (v == null) return "—";
  const s = v >= 0 ? "+" : "";
  return `${s}${v.toFixed(2)}%`;
}

function pctColor(v: number | null): string {
  if (v == null || Math.abs(v) < 0.005) return "text-gray-400";
  return v > 0 ? "text-emerald-500" : "text-red-500";
}

function ModelCard({ row, dict }: { row: LeaderboardRow; dict: Dict }) {
  const positions = Object.entries(row.positions);
  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-800 p-5 flex flex-col gap-3">
      <div className="flex items-baseline justify-between">
        <div>
          <span className="text-2xl font-semibold mr-2">#{row.rank}</span>
          <span className="text-lg font-medium">{row.label}</span>
          <span className="ml-2 text-sm text-gray-500">{row.vendor}</span>
        </div>
        <div className="text-right">
          <div className="text-lg font-semibold">${Math.round(row.nav).toLocaleString()}</div>
          <div className={`text-sm ${pctColor(row.totalPct)}`}>{fmtPct(row.totalPct)}</div>
        </div>
      </div>

      <div className="text-sm">
        <span className="text-gray-500">{dict.positions}: </span>
        {positions.length === 0 ? (
          <span className="text-gray-400">{dict.allCash}</span>
        ) : (
          positions.map(([sym, sh]) => (
            <span key={sym} className="inline-block mr-2 rounded bg-gray-100 dark:bg-gray-800 px-2 py-0.5">
              {sym} × {sh}
            </span>
          ))
        )}
        <span className="text-gray-500 ml-1">
          {dict.cash} ${Math.round(row.cash).toLocaleString()}
        </span>
      </div>

      <div className="text-sm">
        <div className="text-gray-500 mb-1">{dict.recentTrades}</div>
        {row.recentTrades.length === 0 ? (
          <div className="text-gray-400">{dict.noTrades}</div>
        ) : (
          <ul className="space-y-0.5 font-mono text-xs">
            {row.recentTrades.map((tr, i) => (
              <li key={i}>
                <span className={tr.side === "buy" ? "text-emerald-600" : "text-red-500"}>
                  {tr.side.toUpperCase()}
                </span>{" "}
                {tr.shares} {tr.symbol} @ ${tr.price.toFixed(2)}
                <span className="text-gray-400 ml-1">{tr.at}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {row.lastNote && (
        <div className="text-sm border-t border-gray-100 dark:border-gray-800 pt-2">
          <div className="text-gray-500 mb-1">{dict.lastNote}</div>
          <p className="text-gray-600 dark:text-gray-300 italic line-clamp-3">“{row.lastNote}”</p>
        </div>
      )}
    </div>
  );
}

export default async function StockSimPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isValidLocale(locale)) notFound();
  const dict = locale === "zh" || locale === "zh-TW" ? t.zh : t.en;

  const data = await getStockSimData();

  return (
    <main className="mx-auto max-w-4xl px-4 py-10">
      <Link href={`/${locale}`} className="text-sm text-gray-500 hover:underline">
        {dict.backHome}
      </Link>
      <h1 className="mt-4 text-3xl font-bold">{dict.heading}</h1>
      <p className="mt-3 text-gray-600 dark:text-gray-300">{dict.tagline}</p>
      <p className="mt-2 text-xs text-gray-400">{dict.disclaimer}</p>
      <p className="mt-1 text-xs text-gray-400">{dict.backtestNote}</p>

      <section className="mt-8">
        <div className="flex items-baseline justify-between">
          <h2 className="text-xl font-semibold">{dict.leaderboard}</h2>
          {data.asOf && (
            <span className="text-sm text-gray-500">
              {dict.asOf} {data.asOf} · {data.tradingDays} {dict.tradingDays}
            </span>
          )}
        </div>

        {data.tradingDays === 0 ? (
          <p className="mt-4 text-gray-500">{dict.noData}</p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 dark:border-gray-800 text-left text-gray-500">
                  <th className="py-2 pr-3">#</th>
                  <th className="py-2 pr-3">{dict.model}</th>
                  <th className="py-2 pr-3">{dict.vendor}</th>
                  <th className="py-2 pr-3 text-right">{dict.nav}</th>
                  <th className="py-2 pr-3 text-right">{dict.day}</th>
                  <th className="py-2 pr-3 text-right">{dict.week}</th>
                  <th className="py-2 pr-3 text-right">{dict.month}</th>
                  <th className="py-2 text-right">{dict.total}</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r) => (
                  <tr key={r.id} className="border-b border-gray-100 dark:border-gray-900">
                    <td className="py-2 pr-3">{r.rank}</td>
                    <td className="py-2 pr-3 font-medium">{r.label}</td>
                    <td className="py-2 pr-3 text-gray-500">{r.vendor}</td>
                    <td className="py-2 pr-3 text-right font-mono">${Math.round(r.nav).toLocaleString()}</td>
                    <td className={`py-2 pr-3 text-right font-mono ${pctColor(r.dayPct)}`}>{fmtPct(r.dayPct)}</td>
                    <td className={`py-2 pr-3 text-right font-mono ${pctColor(r.weekPct)}`}>{fmtPct(r.weekPct)}</td>
                    <td className={`py-2 pr-3 text-right font-mono ${pctColor(r.monthPct)}`}>{fmtPct(r.monthPct)}</td>
                    <td className={`py-2 text-right font-mono ${pctColor(r.totalPct)}`}>{fmtPct(r.totalPct)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="mt-8 grid gap-4 sm:grid-cols-2">
        {data.rows.map((r) => (
          <ModelCard key={r.id} row={r} dict={dict} />
        ))}
      </section>

      <footer className="mt-10 text-sm text-gray-500">
        {dict.spend}: ${data.bedrockSpentUSD.toFixed(2)} / ${data.budgetUSD.toFixed(0)} {dict.budget} · $
        {STARTING_CAPITAL.toLocaleString()} × {data.rows.length}
      </footer>
    </main>
  );
}
