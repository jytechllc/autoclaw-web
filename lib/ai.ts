const CEREBRAS_API_KEY = process.env.CEREBRAS_API_KEY;
const NVIDIA_API_KEY = process.env.NVIDIA_API_KEY;
const GOOGLE_AI_API = process.env.GOOGLE_AI_API;
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const ALIBABA_AI_BASE_URL = process.env.ALIBABA_AI_BASE_URL || "https://dashscope-intl.aliyuncs.com/compatible-mode/v1";

interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface AIResponse {
  content: string;
  provider: string;
  model: string;
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
  fallbackWarning?: string;
}

export interface ByokKeys {
  openai?: string;
  anthropic?: string;
  google?: string;
  alibaba?: string;
  cerebras?: string;
  tavily?: string;
  firecrawl?: string;
  pdl?: string;
}

// ── Model Registry ──
export interface ModelInfo {
  id: string;
  name: string;
  provider: string;
  costPer1MInput: number;   // cents per 1M input tokens
  costPer1MOutput: number;  // cents per 1M output tokens
  requiresByok?: string;    // which BYOK key is needed (undefined = platform-provided)
}

export const AVAILABLE_MODELS: ModelInfo[] = [
  // Platform-provided (free for users)
  { id: "cerebras/gpt-oss-120b", name: "OpenAI GPT-OSS 120B", provider: "cerebras", costPer1MInput: 0, costPer1MOutput: 0 },
  { id: "cerebras/llama-3.3-70b", name: "Meta Llama 3.3 70B", provider: "cerebras", costPer1MInput: 0, costPer1MOutput: 0 },
  { id: "nvidia/llama-3.1-8b", name: "Meta Llama 3.1 8B", provider: "nvidia", costPer1MInput: 0, costPer1MOutput: 0 },
  { id: "google/gemini-2.0-flash", name: "Gemini 2.0 Flash", provider: "google", costPer1MInput: 10, costPer1MOutput: 40 },
  // BYOK models
  { id: "openai/gpt-4o-mini", name: "GPT-4o Mini", provider: "openai", costPer1MInput: 15, costPer1MOutput: 60, requiresByok: "openai" },
  { id: "openai/gpt-4o", name: "GPT-4o", provider: "openai", costPer1MInput: 250, costPer1MOutput: 1000, requiresByok: "openai" },
  { id: "anthropic/claude-sonnet", name: "Claude Sonnet 4", provider: "anthropic", costPer1MInput: 300, costPer1MOutput: 1500, requiresByok: "anthropic" },
  { id: "anthropic/claude-haiku", name: "Claude Haiku 3.5", provider: "anthropic", costPer1MInput: 80, costPer1MOutput: 400, requiresByok: "anthropic" },
  { id: "google/gemini-2.5-pro", name: "Gemini 2.5 Pro", provider: "google", costPer1MInput: 125, costPer1MOutput: 1000, requiresByok: "google" },
  { id: "google/gemini-2.5-flash", name: "Gemini 2.5 Flash", provider: "google", costPer1MInput: 15, costPer1MOutput: 60, requiresByok: "google" },
  { id: "alibaba/qwen-plus", name: "Alibaba Qwen Plus", provider: "alibaba", costPer1MInput: 11.5, costPer1MOutput: 28.7, requiresByok: "alibaba" },
  { id: "alibaba/qwen-turbo", name: "Alibaba Qwen Turbo", provider: "alibaba", costPer1MInput: 5, costPer1MOutput: 20, requiresByok: "alibaba" },
  // BYOK Cerebras
  { id: "cerebras/qwen-3-235b", name: "Alibaba Qwen 3 235B", provider: "cerebras", costPer1MInput: 0, costPer1MOutput: 0, requiresByok: "cerebras" },
  { id: "cerebras/qwen-3-coder-480b", name: "Alibaba Qwen 3 Coder 480B", provider: "cerebras", costPer1MInput: 0, costPer1MOutput: 0, requiresByok: "cerebras" },
  { id: "cerebras/llama3.1-8b", name: "Meta Llama 3.1 8B", provider: "cerebras", costPer1MInput: 0, costPer1MOutput: 0, requiresByok: "cerebras" },
];

export const DEFAULT_MODEL = "cerebras/gpt-oss-120b";

