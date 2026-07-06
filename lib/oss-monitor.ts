/**
 * OSS Model Watch — daily Hugging Face scan: new releases from watched orgs +
 * global trending, diffed against the previous scan, rendered as a markdown
 * report with a short Bedrock Haiku commentary. Market intelligence for model
 * selection — AutoClaw serves inference via Bedrock and does not self-host.
 *
 * State (seen.json, trending.json, reports/*.md) lives in OSSMON_BUCKET (S3);
 * without the env it falls back to ./state/oss-monitor for local dev.
 * Triggered by .github/workflows/cron-maintenance.yml → /api/cron/oss-model-watch.
 */
import { BedrockRuntimeClient, ConverseCommand } from "@aws-sdk/client-bedrock-runtime";
import { S3Client, GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";

// ---------- config ----------

const WATCHED_ORGS = [
  "meta-llama",
  "mistralai",
  "Qwen",
  "deepseek-ai",
  "google", // Gemma
  "microsoft", // Phi
  "zai-org", // GLM
  "moonshotai", // Kimi
  "openbmb", // MiniCPM
  "allenai", // OLMo
  "nvidia",
  "ibm-granite",
];

const PER_ORG_LIMIT = 20;
const TRENDING_LIMIT = 20;

// Only these pipeline tags count; empty tag is kept (fresh releases often
// have none yet).
const PIPELINE_TAGS = new Set([
  "text-generation",
  "image-text-to-text",
  "any-to-any",
  "automatic-speech-recognition",
  "text-to-image",
  "text-to-video",
]);

// Same region/credential convention as lib/ai.ts ("us." cross-region profile).
const AWS_BEDROCK_REGION = process.env.AWS_BEDROCK_REGION || "us-east-2";
const SUMMARY_MODEL_ID = "us.anthropic.claude-haiku-4-5-20251001-v1:0";
const SUMMARY_MAX_TOKENS = 900;

const HF_API = "https://huggingface.co/api/models";

// ---------- Hugging Face feeds ----------

export interface HFModel {
  id: string; // "org/name"
  likes: number;
  downloads: number;
  pipeline_tag?: string;
  createdAt?: string;
}

async function getJSON(url: string): Promise<any[]> {
  const r = await fetch(url, { headers: { "user-agent": "autoclaw-oss-monitor/0.1" } });
  if (!r.ok) throw new Error(`HF API ${r.status} for ${url}`);
  return (await r.json()) as any[];
}

function toModel(raw: any): HFModel {
  return {
    id: raw.id ?? raw.modelId,
    likes: raw.likes ?? 0,
    downloads: raw.downloads ?? 0,
    pipeline_tag: raw.pipeline_tag,
    createdAt: raw.createdAt,
  };
}

const relevant = (m: HFModel) => !m.pipeline_tag || PIPELINE_TAGS.has(m.pipeline_tag);

/** Newest repos across watched orgs, newest first. A failing org is skipped
 * so one flaky feed doesn't kill the scan. */
async function fetchOrgReleases(): Promise<HFModel[]> {
  const all: HFModel[] = [];
  for (const org of WATCHED_ORGS) {
    const url = `${HF_API}?author=${encodeURIComponent(org)}&sort=createdAt&direction=-1&limit=${PER_ORG_LIMIT}`;
    try {
      all.push(...(await getJSON(url)).map(toModel).filter(relevant));
    } catch (e) {
      console.error(`[oss-monitor] skip org ${org}: ${(e as Error).message}`);
    }
  }
  return all.sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
}

async function fetchTrending(): Promise<HFModel[]> {
  return (await getJSON(`${HF_API}?sort=trendingScore&direction=-1&limit=${TRENDING_LIMIT}`)).map(toModel);
}

// ---------- diff ----------

export type SeenMap = Record<string, string>; // model id → first-seen ISO date

export interface DiffResult {
  isBaseline: boolean;
  newReleases: HFModel[];
  trendingEnters: HFModel[]; // in trending now, absent from previous snapshot
  trending: HFModel[];
}

const DAY = 24 * 60 * 60 * 1000;

/** Pure diff vs prior state. First scan is a BASELINE: everything becomes
 * seen, and only last-7-day repos are reported (else all history is "new"). */
export function diffScan(
  orgModels: HFModel[],
  trending: HFModel[],
  seen: SeenMap,
  prevTrendingIds: string[],
  today: string,
  now: number
): { result: DiffResult; seen: SeenMap } {
  const isBaseline = Object.keys(seen).length === 0;
  const nextSeen: SeenMap = { ...seen };

  const fresh = orgModels.filter((m) => !seen[m.id]);
  for (const m of orgModels) if (!nextSeen[m.id]) nextSeen[m.id] = today;

  const newReleases = isBaseline
    ? fresh.filter((m) => m.createdAt && now - Date.parse(m.createdAt) < 7 * DAY)
    : fresh;

  const prev = new Set(prevTrendingIds);
  const trendingEnters = prev.size === 0 ? [] : trending.filter((m) => !prev.has(m.id));

  return { result: { isBaseline, newReleases, trendingEnters, trending }, seen: nextSeen };
}

// ---------- report ----------

const fmtN = (n: number) =>
  n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(1)}K` : `${n}`;

const TABLE_HEAD = `| Model | Task | Created | Likes | Downloads |\n|---|---|---|---|---|`;

function row(m: HFModel): string {
  const date = m.createdAt ? m.createdAt.slice(0, 10) : "?";
  return `| [${m.id}](https://huggingface.co/${m.id}) | ${m.pipeline_tag ?? "-"} | ${date} | ${fmtN(m.likes)} | ${fmtN(m.downloads)} |`;
}

