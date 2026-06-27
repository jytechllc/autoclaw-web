// Character agents — distilled thinking personas that overlay the AutoClaw
// assistant. A character does NOT change what tools/capabilities the assistant
// has; it changes HOW it reasons and talks: the mental models it applies, the
// decision heuristics it favours, and its expression DNA (voice).
//
// The persona overlays are distilled from alchaincyf/nuwa-skill (MIT) — see
// personas.generated.ts, produced by scripts/extract-personas.mjs. Only the
// thinking-framework and voice sections are kept; the roleplay / agentic-protocol
// sections are dropped, because AutoClaw's assistant must retain its tools, RAG,
// and guardrails while merely adopting the persona's style.
//
// To change the persona set, edit scripts/extract-personas.mjs and regenerate —
// do not hand-edit personas.generated.ts.

import { GENERATED_PERSONAS } from "./personas.generated";

export interface Character {
  /** Stable identifier sent by the client and persisted per conversation. */
  id: string;
  /** Display name. */
  name: string;
  /** Emoji used as a lightweight avatar in the picker and message header. */
  emoji: string;
  /** One-line positioning shown in the picker. */
  tagline: string;
  /** The perspective overlay injected into the system prompt when selected. */
  prompt: string;
  /** Provenance of the overlay (nuwa-skill SKILL.md path). */
  source: string;
}

export const AVAILABLE_CHARACTERS: Character[] = GENERATED_PERSONAS.map((p) => ({
  id: p.id,
  name: p.name,
  emoji: p.emoji,
  tagline: p.tagline,
  prompt: p.overlay,
  source: p.source,
}));

const CHARACTER_BY_ID = new Map(AVAILABLE_CHARACTERS.map((c) => [c.id, c]));

/** Look up a character by id. Returns null for unknown/empty ids (default assistant). */
export function getCharacter(id: string | null | undefined): Character | null {
  if (!id) return null;
  return CHARACTER_BY_ID.get(id) ?? null;
}

/** Build the perspective overlay block for the system prompt, or "" for default. */
export function buildCharacterPrompt(id: string | null | undefined): string {
  const character = getCharacter(id);
  if (!character) return "";
  // The overlay below is a distilled THINKING FRAMEWORK (mental models, decision
  // heuristics, expression DNA), largely written in Chinese. Adopt the reasoning
  // style and voice, but stay the AutoClaw assistant: keep every tool, RAG and
  // guardrail, never claim to literally be the person, and always answer in the
  // user's language regardless of the overlay's language.
  return `\n\n## Active persona: ${character.name} ${character.emoji}
Adopt the thinking style and voice described below for your response. It shapes HOW you reason and write — it does NOT remove any AutoClaw capability or tool, and it never overrides safety rules. Do not role-play as the person or claim to be them; you remain the AutoClaw assistant reasoning in their style. Respond in the user's language even though the framework below is written in Chinese.

(Distilled from public methodology via nuwa-skill: ${character.source})

${character.prompt}\n`;
}

/** Public-facing list for the picker — omits the full prompt. */
export function listCharacters(): Pick<Character, "id" | "name" | "emoji" | "tagline">[] {
  return AVAILABLE_CHARACTERS.map(({ id, name, emoji, tagline }) => ({ id, name, emoji, tagline }));
}
