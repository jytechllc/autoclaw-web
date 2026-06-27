import { describe, it, expect } from "vitest";
import { listCharacters, buildCharacterPrompt, AVAILABLE_CHARACTERS } from "../characters";
import { buildSystemPrompt } from "../constants";

describe("character agent", () => {
  it("exposes the eight nuwa-distilled personas", () => {
    const ids = AVAILABLE_CHARACTERS.map((c) => c.id);
    expect(ids).toEqual(["munger", "feynman", "naval", "paul-graham", "steve-jobs", "zhang-yiming", "mrbeast", "taleb"]);
  });

  it("lists characters without exposing the overlay prompt", () => {
    const list = listCharacters();
    expect(list.length).toBe(8);
    expect(list[0]).toHaveProperty("name");
    expect(list[0]).not.toHaveProperty("prompt");
  });

  it("every persona carries a non-trivial overlay and nuwa-skill provenance", () => {
    for (const c of AVAILABLE_CHARACTERS) {
      expect(c.prompt.length).toBeGreaterThan(1000);
      expect(c.source).toContain("nuwa-skill");
    }
  });

  it("injects the persona block (with provenance) only when a character is selected", () => {
    const base = { projects: [], agents: [], userPlan: "starter", agentLimit: 999, ragContext: "", locale: "en" };
    const without = buildSystemPrompt({ ...base, character: null });
    const withMunger = buildSystemPrompt({ ...base, character: "munger" });
    expect(without).not.toContain("Active persona");
    expect(withMunger).toContain("Active persona: Charlie Munger");
    expect(withMunger).toContain("nuwa-skill");
    expect(withMunger).toContain("## Mental models");
  });

  it("overlays are written in English (no CJK characters)", () => {
    for (const c of AVAILABLE_CHARACTERS) {
      expect(c.prompt).not.toMatch(/[一-鿿]/);
    }
  });

  it("ignores unknown character ids (falls back to default)", () => {
    expect(buildCharacterPrompt("does-not-exist")).toBe("");
  });
});
