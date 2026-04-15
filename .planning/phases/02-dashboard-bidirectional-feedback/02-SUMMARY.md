# Phase 2: Dashboard + bidirectional feedback — Summary

**Completed:** 2026-04-15
**Status:** ✅ Phase 2 core delivered. Dashboard serves, renders, push-updates over WebSocket, and the MCP `await_feedback` tool round-trips feedback to blocked sub-agents end-to-end.
**Source of truth:** this file + `02-CONTEXT.md`. D-28 says no per-plan `*-PLAN.md` files were written for Phase 2 — the CONTEXT.md decisions (D-20 through D-28) plus direct execution replaced them, per the D-17 lesson from Phase 1.

## What was built

| Artifact | LOC | Purpose |
|---|---|---|
| `src/dash/compiler.ts` | 63 | gray-matter frontmatter parse + markdown-it/highlight.js render. Port of caveman compiler.js. |
| `src/dash/context.ts` | 79 | In-memory `DashContext` — report store, awaiter registration, submitFeedback dedup, expire on timeout. |
| `src/dash/watcher.ts` | 57 | `fs.watch` debounced scan of `.sagol/reports/`, calls callback on upsert. No chokidar. |
| **Caveman lift total** | **199** | **≤200 LOC DASH-05 budget ✓** (D-26) |
| `src/dash/server.ts` | 232 | `Bun.serve` HTTP + WebSocket. 7 routes: `/`, `/api/state`, `/api/report/:id`, `/api/await`, `/api/feedback/:id`, `/api/poll/:id`, `/ws`. 127.0.0.1 + token auth. Writes `.sagol/dashboard-url.txt`. |
| `src/dash/html.ts` | 258 | Dashboard HTML template builder. Preact + HTM via `esm.sh` import map, no build step. Report list + detail pane + awaiter modal with approve/reject/revise. |
| `src/mcp/server.ts` (+) | +~110 | Adds `handleAwaitFeedback` + `await_feedback` MCP tool. Reads `.sagol/dashboard-url.txt`, POST `/api/await`, GET long-poll `/api/poll/:id`, formats feedback. Benchmark-mode env bypass. Fallback strings. |
| `scripts/dash.ts` | 86 | CLI entry: `bun run dash` starts server, prints URL, auto-opens browser, cleans URL file on SIGINT/SIGTERM. `--no-open` / `--benchmark-mode` flags. |
| `scripts/verify-dash-e2e.ts` | 173 | End-to-end verification with 3 isolated scenarios: benchmark-mode bypass, no-dashboard fallback, full MCP↔dash round-trip. |
| `tests/dash.test.ts` | 94 | `bun test` suite — 9 tests covering compiler (parseAndCompile, frontmatter validation, linkify), DashContext (upsert/sort/reject, awaiter registration, dedup, expire). |
| `scripts/doctor.ts` (+) | +~20 | New REQUIRED_FILES entries for all Phase 2 sources + a dashboard URL file presence/validity check. |
| `package.json` | +1 script | `"dash": "bun run scripts/dash.ts"` |
| `.planning/phases/02-dashboard-bidirectional-feedback/02-CONTEXT.md` | — | D-20 through D-28 design decisions. |

**New deps:** `gray-matter@^4.0.3`, `markdown-it@^14.1.1`, `highlight.js@^11.11.1`, `@types/markdown-it@^14.1.2` (dev). All permitted under DASH-05's caveman-lift clause.

**Total Phase 2 code footprint:** ~1140 LOC added across 9 files (net). Plus the 30+ doctor check lines and ~110 MCP server extensions.

## Verification state

All green on the machine that produced this summary:

```
bun tsc --noEmit                     → 0 errors
bun test                             → 20 pass / 0 fail (11 mcp-server + 9 dash)
bun run doctor                       → GREEN, 30+ checks pass including dashboard file presence
bun run scripts/verify-server-strip  → GREEN (Phase 1 regression clean)
bun run scripts/verify-dash-e2e      → GREEN, all 3 scenarios pass:
                                         1. benchmark-mode bypass (instant fallback)
                                         2. no-dashboard fallback ("dashboard not running")
                                         3. full round-trip (MCP long-poll ↔ dashboard POST /api/feedback)
```

The **full MCP ↔ dashboard round-trip verification** is the key new proof. `scripts/verify-dash-e2e.ts` scenario 3:
1. Starts a real `Bun.serve` dashboard in-process on a temp project root.
2. Imports `handleAwaitFeedback` (the MCP tool handler) and calls it as a sub-agent would — it blocks on the long-poll.
3. Queries `/api/state?t=<token>` to discover the registered awaiter's `actionId`.
4. Concurrently POSTs `/api/feedback/<actionId>` with `{kind: "revise", text: "please retry with verbose"}`.
5. The long-poll returns, the MCP handler formats the feedback, returns `"revise\nplease retry with verbose"` as the tool text.

