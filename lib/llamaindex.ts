import { decrypt } from "@/lib/crypto";
import { NeonQueryFunction } from "@neondatabase/serverless";
import type { RagResult } from "@/lib/rag";

const LLAMAINDEX_API_KEY = process.env.LLAMAINDEX_API_KEY;
const LLAMAINDEX_INDEX_NAME = process.env.LLAMAINDEX_INDEX_NAME || "autoclaw-shared";
const LLAMAINDEX_BASE_URL = "https://api.cloud.llamaindex.ai/api/v1";

interface LlamaIndexConfig {
  apiKey: string;
  indexName: string;
}

/**
 * Track LlamaIndex usage in token_usage table.
 */
async function trackLlamaIndexUsage(
  sql: NeonQueryFunction<false, false>,
  userId: number,
  projectId: number | undefined,
  source: "rag_upload" | "rag_query" | "rag_delete",
  credits: number,
): Promise<void> {
  try {
    await sql`
      INSERT INTO token_usage (user_id, project_id, provider, model, prompt_tokens, completion_tokens, total_tokens, source)
      VALUES (${userId}, ${projectId || null}, 'llamaindex', 'cloud', ${credits}, 0, ${credits}, ${source})
    `;
  } catch { /* non-critical */ }
}

/**
 * Load LlamaIndex API key — BYOK first, then system shared key.
 */
export async function loadLlamaIndexConfig(
  sql: NeonQueryFunction<false, false>,
  userId: number,
  plan: string,
): Promise<LlamaIndexConfig | null> {
  // 1. Try BYOK key (Growth+ only)
  if (plan !== "starter") {
    const rows = await sql`
      SELECT api_key, label FROM user_api_keys
      WHERE user_id = ${userId} AND service = 'llamaindex'
    `;
    if (rows.length > 0) {
      try {
        const key = decrypt(rows[0].api_key as string);
        const label = (rows[0].label as string) || "";
        const indexName = label.startsWith("index:") ? label.slice(6) : LLAMAINDEX_INDEX_NAME;
        return { apiKey: key, indexName };
      } catch { /* fall through */ }
    }
  }

  // 2. System shared key
  if (LLAMAINDEX_API_KEY) {
    return { apiKey: LLAMAINDEX_API_KEY, indexName: LLAMAINDEX_INDEX_NAME };
  }

  return null;
}

/**
 * Check if user is using BYOK LlamaIndex key.
 */
export async function isLlamaIndexByok(
  sql: NeonQueryFunction<false, false>,
  userId: number,
): Promise<boolean> {
  const rows = await sql`
    SELECT id FROM user_api_keys
    WHERE user_id = ${userId} AND service = 'llamaindex'
    LIMIT 1
  `;
  return rows.length > 0;
}

/**
 * Upload a document to LlamaIndex Cloud index.
 * Returns the file ID for later deletion.
 */
export async function uploadToLlamaIndex(
  config: LlamaIndexConfig,
  documentId: number,
  title: string,
  content: string,
  metadata: {
    user_id: number;
    org_id?: number;
    scope: string;
    doc_type: string;
  },
  sql?: NeonQueryFunction<false, false>,
  projectId?: number,
): Promise<string> {
  // Create a text file from the content
  const blob = new Blob([content], { type: "text/plain" });
  const formData = new FormData();
  formData.append("files", blob, `doc-${documentId}.txt`);

  // Attach metadata as extra_metadata
  const extraMetadata = {
    document_id: String(documentId),
    user_id: String(metadata.user_id),
    org_id: metadata.org_id ? String(metadata.org_id) : "",
    scope: metadata.scope,
    doc_type: metadata.doc_type,
    title: title,
  };
  formData.append("extra_metadata", JSON.stringify(extraMetadata));

  const res = await fetch(
    `${LLAMAINDEX_BASE_URL}/indexes/${config.indexName}/upload`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: formData,
    },
  );

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`LlamaIndex upload error ${res.status}: ${err}`);
  }

  const data = await res.json();
  const fileId = data.id || data.file_id || `doc-${documentId}`;

  // Track usage: estimate ~1 credit per page (~3000 chars)
  const estimatedCredits = Math.max(1, Math.ceil(content.length / 3000));
  if (sql) await trackLlamaIndexUsage(sql, metadata.user_id, projectId, "rag_upload", estimatedCredits);

  return fileId;
}

