// Pure helpers for AI-generated sitelinks + callouts. Kept out of the route
// so they can be unit-tested. Design constraint: the LLM must never invent
// sitelink URLs — it may only pick from real internal links extracted from
// the fetched landing page.

export interface GeneratedSitelink {
  linkText: string;
  finalUrl: string;
  description1?: string;
  description2?: string;
}

export interface GeneratedExtensions {
  callouts: string[];
  sitelinks: GeneratedSitelink[];
}

const SKIP_EXTENSIONS = /\.(png|jpe?g|gif|svg|webp|ico|css|js|json|xml|pdf|zip|mp4|webm|woff2?)($|\?)/i;

/** Extract same-host internal links from raw HTML. Absolutizes relative hrefs,
 *  strips fragments, dedupes, skips assets/mailto/tel/js. */
export function extractInternalLinks(html: string, baseUrl: string, max = 30): string[] {
  let base: URL;
  try {
    base = new URL(baseUrl);
  } catch {
    return [];
  }

  const out: string[] = [];
  const seen = new Set<string>();
  const re = /<a\s[^>]*href\s*=\s*("([^"]*)"|'([^']*)')/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null && out.length < max) {
    const raw = (m[2] ?? m[3] ?? "").trim();
    if (!raw || raw.startsWith("#") || /^(mailto:|tel:|javascript:)/i.test(raw)) continue;
    let u: URL;
    try {
      u = new URL(raw, base);
    } catch {
      continue;
    }
    if (u.host !== base.host) continue;
    if (SKIP_EXTENSIONS.test(u.pathname)) continue;
    u.hash = "";
    const normalized = u.toString();
    const key = normalized.replace(/\/$/, "");
    if (seen.has(key)) continue;
    // Skip the landing page itself — a sitelink pointing at the ad's own
    // final URL is rejected by Google as redundant.
    if (key === base.toString().replace(/\/$/, "").split("#")[0]) continue;
    seen.add(key);
    out.push(normalized);
  }
  return out;
}

/** Clamp/filter whatever the LLM returned into valid extension inputs.
 *  Sitelink URLs not in allowedUrls are dropped (anti-hallucination). */
export function sanitizeGeneratedExtensions(
  parsed: unknown,
  allowedUrls: string[]
): GeneratedExtensions {
  const allowed = new Set(allowedUrls.map((u) => u.replace(/\/$/, "")));
  const obj = (parsed && typeof parsed === "object" ? parsed : {}) as Record<string, unknown>;

  const callouts: string[] = [];
  const seenCallouts = new Set<string>();
  for (const c of Array.isArray(obj.callouts) ? obj.callouts : []) {
    const text = String(c ?? "").trim().slice(0, 25).trim();
    if (!text) continue;
    const key = text.toLowerCase();
    if (seenCallouts.has(key)) continue;
    seenCallouts.add(key);
    callouts.push(text);
    if (callouts.length >= 10) break;
  }

  const sitelinks: GeneratedSitelink[] = [];
  const seenTexts = new Set<string>();
  for (const s of Array.isArray(obj.sitelinks) ? obj.sitelinks : []) {
    if (!s || typeof s !== "object") continue;
    const o = s as Record<string, unknown>;
    const linkText = String(o.linkText ?? "").trim().slice(0, 25).trim();
    const finalUrl = String(o.finalUrl ?? "").trim();
    if (!linkText || !allowed.has(finalUrl.replace(/\/$/, ""))) continue;
    const key = linkText.toLowerCase();
    if (seenTexts.has(key)) continue;
    seenTexts.add(key);
    let description1 = String(o.description1 ?? "").trim().slice(0, 35).trim() || undefined;
    let description2 = String(o.description2 ?? "").trim().slice(0, 35).trim() || undefined;
    // Google requires both or neither.
    if (!description1 || !description2) {
      description1 = undefined;
      description2 = undefined;
    }
    sitelinks.push({ linkText, finalUrl, description1, description2 });
    if (sitelinks.length >= 6) break;
  }

  return { callouts, sitelinks };
}

// ============================================================
// PMax quick-start wizard helpers (pure, unit-tested)
// ============================================================

const IMAGE_OK_EXTENSIONS = /\.(jpe?g|png|webp)($|\?)/i;
const IMAGE_BAD_EXTENSIONS = /\.(svg|gif|ico|bmp|avif)($|\?)/i;
const IMAGE_SKIP_HINTS = /(favicon|sprite|pixel|tracking|spacer|blank|1x1)/i;

