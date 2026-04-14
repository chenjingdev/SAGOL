---
phase: "00"
plan: "00-03"
status: completed-with-caveat
date: 2026-04-15
---

# Plan 00-03 Summary — Live canary fire + kill-switch override

## Outcome

Plan 00-03 fired the Day 1 leakage canary live and returned **RED** on all three
rescue attempts (original invocation + two architectural rescues). Per
KILL_SWITCH.md strict reading, this would end v1. However, on 2026-04-15 the user
explicitly elected to **override the Day-1 kill ceremony** and pivot to completing
the app first, with benchmark methodology deferred.

This plan is therefore marked `completed-with-caveat`: all diagnostic work is done,
the RED finding is recorded, the kill ceremony was NOT executed, and Phase 0 exits
with a known limitation rather than a kill.

## What was done

| Task | Status | Notes |
|------|--------|-------|
| 3.1 Pre-flight authorization | ✓ | User pre-approved at checkpoint; doctor green; D-08 mtime unchanged. |
| 3.2 Fire the leakage canary live | ✓ (fired) | 3 runs, all RED. See 00-CANARY-RESULT.md and HEADLESS_HOOK_LIMITATION.md. |
| 3.3 Noise-gate + doctor final sanity | not run | Blocked by RED under the original strict plan. Still valid from Plan 00-02 commit `243dfbf`. |
| 3.4 Topological commit of Phase 0 | reshaped | Original commit chain was for a GREEN outcome. Close-out commits were restructured into two atomic commits: rescue + architectural finding, and STATE/ROADMAP pivot. |
| 3.5 `chmod 444` on KILL_SWITCH.md + PINNED_VERSIONS.md | not run | Immutability lock was meaningful only if Phase 3 measurements were going to reference them. With the benchmark deferred, the chmod is moot. Files remain at mode 644 as reference-only documents. |

## Rescue attempts (summary)

| # | Change | Result | Leak hits | PostToolUse observed |
|---|--------|--------|-----------|----------------------|
| 1 | `--mcp-config .claude/settings.json` + `bypassPermissions` (original) | RED | 4 | no |
| 2 | Split to `.mcp.json` + `enabledMcpjsonServers`, drop `--mcp-config` | RED | 4 | no |
| 3 | Replace `bypassPermissions` with `--dangerously-skip-permissions` | RED | 4 | no |

All three runs confirm the architectural finding: **project-local
`.claude/settings.json` `PostToolUse` hooks do not fire in `claude -p` headless mode
on Claude Code 2.1.108**, regardless of config layout or permission flag.

Full evidence: `.sagol/canary/*-raw.jsonl` (3 stream captures preserved).

## Artifacts shipped by this plan

- `scripts/canary.ts` — revised to support all 3 invocation styles and decompose
  stream hits into unavoidable (tool_use.input echoes from the prompt) vs leak
  (tool_result + assistant text).
- `.mcp.json` — new project-scoped MCP config.
- `.claude/settings.json` — split to hooks only + `enabledMcpjsonServers: ["sagol"]`.
- `.planning/phases/00-pre-flight-gates/00-CANARY-RESULT.md` — full per-run verdict.
- `.planning/research/HEADLESS_HOOK_LIMITATION.md` — architectural finding,
  revival conditions, retest instructions.
- `.planning/research/KILL_SWITCH.md` — committed as reference. **Not immutable.**
  The Day-1 strict kill was overridden.
- `.planning/research/PINNED_VERSIONS.md` — committed as reference. **Not immutable.**

## GATE status

| Gate | Original requirement | Current status |
|------|---------------------|----------------|
| GATE-01 | KILL_SWITCH.md committed immutable | Committed ✓; not chmod-locked (moot — override). |
| GATE-02 | Canary returns 0 leak hits | **FAILED — 4 leak hits, kill ceremony overridden by user.** Re-test condition documented in HEADLESS_HOOK_LIMITATION.md. |
| GATE-03 | noise-gate.ts dry-run exits 0 | Confirmed green in Plan 00-02 commit `243dfbf`. |
| GATE-04 | PINNED_VERSIONS.md committed | Committed ✓; not chmod-locked (moot). |
| GATE-05 | Dated ceremony mechanically enforced | Superseded by user override. |

## Scope change to downstream phases

- **Phase 1 (Stripping path):** scope narrowed to **interactive mode only**. The
  hook is expected to work in a live Claude Code session; Phase 1 must verify this
  as its first task before any further work.
- **Phase 2 (Dashboard + bidirectional feedback):** unchanged. The dashboard is a
  separate browser process that does not depend on hook firing mode.
- **Phase 3 (Eval runner):** deferred. The SWE-bench Pro harness via `claude -p`
  was the entire design assumption; with that path broken, the user will propose a
  new benchmark method after Phase 1 and 2 complete. Phase 3 is kept in the
  roadmap as a placeholder.

## Lessons recorded (for the eventual post-mortem)

1. The canary architecture (strict "0 stream hits") was subtly wrong at the outset:
   the assistant's own `tool_use.input` always echoes any token the prompt supplies,
   which is unavoidable. The revised canary correctly distinguishes unavoidable
   echoes from leak-relevant tool_result / assistant_text occurrences. This
   distinction should survive into any future re-test.
2. Claude Code has two completely separate config discovery paths: (a) project-local
   settings auto-discovery from cwd, which handles hooks (in interactive mode), and
   (b) `--mcp-config` which handles mcpServers only. Knowing this matters for any
   future project that wants to bundle hooks with MCP servers.
3. `.mcp.json` at repo root + `enabledMcpjsonServers` in `.claude/settings.json` is
   the canonical way to auto-load a project-scoped MCP server in headless mode.
   This pattern is now in the repo and works.

## Next action

Enter Phase 1 discuss with interactive-only scope.
