import { NextRequest, NextResponse } from "next/server";
import { auth0 } from "@/lib/auth0";
import { getDb } from "@/lib/db";
import { isReadOnlyUserId } from "@/lib/roles-server";
import { checkRateLimit } from "@/lib/rate-limit";
import { chatWithAI } from "@/lib/ai";
import { extractInternalLinks, sanitizeGeneratedExtensions, extractPageImages, sanitizePmaxCopy } from "../extensions";

export const dynamic = "force-dynamic";

function getIp(req: NextRequest): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}

interface GeneratedAdCopy {
  headlines: string[];
  longHeadline: string;
  descriptions: string[];
  businessName: string;
  keywords?: Array<{ text: string; matchType: "BROAD" | "PHRASE" | "EXACT" }>;
  pageTitle?: string;
}

/** Strip HTML to plain text. Naive but good enough for a single landing page. */
function htmlToText(html: string): string {
  const noScript = html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, " ")
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, " ")
    .replace(/<noscript\b[^<]*(?:(?!<\/noscript>)<[^<]*)*<\/noscript>/gi, " ");
  return noScript
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

/** Pull <title>…</title> for use as a fallback / context hint. */
function extractTitle(html: string): string {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return m ? m[1].replace(/\s+/g, " ").trim() : "";
}

function clipChars(s: string, max: number): string {
  if (s.length <= max) return s;
  // Try not to cut mid-word
  const cut = s.slice(0, max);
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace > max - 8 ? cut.slice(0, lastSpace) : cut).trim();
}

