import { NextRequest, NextResponse } from "next/server";
import { auth0 } from "@/lib/auth0";
import { getDb } from "@/lib/db";
import { decrypt } from "@/lib/crypto";
import { getUserKey } from "@/lib/keys";
import { TwitterApi } from "twitter-api-v2";
import { searchKnowledgeBase, buildRagContext } from "@/lib/rag";

export const dynamic = "force-dynamic";

interface XCredentials {
  apiKey: string;
  apiSecret: string;
  accessToken: string;
  accessTokenSecret: string;
}

interface ChatMessage {
  role: "system" | "user";
  content: string;
}

interface PipelineStep {
  key: string;
  status: "pending" | "running" | "completed" | "skipped" | "error";
  detail?: string;
  startedAt?: string;
  completedAt?: string;
}

async function getUserXCredentials(userId: number): Promise<XCredentials | null> {
  const sql = getDb();
  const keys = await sql`
    SELECT service, api_key FROM user_api_keys
    WHERE user_id = ${userId} AND service IN ('twitter_api_key', 'twitter_api_secret', 'twitter_access_token', 'twitter_access_token_secret')
  `;
  const keyMap: Record<string, string> = {};
  for (const k of keys) {
    try { keyMap[k.service as string] = decrypt(k.api_key as string); } catch { /* skip */ }
  }
  if (keyMap.twitter_api_key && keyMap.twitter_api_secret && keyMap.twitter_access_token && keyMap.twitter_access_token_secret) {
    return {
      apiKey: keyMap.twitter_api_key,
      apiSecret: keyMap.twitter_api_secret,
      accessToken: keyMap.twitter_access_token,
      accessTokenSecret: keyMap.twitter_access_token_secret,
    };
  }

  // Fallback to org-level keys
  const orgKeys = await sql`
    SELECT oak.service, oak.api_key FROM org_api_keys oak
    JOIN organization_members om ON om.org_id = oak.org_id
    WHERE om.user_id = ${userId}
      AND oak.service IN ('twitter_api_key', 'twitter_api_secret', 'twitter_access_token', 'twitter_access_token_secret')
    LIMIT 4
  `;
  for (const k of orgKeys) {
    try { keyMap[k.service as string] = decrypt(k.api_key as string); } catch { /* skip */ }
  }
  if (!keyMap.twitter_api_key || !keyMap.twitter_api_secret || !keyMap.twitter_access_token || !keyMap.twitter_access_token_secret) {
    return null;
  }
  return {
    apiKey: keyMap.twitter_api_key,
    apiSecret: keyMap.twitter_api_secret,
    accessToken: keyMap.twitter_access_token,
    accessTokenSecret: keyMap.twitter_access_token_secret,
  };
}

// Unified AI call helper — tries Cerebras → OpenAI → Anthropic
async function callAI(
  messages: ChatMessage[],
  keys: { cerebras?: string | null; openai?: string | null; anthropic?: string | null },
): Promise<string> {
  const systemMsg = messages.find((m) => m.role === "system")?.content || "";
  const userMsg = messages.find((m) => m.role === "user")?.content || "";

  if (keys.cerebras) {
    const res = await fetch("https://api.cerebras.ai/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${keys.cerebras}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "qwen-3-235b-a22b-instruct-2507",
        messages: [
          { role: "system", content: systemMsg + "\nIMPORTANT: Return ONLY valid JSON, no other text." },
          { role: "user", content: userMsg },
        ],
        temperature: 0.7,
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(`Cerebras error ${res.status}: ${JSON.stringify(data)}`);
    return data.choices[0].message.content;
  }

  if (keys.openai) {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${keys.openai}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: systemMsg },
          { role: "user", content: userMsg },
        ],
        temperature: 0.7,
        response_format: { type: "json_object" },
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(`OpenAI error ${res.status}: ${JSON.stringify(data)}`);
    return data.choices[0].message.content;
  }

  if (keys.anthropic) {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": keys.anthropic,
        "Content-Type": "application/json",
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 1024,
        system: systemMsg + "\nIMPORTANT: Return ONLY valid JSON, no other text.",
        messages: [{ role: "user", content: userMsg }],
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(`Anthropic error ${res.status}: ${JSON.stringify(data)}`);
    return data.content[0].text;
  }

  throw new Error("No AI provider available");
}

