# Persona overlays — third-party attribution

The character personas in `personas.generated.ts` are distilled from
[**alchaincyf/nuwa-skill**](https://github.com/alchaincyf/nuwa-skill), licensed
under the **MIT License**.

- Source: each persona's `SKILL.md` under `examples/<persona>-perspective/` in that repo.
- What we use: only the thinking-framework and voice sections (核心心智模型 / 决策启发式 /
  表达DNA / 内容创造公式 / 价值观与反模式 / 诚实边界). The roleplay and agentic-protocol
  sections are intentionally dropped so the AutoClaw assistant keeps its tools, RAG, and
  guardrails and adopts the persona only as a thinking/voice overlay.
- How to regenerate: `NUWA_DIR=~/nuwa-skill node scripts/extract-personas.mjs`

Per the MIT License, the upstream copyright notice and permission notice are retained
through this attribution. See the upstream `LICENSE` file for the full text.
