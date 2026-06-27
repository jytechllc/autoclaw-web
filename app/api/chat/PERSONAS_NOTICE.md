# Persona overlays — third-party attribution

The character personas in `personas.ts` are distilled from
[**alchaincyf/nuwa-skill**](https://github.com/alchaincyf/nuwa-skill), licensed
under the **MIT License**.

- Source: each persona's `SKILL.md` under `examples/<persona>-perspective/` in that repo.
- What we use: only the thinking-framework and voice sections (mental models /
  decision heuristics / expression DNA / content formulas / honest boundaries),
  translated and condensed into English. The roleplay and agentic-protocol sections,
  and the Chinese-output-adaptation notes, are intentionally dropped so the AutoClaw
  assistant keeps its tools, RAG, and guardrails and adopts the persona only as a
  thinking/voice overlay.
- The English overlays in `personas.ts` are hand-maintained: to revise a persona,
  re-read the upstream SKILL.md and edit `personas.ts` directly.

Per the MIT License, the upstream copyright notice and permission notice are retained
through this attribution. See the upstream `LICENSE` file for the full text.
