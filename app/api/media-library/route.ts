import { NextRequest, NextResponse } from "next/server";
import { auth0 } from "@/lib/auth0";
import { getDb } from "@/lib/db";
import { getUserKey } from "@/lib/keys";
import { put } from "@vercel/blob";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const XPILOT_BASE = "https://xpilot.jytech.us/api/v1";

// GET: list media library items
export async function GET(req: NextRequest) {
  const session = await auth0.getSession();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const sql = getDb();
  const email = session.user.email as string;
  const users = await sql`SELECT id FROM users WHERE email = ${email}`;
  if (users.length === 0) return NextResponse.json({ items: [] });
  const userId = users[0].id as number;

  const projectId = req.nextUrl.searchParams.get("project_id");
  const tag = req.nextUrl.searchParams.get("tag");
  const search = req.nextUrl.searchParams.get("q");

  let items;
  if (projectId) {
    items = await sql`SELECT * FROM media_library WHERE user_id = ${userId} AND project_id = ${parseInt(projectId)} ORDER BY created_at DESC`;
  } else {
    items = await sql`SELECT * FROM media_library WHERE user_id = ${userId} ORDER BY created_at DESC`;
  }

  // Client-side filtering for tags and search (simple for MVP)
  let filtered = items;
  if (tag) {
    filtered = filtered.filter((i) => (i.tags as string[])?.includes(tag));
  }
  if (search) {
    const q = search.toLowerCase();
    filtered = filtered.filter((i) =>
      (i.title as string)?.toLowerCase().includes(q) ||
      (i.description as string)?.toLowerCase().includes(q) ||
      (i.prompt as string)?.toLowerCase().includes(q)
    );
  }

  return NextResponse.json({ items: filtered });
}

