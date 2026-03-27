import { NextRequest, NextResponse } from "next/server";
import { auth0 } from "@/lib/auth0";
import { getDb, resolveUserPlan } from "@/lib/db";
import { loadEmbeddingKeys, isOverBudget } from "@/lib/embeddings";
import { generateEmbeddings } from "@/lib/embeddings";
import { extractPdf, extractDocx, extractUrl, chunkText, estimateTokens } from "@/lib/chunking";
import { loadLlamaIndexConfig, uploadToLlamaIndex, deleteFromLlamaIndex, isLlamaIndexByok } from "@/lib/llamaindex";
import { put, list } from "@vercel/blob";
import { decrypt } from "@/lib/crypto";

export const dynamic = "force-dynamic";

async function getFirecrawlKey(sql: ReturnType<typeof getDb>, userId: number): Promise<string> {
  // Check env first
  if (process.env.FIRECRAWL_API_KEY) return process.env.FIRECRAWL_API_KEY;
  // Then personal BYOK
  try {
    const rows = await sql`
      SELECT api_key FROM user_api_keys WHERE user_id = ${userId} AND service = 'firecrawl'
      UNION ALL
      SELECT ok.api_key FROM org_api_keys ok
        WHERE ok.service = 'firecrawl'
        AND ok.org_id IN (SELECT org_id FROM organization_members WHERE user_id = ${userId})
      LIMIT 1
    `;
    if (rows.length > 0) return decrypt(rows[0].api_key as string);
  } catch { /* no key */ }
  return "";
}
export const maxDuration = 60;

const PLAN_LIMITS: Record<string, { maxDocs: number; maxSizeMB: number }> = {
  starter: { maxDocs: 10, maxSizeMB: 500 },
  growth: { maxDocs: 30, maxSizeMB: 500 },
  scale: { maxDocs: 4000, maxSizeMB: 5000 },
  enterprise: { maxDocs: 10000, maxSizeMB: 5000 },
};

