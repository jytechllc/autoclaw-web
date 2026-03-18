import { NextRequest, NextResponse } from "next/server";
import { auth0 } from "@/lib/auth0";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

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
