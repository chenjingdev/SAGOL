# Roadmap: SAGOL (사골)

## Overview

SAGOL v1 is an **app-first build**. The original kill-switch-first framing (Phase 0 → automated SWE-bench Pro harness → Day-1 verdict) died on 2026-04-15 when Phase 0 surfaced an architectural blocker: `claude -p` headless mode does not load project-local `PostToolUse` hooks on Claude Code 2.1.108 (see `.planning/research/HEADLESS_HOOK_LIMITATION.md`). Rather than kill the project, we pivoted: build the working tool first (Phase 1 stripping mechanism in interactive mode, Phase 2 dashboard + bidirectional feedback), then decide whether the hypothesis holds using a **manual benchmark session** — small-N interactive runs where a human compares baseline vs SAGOL transcripts (and optionally hand-edits a baseline transcript to simulate stripping) — to be scheduled immediately after Phase 2 exits. No third code phase is planned; the benchmark is a methodology applied to the finished tool, not a new milestone.

The preserved research in `.planning/research/` (STACK, ARCHITECTURE, KILL_SWITCH, PITFALLS, HEADLESS_HOOK_LIMITATION, SUMMARY, FEATURES, PINNED_VERSIONS) stays intact and informs both the app build and the post-Phase-2 benchmark methodology.

## Phases

**Phase Numbering:**
- Integer phases (0, 1, 2): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [x] **Phase 0: Pre-flight gates** - Closed with caveat on 2026-04-15 (canary RED in headless mode, kill-switch overridden by user pivot)
- [ ] **Phase 1: Stripping path** - Prove report bodies never reach the main agent's context **(interactive mode only)**
- [ ] **Phase 2: Dashboard + bidirectional feedback** - Human inspection surface + caveman lift finalized; post-exit: manual benchmark session

## Phase Details

### Phase 0: Pre-flight gates — CLOSED WITH CAVEAT (2026-04-15)
**Goal (original)**: Prove on Day 1 that the stripping mechanism is architecturally viable AND the chosen benchmark is sensitive to context noise — otherwise kill or switch benchmark before any real build work.
**Outcome**: The Day-1 leakage canary fired RED on all three rescue attempts. Root cause identified: **`claude -p` headless mode does not load project-local `PostToolUse` hooks** on Claude Code 2.1.108 (see `.planning/research/HEADLESS_HOOK_LIMITATION.md`). Per KILL_SWITCH.md strict reading, this would end v1. User explicitly **overrode the Day-1 kill ceremony** ("벤치는 다른방법으로 할테니 앱부터 완성해보자") and elected to:
  - Close Phase 0 with a documented limitation instead of killing the project.
  - Narrow Phase 1 to **interactive mode only**.
  - Remove Phase 3 from v1 entirely — the automated SWE-bench Pro harness is abandoned. Benchmarking becomes a **manual session** run after Phase 2 exits: small-N interactive comparisons of baseline vs SAGOL transcripts (optionally with hand-edited transcripts simulating stripping). Methodology reuses the preserved research in `.planning/research/` (STACK, PITFALLS, ARCHITECTURE, etc.) but produces no new code phase.
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
  5. A benchmark-mode toggle (env var or CLI flag) bypasses `sagol_await_feedback` with an immediate `"(no feedback — proceed)"` so that the post-Phase-2 manual benchmark session can run interactive baseline/SAGOL transcripts without human-in-the-loop stalls. No automated eval runner code ships in v1.
**Plans**: TBD
**UI hint**: yes

## Progress

**Execution Order:**
Phases execute in numeric order: 0 → 1 → 2. Manual benchmark session runs post-Phase 2 as a methodology exercise, not a new phase.

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 0. Pre-flight gates | 3/3 | **Closed with caveat** (canary RED, kill overridden by user pivot) | 2026-04-15 |
| 1. Stripping path (interactive) | 0/TBD | Not started | - |
| 2. Dashboard + feedback | 0/TBD | Not started | - |
| Post-v1: Manual benchmark session | — | **Scheduled after Phase 2 exit** (methodology only, no code phase) | - |