// GET: list knowledge base documents
export async function GET(req: NextRequest) {
  const session = await auth0.getSession();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sql = getDb();
  const email = session.user.email as string;
  const users = await sql`SELECT id, plan FROM users WHERE email = ${email}`;
  if (users.length === 0) {
    return NextResponse.json({ documents: [] });
  }
  const userId = users[0].id as number;
  const plan = await resolveUserPlan(sql, userId, (users[0].plan as string) || "starter", email);

  // Get user's org memberships
  const orgs = await sql`
    SELECT o.id, o.name FROM organization_members om
    JOIN organizations o ON om.org_id = o.id
    WHERE om.user_id = ${userId}
  `;
  const orgIds = orgs.map((o) => o.id as number);

  // Get user's accessible projects (owned, org-level, or member)
  const projects = orgIds.length > 0
    ? await sql`
        SELECT DISTINCT p.id, p.name FROM projects p
        LEFT JOIN project_members pm ON pm.project_id = p.id AND pm.user_id = ${userId}
        WHERE p.user_id = ${userId}
          OR p.org_id = ANY(${orgIds})
          OR pm.user_id = ${userId}
        ORDER BY p.name
      `
    : await sql`
        SELECT DISTINCT p.id, p.name FROM projects p
        LEFT JOIN project_members pm ON pm.project_id = p.id AND pm.user_id = ${userId}
        WHERE p.user_id = ${userId}
          OR pm.user_id = ${userId}
        ORDER BY p.name
      `;
  const projectIds = projects.map((p) => p.id as number);

  const scope = req.nextUrl.searchParams.get("scope"); // 'all', 'org', 'personal', 'project'
  const projectId = req.nextUrl.searchParams.get("project_id");

  let documents;
  if (scope === "org" && orgIds.length > 0) {
    documents = await sql`
      SELECT d.*, o.name as org_name FROM kb_documents d
      LEFT JOIN organizations o ON d.org_id = o.id
      WHERE d.scope = 'org' AND d.org_id = ANY(${orgIds})
      ORDER BY d.created_at DESC
    `;
  } else if (scope === "personal") {
    documents = await sql`
      SELECT d.* FROM kb_documents d
      WHERE d.scope = 'personal' AND d.user_id = ${userId}
      ORDER BY d.created_at DESC
    `;
  } else if (scope === "project" && projectId) {
    documents = await sql`
      SELECT d.* FROM kb_documents d
      WHERE d.scope = 'project' AND d.project_id = ${parseInt(projectId)}
      ORDER BY d.created_at DESC
    `;
  } else {
    // All accessible documents
    documents = await sql`
      SELECT d.*, o.name as org_name FROM kb_documents d
      LEFT JOIN organizations o ON d.org_id = o.id
      WHERE
        (d.scope = 'personal' AND d.user_id = ${userId})
        ${orgIds.length > 0 ? sql`OR (d.scope = 'org' AND d.org_id = ANY(${orgIds}))` : sql``}
        ${projectIds.length > 0 ? sql`OR (d.scope = 'project' AND d.project_id = ANY(${projectIds}))` : sql``}
      ORDER BY d.created_at DESC
    `;
  }

  // Count totals for limits + token stats
  const countResult = await sql`
    SELECT COUNT(*)::int as count, COALESCE(SUM(file_size), 0)::bigint as total_size
    FROM kb_documents WHERE user_id = ${userId}
  `;

  // Token stats: per-document and total
  const docIds = documents.map((d) => d.id as number);
  let totalTokens = 0;
  let totalChunks = 0;
  const docTokenMap: Record<number, number> = {};
  if (docIds.length > 0) {
    const tokenResult = await sql`
      SELECT document_id, COALESCE(SUM(token_count), 0)::int as doc_tokens, COUNT(*)::int as doc_chunks
      FROM kb_chunks WHERE document_id = ANY(${docIds})
      GROUP BY document_id
    `;
    for (const row of tokenResult) {
      const did = row.document_id as number;
      const tokens = row.doc_tokens as number;
      docTokenMap[did] = tokens;
      totalTokens += tokens;
      totalChunks += row.doc_chunks as number;
    }
  }

  // Attach token_count to each document
  const enrichedDocs = documents.map((d) => ({
    ...d,
    token_count: docTokenMap[d.id as number] || 0,
  }));

  const limits = PLAN_LIMITS[plan] || PLAN_LIMITS.starter;

  // Blob storage usage
  let blobUsage = { totalBytes: 0, totalFiles: 0 };
  try {
    let cursor: string | undefined;
    for (let page = 0; page < 3; page++) {
      const result = await list({ cursor, limit: 1000, prefix: `kb/${userId}/` });
      blobUsage.totalFiles += result.blobs.length;
      blobUsage.totalBytes += result.blobs.reduce((s, b) => s + b.size, 0);
      if (!result.hasMore) break;
      cursor = result.cursor;
    }
  } catch { /* blob not configured or empty */ }

  return NextResponse.json({
    documents: enrichedDocs,
    plan,
    usage: {
      docCount: countResult[0].count as number,
      totalSize: countResult[0].total_size as number,
      maxDocs: limits.maxDocs,
      maxSizeMB: limits.maxSizeMB,
      totalTokens,
      totalChunks,
      blobUsedBytes: blobUsage.totalBytes,
      blobFiles: blobUsage.totalFiles,
    },
    orgs: orgs.map((o) => ({ id: o.id, name: o.name })),
    projects: projects.map((p) => ({ id: p.id, name: p.name })),
  });
}

// POST: upload document, add URL, add text, delete, search
export async function POST(req: NextRequest) {
  const session = await auth0.getSession();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sql = getDb();
  const email = session.user.email as string;
  const users = await sql`SELECT id, plan FROM users WHERE email = ${email}`;
  if (users.length === 0) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }
  const userId = users[0].id as number;
  const plan = await resolveUserPlan(sql, userId, (users[0].plan as string) || "starter", email);
  const limits = PLAN_LIMITS[plan] || PLAN_LIMITS.starter;

  const contentType = req.headers.get("content-type") || "";

  // Handle multipart file upload
  if (contentType.includes("multipart/form-data")) {
    return handleFileUpload(req, sql, userId, plan, limits);
  }

  // Handle JSON actions
  const body = await req.json();
  const { action } = body;

  switch (action) {
    case "add_url":
      return handleAddUrl(body, sql, userId, plan, limits);
    case "add_text":
      return handleAddText(body, sql, userId, plan, limits);
    case "delete":
      return handleDelete(body, sql, userId, plan);
    case "reprocess":
      return handleReprocess(body, sql, userId, plan);
    case "get_chunks":
      return handleGetChunks(body, sql, userId);
    case "edit_url":
      return handleEditUrl(body, sql, userId, plan, limits);
    case "edit_doc":
      return handleEditDoc(body, sql, userId, plan);
    case "edit_chunk":
      return handleEditChunk(body, sql, userId, plan);
    case "assign_project":
      return handleAssignProject(body, sql, userId);
    default:
      return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  }
}