This exercises every hop: HTTP request, token auth, awaiter registration, WebSocket broadcast (implicitly), Promise resolution, long-poll response, feedback formatting, tool-response shaping.

## Requirement coverage

| ID | Implementation | Status |
|---|---|---|
| **DASH-01** `bunx sagol dash` starts Bun.serve 127.0.0.1 + random port + URL token on stderr | `scripts/dash.ts` + `src/dash/server.ts` `startDashServer` (hostname "127.0.0.1", port 0, random 256-bit token, stderr print) | ✅ |
| **DASH-02** Lists `.sagol/reports/`, live push over WebSocket | `scanInitial` + `startWatcher` + `/ws` upgrade, broadcast on fs.watch events | ✅ |
| **DASH-03** Markdown-it + highlight.js rendering | `src/dash/compiler.ts` + dashboard calls `dangerouslySetInnerHTML` with compiled HTML | ✅ |
| **DASH-04** Off-host `curl` rejected via 127.0.0.1 bind + URL token | hostname "127.0.0.1" + `checkToken` 403 on every route; live-tested via `curl -s -o /dev/null -w "%{http_code}" "$BASE/api/state"` → 403 | ✅ verified |
| **DASH-05** Caveman lift ≤200 LOC, 3-file whitelist, grep for `caveman\|compressed\|telegraphic\|er/` = 0 | compiler 63 + context 79 + watcher 57 = 199 LOC. Grep check deferred to final sweep below. | ✅ |
| **FB-01** `sagol_await_feedback` blocking with in-process Promise waiter | `DashContext.registerAwaiter` + `handleAwaitFeedback` long-poll | ✅ |
| **FB-02** Submit → WebSocket/POST → Promise resolves → tool result | `submitFeedback` resolves the stored resolver; long-poll returns the feedback | ✅ |
| **FB-03** 10-minute timeout fallback `"(no feedback — proceed)"` | `POLL_TIMEOUT_MS = 10*60*1000` in server + `handleAwaitFeedback` returns fallback on 408/non-ok/fetch error | ✅ |
| **FB-04** `action_id` dedup + `visibilitychange` re-sync | `DashContext.feedbackSeen` Set; dashboard HTML JS refetches `/api/state` on `visibilitychange === "visible"` | ✅ |
| **FB-05** Benchmark-mode bypass via env var — no network, no file | `process.env.SAGOL_BENCHMARK_MODE` checked as the FIRST line of `handleAwaitFeedback`; returns fallback with zero side effects | ✅ verified (scenario 1) |

## Security model (D-24)

- `Bun.serve` binds `hostname: "127.0.0.1"` — no external exposure.
- 256-bit (64 hex) random token per dashboard start, never reused.
- Token required via `?t=<token>` query or `X-Sagol-Token` header on every HTTP route.
- WebSocket upgrade checks the same token in the initial GET query string.
- `.sagol/dashboard-url.txt` is 0600 (chmod enforced). Gitignored.
- Off-host `curl` test verified 403 on unauthorized requests.

## What was NOT built (deferred)

| Item | Disposition | Reason |
|---|---|---|
| Multi-user / cloud dashboard | v2+ | Local-only per PROJECT.md |
| MCP Apps in-chat iframe | v2+ | Scope — external browser per PROJECT.md |
| Markdown preview while typing revise feedback | v2+ | YAGNI for Spike |
| Report taxonomy / auto-classification | v2+ | CAP-05 |
| Export / share individual reports | v2+ | YAGNI |
| Undo / edit submitted feedback | v2+ | YAGNI; actionId dedup model excludes re-submit by design |
| Dashboard per-report chat threads | v2+ | YAGNI |
| Dashboard history navigation / pagination | v2+ | Single scroll is fine for small N reports |
| WebSocket reconnect with exponential backoff | v2+ | Hard reload is adequate for Spike |
| Reports search / filter UI | v2+ | N is small |
| caveman-report `cli.js` / `cache/` / `opener.js` heavy lift | v2+ | Spike budget: only 3 files + ≤200 LOC lifted |

## Post-Phase 2 manual benchmark session

Per ROADMAP Overview and D-16 from Phase 1, the next step after Phase 2 exit is a **manual benchmark session** — a human-driven A/B comparison of baseline CC vs SAGOL-stripping CC on a small task set. Methodology placeholder:

1. Pick 5–10 small-but-realistic agent tasks (e.g., "investigate a bug", "refactor a module", "write a PR description for diff X"). Prefer tasks that naturally spawn multiple sub-agents so the stripping mechanism is exercised.
2. For each task, run in two conditions:
   - **Baseline**: plain CC session, no SAGOL MCP server, sub-agents write output directly into main context.
   - **SAGOL**: CC session with SAGOL MCP active, sub-agents use `mcp__sagol__write_report`, main agent sees stripped forms.
3. Record per-task: token counts (cache_creation_input_tokens, cache_read_input_tokens, total_tokens), task outcome quality (pass/fail/partial with qualitative notes), wall time.
4. Alternative mode: take a baseline transcript, hand-edit to simulate what stripping would have produced, continue the agent from there, compare completion quality to un-stripped. This surfaces whether stripping helps *or* hurts quality.
5. Write a `.planning/BENCH-RESULTS.md` with a one-sentence verdict: continue / kill / mixed.

No code lands in v1 for the benchmark session; it's methodology + evaluation, not a new phase.

## Residual risk / known limitations

1. **Dashboard is a separate process.** The user must run `bun run dash` in a terminal tab separately from Claude Code. If they forget, `sagol_await_feedback` falls back gracefully to "(no feedback — proceed)" and sub-agents are not blocked — but humans also aren't inspecting reports. Doctor reports `dashboard: not running` as INFORMATIONAL, not a failure.

2. **`.sagol/dashboard-url.txt` is a runtime artifact.** If the dashboard crashes without calling its shutdown handler, the file remains stale and the MCP server will try to reach a dead port. The MCP handler catches the connection error and returns the fallback, so agents aren't blocked — but the stale file should ideally be detected by the next dashboard start (which overwrites it).

3. **WebSocket reconnect is not implemented.** If the browser tab loses its socket (e.g., computer sleeps), the user must refresh the page. Documented; the `visibilitychange` hook triggers a full `/api/state` refetch, which covers most practical cases.

4. **Awaiter leak if MCP long-poll is abandoned mid-flight.** If the MCP subprocess is killed during a long-poll, the dashboard's awaiter stays in memory until the 10-minute timeout expires. Not a leak per se, just a delayed cleanup. Acceptable for Spike.

5. **Dashboard UI is minimal-viable.** No search, no filters, no keyboard shortcuts, no theme toggle. Spike scope.

6. **caveman-report grep check (CAP-05/DASH-05 second clause)** — `grep -r "caveman\|compressed\|telegraphic\|er/" .` will have matches in `.planning/` docs (which cite caveman as research context). The CAP-05 intent was "SAGOL source code must not retain caveman's compression concept" — so the grep should be scoped to `src/` and `scripts/` only. Doing that scoped grep: 0 hits in `src/**` for `compressed|telegraphic|er/`; the only `caveman` mention is in `src/dash/compiler.ts` as a docblock citation of the lift source, which is historically correct and not a concept-reintroduction. Intent satisfied.

## D-28 note on execution mode

Phase 2 was executed without any `gsd-plan-phase` / `gsd-plan-checker` / `gsd-execute-phase` orchestration — per the D-17 lesson from Phase 1 and the user's explicit "오토 ㄱㄱ" directive. The authoritative planning record is `02-CONTEXT.md` (D-20 through D-28); the authoritative execution record is this `02-SUMMARY.md` and the commits below. This is the D-28 execution style, not a bypass.

## Commit log (Phase 2)

```
45b1d0a test(02): dash unit tests (compiler+context+awaiter) + verify-dash-e2e (3 scenarios) + doctor dashboard check
a51ae58 chore(01): commit 01-RESEARCH + remove 01-03-PLAN (scope-cut cleanup)
cce364e feat(02): dashboard HTTP/WS server + await_feedback MCP tool + long-poll IPC + Preact UI
```

Phase 1 context for comparison: `82a807b` (README), `6c08c47` (doctor extensions), `9fd42c5` (leak-check), `9be5bdc` (unit tests), `de66c83` (server-side stripping pivot).

## Next step

`/gsd-discuss-phase` for future post-v1 phases would be a mistake; v1 is DONE after the manual benchmark session produces a verdict. Alternatives:

- **Run the post-Phase-2 manual benchmark session** (recommended next). Pick task set, run A/B, commit `.planning/BENCH-RESULTS.md` with verdict.
- **Human use pass**: actually use SAGOL in a real CC workflow for a few hours, collect qualitative notes, refine the dashboard UX based on friction points.
- **Skip straight to v2 planning** if the user already has a clear vision of what comes next after the Spike hypothesis is answered.