/** Extract candidate marketing-image URLs from raw landing-page HTML.
 *  Sources: og:image / twitter:image metas, <link rel="image_src">, <img src/data-src>.
 *  Absolutizes relative URLs, keeps http(s) only, drops SVG/GIF/icons, dedupes.
 *  Anti-hallucination twin of extractInternalLinks: the wizard may only offer
 *  images that really exist on the page — the LLM never picks image URLs. */
export function extractPageImages(html: string, baseUrl: string, max = 12): string[] {
  let base: URL;
  try {
    base = new URL(baseUrl);
  } catch {
    return [];
  }

  const candidates: string[] = [];
  // Meta images first — usually the best marketing shot on the page.
  const metaRe = /<meta\s[^>]*(?:property|name)\s*=\s*["'](?:og:image(?::secure_url)?|twitter:image(?::src)?)["'][^>]*content\s*=\s*["']([^"']+)["']/gi;
  let m: RegExpExecArray | null;
  while ((m = metaRe.exec(html)) !== null) candidates.push(m[1].trim());
  // Some pages put content before property — second pass with reversed attribute order.
  const metaRe2 = /<meta\s[^>]*content\s*=\s*["']([^"']+)["'][^>]*(?:property|name)\s*=\s*["'](?:og:image(?::secure_url)?|twitter:image(?::src)?)["']/gi;
  while ((m = metaRe2.exec(html)) !== null) candidates.push(m[1].trim());
  const linkRe = /<link\s[^>]*rel\s*=\s*["']image_src["'][^>]*href\s*=\s*["']([^"']+)["']/gi;
  while ((m = linkRe.exec(html)) !== null) candidates.push(m[1].trim());
  const imgRe = /<img\s[^>]*?(?:data-src|src)\s*=\s*["']([^"']+)["']/gi;
  while ((m = imgRe.exec(html)) !== null) candidates.push(m[1].trim());

  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of candidates) {
    if (out.length >= max) break;
    if (!raw || raw.startsWith("data:")) continue;
    let u: URL;
    try {
      u = new URL(raw, base);
    } catch {
      continue;
    }
    if (u.protocol !== "http:" && u.protocol !== "https:") continue;
    if (IMAGE_BAD_EXTENSIONS.test(u.pathname)) continue;
    // Allow extensionless URLs (common for og:image CDN links) but require a
    // known-good extension when one is present.
    const hasExtension = /\.[a-z0-9]{2,5}($|\?)/i.test(u.pathname);
    if (hasExtension && !IMAGE_OK_EXTENSIONS.test(u.pathname)) continue;
    if (IMAGE_SKIP_HINTS.test(u.pathname)) continue;
    u.hash = "";
    const key = u.toString();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(key);
  }
  return out;
}

/** AI-drafted PMax creative bundle after sanitization. */
export interface PmaxCopyDraft {
  campaignName: string;
  businessName: string;
  headlines: string[];
  longHeadlines: string[];
  descriptions: string[];
}

function clip(s: string, max: number): string {
  const t = s.trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace > max - 8 ? cut.slice(0, lastSpace) : cut).trim();
}

function dedupeClip(values: unknown, maxLen: number, maxCount: number): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const v of Array.isArray(values) ? values : []) {
    const text = clip(String(v ?? ""), maxLen);
    if (!text) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(text);
    if (out.length >= maxCount) break;
  }
  return out;
}

/** Clamp whatever the LLM returned into a valid PMax asset-group creative
 *  bundle. Never invents content — only clips, dedupes, and derives the
 *  campaign name from businessName/pageTitle when the model omitted it.
 *  Google minimums (≥3 headlines etc.) are reported by the caller as
 *  warnings, not silently padded. */
export function sanitizePmaxCopy(raw: unknown, pageTitle: string): PmaxCopyDraft {
  const obj = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;

  const businessName = clip(String(obj.businessName ?? ""), 25);
  const headlines = dedupeClip(obj.headlines, 30, 15);
  const longHeadlines = dedupeClip(obj.longHeadlines, 90, 5);
  const descriptions = dedupeClip(obj.descriptions, 90, 5);

  // Google requires ≥1 description ≤60 chars — shorten the first one if needed.
  if (descriptions.length > 0 && !descriptions.some((d) => d.length <= 60)) {
    descriptions[0] = clip(descriptions[0], 60);
  }

  let campaignName = clip(String(obj.campaignName ?? ""), 60);
  if (!campaignName) {
    const fallback = businessName || clip(pageTitle, 40);
    campaignName = fallback ? `${fallback} PMax` : "";
  }

  return { campaignName, businessName, headlines, longHeadlines, descriptions };
}
