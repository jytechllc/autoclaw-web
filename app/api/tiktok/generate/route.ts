import { NextRequest, NextResponse } from "next/server";
import { auth0 } from "@/lib/auth0";
import { getDb } from "@/lib/db";
import { checkRateLimit } from "@/lib/rate-limit";
import { getUserKey } from "@/lib/keys";
import { put } from "@vercel/blob";

export const dynamic = "force-dynamic";

async function ensureGeneratedVideosTable() {
  const sql = getDb();
  await sql`
    CREATE TABLE IF NOT EXISTS generated_videos (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      task_id VARCHAR(255) NOT NULL,
      provider VARCHAR(100),
      model VARCHAR(255),
      prompt TEXT NOT NULL,
      duration INTEGER DEFAULT 5,
      status VARCHAR(50) DEFAULT 'processing',
      video_url TEXT,
      blob_url TEXT,
      original_url TEXT,
      poll_url TEXT,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )
  `;
}

function getIp(req: NextRequest): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}

const TEXT_TO_VIDEO_MODELS = [
  { id: "wavespeed-ai/wan-2.2/t2v-480p-ultra-fast", label: "Wan 2.2 — 480p Ultra Fast", tier: "fast", durations: [5, 8] },
  { id: "wavespeed-ai/wan-2.2/t2v-720p", label: "Wan 2.2 — 720p", tier: "standard", durations: [5, 8] },
  { id: "alibaba/wan-2.6/text-to-video", label: "Wan 2.6 Audio", tier: "standard", durations: [5, 10, 15] },
  { id: "bytedance/seedance-v1.5-pro/text-to-video", label: "Seedance 1.5 Pro Audio", tier: "premium", durations: [5, 8, 10, 12] },
  { id: "kwaivgi/kling-video-o3-std/text-to-video", label: "Kling Video O3", tier: "premium", durations: [5, 8, 10, 12] },
  { id: "seedance-2.0/text-to-video", label: "Seedance 2.0 Audio", tier: "premium", durations: [5, 8, 10, 12] },
];

// POST: Generate video via xPilot API
export async function POST(req: NextRequest) {
  const ip = getIp(req);
  const allowed = checkRateLimit(ip, { limit: 5, windowMs: 60000 });
  if (!allowed) {
    return NextResponse.json({ error: "Rate limited" }, { status: 429 });
  }

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
      { error: "xPilot API key not configured. Add it in Settings > Market." },
      { status: 400 }
    );
  }

  const body = await req.json();
  const { prompt, duration = 5, model = "wavespeed-ai/wan-2.2/t2v-480p-ultra-fast", narration, generate_audio } = body;

  if (!prompt) {
    return NextResponse.json({ error: "prompt is required" }, { status: 400 });
  }

  // Validate model
  const validModel = TEXT_TO_VIDEO_MODELS.find((m) => m.id === model);
  if (!validModel) {
    return NextResponse.json({ error: "Invalid model" }, { status: 400 });
  }

  // Build request body
  const generateBody: Record<string, unknown> = {
    model,
    prompt,
    duration,
    aspect_ratio: "9:16",
  };

  // Add narration if provided
  if (narration?.text) {
    generateBody.narration = {
      text: narration.text,
      voice: narration.voice || "nova",
      style: narration.style || "professional",
    };
  }

  // Add audio generation (Seedance/Kling models)
  if (generate_audio) {
    generateBody.generate_audio = true;
  }

  try {
    const res = await fetch("https://xpilot.jytech.us/api/v1/video/generate", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${xpilotKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(generateBody),
    });

    const data = await res.json();
    if (!res.ok) {
      const errMsg = typeof data.error === "string"
        ? data.error
        : (data.error?.message || data.message || (Object.keys(data).length > 0 ? JSON.stringify(data) : `xPilot returned ${res.status} with no details`));
      return NextResponse.json({ error: errMsg }, { status: 502 });
    }

    const resultTaskId = data.taskId || data.task_id || data.id;
    const resultPollUrl = data.poll_url || data.pollUrl;

    // Save record to DB
    try {
      await ensureGeneratedVideosTable();
      await sql`
        INSERT INTO generated_videos (user_id, task_id, provider, model, prompt, duration, status, poll_url)
        VALUES (${userId}, ${resultTaskId}, ${data.provider || null}, ${model}, ${prompt}, ${duration}, 'processing', ${resultPollUrl || null})
      `;
    } catch (dbErr) {
      console.warn("Failed to save video record:", dbErr);
    }

    return NextResponse.json({
      taskId: resultTaskId,
      provider: data.provider,
      pollUrl: resultPollUrl,
      message: "Video generation started",
    });
  } catch (err) {
    console.error("xPilot video generation error:", err);
    return NextResponse.json({ error: "Failed to generate video" }, { status: 500 });
  }
}

