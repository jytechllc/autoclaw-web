import { NextRequest, NextResponse } from "next/server";
import { auth0 } from "@/lib/auth0";
import { getDb } from "@/lib/db";
import { decrypt } from "@/lib/crypto";

export const dynamic = "force-dynamic";

const XPILOT_BASE = "https://xpilot.jytech.us/api/v1";

async function getUserKey(userId: number, service: string): Promise<string | null> {
  const sql = getDb();
  const keys = await sql`
    SELECT api_key FROM user_api_keys WHERE user_id = ${userId} AND service = ${service} LIMIT 1
  `;
  if (keys.length === 0) return null;
  return decrypt(keys[0].api_key);
}

// POST: Generate an image via xPilot API
export async function POST(req: NextRequest) {
  const session = await auth0.getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sql = getDb();
  const sub = session.user.sub;
  const users = await sql`SELECT id FROM users WHERE auth0_id = ${sub} LIMIT 1`;
  if (users.length === 0) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  const userId = users[0].id;
  const xpilotKey = await getUserKey(userId, "xpilot");
  if (!xpilotKey) {
    return NextResponse.json(
      { error: "xPilot API key not configured. Add it in Settings." },
      { status: 400 },
    );
  }

  const body = await req.json();
  const { prompt, aspect_ratio, mode, image_url, model } = body;

  if (!prompt?.trim()) {
    return NextResponse.json({ error: "prompt is required" }, { status: 400 });
  }

  const generateBody: Record<string, unknown> = {
    model: model || "bytedance/seedream-v4.5",
    prompt: prompt.trim(),
    aspect_ratio: aspect_ratio || "1:1",
  };

  if (mode) generateBody.mode = mode;
  if (image_url) generateBody.image_url = image_url;

  try {
    const res = await fetch(`${XPILOT_BASE}/image/generate`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${xpilotKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(generateBody),
    });

    const data = await res.json();
    if (!res.ok) {
      console.error("xPilot image error:", res.status, data);
      return NextResponse.json(
        { error: data.error?.message || data.error || "Image generation failed" },
        { status: res.status },
      );
    }

    // If outputs returned immediately
    if (data.outputs?.[0]) {
      return NextResponse.json({ status: "completed", outputs: data.outputs });
    }

    // Async task — return task info for polling
    return NextResponse.json({
      status: "processing",
      taskId: data.task_id,
      pollUrl: data.poll_url,
    });
  } catch (err) {
    console.error("xPilot image generation error:", err);
    return NextResponse.json({ error: "Failed to generate image" }, { status: 500 });
  }
}

// GET: Poll image generation status
export async function GET(req: NextRequest) {
  const session = await auth0.getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sql = getDb();
  const sub = session.user.sub;
  const users = await sql`SELECT id FROM users WHERE auth0_id = ${sub} LIMIT 1`;
  if (users.length === 0) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  const userId = users[0].id;
  const xpilotKey = await getUserKey(userId, "xpilot");
  if (!xpilotKey) {
    return NextResponse.json({ error: "xPilot API key not configured" }, { status: 400 });
  }

  const pollUrl = req.nextUrl.searchParams.get("pollUrl");
  const taskId = req.nextUrl.searchParams.get("taskId");

  if (!pollUrl && !taskId) {
    return NextResponse.json({ error: "pollUrl or taskId required" }, { status: 400 });
  }

  const fetchUrl = pollUrl
    ? `https://xpilot.jytech.us${pollUrl}`
    : `https://xpilot.jytech.us/api/v1/image/${taskId}`;

  try {
    const res = await fetch(fetchUrl, {
      headers: { Authorization: `Bearer ${xpilotKey}` },
    });
    const data = await res.json();

    if (data.status === "completed" && data.outputs?.[0]) {
      return NextResponse.json({ status: "completed", outputs: data.outputs });
    }
    if (data.status === "failed") {
      return NextResponse.json({ status: "failed", error: data.error || "Image generation failed" });
    }

    return NextResponse.json({ status: "processing" });
  } catch (err) {
    console.error("xPilot poll error:", err);
    return NextResponse.json({ error: "Failed to check status" }, { status: 500 });
  }
}
