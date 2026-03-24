/**
 * AI Model Benchmark — Multi-Provider
 *
 * Benchmarks ALL available free models across providers:
 * - OpenRouter (free tier models)
 * - Cerebras (direct API)
 * - NVIDIA (direct API)
 * - Google Gemini (direct API)
 *
 * Tests each model on AutoClaw-specific tasks:
 * 1. Tool calling (structured tool_call JSON output)
 * 2. Multilingual (Chinese input → Chinese output)
 * 3. Instruction following (complex system prompt adherence)
 * 4. Speed (response latency)
 *
 * Results stored in model_benchmarks table. Chat API auto-selects top model.
 */

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const CEREBRAS_API_KEY = process.env.CEREBRAS_API_KEY;
const NVIDIA_API_KEY = process.env.NVIDIA_API_KEY;
const GOOGLE_AI_API = process.env.GOOGLE_AI_API;

const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";
const MIN_CONTEXT_LENGTH = 32_000;

export interface BenchmarkCandidate {
  id: string;           // unique ID for benchmark e.g. "openrouter/qwen/qwen3:free" or "cerebras/qwen-3-235b"
  apiModel: string;     // model ID to pass to the API
  name: string;
  provider: "openrouter" | "cerebras" | "nvidia" | "google";
  contextLength: number;
}

export interface BenchmarkResult {
  model_id: string;
  model_name: string;
  provider: string;
  context_length: number;
  score_tool_calling: number;
  score_multilingual: number;
  score_instruction: number;
  score_speed: number;
  score_total: number;
  latency_ms: number;
  is_available: boolean;
  error_message: string | null;
}

// ── Generic OpenAI-compatible call ──
async function callOpenAICompatible(
  url: string,
  apiKey: string,
  model: string,
  messages: { role: string; content: string }[],
  maxTokens: number,
  timeoutMs: number,
): Promise<{ content: string; latencyMs: number }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const start = Date.now();

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ model, messages, max_tokens: maxTokens, temperature: 0 }),
      signal: controller.signal,
    });
    const latencyMs = Date.now() - start;
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`HTTP ${res.status}: ${err.slice(0, 300)}`);
    }
    const data = await res.json();
    return { content: data.choices?.[0]?.message?.content || "", latencyMs };
  } finally {
    clearTimeout(timer);
  }
}

// ── Google Gemini call ──
async function callGemini(
  apiKey: string,
  model: string,
  messages: { role: string; content: string }[],
  maxTokens: number,
  timeoutMs: number,
): Promise<{ content: string; latencyMs: number }> {
  const systemMsg = messages.find((m) => m.role === "system")?.content;
  const conversationMsgs = messages.filter((m) => m.role !== "system").map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.content }],
  }));
  const body: Record<string, unknown> = {
    contents: conversationMsgs,
    generationConfig: { maxOutputTokens: maxTokens, temperature: 0 },
  };
  if (systemMsg) body.systemInstruction = { parts: [{ text: systemMsg }] };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const start = Date.now();

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: controller.signal },
    );
    const latencyMs = Date.now() - start;
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`HTTP ${res.status}: ${err.slice(0, 300)}`);
    }
    const data = await res.json();
    return { content: data.candidates?.[0]?.content?.parts?.[0]?.text || "", latencyMs };
  } finally {
    clearTimeout(timer);
  }
}

// ── OpenRouter-specific call ──
async function callOpenRouter(
  modelId: string,
  messages: { role: string; content: string }[],
  maxTokens: number,
  timeoutMs: number,
): Promise<{ content: string; latencyMs: number }> {
  if (!OPENROUTER_API_KEY) throw new Error("OPENROUTER_API_KEY not set");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const start = Date.now();

  try {
    const res = await fetch(`${OPENROUTER_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${OPENROUTER_API_KEY}`,
        "HTTP-Referer": "https://autoclaw.ai",
        "X-Title": "AutoClaw Benchmark",
      },
      body: JSON.stringify({ model: modelId, messages, max_tokens: maxTokens, temperature: 0 }),
      signal: controller.signal,
    });
    const latencyMs = Date.now() - start;
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`HTTP ${res.status}: ${err.slice(0, 300)}`);
    }
    const data = await res.json();
    return { content: data.choices?.[0]?.message?.content || "", latencyMs };
  } finally {
    clearTimeout(timer);
  }
}

