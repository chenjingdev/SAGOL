# Project Research Summary

**Project:** SAGOL (사골)
**Domain:** Claude Code Skill/MCP — agent report router + context hygiene tool + SWE-bench-gated Spike
**Researched:** 2026-04-14
**Confidence:** HIGH (stack, architecture, pitfalls all converged on same constraint set; one conflict reconciled in favor of stronger 2026 evidence)

## Core Value (verbatim from PROJECT.md)

> **보고서 분리 패턴이 컨텍스트 오염을 측정 가능한 만큼 줄이고 그게 SWE-bench류 평가에서 baseline 대비 성능 향상으로 이어진다는 가설을, 가장 작은 동작 도구 + 가장 작은 평가 인프라로 빠르게 검증한다.**
>
> 이 검증이 실패하면(향상 없음/미미함) 프로젝트는 폐기한다. 도구의 완성도나 UX는 이 검증을 위한 수단이다.

## Executive Summary

SAGOL is a **hypothesis-validation rig disguised as a tool.** The entire build exists to answer one question — "does separating sub-agent report bodies from main context measurably improve SWE-bench performance?" — inside a 1–2 week Spike with a pre-committed dated kill ceremony. Every feature that doesn't move the kill-switch needle is explicit anti-feature. Research across stack, features, architecture and pitfalls converged independently on the same non-negotiable constraint: **Claude Code hooks can only mutate MCP tool output via `updatedMCPToolOutput`** — Bash/Read/Write/Edit/Grep outputs and assistant transcripts are architecturally immutable. This single fact forces the entire SAGOL data path to funnel through one MCP tool (`sagol_write_report`); any alternate capture mechanism is dead on arrival.

The recommended build is a **single Bun process** hosting (a) an MCP server (stdio) with two load-bearing tools — `sagol_write_report` (writes markdown, returns full body for the hook to strip) and `sagol_await_feedback({reportId})` (blocking promise the dashboard resolves) — (b) a local HTTP + WebSocket dashboard lifted in spirit from caveman-report but rewritten on `Bun.serve`, and (c) an **out-of-process** eval runner that shells out to `python -m swebench.harness.run_evaluation` via `Bun.spawn`. Summarization stays **inside** the Claude Code session (scoped subagent), never via `@anthropic-ai/sdk`, so that the Spike measures exactly the variable it claims to measure.

Key risks and mitigations: (1) **stripping may not be replaceable for non-MCP outputs** → enforce MCP funnel + prove feasibility on Day 1–2; (2) **the chosen benchmark may be contaminated or insensitive to context noise** → use SWE-bench Pro as primary, add a Phase 0 noise-sensitivity gate before any real run; (3) **caveman-report lift temptation** → ≤200 LOC hard cap, file whitelist, grep audit; (4) **"just one more feature" scope rot** → dated kill ceremony (2026-04-28) and daily "did the benchmark run today?" check from Day 1.

## Key Findings

### Recommended Stack

Single-process Bun + TypeScript monolith, near-zero npm surface. Official MCP TS SDK for the tool layer; direct lift of caveman's markdown/frontmatter libs; everything else is Bun-native.

**Core technologies:**
- **Bun 1.3.12 + TypeScript** — native `Bun.serve` (HTTP+WS in one primitive), `bun:sqlite`, `Bun.spawn`; removes 4+ caveman deps by design
- **`@modelcontextprotocol/sdk` ^1.29.0** — exposes `sagol_write_report`, `sagol_await_feedback`, `sagol_list_reports` over stdio; the only supported funnel for stripping
- **`gray-matter` + `markdown-it` + `highlight.js`** — direct lift from caveman `compiler.js`/`context.js`; pure JS, Bun-compatible, theme continuity for free
- **Preact + HTM via import map** (no build step) — ships `public/index.html` served directly by `Bun.serve`; zero bundler in Spike
- **`swebench` PyPI 2.1.x + OrbStack/Docker** — invoked via `Bun.spawn` from an out-of-process `bunx sagol eval`; filesystem-boundary IPC only, never live pipes
- **Explicitly NOT used:** `@anthropic-ai/sdk` (invalidates the measurement), `express`/`ws`/`chokidar`/`better-sqlite3` (Bun natives replace them), MCP Apps SDK (dashboard must be external browser, not in-chat iframe)

