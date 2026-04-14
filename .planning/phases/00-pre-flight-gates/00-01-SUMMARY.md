---
phase: 00-pre-flight-gates
plan: 01
subsystem: pre-flight
tags: [bootstrap, hook, mcp, bun, d-07, d-08, d-09]
requires: []
provides:
  - .claude/settings.json (project-local hook + mcpServers registration)
  - bun.lock (reproducible dependency lock)
  - committed Phase 0 skeleton (package.json, tsconfig.json, .gitignore, src/mcp/server.ts, scripts/strip-report.ts)
affects:
  - Plan 00-02 (reads concrete versions from bun.lock to update PINNED_VERSIONS.md)
  - Plan 00-03 (fires leakage canary via `claude -p --mcp-config .claude/settings.json`)
tech-stack:
  added:
    - "@modelcontextprotocol/sdk@1.29.0"
    - "zod@4.3.6"
    - "@types/bun@1.3.12"
    - "typescript@5.9.3"
  patterns:
    - "Project-local .claude/settings.json registers both hooks and mcpServers in one file (no global mutation)"
    - "PostToolUse matcher uses Claude Code's `mcp__<server>__<tool>` naming convention (sagol/write_report → mcp__sagol__write_report)"
    - "MCP server returns FULL body; hook script does the stripping — proves the stripping happens in the hook and not client-side"
key-files:
  created:
    - .claude/settings.json
    - bun.lock
  modified: []
  committed_as_is:
    - package.json
    - tsconfig.json
    - .gitignore
    - src/mcp/server.ts
    - scripts/strip-report.ts
key-decisions:
  - "Minimal .claude/settings.json surface — no permissions/env/autoApprove keys, fewer canary variables per D-08"
  - "bun.lock committed despite .gitignore comment (file intentionally allowed) for PINNED_VERSIONS reproducibility"
  - "MCP smoke test uses background-spawn + sleep 1 + kill pattern, no dependence on GNU timeout(1) (absent on macOS)"
requirements-completed:
  - GATE-01
  - GATE-02
duration: "~3 min"
completed: "2026-04-15"
---

# Phase 0 Plan 01: Bootstrap Phase 0 skeleton + hook + MCP registration Summary

Committed the untracked D-07 skeleton files as-is, created project-local `.claude/settings.json` registering both the PostToolUse hook matcher `mcp__sagol__write_report` and the `sagol` MCP stdio server, and ran `bun install` to produce a reproducible `bun.lock` — all while leaving `~/.claude/settings.json` byte-identical per D-08. The MCP server boot smoke-test confirmed `[sagol-mcp] ready` on stderr within 1 second.

## Execution Metrics

- **Duration:** ~3 minutes
- **Tasks completed:** 3/3
- **Files created:** 2 (`.claude/settings.json`, `bun.lock`)
- **Files committed as-is:** 5 (`package.json`, `tsconfig.json`, `.gitignore`, `src/mcp/server.ts`, `scripts/strip-report.ts`)
- **Commits:** 3 atomic per-task commits
- **bun install:** 96 packages in 1.46s

## Commits

| Task | Commit | Type | Description |
|------|--------|------|-------------|
| 1.1  | `739ddc1` | chore | Commit Phase 0 D-07 skeleton files as-is (5 files) |
| 1.2  | `7d639d6` | feat  | Register PostToolUse hook + sagol MCP server in project-local .claude/settings.json |
| 1.3  | `3fc9d9d` | chore | Lock deps via bun install and verify MCP server boots |

## D-07 Skeleton Audit Trail

Every committed-as-is file was verified against the D-07 marker contract before commit. No edits were made.

| File | Size (bytes) | SHA-256 |
|------|--------------|---------|
| `package.json` | 583 | `a285519bb3d321f230f1058858023f6ee6f9a53c5c0f1352100c0745bc16fc42` |
| `tsconfig.json` | 581 | `f2b260e4360bb0d54a4b13db371b0043844170858915873361788fcad634bcdf` |
| `.gitignore` | 118 | `2a6ee8cae76cc41e5e36444326ec2a87144fd69369e38cb20953e3738b94fe59` |
| `src/mcp/server.ts` | 4396 | `506be8153668f0456ec1b65437ff374fa58b1c2f7057d8e936f77afd306394dd` |
| `scripts/strip-report.ts` | 4610 | `d779ec149b44b734667512e4ffbb242945e1ec46f2e4700176aa565b044cbed2` |
| `.claude/settings.json` | 434 | `c10335933e3e65e9abee2b4268b93ab714f0c1f2cb7805647dbf7fe4816f08a8` |

