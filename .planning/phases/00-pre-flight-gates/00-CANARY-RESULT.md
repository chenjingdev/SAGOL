# Day 1 Leakage Canary — RED

**Verdict:** RED (GATE-02 failed)
**Date fired:** 2026-04-15 (Day 1)
**Host:** gim-alam-ui-MacStudio.local
**claude --version:** 2.1.108 (Claude Code)
**bun --version:** 1.3.11
**Project root:** /Users/chenjing/dev/sagol

## Outcome

SAGOL's stripping mechanism (PostToolUse hook + `updatedMCPToolOutput`) could **not**
be fired in `claude -p` headless mode on Claude Code 2.1.108. Three rescue attempts
were made after the initial RED; all three returned RED. The canary correctly
identified the architectural feasibility failure that Phase 0 was designed to catch.

Per KILL_SWITCH.md Day 1 Leakage Canary gate: **1+ stream hits → SAGOL 즉시 폐기**.

This file is the permanent RED record. v1 Spike is killed at Phase 0.

## Run 1 — original spec (Plan 00-03 Task 3.2)

**Command:**
```
claude -p --output-format stream-json --verbose \
  --mcp-config .claude/settings.json \
  --permission-mode bypassPermissions \
  "Use the sagol write_report tool to log exactly this token..."
```

**Result:**
- token: `77e1514723cf5ac33365a5179cf51c04`
- claude exit code: 0
- stream stdout length: 15794 bytes
- total stream hits: 5 (1 unavoidable in `assistant.tool_use.input`, 4 in `user.tool_result`)
- leak hits (tool_result + assistant_text): 4
- PostToolUse hook event observed in stream: **false**
- reports created: 1 (`.sagol/reports/1776208752920-6fa451e6.md`)
- report hits: 2
- raw stream capture: `.sagol/canary/2026-04-14T23-19-04-037Z-raw.jsonl`

**Diagnosis:** `sagol` MCP server loaded (visible in `system.init.mcp_servers`), tool
fired, report was correctly written to disk. But zero `PostToolUse` hook events
appeared in the stream — `scripts/strip-report.ts` never ran. The tool_result passed
through unchanged, leaking the token into `user.tool_result.content[].text` and the
top-level `tool_use_result[].text` aggregator.

**Hypothesis:** `claude -p --mcp-config <file>` loads only the `mcpServers` block from
the supplied config, not the `hooks` block. Project-local hooks would need to be
loaded from a different discovery path.

## Run 2 — rescue attempt 1

**Change:** Split `.claude/settings.json` into two files:
- `.mcp.json` at repo root (mcpServers only) — Claude Code's canonical project-scoped MCP
- `.claude/settings.json` (hooks only + `"enabledMcpjsonServers": ["sagol"]` to pre-approve)

Drop `--mcp-config` from the spawn args so project-local discovery runs normally.

**Command:**
```
claude -p --output-format stream-json --verbose \
  --permission-mode bypassPermissions \
  "..."
```

**Result:**
- total stream hits: 5 / leak hits: 4 / PostToolUse observed: **false**
- reports created: 1 / report hits: 2
- `system.init.mcp_servers` now contains `sagol` ✓ — the config split worked for MCP
- `system.init.tools` contains `mcp__sagol__write_report` ✓

**Diagnosis:** Problem 1 (MCP loading) is solved — sagol server now auto-loads via
project-local `.mcp.json` + `enabledMcpjsonServers` pre-approval. Problem 2 remains:
project-local `.claude/settings.json` `PostToolUse` hooks still do not fire.

**Key signal:** The stream DOES contain `SessionStart:startup` hook events at the top
of the init sequence. Those come from the user's GLOBAL `~/.claude/settings.json`.
So global hooks load fine in headless mode. Project-local hooks do not.

## Run 3 — rescue attempt 2

**Change:** Replace `--permission-mode bypassPermissions` with
`--dangerously-skip-permissions` — Claude Code's nuclear override for headless/CI
environments where no human can approve trust prompts.

**Command:**
```
claude -p --output-format stream-json --verbose \
  --dangerously-skip-permissions \
  "..."
```

**Result:**
- total stream hits: 5 / leak hits: 4 / PostToolUse observed: **false**
- reports created: 1 / report hits: 2

