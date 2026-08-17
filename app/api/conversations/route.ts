import { NextRequest, NextResponse } from "next/server";
import { auth0 } from "@/lib/auth0";
import { getDb } from "@/lib/db";
import { chatWithAI } from "@/lib/ai";

export const dynamic = "force-dynamic";

// Untouched default titles (per locale) — auto_title only ever replaces these,
// never a name the user typed themselves.
const DEFAULT_TITLES = new Set(["New Chat", "新对话", "新對話", "새 채팅"]);

// GET: list conversations
export async function GET(req: NextRequest) {
  try {
    const session = await auth0.getSession();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const sql = getDb();
    const email = session.user.email as string;
    const users = await sql`SELECT id FROM users WHERE email = ${email}`;
    if (users.length === 0) {
      return NextResponse.json({ conversations: [] });
    }
    const userId = users[0].id as number;
    const projectId = req.nextUrl.searchParams.get("project_id");

    const conversations = projectId
      ? await sql`
          SELECT c.id, c.title, c.project_id, c.created_at, c.updated_at,
            (SELECT COUNT(*)::int FROM chat_messages m WHERE m.conversation_id = c.id) as message_count
          FROM conversations c
          WHERE c.user_id = ${userId} AND c.project_id = ${projectId}
          ORDER BY c.updated_at DESC
        `
      : await sql`
          SELECT c.id, c.title, c.project_id, c.created_at, c.updated_at,
            (SELECT COUNT(*)::int FROM chat_messages m WHERE m.conversation_id = c.id) as message_count
          FROM conversations c
          WHERE c.user_id = ${userId} AND c.project_id IS NULL
          ORDER BY c.updated_at DESC
        `;

    return NextResponse.json({ conversations });
  } catch (err) {
    console.error("[GET /api/conversations]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// POST: create, rename, delete conversation
export async function POST(req: NextRequest) {
  try {
    const session = await auth0.getSession();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const sql = getDb();
    const email = session.user.email as string;
    const users = await sql`SELECT id FROM users WHERE email = ${email}`;
    if (users.length === 0) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }
    const userId = users[0].id as number;

    const body = await req.json();
    const { action } = body;

    switch (action) {
      case "create": {
        const { title, project_id } = body;
        const conv = await sql`
          INSERT INTO conversations (user_id, project_id, title)
          VALUES (${userId}, ${project_id || null}, ${title || "New Chat"})
          RETURNING id, title, project_id, created_at, updated_at
        `;
        return NextResponse.json({ conversation: conv[0] });
      }

      case "rename": {
        const { conversation_id, title } = body;
        if (!conversation_id || !title?.trim()) {
          return NextResponse.json({ error: "conversation_id and title required" }, { status: 400 });
        }
        await sql`
          UPDATE conversations SET title = ${title.trim()}, updated_at = NOW()
          WHERE id = ${conversation_id} AND user_id = ${userId}
        `;
        return NextResponse.json({ updated: true });
      }

      case "auto_title": {
        // Generate a short AI title from the first user message. Falls back to
        // plain truncation (the previous client-side behavior) if the AI call fails.
        const { conversation_id, message } = body;
        if (!conversation_id || !message?.trim()) {
          return NextResponse.json({ error: "conversation_id and message required" }, { status: 400 });
        }
        const rows = await sql`SELECT title FROM conversations WHERE id = ${conversation_id} AND user_id = ${userId}`;
        if (rows.length === 0) {
          return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
        }
        const currentTitle = ((rows[0].title as string) || "").trim();
        if (currentTitle && !DEFAULT_TITLES.has(currentTitle)) {
          return NextResponse.json({ updated: false, title: currentTitle });
        }

        const firstMessage = (message as string).trim();
        let title = firstMessage.length > 50 ? firstMessage.slice(0, 50).trimEnd() + "…" : firstMessage;
        try {
          const r = await chatWithAI(
            [
              { role: "system", content: "Generate a very short title (max 6 words) for a conversation that starts with the user message. Use the same language as the message. Reply with the title only — no quotes, no trailing punctuation." },
              { role: "user", content: firstMessage.slice(0, 500) },
            ],
            24,
          );
          const generated = r.content.trim().replace(/^["'“”«»]+|["'“”«»]+$/g, "").split("\n")[0].trim().slice(0, 60);
          if (generated) title = generated;
        } catch {
          /* AI unavailable — keep the truncation fallback */
        }

        await sql`
          UPDATE conversations SET title = ${title}, updated_at = NOW()
          WHERE id = ${conversation_id} AND user_id = ${userId}
        `;
        return NextResponse.json({ updated: true, title });
      }

      case "delete": {
        const { conversation_id } = body;
        if (!conversation_id) {
          return NextResponse.json({ error: "conversation_id required" }, { status: 400 });
        }
        // ON DELETE CASCADE handles chat_messages
        await sql`DELETE FROM conversations WHERE id = ${conversation_id} AND user_id = ${userId}`;
        return NextResponse.json({ deleted: true });
      }

      default:
        return NextResponse.json({ error: "Unknown action" }, { status: 400 });
    }
  } catch (err) {
    console.error("[POST /api/conversations]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