// --- OpenAI-compatible helper (works for OpenAI, Cerebras, NVIDIA) ---
async function callOpenAICompatible(
  url: string,
  apiKey: string,
  model: string,
  provider: string,
  messages: ChatMessage[],
  maxTokens: number,
): Promise<AIResponse> {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ model, messages, max_tokens: maxTokens }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`${provider} error ${res.status}: ${err}`);
  }

  const data = await res.json();
  return {
    content: data.choices[0].message.content,
    provider,
    model,
    usage: data.usage ? {
      prompt_tokens: data.usage.prompt_tokens || 0,
      completion_tokens: data.usage.completion_tokens || 0,
      total_tokens: data.usage.total_tokens || 0,
    } : undefined,
  };
}

// --- Anthropic (Messages API) ---
async function callAnthropic(apiKey: string, model: string, messages: ChatMessage[], maxTokens: number): Promise<AIResponse> {
  const systemMsg = messages.find((m) => m.role === "system")?.content;
  const conversationMsgs = messages.filter((m) => m.role !== "system").map((m) => ({
    role: m.role as "user" | "assistant",
    content: m.content,
  }));

  const body: Record<string, unknown> = {
    model,
    max_tokens: maxTokens,
    messages: conversationMsgs,
  };
  if (systemMsg) body.system = systemMsg;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Anthropic error ${res.status}: ${err}`);
  }

  const data = await res.json();
  const content = data.content?.[0]?.text || "";
  return {
    content,
    provider: "anthropic",
    model,
    usage: data.usage ? {
      prompt_tokens: data.usage.input_tokens || 0,
      completion_tokens: data.usage.output_tokens || 0,
      total_tokens: (data.usage.input_tokens || 0) + (data.usage.output_tokens || 0),
    } : undefined,
  };
}

// --- Google Gemini ---
async function callGoogle(apiKey: string, model: string, messages: ChatMessage[], maxTokens: number): Promise<AIResponse> {
  const systemMsg = messages.find((m) => m.role === "system")?.content;
  const conversationMsgs = messages.filter((m) => m.role !== "system").map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.content }],
  }));

  const body: Record<string, unknown> = {
    contents: conversationMsgs,
    generationConfig: { maxOutputTokens: maxTokens },
  };
  if (systemMsg) body.systemInstruction = { parts: [{ text: systemMsg }] };

  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Google error ${res.status}: ${err}`);
  }

  const data = await res.json();
  const content = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
  const usage = data.usageMetadata;
  return {
    content,
    provider: "google",
    model,
    usage: usage ? {
      prompt_tokens: usage.promptTokenCount || 0,
      completion_tokens: usage.candidatesTokenCount || 0,
      total_tokens: usage.totalTokenCount || 0,
    } : undefined,
  };
}