export async function POST(req: NextRequest) {
  const ip = getIp(req);
  // AI calls are expensive — keep tight
  if (!checkRateLimit(ip, { limit: 10, windowMs: 60_000 })) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }
  const session = await auth0.getSession();
  if (!session?.user?.email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Read-only (sandbox/viewer) accounts must not burn LLM tokens.
  {
    const sql = getDb();
    const users = await sql`SELECT id FROM users WHERE email = ${session.user.email as string}`;
    if (users.length === 0) return NextResponse.json({ error: "User not found" }, { status: 404 });
    if (await isReadOnlyUserId(sql, users[0].id as number)) {
      return NextResponse.json({ error: "Read-only account — writes are disabled" }, { status: 403 });
    }
  }

  const body = await req.json().catch(() => ({}));
  const url = String(body.url || "").trim();
  const channel = String(body.channel || "DISPLAY").toUpperCase();
  const locale = String(body.locale || "en").trim();
  // mode "extensions": generate sitelinks + callouts instead of ad copy.
  const mode = String(body.mode || "copy");

  if (!/^https?:\/\//i.test(url)) {
    return NextResponse.json({ error: "url must start with http:// or https://" }, { status: 400 });
  }
  if (mode !== "copy" && mode !== "extensions" && mode !== "pmax") {
    return NextResponse.json({ error: 'mode must be "copy", "extensions", or "pmax"' }, { status: 400 });
  }
  if (mode === "copy" && !["SEARCH", "DISPLAY", "VIDEO"].includes(channel)) {
    return NextResponse.json({ error: "channel must be SEARCH, DISPLAY, or VIDEO" }, { status: 400 });
  }

  // Fetch landing page (10s timeout, ≤2MB)
  let html: string;
  try {
    const ac = new AbortController();
    const timeout = setTimeout(() => ac.abort(), 10_000);
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; AutoClawAdCopyBot/1.0)" },
      redirect: "follow",
      signal: ac.signal,
    });
    clearTimeout(timeout);
    if (!res.ok) {
      return NextResponse.json({ error: `Landing page fetch failed: HTTP ${res.status}` }, { status: 502 });
    }
    const buf = await res.arrayBuffer();
    if (buf.byteLength > 2 * 1024 * 1024) {
      return NextResponse.json({ error: "Landing page too large (>2 MB)" }, { status: 413 });
    }
    html = new TextDecoder("utf-8", { fatal: false }).decode(buf);
  } catch (e) {
    return NextResponse.json({ error: `Failed to fetch landing page: ${e instanceof Error ? e.message : String(e)}` }, { status: 502 });
  }

  const pageTitle = extractTitle(html);
  // Trim text to keep prompt small (fit comfortably under typical 8k context).
  const pageText = clipChars(htmlToText(html), 6000);

  if (pageText.length < 30) {
    return NextResponse.json({ error: "Landing page has too little text content to generate copy" }, { status: 422 });
  }

  // --- mode "extensions": sitelinks + callouts from real internal links ---
  if (mode === "extensions") {
    const links = extractInternalLinks(html, url, 30);
    if (links.length === 0) {
      return NextResponse.json({ error: "No internal links found on the page — sitelinks need real destination pages" }, { status: 422 });
    }
    const extTargetLanguage = locale.startsWith("zh") ? "Chinese" : locale.startsWith("ko") ? "Korean" : "English";
    const extSystem = `You write Google Ads assets. Output ONLY a single valid JSON object — no commentary, no code fences. Use the language of the landing page primarily; if unclear, use ${extTargetLanguage}.

Shape: { "callouts": ["..."], "sitelinks": [{ "linkText": "...", "finalUrl": "...", "description1": "...", "description2": "..." }] }

Hard constraints:
- callouts: 4-8 short selling points, each ≤25 chars, no punctuation-heavy text. Grounded in the page (shipping, support, guarantees, pricing) — never invent claims.
- sitelinks: 2-6 items. finalUrl MUST be copied EXACTLY from the "Available internal links" list — do not modify or invent URLs. linkText ≤25 chars describes the destination. description1/description2 optional but must come together, each ≤35 chars.
- Skip links that are login/legal/privacy pages.`;
    const extUser = `Landing page URL: ${url}
Page title: ${pageTitle || "(none)"}

Available internal links (pick sitelink finalUrl values ONLY from these):
${links.join("\n")}

Page content (text excerpt):
${pageText}

Generate the JSON now.`;

    let extResponse;
    try {
      extResponse = await chatWithAI(
        [
          { role: "system", content: extSystem },
          { role: "user", content: extUser },
        ],
        1000,
      );
    } catch (e) {
      return NextResponse.json({ error: `AI call failed: ${e instanceof Error ? e.message : String(e)}` }, { status: 502 });
    }
    const extRaw = (extResponse?.content || "").trim();
    const extMatch = extRaw.match(/\{[\s\S]*\}/);
    if (!extMatch) {
      return NextResponse.json({ error: "AI did not return valid JSON", raw: extRaw }, { status: 502 });
    }
    let extParsed: unknown;
    try {
      extParsed = JSON.parse(extMatch[0]);
    } catch {
      return NextResponse.json({ error: "Failed to parse AI JSON", raw: extRaw }, { status: 502 });
    }
    const sanitized = sanitizeGeneratedExtensions(extParsed, links);
    if (sanitized.callouts.length === 0 && sanitized.sitelinks.length === 0) {
      return NextResponse.json({ error: "AI returned no usable extensions", raw: extRaw }, { status: 502 });
    }
    return NextResponse.json({ success: true, ...sanitized, pageTitle });
  }

  // --- mode "pmax": full asset-group creative bundle for the quick-start wizard ---
  if (mode === "pmax") {
    // Anti-hallucination: image URLs come ONLY from the real page — the LLM
    // never sees or picks them. It only writes text.
    const images = extractPageImages(html, url, 12);

    const pmaxTargetLanguage = locale.startsWith("zh") ? "Chinese" : locale.startsWith("ko") ? "Korean" : "English";
    const pmaxSystem = `You write Google Ads Performance Max creative. Output ONLY a single valid JSON object — no commentary, no code fences. Use the language of the landing page primarily; if unclear, use ${pmaxTargetLanguage}.

Shape: { "campaignName": "...", "businessName": "...", "headlines": ["..."], "longHeadlines": ["..."], "descriptions": ["..."] }

Hard constraints:
- campaignName: ≤60 chars, human-readable, e.g. "<brand> PMax <offer>".
- businessName: ≤25 chars. The brand/company running the ad.
- headlines: 8-12 strings, each ≤30 chars, each a different angle (benefit, price/offer, urgency, brand, CTA, audience).
- longHeadlines: 3-5 strings, each ≤90 chars.
- descriptions: 4-5 strings, each ≤90 chars, AND at least one ≤60 chars.

Style:
- Action-oriented, benefit-led. Mirror the page's verifiable offer — never invent claims, prices, or guarantees not on the page.
- No superlatives without basis, no excessive punctuation, no ALL CAPS words.`;
    const pmaxUser = `Landing page URL: ${url}
Page title: ${pageTitle || "(none)"}

Page content (text excerpt):
${pageText}

Generate the JSON now.`;

    let pmaxResponse;
    try {
      pmaxResponse = await chatWithAI(
        [
          { role: "system", content: pmaxSystem },
          { role: "user", content: pmaxUser },
        ],
        1500,
      );
    } catch (e) {
      return NextResponse.json({ error: `AI call failed: ${e instanceof Error ? e.message : String(e)}` }, { status: 502 });
    }
    const pmaxRaw = (pmaxResponse?.content || "").trim();
    const pmaxMatch = pmaxRaw.match(/\{[\s\S]*\}/);
    if (!pmaxMatch) {
      return NextResponse.json({ error: "AI did not return valid JSON", raw: pmaxRaw }, { status: 502 });
    }
    let pmaxParsed: unknown;
    try {
      pmaxParsed = JSON.parse(pmaxMatch[0]);
    } catch {
      return NextResponse.json({ error: "Failed to parse AI JSON", raw: pmaxRaw }, { status: 502 });
    }
    const draft = sanitizePmaxCopy(pmaxParsed, pageTitle);

    // Report Google minimums as warnings — the wizard UI lets the user fix gaps.
    const pmaxWarnings: string[] = [];
    if (draft.headlines.length < 3) pmaxWarnings.push("PMax needs at least 3 headlines");
    if (draft.longHeadlines.length < 1) pmaxWarnings.push("PMax needs at least 1 long headline");
    if (draft.descriptions.length < 2) pmaxWarnings.push("PMax needs at least 2 descriptions");
    if (!draft.businessName) pmaxWarnings.push("PMax needs a business name");
    if (images.length === 0) pmaxWarnings.push("No usable images found on the page");

    return NextResponse.json({
      success: true,
      ...draft,
      images,
      pageTitle,
      warnings: pmaxWarnings.length > 0 ? pmaxWarnings : undefined,
    });
  }

  // Channel-specific guidance for the model. We always ask it to return the union of fields;
  // the UI uses only what each ad type needs.
  const channelGuide = channel === "SEARCH"
    ? `Optimize for Responsive Search Ads: aim for ≥10 distinct headlines (each ≤30 chars) covering benefits, urgency, price, brand, CTA, and target keywords. Long headline and businessName are optional for Search but provide them anyway as fallback. Provide 4 descriptions (≤90 chars).

Also include "keywords": an array of 10-20 search terms users would type to find this offer, each ≤80 chars. Each keyword has { "text": "...", "matchType": "BROAD" | "PHRASE" | "EXACT" }. Mix match types — use EXACT for the most specific high-intent terms (brand + offer), PHRASE for noun phrases, BROAD for broader discovery. Avoid duplicate near-identical keywords.`
    : channel === "VIDEO"
      ? "Optimize for Video Responsive Ads: 3-5 short headlines (≤15 chars works best for video formats), 1 long headline (≤90), 2-3 descriptions (≤90)."
      : "Optimize for Responsive Display Ads: 5 distinct short headlines (≤30 chars each, vary tone), 1 long headline (≤90), 4-5 descriptions (≤90).";

  const targetLanguage = locale.startsWith("zh") ? "Chinese" : locale.startsWith("ko") ? "Korean" : "English";

  const systemPrompt = `You write Google Ads copy. Output ONLY a single valid JSON object — no commentary, no code fences. Use the language of the landing page primarily; if unclear, use ${targetLanguage}.

Hard constraints:
- headlines: array of strings, each ≤30 chars, no quotes/colons that confuse Google. ${channel === "SEARCH" ? "Aim for 10-15." : "Aim for 5."}
- longHeadline: a single string, ≤90 chars.
- descriptions: array of strings, each ≤90 chars. ${channel === "SEARCH" ? "Provide 4." : "Provide 4-5."}
- businessName: ≤25 chars. The brand/company running the ad (NOT the publisher of the landing page if they differ).

Style:
- Action-oriented, benefit-led.
- Mirror the landing page's verifiable offer (price, location, time-bound, etc.) — never invent claims.
- Avoid policy traps: no superlatives without basis ("#1", "best ever"), no excessive punctuation, no ALL CAPS words.
- Variety: each headline should hit a different angle (price/discount, urgency, location, benefit, brand, CTA).

${channelGuide}`;

  const userPrompt = `Landing page URL: ${url}
Page title: ${pageTitle || "(none)"}

Page content (text excerpt):
${pageText}

Generate the JSON now.`;

  let aiResponse;
  try {
    aiResponse = await chatWithAI(
      [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      1500,
    );
  } catch (e) {
    return NextResponse.json({ error: `AI call failed: ${e instanceof Error ? e.message : String(e)}` }, { status: 502 });
  }

  // Extract JSON object even if model wrapped it in code fences
  const raw = (aiResponse?.content || "").trim();
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    return NextResponse.json({ error: "AI did not return valid JSON", raw }, { status: 502 });
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonMatch[0]);
  } catch {
    return NextResponse.json({ error: "Failed to parse AI JSON", raw }, { status: 502 });
  }

  const obj = parsed as Partial<GeneratedAdCopy>;
  const headlines = Array.isArray(obj.headlines)
    ? obj.headlines.map((s) => clipChars(String(s).trim(), 30)).filter(Boolean)
    : [];
  const longHeadline = clipChars(String(obj.longHeadline || "").trim(), 90);
  const descriptions = Array.isArray(obj.descriptions)
    ? obj.descriptions.map((s) => clipChars(String(s).trim(), 90)).filter(Boolean)
    : [];
  const businessName = clipChars(String(obj.businessName || "").trim(), 25);
  const keywords = Array.isArray(obj.keywords)
    ? (obj.keywords as unknown[])
        .map((k): { text: string; matchType: "BROAD" | "PHRASE" | "EXACT" } => {
          if (typeof k === "string") return { text: clipChars(k.trim(), 80), matchType: "BROAD" };
          const o = (k && typeof k === "object" ? k : {}) as { text?: unknown; matchType?: unknown };
          const mt = String(o.matchType || "BROAD").toUpperCase();
          const matchType = (["BROAD", "PHRASE", "EXACT"].includes(mt) ? mt : "BROAD") as "BROAD" | "PHRASE" | "EXACT";
          return { text: clipChars(String(o.text || "").trim(), 80), matchType };
        })
        .filter((k) => k.text.length > 0)
    : [];

  // Per-channel validation (warn but still return — UI can pre-fill what it has)
  const warnings: string[] = [];
  if (channel === "DISPLAY") {
    if (headlines.length < 1) warnings.push("Display needs at least 1 headline");
    if (!longHeadline) warnings.push("Display needs a long headline");
    if (descriptions.length < 1) warnings.push("Display needs at least 1 description");
    if (!businessName) warnings.push("Display needs a business name");
  } else if (channel === "SEARCH") {
    if (headlines.length < 3) warnings.push("Search needs at least 3 headlines");
    if (descriptions.length < 2) warnings.push("Search needs at least 2 descriptions");
  } else if (channel === "VIDEO") {
    if (!longHeadline) warnings.push("Video needs a long headline");
    if (descriptions.length < 1) warnings.push("Video needs at least 1 description");
  }

  return NextResponse.json({
    success: true,
    headlines,
    longHeadline,
    descriptions,
    businessName,
    keywords,
    pageTitle,
    warnings: warnings.length > 0 ? warnings : undefined,
  });
}