// ── Unified model caller ──
function callModel(
  candidate: BenchmarkCandidate,
  messages: { role: string; content: string }[],
  maxTokens = 400,
  timeoutMs = 30_000,
): Promise<{ content: string; latencyMs: number }> {
  switch (candidate.provider) {
    case "openrouter":
      return callOpenRouter(candidate.apiModel, messages, maxTokens, timeoutMs);
    case "cerebras":
      return callOpenAICompatible("https://api.cerebras.ai/v1/chat/completions", CEREBRAS_API_KEY!, candidate.apiModel, messages, maxTokens, timeoutMs);
    case "nvidia":
      return callOpenAICompatible("https://integrate.api.nvidia.com/v1/chat/completions", NVIDIA_API_KEY!, candidate.apiModel, messages, maxTokens, timeoutMs);
    case "google":
      return callGemini(GOOGLE_AI_API!, candidate.apiModel, messages, maxTokens, timeoutMs);
  }
}

// ── Fetch free text models from OpenRouter ──
interface OpenRouterModel {
  id: string;
  name: string;
  context_length: number;
  pricing: { prompt: string; completion: string };
  architecture?: { modality?: string; input_modalities?: string[]; output_modalities?: string[] };
}

async function fetchOpenRouterFreeModels(): Promise<BenchmarkCandidate[]> {
  if (!OPENROUTER_API_KEY) return [];

  const res = await fetch(`${OPENROUTER_BASE_URL}/models`, {
    headers: { Authorization: `Bearer ${OPENROUTER_API_KEY}` },
  });
  if (!res.ok) {
    console.warn(`[benchmark] OpenRouter models API error: ${res.status}`);
    return [];
  }

  const data = await res.json();
  const models: OpenRouterModel[] = data.data || data;

  const skipPatterns = ["flux", "sora", "veo", "seedance", "seedream", "dall-e", "stable-diffusion", "embed", "whisper", "tts", "pixart", "imagen"];

  return models
    .filter((m) => {
      const promptCost = parseFloat(m.pricing?.prompt || "1");
      const completionCost = parseFloat(m.pricing?.completion || "1");
      if (promptCost > 0 || completionCost > 0) return false;
      if ((m.context_length || 0) < MIN_CONTEXT_LENGTH) return false;
      const id = m.id.toLowerCase();
      const name = m.name.toLowerCase();
      if (skipPatterns.some((p) => id.includes(p) || name.includes(p))) return false;
      const outputMods = m.architecture?.output_modalities || [];
      if (outputMods.length > 0 && !outputMods.includes("text")) return false;
      return true;
    })
    .map((m) => ({
      id: `openrouter/${m.id}`,
      apiModel: m.id,
      name: m.name,
      provider: "openrouter" as const,
      contextLength: m.context_length,
    }));
}

// ── Build direct provider candidates ──
function getDirectProviderCandidates(): BenchmarkCandidate[] {
  const candidates: BenchmarkCandidate[] = [];

  if (CEREBRAS_API_KEY) {
    candidates.push(
      { id: "cerebras/qwen-3-235b", apiModel: "qwen-3-235b-a22b-instruct-2507", name: "Cerebras Qwen 3 235B", provider: "cerebras", contextLength: 131_072 },
      { id: "cerebras/gpt-oss-120b", apiModel: "gpt-oss-120b", name: "Cerebras GPT-OSS 120B", provider: "cerebras", contextLength: 131_072 },
      { id: "cerebras/llama-3.3-70b", apiModel: "llama-3.3-70b", name: "Cerebras Llama 3.3 70B", provider: "cerebras", contextLength: 65_536 },
      { id: "cerebras/qwen-3-coder-480b", apiModel: "qwen-3-coder-480b", name: "Cerebras Qwen 3 Coder 480B", provider: "cerebras", contextLength: 131_072 },
    );
  }

  if (NVIDIA_API_KEY) {
    candidates.push(
      { id: "nvidia/llama-3.1-8b", apiModel: "meta/llama-3.1-8b-instruct", name: "NVIDIA Llama 3.1 8B", provider: "nvidia", contextLength: 128_000 },
    );
  }

  if (GOOGLE_AI_API) {
    candidates.push(
      { id: "google/gemini-2.0-flash", apiModel: "gemini-2.0-flash", name: "Gemini 2.0 Flash", provider: "google", contextLength: 1_048_576 },
      { id: "google/gemini-2.5-flash", apiModel: "gemini-2.5-flash", name: "Gemini 2.5 Flash", provider: "google", contextLength: 1_048_576 },
    );
  }

  return candidates;
}

// ── Benchmark Tests ──

const TOOL_CALL_MESSAGES: { role: string; content: string }[] = [
  {
    role: "system",
    content: `You are an orchestrator agent. When the user asks to find companies, respond with ONLY a JSON block in this exact format:
\`\`\`tool_call
{"tool": "search_google_maps", "params": {"query": "...", "max_results": 10}, "summary": "..."}
\`\`\`
No other text before or after the JSON block.`,
  },
  { role: "user", content: "Find solar panel manufacturers in Germany" },
];

