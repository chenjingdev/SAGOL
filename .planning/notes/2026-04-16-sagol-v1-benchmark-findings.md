---
title: SAGOL v1 Benchmark Findings — Stage 1 Results + Structural Data
date: 2026-04-16
status: evidence gathered, decision pending
context: post-Phase-2 manual benchmark session (explore-mode, Socratic → data-driven)
related:
  - .planning/research/bench-stage1/case1_verdict.md
  - .planning/research/bench-stage1/case1_{full,stripped}_response.txt
  - .planning/research/HEADLESS_HOOK_LIMITATION.md
---

# SAGOL v1 Benchmark — Findings

## 1. Hypothesis Under Test

**Claim (B) — Quality axis (user-identified as core):** Stripping stale assistant reports from session context improves downstream response quality on follow-up tasks.

**Claim (A) — Cost axis:** Token reduction → API cost + latency savings. User deferred — "validate B first, A follows mechanically."

**User's prior on effect size:** Performance degradation appears noticeably above ~300K context; below ~200K, expected to be minimal or null. Derived from self-observation ("나는 그 이상 쓴적이 많이 없어" = avoided long-context usage because it feels bad).

## 2. Methodology Summary

- **Stage 1 (this note):** Scrappy pilot. N=1 case, inline, no external API, Claude subagents as both generators AND judge (self-bias flagged throughout).
- **Stage 2 (if triggered):** Proper tooling — external judge (GPT-4o/Sonnet), N=10-30, stratified by context length.

## 3. Finding A — Context Bloat Composition (Structural)

Surveyed 6 large Claude Code agent sessions (total ~1.6MB across ezplanet-portal, agrune, chenjing-plugins, playground):

| Component | Share | What it is |
|-----------|-------|------------|
| **assistant TEXT** | **3.1%** | ← SAGOL's stripping target |
| assistant tool_use | 17.2% | Tool calls (Edit, Read, Bash inputs) |
| user TEXT (real) | 7.0% | Actual user typing |
| **user tool_result** | **72.7%** | ← Where the bloat actually lives (file reads, grep, web fetches, browser snapshots) |

