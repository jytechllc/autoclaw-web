import { NextRequest, NextResponse } from "next/server";
import { auth0 } from "@/lib/auth0";
import { getDb } from "@/lib/db";
import { decrypt } from "@/lib/crypto";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    const session = await auth0.getSession();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const sql = getDb();
    const email = session.user.email as string;
    const users = await sql`SELECT id FROM users WHERE email = ${email}`;
    if (users.length === 0) return NextResponse.json({ error: "User not found" }, { status: 404 });
    const userId = users[0].id as number;

    const body = await req.json();

    // Image analysis via GLM-4.6V-Flash (free)
    if (body.action === "analyze") {
      const imageUrl = body.image_url;
      if (!imageUrl) return NextResponse.json({ error: "Image required" }, { status: 400 });

      // Load z.ai key
      let zaiKey = process.env.ZAI_API_KEY || "";
      try {
        const rows = await sql`
          SELECT api_key FROM user_api_keys WHERE user_id = ${userId} AND service IN ('z_ai', 'glm', 'zhipu')
          UNION ALL
          SELECT ok.api_key FROM org_api_keys ok
            WHERE ok.service IN ('z_ai', 'glm', 'zhipu')
            AND ok.org_id IN (SELECT org_id FROM organization_members WHERE user_id = ${userId})
          LIMIT 1
        `;
        if (rows.length > 0) zaiKey = decrypt(rows[0].api_key as string);
      } catch { /* use system key */ }

      if (!zaiKey) return NextResponse.json({ error: "z.ai API key not configured" }, { status: 503 });

      const isDataUrl = imageUrl.startsWith("data:");
      const content: unknown[] = [
        ...(isDataUrl
          ? [{ type: "image_url", image_url: { url: imageUrl } }]
          : [{ type: "image_url", image_url: { url: imageUrl } }]),
        { type: "text", text: `You are an Etsy product photography expert. Analyze this product image and provide detailed feedback for improving its Etsy listing performance.

Evaluate and score (1-10) each aspect:
1. **Composition** — Is the product well-centered? Good use of space?
2. **Lighting** — Natural/studio lighting quality? Shadows?
3. **Background** — Clean? Appropriate for Etsy? (white/neutral recommended for main image)
4. **Styling & Props** — Are there complementary props? Does it tell a story?
5. **Image Quality** — Resolution, sharpness, color accuracy?
6. **Etsy Compliance** — Square format? No text overlays? No watermarks?

Then provide:
- **Overall Score** (out of 10)
- **Top 3 Improvements** (specific, actionable)
- **Recommended Etsy photo set** (what other angles/shots to add)

Be specific and actionable. Write in a friendly, helpful tone.` },
      ];

      const res = await fetch("https://api.z.ai/api/paas/v4/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${zaiKey}` },
        body: JSON.stringify({
          model: "GLM-4.6V-Flash",
          messages: [{ role: "user", content }],
          max_tokens: 1000,
        }),
      });

      if (!res.ok) {
        const errText = await res.text().catch(() => "");
        return NextResponse.json({ error: `Analysis failed: ${res.status} ${errText.substring(0, 100)}` }, { status: res.status });
      }

      const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
      const analysis = data.choices?.[0]?.message?.content || "No analysis returned";

      // Track usage
      try {
        await sql`INSERT INTO token_usage (user_id, provider, model, prompt_tokens, completion_tokens, total_tokens, source)
          VALUES (${userId}, 'zhipu', 'GLM-4.6V-Flash', 0, 0, 1, 'etsy-analyze')`;
      } catch { /* non-critical */ }

      return NextResponse.json({ analysis });
    }

    const { product_name, product_description, style_prompt, style_id, model: requestModel } = body;

    if (!product_name) return NextResponse.json({ error: "Product name required" }, { status: 400 });

    // Build the prompt
    const fullPrompt = `${style_prompt}. Product: ${product_name}${product_description ? `. ${product_description}` : ""}. For Etsy marketplace listing, square format, high quality, professional product photography.`;

    let imageUrl = "";
    let modelUsed = "";

    // Primary: PIXAZO free models (SDXL for HD product photos)
    const pixazoKey = process.env.PIXAZO_API_KEY;
    const useModel = requestModel || "sdxl"; // default to SDXL for Etsy (better quality at 1024px)

    if (pixazoKey && (useModel === "sdxl" || useModel === "flux-schnell")) {
      try {
        const endpoint = useModel === "sdxl"
          ? "https://gateway.pixazo.ai/getImage/v1/getSDXLImage"
          : "https://gateway.pixazo.ai/flux-1-schnell/v1/getData";

        const requestBody = useModel === "sdxl"
          ? { prompt: fullPrompt, negative_prompt: "blurry, low quality, distorted, text overlay, watermark", height: 1024, width: 1024, num_steps: 20, guidance_scale: 5, seed: Math.floor(Math.random() * 100000) }
          : { prompt: fullPrompt, num_steps: 4, seed: Math.floor(Math.random() * 100000), height: 512, width: 512 };

        const res = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json", "Cache-Control": "no-cache", "Ocp-Apim-Subscription-Key": pixazoKey },
          body: JSON.stringify(requestBody),
        });
        if (res.ok) {
          const data = await res.json() as { output?: string; imageUrl?: string };
          imageUrl = data.output || data.imageUrl || "";
          modelUsed = useModel;
        }
      } catch { /* fall through to DALL-E */ }
    }

    // Fallback: DALL-E 3 (BYOK)
    if (!imageUrl) {
      let openaiKey = process.env.OPENAI_API_KEY || "";
      try {
        const rows = await sql`
          SELECT api_key FROM user_api_keys WHERE user_id = ${userId} AND service = 'openai'
          UNION ALL
          SELECT ok.api_key FROM org_api_keys ok
            WHERE ok.service = 'openai'
            AND ok.org_id IN (SELECT org_id FROM organization_members WHERE user_id = ${userId})
          LIMIT 1
        `;
        if (rows.length > 0) openaiKey = decrypt(rows[0].api_key as string);
      } catch { /* use system key */ }

      if (!openaiKey) {
        return NextResponse.json({ error: "No image generation available. PIXAZO failed and OpenAI key not configured." }, { status: 503 });
      }

      const res = await fetch("https://api.openai.com/v1/images/generations", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${openaiKey}` },
        body: JSON.stringify({ model: "dall-e-3", prompt: fullPrompt, n: 1, size: "1024x1024", quality: "standard" }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        const errMsg = (errData as { error?: { message?: string } })?.error?.message || `OpenAI API error ${res.status}`;
        return NextResponse.json({ error: errMsg }, { status: res.status });
      }

      const data = (await res.json()) as { data?: { url?: string; revised_prompt?: string }[] };
      imageUrl = data.data?.[0]?.url || "";
      modelUsed = "dall-e-3";
    }

    if (!imageUrl) {
      return NextResponse.json({ error: "No image generated" }, { status: 500 });
    }

    // Track usage
    const provider = modelUsed === "dall-e-3" ? "openai" : "pixazo";
    try {
      await sql`
        INSERT INTO token_usage (user_id, provider, model, prompt_tokens, completion_tokens, total_tokens, source)
        VALUES (${userId}, ${provider}, ${modelUsed}, 0, 0, 1, 'etsy-image')
      `;
    } catch { /* non-critical */ }

    return NextResponse.json({
      url: imageUrl,
      prompt: fullPrompt,
      style: style_id,
      model: modelUsed,
    });
  } catch (err) {
    console.error("[POST /api/etsy-image]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
