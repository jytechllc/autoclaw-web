import { NeonQueryFunction } from "@neondatabase/serverless";
import { generateEmbeddings } from "@/lib/embeddings";
import { queryLlamaIndex, loadLlamaIndexConfig } from "@/lib/llamaindex";

export interface RagResult {
  content: string;
  documentTitle: string;
  documentId: number;
  chunkIndex: number;
  similarity: number;
}

/**
 * Search the knowledge base using LlamaIndex Cloud (primary) or pgvector (fallback).
 * Returns the top-k most relevant chunks for the given query.
 */
export async function searchKnowledgeBase(
  sql: NeonQueryFunction<false, false>,
  query: string,
  opts: {
    userId: number;
    orgId?: number;
    projectId?: number;
    topK?: number;
    byokKeys?: { google?: string; openai?: string };
    plan?: string;
  },
): Promise<RagResult[]> {
  const topK = opts.topK || 5;

  // Try LlamaIndex Cloud first
  const liConfig = await loadLlamaIndexConfig(sql, opts.userId, opts.plan || "starter");
  if (liConfig) {
    try {
      return await queryLlamaIndex(liConfig, query, {
        userId: opts.userId,
        orgId: opts.orgId,
        projectId: opts.projectId,
        topK,
      }, sql);
    } catch (e) {
      console.error("LlamaIndex query failed, falling back to pgvector:", e);
    }
  }

  // Fallback: pgvector (for existing data or if LlamaIndex is not configured)
  const [queryEmbedding] = await generateEmbeddings([query], opts.byokKeys, undefined, opts.plan);
  const embeddingStr = `[${queryEmbedding.join(",")}]`;

  const results = await sql`
    SELECT
      c.content,
      c.chunk_index,
      c.document_id,
      d.title as document_title,
      1 - (c.embedding <=> ${embeddingStr}::vector) as similarity
    FROM kb_chunks c
    JOIN kb_documents d ON c.document_id = d.id
    WHERE d.status = 'ready'
      AND c.embedding IS NOT NULL
      AND (
        (d.scope = 'personal' AND d.user_id = ${opts.userId})
        ${opts.orgId ? sql`OR (d.scope = 'org' AND d.org_id = ${opts.orgId})` : sql``}
        ${opts.projectId ? sql`OR (d.scope = 'project' AND d.project_id = ${opts.projectId})` : sql``}
        OR (d.source_url = 'system:product-docs-rag')
      )
    ORDER BY c.embedding <=> ${embeddingStr}::vector
    LIMIT ${topK}
  `;

  return results.map((r) => ({
    content: r.content as string,
    documentTitle: r.document_title as string,
    documentId: r.document_id as number,
    chunkIndex: r.chunk_index as number,
    similarity: r.similarity as number,
  }));
}

/**
 * Build a RAG context string from search results to inject into the AI system prompt.
 */
export function buildRagContext(results: RagResult[], maxChars = 3000): string {
  if (results.length === 0) return "";

  let context = "## Relevant Knowledge Base Context\n\n";
  let chars = context.length;

  for (const r of results) {
    if (r.similarity < 0.3) continue; // skip low-relevance results
    const entry = `**[${r.documentTitle}]**: ${r.content}\n\n`;
    if (chars + entry.length > maxChars) break;
    context += entry;
    chars += entry.length;
  }

  return context;
}
