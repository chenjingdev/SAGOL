# Roadmap: SAGOL (사골)

## Overview

SAGOL is a hypothesis-validation rig disguised as a tool. The roadmap is organized as four risk-driven phases that walk a straight line from "can we even fire the kill-switch?" (Phase 0) through "does the hypothesis mechanism work at all?" (Phase 1), "can a human inspect and steer it?" (Phase 2), to "did SWE-bench Pro say continue or kill?" (Phase 3). Every phase is gated: if its exit criterion fails, downstream phases are waste. Phase 0 is deliberately unmerged from Phase 1 because its entire purpose is to let the project die on Day 1 if the mechanism or the benchmark is already broken — without the leakage canary and noise-sensitivity gate, the kill-switch in Phase 3 is silently inoperable.

## Phases

**Phase Numbering:**
- Integer phases (0, 1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [x] **Phase 0: Pre-flight gates** - Closed with caveat on 2026-04-15 (canary RED in headless mode, kill-switch overridden by user pivot)
- [ ] **Phase 1: Stripping path** - Prove report bodies never reach the main agent's context **(interactive mode only)**
- [ ] **Phase 2: Dashboard + bidirectional feedback** - Human inspection surface + caveman lift finalized
- [ ] **Phase 3: Benchmark (method TBD)** - Redesigned after Phases 1 and 2 complete

## Phase Details

### Phase 0: Pre-flight gates — CLOSED WITH CAVEAT (2026-04-15)
**Goal (original)**: Prove on Day 1 that the stripping mechanism is architecturally viable AND the chosen benchmark is sensitive to context noise — otherwise kill or switch benchmark before any real build work.
**Outcome**: The Day-1 leakage canary fired RED on all three rescue attempts. Root cause identified: **`claude -p` headless mode does not load project-local `PostToolUse` hooks** on Claude Code 2.1.108 (see `.planning/research/HEADLESS_HOOK_LIMITATION.md`). Per KILL_SWITCH.md strict reading, this would end v1. User explicitly **overrode the Day-1 kill ceremony** ("벤치는 다른방법으로 할테니 앱부터 완성해보자") and elected to:
  - Close Phase 0 with a documented limitation instead of killing the project.
  - Narrow Phase 1 to **interactive mode only**.
  - Defer Phase 3 entirely — the SWE-bench Pro harness is abandoned; a new benchmark method will be proposed after Phases 1 and 2 complete.
**Depends on**: Nothing (first phase)
**Requirements**: GATE-01 ✓ (committed, not chmod-locked), GATE-02 ✗ (failed, override), GATE-03 ✓ (dry-run green in 00-02), GATE-04 ✓ (committed, not chmod-locked), GATE-05 ✗ (superseded by override)
**Plans**: 3 plans
- [x] 00-01-PLAN.md — Tree hygiene: verify existing Phase 0 skeleton, create project-local .claude/settings.json, run bun install
- [x] 00-02-PLAN.md — Missing scripts (canary/noise-gate/doctor/pinned-hash) + lock in PINNED_VERSIONS.md
- [x] 00-03-PLAN.md — Live leakage canary fire (RED ×3) + rescue diagnosis + Phase 0 close-out
**Artifacts:**
- `.planning/phases/00-pre-flight-gates/00-CANARY-RESULT.md` — full per-run verdict
- `.planning/research/HEADLESS_HOOK_LIMITATION.md` — architectural finding + revival conditions
- `.planning/phases/00-pre-flight-gates/00-03-SUMMARY.md` — plan outcome + lessons

### Phase 1: Stripping path (interactive mode only)
**Goal**: Prove the hypothesis mechanism works end-to-end **in a live interactive Claude Code session** — sub-agent reports funnel through `sagol_write_report`, get captured to disk, and are replaced in the main agent's context with a ≤200-token stripped form via `PostToolUse` + `updatedMCPToolOutput`, with zero body text leaking upstream. **Headless `claude -p` support is explicitly out of scope** per the Phase 0 architectural finding.
**Pre-task 0 (HARD GATE)**: In this very Claude Code session (or a comparable interactive session), call `mcp__sagol__write_report` via the Skill/Task tool and verify that (a) the tool fires, (b) a report file appears under `.sagol/reports/`, AND (c) the tool_response the parent agent sees is the `[report:<id>] <title>\n<summary>` stripped form, not the full body. If this pre-task fails, the entire project is architecturally dead and kill becomes the only remaining option — escalate to user immediately.
**Depends on**: Phase 0
**Requirements**: INST-01, INST-02, CAP-01, CAP-02, CAP-03, CAP-04, CAP-05
**Success Criteria** (what must be TRUE):
  1. A user installs SAGOL into Claude Code with a single command and `bunx sagol doctor` shows hook registered, MCP server reachable, and Skill discoverable all green.
  2. A sub-agent calling `sagol_write_report` produces a markdown file at `.sagol/reports/<id>.md` with frontmatter (id/title/source/timestamp/summary).
  3. 5 concurrent sub-agents each write a report and the parent agent's conversation transcript contains **zero lines** of any report body — only `[report:<id>] <title>\n<summary>` stripped forms — verified by the automated leakage canary.
  4. The ≤200-token summary is derived in-session from frontmatter `summary` or a naive first-paragraph extract — no `@anthropic-ai/sdk` calls anywhere in the code path.
  5. `grep -r "caveman\|compressed\|telegraphic\|er/" .` returns **0 hits** and the caveman lift stays ≤200 LOC across `compiler.ts` + `context.ts` + slim `watcher.ts`.
**Plans**: TBD

### Phase 2: Dashboard + bidirectional feedback
**Goal**: A human can open a local browser dashboard, watch reports stream in live, click through them with nice markdown rendering, and submit approve/reject/revise feedback that the blocked agent consumes as the result of `sagol_await_feedback` — all without a single eval-mode run ever touching the dashboard code path.
**Depends on**: Phase 1
**Requirements**: DASH-01, DASH-02, DASH-03, DASH-04, DASH-05, FB-01, FB-02, FB-03, FB-04, FB-05
**Success Criteria** (what must be TRUE):
  1. `bunx sagol dash` starts a `Bun.serve` server on `127.0.0.1` at a random free port and prints a per-session URL token on stderr; the URL opens a dashboard that lists every report in `.sagol/reports/` and pushes new ones live over WebSocket with markdown-it + highlight.js rendering.
  2. A user submitting approve/reject/revise from the dashboard causes the agent's in-flight `sagol_await_feedback` call to resolve with that feedback as the tool result, within one round trip; a 10-minute timeout falls back to `"(no feedback — proceed)"`; duplicate submits dedupe by action_id; tab re-focus re-syncs from server-authoritative state.
  3. An off-host `curl` to the dashboard port is rejected (bound to `127.0.0.1` + URL token check) — confirmed by a negative test.
  4. The end-to-end smoke runs: sub-agent writes report → dashboard shows it → user submits feedback → agent consumes feedback → task continues, all in one session.
  5. Eval/benchmark mode automatically bypasses `sagol_await_feedback` (immediate `"(no feedback — proceed)"`) and the eval runner never imports any dashboard module — verified at the code-path level.
**Plans**: TBD
**UI hint**: yes

### Phase 3: Benchmark (method TBD — redesigned)
**Status**: Deferred on 2026-04-15. Original SWE-bench Pro harness abandoned because `claude -p` headless mode does not load the stripping hook (see `HEADLESS_HOOK_LIMITATION.md`). User will propose a new benchmark approach after Phase 1 and Phase 2 are complete. This section is kept as a placeholder and will be rewritten.
**Original Goal (archived)**: Fire the kill-switch. Run baseline vs SAGOL interleaved on SWE-bench Pro through a ≤300 LOC `bunx sagol eval` harness that spawns the Python harness out-of-process, write `SPIKE-RESULTS.md` + bilingual README, and commit the one-sentence verdict on the dated kill ceremony — continue or kill.
**Depends on**: Phase 1 (Phase 2 may run in calendar parallel with the baseline branch of Phase 3)
**Requirements**: EVAL-01, EVAL-02, EVAL-03, EVAL-04, EVAL-05, EVAL-06, EVAL-07, DOC-01, DOC-02, DOC-03
**Success Criteria** (what must be TRUE):
  1. `bunx sagol eval --mode {baseline|sagol} --tasks N` runs standalone (no dashboard imports) and spawns `claude -p --bare --mcp-config <pinned>` + `python -m swebench.harness.run_evaluation` via `Bun.spawn`, writing per-task `{task_success, total_tokens, cache_creation_input_tokens, cache_read_input_tokens, wall_ms}` rows to `.sagol/eval.sqlite`.
  2. Baseline and SAGOL conditions run interleaved on SWE-bench Pro (primary) with the same task set, same model, same day, 3 runs per condition, random seeds recorded; SWE-bench Verified is used only as a contamination-aware smoke set.
  3. `bunx sagol eval report` produces a markdown diff showing per-task delta, variance (IQR/std), sample size, and contamination warnings — enough to support a one-sentence verdict.
  4. The eval harness stays ≤300 LOC (hard cap) and a `grep` for dashboard imports returns 0 hits inside `src/eval/`.
  5. On the dated kill ceremony day, exactly one of the two commits lands: (a) `SPIKE-RESULTS.md` with a one-sentence "계속" or "폐기" verdict + bilingual README stating current status, OR (b) an automatic-failure commit because a verdict could not be produced — and this commit defines the v1 milestone close.
**Plans**: TBD

## Progress

**Execution Order:**
Phases execute in numeric order: 0 → 1 → 2 → 3
(Phase 2 and the baseline branch of Phase 3 may overlap in calendar time, but Phase 2 exit gate must land before Phase 3's SAGOL-mode runs.)

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 0. Pre-flight gates | 3/3 | **Closed with caveat** (canary RED, kill overridden by user pivot) | 2026-04-15 |
| 1. Stripping path (interactive) | 0/TBD | Not started | - |
| 2. Dashboard + feedback | 0/TBD | Not started | - |
| 3. Benchmark (method TBD) | — | **Deferred — will be redesigned after Phase 1/2** | - |
