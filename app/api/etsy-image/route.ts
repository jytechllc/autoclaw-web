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
    const { product_name, product_description, style_prompt, style_id } = body;

    if (!product_name) return NextResponse.json({ error: "Product name required" }, { status: 400 });

    // Load OpenAI key: BYOK → system env
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
      return NextResponse.json({ error: "OpenAI API key not configured. Add it in Settings → API Keys." }, { status: 503 });
    }

    // Build the prompt
    const fullPrompt = `${style_prompt}. Product: ${product_name}${product_description ? `. ${product_description}` : ""}. For Etsy marketplace listing, square format, high quality, professional product photography.`;

    // Call DALL-E 3
    const res = await fetch("https://api.openai.com/v1/images/generations", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${openaiKey}`,
      },
      body: JSON.stringify({
        model: "dall-e-3",
        prompt: fullPrompt,
        n: 1,
        size: "1024x1024",
        quality: "standard",
      }),
    });

    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      const errMsg = (errData as { error?: { message?: string } })?.error?.message || `OpenAI API error ${res.status}`;
      return NextResponse.json({ error: errMsg }, { status: res.status });
    }

    const data = (await res.json()) as { data?: { url?: string; revised_prompt?: string }[] };
    const imageUrl = data.data?.[0]?.url;
    const revisedPrompt = data.data?.[0]?.revised_prompt;

    if (!imageUrl) {
      return NextResponse.json({ error: "No image generated" }, { status: 500 });
    }

    // Track usage
    try {
      await sql`
        INSERT INTO token_usage (user_id, provider, model, prompt_tokens, completion_tokens, total_tokens, source)
        VALUES (${userId}, 'openai', 'dall-e-3', 0, 0, 1, 'etsy-image')
      `;
    } catch { /* non-critical */ }

    return NextResponse.json({
      url: imageUrl,
      prompt: revisedPrompt || fullPrompt,
      style: style_id,
    });
  } catch (err) {
    console.error("[POST /api/etsy-image]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
