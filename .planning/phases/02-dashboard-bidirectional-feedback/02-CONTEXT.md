# Phase 2: Dashboard + bidirectional feedback — Context

**Gathered:** 2026-04-15
**Mode:** Auto — user said "오토 ㄱㄱ" after Phase 1 shipped. D-17-style direct execution.
**Status:** Ready for code

<domain>
## Phase Boundary

A human opens a local browser dashboard, sees sub-agent reports stream in live, clicks one, reads the rendered markdown, and submits approve / reject / revise feedback that reaches the blocked Claude Code sub-agent as the tool result of `sagol_await_feedback`. All of this on 127.0.0.1 with a per-session URL token. The dashboard must NOT be on the hot path for benchmark-style runs (benchmark mode bypasses the blocking feedback tool with an immediate `"(no feedback — proceed)"`).

Phase 2 also finally exercises the caveman-report lift allowance from D-12: `compiler.js` + `watcher.js` + `context.js` can be ported (total budget ≤200 LOC per DASH-05).

</domain>

<decisions>
## Locked Decisions

### D-20: Dashboard is a separate long-running process
**Decision:** `bun run dash` (or `bun run scripts/dash.ts`) starts the dashboard as its own process. It is NOT coupled to the MCP server subprocess that Claude Code spawns per session. This means the dashboard URL is stable across CC session restarts.

**Rationale:** The MCP server is spawned by CC and dies with the CC session. A dashboard wired into that subprocess would die too. A separate process also means the dashboard can be running in a terminal tab while the user kills/restarts CC freely.

### D-21: MCP ↔ Dashboard IPC via HTTP + file handshake
**Decision:** When the dashboard starts, it writes its URL + token to `.sagol/dashboard-url.txt` (one line: `http://127.0.0.1:<port>/?t=<token>`). The MCP server, when `sagol_await_feedback` is called, reads that file to discover the dashboard. If the file doesn't exist or the dashboard isn't reachable, `sagol_await_feedback` falls back immediately to `"(no feedback — dashboard not running, proceed)"`.

Feedback flow:
1. MCP server POST `http://127.0.0.1:<port>/api/await` with `{actionId, reportId, prompt?}` + token header
2. Dashboard server stores the pending awaiter, pushes to all connected WebSocket clients
3. Browser shows a feedback widget for that actionId; user submits {kind: "approve"|"reject"|"revise", text?}
4. Browser POST `/api/feedback/<actionId>` + token
5. Dashboard resolves the pending awaiter, replies to the MCP server's long-poll with the feedback
6. MCP server returns the feedback string to the agent

Alternative considered (in-process sharing, named pipes, unix sockets, shared SQLite) all require more surface area than HTTP + a one-line URL file.

### D-22: Long-poll over WebSocket-back-to-server
**Decision:** The MCP server long-polls `GET /api/poll/<actionId>` with a 10-minute HTTP timeout. The dashboard server holds the connection open until either (a) user feedback arrives, (b) local 10-minute timeout, or (c) benchmark-mode bypass. The MCP server does NOT open a WebSocket back to the dashboard — long-poll is simpler, works in Bun's native fetch, and the blocking semantics match `sagol_await_feedback`'s need to return a single value.

**Timeout:** 10 minutes on both sides. FB-03. On timeout, the MCP server returns `"(no feedback — proceed)"`.

### D-23: Benchmark-mode toggle via env var
**Decision:** If `process.env.SAGOL_BENCHMARK_MODE` is truthy, `sagol_await_feedback` returns `"(no feedback — proceed)"` IMMEDIATELY without any network or file access. This is checked inside the MCP tool handler before anything else. FB-05 / DASH success criterion 5.

**Verification:** a unit test asserts: with `SAGOL_BENCHMARK_MODE=1` set, `handleAwaitFeedback` returns instantly with the default string and never touches `.sagol/dashboard-url.txt` or fetches any URL.

