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
 * Extract text from a PDF buffer using pdfjs-dist directly.
 * Pre-loads the worker module into globalThis to avoid the
 * "Cannot find module pdf.worker.mjs" error in Next.js/Vercel.
 */
export async function extractPdf(buffer: Buffer): Promise<string> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");

  // Disable worker — server-side doesn't need it, and avoids
  // "Cannot find module pdf.worker.mjs" in Next.js dev/Turbopack.
  pdfjs.GlobalWorkerOptions.workerSrc = "";

  const doc = await pdfjs.getDocument({
    data: new Uint8Array(buffer),
    cMapUrl: "https://cdn.jsdelivr.net/npm/pdfjs-dist/cmaps/",
    cMapPacked: true,
    useSystemFonts: true,
    isEvalSupported: false,
  } as Parameters<typeof pdfjs.getDocument>[0]).promise;
  const pages: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    const text = content.items
      .filter((item: Record<string, unknown>) => "str" in item)
      .map((item: Record<string, unknown>) => item.str as string)
      .join(" ");
    pages.push(text);
  }
  doc.destroy();
  return pages.join("\n\n");
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
 * Split text into overlapping chunks suitable for embedding.
 */
export function chunkText(text: string): string[] {
  if (!text || text.trim().length === 0) return [];

  const chunkChars = CHUNK_SIZE * CHARS_PER_TOKEN;
  const overlapChars = CHUNK_OVERLAP * CHARS_PER_TOKEN;

  // Split by paragraphs first, then sentences
  const paragraphs = text.split(/\n\s*\n/).filter((p) => p.trim().length > 0);
  const chunks: string[] = [];
  let current = "";

  for (const para of paragraphs) {
    if (current.length + para.length > chunkChars && current.length > 0) {
      chunks.push(current.trim());
      // Keep overlap from end of current chunk
      const overlap = current.slice(-overlapChars);
      current = overlap + " " + para;
    } else {
      current += (current ? "\n\n" : "") + para;
    }
  }

  if (current.trim().length > 0) {
    chunks.push(current.trim());
  }

  // If any chunk is still too large, split by sentences
  const finalChunks: string[] = [];
  for (const chunk of chunks) {
    if (chunk.length > chunkChars * 1.5) {
      const sentences = chunk.split(/(?<=[.!?。！？])\s+/);
      let part = "";
      for (const sentence of sentences) {
        if (part.length + sentence.length > chunkChars && part.length > 0) {
          finalChunks.push(part.trim());
          const overlap = part.slice(-overlapChars);
          part = overlap + " " + sentence;
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
