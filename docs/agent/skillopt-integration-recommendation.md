# SkillOpt Integration — Recommendation

**Last updated:** 2026-08-12
**Status: future consideration, not scheduled.** Gated on prerequisites below — do not wire this in until they exist. Written to capture the reasoning while it's fresh, for whenever citation-verification tooling lands and this becomes worth revisiting.

## What SkillOpt is

[`microsoft/SkillOpt`](https://github.com/microsoft/SkillOpt) is a text-space optimizer for frozen LLM agents: it treats a compact natural-language skill document as the trainable artifact and improves it through rollout → score → optimizer-model-proposes-bounded-edits → accept-only-if-held-out-validation-improves, the same discipline as neural-net training (epochs, batches, learning-rate budgets, validation gates) but applied to text instead of weights. Output is a static `best_skill.md` (~300–2,000 tokens) — zero additional inference-time model calls at deploy time, since the target model/backend/harness stay fixed and only the procedure text evolves.

## Where it fits in this repo's architecture

This repo already has an artifact of exactly the shape SkillOpt optimizes: `legal-mcp`'s `legal_lookup_guidance` MCP **Prompt** (see `docs/plan/legal-mcp-plan.md`), the "search → drill into real text → cite precisely → prefer valid law" recipe. That recipe was hand-tuned once already — see `docs/plan/agent-bot-plan.md`'s postmortem: a self-hosted ~27B model kept re-searching with varied keywords across all 5 tool-call rounds and never called `get_document_nodes` for real article text, until the prompt was given explicit numbered ordering. SkillOpt is a candidate to automate that class of tuning — measured rollout-driven edits instead of one-off manual prompt surgery — and since `legal_lookup_guidance` is published as a protocol-standard MCP Prompt, any consumer (`agent-bot`, a future web UI, Claude Desktop) benefits from an improved version without per-client changes.

**The boundary that matters:** SkillOpt optimizes the *instruction layer* (how an agent is told to use tools), not the *knowledge/grounding layer* (whether a citation is actually real). Those are architecturally distinct in this repo already:

| Layer | Owns | Current state |
|---|---|---|
| Knowledge/grounding | Actual legal text, `document_node` hierarchy, validity-status filtering enforced in tool-handler code (not just prompt text) | Implemented — `legal-mcp`'s `search_documents`/`get_document`/`get_document_nodes`/`get_references` tools |
| Instruction/procedure | Workflow ordering, when to refuse, formatting | `legal_lookup_guidance` MCP Prompt — hand-tuned today |
| Verification (missing) | Checking a *specific* cited Điều/Khoản against real `document_node` content | Not built. `get_references` was designed as a Postgres-backed stand-in for exactly this — see `docs/plan/legal-mcp-plan.md` — but no `verify_citation`-style pass/fail check exists yet |

SkillOpt has no equivalent of the third row. It only knows whether a scored trajectory went up or down on whatever metric it's given — it doesn't know what a correct citation is. Fed a scorer that just judges surface plausibility ("does this look like a well-cited legal answer"), it will converge just as readily on confidently-wrong citations as correct ones, because both score identically to a scorer that can't check the underlying fact. This is the same failure mode `search_documents`'s hard-coded validity default was built to avoid for a *different* problem (a weak model ignoring a text-only nudge) — SkillOpt doesn't remove the need for that kind of code-level enforcement, it just optimizes a different, upstream layer.

## Prerequisites before this is worth adopting

1. **A deterministic `verify_citation` tool** — check a cited Điều/Khoản/Điểm against real `document_node` rows, return pass/fail (+ ideally a diff of what was claimed vs. what the text says). This is the reward signal SkillOpt's validation gate would consume; without it there's nothing grounded to optimize against. Natural fit alongside `get_references` in `legal-mcp`, and lines up with the Neo4j-era `verify_citation` tool already named in `docs/research/legal-ai-retrieval-landscape.md` §4b (currently a Postgres-backed stand-in is enough to start).
2. **A held-out evaluation set** of legal questions with known-correct citations — SkillOpt's rollout/validation split needs real graded examples, not just "looks plausible." Vietnamese-legal-domain QA pairs with ground-truth Điều/Khoản references, ideally spanning both `còn hiệu lực` and superseded documents to test the validity-filtering behavior too.

## How it could plug in, once those exist

- Reward = `verify_citation` pass/fail (+ citation completeness / precision) on scored rollouts of `agent-bot` (or any MCP client) answering the held-out question set.
- Optimization target = `legal_lookup_guidance`'s text, deployed back as the same MCP Prompt — no changes needed to any consuming client.
- If the harness grows into genuinely multiple agent roles (retrieval agent vs. a citation-checking agent vs. an answer composer — consistent with wanting "a harness rather than one dedicated agent"), SkillOpt could run one optimization loop per role's skill doc rather than a single shared prompt, since each role's failure modes differ.

## Recommendation

Don't adopt yet. Build prerequisite #1 (`verify_citation`) first — it's independently valuable even without SkillOpt, since it's the actual grounding check this harness is currently missing. Revisit SkillOpt once that tool and a real eval set exist; at that point it's a relatively low-effort addition (an optimizer loop run offline against existing MCP tools) for a plausible reliability gain on the instruction layer specifically, not a substitute for the verification work itself.
