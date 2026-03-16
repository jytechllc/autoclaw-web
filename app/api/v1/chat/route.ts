import { NextRequest } from "next/server";
import { authenticateV1, apiSuccess, apiError, parsePagination } from "@/lib/api-v1";
import { chatWithAI, type ByokKeys } from "@/lib/ai";
import { decrypt } from "@/lib/crypto";
import { searchKnowledgeBase, buildRagContext } from "@/lib/rag";
import { loadEmbeddingKeys } from "@/lib/embeddings";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/chat
 * Get chat history.
 * Query params: project_id, limit, offset
 */
export async function GET(req: NextRequest) {
  const ctx = await authenticateV1(req, "read");
  if ("status" in ctx) return ctx;

  const { sql, userId } = ctx;
  const { limit, offset } = parsePagination(req);
  const projectId = req.nextUrl.searchParams.get("project_id");

  let messages;
  if (projectId) {
    messages = await sql`
      SELECT id, role, content, agent_type, created_at
      FROM chat_messages
      WHERE user_id = ${userId} AND project_id = ${parseInt(projectId)}
      ORDER BY created_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `;
  } else {
    messages = await sql`
      SELECT id, role, content, agent_type, created_at
      FROM chat_messages
      WHERE user_id = ${userId}
      ORDER BY created_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `;
  }

  // Return in chronological order
  messages.reverse();

  return apiSuccess({ messages, limit, offset });
}

/**
 * POST /api/v1/chat
 * Send a chat message and get AI response.
 * Body: { message, model?, project_id? }
 */
export async function POST(req: NextRequest) {
  const ctx = await authenticateV1(req, "write");
  if ("status" in ctx) return ctx;

  const { sql, userId, plan } = ctx;
  const body = await req.json();
  const { message, model, project_id } = body;

  if (!message?.trim()) return apiError("message is required", 400);

  // Load BYOK keys
  const keyRows = await sql`
    SELECT service, api_key FROM user_api_keys
    WHERE user_id = ${userId} AND service IN ('openai', 'anthropic', 'google', 'alibaba', 'cerebras')
  `;
  const byokKeys: ByokKeys = {};
  for (const row of keyRows) {
    try {
      const key = decrypt(row.api_key as string);
      (byokKeys as Record<string, string>)[row.service as string] = key;
    } catch { /* skip */ }
  }

  // Save user message
  await sql`
    INSERT INTO chat_messages (user_id, project_id, role, content)
    VALUES (${userId}, ${project_id || null}, 'user', ${message})
  `;

  // RAG context
  let ragContext = "";
  try {
    const embeddingKeys = await loadEmbeddingKeys(sql, userId);
    const ragResults = await searchKnowledgeBase(sql, message, {
      userId,
      projectId: project_id || undefined,
      byokKeys: embeddingKeys,
      plan,
      topK: 3,
    });
    ragContext = buildRagContext(ragResults, 2000);
  } catch { /* RAG unavailable */ }

  // Build system prompt
  let systemPrompt = "You are AutoClaw AI assistant. Help the user with their business, marketing, and technical questions. Be concise and actionable.";
  if (ragContext) {
    systemPrompt += "\n\n" + ragContext;
  }

  // Get recent history for context
  const history = await sql`
    SELECT role, content FROM chat_messages
    WHERE user_id = ${userId}
      ${project_id ? sql`AND project_id = ${project_id}` : sql``}
    ORDER BY created_at DESC
    LIMIT 20
  `;
  history.reverse();

  const chatMessages: { role: "system" | "user" | "assistant"; content: string }[] = [
    { role: "system", content: systemPrompt },
    ...history.map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content as string,
    })),
  ];

  try {
    const result = await chatWithAI(chatMessages, 2000, byokKeys, model || undefined);
    const reply = result.content;

    // Save assistant response
    await sql`
      INSERT INTO chat_messages (user_id, project_id, role, content, agent_type)
      VALUES (${userId}, ${project_id || null}, 'assistant', ${reply}, 'autoclaw')
    `;

    return apiSuccess({ reply });
  } catch (e) {
    const errMsg = e instanceof Error ? e.message : "Chat failed";
    return apiError(errMsg, 500);
  }
}