function formatTweet(t: { text: string; createdAt?: string; metrics?: Record<string, number> }, i: number): string {
  const m = t.metrics || {};
  const engagement = (m.like_count || 0) + (m.retweet_count || 0) + (m.reply_count || 0);
  const impressions = m.impression_count || 0;
  const rate = impressions > 0 ? ((engagement / impressions) * 100).toFixed(2) : "N/A";
  return `Tweet ${i + 1} (${t.createdAt || "unknown date"}):\n  "${t.text}"\n  Impressions: ${impressions} | Likes: ${m.like_count || 0} | Retweets: ${m.retweet_count || 0} | Replies: ${m.reply_count || 0} | Engagement Rate: ${rate}%`;
}

async function ensureAnalysisRunsTable() {
  const sql = getDb();
  await sql`
    CREATE TABLE IF NOT EXISTS x_analysis_runs (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      topic VARCHAR(500),
      industry_keyword VARCHAR(500),
      content_locale VARCHAR(10) DEFAULT 'en',
      steps JSONB DEFAULT '[]'::jsonb,
      result JSONB,
      status VARCHAR(50) DEFAULT 'running',
      error TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `;
}

/** Keep only the latest 10 runs per user */
async function pruneOldRuns(userId: number) {
  const sql = getDb();
  await sql`
    DELETE FROM x_analysis_runs
    WHERE user_id = ${userId}
    AND id NOT IN (
      SELECT id FROM x_analysis_runs WHERE user_id = ${userId} ORDER BY created_at DESC LIMIT 10
    )
  `;
}

const CONTENT_LOCALES: Record<string, string> = {
  zh: "Chinese (Simplified / 简体中文)",
  "zh-TW": "Chinese (Traditional / 繁體中文)",
  fr: "French (Français)",
  ja: "Japanese (日本語)",
  ko: "Korean (한국어)",
  es: "Spanish (Español)",
  de: "German (Deutsch)",
};

// GET: Fetch analysis run history
export async function GET() {
  const session = await auth0.getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const sql = getDb();
  const users = await sql`SELECT id FROM users WHERE auth0_id = ${session.user.sub} LIMIT 1`;
  if (users.length === 0) return NextResponse.json({ error: "User not found" }, { status: 404 });

  await ensureAnalysisRunsTable();

  const runs = await sql`
    SELECT id, topic, industry_keyword, content_locale, steps, result, status, error, created_at
    FROM x_analysis_runs
    WHERE user_id = ${users[0].id}
    ORDER BY created_at DESC
    LIMIT 10
  `;

  return NextResponse.json({ runs });
}

