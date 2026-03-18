import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

const WORKER_URL = process.env.WORKER_URL || "https://autoclaw-worker.jytech.workers.dev";
const WORKER_AUTH_SECRET = process.env.WORKER_AUTH_SECRET;
const CRON_SECRET = process.env.CRON_SECRET;
const WORKER_BATCH_SIZE = Math.max(1, Math.min(10, Number(process.env.WORKER_CRON_BATCH_SIZE || "1")));
const WORKER_MAX_BATCHES = Math.max(1, Math.min(100, Number(process.env.WORKER_CRON_MAX_BATCHES || "30")));

async function normalizeContentMetrics() {
  try {
    const sql = getDb();
    const updated = await sql`
      UPDATE agent_reports
      SET metrics = COALESCE(metrics, '{}'::jsonb) || jsonb_build_object('content_published', 1)
      WHERE created_at >= NOW() - INTERVAL '30 days'
        AND (
          LOWER(COALESCE(task_name, '')) LIKE '%blog%'
          OR LOWER(COALESCE(task_name, '')) LIKE '%content%'
          OR LOWER(COALESCE(task_name, '')) LIKE '%article%'
          OR LOWER(COALESCE(task_name, '')) LIKE '%post%'
          OR COALESCE(task_name, '') LIKE '%博客%'
          OR COALESCE(task_name, '') LIKE '%内容%'
          OR COALESCE(task_name, '') LIKE '%文章%'
          OR COALESCE(task_name, '') LIKE '%发布%'
        )
        AND NOT (
          COALESCE(metrics, '{}'::jsonb) ? 'content_published'
          OR COALESCE(metrics, '{}'::jsonb) ? 'content'
          OR COALESCE(metrics, '{}'::jsonb) ? 'posts_published'
          OR COALESCE(metrics, '{}'::jsonb) ? 'articles'
        )
      RETURNING id
    `;
    return updated.length;
  } catch {
    return 0;
  }
}

/**
 * Vercel Cron endpoint — calls Worker /cron to advance all active agent tasks.
 * Runs every 30 minutes via vercel.json.
 */
export async function GET(req: NextRequest) {
  // Verify cron secret
  const authHeader = req.headers.get("authorization");
  if (CRON_SECRET && authHeader !== `Bearer ${CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!WORKER_AUTH_SECRET) {
    return NextResponse.json({ error: "WORKER_AUTH_SECRET not configured" }, { status: 500 });
  }

  try {
    let startAfterId = 0;
    let batchCount = 0;
    let hasMore = true;
    let lastStatus = 200;
    const aggregatedResults: Array<{ agent_id: number; type: string; task: string; status: string }> = [];
    const errors: string[] = [];

    while (hasMore && batchCount < WORKER_MAX_BATCHES) {
      const res = await fetch(`${WORKER_URL}/cron`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${WORKER_AUTH_SECRET}`,
        },
        body: JSON.stringify({
          start_after_id: startAfterId,
          max_agents: WORKER_BATCH_SIZE,
        }),
      });

      lastStatus = res.status;
      batchCount += 1;

      if (!res.ok) {
        const text = await res.text();
        errors.push(`batch ${batchCount}: HTTP ${res.status} ${text}`);
        break;
      }

      const data = (await res.json()) as {
        has_more?: boolean;
        next_start_after?: number | null;
        results?: Array<{ agent_id: number; type: string; task: string; status: string }>;
      };

      if (Array.isArray(data.results)) {
        aggregatedResults.push(...data.results);
      }

      if (data.next_start_after && data.next_start_after > startAfterId) {
        startAfterId = data.next_start_after;
      } else {
        hasMore = false;
      }

      hasMore = Boolean(data.has_more) && hasMore;
    }

    const contentMetricsNormalized = await normalizeContentMetrics();

    return NextResponse.json({
      ok: true,
      worker_status: lastStatus,
      worker_batches: batchCount,
      worker_batch_size: WORKER_BATCH_SIZE,
      worker_has_more: hasMore,
      worker_results_count: aggregatedResults.length,
      worker_errors: errors,
      results: aggregatedResults,
      content_metrics_normalized: contentMetricsNormalized,
    });
  } catch (e) {
    const contentMetricsNormalized = await normalizeContentMetrics();
    return NextResponse.json(
      { error: `Failed to call worker: ${e}`, content_metrics_normalized: contentMetricsNormalized },
      { status: 502 }
    );
  }
}
