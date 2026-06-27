import { describe, it, expect } from "vitest";
import { listCharacters, buildCharacterPrompt } from "../characters";
import { buildSystemPrompt } from "../constants";

describe("character agent", () => {
  it("lists characters without exposing prompts", () => {
    const list = listCharacters();
    expect(list.length).toBe(5);
    expect(list[0]).toHaveProperty("name");
    expect(list[0]).not.toHaveProperty("prompt");
  });

  it("injects the persona block only when a character is selected", () => {
    const base = { projects: [], agents: [], userPlan: "starter", agentLimit: 999, ragContext: "", locale: "en" };
    const without = buildSystemPrompt({ ...base, character: null });
    const withMunger = buildSystemPrompt({ ...base, character: "munger" });
    expect(without).not.toContain("Active persona");
    expect(withMunger).toContain("Active persona: Charlie Munger");
    expect(withMunger).toContain("mental models");
  });

  it("ignores unknown character ids (falls back to default)", () => {
    expect(buildCharacterPrompt("does-not-exist")).toBe("");
  });
});