async function checkLimits(
  sql: ReturnType<typeof getDb>,
  userId: number,
  limits: { maxDocs: number; maxSizeMB: number },
  addSize = 0,
  plan?: string,
): Promise<string | null> {
  // BYOK users on Growth+ have unlimited documents
  if (plan && plan !== "starter") {
    const hasByok = await isLlamaIndexByok(sql, userId);
    if (hasByok) return null;
  }

  const countResult = await sql`
    SELECT COUNT(*)::int as count, COALESCE(SUM(file_size), 0)::bigint as total_size
    FROM kb_documents WHERE user_id = ${userId}
  `;
  const docCount = countResult[0].count as number;
  const totalSize = Number(countResult[0].total_size);

  if (docCount >= limits.maxDocs) {
    return `Document limit reached (${limits.maxDocs} documents on your plan). Upgrade or add your own LlamaIndex key for unlimited.`;
  }
  if ((totalSize + addSize) / (1024 * 1024) > limits.maxSizeMB) {
    return `Storage limit reached (${limits.maxSizeMB}MB). Contact admin to increase your storage quota.`;
  }
  return null;
}

async function processAndIndex(
  sql: ReturnType<typeof getDb>,
  docId: number,
  text: string,
  userId: number,
  plan?: string,
  scope?: string,
  orgId?: number,
  projectId?: number,
) {
  try {
    if (!text.trim()) {
      await sql`UPDATE kb_documents SET status = 'error', error_message = 'No extractable text found' WHERE id = ${docId}`;
      return;
    }

    await sql`UPDATE kb_documents SET status = 'processing' WHERE id = ${docId}`;

    // Get document title
    const docRows = await sql`SELECT title, doc_type FROM kb_documents WHERE id = ${docId}`;
    const title = (docRows[0]?.title as string) || "Untitled";
    const docType = (docRows[0]?.doc_type as string) || "text";

    // Try LlamaIndex Cloud first
    const liConfig = await loadLlamaIndexConfig(sql, userId, plan || "starter");
    if (liConfig) {
      const fileId = await uploadToLlamaIndex(
        liConfig, docId, title, text,
        { user_id: userId, org_id: orgId, scope: scope || "personal", doc_type: docType },
        sql, projectId,
      );
      await sql`UPDATE kb_documents SET status = 'ready', llamaindex_file_id = ${fileId}, chunk_count = ${Math.ceil(text.length / 2400)}, updated_at = NOW() WHERE id = ${docId}`;
      return;
    }

    // Fallback: pgvector (if LlamaIndex not configured)
    const overBudget = await isOverBudget(sql);
    if (overBudget) {
      await sql`UPDATE kb_documents SET status = 'queued', error_message = 'Embedding budget exceeded — queued for next period' WHERE id = ${docId}`;
      return;
    }

    const chunks = chunkText(text);
    if (chunks.length === 0) {
      await sql`UPDATE kb_documents SET status = 'error', error_message = 'No extractable text found' WHERE id = ${docId}`;
      return;
    }

    await sql`UPDATE kb_documents SET chunk_count = ${chunks.length} WHERE id = ${docId}`;
    const byokKeys = await loadEmbeddingKeys(sql, userId);

    const BATCH_SIZE = 20;
    for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
      const batch = chunks.slice(i, i + BATCH_SIZE);
      const embeddings = await generateEmbeddings(batch, byokKeys, sql, plan, userId);
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

    await sql`UPDATE kb_documents SET status = 'ready', updated_at = NOW() WHERE id = ${docId}`;
  } catch (e) {
    const errMsg = e instanceof Error ? e.message : "Unknown error during processing";
    await sql`UPDATE kb_documents SET status = 'error', error_message = ${errMsg} WHERE id = ${docId}`;
  }
}