// POST: Run analysis pipeline
export async function POST(req: NextRequest) {
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
  const creds = await getUserXCredentials(userId);
  if (!creds) {
    return NextResponse.json({ error: "X API keys not configured" }, { status: 400 });
  }

  const body = await req.json();
  const { topic, industryKeyword, generateImage, locale, contentLocale } = body;

  // locale = UI language → analysis labels (bestPerforming, patterns, strategy, trends, gapAnalysis, opportunities)
  // contentLocale = target language for generated tweet content (default: "en")
  const targetLocale = contentLocale || "en";
  const uiLocale = locale || "en";

  // Build language instructions
  const uiLangLabel = CONTENT_LOCALES[uiLocale] || "English";
  const contentLangLabel = CONTENT_LOCALES[targetLocale] || "English";

  let langInstruction: string;
  if (uiLocale === targetLocale) {
    // Same language for everything
    langInstruction = uiLocale === "en"
      ? ""
      : `\n\nIMPORTANT: You MUST write the ENTIRE response in ${uiLangLabel} — all analysis text, strategy, patterns, variant tweets, and every other text field. Only keep JSON keys in English.`;
  } else {
    // Different languages: analysis in UI language, tweets in content language
    langInstruction = `\n\nIMPORTANT LANGUAGE RULES:`
      + `\n- All analysis text MUST be in ${uiLangLabel}: bestPerforming, patterns, bestTime, engagementRate, strategy, topTrends, gapAnalysis, opportunities, tone descriptions, estimatedCost breakdown.`
      + `\n- The "text" field in each variant (the actual tweet content) MUST be in ${contentLangLabel}.`
      + `\n- Only JSON keys stay in English.`;
  }

  await ensureAnalysisRunsTable();

  // Initialize pipeline steps
  const PIPELINE_STEPS: PipelineStep[] = [
    { key: "fetch_tweets", status: "pending" },
    { key: "detect_industry", status: "pending" },
    { key: "search_industry", status: "pending" },
    { key: "search_kb", status: "pending" },
    { key: "ai_analysis", status: "pending" },
    { key: "generate_images", status: "pending" },
  ];

  function stepStart(key: string) {
    const step = PIPELINE_STEPS.find((s) => s.key === key);
    if (step) { step.status = "running"; step.startedAt = new Date().toISOString(); }
  }
  function stepDone(key: string, detail?: string) {
    const step = PIPELINE_STEPS.find((s) => s.key === key);
    if (step) { step.status = "completed"; step.detail = detail; step.completedAt = new Date().toISOString(); }
  }
  function stepSkip(key: string, detail?: string) {
    const step = PIPELINE_STEPS.find((s) => s.key === key);
    if (step) { step.status = "skipped"; step.detail = detail; }
  }
  function stepError(key: string, detail?: string) {
    const step = PIPELINE_STEPS.find((s) => s.key === key);
    if (step) { step.status = "error"; step.detail = detail; step.completedAt = new Date().toISOString(); }
  }

  // Create DB run record
  const runRows = await sql`
    INSERT INTO x_analysis_runs (user_id, topic, industry_keyword, content_locale, steps, status)
    VALUES (${userId}, ${topic || null}, ${industryKeyword || null}, ${targetLocale}, ${JSON.stringify(PIPELINE_STEPS)}, 'running')
    RETURNING id
  `;
  const runId = runRows[0].id;

  async function updateRun(fields: { steps?: PipelineStep[]; result?: unknown; status?: string; error?: string }) {
    if (fields.steps) await sql`UPDATE x_analysis_runs SET steps = ${JSON.stringify(fields.steps)} WHERE id = ${runId}`;
    if (fields.result) await sql`UPDATE x_analysis_runs SET result = ${JSON.stringify(fields.result)}, status = 'completed' WHERE id = ${runId}`;
    if (fields.error) await sql`UPDATE x_analysis_runs SET error = ${fields.error}, status = 'error', steps = ${JSON.stringify(PIPELINE_STEPS)} WHERE id = ${runId}`;
    if (fields.status && !fields.result && !fields.error) await sql`UPDATE x_analysis_runs SET status = ${fields.status}, steps = ${JSON.stringify(PIPELINE_STEPS)} WHERE id = ${runId}`;
  }

  const client = new TwitterApi({
    appKey: creds.apiKey,
    appSecret: creds.apiSecret,
    accessToken: creds.accessToken,
    accessSecret: creds.accessTokenSecret,
  });

  // ─── Step 1: Fetch recent tweets (v2 → v1 fallback) ───
  stepStart("fetch_tweets");
  let recentTweets: { text: string; createdAt?: string; metrics?: Record<string, number> }[];
  try {
    // Try v2 first (Basic+ tier)
    let fetched = false;
    try {
      const me = await client.v2.me();
      const timeline = await client.v2.userTimeline(me.data.id, {
        max_results: 5,
        "tweet.fields": ["created_at", "public_metrics"],
      });
      recentTweets = (timeline.data.data || []).map((t) => ({
        text: t.text,
        createdAt: t.created_at,
        metrics: t.public_metrics as Record<string, number> | undefined,
      }));
      fetched = true;
    } catch {
      // v2 failed — try v1
      recentTweets = [];
    }

    if (!fetched) {
      try {
        const v1Me = await client.v1.verifyCredentials();
        const v1Timeline = await client.v1.userTimeline(v1Me.id_str, { count: 5, exclude_replies: true, include_rts: false });
        recentTweets = v1Timeline.tweets.map((t) => ({
          text: t.full_text || t.text,
          createdAt: t.created_at,
          metrics: {
            like_count: t.favorite_count || 0,
            retweet_count: t.retweet_count || 0,
          },
        }));
      } catch {
        // v1 also unavailable — continue with empty (AI will generate without context)
        recentTweets = [];
      }
    }

    if (recentTweets.length === 0) {
      // No tweets available — skip analysis, proceed to generation
      stepDone("fetch_tweets", "No tweets available (Free tier or new account)");
    } else {
      stepDone("fetch_tweets", `${recentTweets.length} tweets`);
    }
  } catch (err) {
    console.error("Failed to fetch recent tweets:", err);
    stepError("fetch_tweets", String(err));
    await updateRun({ error: "Failed to fetch recent tweets", steps: PIPELINE_STEPS });
    return NextResponse.json({ error: "Failed to fetch recent tweets", runId, steps: PIPELINE_STEPS }, { status: 502 });
  }
  await updateRun({ steps: PIPELINE_STEPS });

  // Get AI keys
  const cerebrasKey = await getUserKey(userId, "cerebras");
  const openaiKey = await getUserKey(userId, "openai");
  const anthropicKey = await getUserKey(userId, "anthropic");
  const platformCerebrasKey = process.env.CEREBRAS_API_KEY;
  const aiKeys = {
    cerebras: cerebrasKey || platformCerebrasKey,
    openai: openaiKey,
    anthropic: anthropicKey,
  };
  if (!aiKeys.cerebras && !aiKeys.openai && !aiKeys.anthropic) {
    stepError("detect_industry", "No AI key");
    await updateRun({ error: "An AI API key is required (Cerebras, OpenAI, or Anthropic). Add one in Settings." });
    return NextResponse.json({ error: "An AI API key is required", runId, steps: PIPELINE_STEPS }, { status: 400 });
  }

  // ─── Step 2: Detect industry ───
  let detectedIndustry = "";
  let searchKeywords: string[] = [];

  if (!industryKeyword) {
    stepStart("detect_industry");
    try {
      const tweetsForDetection = recentTweets.map((t) => t.text).join("\n---\n");
      const detectResponse = await callAI(
        [
          {
            role: "system",
            content: `You analyze social media posts to identify the author's industry, niche, and key topics. Return JSON only:
{
  "industry": "The primary industry/niche (e.g. AI/Tech, Legal Services, E-commerce, Health & Wellness)",
  "keywords": ["keyword1", "keyword2", "keyword3"],
  "searchQueries": ["search query 1", "search query 2"]
}
- "keywords": 3 most relevant topic keywords extracted from the posts
- "searchQueries": 2 Twitter search queries that would find the most popular/trending content in this industry. Make them specific and likely to return high-engagement posts. Do NOT include operators like "min_faves". Just use natural topic phrases.
- IMPORTANT: "searchQueries" must always be in English (for Twitter search API).${uiLocale !== "en" ? ` But "industry" and "keywords" should be written in ${uiLangLabel}.` : ""}`,
          },
          {
            role: "user",
            content: `Identify the industry and generate search keywords from these posts:\n\n${tweetsForDetection}${topic ? `\n\nAdditional context — the user is interested in: ${topic}` : ""}`,
          },
        ],
        aiKeys,
      );
      const detected = JSON.parse(detectResponse);
      detectedIndustry = detected.industry || "";
      searchKeywords = detected.searchQueries || detected.keywords || [];
      stepDone("detect_industry", detectedIndustry);
    } catch (err) {
      console.error("Industry detection failed (non-fatal):", err);
      stepError("detect_industry", String(err));
    }
  } else {
    searchKeywords = [industryKeyword];
    stepSkip("detect_industry", `Manual: ${industryKeyword}`);
  }
  await updateRun({ steps: PIPELINE_STEPS });

  // ─── Step 3: Search industry posts ───
  stepStart("search_industry");
  let industryTweets: { text: string; createdAt?: string; metrics?: Record<string, number>; authorUsername?: string }[] = [];
  const allQueries = industryKeyword ? [industryKeyword] : [...searchKeywords, ...(topic ? [topic] : [])];

  for (const searchQuery of allQueries.slice(0, 3)) {
    if (!searchQuery) continue;
    try {
      const searchResult = await client.v2.search(searchQuery, {
        max_results: 10,
        "tweet.fields": ["created_at", "public_metrics", "author_id"],
        expansions: ["author_id"],
        "user.fields": ["username"],
        sort_order: "relevancy",
      });
      const authorMap = new Map<string, string>();
      if (searchResult.includes?.users) {
        for (const u of searchResult.includes.users) {
          authorMap.set(u.id, u.username);
        }
      }
      const results = (searchResult.data.data || []).map((t) => ({
        text: t.text,
        createdAt: t.created_at,
        metrics: t.public_metrics as Record<string, number> | undefined,
        authorUsername: t.author_id ? authorMap.get(t.author_id) : undefined,
      }));
      industryTweets.push(...results);
    } catch (err) {
      console.error(`Industry search failed for "${searchQuery}" (non-fatal):`, err);
    }
  }

  // Deduplicate by text and sort by engagement, take top 5
  const seenTexts = new Set<string>();
  industryTweets = industryTweets
    .filter((t) => {
      if (seenTexts.has(t.text)) return false;
      seenTexts.add(t.text);
      return true;
    })
    .sort((a, b) => {
      const engA = (a.metrics?.like_count || 0) + (a.metrics?.retweet_count || 0) + (a.metrics?.reply_count || 0);
      const engB = (b.metrics?.like_count || 0) + (b.metrics?.retweet_count || 0) + (b.metrics?.reply_count || 0);
      return engB - engA;
    })
    .slice(0, 5);

  if (industryTweets.length > 0) {
    stepDone("search_industry", `${industryTweets.length} posts`);
  } else {
    stepSkip("search_industry", "No results");
  }
  await updateRun({ steps: PIPELINE_STEPS });

  // ─── Step 4: Search knowledge base ───
  const ragSearchQuery = topic || industryKeyword || detectedIndustry || searchKeywords[0];
  let ragContext = "";
  if (ragSearchQuery) {
    stepStart("search_kb");
    try {
      const googleKey = await getUserKey(userId, "google");
      const ragResults = await searchKnowledgeBase(sql, ragSearchQuery, {
        userId,
        topK: 3,
        byokKeys: { google: googleKey || undefined, openai: openaiKey || undefined },
      });
      ragContext = buildRagContext(ragResults, 2000);
      if (ragContext) {
        stepDone("search_kb", `${ragResults.length} chunks`);
      } else {
        stepSkip("search_kb", "No relevant docs");
      }
    } catch (err) {
      console.error("Knowledge base search failed (non-fatal):", err);
      stepError("search_kb", String(err));
    }
  } else {
    stepSkip("search_kb", "No query");
  }
  await updateRun({ steps: PIPELINE_STEPS });

  // ─── Step 5: AI analysis & strategy generation ───
  stepStart("ai_analysis");
  const myTweetsContext = recentTweets.map((t, i) => formatTweet(t, i)).join("\n\n");

  let industryContext = "";
  if (industryTweets.length > 0) {
    industryContext = "\n\n--- TOP INDUSTRY POSTS (sorted by engagement) ---\n\n" +
      industryTweets.map((t, i) => {
        const m = t.metrics || {};
        const engagement = (m.like_count || 0) + (m.retweet_count || 0) + (m.reply_count || 0);
        return `Industry Post ${i + 1}${t.authorUsername ? ` (@${t.authorUsername})` : ""} (${t.createdAt || "unknown date"}):\n  "${t.text}"\n  Likes: ${m.like_count || 0} | Retweets: ${m.retweet_count || 0} | Replies: ${m.reply_count || 0} | Total Engagement: ${engagement}`;
      }).join("\n\n");
  }

  let kbContext = "";
  if (ragContext) {
    kbContext = `\n\n--- BRAND KNOWLEDGE BASE ---\n${ragContext}`;
  }

  const hasIndustryData = industryTweets.length > 0;
  const hasKbData = ragContext.length > 0;

  const industryLabel = detectedIndustry ? ` The user's detected industry/niche is: ${detectedIndustry}.` : "";
  const systemPrompt = `You are a social media strategist analyzing X/Twitter post performance.${industryLabel} ${hasIndustryData ? "You have access to both the user's recent posts AND top-performing industry posts for comparison. Analyze what makes the industry posts successful and how the user can learn from them." : "Analyze the recent posts."} Identify what works best (tone, format, topics, hashtags, timing patterns), and generate a new sample post that follows the winning strategy.${hasKbData ? " Use the brand knowledge base context to ensure the generated post aligns with the brand's voice, products, and messaging." : ""}

Return your response as JSON with this exact structure:
{
  "analysis": {
    "bestPerforming": "Brief description of the best performing post and why",
    "patterns": ["pattern 1", "pattern 2", "pattern 3"],
    "bestTime": "Best posting time based on data (or 'insufficient data')",
    "engagementRate": "Average engagement rate across posts"
  },${hasIndustryData ? `
  "industryInsights": {
    "topTrends": ["trend 1", "trend 2", "trend 3"],
    "gapAnalysis": "What the industry leaders do that you don't — specific actionable gaps",
    "opportunities": "Specific opportunities based on comparing your posts with industry top performers"
  },` : ""}
  "variants": [
    { "label": "A", "text": "First tweet variant (max 280 chars)", "tone": "e.g. professional / casual / bold", "imagePrompt": "A concise image description for this variant", "bestPostTimes": ["9:00 AM", "12:30 PM", "6:00 PM"], "estimatedCost": { "postsPerWeek": 3, "monthlyBudget": "$0/mo (free models)", "breakdown": "3 posts/week × Cerebras (free) + Flux Schnell (free) = $0/mo" } },
    { "label": "B", "text": "Second tweet variant, different angle/tone (max 280 chars)", "tone": "...", "imagePrompt": "...", "bestPostTimes": ["8:00 AM", "1:00 PM"], "estimatedCost": { "postsPerWeek": 5, "monthlyBudget": "$0/mo (free models)", "breakdown": "..." } },
    { "label": "C", "text": "Third tweet variant, most creative/experimental (max 280 chars)", "tone": "...", "imagePrompt": "...", "bestPostTimes": ["10:00 AM", "7:00 PM"], "estimatedCost": { "postsPerWeek": 7, "monthlyBudget": "$1.00-3.00", "breakdown": "..." } }
  ],
  "strategy": "1-2 sentence strategy recommendation"
}

For each variant:
- "bestPostTimes": Array of 2-3 optimal daily posting times in "H:MM AM/PM" format. Base these on the user's post performance data (when posts got most engagement), the variant's target audience, and industry best practices. Each variant may have different optimal times based on its tone and audience.
- "estimatedCost": Object with:
  - "postsPerWeek": recommended posting frequency for this strategy (number)
  - "monthlyBudget": estimated monthly cost range for TOOL USAGE ONLY (string). Costs are: AI analysis ~$0.002/call (free with Cerebras), image generation FREE via Flux Schnell/SDXL or ~$0.02/image via Seedream. Do NOT include advertising or promotion costs — only the actual API/tool costs to generate and schedule the posts.
  - "breakdown": brief cost breakdown showing the math (1 sentence)
Be realistic — with free models (Flux Schnell + Cerebras), most strategies cost $0/month in tool costs.${langInstruction}`;

  const userPrompt = `Here are my 5 most recent posts with their performance metrics:\n\n${myTweetsContext}${industryContext}${kbContext}${topic ? `\n\nThe user wants the new post to be about: ${topic}` : ""}\n\nAnalyze ${hasIndustryData ? "both my posts and the industry posts, compare them," : "my posts"} and generate a new optimized sample post.`;

  let parsed: Record<string, unknown>;
  try {
    const aiResponse = await callAI(
      [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      aiKeys,
    );
    parsed = JSON.parse(aiResponse);
    stepDone("ai_analysis");
  } catch (err) {
    console.error("AI analysis error:", err);
    stepError("ai_analysis", String(err));
    await updateRun({ error: "Failed to analyze posts", steps: PIPELINE_STEPS });
    return NextResponse.json({ error: "Failed to analyze posts", runId, steps: PIPELINE_STEPS }, { status: 500 });
  }
  await updateRun({ steps: PIPELINE_STEPS });

  // ─── Step 6: Generate images ───
  if (generateImage && (parsed.variants as unknown[])?.length > 0) {
    stepStart("generate_images");
    const xpilotKey = await getUserKey(userId, "xpilot");
    const openaiKey = await getUserKey(userId, "openai") || process.env.OPENAI_API_KEY || "";

    if (xpilotKey || openaiKey) {
      async function generateImageForVariant(variant: { imagePrompt?: string; generatedImageUrl?: string }) {
        if (!variant.imagePrompt) return;

        // Try xPilot first
        if (xpilotKey) {
          try {
            const imgRes = await fetch("https://xpilot.jytech.us/api/v1/image/generate", {
              method: "POST",
              headers: { Authorization: `Bearer ${xpilotKey}`, "Content-Type": "application/json" },
              body: JSON.stringify({ model: "bytedance/seedream-v4.5", prompt: variant.imagePrompt, aspect_ratio: "16:9" }),
            });
            const imgText = await imgRes.text();
            if (imgText && imgRes.ok) {
              const imgData = JSON.parse(imgText);
              if (imgData.outputs?.[0]) { variant.generatedImageUrl = imgData.outputs[0]; return; }
              if (imgData.poll_url || imgData.task_id) {
                const pollPath = imgData.poll_url || `/api/v1/image/${imgData.task_id}`;
                for (let i = 0; i < 15; i++) {
                  await new Promise((r) => setTimeout(r, 2000));
                  const pollRes = await fetch(`https://xpilot.jytech.us${pollPath}`, { headers: { Authorization: `Bearer ${xpilotKey}` } });
                  const pollText = await pollRes.text();
                  if (!pollText) continue;
                  const pollData = JSON.parse(pollText);
                  if (pollData.status === "completed" && pollData.outputs?.[0]) { variant.generatedImageUrl = pollData.outputs[0]; return; }
                  if (pollData.status === "failed") break;
                }
              }
            }
          } catch { /* xPilot failed, try fallback */ }
        }

        // Fallback: DALL-E 3
        if (openaiKey && !variant.generatedImageUrl) {
          try {
            const dalleRes = await fetch("https://api.openai.com/v1/images/generations", {
              method: "POST",
              headers: { "Content-Type": "application/json", Authorization: `Bearer ${openaiKey}` },
              body: JSON.stringify({ model: "dall-e-3", prompt: variant.imagePrompt, n: 1, size: "1792x1024", quality: "standard" }),
            });
            if (dalleRes.ok) {
              const dalleData = (await dalleRes.json()) as { data?: { url?: string }[] };
              if (dalleData.data?.[0]?.url) { variant.generatedImageUrl = dalleData.data[0].url; return; }
            }
          } catch (err) {
            console.error("DALL-E fallback failed (non-fatal):", err);
          }
        }
      }

      await Promise.all((parsed.variants as { imagePrompt?: string; generatedImageUrl?: string }[]).map((v) => generateImageForVariant(v)));
      const generated = (parsed.variants as { generatedImageUrl?: string }[]).filter((v) => v.generatedImageUrl).length;
      stepDone("generate_images", `${generated} images`);
    } else {
      stepSkip("generate_images", "No xPilot key");
    }
  } else {
    stepSkip("generate_images", generateImage ? "No variants" : "Disabled");
  }

  // Build final result
  const result = {
    ...parsed,
    detectedIndustry: detectedIndustry || undefined,
    searchKeywords: searchKeywords.length > 0 ? searchKeywords : undefined,
    recentTweets: recentTweets.map((t) => ({
      text: t.text,
      metrics: t.metrics,
      createdAt: t.createdAt,
    })),
    industryTweets: industryTweets.length > 0 ? industryTweets.map((t) => ({
      text: t.text,
      metrics: t.metrics,
      createdAt: t.createdAt,
      authorUsername: t.authorUsername,
    })) : undefined,
    usedKnowledgeBase: hasKbData,
    contentLocale: targetLocale,
  };

  // Save result to DB and prune old runs
  await updateRun({ result, steps: PIPELINE_STEPS });
  await pruneOldRuns(userId);

  return NextResponse.json({
    ...result,
    runId,
    steps: PIPELINE_STEPS,
  });
}