const MULTILINGUAL_MESSAGES: { role: string; content: string }[] = [
  { role: "system", content: "You are AutoClaw, an AI marketing assistant. Respond in the same language the user uses." },
  { role: "user", content: "帮我介绍一下你的功能，我想用你来帮我找客户" },
];

const INSTRUCTION_MESSAGES: { role: string; content: string }[] = [
  {
    role: "system",
    content: `You are AutoClaw. Follow these rules EXACTLY:
1. Never ask for confirmation — just execute
2. Never say "I suggest" or "Would you like"
3. When the user says "find customers", respond with ONLY a tool_call block
4. Format: \`\`\`tool_call\n{"tool":"search_google_maps","params":{"query":"...","max_results":10},"summary":"..."}\n\`\`\`
5. Do NOT add any text before or after the tool_call block`,
  },
  { role: "user", content: "帮我找欧洲的储能公司" },
];

function scoreToolCalling(content: string): number {
  let score = 0;
  if (content.includes("tool_call")) score += 30;
  const jsonMatch = content.match(/\{[\s\S]*"tool"[\s\S]*"params"[\s\S]*\}/);
  if (jsonMatch) {
    score += 30;
    try {
      const parsed = JSON.parse(jsonMatch[0]);
      if (parsed.tool === "search_google_maps") score += 20;
      if (parsed.params?.query) score += 10;
      if (parsed.summary) score += 10;
    } catch { /* invalid JSON */ }
  }
  return score;
}

function scoreMultilingual(content: string): number {
  let score = 0;
  const cjkChars = (content.match(/[\u4e00-\u9fff]/g) || []).length;
  const ratio = cjkChars / Math.max(content.length, 1);
  if (ratio > 0.3) score += 50;
  else if (ratio > 0.15) score += 30;
  else if (ratio > 0.05) score += 10;

  const keywords = ["客户", "营销", "功能", "帮助", "自动", "邮件", "线索", "潜在"];
  const hits = keywords.filter((k) => content.includes(k)).length;
  score += Math.min(50, hits * 10);
  return score;
}

function scoreInstruction(content: string): number {
  let score = 0;
  const badPhrases = ["would you like", "i suggest", "shall i", "do you want", "需要我", "要不要", "建议"];
  if (!badPhrases.some((p) => content.toLowerCase().includes(p))) score += 30;
  if (content.includes("tool_call")) score += 30;
  const stripped = content.replace(/```tool_call[\s\S]*?```/g, "").trim();
  if (stripped.length < 20) score += 20;
  else if (stripped.length < 100) score += 10;
  const terms = ["energy storage", "储能", "europe", "欧洲"];
  if (terms.some((t) => content.toLowerCase().includes(t))) score += 20;
  return score;
}

function scoreSpeed(latencyMs: number): number {
  if (latencyMs < 1000) return 100;
  if (latencyMs < 2000) return 90;
  if (latencyMs < 5000) return 70;
  if (latencyMs < 10000) return 50;
  if (latencyMs < 20000) return 30;
  return 10;
}

// ── Benchmark a single candidate ──
async function benchmarkCandidate(candidate: BenchmarkCandidate): Promise<BenchmarkResult> {
  try {
    // Run 3 tests in parallel
    const [toolRes, multiRes, instrRes] = await Promise.allSettled([
      callModel(candidate, TOOL_CALL_MESSAGES, 400, 30_000),
      callModel(candidate, MULTILINGUAL_MESSAGES, 400, 30_000),
      callModel(candidate, INSTRUCTION_MESSAGES, 400, 30_000),
    ]);

    const toolContent = toolRes.status === "fulfilled" ? toolRes.value.content : "";
    const toolLatency = toolRes.status === "fulfilled" ? toolRes.value.latencyMs : 30_000;
    const multiContent = multiRes.status === "fulfilled" ? multiRes.value.content : "";
    const multiLatency = multiRes.status === "fulfilled" ? multiRes.value.latencyMs : 30_000;
    const instrContent = instrRes.status === "fulfilled" ? instrRes.value.content : "";
    const instrLatency = instrRes.status === "fulfilled" ? instrRes.value.latencyMs : 30_000;

    const sToolCalling = scoreToolCalling(toolContent);
    const sMultilingual = scoreMultilingual(multiContent);
    const sInstruction = scoreInstruction(instrContent);
    const avgLatency = Math.round((toolLatency + multiLatency + instrLatency) / 3);
    const sSpeed = scoreSpeed(avgLatency);

    // Weighted: tool calling 35%, instruction 30%, multilingual 20%, speed 15%
    const total = Math.round(
      sToolCalling * 0.35 + sInstruction * 0.30 + sMultilingual * 0.20 + sSpeed * 0.15,
    );

    // If all 3 tests failed, mark as unavailable
    const allFailed = toolRes.status === "rejected" && multiRes.status === "rejected" && instrRes.status === "rejected";

    return {
      model_id: candidate.id,
      model_name: candidate.name,
      provider: candidate.provider,
      context_length: candidate.contextLength,
      score_tool_calling: sToolCalling,
      score_multilingual: sMultilingual,
      score_instruction: sInstruction,
      score_speed: sSpeed,
      score_total: total,
      latency_ms: avgLatency,
      is_available: !allFailed,
      error_message: allFailed
        ? (toolRes.status === "rejected" ? String(toolRes.reason).slice(0, 500) : null)
        : null,
    };
  } catch (e) {
    return {
      model_id: candidate.id,
      model_name: candidate.name,
      provider: candidate.provider,
      context_length: candidate.contextLength,
      score_tool_calling: 0,
      score_multilingual: 0,
      score_instruction: 0,
      score_speed: 0,
      score_total: 0,
      latency_ms: 0,
      is_available: false,
      error_message: e instanceof Error ? e.message.slice(0, 500) : String(e),
    };
  }
}

