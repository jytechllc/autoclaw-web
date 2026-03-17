import { NextRequest } from "next/server";
import { authenticateV1, apiSuccess, apiError, parsePagination } from "@/lib/api-v1";
import { extractUrl, chunkText, estimateTokens } from "@/lib/chunking";
import { generateEmbeddings, loadEmbeddingKeys, isOverBudget } from "@/lib/embeddings";

export const dynamic = "force-dynamic";

const PLAN_LIMITS: Record<string, { maxDocs: number; maxSizeMB: number }> = {
  starter: { maxDocs: 10, maxSizeMB: 50 },
  growth: { maxDocs: 100, maxSizeMB: 500 },
  scale: { maxDocs: 1000, maxSizeMB: 5000 },
  enterprise: { maxDocs: 99999, maxSizeMB: 99999 },
};

/**
 * GET /api/v1/kb/documents
 * List knowledge base documents.
 * Query params: scope (personal|org|project), org_id, project_id, status, limit, offset
 */
export async function GET(req: NextRequest) {
  const ctx = await authenticateV1(req, "read");
  if ("status" in ctx) return ctx;

  const { sql, userId } = ctx;
  const { limit, offset } = parsePagination(req);
  const url = req.nextUrl;
  const scope = url.searchParams.get("scope");
  const status = url.searchParams.get("status");

  // Get user's org and project IDs for access control
  const orgs = await sql`
    SELECT o.id FROM organization_members om
    JOIN organizations o ON om.org_id = o.id
    WHERE om.user_id = ${userId}
  `;
  const orgIds = orgs.map((o) => o.id as number);
  const projects = orgIds.length > 0
    ? await sql`
        SELECT DISTINCT p.id FROM projects p
        LEFT JOIN project_members pm ON pm.project_id = p.id AND pm.user_id = ${userId}
        WHERE p.user_id = ${userId} OR p.org_id = ANY(${orgIds}) OR pm.user_id = ${userId}
      `
    : await sql`
        SELECT DISTINCT p.id FROM projects p
        LEFT JOIN project_members pm ON pm.project_id = p.id AND pm.user_id = ${userId}
        WHERE p.user_id = ${userId} OR pm.user_id = ${userId}
      `;
  const projectIds = projects.map((p) => p.id as number);

  let documents;
  if (scope === "personal") {
    documents = await sql`
      SELECT d.*, o.name as org_name FROM kb_documents d
      LEFT JOIN organizations o ON d.org_id = o.id
      WHERE d.scope = 'personal' AND d.user_id = ${userId}
        ${status ? sql`AND d.status = ${status}` : sql``}
      ORDER BY d.created_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `;
  } else if (scope === "org" && orgIds.length > 0) {
    documents = await sql`
      SELECT d.*, o.name as org_name FROM kb_documents d
      LEFT JOIN organizations o ON d.org_id = o.id
      WHERE d.scope = 'org' AND d.org_id = ANY(${orgIds})
        ${status ? sql`AND d.status = ${status}` : sql``}
      ORDER BY d.created_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `;
  } else if (scope === "project" && projectIds.length > 0) {
    documents = await sql`
      SELECT d.*, o.name as org_name FROM kb_documents d
      LEFT JOIN organizations o ON d.org_id = o.id
      WHERE d.scope = 'project' AND d.project_id = ANY(${projectIds})
        ${status ? sql`AND d.status = ${status}` : sql``}
      ORDER BY d.created_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `;
  } else {
    documents = await sql`
      SELECT d.*, o.name as org_name FROM kb_documents d
      LEFT JOIN organizations o ON d.org_id = o.id
      WHERE (
        (d.scope = 'personal' AND d.user_id = ${userId})
        ${orgIds.length > 0 ? sql`OR (d.scope = 'org' AND d.org_id = ANY(${orgIds}))` : sql``}
        ${projectIds.length > 0 ? sql`OR (d.scope = 'project' AND d.project_id = ANY(${projectIds}))` : sql``}
      )
      ${status ? sql`AND d.status = ${status}` : sql``}
      ORDER BY d.created_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `;
  }

  const countResult = await sql`
    SELECT COUNT(*)::int as total FROM kb_documents WHERE user_id = ${userId}
  `;

  return apiSuccess({
    documents,
    total: countResult[0].total,
    limit,
    offset,
  });
}

/**
 * POST /api/v1/kb/documents
 * Create a knowledge base document.
 * Body: { type: "url"|"text", url?, title?, text?, scope?, org_id?, project_id? }
 */