### Expected Features (Spike v1 table stakes — F1–F13)

Drawn from FEATURES.md. Every item is gated on "without this, the kill-switch cannot fire or cannot be trusted." F6 is the only formal-slip candidate.

**Must have (Spike kill-switch bundle):**
- **F1 — Skill + MCP install into Claude Code** — foundation; nothing fires without it
- **F2 — Report capture via `sagol_write_report` MCP tool** — the one legal funnel for captured content
- **F3 — Context stripping via `PostToolUse` hook using `updatedMCPToolOutput`** — THE hypothesis mechanism
- **F4 — ≤200-token summary** (naive first-paragraph / frontmatter `summary`; no LLM call in v1)
- **F5 — Local HTTP+WS dashboard** (list + render + live update) on `127.0.0.1` only
- **F6 — Bidirectional approve/reject/revise** via **blocking `sagol_await_feedback` MCP tool** (P1 target; formal P2 slip allowed — benchmark must auto-bypass it)
- **F7 — `bunx sagol eval` SWE-bench wrapper** (baseline vs sagol mode, same task set, interleaved)
- **F8 — Baseline-vs-sagol diff report** (markdown, per-task delta, variance-aware)
- **F9 — Frontmatter schema** (id / title / source / timestamp / summary) — no type taxonomy
- **F10 — Markdown rendering** (markdown-it + highlight.js, lifted)
- **F11 — Flat `.sagol/reports/*.md` persistence** — no DB
- **F12 — Spike runbook + decision rubric** — without it, the verdict is hand-wavy
- **F13 — README ko/en bilingual** — write-up is part of the Spike deliverable

**Should have (defer if week 1 slips):**
- F6 bidirectional loop — high differentiator but orthogonal to the SWE-bench number; benchmark must run without it

**Defer (v1.x / v2+):**
- Haiku-generated summaries, report type taxonomy, MCP Apps in-chat preview, multi-host (Codex/Cursor), OpenTelemetry, full SWE-bench (not subset), npm publish, multi-user / cloud sync, KV cache forensics re-integration

### Architecture Approach — Decisions (not options)

Single Bun process. Four isolable modules inside one repo. Two patterns are load-bearing and are stated here as **decisions**, not options:

**DECISION — Stripping mechanism: MCP tool + `PostToolUse` hook with `updatedMCPToolOutput`.**
`sagol_write_report` writes the full markdown to `.sagol/reports/<id>.md` and returns the full body. A `PostToolUse` hook with `matcher: "mcp__sagol__write_report"` parses the frontmatter and returns `{ hookSpecificOutput: { updatedMCPToolOutput: { content: [{ type: "text", text: "[report:<id>] <title>\n<summary>" }] } } }`. The main agent only ever sees the stripped version going forward. This is the **only** officially supported Claude Code mechanism that can deterministically replace what the agent sees — Bash/Read/Write/Edit outputs are immutable, and `SubagentStop` only supports `block`, not replace. **R3 must prove this prototype Day 1–2 before any other work starts** (feasibility risk: SubAgent output may be block-only, narrowing blast radius).

**DECISION — Browser ↔ Terminal sync: blocking MCP tool (`sagol_await_feedback`).**
The agent calls `sagol_await_feedback({reportId})`. The MCP server registers an in-process Promise waiter keyed by `reportId`. The dashboard's `POST /api/feedback` (or WS message) resolves the Promise. The tool return value becomes the user's feedback in the agent's tool_result. No transcript injection, no named pipes, no `UserPromptSubmit` hacks. Works identically in interactive TUI and headless `claude -p`. Default timeout 10 min → `"(no feedback — proceed)"`. Benchmark mode must bypass this entirely.