**Diagnosis:** Even with `--dangerously-skip-permissions`, the project-local PostToolUse
hook for `mcp__sagol__write_report` does not fire. This is not a permission / trust
issue. Project-local hooks in `.claude/settings.json` are simply not loaded by
`claude -p` headless mode on Claude Code 2.1.108.

## The architectural wall

| Location | mcpServers | hooks |
|---|---|---|
| `~/.claude/settings.json` (global) | ? | ✓ loads in headless |
| `.claude/settings.json` (project-local) | ✗ does not auto-load | ✗ **does not load in headless** |
| `.mcp.json` (project-local MCP) | ✓ auto-loads with `enabledMcpjsonServers` | — |
| File passed via `--mcp-config` | ✓ loads | ✗ ignored |

SAGOL's hypothesis requires:
1. A `PostToolUse` hook matching `mcp__sagol__write_report`, AND
2. The hook firing in the environment where measurements happen (headless `claude -p`
   for SWE-bench Pro eval harness in Phase 3).

Claude Code 2.1.108 offers only one path that satisfies both: put the hook in the
global `~/.claude/settings.json`. Project rule **D-08 absolutely forbids touching
`~/.claude/settings.json`** — the reasoning was that a measurement tool must not
pollute the user's global Claude Code configuration, and if it needs global state
to function, it is not a self-contained Spike.

D-08 was written on 2026-04-15 during discuss-phase, BEFORE this canary fire
revealed that headless project-local hooks don't load. D-08 and the headless-only
hook path are irreconcilable without a D-08 rewrite, which is out of scope for a
Day 1 kill-switch decision.

## Why "kill" is the correct response

Per KILL_SWITCH.md:
> Day 1 Leakage Canary — Pass: 0 hits. Kill: 1+ hits → SAGOL 즉시 폐기. Phase 1 진행 안 함. 이게 설계.

And per PROJECT.md:
> 이 검증이 실패하면(향상 없음/미미함) 프로젝트는 폐기한다. 도구의 완성도나 UX는 이 검증을 위한 수단이다.

caveman-report는 "조금만 더 다듬으면..." 으로 질질 끌다 소리소문없이 죽었다. SAGOL
의 kill ceremony는 정확히 그 실패 패턴을 repeat하지 않기 위해 박혀 있다. 오늘 3
번의 rescue로 충분한 debugging을 했고, 나온 진단은 "현재 Claude Code 버전의
headless hook 경로가 SAGOL의 구조를 허용하지 않는다"다. 이건 측정 가능한
architectural finding이고, Phase 1~3를 진행할 근거가 없다.

## What remains on disk (post-kill)

**Not deleted, preserved as post-mortem:**
- All phase 0 code (`src/mcp/server.ts`, `scripts/strip-report.ts`, `scripts/canary.ts`,
  `scripts/noise-gate.ts`, `scripts/doctor.ts`, `scripts/pinned-hash.ts`)
- Project configs (`.claude/settings.json`, `.mcp.json`, `package.json`, `tsconfig.json`)
- All three `.sagol/canary/*-raw.jsonl` stream captures — evidence for the three
  rescue attempts
- All `.planning/` documents (PROJECT, REQUIREMENTS, ROADMAP, STATE, CONTEXT, 3 PLANs,
  2 SUMMARY files, KILL_SWITCH.md, PINNED_VERSIONS.md)
- This file

**Not executed:**
- Phase 1 (Stripping path)
- Phase 2 (Dashboard + bidirectional feedback)
- Phase 3 (Eval-runner + SWE-bench Pro + writeup)

**Not done (intentionally):**
- `chmod 444` on KILL_SWITCH.md / PINNED_VERSIONS.md (immutability was valuable only
  if Phase 3 measurements were going to reference them — moot now)

## Possible future revival

SAGOL is killed as a v1 Spike, but the finding is salvageable if any of the following
become true in the future:

1. Claude Code changes so project-local `.claude/settings.json` `PostToolUse` hooks
   fire in `claude -p` headless mode
2. Claude Code adds a `--settings <path>` or `CLAUDE_SETTINGS` env var that forces a
   specific settings file for the session
3. MCP SDK adds a server-side strip API where the MCP server itself can emit
   `updatedMCPToolOutput`-equivalent behavior without a separate hook
4. D-08 is explicitly rewritten and a global-hook-based variant of SAGOL is pursued
   (different project, different constraints)

Until one of those conditions holds, this RED verdict stands and v1 Spike is over.

---

*Committed by the kill ceremony on 2026-04-15.*
