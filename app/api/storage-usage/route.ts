import { NextResponse } from "next/server";
import { auth0 } from "@/lib/auth0";
import { getDb, resolveUserPlan } from "@/lib/db";
import { list } from "@vercel/blob";
import { getUserKey } from "@/lib/keys";

export const dynamic = "force-dynamic";

export async function GET() {
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
  const userPlan = await resolveUserPlan(sql, userId, (users[0].plan as string) || "starter", email);

  // 1. Database usage
  let dbStats = { totalSize: "0 MB", tableCount: 0, tables: [] as { name: string; rows: number; size: string }[] };
  try {
    const sizeRows = await sql`
      SELECT
        schemaname || '.' || relname AS table_name,
        n_live_tup AS row_count,
        pg_size_pretty(pg_total_relation_size(relid)) AS total_size,
        pg_total_relation_size(relid) AS size_bytes
      FROM pg_stat_user_tables
      ORDER BY pg_total_relation_size(relid) DESC
      LIMIT 20
    `;
    const dbSizeRows = await sql`SELECT pg_size_pretty(pg_database_size(current_database())) as total`;
    dbStats = {
      totalSize: (dbSizeRows[0]?.total as string) || "0 MB",
      tableCount: sizeRows.length,
      tables: sizeRows.map((r) => ({
        name: (r.table_name as string).replace("public.", ""),
        rows: r.row_count as number,
        size: r.total_size as string,
      })),
    };
  } catch { /* non-critical */ }

  // 2. Knowledge base usage
  let kbStats = { docCount: 0, chunkCount: 0, totalTokens: 0 };
  try {
    const kbRows = await sql`
      SELECT
        COUNT(DISTINCT d.id) as doc_count,
        COUNT(c.id) as chunk_count,
        COALESCE(SUM(c.token_count), 0) as total_tokens
      FROM kb_documents d
      LEFT JOIN kb_chunks c ON c.document_id = d.id
      WHERE d.status = 'ready'
    `;
    if (kbRows.length > 0) {
      kbStats = {
        docCount: kbRows[0].doc_count as number,
        chunkCount: kbRows[0].chunk_count as number,
        totalTokens: kbRows[0].total_tokens as number,
      };
    }
  } catch { /* non-critical */ }

  // 3. Embedding usage
  let embeddingStats = { period: "", requestCount: 0, tokenCount: 0, budget: 500000 };
  try {
    const period = `${new Date().getUTCFullYear()}-${String(new Date().getUTCMonth() + 1).padStart(2, "0")}`;
    const rows = await sql`SELECT request_count, token_count FROM embedding_usage WHERE period = ${period}`;
    if (rows.length > 0) {
      embeddingStats = {
        period,
        requestCount: rows[0].request_count as number,
        tokenCount: rows[0].token_count as number,
        budget: parseInt(process.env.EMBEDDING_MONTHLY_BUDGET || "500000", 10),
      };
    }
  } catch { /* non-critical */ }

  // 4. Vercel Blob usage (if user has blob_token)
  let blobStats = { configured: false, totalFiles: 0, totalBytes: 0, totalSizeMB: "0" };
  try {
    const blobToken = await getUserKey(userId, "blob_token");
    if (blobToken) {
      blobStats.configured = true;
      let cursor: string | undefined;
      let totalFiles = 0;
      let totalBytes = 0;
      // Paginate through all blobs (max 3 pages to avoid timeout)
      for (let page = 0; page < 3; page++) {
        const result = await list({ token: blobToken, cursor, limit: 1000 });
        totalFiles += result.blobs.length;
        totalBytes += result.blobs.reduce((sum, b) => sum + b.size, 0);
        if (!result.hasMore) break;
        cursor = result.cursor;
      }
      blobStats.totalFiles = totalFiles;
      blobStats.totalBytes = totalBytes;
      blobStats.totalSizeMB = (totalBytes / 1024 / 1024).toFixed(2);
    }
  } catch { /* non-critical */ }

  // 5. Contacts & leads counts
  let dataStats = { contacts: 0, leads: 0, projects: 0, agents: 0 };
  try {
    const rows = await sql`
      SELECT
        (SELECT COUNT(*) FROM contacts WHERE user_id = ${userId})::int as contacts,
        (SELECT COUNT(*) FROM projects WHERE user_id = ${userId} OR org_id IN (SELECT org_id FROM organization_members WHERE user_id = ${userId}))::int as projects
    `;
    const leadRows = await sql`
      SELECT COUNT(*)::int as cnt FROM contacts WHERE emails_sent = 0 AND project_id IN (
        SELECT id FROM projects WHERE user_id = ${userId} OR org_id IN (SELECT org_id FROM organization_members WHERE user_id = ${userId})
      )
    `;
    const agentRows = await sql`
      SELECT COUNT(*)::int as cnt FROM agent_assignments WHERE project_id IN (
        SELECT id FROM projects WHERE user_id = ${userId} OR org_id IN (SELECT org_id FROM organization_members WHERE user_id = ${userId})
      )
    `;
    dataStats = {
      contacts: (rows[0]?.contacts as number) || 0,
      leads: (leadRows[0]?.cnt as number) || 0,
      projects: (rows[0]?.projects as number) || 0,
      agents: (agentRows[0]?.cnt as number) || 0,
    };
  } catch { /* non-critical */ }

  return NextResponse.json({
    plan: userPlan,
    database: dbStats,
    knowledgeBase: kbStats,
    embeddings: embeddingStats,
    blob: blobStats,
    data: dataStats,
  });
}