### D-24: Security model — 127.0.0.1 + random token
**Decision:**
- `Bun.serve` with `hostname: "127.0.0.1"`. No off-host bind.
- Random 256-bit token generated on dashboard start via `crypto.randomUUID().replace(/-/g,"") + crypto.randomUUID().replace(/-/g,"")` (64 hex chars). Stored in memory for the dashboard's lifetime; persisted only in `.sagol/dashboard-url.txt` which is gitignored.
- Every HTTP route checks `?t=<token>` query OR `X-Sagol-Token: <token>` header. Mismatch → 403.
- WebSocket upgrade checks the same token in the initial GET query string. Mismatch → refuse upgrade.
- `.sagol/dashboard-url.txt` is 0600 (user-only).

**Negative test:** a script fires `curl` without the token and confirms 403. DASH-04.

### D-25: action_id dedup, visibility re-sync
**Decision:**
- `action_id` is the client-side dedup key. Browser computes it as a UUID when the feedback widget renders. Pressing submit twice rapidly uses the SAME action_id, so the server ignores the duplicate. FB-04.
- On `visibilitychange` → visible, the browser re-fetches `GET /api/state` to get the server-authoritative list of pending awaiters and reports. No optimistic client state that can drift.

### D-26: Caveman lift scope (budget ≤200 LOC for lifted content)
**Decision:** Lift ONLY the minimum needed for dashboard markdown rendering:
- `src/dash/compiler.ts` — gray-matter frontmatter parse + markdown-it render (port of caveman's compiler.js ~45 LOC, drop `REQUIRED_H2_COUNTS` validation)
- `src/dash/watcher.ts` — `fs.watch` debounced, rewrite (NOT a chokidar port)
- `src/dash/context.ts` — stripped-form rendering helper (port of caveman's context.js if applicable; otherwise rewrite inline)

NOT lifted:
- `caveman server.js` — rewrite with `Bun.serve` (no express, no ws)
- `caveman cli.js` — already have GSD; dashboard CLI is a 30-LOC `scripts/dash.ts`
- `caveman cache/` — not needed
- Any caveman domain validation (section counts etc.) — CAP-05 says flat files, no domain taxonomy

**Budget check:** sum of `wc -l src/dash/compiler.ts + src/dash/watcher.ts + src/dash/context.ts` ≤ 200 is the DASH-05 acceptance criterion.

### D-27: Dashboard UI = Preact + HTM + import map (no build step)
**Decision:** Per STACK.md, dashboard HTML served by `Bun.serve` directly loads Preact and HTM from `esm.sh` via an import map. No bundler, no build step. Dashboard is ~200 LOC of HTML + inline `<script type="module">` in `src/dash/html.ts` (which is a plain TS function returning the HTML string).

**Components (all inline in one file for Spike):**
- `App` — root, holds WebSocket connection + state
- `ReportList` — left sidebar, scrollable
- `ReportView` — right pane, renders compiled HTML
- `AwaiterModal` — pending feedback widget with three buttons (approve / reject / revise) + textarea

**Not used:** Preact signals (overkill), React Router (single page), Tailwind (inline CSS), Vite (no build).

### D-28: Phase 2 plan shape = minimal, direct execution
Following D-17 lessons from Phase 1: NO gsd-plan-phase agent orchestration, NO gsd-plan-checker, NO per-plan `*-SUMMARY.md` files. This CONTEXT.md is the spec, the code diffs are the execution record, `02-SUMMARY.md` (written at the end) is the authoritative phase record. The user explicitly authorized this mode with "오토 ㄱㄱ".

### Inherited from Phase 0/1 (still locked)
- Stack = Bun + TypeScript + `@modelcontextprotocol/sdk`
- D-08: never touch `~/.claude/settings.json`
- D-10: MCP server does server-side stripping for `write_report` (unchanged in Phase 2)
- D-14: no `@anthropic-ai/sdk`
- No automated eval runner
- `scripts/strip-report.ts` stays dormant

</decisions>

<code_context>
## Files to create / modify

**New (Phase 2):**
- `src/dash/compiler.ts` (~40 LOC lift from caveman)
- `src/dash/watcher.ts` (~50 LOC, fs.watch debounced)
- `src/dash/context.ts` (~30 LOC, in-memory report store)
- `src/dash/server.ts` (~200 LOC, Bun.serve + WebSocket + routes)
- `src/dash/html.ts` (~200 LOC, dashboard HTML string builder with Preact import map)
- `scripts/dash.ts` (~30 LOC, CLI entry)
- `tests/dash.test.ts` (~100 LOC, bun test for compiler + watcher + feedback flow)

**Modified:**
- `src/mcp/server.ts` — ADD `sagol_await_feedback` tool + HTTP long-poll client
- `scripts/doctor.ts` — ADD dashboard-url.txt presence check (conditional, only if `.sagol/dashboard-url.txt` exists)
- `package.json` — ADD `"dash": "bun run scripts/dash.ts"` script

**Untouched:**
- `scripts/strip-report.ts` — dormant
- `src/mcp/server.ts` `handleWriteReport` — D-10 server-side stripping unchanged
- Phase 0 scripts (canary, noise-gate, pinned-hash)

## Dependencies added (2026-04-15, this commit batch)
- `gray-matter@^4.0.3` — frontmatter parsing (lift)
- `markdown-it@^14.1.1` — markdown → HTML (lift)
- `highlight.js@^11.11.1` — code block highlighting (lift)
- `@types/markdown-it@^14.1.2` — dev

All allowed under DASH-05 "lift from caveman" clause. No other new deps.

</code_context>

<specifics>
## Specific ideas

- Dashboard URL format: `http://127.0.0.1:<port>/?t=<token>` — bookmarkable for the user's convenience; token in query (not header) because it's local-only and the user opens it via `open`.
- Port selection: `Bun.serve({ port: 0 })` picks a free port, dashboard reads `server.port` and uses that.
- Log output: dashboard stderr prints the URL on start. stdout stays clean for potential future scripting.
- Feedback widget UX: three big buttons (✓ approve / ✗ reject / ✎ revise). Revise opens a textarea inline. Approve/reject submit immediately without textarea.
- Auto-open: `bun run dash` calls `open(url)` to launch the default browser. Skipped with `--no-open`.
- Hot-reload on report file change: `fs.watch` on `.sagol/reports/` → debounce 100ms → recompile → WebSocket push.
- Timeout semantics: 10-min total on both MCP and dash side. MCP handles network errors as "fallback to proceed". Dash handles connection drop by marking the awaiter stale and removing from the list.

</specifics>

<deferred>
## Deferred to v2

- Multi-user / cloud dashboard
- MCP Apps in-chat iframe variant
- Markdown preview while typing revise feedback
- Report taxonomy / auto-classification
- Export/share individual reports
- Undo / edit submitted feedback
- Dashboard per-report chat threads
- Dashboard history navigation / pagination (initial scroll is enough for Spike)
- WebSocket reconnection with exponential backoff (hard reload is fine for Spike)

</deferred>

<canonical_refs>
## Canonical refs

- `.planning/REQUIREMENTS.md` — DASH-01..05, FB-01..05
- `.planning/ROADMAP.md` Phase 2 section — goal + success criteria
- `.planning/PROJECT.md` — constraints, especially local-only + no `@anthropic-ai/sdk`
- `.planning/phases/01-stripping-path-interactive-mode-only/01-SUMMARY.md` — Phase 1 interface inventory
- `.planning/research/STACK.md` — Bun.serve + Preact + HTM + import map rationale
- `.planning/research/PITFALLS.md` — scan for dashboard / WebSocket / long-poll pitfalls
- `~/dev/caveman-report/src/compiler.js` — lift source
- `~/dev/caveman-report/src/watcher.js` — reference for debounce pattern
- `~/dev/caveman-report/src/server.js` — DO NOT lift express/ws; read only for route shape reference

</canonical_refs>