**Major components (one Bun process):**
1. **`src/mcp/` — MCP server** — tool handlers, in-process event emitter, waiter registry
2. **`src/store/` — report-store** — `compiler.ts` / `context.ts` / `frontmatter.ts` (direct lift from caveman, TS port, ≤200 LOC total)
3. **`src/dashboard/` — dashboard server** — `Bun.serve({ fetch, websocket })` bound to `127.0.0.1`, SPA shell + `/api/reports` + `/api/report/:id` + `/api/feedback` + `/ws` (rewritten, NOT lifted from `server.js`)
4. **`src/eval/` — eval runner** — `bunx sagol eval {baseline|sagol}`, spawns `claude -p --bare --mcp-config` and `python -m swebench.harness.run_evaluation`, filesystem-boundary IPC only. **Not an MCP tool** — driven from the host shell so eval runs in a clean context.

**caveman-report lift budget (HARD CAP ≤200 LOC, file whitelist only):**
- LIFT: `watcher.js` (57 LOC, debounce kept), `compiler.js` (46 LOC, drop `REQUIRED_H2_COUNTS`), `context.js` (43 LOC, frontmatter→index only)
- DO NOT LIFT: `server.js` (rewrite on `Bun.serve`), `prompts/er.md`, `er/` trigger UX, `GUIDE_I18N` copy, section-type taxonomy, theme machinery. Phase 1 exit criterion: `grep -r "caveman\|compressed\|telegraphic\|er/" .` returns **zero** hits.

### Critical Pitfalls (top 5, one-line prevention each)