// ── Run full benchmark across ALL providers ──
export async function runFullBenchmark(): Promise<{ runId: string; results: BenchmarkResult[] }> {
  const runId = `bench_${Date.now()}`;

  // Gather candidates from all sources
  const directCandidates = getDirectProviderCandidates();
  console.log(`[benchmark] Direct provider candidates: ${directCandidates.length}`);

  let openRouterCandidates: BenchmarkCandidate[] = [];
  try {
    openRouterCandidates = await fetchOpenRouterFreeModels();
    console.log(`[benchmark] OpenRouter free candidates: ${openRouterCandidates.length}`);
  } catch (e) {
    console.warn(`[benchmark] Failed to fetch OpenRouter models: ${e}`);
  }

  const allCandidates = [...directCandidates, ...openRouterCandidates];
  console.log(`[benchmark] Total candidates: ${allCandidates.length}`);

  // Benchmark direct providers first (fast, reliable), then OpenRouter in batches
  const results: BenchmarkResult[] = [];

  // Direct providers: benchmark in parallel (only a few)
  if (directCandidates.length > 0) {
    console.log(`[benchmark] Testing direct providers...`);
    const directResults = await Promise.all(directCandidates.map(benchmarkCandidate));
    results.push(...directResults);
  }

  // OpenRouter: benchmark in batches of 3 (many models, rate limits)
  for (let i = 0; i < openRouterCandidates.length; i += 3) {
    const batch = openRouterCandidates.slice(i, i + 3);
    console.log(`[benchmark] Testing OpenRouter batch ${Math.floor(i / 3) + 1}/${Math.ceil(openRouterCandidates.length / 3)}...`);
    const batchResults = await Promise.all(batch.map(benchmarkCandidate));
    results.push(...batchResults);

    // Rate limit delay between batches
    if (i + 3 < openRouterCandidates.length) {
      await new Promise((r) => setTimeout(r, 2000));
    }
  }

  // Sort by total score descending
  results.sort((a, b) => b.score_total - a.score_total);

  console.log(`[benchmark] Completed. Top 5:`);
  results.slice(0, 5).forEach((r, i) => {
    console.log(`  ${i + 1}. ${r.model_name} [${r.provider}] — score: ${r.score_total}, latency: ${r.latency_ms}ms`);
  });

  return { runId, results };
}

// ── DB query helpers ──
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type NeonSql = (...args: any[]) => Promise<any[]>;

export async function getBestModel(sql: NeonSql): Promise<{ model_id: string; model_name: string; provider: string; score_total: number } | null> {
  const rows = await sql`
    SELECT model_id, model_name, provider, score_total
    FROM model_benchmarks
    WHERE is_available = true AND score_total > 30
    AND run_id = (SELECT run_id FROM model_benchmarks ORDER BY created_at DESC LIMIT 1)
    ORDER BY score_total DESC
    LIMIT 1
  `;
  return rows.length > 0 ? (rows[0] as { model_id: string; model_name: string; provider: string; score_total: number }) : null;
}

export async function getTopModels(sql: NeonSql, limit = 5): Promise<BenchmarkResult[]> {
  const rows = await sql`
    SELECT model_id, model_name, provider, context_length,
           score_tool_calling, score_multilingual, score_instruction,
           score_speed, score_total, latency_ms, is_available, error_message
    FROM model_benchmarks
    WHERE is_available = true AND score_total > 20
    AND run_id = (SELECT run_id FROM model_benchmarks ORDER BY created_at DESC LIMIT 1)
    ORDER BY score_total DESC
    LIMIT ${limit}
  `;
  return rows as unknown as BenchmarkResult[];
}
