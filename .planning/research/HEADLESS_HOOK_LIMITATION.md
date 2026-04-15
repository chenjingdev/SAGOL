# Hook Loading Limitation — Architectural Finding

**Discovered:** 2026-04-15 (Phase 0 Day 1 canary fire, then Phase 1 HARD GATE pre-task)
**Claude Code version:** 2.1.108
**Bun version:** 1.3.11
**Status:** Known limitation, worked around by server-side stripping (see "Server-side workaround" below).

> **Update 2026-04-15 (Phase 1 HARD GATE):** The original framing of this
> document was "headless-only" because Phase 0 never tested interactive
> mode. Phase 1 HARD GATE pre-task then fired `mcp__sagol__write_report`
> live inside an interactive Claude Code session and observed that the
> project-local `PostToolUse` hook **also fails to fire in interactive
> mode**. The limitation is therefore broader than originally documented
> — project-local hooks at `.claude/settings.json` do not load in this
> Claude Code version **at all** (neither interactive nor headless) while
> respecting the D-08 rule of not touching `~/.claude/settings.json`.
> SAGOL v1 works around this by moving the strip logic inside the MCP
> server process itself (see "Server-side workaround"). The hook path
> (`scripts/strip-report.ts`) is preserved as a reference for the day a
> future CC version fixes project-local hook loading.

## TL;DR

`claude -p` headless mode on Claude Code 2.1.108 does **not load** `PostToolUse` hooks
registered in project-local `.claude/settings.json`, regardless of permission flags.
This means SAGOL's stripping mechanism cannot be exercised in the environment where
SWE-bench Pro-style benchmarks run.

SAGOL's hypothesis measurement path (PostToolUse + `updatedMCPToolOutput` →
SWE-bench Pro task_success delta) is therefore **not achievable** in the Claude Code
version pinned by this project, **unless the benchmark runs in interactive mode** or
the hook is moved to the global `~/.claude/settings.json` (which D-08 explicitly
forbids).

## The matrix

| Hook location | Interactive mode | Headless `claude -p` |
|---|---|---|
| `~/.claude/settings.json` (global, D-08 forbidden) | ✓ loads | ✓ loads (SessionStart seen in every canary run) |
| `.claude/settings.json` (project-local) | untested in headless canary | ✗ **does not fire** |
| File passed via `--mcp-config <path>` | — | ✗ `--mcp-config` only loads `mcpServers`, ignores `hooks` |

MCP server registration has a separate but cleanly solved story:

| MCP server location | Headless `claude -p` |
|---|---|
| `.mcp.json` (project root) with `enabledMcpjsonServers` in `.claude/settings.json` | ✓ loads |
| File passed via `--mcp-config` | ✓ loads |
| `.claude/settings.json` `mcpServers` block | ✗ does not auto-load |

## Evidence

Three canary runs captured as `.sagol/canary/*-raw.jsonl`:

1. **Run 1 (2026-04-14T23:19Z, `77e1514723cf5ac33365a5179cf51c04`):**
   `claude -p --mcp-config .claude/settings.json --permission-mode bypassPermissions`.
   MCP server connected, tool fired, report written to disk, but `PostToolUse hook
   event observed in stream: false`. Leak hits: 4 in `user.tool_result`.

2. **Run 2 (2026-04-14T23:29Z, `5354851bccf94212fb3cc7e8497ad702`):**
   Split config into `.mcp.json` + `enabledMcpjsonServers`, dropped `--mcp-config`.
   MCP still connects (confirms the canonical project-scoped MCP path works).
   Hook still does not fire.

3. **Run 3 (2026-04-14T23:31Z, `cf24d5465f09b276a2265f4f83c6dba1`):**
   Replaced `--permission-mode bypassPermissions` with
   `--dangerously-skip-permissions`. Hook still does not fire.

In every run, the stream-json captures DO contain `SessionStart:startup` hook events
from the user's global `~/.claude/settings.json`, proving that:

- Global hooks load fine in headless mode.
- Project-local hooks register differently and are not picked up by `claude -p`.
- This is not a permission / trust issue — it is a hook discovery issue.

## Why this matters for SAGOL

The original v1 hypothesis (KILL_SWITCH.md):

> PostToolUse hook + `updatedMCPToolOutput`으로 서브에이전트 보고서 본문을 메인 컨텍스트에서
> 제거하면 SWE-bench Pro task_success가 baseline 대비 +3%p 이상 올라간다.

SWE-bench Pro runs tasks through a Python harness that spawns `claude -p` headlessly
per task. If `PostToolUse` hooks do not fire in that mode, the stripping mechanism is
never active during the benchmark, and `task_success` is trivially identical to
baseline — there is no hypothesis to measure.

