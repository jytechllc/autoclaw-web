/**
 * Read-only view over the autoclaw-stock simulation state in S3
 * (see /Users/wlin/dev/autoclaw/autoclaw-stock — Lambda writes, we read).
 * Uses the same AWS env credentials as lib/ai.ts; IAM policy grants
 * s3:GetObject/ListBucket on the state bucket only.
 */
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";

const BUCKET = process.env.STOCK_SIM_BUCKET || "autoclaw-stock-state-463470941244";
const REGION = process.env.STOCK_SIM_REGION || "us-east-1";

export const STARTING_CAPITAL = 50_000;

export const SIM_MODELS = [
  { id: "nova-lite", vendor: "Amazon", label: "Nova Lite" },
  { id: "llama-8b", vendor: "Meta", label: "Llama 3.1 8B" },
  { id: "mistral-sm", vendor: "Mistral", label: "Mistral Small" },
  { id: "claude-haiku", vendor: "Anthropic", label: "Claude Haiku 4.5" },
] as const;

export interface NavRecord {
  date: string;
  navByModel: Record<string, number>;
}
export interface SimPortfolio {
  modelId: string;
  cash: number;
  positions: Record<string, number>;
  createdAt: string;
}
export interface SimTrade {
  modelId: string;
  side: "buy" | "sell";
  symbol: string;
  shares: number;
  price: number;
  at: string;
}
export interface SimJournalEntry {
  at: string;
  note: string;
}

export interface LeaderboardRow {
  rank: number;
  id: string;
  label: string;
  vendor: string;
  nav: number;
  dayPct: number | null;
  weekPct: number | null;
  monthPct: number | null;
  totalPct: number;
  cash: number;
  positions: Record<string, number>;
  lastNote: string | null;
  recentTrades: SimTrade[];
}

export interface StockSimData {
  asOf: string | null;
  tradingDays: number;
  rows: LeaderboardRow[];
  navHistory: NavRecord[];
  bedrockSpentUSD: number;
  budgetUSD: number;
}

function s3(): S3Client | null {
  const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
  const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;
  if (!accessKeyId || !secretAccessKey) return null;
  return new S3Client({ region: REGION, credentials: { accessKeyId, secretAccessKey } });
}

async function readKey<T>(client: S3Client | null, key: string, fallback: T): Promise<T> {
  if (!client) return fallback;
  try {
    const r = await client.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
    return JSON.parse(await r.Body!.transformToString()) as T;
  } catch {
    return fallback;
  }
}

function pct(now: number, base: number | undefined | null): number | null {
  if (base == null || !base) return null;
  return ((now - base) / base) * 100;
}

export async function getStockSimData(): Promise<StockSimData> {
  const client = s3();

  const hist = (await readKey<NavRecord[]>(client, "nav-history.json", [])).sort((a, b) =>
    a.date.localeCompare(b.date)
  );
  const latest = hist.length ? hist[hist.length - 1] : null;
  const month = (latest?.date ?? new Date().toISOString().slice(0, 10)).slice(0, 7);

  const [budget, ...perModel] = await Promise.all([
    readKey<{ spent: number }>(client, `budget/${month}.json`, { spent: 0 }),
    ...SIM_MODELS.map(async (m) => {
      const [portfolio, trades, journal] = await Promise.all([
        readKey<SimPortfolio | null>(client, `portfolios/${m.id}.json`, null),
        readKey<SimTrade[]>(client, `trades/${m.id}.json`, []),
        readKey<SimJournalEntry[]>(client, `journal/${m.id}.json`, []),
      ]);
      return { spec: m, portfolio, trades, journal };
    }),
  ]);

  const windowBase = (days: number) => (hist.length ? hist[Math.max(0, hist.length - 1 - days)] : null);
  const dayBase = hist.length >= 2 ? hist[hist.length - 2] : null;
  const weekBase = hist.length >= 2 ? windowBase(5) : null;
  const monthBase = hist.length >= 2 ? windowBase(21) : null;

  const rows = perModel
    .map(({ spec, portfolio, trades, journal }) => {
      const nav = latest?.navByModel[spec.id] ?? STARTING_CAPITAL;
      return {
        id: spec.id,
        label: spec.label,
        vendor: spec.vendor,
        nav,
        dayPct: pct(nav, dayBase?.navByModel[spec.id]),
        weekPct: pct(nav, weekBase?.navByModel[spec.id]),
        monthPct: pct(nav, monthBase?.navByModel[spec.id]),
        totalPct: ((nav - STARTING_CAPITAL) / STARTING_CAPITAL) * 100,
        cash: portfolio?.cash ?? STARTING_CAPITAL,
        positions: portfolio?.positions ?? {},
        lastNote: journal.length ? journal[journal.length - 1].note : null,
        recentTrades: trades.slice(-5).reverse(),
      };
    })
    .sort((a, b) => b.nav - a.nav)
    .map((r, i) => ({ ...r, rank: i + 1 }));

  return {
    asOf: latest?.date ?? null,
    tradingDays: hist.length,
    rows,
    navHistory: hist,
    bedrockSpentUSD: budget.spent,
    budgetUSD: 9,
  };
}
