import { describe, it, expect } from "vitest";
import { extractInternalLinks, sanitizeGeneratedExtensions } from "./extensions";

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
