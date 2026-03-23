import { decrypt } from "@/lib/crypto";
import { NeonQueryFunction } from "@neondatabase/serverless";

const GOOGLE_AI_API = process.env.GOOGLE_AI_API;

// Monthly budget: 1,500 requests/min is Google's free tier limit.
// We track monthly totals to detect anomalies. Default: 500K requests/month.
const MONTHLY_REQUEST_BUDGET = parseInt(process.env.EMBEDDING_MONTHLY_BUDGET || "500000", 10);

function currentPeriod(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/**
 * Check if embedding budget is exceeded for the current month.
 */
export async function isOverBudget(sql: NeonQueryFunction<false, false>): Promise<boolean> {
  const period = currentPeriod();
  const rows = await sql`
    SELECT request_count FROM embedding_usage WHERE period = ${period}
  `;
  if (rows.length === 0) return false;
  return (rows[0].request_count as number) >= MONTHLY_REQUEST_BUDGET;
}

/**
 * Record embedding usage for the current month.
 */
export async function trackUsage(
  sql: NeonQueryFunction<false, false>,
  requests: number,
  tokens: number,
  userId?: number,
  projectId?: number,
): Promise<void> {
  const period = currentPeriod();
  await sql`
    INSERT INTO embedding_usage (period, request_count, token_count, updated_at)
    VALUES (${period}, ${requests}, ${tokens}, NOW())
    ON CONFLICT (period)
    DO UPDATE SET
      request_count = embedding_usage.request_count + ${requests},
      token_count = embedding_usage.token_count + ${tokens},
      updated_at = NOW()
  `;
  // Also track in token_usage for per-user reporting
  if (userId && tokens > 0) {
    try {
      await sql`
        INSERT INTO token_usage (user_id, project_id, provider, model, prompt_tokens, completion_tokens, total_tokens, source)
        VALUES (${userId}, ${projectId || null}, 'embedding', 'text-embedding', ${tokens}, 0, ${tokens}, 'rag')
      `;
    } catch { /* non-critical */ }
  }
}

/**
 * Get current month's usage stats.
 */
export async function getUsageStats(sql: NeonQueryFunction<false, false>): Promise<{
  period: string;
  requestCount: number;
  tokenCount: number;
  budget: number;
}> {
  const period = currentPeriod();
  const rows = await sql`
    SELECT request_count, token_count FROM embedding_usage WHERE period = ${period}
  `;
  return {
    period,
    requestCount: rows.length > 0 ? (rows[0].request_count as number) : 0,
    tokenCount: rows.length > 0 ? (rows[0].token_count as number) : 0,
    budget: MONTHLY_REQUEST_BUDGET,
  };
}

/**
 * Generate embeddings for text chunks using Google gemini-embedding-001 (768 dim).
 * Priority: user's BYOK keys first, then system key (enterprise plan only).
 * Tracks usage in the database when sql is provided.
 */
export async function generateEmbeddings(
  texts: string[],
  byokKeys?: { google?: string; openai?: string },
  sql?: NeonQueryFunction<false, false>,
  plan?: string,
  userId?: number,
  projectId?: number,
): Promise<number[][]> {
  // Estimate tokens for tracking (~4 chars per token)
  const estimatedTokens = texts.reduce((sum, t) => sum + Math.ceil(t.length / 4), 0);

  // 1. Try user's BYOK Google key first
  if (byokKeys?.google) {
    try {
      const result = await googleEmbed(byokKeys.google, texts);
      if (sql) await trackUsage(sql, 1, estimatedTokens, userId, projectId).catch(() => {});
      return result;
    } catch (e) {
      console.error("User Google embedding failed:", e);
    }
  }

  // 2. Try user's BYOK OpenAI key
  if (byokKeys?.openai) {
    try {
      const result = await openaiEmbed(byokKeys.openai, texts);
      if (sql) await trackUsage(sql, 1, estimatedTokens, userId, projectId).catch(() => {});
      return result;
    } catch (e) {
      console.error("User OpenAI embedding failed:", e);
    }
  }

  // 3. Fall back to system Google key (enterprise plan only)
  if (GOOGLE_AI_API && plan === "enterprise") {
    try {
      const result = await googleEmbed(GOOGLE_AI_API, texts);
      if (sql) await trackUsage(sql, 1, estimatedTokens, userId, projectId).catch(() => {});
      return result;
    } catch (e) {
      console.error("System Google embedding failed:", e);
    }
  }

  if (!byokKeys?.google && !byokKeys?.openai) {
    throw new Error(
      plan === "enterprise"
        ? "Embedding failed. Please try again or configure your own API key in Settings."
        : "No embedding provider available. Add a Google AI or OpenAI API key in Settings to use the knowledge base."
    );
  }

  throw new Error("Embedding failed with all configured providers. Please check your API keys.");
}

async function googleEmbed(apiKey: string, texts: string[]): Promise<number[][]> {
  // Google supports batch embedding
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:batchEmbedContents?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        requests: texts.map((text) => ({
          model: "models/gemini-embedding-001",
          content: { parts: [{ text }] },
          outputDimensionality: 768,
        })),
      }),
    },
  );

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Google embedding error ${res.status}: ${err}`);
  }

  const data = await res.json();
  return data.embeddings.map((e: { values: number[] }) => e.values);
}

async function openaiEmbed(apiKey: string, texts: string[]): Promise<number[][]> {
  const res = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "text-embedding-3-small",
      input: texts,
      dimensions: 768,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`OpenAI embedding error ${res.status}: ${err}`);
  }

  const data = await res.json();
  return data.data
    .sort((a: { index: number }, b: { index: number }) => a.index - b.index)
    .map((d: { embedding: number[] }) => d.embedding);
}

/**
 * Load user's BYOK keys for embedding providers.
 */
export async function loadEmbeddingKeys(
  sql: NeonQueryFunction<false, false>,
  userId: number,
): Promise<{ google?: string; openai?: string }> {
  const rows = await sql`
    SELECT service, api_key FROM user_api_keys
    WHERE user_id = ${userId} AND service IN ('google', 'openai')
  `;
  const keys: { google?: string; openai?: string } = {};
  for (const row of rows) {
    try {
      const key = decrypt(row.api_key as string);
      if (row.service === "google") keys.google = key;
      else if (row.service === "openai") keys.openai = key;
    } catch {
      // Skip keys that fail to decrypt
    }
  }
  return keys;
}