async function handleFileUpload(
  req: NextRequest,
  sql: ReturnType<typeof getDb>,
  userId: number,
  plan: string,
  limits: { maxDocs: number; maxSizeMB: number },
) {
  const formData = await req.formData();
  const files = formData.getAll("file") as File[];
  const scope = (formData.get("scope") as string) || "personal";
  const orgId = formData.get("org_id") ? parseInt(formData.get("org_id") as string) : null;
  const projectId = formData.get("project_id") ? parseInt(formData.get("project_id") as string) : null;

  if (files.length === 0) {
    return NextResponse.json({ error: "No file provided" }, { status: 400 });
  }

  const results: { name: string; id?: number; error?: string }[] = [];

  for (const file of files) {
    const fileSize = file.size;
    const limitErr = await checkLimits(sql, userId, limits, fileSize, plan);
    if (limitErr) {
      results.push({ name: file.name, error: limitErr });
      continue;
    }

    // Determine document type
    const fileName = file.name.toLowerCase();
    let docType: string;
    if (fileName.endsWith(".pdf")) docType = "pdf";
    else if (fileName.endsWith(".docx") || fileName.endsWith(".doc")) docType = "docx";
    else if (fileName.match(/\.(png|jpg|jpeg|gif|webp)$/)) docType = "image";
    else if (fileName.match(/\.(txt|md|csv)$/)) docType = "text";
    else {
      results.push({ name: file.name, error: "Unsupported file type" });
      continue;
    }

    const title = file.name;

    // Create document record
    const docs = await sql`
      INSERT INTO kb_documents (user_id, org_id, project_id, scope, title, doc_type, file_size, status)
      VALUES (${userId}, ${orgId}, ${projectId}, ${scope}, ${title}, ${docType}, ${fileSize}, 'processing')
      RETURNING id
    `;
    const docId = docs[0].id as number;

    try {
      const buffer = Buffer.from(await file.arrayBuffer());

      // Store file in Vercel Blob for persistence
      let blobUrl: string | null = null;
      try {
        const blob = await put(`kb/${userId}/${docId}-${file.name}`, buffer, { access: "public" });
        blobUrl = blob.url;
        await sql`UPDATE kb_documents SET blob_url = ${blobUrl} WHERE id = ${docId}`;
      } catch { /* blob storage optional */ }

      let text: string;
      if (docType === "pdf") {
        text = await extractPdf(buffer);
      } else if (docType === "docx") {
        text = await extractDocx(buffer);
      } else if (docType === "image") {
        text = `[Image: ${title}]`;
      } else {
        text = buffer.toString("utf-8");
      }

      // Process: chunking + embedding
      await processAndIndex(sql, docId, text, userId, plan, scope, orgId ?? undefined, projectId ?? undefined);
      results.push({ name: file.name, id: docId });
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : "Processing failed";
      await sql`UPDATE kb_documents SET status = 'error', error_message = ${errMsg} WHERE id = ${docId}`;
      results.push({ name: file.name, id: docId, error: errMsg });
    }
  }

  const successCount = results.filter((r) => !r.error).length;
  if (results.length === 1) {
    // Single file: preserve original response format
    const r = results[0];
    if (r.error) return NextResponse.json({ id: r.id, status: "error", error: r.error }, { status: 500 });
    return NextResponse.json({ id: r.id, status: "ready" });
  }
  return NextResponse.json({ results, uploaded: successCount, total: results.length });
}