export async function POST(req: NextRequest) {
  const ctx = await authenticateV1(req, "write");
  if ("status" in ctx) return ctx;

  const { sql, userId, plan } = ctx;
  const body = await req.json();
  const { type, url: docUrl, title, text, scope = "personal", org_id, project_id } = body;

  if (!type || !["url", "text"].includes(type)) {
    return apiError("type must be 'url' or 'text'", 400);
  }

  // Check limits
  const limits = PLAN_LIMITS[plan] || PLAN_LIMITS.starter;
  const countResult = await sql`
    SELECT COUNT(*)::int as count, COALESCE(SUM(file_size), 0)::bigint as total_size
    FROM kb_documents WHERE user_id = ${userId}
  `;
  if ((countResult[0].count as number) >= limits.maxDocs) {
    return apiError(`Document limit reached (${limits.maxDocs} on your plan)`, 403);
  }

  if (type === "url") {
    if (!docUrl?.trim()) return apiError("url is required", 400);

    // Verify reachability
    let reachable = false;
    try {
      const res = await fetch(docUrl, {
        method: "HEAD",
        headers: { "User-Agent": "Mozilla/5.0 (compatible; AutoClaw/1.0)" },
        signal: AbortSignal.timeout(10000),
        redirect: "follow",
      });
      reachable = res.ok;
    } catch { /* try GET */ }
    if (!reachable) {
      try {
        const res = await fetch(docUrl, {
          method: "GET",
          headers: { "User-Agent": "Mozilla/5.0 (compatible; AutoClaw/1.0)" },
          signal: AbortSignal.timeout(10000),
          redirect: "follow",
        });
        reachable = res.ok;
      } catch { /* failed */ }
    }
    if (!reachable) {
      return apiError("Could not reach URL", 400);
    }

    const docTitle = title?.trim() || (docUrl.length > 100 ? docUrl.slice(0, 100) + "..." : docUrl);
    const docs = await sql`
      INSERT INTO kb_documents (user_id, org_id, project_id, scope, title, doc_type, source_url, status)
      VALUES (${userId}, ${org_id || null}, ${project_id || null}, ${scope}, ${docTitle}, 'url', ${docUrl}, 'ready')
      RETURNING id, title, doc_type, scope, source_url, status, created_at
    `;
    const docId = docs[0].id as number;

    // Best-effort extraction + embedding
    try {
      const extracted = await extractUrl(docUrl);
      const textSize = Buffer.byteLength(extracted, "utf-8");
      await sql`UPDATE kb_documents SET file_size = ${textSize} WHERE id = ${docId}`;
      await processAndEmbed(sql, docId, extracted, userId, plan);
    } catch { /* saved as reference */ }

    // Re-fetch to get updated status
    const updated = await sql`SELECT * FROM kb_documents WHERE id = ${docId}`;
    return apiSuccess({ document: updated[0] }, 201);
  }

  // type === "text"
  if (!text?.trim()) return apiError("text is required", 400);
  const docTitle = title?.trim() || "Untitled";
  const textSize = Buffer.byteLength(text, "utf-8");

  const docs = await sql`
    INSERT INTO kb_documents (user_id, org_id, project_id, scope, title, doc_type, file_size, status)
    VALUES (${userId}, ${org_id || null}, ${project_id || null}, ${scope}, ${docTitle}, 'text', ${textSize}, 'processing')
    RETURNING id
  `;
  const docId = docs[0].id as number;

  await processAndEmbed(sql, docId, text, userId, plan);

  const updated = await sql`SELECT * FROM kb_documents WHERE id = ${docId}`;
  return apiSuccess({ document: updated[0] }, 201);
}

async function processAndEmbed(
  sql: ReturnType<typeof import("@/lib/db").getDb>,
  docId: number,
  text: string,
  userId: number,
  plan: string,
) {
  const overBudget = await isOverBudget(sql);
  if (overBudget) {
    await sql`UPDATE kb_documents SET status = 'queued', error_message = 'Embedding budget exceeded — queued for next period' WHERE id = ${docId}`;
    return;
  }

  const chunks = chunkText(text);
  if (chunks.length === 0) {
    await sql`UPDATE kb_documents SET status = 'ready' WHERE id = ${docId}`;
    return;
  }

  await sql`UPDATE kb_documents SET status = 'processing', chunk_count = ${chunks.length} WHERE id = ${docId}`;
  const byokKeys = await loadEmbeddingKeys(sql, userId);

  const BATCH_SIZE = 20;
  for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
    const batch = chunks.slice(i, i + BATCH_SIZE);
    const embeddings = await generateEmbeddings(batch, byokKeys, sql, plan);
    for (let j = 0; j < batch.length; j++) {
      const chunkIndex = i + j;
      const embeddingStr = `[${embeddings[j].join(",")}]`;
      const tokenCount = estimateTokens(batch[j]);
      await sql`
        INSERT INTO kb_chunks (document_id, chunk_index, content, embedding, token_count)
        VALUES (${docId}, ${chunkIndex}, ${batch[j]}, ${embeddingStr}::vector, ${tokenCount})
      `;
    }
  }

  const textSize = Buffer.byteLength(text, "utf-8");
  await sql`UPDATE kb_documents SET status = 'ready', file_size = ${textSize}, updated_at = NOW() WHERE id = ${docId}`;
}
