import { NextRequest, NextResponse } from "next/server";
import { auth0 } from "@/lib/auth0";
import { getDb } from "@/lib/db";
import { chatWithAI, type ByokKeys } from "@/lib/ai";
import { getUserKey } from "@/lib/keys";

export const dynamic = "force-dynamic";

async function getKbContext(sql: ReturnType<typeof getDb>, userId: number, orgId?: number): Promise<string> {
  try {
    // Get recent KB documents as brand/product context
    const docs = await sql`
      SELECT title, doc_type, file_size,
        (SELECT string_agg(content, ' ') FROM (
          SELECT content FROM kb_chunks WHERE document_id = d.id ORDER BY chunk_index LIMIT 3
        ) sub) as snippet
      FROM kb_documents d
      WHERE (d.user_id = ${userId} ${orgId ? sql`OR d.org_id = ${orgId}` : sql``})
        AND d.status = 'ready'
      ORDER BY d.updated_at DESC
      LIMIT 5
    `;

    if (docs.length === 0) return "";

    const context = docs
      .filter((d) => d.snippet)
      .map((d) => `[${d.title}]: ${(d.snippet as string).slice(0, 300)}`)
      .join("\n");

    return context ? `\n\nHere is brand/product context from the knowledge base:\n${context}` : "";
  } catch {
    return "";
  }
}

export async function POST(req: NextRequest) {
  const session = await auth0.getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const sql = getDb();
  const sub = session.user.sub;
  const users = await sql`SELECT id FROM users WHERE auth0_id = ${sub} LIMIT 1`;
  if (users.length === 0) return NextResponse.json({ error: "User not found" }, { status: 404 });
  const userId = users[0].id as number;

  const body = await req.json();
  const { channels, type, locale: reqLocale, org_name, org_id, media_type } = body as {
    channels: { service: string; username: string }[];
    type: "post" | "image" | "video";
    locale?: string;
    org_name?: string;
    org_id?: number;
    media_type?: string;
  };

  // Get BYOK keys for AI
  const byokKeys: ByokKeys = {};
  for (const svc of ["openai", "anthropic", "google", "alibaba", "cerebras"] as const) {
    const k = await getUserKey(userId, svc);
    if (k) byokKeys[svc] = k;
  }

  // Fetch knowledge base context
  const kbContext = await getKbContext(sql, userId, org_id);

  const lang = reqLocale === "zh" || reqLocale === "zh-TW" ? "中文" : reqLocale === "fr" ? "French" : "English";
  const channelList = channels.map((c) => `${c.service} (@${c.username})`).join(", ");

  let prompt = "";
  if (type === "post") {
    prompt = `Generate a social media post caption in ${lang} for these channels: ${channelList}.${org_name ? ` The organization is "${org_name}".` : ""}${media_type === "video" ? " This is for a video post." : media_type === "image" ? " This is for an image post." : ""}${kbContext} Include relevant hashtags. Keep it engaging, concise (under 200 chars), and platform-appropriate. Use the knowledge base context to make the content relevant to the brand. Return ONLY the caption text, nothing else.`;
  } else if (type === "image") {
    prompt = `Generate an image generation prompt in English for a social media post on ${channelList}.${org_name ? ` The brand/org is "${org_name}".` : ""}${kbContext} The image should be eye-catching, on-brand, and platform-appropriate. Return ONLY the image prompt (under 100 words), no explanation.`;
  } else if (type === "video") {
    prompt = `Generate a video generation prompt in English for a short video on ${channelList}.${org_name ? ` The brand/org is "${org_name}".` : ""}${kbContext} The video should be attention-grabbing, on-brand, and suitable for social media. Return ONLY the video prompt (under 80 words), no explanation.`;
  }

  try {
    const result = await chatWithAI(
      [{ role: "user", content: prompt }],
      200,
      byokKeys
    );
    return NextResponse.json({ suggestion: result.content.trim() });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "AI generation failed" }, { status: 500 });
  }
}