export function renderReport(r: DiffResult, today: string, aiSummary: string | null): string {
  const lines: string[] = [`# OSS Model Watch — ${today}`, ""];
  if (r.isBaseline) lines.push(`> First scan: baseline established. Only last-7-day releases are listed below.`, "");

  if (aiSummary) lines.push(`## 分析摘要 (Haiku)`, "", aiSummary, "");

  lines.push(`## New releases from watched orgs (${r.newReleases.length})`, "");
  if (r.newReleases.length) lines.push(TABLE_HEAD, ...r.newReleases.map(row), "");
  else lines.push("_none_", "");

  if (r.trendingEnters.length) {
    lines.push(`## Entered trending since last scan (${r.trendingEnters.length})`, "", TABLE_HEAD, ...r.trendingEnters.map(row), "");
  }

  lines.push(`## Trending top ${r.trending.length}`, "", TABLE_HEAD, ...r.trending.map(row), "");
  return lines.join("\n");
}

/** Compact plain-text diff fed to the Bedrock summarizer. */
function digestForAI(r: DiffResult, today: string): string {
  const item = (m: HFModel) =>
    `- ${m.id} (${m.pipeline_tag ?? "?"}, likes ${m.likes}, downloads ${m.downloads}, created ${m.createdAt?.slice(0, 10) ?? "?"})`;
  return [
    `Date: ${today}`,
    `New releases from watched orgs:`,
    ...(r.newReleases.length ? r.newReleases.slice(0, 30).map(item) : ["(none)"]),
    `Newly trending:`,
    ...(r.trendingEnters.length ? r.trendingEnters.map(item) : ["(none)"]),
    `Current trending top:`,
    ...r.trending.slice(0, 10).map(item),
  ].join("\n");
}

// ---------- Bedrock commentary (max 1 cheap Haiku call per scan) ----------

const SUMMARY_SYSTEM = `You are the open-source model intelligence analyst for AutoClaw, an AIaaS platform that serves all LLM traffic through AWS Bedrock (we never self-host). Given today's new open-source model releases and the trending list, write a short digest in Chinese (3-6 bullet points): what shipped, why it matters, and whether anything looks worth evaluating on Bedrock when it becomes available there. Be concrete and skeptical; skip hype. If nothing notable, say so in one line.`;

async function summarize(digestData: string): Promise<string | null> {
  if (process.env.OSSMON_NO_AI === "1") return null;
  try {
    const client = new BedrockRuntimeClient({ region: AWS_BEDROCK_REGION });
    const resp = await client.send(
      new ConverseCommand({
        modelId: SUMMARY_MODEL_ID,
        system: [{ text: SUMMARY_SYSTEM }],
        messages: [{ role: "user", content: [{ text: digestData }] }],
        inferenceConfig: { maxTokens: SUMMARY_MAX_TOKENS, temperature: 0.3 },
      })
    );
    const parts = resp.output?.message?.content ?? [];
    const text = parts.map((c) => ("text" in c ? c.text : "")).join("").trim();
    return text || null;
  } catch (e) {
    console.error(`[oss-monitor] summary skipped: ${(e as Error).message}`);
    return null;
  }
}

// ---------- state (S3 via OSSMON_BUCKET; local ./state/oss-monitor in dev) ----------

const s3 = () => new S3Client({ region: process.env.OSSMON_REGION || "us-east-1" });

async function readJSON<T>(key: string, fallback: T): Promise<T> {
  const bucket = process.env.OSSMON_BUCKET;
  if (bucket) {
    try {
      const r = await s3().send(new GetObjectCommand({ Bucket: bucket, Key: key }));
      return JSON.parse(await r.Body!.transformToString()) as T;
    } catch {
      return fallback;
    }
  }
  try {
    const fs = await import("fs/promises");
    const path = await import("path");
    return JSON.parse(await fs.readFile(path.join(process.cwd(), "state/oss-monitor", key), "utf8")) as T;
  } catch {
    return fallback;
  }
}

async function writeText(key: string, body: string, contentType: string): Promise<void> {
  const bucket = process.env.OSSMON_BUCKET;
  if (bucket) {
    await s3().send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: contentType }));
    return;
  }
  const fs = await import("fs/promises");
  const path = await import("path");
  const fp = path.join(process.cwd(), "state/oss-monitor", key);
  await fs.mkdir(path.dirname(fp), { recursive: true });
  await fs.writeFile(fp, body, "utf8");
}

const writeJSON = (key: string, data: unknown) =>
  writeText(key, JSON.stringify(data, null, 2), "application/json");

// ---------- entry ----------

export interface ScanOutcome {
  reportKey: string;
  newCount: number;
  trendingEnterCount: number;
  isBaseline: boolean;
}

export async function runOssScan(): Promise<ScanOutcome> {
  const now = Date.now();
  const today = new Date(now).toISOString().slice(0, 10);

  const [orgModels, trending] = await Promise.all([fetchOrgReleases(), fetchTrending()]);
  const seen = await readJSON<SeenMap>("seen.json", {});
  const prevTrendingIds = await readJSON<string[]>("trending.json", []);

  const { result, seen: nextSeen } = diffScan(orgModels, trending, seen, prevTrendingIds, today, now);

  const aiSummary = result.isBaseline ? null : await summarize(digestForAI(result, today));
  const report = renderReport(result, today, aiSummary);

  const reportKey = `reports/${today}.md`;
  await writeJSON("seen.json", nextSeen);
  await writeJSON("trending.json", trending.map((m) => m.id));
  await writeText(reportKey, report, "text/markdown");
  await writeText("reports/latest.md", report, "text/markdown");

  return {
    reportKey,
    newCount: result.newReleases.length,
    trendingEnterCount: result.trendingEnters.length,
    isBaseline: result.isBaseline,
  };
}
