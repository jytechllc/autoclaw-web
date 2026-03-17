import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { generateEmbeddings, isOverBudget } from "@/lib/embeddings";
import { chunkText, estimateTokens } from "@/lib/chunking";
import { chatWithAI } from "@/lib/ai";

export const dynamic = "force-dynamic";
export const maxDuration = 300; // 5 minutes for Vercel

const CRON_SECRET = process.env.CRON_SECRET;
const GOOGLE_AI_API = process.env.GOOGLE_AI_API;

/**
 * System user ID for product docs (user_id = 0 or a dedicated system user).
 * We use scope = 'system' so all users can access product docs via RAG.
 * The kb_documents table needs to support user_id = NULL for system docs.
 * We'll use user_id of the first admin user or create docs without user_id constraint.
 */
const SYSTEM_DOC_TITLE_PREFIX = "[AutoClaw Product Docs]";

/**
 * Define sections of the product to document.
 * Each section reads from source code and gets summarized by AI.
 */
interface DocSection {
  key: string;
  title: string;
  prompt: string;
  /** Function that returns raw source content to summarize */
  getSource: () => Promise<string>;
}

/**
 * Read a file from the filesystem (works in serverless via dynamic import).
 * Falls back gracefully if file doesn't exist.
 */
async function readFile(path: string): Promise<string> {
  try {
    const fs = await import("fs/promises");
    return await fs.readFile(path, "utf-8");
  } catch {
    return "";
  }
}

/**
 * Extract i18n strings from the en.ts module at runtime.
 * This is more reliable than reading the file since the module is bundled.
 */
async function getEnDict(): Promise<string> {
  try {
    const { getDictionary } = await import("@/lib/i18n");
    const dict = getDictionary("en");
    // Extract pricing, features, and key sections as JSON
    return JSON.stringify({
      pricing: (dict as Record<string, unknown>).pricing,
      features: (dict as Record<string, unknown>).features,
      hero: (dict as Record<string, unknown>).hero,
      cta: (dict as Record<string, unknown>).cta,
      faq: (dict as Record<string, unknown>).faq,
      docsPage: (dict as Record<string, unknown>).docsPage,
      enterpriseDiagram: (dict as Record<string, unknown>).enterpriseDiagram,
    }, null, 2);
  } catch {
    return "";
  }
}