async function handleAddUrl(
  body: { url?: string; scope?: string; org_id?: number; project_id?: number },
  sql: ReturnType<typeof getDb>,
  userId: number,
  plan: string,
  limits: { maxDocs: number; maxSizeMB: number },
) {
  const { url, scope = "personal", org_id, project_id } = body;
  if (!url) {
    return NextResponse.json({ error: "URL required" }, { status: 400 });
  }

  const limitErr = await checkLimits(sql, userId, limits, 0, plan);
  if (limitErr) {
    return NextResponse.json({ error: limitErr }, { status: 403 });
  }

  try {
    // Verify URL is reachable with a simple HEAD (fall back to GET)
    let reachable = false;
    try {
      const headRes = await fetch(url, {
        method: "HEAD",
        headers: { "User-Agent": "Mozilla/5.0 (compatible; AutoClaw/1.0)" },
        signal: AbortSignal.timeout(10000),
        redirect: "follow",
      });
      reachable = headRes.ok;
    } catch { /* HEAD failed, try GET */ }

    if (!reachable) {
      try {
        const getRes = await fetch(url, {
          method: "GET",
          headers: { "User-Agent": "Mozilla/5.0 (compatible; AutoClaw/1.0)" },
          signal: AbortSignal.timeout(10000),
          redirect: "follow",
        });
        reachable = getRes.ok;
      } catch { /* GET also failed */ }
    }

    if (!reachable) {
      return NextResponse.json({ error: "Could not reach URL. Please check the link is valid and publicly accessible." }, { status: 400 });
    }

    const title = url.length > 100 ? url.slice(0, 100) + "..." : url;

    const docs = await sql`
      INSERT INTO kb_documents (user_id, org_id, project_id, scope, title, doc_type, source_url, status)
      VALUES (${userId}, ${org_id || null}, ${project_id || null}, ${scope}, ${title}, 'url', ${url}, 'ready')
      RETURNING id
    `;
    const docId = docs[0].id as number;

    // Best-effort: try to extract and embed content
    // Priority: Firecrawl (best for SPAs) → direct extractUrl
    try {
      let text = "";
      const firecrawlKey = await getFirecrawlKey(sql, userId);
      if (firecrawlKey) {
        try {
          const fcRes = await fetch("https://api.firecrawl.dev/v1/scrape", {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${firecrawlKey}` },
            body: JSON.stringify({ url, formats: ["markdown"] }),
          });
          if (fcRes.ok) {
            const fcData = (await fcRes.json()) as { success?: boolean; data?: { markdown?: string; metadata?: { title?: string } } };
            if (fcData.success && fcData.data?.markdown) {
              text = fcData.data.markdown;
              if (fcData.data.metadata?.title) {
                await sql`UPDATE kb_documents SET title = ${fcData.data.metadata.title} WHERE id = ${docId}`;
              }
            }
          }
        } catch { /* Firecrawl failed, fall through */ }
      }
      if (!text) {
        text = await extractUrl(url);
      }
      if (text) {
        const textSize = Buffer.byteLength(text, "utf-8");
        await sql`UPDATE kb_documents SET file_size = ${textSize} WHERE id = ${docId}`;
        await processAndIndex(sql, docId, text, userId, plan, scope, org_id ?? undefined, project_id ?? undefined);
      }
    } catch {
      // Content extraction failed — URL is saved as a reference
    }

    return NextResponse.json({ id: docId, status: "ready" });
  } catch (e) {
    console.error("handleAddUrl error:", e);
    const errMsg = e instanceof Error ? e.message : "Failed to add URL";
    return NextResponse.json({ error: errMsg }, { status: 500 });
  }
}

async function handleAddText(
  body: { title?: string; text?: string; scope?: string; org_id?: number; project_id?: number },
  sql: ReturnType<typeof getDb>,
  userId: number,
  plan: string,
  limits: { maxDocs: number; maxSizeMB: number },
) {
  const { title = "Untitled", text, scope = "personal", org_id, project_id } = body;
  if (!text) {
    return NextResponse.json({ error: "Text content required" }, { status: 400 });
  }

  const limitErr = await checkLimits(sql, userId, limits, 0, plan);
  if (limitErr) {
    return NextResponse.json({ error: limitErr }, { status: 403 });
  }

  const textSize = Buffer.byteLength(text, "utf-8");
  const docs = await sql`
    INSERT INTO kb_documents (user_id, org_id, project_id, scope, title, doc_type, file_size, status)
    VALUES (${userId}, ${org_id || null}, ${project_id || null}, ${scope}, ${title}, 'text', ${textSize}, 'processing')
    RETURNING id
  `;
  const docId = docs[0].id as number;

  try {
    await processAndIndex(sql, docId, text, userId, plan, scope, org_id ?? undefined, project_id ?? undefined);
    return NextResponse.json({ id: docId, status: "ready" });
  } catch (e) {
    const errMsg = e instanceof Error ? e.message : "Processing failed";
    await sql`UPDATE kb_documents SET status = 'error', error_message = ${errMsg} WHERE id = ${docId}`;
    return NextResponse.json({ id: docId, status: "error", error: errMsg }, { status: 500 });
  }
}

async function handleDelete(
  body: { document_id?: number },
  sql: ReturnType<typeof getDb>,
  userId: number,
  plan?: string,
) {
  const { document_id } = body;
  if (!document_id) {
    return NextResponse.json({ error: "document_id required" }, { status: 400 });
  }

  // Verify ownership (user owns the doc, or is admin of the org that owns it)
  const docs = await sql`SELECT id, user_id, org_id, llamaindex_file_id FROM kb_documents WHERE id = ${document_id}`;
  if (docs.length === 0) {
    return NextResponse.json({ error: "Document not found" }, { status: 404 });
  }

  const doc = docs[0];
  if (Number(doc.user_id) !== Number(userId)) {
    // Check if user is admin of the org
    if (doc.org_id) {
      const membership = await sql`
        SELECT role FROM organization_members
        WHERE org_id = ${doc.org_id} AND user_id = ${userId} AND role = 'admin'
      `;
      if (membership.length === 0) {
        return NextResponse.json({ error: "Not authorized to delete this document" }, { status: 403 });
      }
    } else {
      return NextResponse.json({ error: "Not authorized to delete this document" }, { status: 403 });
    }
  }

  // Delete from LlamaIndex Cloud if indexed there
  if (doc.llamaindex_file_id) {
    try {
      const liConfig = await loadLlamaIndexConfig(sql, userId, plan || "starter");
      if (liConfig) {
        await deleteFromLlamaIndex(liConfig, doc.llamaindex_file_id as string, sql, userId);
      }
    } catch { /* best-effort */ }
  }

  // Cascade delete handles chunks (pgvector fallback)
  await sql`DELETE FROM kb_documents WHERE id = ${document_id}`;
  return NextResponse.json({ deleted: true });
}

async function handleReprocess(
  body: { document_id?: number },
  sql: ReturnType<typeof getDb>,
  userId: number,
  plan?: string,
) {
  const { document_id } = body;
  if (!document_id) {
    return NextResponse.json({ error: "document_id required" }, { status: 400 });
  }

  const docs = await sql`
    SELECT id, user_id, doc_type, source_url FROM kb_documents WHERE id = ${document_id}
  `;
  if (docs.length === 0 || docs[0].user_id !== userId) {
    return NextResponse.json({ error: "Document not found or not authorized" }, { status: 404 });
  }

  // Delete existing chunks
  await sql`DELETE FROM kb_chunks WHERE document_id = ${document_id}`;
  await sql`UPDATE kb_documents SET status = 'processing', error_message = NULL WHERE id = ${document_id}`;

  // Re-extract if URL
  if (docs[0].doc_type === "url" && docs[0].source_url) {
    try {
      const text = await extractUrl(docs[0].source_url as string);
      await processAndIndex(sql, document_id, text, userId);
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : "Reprocess failed";
      await sql`UPDATE kb_documents SET status = 'error', error_message = ${errMsg} WHERE id = ${document_id}`;
    }
  } else {
    await sql`UPDATE kb_documents SET status = 'error', error_message = 'Reprocess only supported for URL documents. Re-upload files.' WHERE id = ${document_id}`;
  }

  return NextResponse.json({ reprocessing: true });
}

async function handleGetChunks(
  body: { document_id?: number },
  sql: ReturnType<typeof getDb>,
  userId: number,
) {
  const { document_id } = body;
  if (!document_id) {
    return NextResponse.json({ error: "document_id required" }, { status: 400 });
  }

  const docs = await sql`
    SELECT id, user_id FROM kb_documents WHERE id = ${document_id}
  `;
  if (docs.length === 0 || docs[0].user_id !== userId) {
    return NextResponse.json({ error: "Document not found or not authorized" }, { status: 404 });
  }

  const chunks = await sql`
    SELECT chunk_index, content, token_count
    FROM kb_chunks
    WHERE document_id = ${document_id}
    ORDER BY chunk_index ASC
  `;

  return NextResponse.json({ chunks });
}

async function handleEditUrl(
  body: { document_id?: number; title?: string; url?: string },
  sql: ReturnType<typeof getDb>,
  userId: number,
  plan: string,
  limits: { maxDocs: number; maxSizeMB: number },
) {
  const { document_id, title, url } = body;
  if (!document_id) {
    return NextResponse.json({ error: "document_id required" }, { status: 400 });
  }

  const docs = await sql`
    SELECT id, user_id, doc_type, source_url FROM kb_documents WHERE id = ${document_id}
  `;
  if (docs.length === 0 || docs[0].user_id !== userId) {
    return NextResponse.json({ error: "Document not found or not authorized" }, { status: 404 });
  }
  if (docs[0].doc_type !== "url") {
    return NextResponse.json({ error: "Only URL documents can be edited" }, { status: 400 });
  }

  const newUrl = url?.trim() || (docs[0].source_url as string);
  const newTitle = title?.trim() || newUrl;
  const urlChanged = newUrl !== docs[0].source_url;

  // If URL changed, verify it's reachable
  if (urlChanged) {
    let reachable = false;
    try {
      const headRes = await fetch(newUrl, {
        method: "HEAD",
        headers: { "User-Agent": "Mozilla/5.0 (compatible; AutoClaw/1.0)" },
        signal: AbortSignal.timeout(10000),
        redirect: "follow",
      });
      reachable = headRes.ok;
    } catch { /* HEAD failed */ }
    if (!reachable) {
      try {
        const getRes = await fetch(newUrl, {
          method: "GET",
          headers: { "User-Agent": "Mozilla/5.0 (compatible; AutoClaw/1.0)" },
          signal: AbortSignal.timeout(10000),
          redirect: "follow",
        });
        reachable = getRes.ok;
      } catch { /* GET also failed */ }
    }
    if (!reachable) {
      return NextResponse.json({ error: "Could not reach new URL. Please check the link." }, { status: 400 });
    }
  }

  // Update title and URL
  await sql`
    UPDATE kb_documents
    SET title = ${newTitle}, source_url = ${newUrl}, updated_at = NOW()
    WHERE id = ${document_id}
  `;

  // If URL changed, re-extract and re-embed
  if (urlChanged) {
    await sql`DELETE FROM kb_chunks WHERE document_id = ${document_id}`;
    await sql`UPDATE kb_documents SET status = 'processing', chunk_count = 0, error_message = NULL WHERE id = ${document_id}`;

    try {
      const text = await extractUrl(newUrl);
      const textSize = Buffer.byteLength(text, "utf-8");
      await sql`UPDATE kb_documents SET file_size = ${textSize} WHERE id = ${document_id}`;
      await processAndIndex(sql, document_id, text, userId, plan);
    } catch {
      // Extraction failed — still saved as reference
      await sql`UPDATE kb_documents SET status = 'ready' WHERE id = ${document_id}`;
    }
  }

  return NextResponse.json({ updated: true });
}

async function handleEditDoc(
  body: { document_id?: number; title?: string; text?: string },
  sql: ReturnType<typeof getDb>,
  userId: number,
  plan: string,
) {
  const { document_id, title, text } = body;
  if (!document_id) {
    return NextResponse.json({ error: "document_id required" }, { status: 400 });
  }

  const docs = await sql`SELECT id, user_id, doc_type FROM kb_documents WHERE id = ${document_id}`;
  if (docs.length === 0 || docs[0].user_id !== userId) {
    return NextResponse.json({ error: "Document not found or not authorized" }, { status: 404 });
  }

  // Update title if provided
  if (title?.trim()) {
    await sql`UPDATE kb_documents SET title = ${title.trim()}, updated_at = NOW() WHERE id = ${document_id}`;
  }

  // Update text content: delete old chunks and re-embed
  if (text?.trim()) {
    await sql`DELETE FROM kb_chunks WHERE document_id = ${document_id}`;
    const textSize = Buffer.byteLength(text, "utf-8");
    await sql`UPDATE kb_documents SET file_size = ${textSize}, status = 'processing', chunk_count = 0, error_message = NULL, updated_at = NOW() WHERE id = ${document_id}`;

    try {
      await processAndIndex(sql, document_id, text, userId, plan);
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : "Processing failed";
      await sql`UPDATE kb_documents SET status = 'error', error_message = ${errMsg} WHERE id = ${document_id}`;
    }
  }

  return NextResponse.json({ updated: true });
}

async function handleEditChunk(
  body: { document_id?: number; chunk_index?: number; content?: string },
  sql: ReturnType<typeof getDb>,
  userId: number,
  plan: string,
) {
  const { document_id, chunk_index, content } = body;
  if (!document_id || chunk_index === undefined || !content?.trim()) {
    return NextResponse.json({ error: "document_id, chunk_index, and content required" }, { status: 400 });
  }

  // Verify ownership
  const docs = await sql`SELECT id, user_id FROM kb_documents WHERE id = ${document_id}`;
  if (docs.length === 0 || docs[0].user_id !== userId) {
    return NextResponse.json({ error: "Document not found or not authorized" }, { status: 404 });
  }

  // Get chunk
  const chunks = await sql`
    SELECT id FROM kb_chunks WHERE document_id = ${document_id} AND chunk_index = ${chunk_index}
  `;
  if (chunks.length === 0) {
    return NextResponse.json({ error: "Chunk not found" }, { status: 404 });
  }
  const chunkId = chunks[0].id as number;

  // Re-generate embedding for updated content
  const byokKeys = await loadEmbeddingKeys(sql, userId);
  const tokenCount = estimateTokens(content);

  try {
    const [embedding] = await generateEmbeddings([content], byokKeys, sql, plan, userId);
    const embeddingStr = `[${embedding.join(",")}]`;
    await sql`
      UPDATE kb_chunks
      SET content = ${content}, embedding = ${embeddingStr}::vector, token_count = ${tokenCount}
      WHERE id = ${chunkId}
    `;
  } catch {
    // If embedding fails, still update the text but clear embedding
    await sql`
      UPDATE kb_chunks
      SET content = ${content}, embedding = NULL, token_count = ${tokenCount}
      WHERE id = ${chunkId}
    `;
  }

  return NextResponse.json({ updated: true });
}

async function handleAssignProject(
  body: { document_id?: number; project_id?: number | null },
  sql: ReturnType<typeof getDb>,
  userId: number,
) {
  const { document_id, project_id } = body;
  if (!document_id) {
    return NextResponse.json({ error: "document_id required" }, { status: 400 });
  }

  // Verify document ownership
  const docs = await sql`SELECT id, user_id, org_id FROM kb_documents WHERE id = ${document_id}`;
  if (docs.length === 0) {
    return NextResponse.json({ error: "Document not found" }, { status: 404 });
  }
  if (docs[0].user_id !== userId) {
    if (docs[0].org_id) {
      const membership = await sql`
        SELECT role FROM organization_members
        WHERE org_id = ${docs[0].org_id} AND user_id = ${userId} AND role = 'admin'
      `;
      if (membership.length === 0) {
        return NextResponse.json({ error: "Not authorized" }, { status: 403 });
      }
    } else {
      return NextResponse.json({ error: "Not authorized" }, { status: 403 });
    }
  }

  // Validate project access if assigning
  if (project_id !== null && project_id !== undefined) {
    const projects = await sql`
      SELECT DISTINCT p.id FROM projects p
      LEFT JOIN project_members pm ON pm.project_id = p.id AND pm.user_id = ${userId}
      LEFT JOIN organization_members om ON p.org_id = om.org_id AND om.user_id = ${userId}
      WHERE p.id = ${project_id} AND (p.user_id = ${userId} OR om.user_id = ${userId} OR pm.user_id = ${userId})
    `;
    if (projects.length === 0) {
      return NextResponse.json({ error: "Project not found or not accessible" }, { status: 404 });
    }
    await sql`
      UPDATE kb_documents
      SET project_id = ${project_id}, scope = 'project', updated_at = NOW()
      WHERE id = ${document_id}
    `;
  } else {
    // Remove project assignment
    await sql`
      UPDATE kb_documents
      SET project_id = NULL, scope = 'personal', updated_at = NOW()
      WHERE id = ${document_id}
    `;
  }

  const updated = await sql`SELECT * FROM kb_documents WHERE id = ${document_id}`;
  return NextResponse.json({ updated: true, document: updated[0] });
}
