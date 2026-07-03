import { describe, it, expect } from "vitest";
import { extractInternalLinks, sanitizeGeneratedExtensions, extractPageImages, sanitizePmaxCopy } from "./extensions";

const BASE = "https://acme.example.com/";

describe("extractInternalLinks", () => {
  it("absolutizes relative links and keeps same-host absolute ones", () => {
    const html = `
      <a href="/pricing">Pricing</a>
      <a href='features'>Features</a>
      <a href="https://acme.example.com/about">About</a>
    `;
    const links = extractInternalLinks(html, BASE);
    expect(links).toEqual([
      "https://acme.example.com/pricing",
      "https://acme.example.com/features",
      "https://acme.example.com/about",
    ]);
  });

  it("drops external hosts, assets, anchors, mailto/tel/js and the landing page itself", () => {
    const html = `
      <a href="https://other.example.com/x">ext</a>
      <a href="/logo.png">img</a>
      <a href="#section">anchor</a>
      <a href="mailto:hi@acme.example.com">mail</a>
      <a href="tel:+123">tel</a>
      <a href="javascript:void(0)">js</a>
      <a href="/">self</a>
      <a href="/pricing">ok</a>
    `;
    expect(extractInternalLinks(html, BASE)).toEqual(["https://acme.example.com/pricing"]);
  });

  it("dedupes (incl. trailing slash and fragment variants) and respects max", () => {
    const html = `
      <a href="/pricing">a</a>
      <a href="/pricing/">b</a>
      <a href="/pricing#top">c</a>
      <a href="/features">d</a>
    `;
    expect(extractInternalLinks(html, BASE)).toHaveLength(2);
    expect(extractInternalLinks(html, BASE, 1)).toHaveLength(1);
  });

  it("returns empty for an invalid base url", () => {
    expect(extractInternalLinks('<a href="/x">x</a>', "not-a-url")).toEqual([]);
  });
});

describe("sanitizeGeneratedExtensions", () => {
  const allowed = ["https://acme.example.com/pricing", "https://acme.example.com/features"];

  it("keeps valid callouts and sitelinks, clips lengths", () => {
    const result = sanitizeGeneratedExtensions({
      callouts: ["Free shipping", "x".repeat(40)],
      sitelinks: [
        { linkText: "Pricing", finalUrl: "https://acme.example.com/pricing", description1: "See all plans", description2: "Free tier" },
      ],
    }, allowed);
    expect(result.callouts[0]).toBe("Free shipping");
    expect(result.callouts[1].length).toBeLessThanOrEqual(25);
    expect(result.sitelinks).toHaveLength(1);
    expect(result.sitelinks[0].description1).toBe("See all plans");
  });

  it("drops sitelinks with hallucinated URLs", () => {
    const result = sanitizeGeneratedExtensions({
      sitelinks: [
        { linkText: "Fake", finalUrl: "https://acme.example.com/made-up" },
        { linkText: "Real", finalUrl: "https://acme.example.com/features/" }, // trailing slash still matches
      ],
    }, allowed);
    expect(result.sitelinks.map((s) => s.linkText)).toEqual(["Real"]);
  });

  it("drops a lone description (both-or-neither)", () => {
    const result = sanitizeGeneratedExtensions({
      sitelinks: [{ linkText: "P", finalUrl: allowed[0], description1: "only one" }],
    }, allowed);
    expect(result.sitelinks[0].description1).toBeUndefined();
    expect(result.sitelinks[0].description2).toBeUndefined();
  });

  it("dedupes case-insensitively and caps counts", () => {
    const result = sanitizeGeneratedExtensions({
      callouts: Array.from({ length: 15 }, (_, i) => `Callout ${i}`).concat(["dup", "DUP"]),
      sitelinks: [
        { linkText: "Pricing", finalUrl: allowed[0] },
        { linkText: "pricing", finalUrl: allowed[1] },
      ],
    }, allowed);
    expect(result.callouts.length).toBeLessThanOrEqual(10);
    expect(result.sitelinks).toHaveLength(1);
  });

  it("handles garbage input", () => {
    expect(sanitizeGeneratedExtensions(null, allowed)).toEqual({ callouts: [], sitelinks: [] });
    expect(sanitizeGeneratedExtensions("nope", allowed)).toEqual({ callouts: [], sitelinks: [] });
    expect(sanitizeGeneratedExtensions({ callouts: [null, 42], sitelinks: ["x"] }, allowed).sitelinks).toEqual([]);
  });
});