function buildSections(): DocSection[] {
  return [
    {
      key: "platform-overview",
      title: "AutoClaw Platform Overview",
      prompt: `Summarize what AutoClaw is and what it does based on the source code below. Include:
- What is AutoClaw (AI marketing automation platform by JY Tech)
- Core value proposition (autonomous AI employees for marketing)
- Key features: AI agents, knowledge base, chat assistant, analytics
- Multi-language support (English, Chinese, French)
- Target audience (businesses without dedicated marketing teams)
Write as clear product documentation. Be specific about capabilities.`,
      getSource: async () => {
        const chatRoute = await readFile(
          process.cwd() + "/app/api/chat/route.ts"
        );
        const enDict = await getEnDict();
        // Extract relevant sections
        const agentSection = chatRoute.slice(0, 3000);
        return `## i18n Content (features, pricing, hero):\n${enDict.slice(0, 4000)}\n\n## Chat Route (agent definitions):\n${agentSection}`;
      },
    },
    {
      key: "ai-agents",
      title: "AutoClaw AI Marketing Agents",
      prompt: `Create detailed product documentation about AutoClaw's AI marketing agents based on the source code. For each agent type, document:
- Agent name and purpose
- What tasks it performs
- What integrations it uses (Brevo, Hunter.io, CRM, etc.)
- What the user needs to configure (API keys, website URL, etc.)
- What plan is required

Agent types: Email Marketing, SEO & Content, Lead Prospecting, Social Media, Product Manager, Sales Follow-up, Orchestrator.
Write as clear product documentation with specific details.`,
      getSource: async () => {
        const chatRoute = await readFile(
          process.cwd() + "/app/api/chat/route.ts"
        );
        return chatRoute.slice(0, 6000); // Agent definitions and plans
      },
    },
    {
      key: "pricing-plans",
      title: "AutoClaw Pricing & Plans",
      prompt: `Create product documentation about AutoClaw's pricing plans based on the i18n content below. Include:
- All plan tiers (Starter/Free, Growth, Scale, Enterprise)
- Price per month and commitment period
- Number of AI employees allowed
- Key features per plan
- Enterprise plan special features (JY Tech dedicated support, monitoring, project collaboration)
- China pricing if available
Write as clear pricing documentation.`,
      getSource: async () => {
        const enDict = await getEnDict();
        return enDict;
      },
    },
    {
      key: "chat-commands",
      title: "AutoClaw Chat Commands & Capabilities",
      prompt: `Document all the chat commands and capabilities available in AutoClaw's chat assistant based on the source code. Include:
- Project management commands (create, rename, delete, list)
- Agent activation/deactivation commands
- Lead prospecting commands (find leads, prospect domain)
- Configuration commands (set website, add API keys)
- Status and report commands
- BYOK (Bring Your Own Key) commands and supported services
- How RAG/knowledge base enhances responses
Write as a user-facing help document.`,
      getSource: async () => {
        const chatRoute = await readFile(
          process.cwd() + "/app/api/chat/route.ts"
        );
        // Extract the action handling section (pattern matching)
        return chatRoute.slice(2000, 8000);
      },
    },
    {
      key: "knowledge-base",
      title: "AutoClaw Knowledge Base & RAG",
      prompt: `Document the AutoClaw Knowledge Base feature based on the source code. Include:
- What document types are supported (PDF, DOCX, URL, text)
- How documents are processed (chunking, embedding)
- How RAG works in the chat (vector similarity search)
- Plan limits for document uploads
- Embedding providers supported (Google, OpenAI)
- How to use the knowledge base effectively
Write as user-facing product documentation.`,
      getSource: async () => {
        const rag = await readFile(process.cwd() + "/lib/rag.ts");
        const chunking = await readFile(process.cwd() + "/lib/chunking.ts");
        const embeddings = await readFile(
          process.cwd() + "/lib/embeddings.ts"
        );
        return `## RAG System:\n${rag.slice(0, 3000)}\n\n## Chunking:\n${chunking.slice(0, 2000)}\n\n## Embeddings:\n${embeddings.slice(0, 2000)}`;
      },
    },
    {
      key: "integrations",
      title: "AutoClaw Integrations & APIs",
      prompt: `Document all integrations and APIs supported by AutoClaw based on the source code. Include:
- Email: Brevo (SendinBlue) for email campaigns
- CRM: HubSpot, Twenty CRM for lead management
- Lead enrichment: Hunter.io, Snov.io, Apollo.io
- Social: X/Twitter API, LinkedIn
- Analytics: Google Analytics Data API
- AI models: Cerebras (free), NVIDIA (free), OpenAI, Anthropic Claude, Google Gemini, Alibaba Qwen
- Payment: Stripe for subscriptions
- Auth: Auth0 for authentication
Write as integration documentation for users.`,
      getSource: async () => {
        const ai = await readFile(process.cwd() + "/lib/ai.ts");
        const leads = await readFile(process.cwd() + "/lib/leads.ts");
        return `## AI Models:\n${ai.slice(0, 3000)}\n\n## Lead Prospecting:\n${leads ? leads.slice(0, 3000) : "Hunter.io, Snov.io, Apollo.io integration for B2B lead finding"}`;
      },
    },
    {
      key: "enterprise-plan",
      title: "AutoClaw Enterprise Plan & JY Tech Support",
      prompt: `Document the AutoClaw Enterprise Plan based on the source content. Include:
- What's included in Enterprise (everything in Scale + dedicated features)
- JY Tech's role: dedicated support, performance monitoring, operations oversight
- How JY Tech can be invited to client's specific projects
- Project collaboration model
- Dedicated infrastructure, custom SLA, SSO, on-premise deployment
- Custom AI agent training
- Contact: jay.lin@jytech.us, helen.lan@jytech.us
Write as sales-facing product documentation.`,
      getSource: async () => {
        const enDict = await getEnDict();
        return enDict;
      },
    },
  ];
}

/**
 * Use Cerebras (free) to summarize source code into product documentation.
 */