### Verification output (Task 1.1)

```
OK: all Phase 0 skeleton files match expected markers
```

All nineteen grep assertions passed:
- `package.json`: `"canary"`, `"noise-gate"`, `"mcp"`, `"doctor"`, `"@modelcontextprotocol/sdk"`, `"zod"`, `"type": "module"`
- `tsconfig.json`: `"strict": true`, `"moduleResolution": "bundler"`, `"bun-types"`
- `.gitignore`: `node_modules/`, `dist/`, `.sagol/`, `.DS_Store`, `*.log`
- `src/mcp/server.ts`: `registerTool`, `"write_report"`, `name: "sagol"`, `text: md`
- `scripts/strip-report.ts`: `updatedMCPToolOutput`, `hookSpecificOutput`, `PostToolUse`, `[report:`

## `.claude/settings.json` (inline)

```json
{
  "$schema": "https://json.schemastore.org/claude-code-settings.json",
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "mcp__sagol__write_report",
        "hooks": [
          {
            "type": "command",
            "command": "bun run scripts/strip-report.ts"
          }
        ]
      }
    ]
  },
  "mcpServers": {
    "sagol": {
      "command": "bun",
      "args": ["run", "src/mcp/server.ts"]
    }
  }
}
```

Matcher rationale: Claude Code surfaces MCP tools as `mcp__<serverName>__<toolName>`. `src/mcp/server.ts` creates `new McpServer({ name: "sagol", ... })` and registers `write_report`, which Claude Code exposes as `mcp__sagol__write_report` — the exact matcher string above.

## D-08 Compliance Audit (global settings mtime receipt)

Metadata-only reads of `~/.claude/settings.json` were performed via `stat -f %m`. The file contents were **never** read, cat'd, Read'd, or inspected. Only the mtime integer was observed.

| Timestamp | Value |
|-----------|-------|
| Pre-Task 1.2 (before any write) | `1776178350` |
| Post-Task 1.2 (after writing project-local file) | `1776178350` |
| Post-plan (after `bun install` + smoke test) | `1776178350` |

**Delta: 0 seconds.** The user's global settings were not modified by any action in this plan.

## Dependency Lock (Task 1.3)

`bun --version`: **1.3.11** (matches PINNED_VERSIONS.md D-06 pin).

`bun install` output:
```
bun install v1.3.11 (af24e281)
Resolved, downloaded and extracted [107]
Saved lockfile

+ @types/bun@1.3.12
+ typescript@5.9.3 (v6.0.2 available)
+ @modelcontextprotocol/sdk@1.29.0
+ zod@4.3.6

96 packages installed [1460.00ms]
```

Packages picked up in `bun.lock`:

| Package | Resolved Version | Integrity |
|---------|------------------|-----------|
| `@modelcontextprotocol/sdk` | **1.29.0** | `sha512-zo37mZA9hJWpULgkRpowewez1y6ML5GsXJPY8FI0tBBCd77HEvza4jDqRKOXgHNn867PVGCyTdzqpz0izu5ZjQ==` |
| `zod` | **4.3.6** | `sha512-rftlrkhHZOcjDwkGlnUtZZkvaPHCsDATp4pGpuOOMDaTdDDXF91wuVDJoWoPsKX/3YPQ5fHuF3STjcYyKr+Qhg==` |
| `@types/bun` | 1.3.12 (dev) | — |
| `typescript` | 5.9.3 (dev) | — |

Note: `@modelcontextprotocol/sdk@1.29.0` pulls `express@^5.2.1`, `hono@^4.11.4`, `jose@^6.1.3`, `ajv@^8.17.1`, `eventsource@^3.0.2`, and 20+ other transitives. None of these are SAGOL's direct deps and none are imported outside the SDK. Plan 02 will record the top-level two in PINNED_VERSIONS.md; transitives are locked in `bun.lock` itself.

`v6.0.2` TypeScript is available but we're sticking with 5.9.3 — no reason to churn the pin mid-Spike.

## MCP Server Boot Smoke Test (Task 1.3 + plan verification)

Portable background-spawn pattern (macOS-safe, no GNU `timeout(1)` dependency):

```bash
rm -f /tmp/sagol-mcp-boot.log
bun run src/mcp/server.ts </dev/null >/tmp/sagol-mcp-boot.log 2>&1 &
MCP_PID=$!
sleep 1
kill -9 "$MCP_PID" 2>/dev/null || true
wait "$MCP_PID" 2>/dev/null || true
grep -q '\[sagol-mcp\] ready' /tmp/sagol-mcp-boot.log
```

