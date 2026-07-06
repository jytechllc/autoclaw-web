import { NextRequest, NextResponse } from "next/server";
import { runOssScan } from "@/lib/oss-monitor";

export const dynamic = "force-dynamic";
// ~13 sequential HF fetches + one Bedrock call; well under this, but leave headroom.
export const maxDuration = 120;

const CRON_SECRET = process.env.CRON_SECRET;

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  if (CRON_SECRET && authHeader !== `Bearer ${CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const outcome = await runOssScan();
    return NextResponse.json({ ok: true, ...outcome });
  } catch (e) {
    console.error("[oss-model-watch] scan failed:", e);
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