/**
 * Delete a document from LlamaIndex Cloud index.
 */
export async function deleteFromLlamaIndex(
  config: LlamaIndexConfig,
  fileId: string,
  sql?: NeonQueryFunction<false, false>,
  userId?: number,
  projectId?: number,
): Promise<void> {
  const res = await fetch(
    `${LLAMAINDEX_BASE_URL}/indexes/${config.indexName}/documents/${fileId}`,
    {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json",
      },
    },
  );

  if (!res.ok && res.status !== 404) {
    const err = await res.text();
    throw new Error(`LlamaIndex delete error ${res.status}: ${err}`);
  }

  if (sql && userId) await trackLlamaIndexUsage(sql, userId, projectId, "rag_delete", 1);
}

/**
 * Query LlamaIndex Cloud for relevant documents.
 * Uses metadata filtering for data isolation.
 */
export async function queryLlamaIndex(
  config: LlamaIndexConfig,
  query: string,
  opts: {
    userId: number;
    orgId?: number;
    projectId?: number;
    topK?: number;
  },
  sql?: NeonQueryFunction<false, false>,
): Promise<RagResult[]> {
  const topK = opts.topK || 5;

  // Build metadata filters for data isolation
  // User can see: their own docs + org docs + system docs
  const filters: Record<string, string>[] = [];
  filters.push({ key: "user_id", value: String(opts.userId) });
  if (opts.orgId) {
    filters.push({ key: "org_id", value: String(opts.orgId) });
  }

  const res = await fetch(
    `${LLAMAINDEX_BASE_URL}/indexes/${config.indexName}/query`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query,
        top_k: topK,
        metadata_filters: filters.length > 0 ? { filters, condition: "or" } : undefined,
      }),
    },
  );

  if (!res.ok) {
    const err = await res.text();
    console.error(`LlamaIndex query error ${res.status}: ${err}`);
    return [];
  }

  const data = await res.json();
  const nodes = data.nodes || data.results || [];

  // Track usage: 1 credit per query
  if (sql) await trackLlamaIndexUsage(sql, opts.userId, opts.projectId, "rag_query", 1);

  return nodes.map((node: { text?: string; content?: string; score?: number; metadata?: Record<string, string> }, i: number) => ({
    content: node.text || node.content || "",
    documentTitle: node.metadata?.title || "Unknown",
    documentId: parseInt(node.metadata?.document_id || "0", 10),
    chunkIndex: i,
    similarity: node.score || 0,
  }));
}

/**
 * Get LlamaIndex usage stats for a user (current month).
 */
export async function getLlamaIndexUsage(
  sql: NeonQueryFunction<false, false>,
  userId: number,
): Promise<{ uploads: number; queries: number; totalCredits: number }> {
  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);

  const rows = await sql`
    SELECT source, SUM(total_tokens) as credits, COUNT(*) as count
    FROM token_usage
    WHERE user_id = ${userId}
      AND provider = 'llamaindex'
      AND created_at >= ${monthStart.toISOString()}
    GROUP BY source
  `;

  let uploads = 0, queries = 0, totalCredits = 0;
  for (const r of rows) {
    const credits = Number(r.credits) || 0;
    totalCredits += credits;
    if (r.source === "rag_upload") uploads = Number(r.count) || 0;
    if (r.source === "rag_query") queries = Number(r.count) || 0;
  }

  return { uploads, queries, totalCredits };
}