// --- OpenRouter (routes to any model via OpenRouter API) ---
async function callOpenRouter(model: string, messages: ChatMessage[], maxTokens: number): Promise<AIResponse> {
  if (!OPENROUTER_API_KEY) throw new Error("OPENROUTER_API_KEY not set");

  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${OPENROUTER_API_KEY}`,
      "HTTP-Referer": "https://autoclaw.ai",
      "X-Title": "AutoClaw",
    },
    body: JSON.stringify({ model, messages, max_tokens: maxTokens }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`OpenRouter error ${res.status}: ${err}`);
  }

  const data = await res.json();
  return {
    content: data.choices?.[0]?.message?.content || "",
    provider: "openrouter",
    model,
    usage: data.usage ? {
      prompt_tokens: data.usage.prompt_tokens || 0,
      completion_tokens: data.usage.completion_tokens || 0,
      total_tokens: data.usage.total_tokens || 0,
    } : undefined,
  };
}

// ── Benchmark-based auto model cache ──
// In-memory cache of the best model from benchmarks (refreshed on cold start or every 1h)
let _cachedBestModel: { modelId: string; provider: string; fetchedAt: number } | null = null;
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

async function getBenchmarkBestModel(): Promise<{ modelId: string; provider: string } | null> {
  if (_cachedBestModel && Date.now() - _cachedBestModel.fetchedAt < CACHE_TTL_MS) {
    return { modelId: _cachedBestModel.modelId, provider: _cachedBestModel.provider };
  }
  try {
    const { neon } = await import("@neondatabase/serverless");
    const sql = neon(process.env.DATABASE_URL!);
    const rows = await sql`
      SELECT model_id, provider FROM model_benchmarks
      WHERE is_available = true AND score_total > 30
      AND run_id = (SELECT run_id FROM model_benchmarks ORDER BY created_at DESC LIMIT 1)
      ORDER BY score_total DESC LIMIT 1
    `;
    if (rows.length > 0) {
      const best = { modelId: rows[0].model_id as string, provider: rows[0].provider as string };
      _cachedBestModel = { ...best, fetchedAt: Date.now() };
      return best;
    }
  } catch (e) {
    console.warn("[AI] Failed to fetch benchmark best model:", e);
  }
  return null;
}

// ── Model ID → API model mapping ──
const MODEL_API_MAP: Record<string, string> = {
  "cerebras/gpt-oss-120b": "gpt-oss-120b",
  "cerebras/llama-3.3-70b": "llama-3.3-70b",
  "nvidia/llama-3.1-8b": "meta/llama-3.1-8b-instruct",
  "google/gemini-2.0-flash": "gemini-2.0-flash",
  "openai/gpt-4o-mini": "gpt-4o-mini",
  "openai/gpt-4o": "gpt-4o",
  "anthropic/claude-sonnet": "claude-sonnet-4-20250514",
  "anthropic/claude-haiku": "claude-haiku-4-5-20251001",
  "google/gemini-2.5-pro": "gemini-2.5-pro",
  "google/gemini-2.5-flash": "gemini-2.5-flash",
  "alibaba/qwen-plus": "qwen-plus",
  "alibaba/qwen-turbo": "qwen-turbo",
  "cerebras/qwen-3-235b": "qwen-3-235b-a22b-instruct-2507",
  "cerebras/qwen-3-coder-480b": "qwen-3-coder-480b",
  "cerebras/llama3.1-8b": "llama3.1-8b",
};

export async function chatWithAI(messages: ChatMessage[], maxTokens = 500, byok?: ByokKeys, selectedModel?: string): Promise<AIResponse> {
  // If user selected a specific model, try it directly
  if (selectedModel && selectedModel !== "auto") {
    const modelInfo = AVAILABLE_MODELS.find((m) => m.id === selectedModel);
    if (modelInfo) {
      const apiModel = MODEL_API_MAP[selectedModel] || selectedModel;
      const { provider } = modelInfo;

      if (provider === "cerebras") {
        const key = byok?.cerebras || CEREBRAS_API_KEY;
        if (key) return await callOpenAICompatible("https://api.cerebras.ai/v1/chat/completions", key, apiModel, provider, messages, maxTokens);
      }
      if (provider === "nvidia" && NVIDIA_API_KEY) {
        return await callOpenAICompatible("https://integrate.api.nvidia.com/v1/chat/completions", NVIDIA_API_KEY, apiModel, provider, messages, maxTokens);
      }
      if (provider === "google") {
        const key = byok?.google || GOOGLE_AI_API;
        if (key) return await callGoogle(key, apiModel, messages, maxTokens);
      }
      if (provider === "openai" && byok?.openai) {
        return await callOpenAICompatible("https://api.openai.com/v1/chat/completions", byok.openai, apiModel, provider, messages, maxTokens);
      }
      if (provider === "anthropic" && byok?.anthropic) {
        return await callAnthropic(byok.anthropic, apiModel, messages, maxTokens);
      }
      if (provider === "alibaba" && byok?.alibaba) {
        return await callOpenAICompatible(`${ALIBABA_AI_BASE_URL}/chat/completions`, byok.alibaba, apiModel, provider, messages, maxTokens);
      }
      // If the selected model can't be used, fall through to auto
    }
  }

  // Auto mode: BYOK keys first, then platform keys
  // Collect all provider errors for diagnostics
  const providerErrors: { provider: string; error: string }[] = [];
  const extractError = (e: unknown): string => {
    if (!(e instanceof Error)) return String(e);
    // Parse structured errors (e.g. "Google error 429: {...json...}")
    const msg = e.message;
    const statusMatch = msg.match(/error (\d+):\s*([\s\S]*)/);
    if (statusMatch) {
      const status = statusMatch[1];
      const body = statusMatch[2];
      // Try to extract a meaningful message from JSON error body
      try {
        const parsed = JSON.parse(body);
        const detail = parsed.error?.message || parsed.message || parsed.error?.status || body.slice(0, 300);
        return `HTTP ${status}: ${detail}`;
      } catch {
        return `HTTP ${status}: ${body.slice(0, 300)}`;
      }
    }
    return msg.slice(0, 300);
  };

  // Build ordered provider list: benchmark winner first, then fallbacks
  const providers: { name: string; call: () => Promise<AIResponse> }[] = [];

  // 1. Benchmark-selected best model (auto-adjusted weekly)
  const benchBest = await getBenchmarkBestModel();
  if (benchBest) {
    const { modelId, provider: bestProvider } = benchBest;
    // Route to correct API based on provider
    if (bestProvider === "cerebras" && CEREBRAS_API_KEY) {
      const apiModel = MODEL_API_MAP[modelId] || modelId.replace("cerebras/", "");
      providers.push({ name: `Benchmark: ${modelId}`, call: () => callOpenAICompatible("https://api.cerebras.ai/v1/chat/completions", CEREBRAS_API_KEY, apiModel, "cerebras", messages, maxTokens) });
    } else if (bestProvider === "nvidia" && NVIDIA_API_KEY) {
      const apiModel = MODEL_API_MAP[modelId] || modelId.replace("nvidia/", "");
      providers.push({ name: `Benchmark: ${modelId}`, call: () => callOpenAICompatible("https://integrate.api.nvidia.com/v1/chat/completions", NVIDIA_API_KEY, apiModel, "nvidia", messages, maxTokens) });
    } else if (bestProvider === "google" && GOOGLE_AI_API) {
      const apiModel = MODEL_API_MAP[modelId] || modelId.replace("google/", "");
      providers.push({ name: `Benchmark: ${modelId}`, call: () => callGoogle(GOOGLE_AI_API, apiModel, messages, maxTokens) });
    } else if (bestProvider === "openrouter" && OPENROUTER_API_KEY) {
      // OpenRouter model ID is stored as "openrouter/actual-model-id", extract the actual ID
      const orModel = modelId.replace("openrouter/", "");
      providers.push({ name: `Benchmark: ${modelId}`, call: () => callOpenRouter(orModel, messages, maxTokens) });
    }
  }

  // 2. Platform keys as fallback
  if (CEREBRAS_API_KEY) {
    providers.push({ name: "Cerebras qwen-3-235b", call: () => callOpenAICompatible("https://api.cerebras.ai/v1/chat/completions", CEREBRAS_API_KEY, "qwen-3-235b-a22b-instruct-2507", "cerebras", messages, maxTokens) });
  }
  if (GOOGLE_AI_API) providers.push({ name: "Google", call: () => callGoogle(GOOGLE_AI_API, "gemini-2.0-flash", messages, maxTokens) });

  // BYOK keys as fallback
  if (byok?.openai) providers.push({ name: "BYOK OpenAI", call: () => callOpenAICompatible("https://api.openai.com/v1/chat/completions", byok.openai!, "gpt-4o-mini", "openai", messages, maxTokens) });
  if (byok?.anthropic) providers.push({ name: "BYOK Anthropic", call: () => callAnthropic(byok.anthropic!, "claude-sonnet-4-20250514", messages, maxTokens) });
  if (byok?.google) providers.push({ name: "BYOK Google", call: () => callGoogle(byok.google!, "gemini-2.0-flash", messages, maxTokens) });
  if (byok?.alibaba) providers.push({ name: "BYOK Alibaba", call: () => callOpenAICompatible(`${ALIBABA_AI_BASE_URL}/chat/completions`, byok.alibaba!, "qwen-turbo", "alibaba", messages, maxTokens) });

  // Try at most 3 providers: benchmark winner → platform key → BYOK fallback
  const MAX_FALLBACKS = 3;
  for (const p of providers.slice(0, MAX_FALLBACKS)) {
    try {
      const result = await p.call();
      // If we had to fallback, attach warning info
      if (providerErrors.length > 0) {
        result.fallbackWarning = providerErrors.map(e => `${e.provider}: ${e.error}`).join("; ");
      }
      return result;
    } catch (e) {
      const errMsg = extractError(e);
      providerErrors.push({ provider: p.name, error: errMsg });
      console.warn(`[AI fallback] ${p.name} failed: ${errMsg}`);
    }
  }

  // All providers failed — throw with full error chain
  const errorChain = providerErrors.map((e) => `${e.provider}: ${e.error}`).join("\n");
  throw new Error(`All AI providers failed:\n${errorChain}`);
}