Captured output (stderr merged via `2>&1`):
```
[sagol-mcp] ready. reports dir: /Users/chenjing/dev/sagol/.sagol/reports
```

Plan-level verification additionally ran `bun run mcp` (same target via npm script alias) and observed the identical ready line. The MCP stdio server boots cleanly on Bun 1.3.11 + SDK 1.29.0.

## Acceptance Criteria Re-verification

**Task 1.1:**
- [x] All grep checks exit 0 — confirmed, single `OK: all Phase 0 skeleton files match expected markers` printed
- [x] Zero files modified — confirmed via `git status --short` showing only `A` (add) status for the five files, no `M` lines

**Task 1.2:**
- [x] `.claude/settings.json` exists
- [x] Matcher is `mcp__sagol__write_report` — verified via `bun -e` JSON.parse equivalent
- [x] Command is `bun run scripts/strip-report.ts`
- [x] `mcpServers.sagol.command == "bun"`
- [x] `mcpServers.sagol.args` contains `src/mcp/server.ts`
- [x] `~/.claude/settings.json` mtime unchanged (1776178350 pre/post)

**Task 1.3:**
- [x] `bun.lock` exists at repo root (19565 bytes)
- [x] `grep '@modelcontextprotocol/sdk' bun.lock` → multiple hits
- [x] `grep 'zod' bun.lock` → multiple hits
- [x] `node_modules/` directory exists and is gitignored (not in `git status`)
- [x] MCP server ready line captured via portable background-spawn pattern

**Plan-level verification:**
- [x] `git status --short` shows no unexpected files for this plan's footprint (STATE.md modified and research/*.md untracked are out-of-scope — handled by Plans 02/03)
- [x] `bun run mcp` prints `[sagol-mcp] ready` within 3 seconds
- [x] `~/.claude/settings.json` mtime identical to Task 1.2 pre-value (1776178350)

**Success criteria:**
- [x] Task 1.1 verification script exits 0 with OK marker
- [x] `.claude/settings.json` has exact specified shape, no extra keys
- [x] `bun.lock` lists `@modelcontextprotocol/sdk` and `zod`
- [x] MCP server boot smoke-test printed the ready line
- [x] No modification to `~/.claude/settings.json`

## GATE-01 / GATE-02 Status

- **GATE-01 (KILL_SWITCH.md committed immutable):** Plan 00-01 prerequisites satisfied — hook + MCP pair is now runnable. GATE-01 is closed by Plan 00-03, which does the actual commit + chmod. Plan 00-01 contributes the runtime substrate without which the canary cannot fire.
- **GATE-02 (leakage canary):** Plan 00-01 prerequisites satisfied — `.claude/settings.json` exists and registers both the hook and the MCP server, so `claude -p --mcp-config .claude/settings.json` in Plan 00-03 will successfully surface `mcp__sagol__write_report`. MCP server proven to boot. GATE-02 is closed by Plan 00-03 when the canary returns 0 hits on the random token.

## Deviations from Plan

None - plan executed exactly as written.

No bugs, no missing critical functionality, no blockers, no architectural decisions. All three tasks executed in order with every acceptance criterion passing on first attempt.

## Known Stubs

None. `src/mcp/server.ts` and `scripts/strip-report.ts` are complete for Phase 0's purpose (the whole Phase 0 point is that they're minimal-but-functional for the canary). No empty-array / placeholder / TODO-comment stubs were observed.

## Self-Check: PASSED

Verification commands re-run after writing SUMMARY:

```
$ [ -f .claude/settings.json ] && echo FOUND || echo MISSING
FOUND
$ [ -f bun.lock ] && echo FOUND || echo MISSING
FOUND
$ git log --oneline --all | grep -E '(739ddc1|7d639d6|3fc9d9d)'
3fc9d9d chore(00-01): lock deps via bun install and verify MCP server boots
7d639d6 feat(00-01): register PostToolUse hook + sagol MCP server in project-local .claude/settings.json
739ddc1 chore(00-01): commit Phase 0 D-07 skeleton files as-is
$ stat -f %m ~/.claude/settings.json
1776178350   (unchanged from pre-task capture 1776178350)
```

All files present, all commits present, D-08 mtime receipt intact. Next: Plan 00-02 reads concrete versions from `bun.lock` to update PINNED_VERSIONS.md.
