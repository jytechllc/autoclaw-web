import { NextRequest, NextResponse } from "next/server";
import { auth0 } from "@/lib/auth0";
import { getDb } from "@/lib/db";
import { chatWithAI, type ByokKeys } from "@/lib/ai";
import { decrypt } from "@/lib/crypto";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  try {
    const session = await auth0.getSession();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const sql = getDb();
    const email = session.user.email as string;
    const users = await sql`SELECT id FROM users WHERE email = ${email}`;
    if (users.length === 0) return NextResponse.json({ error: "User not found" }, { status: 404 });
    const userId = users[0].id as number;

    // Get all user IDs visible to this user (self + org members)
    const orgUserIds = await sql`
      SELECT DISTINCT om2.user_id FROM organization_members om1
      JOIN organization_members om2 ON om2.org_id = om1.org_id
      WHERE om1.user_id = ${userId}
    `;
    const visibleUserIds = [userId, ...orgUserIds.map((r) => r.user_id as number).filter((id) => id !== userId)];

    const url = new URL(req.url);
    const search = url.searchParams.get("search") || "";
    const language = url.searchParams.get("language") || "";
    const category = url.searchParams.get("category") || "";
    const projectId = url.searchParams.get("project_id") || "";

    const templates = await sql`
      SELECT et.*, p.name as project_name, u.name as owner_name, u.email as owner_email
      FROM email_templates et
      LEFT JOIN projects p ON p.id = et.project_id
      LEFT JOIN users u ON u.id = et.user_id
      WHERE et.user_id = ANY(${visibleUserIds}::int[])
        ${search ? sql`AND (et.name ILIKE ${"%" + search + "%"} OR et.subject ILIKE ${"%" + search + "%"})` : sql``}
        ${language ? sql`AND et.language = ${language}` : sql``}
        ${category ? sql`AND et.category = ${category}` : sql``}
        ${projectId ? sql`AND et.project_id = ${Number(projectId)}` : sql``}
      ORDER BY et.updated_at DESC
    `;

    return NextResponse.json({ templates, total: templates.length });
  } catch (err) {
    console.error("[GET /api/email-templates]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

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
    const { action } = body;

    if (action === "create" || action === "duplicate") {
      const { name, subject, body_html, language, category, project_id, tags, is_ai_generated } = body;
      if (!name || !subject || !body_html) {
        return NextResponse.json({ error: "name, subject, and body_html are required" }, { status: 400 });
      }
      const rows = await sql`
        INSERT INTO email_templates (user_id, project_id, name, subject, body_html, language, category, tags, is_ai_generated)
        VALUES (${userId}, ${project_id || null}, ${name}, ${subject}, ${body_html}, ${language || "en"}, ${category || "custom"}, ${tags || []}, ${is_ai_generated || false})
        RETURNING id
      `;
      return NextResponse.json({ success: true, id: rows[0].id });
    }

    if (action === "update") {
      const { id, name, subject, body_html, language, category, project_id, tags } = body;
      if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });
      await sql`
        UPDATE email_templates SET
          name = COALESCE(${name || null}, name),
          subject = COALESCE(${subject || null}, subject),
          body_html = COALESCE(${body_html || null}, body_html),
          language = COALESCE(${language || null}, language),
          category = COALESCE(${category || null}, category),
          project_id = ${project_id === undefined ? sql`project_id` : project_id || null},
          tags = COALESCE(${tags || null}, tags),
          updated_at = NOW()
        WHERE id = ${id} AND user_id = ${userId}
      `;
      return NextResponse.json({ success: true });
    }

    if (action === "delete") {
      const { id } = body;
      if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });
      await sql`DELETE FROM email_templates WHERE id = ${id} AND user_id = ${userId}`;
      return NextResponse.json({ success: true });
    }

    // AI Generate: create 3 templates with AI based on project/business context
    // When language != 'en', also auto-generate English versions (essential for foreign trade)
    if (action === "ai_generate") {
      const { project_id, language, business_description } = body;
      const lang = language || "en";
      const langInstruction: Record<string, string> = {
        en: "", zh: "Please respond entirely in Simplified Chinese (简体中文).",
        "zh-TW": "Please respond entirely in Traditional Chinese (繁體中文).",
        fr: "Please respond entirely in French (Français).",
      };

      // Load project context if provided
      let projectContext = "";
      if (project_id) {
        const proj = await sql`SELECT name, website, description FROM projects WHERE id = ${project_id} AND user_id = ${userId}`;
        if (proj.length > 0) {
          projectContext = `\nProject: ${proj[0].name}\nWebsite: ${proj[0].website || "N/A"}\nDescription: ${proj[0].description || "N/A"}`;
        }
      }

      // Resolve BYOK keys
      const byok: ByokKeys = {};
      try {
        const byokRows = await sql`
          SELECT service, api_key FROM user_api_keys
          WHERE user_id = ${userId} AND service IN ('openai', 'anthropic', 'google', 'alibaba', 'cerebras')
        `;
        for (const row of byokRows) {
          try { byok[row.service as keyof ByokKeys] = decrypt(row.api_key as string); } catch { /* skip */ }
        }
      } catch { /* continue without BYOK */ }

      // Helper: generate + parse + save templates for a given language
      async function generateForLang(targetLang: string): Promise<number[]> {
        const prompt = `You are an expert email copywriter. Create 3 email templates for this business:
${projectContext}
${business_description ? `\nAdditional context: ${business_description}` : ""}

Create these 4 templates:
1. Cold outreach email (first touch to a prospect)
2. Follow-up email (sent 3-5 days after no reply)
3. Newsletter welcome email (for new subscribers)
4. Meeting/calendar invite email (invite prospect to book a call or demo, centered around {{calendarLink}})

For EACH template, output in this exact format:
---TEMPLATE---
NAME: [template name]
CATEGORY: [cold_outreach|follow_up|newsletter|custom]
SUBJECT: [subject line]
BODY:
[email body using merge tags]
---END---

Available merge tags: {{firstName}}, {{lastName}}, {{company}}, {{calendarLink}} (booking/meeting link).
Rules:
- Template 1 (cold outreach): End with a soft CTA mentioning {{calendarLink}} to book a quick intro call.
- Template 2 (follow-up): Reference the previous email and offer {{calendarLink}} as an easy way to connect.
- Template 3 (newsletter): Welcome new subscribers, no calendar link needed.
- Template 4 (meeting invite): The primary CTA is {{calendarLink}}. Make it a clear, compelling invitation to schedule a meeting/demo. Use category "custom".
Keep each email under 150 words. Be professional but personable.
${langInstruction[targetLang] || ""}`;

        const aiResp = await chatWithAI([{ role: "user", content: prompt }], 3000, byok);
        const blocks = aiResp.content.split("---TEMPLATE---").filter((b: string) => b.includes("---END---"));
        const ids: number[] = [];
        for (const block of blocks) {
          const nameMatch = block.match(/NAME:\s*(.+)/i);
          const catMatch = block.match(/CATEGORY:\s*(.+)/i);
          const subjectMatch = block.match(/SUBJECT:\s*(.+)/i);
          const bodyMatch = block.match(/BODY:\s*([\s\S]+?)---END---/i);
          if (!nameMatch || !subjectMatch || !bodyMatch) continue;
          const rows = await sql`
            INSERT INTO email_templates (user_id, project_id, name, subject, body_html, language, category, is_ai_generated)
            VALUES (${userId}, ${project_id || null}, ${nameMatch[1].trim()}, ${subjectMatch[1].trim()}, ${bodyMatch[1].trim().replace(/\n/g, "<br>")}, ${targetLang}, ${(catMatch?.[1]?.trim() || "custom").toLowerCase()}, true)
            RETURNING id
          `;
          ids.push(rows[0].id as number);
        }
        return ids;
      }

      // Always generate in the selected language
      const savedIds = await generateForLang(lang);

      // If selected language is NOT English, also generate English versions
      let enIds: number[] = [];
      if (lang !== "en") {
        try {
          enIds = await generateForLang("en");
        } catch { /* non-critical — primary language templates already saved */ }
      }

      const allIds = [...savedIds, ...enIds];
      return NextResponse.json({ success: true, count: allIds.length, ids: allIds });
    }

    // AI Translate: create a new template in target language based on an existing template
    if (action === "ai_translate") {
      const { id, target_language } = body;
      if (!id || !target_language) return NextResponse.json({ error: "id and target_language are required" }, { status: 400 });

      const src = await sql`SELECT * FROM email_templates WHERE id = ${id} AND user_id = ${userId}`;
      if (src.length === 0) return NextResponse.json({ error: "Template not found" }, { status: 404 });
      const tpl = src[0];

      const langNames: Record<string, string> = {
        en: "English", zh: "Simplified Chinese (简体中文)", "zh-TW": "Traditional Chinese (繁體中文)",
        fr: "French (Français)", ja: "Japanese (日本語)", ko: "Korean (한국어)",
        de: "German (Deutsch)", es: "Spanish (Español)", pt: "Portuguese (Português)",
        it: "Italian (Italiano)", ru: "Russian (Русский)", ar: "Arabic (العربية)",
        vi: "Vietnamese (Tiếng Việt)", th: "Thai (ไทย)", id: "Indonesian (Bahasa Indonesia)",
      };
      const targetName = langNames[target_language] || target_language;

      const prompt = `You are a professional email translator and localizer. Translate the following email template into ${targetName}.

Important rules:
- Preserve ALL merge tags exactly as-is: {{firstName}}, {{lastName}}, {{company}}, {{email}}, {{calendarLink}}
- Adapt cultural tone and greetings to be natural in the target language (not word-for-word translation)
- Keep the same persuasive structure and call-to-action intent
- Maintain similar length (under 150 words)

Original template (language: ${tpl.language}):
Subject: ${tpl.subject}
Body:
${(tpl.body_html as string).replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, "")}

Respond in this exact format:
NAME: [translated template name]
SUBJECT: [translated subject line]
BODY:
[translated email body]`;

      // Resolve BYOK
      const byok: ByokKeys = {};
      try {
        const byokRows = await sql`
          SELECT service, api_key FROM user_api_keys
          WHERE user_id = ${userId} AND service IN ('openai', 'anthropic', 'google', 'alibaba', 'cerebras')
        `;
        for (const row of byokRows) {
          try { byok[row.service as keyof ByokKeys] = decrypt(row.api_key as string); } catch { /* skip */ }
        }
      } catch { /* continue */ }

      const aiResp = await chatWithAI([{ role: "user", content: prompt }], 2000, byok);

      const nameMatch = aiResp.content.match(/NAME:\s*(.+)/i);
      const subjectMatch = aiResp.content.match(/SUBJECT:\s*(.+)/i);
      const bodyMatch = aiResp.content.match(/BODY:\s*([\s\S]+?)$/i);

      if (!subjectMatch || !bodyMatch) {
        return NextResponse.json({ success: false, error: "AI returned invalid format", raw: aiResp.content });
      }

      const newName = nameMatch?.[1]?.trim() || `${tpl.name} (${target_language.toUpperCase()})`;
      const rows = await sql`
        INSERT INTO email_templates (user_id, project_id, name, subject, body_html, language, category, is_ai_generated)
        VALUES (${userId}, ${tpl.project_id}, ${newName}, ${subjectMatch[1].trim()}, ${bodyMatch[1].trim().replace(/\n/g, "<br>")}, ${target_language}, ${tpl.category}, true)
        RETURNING id
      `;
      return NextResponse.json({ success: true, id: rows[0].id, model: aiResp.model });
    }

    // AI Recommend: pick the best template for a specific contact
    if (action === "ai_recommend") {
      const { contact, template_ids } = body;
      if (!contact || !template_ids?.length) {
        return NextResponse.json({ error: "contact and template_ids are required" }, { status: 400 });
      }

      // Load templates
      const templates = await sql`
        SELECT id, name, subject, body_html, language, category FROM email_templates
        WHERE id = ANY(${template_ids}::int[]) AND user_id = ${userId}
      `;
      if (templates.length === 0) return NextResponse.json({ error: "No templates found" }, { status: 404 });

      const templateList = templates.map((t, i) =>
        `[${i + 1}] ID:${t.id} | Lang:${t.language} | Category:${t.category} | Name:${t.name} | Subject:${t.subject} | Body preview:${(t.body_html as string).replace(/<[^>]+>/g, "").substring(0, 100)}`
      ).join("\n");

      const prompt = `You are an email marketing expert. Pick the BEST template for this contact.

Contact:
- Email: ${contact.email}
- Name: ${contact.first_name || ""} ${contact.last_name || ""}
- Company: ${contact.company || "Unknown"}
- Position: ${contact.position || "Unknown"}
- Engagement: ${contact.emails_sent || 0} sent, ${contact.emails_opened || 0} opened, ${contact.emails_clicked || 0} clicked

Available templates:
${templateList}

Consider:
1. Contact's likely language (based on email domain and name)
2. Engagement history (never contacted → cold outreach; opened but not replied → follow-up; engaged → newsletter)
3. Role/position relevance to template content

Reply with ONLY a JSON object (no markdown): {"template_id": <number>, "reason": "<brief reason>"}`;

      // Resolve BYOK keys
      const byok: ByokKeys = {};
      try {
        const byokRows = await sql`
          SELECT service, api_key FROM user_api_keys
          WHERE user_id = ${userId} AND service IN ('openai', 'anthropic', 'google', 'alibaba', 'cerebras')
        `;
        for (const row of byokRows) {
          try { byok[row.service as keyof ByokKeys] = decrypt(row.api_key as string); } catch { /* skip */ }
        }
      } catch { /* continue */ }

      const aiResp = await chatWithAI(
        [{ role: "user", content: prompt }],
        200,
        byok,
      );

      // Parse AI response
      try {
        const jsonStr = aiResp.content.replace(/```json?\s*/g, "").replace(/```/g, "").trim();
        const result = JSON.parse(jsonStr);
        return NextResponse.json({ success: true, ...result, model: aiResp.model });
      } catch {
        return NextResponse.json({ success: false, error: "AI returned invalid format", raw: aiResp.content });
      }
    }

    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  } catch (err) {
    console.error("[POST /api/email-templates]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
