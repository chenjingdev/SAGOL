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
**Goal**: Prove the SAGOL stripping mechanism works end-to-end **in a live interactive Claude Code session** — sub-agent reports funnel through `mcp__sagol__write_report`, get captured to disk, and are replaced in the main agent's context with a ≤200-char stripped form (`[report:<id>] <title>\n<summary>\n\n(full body: …)`) with zero body text leaking upstream.

**Architecture note (2026-04-15 HARD GATE pivot):** The Phase 1 HARD GATE pre-task fired live inside an interactive CC session and confirmed that project-local `PostToolUse` hooks do not fire in interactive mode either (not just headless). Phase 1 therefore adopts **server-side stripping** (D-10): the `handleWriteReport` handler in `src/mcp/server.ts` returns the stripped form directly, no hook involved. The hook path (`scripts/strip-report.ts`) is preserved dormant for future CC versions that fix project-local hook loading. See `.planning/phases/01-stripping-path-interactive-mode-only/01-CONTEXT.md` D-10 and `.planning/research/HEADLESS_HOOK_LIMITATION.md`.

**Pre-task 0 (HARD GATE)**: ✅ FIRED AND RESOLVED 2026-04-15 via D-10 server-side pivot. Direct-import verification (`bun run scripts/verify-server-strip.ts`) is GREEN. Live CC round-trip re-verification requires a session restart and is the first task of the first Phase 1 plan.

**Depends on**: Phase 0
**Requirements**: INST-01, INST-02, CAP-01, CAP-02, CAP-03, CAP-04, CAP-05
**Success Criteria** (what must be TRUE):
  1. A user can attach SAGOL to a Claude Code project with a minimal `bunx sagol init` one-liner and `bunx sagol doctor` shows MCP server reachable, `.mcp.json` + `enabledMcpjsonServers` wired, and verify-server-strip GREEN.
  2. A sub-agent calling `mcp__sagol__write_report` produces a markdown file at `.sagol/reports/<id>.md` with frontmatter (id/title/source/timestamp/summary), and the tool response observed by the parent agent is the stripped form only.
  3. 5 concurrent sub-agents each write a report and the parent agent's conversation transcript contains **zero lines** of any report body — only stripped forms — verified by a reproducible leakage-check fixture (see CONTEXT.md D-11) that parses the session transcript JSONL.
  4. The ≤200-token summary is derived in-session from frontmatter `summary` field or a naive first-paragraph extract — no `@anthropic-ai/sdk` calls anywhere in the code path.
  5. The live CC round-trip HARD GATE re-verification is logged in `.planning/phases/01-stripping-path-interactive-mode-only/01-LIVE-HARDGATE.md` with timestamp, CC version, and the observed stripped tool response (canary-free). Caveman lift is **out of scope for Phase 1** and deferred to Phase 2 per CONTEXT.md D-12.
**Plans**: 4 plans (originally 5; `01-03` dropped per D-17 as v2-scope distribution work). Execution was consolidated via the D-17 scope cut and executed directly — the authoritative execution record is `01-SUMMARY.md` (commit `2b3f171`), not per-plan `*-SUMMARY.md` files.
- [x] 01-01 — `deriveSummary` exported + `bun test` unit suite (11 tests GREEN) — commit `9be5bdc`. Live HARD GATE human ceremony downgraded to opportunistic per D-17.
- [x] 01-02 — `scripts/leak-check.ts` end-of-session transcript audit (replaces the 5-subagent concurrent fixture ceremony per D-17) — commit `9fd42c5`
- [~] 01-03 — DROPPED (bunx sagol init CLI is v2 distribution scope per D-17)
- [x] 01-04 — Extended `scripts/doctor.ts` (24 checks incl. MCP spawn+initialize handshake smoke) — commit `6c08c47`
- [x] 01-05 — `README.md` with D-10 architecture note + dev commands (install guide omitted per D-17) — commit `82a807b`
**Exit artifacts:**
- `.planning/phases/01-stripping-path-interactive-mode-only/01-SUMMARY.md` — Phase 1 execution record + requirement coverage table
- `.planning/phases/01-stripping-path-interactive-mode-only/01-CONTEXT.md` — D-10 through D-18 (D-17/D-18 added after scope cut)
- `src/mcp/server.ts`, `tests/mcp-server.test.ts`, `scripts/verify-server-strip.ts`, `scripts/leak-check.ts`, `scripts/doctor.ts` (extended), `README.md`

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
**Plans**: Phase 2 was executed via the D-28 direct-execution mode (no per-plan files). Authoritative execution record is `02-SUMMARY.md`. See also `02-CONTEXT.md` for the D-20 through D-28 design decisions.
**Exit artifacts:**
- `.planning/phases/02-dashboard-bidirectional-feedback/02-SUMMARY.md` — execution record + requirement coverage table (DASH-01..05, FB-01..05)
- `.planning/phases/02-dashboard-bidirectional-feedback/02-CONTEXT.md` — D-20 through D-28
- `src/dash/` (compiler.ts, context.ts, watcher.ts, server.ts, html.ts), `src/mcp/server.ts` (+ `await_feedback` tool), `scripts/dash.ts`, `scripts/verify-dash-e2e.ts`, `tests/dash.test.ts`, `scripts/doctor.ts` (extended)
**UI hint**: yes (dashboard shipped via Preact + HTM + import map, no build step per STACK.md + D-27)

## Progress

**Execution Order:**
Phases execute in numeric order: 0 → 1 → 2. Manual benchmark session runs post-Phase 2 as a methodology exercise, not a new phase.

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 0. Pre-flight gates | 3/3 | **Closed with caveat** (canary RED, kill overridden by user pivot) | 2026-04-15 |
| 1. Stripping path (interactive) | 4/4 + 1 dropped | **Complete** (server-side stripping live, doctor GREEN, 11 unit tests, leak-check) | 2026-04-15 |
| 2. Dashboard + feedback | direct-execution (D-28) | **Complete** (Bun.serve dashboard + WebSocket push + await_feedback round-trip + benchmark-mode bypass; 20 unit tests, 3-scenario e2e) | 2026-04-15 |
| Post-v1: Manual benchmark session | — | **Scheduled after Phase 2 exit** (methodology only, no code phase) | - |