async function summarizeWithAI(
  sourceContent: string,
  prompt: string,
): Promise<string> {
  const messages = [
    {
      role: "system" as const,
      content:
        "You are a technical writer creating product documentation for AutoClaw, an AI marketing automation platform by JY Tech. Write clear, accurate, specific documentation based on the source code provided. Use markdown formatting. Do not make up features that aren't in the source code.",
    },
    {
      role: "user" as const,
      content: `${prompt}\n\n--- SOURCE CODE ---\n${sourceContent}`,
    },
  ];

  // Use Cerebras (free model) — no BYOK needed
  const result = await chatWithAI(messages, 2000);
  return result.content;
}

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  if (CRON_SECRET && authHeader !== `Bearer ${CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sql = getDb();

  // Check embedding budget
  const overBudget = await isOverBudget(sql);
  if (overBudget) {
    return NextResponse.json({
      message: "Embedding budget exceeded, skipping product docs update",
      processed: 0,
    });
  }

  // Find or create system user for product docs
  // Use the first admin-level user, or user_id = 1 as system user
  let systemUserId: number;
  const adminRows =
    await sql`SELECT id FROM users WHERE plan = 'enterprise' OR id = 1 ORDER BY id ASC LIMIT 1`;
  if (adminRows.length > 0) {
    systemUserId = adminRows[0].id as number;
  } else {
    const firstUser =
      await sql`SELECT id FROM users ORDER BY id ASC LIMIT 1`;
    if (firstUser.length === 0) {
      return NextResponse.json({
        message: "No users exist yet, skipping",
        processed: 0,
      });
    }
    systemUserId = firstUser[0].id as number;
  }

  const sections = buildSections();
  let processed = 0;
  let errors = 0;
  const details: string[] = [];

  for (const section of sections) {
    try {
      // 1. Read source content
      const sourceContent = await section.getSource();
      if (!sourceContent || sourceContent.trim().length < 50) {
        details.push(`${section.key}: skipped (no source content)`);
        continue;
      }

      // 2. Summarize with free AI (Cerebras)
      const docContent = await summarizeWithAI(
        sourceContent,
        section.prompt,
      );
      if (!docContent || docContent.trim().length < 50) {
        details.push(`${section.key}: skipped (AI returned empty)`);
        continue;
      }

      const fullTitle = `${SYSTEM_DOC_TITLE_PREFIX} ${section.title}`;

      // 3. Check if this document already exists
      const existing = await sql`
        SELECT id FROM kb_documents
        WHERE user_id = ${systemUserId} AND title = ${fullTitle}
        LIMIT 1
      `;

      let docId: number;

      if (existing.length > 0) {
        docId = existing[0].id as number;
        // Delete old chunks
        await sql`DELETE FROM kb_chunks WHERE document_id = ${docId}`;
        await sql`UPDATE kb_documents SET status = 'processing', updated_at = NOW() WHERE id = ${docId}`;
      } else {
        // Create new document
        const newDoc = await sql`
          INSERT INTO kb_documents (user_id, scope, title, doc_type, status, source_url)
          VALUES (${systemUserId}, 'personal', ${fullTitle}, 'text', 'processing', 'system:product-docs-rag')
          RETURNING id
        `;
        docId = newDoc[0].id as number;
      }

      // 4. Chunk the generated documentation
      const chunks = chunkText(docContent);
      if (chunks.length === 0) {
        await sql`UPDATE kb_documents SET status = 'ready', chunk_count = 0 WHERE id = ${docId}`;
        details.push(`${section.key}: no chunks generated`);
        continue;
      }

      // 5. Generate embeddings and store chunks
      // Use system Google key directly for embeddings (free tier)
      const embeddingKeys: { google?: string; openai?: string } = {};
      if (GOOGLE_AI_API) {
        embeddingKeys.google = GOOGLE_AI_API;
      } else {
        // Try loading keys from the system user
        const keyRows = await sql`
          SELECT service, api_key FROM user_api_keys
          WHERE user_id = ${systemUserId} AND service IN ('google', 'openai')
        `;
        const { decrypt } = await import("@/lib/crypto");
        for (const row of keyRows) {
          try {
            const key = decrypt(row.api_key as string);
            if (row.service === "google") embeddingKeys.google = key;
            else if (row.service === "openai") embeddingKeys.openai = key;
          } catch {
            // skip
          }
        }
      }

      const BATCH_SIZE = 20;
      for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
        const batch = chunks.slice(i, i + BATCH_SIZE);
        const embeddings = await generateEmbeddings(
          batch,
          embeddingKeys,
          sql,
          "enterprise",
        );
        for (let j = 0; j < batch.length; j++) {
          const chunkIndex = i + j;
          const embeddingStr = `[${embeddings[j].join(",")}]`;
          const tokenCount = estimateTokens(batch[j]);
          await sql`
            INSERT INTO kb_chunks (document_id, chunk_index, content, embedding, token_count)
            VALUES (${docId}, ${chunkIndex}, ${batch[j]}, ${embeddingStr}::vector, ${tokenCount})
          `;
        }
      }

      // 6. Update document status
      const textSize = Buffer.byteLength(docContent, "utf-8");
      await sql`
        UPDATE kb_documents
        SET status = 'ready', chunk_count = ${chunks.length}, file_size = ${textSize}, updated_at = NOW()
        WHERE id = ${docId}
      `;

      processed++;
      details.push(
        `${section.key}: ${chunks.length} chunks, ${textSize} bytes`,
      );
    } catch (e) {
      errors++;
      const errMsg = e instanceof Error ? e.message : "Unknown error";
      details.push(`${section.key}: ERROR - ${errMsg}`);
    }
  }

  return NextResponse.json({
    message: `Product docs RAG: ${processed} sections updated, ${errors} errors`,
    processed,
    errors,
    total: sections.length,
    details,
  });
}