1. **Concept contamination** (caveman's death cause — fused compression + separation) — lock a single-variable one-line hypothesis in Phase 0; every creeping feature goes to Out of Scope, not the Spike.
2. **Fake architectural stripping** (hooks can't mutate assistant text or non-MCP tool output) — enforce the MCP funnel; prove via **Day 1 leakage canary** (random 128-bit token in a report body; grep the next API request payload to confirm the body never reaches the API — if it does, project dies Day 1).
3. **Kill-switch that can't fire** (too-small sample, contaminated benchmark, baseline drift, motivated stopping) — pre-register exact thresholds in `KILL_SWITCH.md` pre-Phase-0; SWE-bench Pro primary + contamination-aware Verified smoke; interleave baseline/sagol in same session/day/model version; 3 runs per condition with variance reported.
4. **Spike calendar rot** (polish becomes denial) — dated kill ceremony committed pre-code (e.g., 2026-04-28); daily "did the benchmark run today?" check from Day 1; walking-skeleton-first, polish-never.
5. **Tool works but benchmark insensitive** (SWE-bench Verified's short-context tasks may not react to context pollution at all) — **Phase 0 noise-sensitivity gate**: inject 10k tokens of garbage into one long-horizon task, verify baseline degrades; if not, the hypothesis is unobservable on that benchmark and we switch before running real experiments.

## Pre-registered Kill-Switch

**Benchmark choice — DECISION:** **SWE-bench Pro as the primary headline number**, SWE-bench Verified kept only as a small contamination-aware smoke set. (Conflict reconciled: STACK.md recommended Verified as "official quickstart"; PITFALLS.md surfaced 2026 contamination evidence that Opus 4.5 / GPT-5.2 / Gemini 3 Flash reproduce verbatim patches on Verified. Pitfalls has stronger 2026 evidence — Pro wins; document the choice as a Key Decision in PROJECT.md.)

**Noise-sensitivity gate (Phase 0 prerequisite):** Inject 10k tokens of garbage into a baseline long-horizon task. Verify baseline performance degrades measurably. If it doesn't, the chosen benchmark is insensitive to context noise and SAGOL's hypothesis is unobservable on it — switch benchmark *before* touching eval infra. **This gate runs before any real experiment.**

**Day 1 leakage canary:** A random 128-bit token written into a SAGOL report body. The next API request payload is grepped to confirm the report body never reaches the API. Runs on Day 1. **If this fails on Day 1, the project dies on Day 1. That is the design.** The canary runs again on every Claude Code version bump.

**Dated kill ceremony:** Pre-commit a calendar date (placeholder: **2026-04-28**, user to confirm). On that date one of two outcomes is binding: (a) the kill-switch comparison has run and produces a verdict, or (b) the project is automatically declared failed because it couldn't even produce a verdict. No third option. Scope additions must be paired with deletions (`.planning/PHASE_BUDGET.md`).

**Kill thresholds (placeholder — USER TO CONFIRM in Phase 0 `KILL_SWITCH.md`):**
- `task_success` delta: kill if < **+3%** at n ≥ 100 per condition, 3 runs with variance reported
- `total_tokens` delta: kill if > **+0%** (SAGOL must not be net-negative on tokens)
- `cache_stability`: kill if SAGOL `cache_creation_input_tokens` thrashes > baseline by any measurable margin
- Pass criterion: improvement on **at least one** of {success, tokens, cache} AND no regression on the others beyond the thresholds
- **Numbers above are placeholders. User confirms or replaces in Phase 0 — file is immutable after that.**

**Measurement discipline:**
- Both conditions within the same Claude Code process lifetime where possible
- Pinned Claude Code version + pinned Bun version logged in every result's metadata
- Model version string recorded per row (`claude-opus-4-6[1m]` etc.)
- Log `task_success` + `total_tokens` + `cache_creation_input_tokens` + `cache_read_input_tokens` per task, always
- Pre-registered interpretation template — no post-hoc slicing, no "look at the hard tasks" rescue

## Implications for Roadmap (Coarse — 4 Phases)

Risk-driven. Phase 0 exists because without it the whole comparison is either unobservable or meaningless.

### Phase 0 — Pre-flight gates
**Rationale:** Kill Day 1 if the mechanism or the benchmark is already broken. Every downstream phase is wasted effort if these gates fail.
**Delivers:** (a) one-line hypothesis + immutable `KILL_SWITCH.md` with dated kill ceremony, (b) Day 1 leakage canary prototype, (c) noise-sensitivity check on the chosen benchmark, (d) SWE-bench Pro chosen as primary, Verified as smoke, (e) pinned Claude Code + Bun versions, (f) `.mcp.json` skeleton proving a bare `sagol_write_report` call round-trips with `updatedMCPToolOutput` stripping.
**Addresses:** Pitfalls 1, 2, 3, 5, 6, 10. R3 feasibility risk.
**Exit gate:** canary passes + noise-sensitivity passes + kill-switch doc committed. If any fails → kill or switch benchmark before Phase 1.

### Phase 1 — Stripping path (MCP tool + hook + summary subagent)
**Rationale:** The hypothesis mechanism. Nothing about dashboards or evals matters if the body still reaches the main context.
**Delivers:** `sagol_write_report` MCP tool (real frontmatter), `strip-report.ts` PostToolUse hook wired via `~/.claude/settings.json`, ≤200-token summary via scoped subagent *inside* the session (no `@anthropic-ai/sdk`), report-store lift (`compiler.ts` + `context.ts` + slim `watcher.ts`) under the 200 LOC budget, grep audit for `caveman|compressed|telegraphic|er/` returning zero.
**Uses:** `@modelcontextprotocol/sdk`, `gray-matter`, `markdown-it`, Bun natives.
**Avoids:** Pitfalls 2, 9. Concept contamination via the grep audit.
**Exit gate:** 5 concurrent sub-agent reports all absent from parent context; `cache_creation_input_tokens` shows the expected delta.

### Phase 2 — Dashboard + bidirectional feedback + caveman lift finalization
**Rationale:** Inspection surface + R5 differentiator. Must not infect the eval path — benchmark bypasses dashboard entirely.
**Delivers:** `Bun.serve` dashboard on `127.0.0.1` with per-session URL token, live WS push on new reports, `sagol_await_feedback` blocking MCP tool with in-process waiter registry and 10-min timeout, feedback form + idempotent approval (action_id dedup) + server-authoritative state on `visibilitychange`, multi-window documented as unsupported.
**Uses:** `Bun.serve({fetch, websocket})`, Preact + HTM import map, in-process EventEmitter bus.
**Avoids:** Pitfall 8. Auto-shutdown 10-min idle explicitly DISABLED for benchmark mode.
**Exit gate:** E2E smoke video — sub-agent writes report → dashboard shows it → user submits feedback → agent consumes feedback → task continues. Off-host `curl` to the dashboard port fails.

### Phase 3 — Eval-runner + SWE-bench Pro comparison + Spike writeup
**Rationale:** The kill-switch itself. Everything else was plumbing.
**Delivers:** `bunx sagol eval {baseline|sagol} --tasks N` wrapping `python -m swebench.harness.run_evaluation` via `Bun.spawn`, filesystem-boundary IPC only, ≤300 LOC hard cap on eval harness, baseline + SAGOL runs **interleaved in the same session**, 3 runs per condition with variance, per-task {success, tokens_in, tokens_out, cache_read, cache_create, wall_ms} logged, `SPIKE-RESULTS.md` + bilingual README + kill/continue decision in one sentence.
**Uses:** `swebench` PyPI 2.1.x, OrbStack/Docker, `claude -p --bare --mcp-config --output-format stream-json`.
**Avoids:** Pitfalls 3, 4, 6, 7, 10. Benchmark runs out-of-process — eval never pollutes its own context.
**Exit gate:** kill-switch verdict written in one sentence; dated kill ceremony honored regardless of polish state.

### Phase Ordering Rationale

- **Phase 0 is not optional.** Day 1 canary + noise-sensitivity gate are the cheapest defenses against wasting the Spike. Without them, the kill-switch is silently inoperable.
- **Phase 1 before Phase 2** because the hypothesis mechanism must prove architectural before building inspection UI around it. If stripping is block-only (can't replace non-MCP output), we scope-narrow to MCP-only capture before investing in dashboard UX.
- **Phase 2 before Phase 3** only by a day or two — eval runner can start in parallel once Phase 1's MCP tool is wired, because baseline mode doesn't need SAGOL at all. Treat Phase 2 as schedule-parallel with the *baseline* branch of Phase 3.
- **Phase 3 is 80% of risk, 40% of time.** Cost budget: eval harness ≤300 LOC, Docker setup pre-warmed in Phase 0 in parallel. Benchmark runs out-of-process to avoid measuring the wrong thing.

### Research Flags

- **Phase 0 / Phase 1:** Needs live verification of `updatedMCPToolOutput` behavior on the pinned Claude Code version, plus the R3 block-vs-replace feasibility check for SubagentStop. Confirmed-in-docs, unconfirmed-in-production.
- **Phase 3:** Needs live verification that `claude -p --bare --mcp-config` correctly isolates SAGOL on/off between interleaved runs, and that `stream-json` output surfaces `cache_creation_input_tokens` / `cache_read_input_tokens` at a per-task granularity.
- **Phases with standard patterns (skip deeper research):** Phase 2 dashboard — caveman-report validated the pattern; rewrite is mechanical.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | Official docs (Bun, MCP SDK, Claude Code Hooks), pinned versions, direct caveman-report source inspection |
| Features | HIGH | F1–F13 directly map to R1–R9; anti-features explicit in PROJECT.md Out of Scope |
| Architecture | HIGH (stripping) / MEDIUM (sync) | `updatedMCPToolOutput` verified in docs; blocking MCP tool pattern needs Day 3 live proof |
| Pitfalls | HIGH | Direct source reads of caveman-report + 2026 issue tracker evidence + SWE-bench contamination audits |

**Overall confidence:** HIGH. The four researchers converged independently on the same architectural constraints, which is the strongest possible signal.

### Gaps to Address

- **Exact kill-switch numbers** — `KILL_SWITCH.md` thresholds are placeholders until user confirms in Phase 0. File is immutable after that.
- **Dated kill ceremony** — placeholder 2026-04-28; user confirms the exact calendar date pre-code.
- **R3 block-vs-replace feasibility on SubagentStop** — Day 1–2 prototype before committing to dashboard or eval work.
- **SWE-bench Pro Docker setup time** — Pro's task count (1,865) is 3.7× Verified; verify harness invocation and Docker image availability in Phase 0 parallel with canary.
- **Port collision across concurrent Claude Code sessions** — random port + stderr URL print; 10 LOC mitigation documented but not yet written.

## Conflicts Reconciled

| Conflict | Resolution |
|----------|------------|
| STACK.md recommends **SWE-bench Verified**; PITFALLS.md recommends **SWE-bench Pro** | **Pro wins as primary headline.** Pitfalls has stronger 2026 evidence (Opus 4.5/GPT-5.2/Gemini 3 Flash verbatim-patch reproduction on Verified). Verified retained as a small contamination-aware smoke set. Logged as a Key Decision for PROJECT.md. |
| STACK.md mentions `@anthropic-ai/sdk` as a v1.5 option; critical point 7 forbids it in v1 | **Forbid in v1.** Summarization stays inside the Claude Code session via a scoped subagent so the Spike measures what it claims to measure. Moving summarization off-session invalidates the kill-switch by changing the comparison variable. |
| STACK.md suggests "both Hook and SubAgent wrapping prototyped, pick by measurement"; ARCHITECTURE.md recommends MCP tool + PostToolUse hook | **Architecture wins.** `updatedMCPToolOutput` is the only officially supported replace (vs block) mechanism, and it is MCP-tool-only. SubAgent wrapping remains a fallback but is not the primary plan. |

## Sources

### Primary (HIGH confidence)
- Claude Code Hooks reference — https://code.claude.com/docs/en/hooks (`updatedMCPToolOutput`, `matcher: "mcp__sagol__write_report"`)
- Claude Code MCP — https://code.claude.com/docs/en/mcp (tool naming `mcp__<server>__<tool>`)
- Claude Code Subagents / Skills / Headless — code.claude.com docs (April 2026)
- `@modelcontextprotocol/sdk` v1.29.0 — npm
- Bun 1.3.12 docs — `Bun.serve`, `bun:sqlite`, `Bun.spawn`
- caveman-report source at `/Users/chenjing/dev/caveman-report/src/*.js` (direct read)
- PROJECT.md `/Users/chenjing/dev/sagol/.planning/PROJECT.md` (Core Value + Out of Scope)

### Secondary (MEDIUM confidence)
- SWE-bench Pro paper (Scale, contamination motivation)
- Epoch AI SWE-bench Verified leaderboard (484-task runs, variance patterns)
- CodeSOTA SWE-bench contamination debate (verbatim patch reproduction audits, 2026)
- Anthropic `claude-code` issue #46829 (cache TTL regression March 2026)
- MCP Apps blog (2026-01-26) — rejected for v1 dashboard

### Tertiary (LOW confidence — requires live verification)
- Exact `updatedMCPToolOutput` behavior on pinned Claude Code version — verify in Phase 0
- Whether `fs.watch` on macOS picks up atomic-replace writes from sub-agent file writes reliably — verify in Phase 1; chokidar fallback documented
- SWE-bench Pro Docker image availability + invocation surface — verify in Phase 0 parallel with canary

---
*Research completed: 2026-04-14*
*Ready for roadmap: yes*