A strict reading of KILL_SWITCH.md says this is the end of v1. However, on
2026-04-15 the user explicitly elected to:

- **Override the Day-1 kill ceremony** (previously committed as immutable).
- **Defer the benchmark method** — SWE-bench Pro via `claude -p` harness is off the
  table; the user will pick a new benchmark approach later.
- **Proceed with Phase 1 and Phase 2 app development** scoped to interactive mode,
  where the stripping mechanism is expected to work (this must be verified in
  Phase 1).

This file documents the finding so it can be re-tested on a future Claude Code
version without losing the diagnostic trail.

## Revival conditions

The SAGOL v1 hypothesis becomes measurable again if any of the following holds:

1. A future Claude Code release loads project-local `.claude/settings.json` hooks in
   `claude -p` headless mode.
2. A future Claude Code release adds a `--settings <path>` or `CLAUDE_SETTINGS` env
   var that forces a specific settings file for the session (including hooks).
3. The MCP SDK adds a server-side strip API where the MCP server emits
   `updatedMCPToolOutput`-equivalent behavior without a separate hook, removing the
   hook from the critical path.
4. The project rewrites D-08 to permit adding one hook line to
   `~/.claude/settings.json` (explicit scoped exception).
5. An alternative benchmark method is found that exercises stripping in a mode
   where the hook actually fires (e.g., an interactive-mode simulator).

Each of these paths is tracked informally for future reference.

## Scripts preserved for revival

- `scripts/canary.ts` — supports all 3 invocation styles (commented in code) and
  decomposes stream hits into tool_use.input (unavoidable) vs tool_result /
  assistant_text (leak-indicating). Re-run on a new Claude Code version to check
  whether the hook now fires.
- `scripts/strip-report.ts` — the actual hook. Unchanged; still correct.
- `.mcp.json` + `.claude/settings.json` — the project-scoped config split. This part
  of the rescue is architecturally correct regardless of the hook issue and should
  be kept.

## Related

- `00-CANARY-RESULT.md` — per-run verdict detail.
- `KILL_SWITCH.md` — the original strict kill rule. Still in the repo as reference;
  the override is recorded in `STATE.md` and commit messages.
- `PROJECT.md` — the kill ceremony text. Same status.

## Server-side workaround (adopted 2026-04-15, Phase 1)

Rather than require any `PostToolUse` hook, the MCP server itself
(`src/mcp/server.ts`) now returns a stripped form directly from the
`write_report` tool handler:

    [report:<id>] <title>\n<summary>\n\n(full body: .sagol/reports/<id>.md)

The full body is still persisted to the on-disk file — nothing is lost.
The on-wire tool response is the stripped string, so the main agent
context never sees the body regardless of hook loading behavior.

Why this works in both modes: the MCP stdio subprocess is spawned
identically by Claude Code in both `claude` (interactive) and `claude -p`
(headless) modes. Whatever the subprocess returns from its tool handler
is exactly what the parent agent observes. No hook involved, no
settings file consulted.

Verification: `scripts/verify-server-strip.ts` imports `handleWriteReport`
directly, writes a random canary into the body, and asserts:
  (a) the tool response does not contain the canary
  (b) the on-disk file does contain the canary
  (c) the stripped form matches the `[report:<id>] …` shape
Run `bun run scripts/verify-server-strip.ts` to reproduce.

Live re-verification (tool call through Claude Code session) requires a
session restart to pick up the new `src/mcp/server.ts` because CC spawns
the MCP subprocess once per session. This is tracked as the first
verification step of Phase 1's plan.

## Benchmark path implication (un-pivot opportunity)

The original Phase 0 kill override was premised on the assumption that
the stripping mechanism required a `PostToolUse` hook, which cannot fire
in `claude -p` headless mode on CC 2.1.108. The server-side workaround
breaks that premise — if stripping lives inside the MCP server, the
same mechanism works in headless mode too, which means the original
SWE-bench Pro automated measurement path is **potentially reopened**.

This has not been re-verified in headless mode as of 2026-04-15 (Phase 1
HARD GATE discovery moment). The test-plan for reopening:

1. Restart Claude Code so CC picks up the new `src/mcp/server.ts`.
2. Re-run `scripts/canary.ts` in headless mode (`claude -p --mcp-config
   .mcp.json …`). Expectation: 0 leak hits because the stripping is now
   server-side, not hook-side. Confirms reopening.
3. If confirmed, the user may re-introduce a Phase 3 (or decide to keep
   the manual session methodology from the pivot). Decision deferred to
   the user — this document just records that the option exists again.

---

*This document is **not** KILL_SWITCH.md and is **not** immutable. Future phases may
update it as new Claude Code versions are tested.*