// POST: generate image, describe image, or delete
export async function POST(req: NextRequest) {
  const session = await auth0.getSession();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const sql = getDb();
  const email = session.user.email as string;
  const users = await sql`SELECT id FROM users WHERE email = ${email}`;
  if (users.length === 0) return NextResponse.json({ error: "User not found" }, { status: 404 });
  const userId = users[0].id as number;

  const body = await req.json();
  const { action } = body;

  if (action === "generate") {
    return handleGenerate(body, sql, userId);
  }
  if (action === "describe") {
    return handleDescribe(body, sql, userId);
  }
  if (action === "delete") {
    const { id } = body;
    if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
    await sql`DELETE FROM media_library WHERE id = ${id} AND user_id = ${userId}`;
    return NextResponse.json({ deleted: true });
  }
  if (action === "update") {
    const { id, title, description, tags, project_id } = body;
    if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
    await sql`
      UPDATE media_library SET
        title = COALESCE(${title || null}, title),
        description = COALESCE(${description || null}, description),
        tags = COALESCE(${tags || null}, tags),
        project_id = COALESCE(${project_id ?? null}, project_id)
      WHERE id = ${id} AND user_id = ${userId}
    `;
    return NextResponse.json({ updated: true });
  }

  if (action === "inpaint") {
    return handleInpaint(body, sql, userId);
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}

async function handleInpaint(
  body: { prompt?: string; image_url?: string; mask_url?: string; project_id?: number },
  sql: ReturnType<typeof getDb>,
  userId: number,
) {
  const { prompt, image_url, mask_url, project_id } = body;
  if (!prompt?.trim() || !image_url || !mask_url) {
    return NextResponse.json({ error: "prompt, image_url, and mask_url required" }, { status: 400 });
  }

  const pixazoKey = process.env.PIXAZO_API_KEY;
  if (!pixazoKey) return NextResponse.json({ error: "PIXAZO_API_KEY not configured" }, { status: 400 });

  const res = await fetch("https://gateway.pixazo.ai/inpainting/v1/getImage", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-cache",
      "Ocp-Apim-Subscription-Key": pixazoKey,
    },
    body: JSON.stringify({
      prompt: prompt.trim(),
      imageUrl: image_url,
      maskUrl: mask_url,
      negative_prompt: "watermark, blurry, low quality",
      height: 1024,
      width: 1024,
      num_steps: 20,
      guidance: 5,
      seed: Math.floor(Math.random() * 100000),
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    return NextResponse.json({ error: `Inpainting error: ${err}` }, { status: 500 });
  }

  const data = await res.json() as { output?: string; imageUrl?: string };
  const resultUrl = data.output || data.imageUrl || "";
  if (!resultUrl) return NextResponse.json({ error: "No image returned" }, { status: 500 });

  const rows = await sql`
    INSERT INTO media_library (user_id, project_id, title, image_url, model, provider, prompt, tags, status)
    VALUES (${userId}, ${project_id || null}, ${prompt.trim().slice(0, 100)}, ${resultUrl}, ${"sd-inpainting"}, ${"pixazo"}, ${prompt.trim()}, ${["inpainting"]}, 'ready')
    RETURNING id
  `;

  return NextResponse.json({ id: rows[0].id, image_url: resultUrl, model: "sd-inpainting" });
}

async function handleGenerate(
  body: { prompt?: string; model?: string; aspect_ratio?: string; project_id?: number; tags?: string[] },
  sql: ReturnType<typeof getDb>,
  userId: number,
) {
  const { prompt, model = "flux-schnell", aspect_ratio = "1:1", project_id, tags } = body;
  if (!prompt?.trim()) return NextResponse.json({ error: "prompt required" }, { status: 400 });

  // Map aspect_ratio to width/height for PIXAZO
  const sizeMap: Record<string, { width: number; height: number }> = {
    "1:1": { width: 512, height: 512 },
    "16:9": { width: 1024, height: 576 },
    "9:16": { width: 576, height: 1024 },
    "4:3": { width: 768, height: 576 },
    "3:4": { width: 576, height: 768 },
  };

  // Determine provider and generate
  let imageUrl = "";
  let provider = "";
  let modelUsed = "";

  if (model === "flux-schnell" || model === "sdxl") {
    // PIXAZO free models
    const pixazoKey = process.env.PIXAZO_API_KEY;
    if (!pixazoKey) return NextResponse.json({ error: "PIXAZO_API_KEY not configured" }, { status: 400 });

    const size = sizeMap[aspect_ratio] || sizeMap["1:1"];
    const isSDXL = model === "sdxl";

    // SDXL supports higher res and negative prompts; Flux Schnell is faster
    const endpoint = isSDXL
      ? "https://gateway.pixazo.ai/getImage/v1/getSDXLImage"
      : "https://gateway.pixazo.ai/flux-1-schnell/v1/getData";

    const sdxlSize = { width: Math.min(size.width * 2, 1024), height: Math.min(size.height * 2, 1024) };
    const requestBody = isSDXL
      ? { prompt: prompt.trim(), negative_prompt: "blurry, low quality, distorted", height: sdxlSize.height, width: sdxlSize.width, num_steps: 20, guidance_scale: 5, seed: Math.floor(Math.random() * 100000) }
      : { prompt: prompt.trim(), num_steps: 4, seed: Math.floor(Math.random() * 100000), height: size.height, width: size.width };

    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-cache",
        "Ocp-Apim-Subscription-Key": pixazoKey,
      },
      body: JSON.stringify(requestBody),
    });
    if (!res.ok) {
      const err = await res.text();
      return NextResponse.json({ error: `Image generation error: ${err}` }, { status: 500 });
    }
    const data = await res.json() as { output?: string; imageUrl?: string };
    imageUrl = data.output || data.imageUrl || "";
    provider = "pixazo";
    modelUsed = model;

  } else if (model === "nano-banana-2" || model === "gemini") {
    // Google Nano Banana 2 via Gemini API
    const googleKey = process.env.GOOGLE_AI_API;
    if (!googleKey) return NextResponse.json({ error: "Google AI API key not configured" }, { status: 400 });

    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent?key=${googleKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: `Generate an image: ${prompt}` }] }],
          generationConfig: { responseModalities: ["IMAGE", "TEXT"] },
        }),
      }
    );
    if (!res.ok) {
      const err = await res.text();
      return NextResponse.json({ error: `Gemini error: ${err}` }, { status: 500 });
    }
    const data = await res.json();
    const imagePart = data.candidates?.[0]?.content?.parts?.find((p: { inlineData?: unknown }) => p.inlineData);
    if (imagePart?.inlineData?.data) {
      const buffer = Buffer.from(imagePart.inlineData.data, "base64");
      const blob = await put(`media/${userId}/${Date.now()}.png`, buffer, { access: "public" });
      imageUrl = blob.url;
    }
    provider = "google";
    modelUsed = "gemini-3.1-flash-image-preview";

  } else {
    // xPilot (Seedream v4.5)
    const xpilotKey = await getUserKey(userId, "xpilot");
    if (!xpilotKey) return NextResponse.json({ error: "xPilot API key not configured. Add it in Settings." }, { status: 400 });

    const res = await fetch(`${XPILOT_BASE}/image/generate`, {
      method: "POST",
      headers: { Authorization: `Bearer ${xpilotKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "bytedance/seedream-v4.5",
        prompt: prompt.trim(),
        aspect_ratio,
      }),
    });
    const data = await res.json();
    if (!res.ok) return NextResponse.json({ error: data.error?.message || "Image generation failed" }, { status: 500 });

    if (data.outputs?.[0]?.url) {
      imageUrl = data.outputs[0].url;
    } else if (data.task_id) {
      // Async — poll for result
      for (let i = 0; i < 30; i++) {
        await new Promise((r) => setTimeout(r, 2000));
        const pollRes = await fetch(`${XPILOT_BASE}/image/${data.task_id}`, {
          headers: { Authorization: `Bearer ${xpilotKey}` },
        });
        const pollData = await pollRes.json();
        if (pollData.status === "completed" && pollData.outputs?.[0]?.url) {
          imageUrl = pollData.outputs[0].url;
          break;
        }
        if (pollData.status === "failed") {
          return NextResponse.json({ error: pollData.error || "Generation failed" }, { status: 500 });
        }
      }
    }
    provider = "xpilot";
    modelUsed = "bytedance/seedream-v4.5";
  }

  if (!imageUrl) return NextResponse.json({ error: "No image generated" }, { status: 500 });

  // Save to media library
  const rows = await sql`
    INSERT INTO media_library (user_id, project_id, title, image_url, model, provider, prompt, tags, status)
    VALUES (${userId}, ${project_id || null}, ${prompt.trim().slice(0, 100)}, ${imageUrl}, ${modelUsed}, ${provider}, ${prompt.trim()}, ${tags || []}, 'ready')
    RETURNING id
  `;

  return NextResponse.json({ id: rows[0].id, image_url: imageUrl, model: modelUsed, provider });
}

async function handleDescribe(
  body: { id?: number; image_url?: string },
  sql: ReturnType<typeof getDb>,
  userId: number,
) {
  const { id, image_url } = body;
  const url = image_url || (id ? ((await sql`SELECT image_url FROM media_library WHERE id = ${id} AND user_id = ${userId}`)[0]?.image_url as string) : null);
  if (!url) return NextResponse.json({ error: "image_url or id required" }, { status: 400 });

  // Use GLM-4.6V via z.ai for image description
  const glmKey = process.env.ZAI_API_KEY;
  if (!glmKey) return NextResponse.json({ error: "ZAI_API_KEY not configured" }, { status: 400 });

  const res = await fetch("https://api.z.ai/api/paas/v4/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${glmKey}`,
    },
    body: JSON.stringify({
      model: "GLM-4.6V-Flash",
      messages: [{
        role: "user",
        content: [
          { type: "image_url", image_url: { url } },
          { type: "text", text: "Describe this image in detail for use as alt text and social media caption. Provide: 1) A concise title (under 10 words) 2) A detailed description (2-3 sentences) 3) Suggested tags (comma-separated). Format as JSON: {\"title\": \"...\", \"description\": \"...\", \"tags\": [\"...\"]}" },
        ],
      }],
      max_tokens: 500,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    return NextResponse.json({ error: `GLM-4.6V error: ${err}` }, { status: 500 });
  }

  const data = await res.json();
  const content = data.choices?.[0]?.message?.content || "";

  // Parse JSON from response
  let parsed: { title?: string; description?: string; tags?: string[] } = {};
  try {
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) parsed = JSON.parse(jsonMatch[0]);
  } catch {
    parsed = { title: "", description: content, tags: [] };
  }

  // Update media library if id provided
  if (id) {
    await sql`
      UPDATE media_library SET
        title = COALESCE(${parsed.title || null}, title),
        description = COALESCE(${parsed.description || null}, description),
        tags = COALESCE(${parsed.tags || null}, tags)
      WHERE id = ${id} AND user_id = ${userId}
    `;
  }

  return NextResponse.json({ ...parsed, model: "GLM-4.6V-Flash" });
}