**Assistant text length distribution across 324 turns in these sessions:**
- `<500` chars: 303 turns (93.5%)
- `500-1k`: 19 turns (5.9%)
- `1k-3k`: 2 turns (0.6%)
- `≥3k chars: **0 turns**

**Implication:** In practical Claude Code agent workflows, the assistant does NOT produce long report-like text responses. Long content sits in tool_result blocks (user messages in the API). SAGOL's write_report hook, which strips assistant tool_use inputs, targets a category that comprises ~3% of context, of which the "report"-sized fraction is even smaller.

## 4. Finding B — Dogfood Usage Pattern

In sagol's own Phase-2 session `6aba7a93` (330 assistant turns, stripping active):

- `write_report` was called **10 times**
- Body sizes (chars): **1316, 70, 2728, 51, 1105, 135, 108, 150, 74, 431**
- Median body size: **143 chars** (most are hook tests, smoke tests, "애국가" trivia)
- Only 3 calls had substantive analytical content (1316, 2728, 1105)
- Max body: **2,728 chars**

**Implication:** Even with SAGOL active in a dogfood environment, the user rarely invoked write_report on truly large analyses. The stripped bodies are, in aggregate, a small fraction of the session's total bytes.

## 5. Finding C — Case 1 Pilot Verdict

**Setup:** 146K-char filler (real ezplanet session prefix) + synthetic 3,232-char auth-architecture review + topic-independent DatePicker timezone bug follow-up. Full vs stripped variant (placeholder 261 chars). Reduction: 2% of total context.

**Results (summary; full detail in `case1_verdict.md`):**

| Dimension | Full | Stripped |
|-----------|------|----------|
| Response length | 3,710 chars | 2,939 chars |
| Subagent tool_uses | 8 | 15 |
| Subagent total_tokens | 31,108 | 82,969 |
| Root causes diagnosed | 3 (same quality) | 3 (same quality) |
| Fix proposals | 5 | 3 + Provider memoization note |
| Unique catch | UTC-storage pattern explicit | TzContext Provider `value` memoization |

**Qualitative verdict (self-judge, bias-flagged):** Both competent, rough parity. Full is slightly more comprehensive; stripped surfaces one subtle concern (Provider memoization) that full omits. Neither dominates.

## 6. Finding D — Unexpected Second-Order Effect

**The stripped subagent used 2.7× more tokens and ~2× more tool calls than the full subagent**, despite having a smaller input context.

Hypothesized mechanism: when the detailed report body is absent from context, the model compensates by **doing more file exploration / searches** to recover the missing detail. This partially (possibly fully) offsets the token savings from stripping.

Caveat: N=1 observation. Could be noise. But it is a *qualitatively novel* behavior worth naming: **"recovery exploration" as a hidden cost of stripping.**

If this reproduces, it meaningfully changes the cost-benefit math for claim (A) — stripping might break even or lose on tokens once downstream exploration is counted.

## 7. Finding E — Operational Reliability Issue

During this benchmark session, the `mcp__sagol__write_report` tool **failed twice** with `H.reduce is not a function` — a runtime error in the SAGOL MCP server itself. The v1 app has a live defect that surfaced under normal usage. See separate todo: `.planning/todos/pending/debug-write-report-mcp-h-reduce.md`.

## 8. Interpretation

Per the user's own hypothesis ("effect only visible >200K, likely >300K"), Case 1 at ~150K with 2% reduction is in the *expected-null-effect* zone. The neutral result is **consistent with** the user hypothesis, but is **not** direct evidence for it — a neutral result at 150K is consistent with both "theory right, this is below threshold" AND "theory wrong, no effect anywhere."

However, Findings A, B, D together suggest the **theory may be correctly directional but practically weak for Claude Code agent usage:**

- **A:** SAGOL targets 3% of context bytes. Even perfect stripping of that 3% cannot relieve pressure from the 73% (tool_result) that drives actual long-context pain.
- **B:** Organic write_report usage is sparse and small-bodied; the gap between "theoretical maximum stripping" and "realized stripping" is wide.
- **D:** Stripping may trigger compensatory exploration that erases token savings.

## 9. What would change the verdict

If any of the following hold, the pessimistic reading is wrong:

1. **User is willing to change usage habits** — write_report on every analytical response (not just explicit requests), driving usage toward 30-50 calls per long session with 5-10K bodies each. At that intensity, stripping yields ~10% context reduction, large enough to matter at 300K+.
2. **Effect at 300K+ is nonlinear and large** — stripping even 3-5% of bytes in a stressed-context regime may matter disproportionately (Lost-in-the-Middle style). Case 1 at 150K cannot detect this.
3. **Recovery exploration (Finding D) is reproducible** — if confirmed, flip it: stripping is net-negative on tokens but possibly net-positive on *reasoning clarity* (the agent is forced to reload only what it needs). Requires different metric to detect.

## 10. Three decision paths (see decision todo)

- **Kill v1** — current design targets 3% of bloat; ROI insufficient. Archive as learning artifact.
- **Pivot target** — redesign to strip `tool_result` outputs (the 73%). Different hook (PostToolUse on Read/Grep/WebFetch/Bash), different semantics (time-decay summarization of old tool outputs). v1 code mostly throwaway.
- **Scope narrow** — SAGOL retained for chat/advisory mode where long assistant text is normal. Claude Code integration abandoned. Usable but small TAM.

## 11. What this session did NOT establish

- Effect at 300K+ (no material exists; would require synthetic splicing or new long sessions)
- Effect at high-intensity write_report usage (user's actual habit is sparse)
- Whether the "recovery exploration" finding is N=1 noise or reproducible
- LLM-as-judge evaluation — used self-judge throughout, demand-limits confidence

## 12. Stage 2 prerequisites (if triggered)

Any of the decision paths involving continuation require, at minimum:
- External judge (GPT-4o or Claude Sonnet) — self-judge isn't credible beyond pilot
- N=10-30 cases stratified by context length (small/mid/extreme) and followup type (independent/reference/detail)
- Automated pipeline — manual per-case work doesn't scale
- Anthropic SDK use for subagent generation (PROJECT.md forbids SDK in app but benchmark scripts are outside the app scope)
