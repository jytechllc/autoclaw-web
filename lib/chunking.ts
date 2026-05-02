/**
 * Document extraction and chunking utilities for the knowledge base.
 * Supports: PDF, DOCX, plain text, URLs, and images (via description).
 */

const CHUNK_SIZE = 800;    // target tokens per chunk (~3200 chars)
const CHUNK_OVERLAP = 100; // overlap tokens (~400 chars)
const CHARS_PER_TOKEN = 4; // rough estimate

export interface ChunkResult {
  chunks: string[];
  title: string;
  docType: string;
}

/**
 * Extract text from a PDF buffer using pdf-parse v2 (PDFParse class API).
 * No worker needed; pure Node.js text extraction.
 */
export async function extractPdf(buffer: Buffer): Promise<string> {
  const { PDFParse } = await import("pdf-parse");
  const parser = new PDFParse({ data: new Uint8Array(buffer) });
  const result = await parser.getText();
  return result.text;
}

/**
 * Extract text from a DOCX buffer using mammoth.
 */
export async function extractDocx(buffer: Buffer): Promise<string> {
  const mammoth = await import("mammoth");
  const result = await mammoth.extractRawText({ buffer });
  return result.value;
}

/**
 * Extract text content from a URL by fetching and parsing HTML.
 */
export async function extractUrl(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; AutoClaw/1.0; +https://autoclaw.ai)",
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.5",
    },
    signal: AbortSignal.timeout(15000),
    redirect: "follow",
  });
  if (!res.ok) throw new Error(`Failed to fetch URL (HTTP ${res.status}). The site may block automated access.`);

  const html = await res.text();

  // Extract meta description and og:description as fallback content
  const metaDesc = html.match(/<meta[^>]+(?:name="description"|property="og:description")[^>]+content="([^"]*)"/) ||
    html.match(/<meta[^>]+content="([^"]*)"[^>]+(?:name="description"|property="og:description")/);
  const ogTitle = html.match(/<meta[^>]+property="og:title"[^>]+content="([^"]*)"/) ||
    html.match(/<meta[^>]+content="([^"]*)"[^>]+property="og:title"/);
  const pageTitle = html.match(/<title[^>]*>([^<]*)<\/title>/i);

  // Simple HTML to text extraction — strip tags, decode entities
  const bodyText = html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<noscript[^>]*>[\s\S]*?<\/noscript>/gi, "")
    .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, "")
    .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, "")
    .replace(/<header[^>]*>[\s\S]*?<\/header>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();

  // If body text is too short (JS-rendered SPA), use meta tags as fallback
  if (bodyText.length < 100) {
    const parts: string[] = [];
    if (ogTitle?.[1] || pageTitle?.[1]) parts.push(`Title: ${ogTitle?.[1] || pageTitle?.[1]}`);
    if (metaDesc?.[1]) parts.push(`Description: ${metaDesc[1]}`);
    parts.push(`URL: ${url}`);
    if (bodyText.length > 10) parts.push(bodyText);

    const fallback = parts.join("\n\n");
    if (fallback.length < 30) {
      throw new Error("Could not extract meaningful content from this URL. The page may require JavaScript to render (e.g., Instagram, single-page apps).");
    }
    return fallback;
  }

  return bodyText;
}

/**
 * Walk back from the end of `text` and return up to `maxChars` of trailing
 * content that begins at a sentence boundary. Falls back to a raw char slice
 * if no boundary is found within the window.
 */
function sentenceOverlap(text: string, maxChars: number): string {
  const slice = text.length > maxChars ? text.slice(-maxChars) : text;
  const m = slice.match(/[.!?。！？]["')\]]?\s*/);
  if (m && m.index !== undefined) {
    return slice.slice(m.index + m[0].length);
  }
  return slice;
}

/** Split into sentences. Chinese punctuation splits without requiring whitespace. */
function splitSentences(text: string): string[] {
  return text.split(/(?<=[。！？])|(?<=[.!?])\s+/).filter((s) => s.trim().length > 0);
}

/**
 * Split text into overlapping chunks suitable for embedding.
 */
export function chunkText(text: string): string[] {
  if (!text || text.trim().length === 0) return [];

  const chunkChars = CHUNK_SIZE * CHARS_PER_TOKEN;
  const overlapChars = CHUNK_OVERLAP * CHARS_PER_TOKEN;

  const paragraphs = text.split(/\n\s*\n/).filter((p) => p.trim().length > 0);
  const chunks: string[] = [];
  let current = "";

  for (const para of paragraphs) {
    if (current.length + para.length > chunkChars && current.length > 0) {
      chunks.push(current.trim());
      const overlap = sentenceOverlap(current, overlapChars);
      current = overlap ? overlap + "\n\n" + para : para;
    } else {
      current += (current ? "\n\n" : "") + para;
    }
  }

  if (current.trim().length > 0) {
    chunks.push(current.trim());
  }

  // Sentence-level fallback for any chunk over budget
  const finalChunks: string[] = [];
  for (const chunk of chunks) {
    if (chunk.length > chunkChars) {
      const sentences = splitSentences(chunk);
      let part = "";
      for (const sentence of sentences) {
        if (part.length + sentence.length > chunkChars && part.length > 0) {
          finalChunks.push(part.trim());
          const overlap = sentenceOverlap(part, overlapChars);
          part = overlap ? overlap + " " + sentence : sentence;
        } else {
          part += (part ? " " : "") + sentence;
        }
      }
      if (part.trim().length > 0) finalChunks.push(part.trim());
    } else {
      finalChunks.push(chunk);
    }
  }

  return finalChunks;
}

/**
 * Estimate token count for a text string.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}
