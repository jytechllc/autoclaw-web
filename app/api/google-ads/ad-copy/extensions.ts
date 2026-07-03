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
