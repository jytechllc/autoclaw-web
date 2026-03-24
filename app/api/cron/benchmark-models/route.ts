import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { runFullBenchmark } from "@/lib/openrouter-benchmark";

export const dynamic = "force-dynamic";
export const maxDuration = 300; // 5 minutes — benchmarking many models takes time

const CRON_SECRET = process.env.CRON_SECRET;

/**
 * Daily cron: benchmark all available free AI models (OpenRouter + direct providers)
 * and store results. The chat API auto-selects the best model from latest results.
 *
 * Schedule: Daily at 3 AM UTC (vercel.json)
 * Manual trigger: GET /api/cron/benchmark-models?secret=<CRON_SECRET>
 */
export async function GET(req: NextRequest) {
  // Auth: Vercel cron passes Bearer token; manual trigger via query param
  const authHeader = req.headers.get("authorization");
  const querySecret = req.nextUrl.searchParams.get("secret");
  if (CRON_SECRET && authHeader !== `Bearer ${CRON_SECRET}` && querySecret !== CRON_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const sql = getDb();

    // Ensure table exists
    await sql`
      CREATE TABLE IF NOT EXISTS model_benchmarks (
        id SERIAL PRIMARY KEY,
        model_id VARCHAR(255) NOT NULL,
        model_name VARCHAR(255) NOT NULL,
        provider VARCHAR(100),
        context_length INTEGER DEFAULT 0,
        score_tool_calling REAL DEFAULT 0,
        score_multilingual REAL DEFAULT 0,
        score_instruction REAL DEFAULT 0,
        score_speed REAL DEFAULT 0,
        score_total REAL DEFAULT 0,
        latency_ms INTEGER DEFAULT 0,
        is_available BOOLEAN DEFAULT true,
        error_message TEXT,
        run_id VARCHAR(50) NOT NULL,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `;

    // Run benchmark across all providers
    const { runId, results } = await runFullBenchmark();

    // Store results
    for (const r of results) {
      await sql`
        INSERT INTO model_benchmarks (
          model_id, model_name, provider, context_length,
          score_tool_calling, score_multilingual, score_instruction,
          score_speed, score_total, latency_ms, is_available, error_message, run_id
        ) VALUES (
          ${r.model_id}, ${r.model_name}, ${r.provider}, ${r.context_length},
          ${r.score_tool_calling}, ${r.score_multilingual}, ${r.score_instruction},
          ${r.score_speed}, ${r.score_total}, ${r.latency_ms}, ${r.is_available},
          ${r.error_message}, ${runId}
        )
      `;
    }

    // Cleanup: keep only last 7 benchmark runs (1 week of daily runs)
    await sql`
      DELETE FROM model_benchmarks
      WHERE run_id NOT IN (
        SELECT DISTINCT run_id FROM model_benchmarks ORDER BY run_id DESC LIMIT 7
      )
    `;

    const available = results.filter((r) => r.is_available);
    const top3 = available.slice(0, 3);

    return NextResponse.json({
      ok: true,
      run_id: runId,
      total_models_tested: results.length,
      available_models: available.length,
      top_3: top3.map((r) => ({
        model_id: r.model_id,
        model_name: r.model_name,
        score: r.score_total,
        latency_ms: r.latency_ms,
        scores: {
          tool_calling: r.score_tool_calling,
          multilingual: r.score_multilingual,
          instruction: r.score_instruction,
          speed: r.score_speed,
        },
      })),
    });
  } catch (e) {
    console.error("[benchmark-models] Error:", e);
    return NextResponse.json(
      { error: `Benchmark failed: ${e instanceof Error ? e.message : String(e)}` },
      { status: 500 },
    );
  }
}
