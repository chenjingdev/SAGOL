---
title: SAGOL v1 — Kill or Pivot Decision
date: 2026-04-16
priority: high
status: pending — awaits user decision
blocks: further SAGOL v1 or v2 work
context: 2026-04-16-sagol-v1-benchmark-findings.md
---

# Decision Needed — SAGOL v1 Future

## Trigger

Stage 1 benchmark (see related note) surfaced three findings that together call the project premise into question:

1. Assistant text is 3.1% of context in real Claude Code agent sessions (v1 targets this)
2. Tool_result is 72.7% of context (v1 does not touch this)
3. Organic write_report usage in dogfood is sparse and small (max 2.7K body, median 143 chars)

Case 1 pilot (150K context, 2% reduction) showed no clear quality signal — consistent with either "user's threshold hypothesis is right" or "theory is weak in practice."

## Three paths

### Path 1 — KILL

- Archive v1 as a learning artifact
- Update PROJECT.md to record the finding
- Close out milestone with a retrospective note
- No further engineering

**When to choose:** If data above is strong enough that "theory may be real but impact is narrow" is acceptable conclusion. Lowest effort.

### Path 2 — PIVOT TARGET

- Redesign: strip `tool_result` outputs (the 73%), not assistant text
- New hook architecture: PostToolUse on Read/Grep/WebFetch/Bash/Glob
- New semantics: time-decayed summarization of old tool outputs (keep recent, compress distant)
- v1 code largely obsolete — retain only MCP scaffolding and dashboard
- Requires new Phase 3+ design

**When to choose:** If the *mechanism* (context pruning helps) is what you believe in, and you accept that the *target* was wrong. Highest potential impact.

### Path 3 — SCOPE NARROW

- Retain v1 for chat/advisory mode (long assistant responses *do* occur there)
- Abandon Claude Code agent integration as primary use case
- Reposition as "review/writeup workflow tool" not "agent optimizer"
- Minor follow-up work: doc how to use, what modes benefit

**When to choose:** If you believe the theory holds for the *non-agent* regime and are OK with smaller addressable use case. Minimum sunk-cost path that still keeps v1 alive.

## Decision criteria

Ask yourself:

1. **Do you believe the theory is directionally right even if realized impact is small?** If yes → Path 2 (pivot to the right target) or Path 3 (narrow scope).
2. **Do you believe the benchmark evidence is sufficient?** If yes and theory looks weak → Path 1. If not → require Stage 2 proper benchmark before deciding (which is itself a ~1 week investment).
3. **How much further engineering budget are you willing to spend?** Path 2 is big (new design), Path 3 is small, Path 1 is zero.

## Recommendation (not prescriptive)

Based on the structural data (Finding A: 3% vs 73%), **Path 2 is the most intellectually honest continuation if you still believe in the mechanism.** SAGOL's core insight ("pruning stale context helps") is plausible; the implementation just points at the wrong 3% of context.

However, Path 2 requires admitting that most of v1 is throwaway, which is emotionally and operationally expensive. Path 1 is cleaner if the current evidence is enough for you.

Path 3 is a soft middle ground but risks becoming a never-finished side-project.

## Related work

- [2026-04-16 benchmark findings note](../../notes/2026-04-16-sagol-v1-benchmark-findings.md)
- [Stage 1 Case 1 verdict](../../research/bench-stage1/case1_verdict.md)
- [HEADLESS_HOOK_LIMITATION.md](../../research/HEADLESS_HOOK_LIMITATION.md)
- [PROJECT.md](../../PROJECT.md)

## Pending user decision

Choose one of: Path 1 / Path 2 / Path 3 / "Stage 2 full benchmark before deciding" / "Different direction I haven't considered"