describe("extractPageImages", () => {
  it("collects og:image, twitter:image, link image_src and img tags, absolutized", () => {
    const html = `
      <meta property="og:image" content="https://cdn.example.com/hero" />
      <meta name="twitter:image" content="/social.jpg">
      <link rel="image_src" href="/legacy.png">
      <img src="products/shoe.webp" alt="">
      <img data-src="/lazy-banner.jpeg">
    `;
    expect(extractPageImages(html, BASE)).toEqual([
      "https://cdn.example.com/hero",
      "https://acme.example.com/social.jpg",
      "https://acme.example.com/legacy.png",
      "https://acme.example.com/products/shoe.webp",
      "https://acme.example.com/lazy-banner.jpeg",
    ]);
  });

  it("drops data URIs, SVG/GIF/ICO, tracking pixels, favicons and non-http protocols", () => {
    const html = `
      <img src="data:image/png;base64,AAAA">
      <img src="/art.svg">
      <img src="/anim.gif">
      <img src="/favicon.ico">
      <img src="/pixel.png">
      <img src="/spacer.jpg">
      <img src="ftp://files.example.com/a.jpg">
      <img src="/real-photo.jpg">
    `;
    expect(extractPageImages(html, BASE)).toEqual(["https://acme.example.com/real-photo.jpg"]);
  });

  it("dedupes, strips fragments, and honors the max cap", () => {
    const html = `
      <img src="/a.jpg#top">
      <img src="/a.jpg">
      <img src="/b.jpg">
      <img src="/c.jpg">
    `;
    expect(extractPageImages(html, BASE, 2)).toEqual([
      "https://acme.example.com/a.jpg",
      "https://acme.example.com/b.jpg",
    ]);
  });

  it("rejects unknown extensions but keeps extensionless CDN URLs", () => {
    const html = `
      <img src="/document.pdf">
      <img src="https://cdn.example.com/img/12345">
    `;
    expect(extractPageImages(html, BASE)).toEqual(["https://cdn.example.com/img/12345"]);
  });

  it("returns [] for an unparseable base URL", () => {
    expect(extractPageImages('<img src="/a.jpg">', "not a url")).toEqual([]);
  });
});

describe("sanitizePmaxCopy", () => {
  it("clips lengths, dedupes case-insensitively, and enforces count caps", () => {
    const draft = sanitizePmaxCopy({
      campaignName: "Acme Spring Sale PMax",
      businessName: "A very long business name over 25",
      headlines: ["Fast Shipping", "fast shipping", ...Array.from({ length: 20 }, (_, i) => `Headline ${i}`)],
      longHeadlines: ["L1", "L2", "L3", "L4", "L5", "L6"],
      descriptions: ["short one", "d2", "d3", "d4", "d5", "d6"],
    }, "Acme");
    expect(draft.businessName.length).toBeLessThanOrEqual(25);
    expect(draft.headlines.length).toBe(15);
    expect(draft.headlines.filter((h) => h.toLowerCase() === "fast shipping").length).toBe(1);
    expect(draft.longHeadlines.length).toBe(5);
    expect(draft.descriptions.length).toBe(5);
    expect(draft.campaignName).toBe("Acme Spring Sale PMax");
  });

  it("guarantees one description ≤60 chars by clipping the first", () => {
    const long = "x".repeat(89);
    const draft = sanitizePmaxCopy({ descriptions: [long, long + "y"] }, "");
    expect(draft.descriptions.some((d) => d.length <= 60)).toBe(true);
  });

  it("derives campaignName from businessName, then pageTitle", () => {
    expect(sanitizePmaxCopy({ businessName: "Acme" }, "ignored").campaignName).toBe("Acme PMax");
    expect(sanitizePmaxCopy({}, "Acme Store — Shoes").campaignName).toBe("Acme Store — Shoes PMax");
    expect(sanitizePmaxCopy({}, "").campaignName).toBe("");
  });

  it("tolerates garbage input", () => {
    const draft = sanitizePmaxCopy(null, "");
    expect(draft).toEqual({ campaignName: "", businessName: "", headlines: [], longHeadlines: [], descriptions: [] });
    expect(sanitizePmaxCopy({ headlines: "not-an-array", descriptions: [null, 42] }, "").headlines).toEqual([]);
  });
});