// GET: Poll video status or list models
export async function GET(req: NextRequest) {
  const listModels = req.nextUrl.searchParams.get("listModels");
  if (listModels === "true") {
    return NextResponse.json({ models: TEXT_TO_VIDEO_MODELS });
  }

  const session = await auth0.getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // List user's video history
  const listVideos = req.nextUrl.searchParams.get("listVideos");
  if (listVideos === "true") {
    const sql = getDb();
    const sub = session.user.sub;
    const users = await sql`SELECT id FROM users WHERE auth0_id = ${sub} LIMIT 1`;
    if (users.length === 0) return NextResponse.json({ videos: [] });
    await ensureGeneratedVideosTable();
    const videos = await sql`
      SELECT task_id, model, prompt, duration, status, video_url, blob_url, original_url, created_at
      FROM generated_videos WHERE user_id = ${users[0].id}
      ORDER BY created_at DESC LIMIT 50
    `;
    // Add proxy URLs for completed videos
    const origin = req.nextUrl.origin;
    const videosWithProxy = videos.map((v: Record<string, unknown>) => ({
      ...v,
      proxy_url: v.status === "completed" ? `${origin}/api/videos/${v.task_id}` : null,
    }));
    return NextResponse.json({ videos: videosWithProxy });
  }

  const taskId = req.nextUrl.searchParams.get("taskId");
  const provider = req.nextUrl.searchParams.get("provider");

  if (!taskId) {
    return NextResponse.json({ error: "taskId is required" }, { status: 400 });
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

  try {
    const pollUrl = req.nextUrl.searchParams.get("pollUrl");
    // pollUrl from xPilot is already the full relative path with all query params
    let fetchUrl: string;
    if (pollUrl) {
      fetchUrl = `https://xpilot.jytech.us${pollUrl}`;
    } else {
      const params = new URLSearchParams();
      if (provider) params.set("provider", provider);
      const qs = params.toString() ? `?${params.toString()}` : "";
      fetchUrl = `https://xpilot.jytech.us/api/v1/video/${taskId}${qs}`;
    }
    const res = await fetch(fetchUrl, {
      headers: { Authorization: `Bearer ${xpilotKey}` },
    });

    const data = await res.json();
    const videoUrl = data.outputs?.[0] || data.output?.video_url || data.videoUrl || data.video_url || data.output?.url;

    // If completed and has video URL, save to Vercel Blob and update DB
    if (data.status === "completed" && videoUrl) {
      let finalUrl = videoUrl;
      let blobUrl: string | null = null;

      const blobToken = await getUserKey(userId, "blob_token");
      if (blobToken) {
        try {
          const videoRes = await fetch(videoUrl);
          if (videoRes.ok) {
            const videoBlob = await videoRes.blob();
            const filename = `tiktok-videos/${taskId}.mp4`;
            const blob = await put(filename, videoBlob, {
              access: "public",
              contentType: "video/mp4",
              token: blobToken,
            });
            finalUrl = blob.url;
            blobUrl = blob.url;
          }
        } catch (blobErr) {
          console.warn("Failed to save to Vercel Blob, using original URL:", blobErr);
        }
      }

      // Update DB record
      try {
        await sql`
          UPDATE generated_videos
          SET status = 'completed', video_url = ${finalUrl}, blob_url = ${blobUrl}, original_url = ${videoUrl}, updated_at = NOW()
          WHERE task_id = ${taskId} AND user_id = ${userId}
        `;
      } catch (dbErr) {
        console.warn("Failed to update video record:", dbErr);
      }

      // Return proxy URL through our domain for TikTok compatibility
      const proxyUrl = `${req.nextUrl.origin}/api/videos/${taskId}`;
      return NextResponse.json({ status: "completed", videoUrl: proxyUrl, originalUrl: videoUrl });
    }

    // Update failed status in DB
    if (data.status === "failed") {
      try {
        await sql`
          UPDATE generated_videos SET status = 'failed', updated_at = NOW()
          WHERE task_id = ${taskId} AND user_id = ${userId}
        `;
      } catch (dbErr) {
        console.warn("Failed to update video record:", dbErr);
      }
    }

    return NextResponse.json({
      status: data.status,
      videoUrl,
      progress: data.progress,
    });
  } catch (err) {
    console.error("xPilot status poll error:", err);
    return NextResponse.json({ error: "Failed to check status" }, { status: 500 });
  }
}
