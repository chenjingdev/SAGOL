---
phase: 00-pre-flight-gates
plan: 02
subsystem: pre-flight
tags: [bootstrap, canary, noise-gate, doctor, pinned-hash, d-04, d-05, d-06]
requires:
  - 00-01
provides:
  - scripts/canary.ts (Day 1 leakage canary live-fire script)
  - scripts/noise-gate.ts (noise-sensitivity gate CLI with working --dry-run)
  - scripts/pinned-hash.ts (deterministic SHA-256 over PINNED_VERSIONS.md)
  - scripts/doctor.ts (environment + required-file validator)
  - PINNED_VERSIONS.md fully populated and hashed
affects:
  - Plan 00-03 (fires canary.ts live, chmod-locks PINNED_VERSIONS.md, commits KILL_SWITCH.md immutable)
tech-stack:
  added: []
  patterns:
    - "pinned-hash self-consistency via stripping the `pinned_versions_hash:` line before hashing (circular-free)"
    - "doctor.ts reads expected bun/claude versions directly from PINNED_VERSIONS.md markdown tables via regex — no separate config file"
    - "noise-gate Phase 0 uses hard-coded candidate task list; real SWE-bench Pro wiring deferred to Phase 3, non-dry-run path fails loudly (exit 1)"
    - "canary.ts uses --permission-mode bypassPermissions for headless Claude Code invocation so the MCP tool fires without interactive approval in Plan 03"
key-files:
  created:
    - scripts/canary.ts
    - scripts/noise-gate.ts
    - scripts/pinned-hash.ts
    - scripts/doctor.ts
    - .planning/research/PINNED_VERSIONS.md
  modified: []
key-decisions:
  - "PINNED_VERSIONS.md committed in this plan (was untracked after Wave 1 despite Wave 1 referencing it in discussion); Plan 00-03 will chmod 444 it"
  - "claude version drift 2.1.107 → 2.1.108 resolved in this plan per D-06 pre-canary policy (canary Plan 03 will verify the bumped version)"
  - "noise-gate Phase 0 candidate task list is mock (`swe-bench-pro/mock-instance-00{1,2,3}`); seed=1 recorded in PINNED_VERSIONS.md; real instance selection in Phase 3"
requirements-completed:
  - GATE-02
  - GATE-03
  - GATE-04
  - GATE-05
duration: "~5 min"
completed: "2026-04-15"
---

# Phase 0 Plan 02: Canary + Noise-Gate + Doctor + Pinned-Hash Summary

Created the four missing Phase 0 TypeScript scripts (`canary.ts`, `noise-gate.ts`, `pinned-hash.ts`, `doctor.ts`) and finalized `.planning/research/PINNED_VERSIONS.md` with concrete `bun.lock`-resolved NPM versions, the claude-version drift fix (2.1.107 → 2.1.108), a concrete noise-gate seed, and a deterministic `pinned_versions_hash`. All four scripts pass their individual verifications, doctor reports GREEN on this host, and the pinned hash reproduces across back-to-back runs. No live Claude Code spawn occurred — GATE-02's live fire is Plan 00-03's job.

## Execution Metrics

- **Duration:** ~5 minutes
- **Tasks completed:** 3/3
- **Files created:** 5 (4 scripts + PINNED_VERSIONS.md first commit)
- **Files modified:** 0
- **Commits:** 3 atomic per-task commits

## Commits

| Task | Commit | Type | Description |
|------|--------|------|-------------|
| 2.1  | `a507961` | feat | add Day 1 leakage canary live-fire script |
| 2.2  | `243dfbf` | feat | add noise-sensitivity gate CLI skeleton with dry-run |
| 2.3  | `22b96fd` | feat | add pinned-hash + doctor scripts, finalize PINNED_VERSIONS.md |

## Script Artifacts — Byte Counts and SHA-256

| File | Size (bytes) | Lines | SHA-256 |
|------|--------------|-------|---------|
| `scripts/canary.ts` | 5459 | 183 | `0e930887340fa0d63167e58bf33bef6a4c026ddaab624ba11bd6850837138b72` |
| `scripts/noise-gate.ts` | 3261 | 104 | `91ec171d850fe18ce02f7bc9728dcc6b28aeab24db64eca0b7e811c70f7040cb` |
| `scripts/pinned-hash.ts` | 1084 | 34 | `35d47ceacdb04259996573a7a53ea9ee4f31a2e753b7ca5e612036ce23507bf9` |
| `scripts/doctor.ts` | 3326 | 109 | `5df53d8f24963a9ee465ef1926e7d37fbb4971345e46c2bd333fca81035d9fdf` |

All four files are ≥ their `must_haves.artifacts.min_lines` thresholds (canary ≥60, noise-gate ≥40, pinned-hash ≥20, doctor ≥40) and contain the required substring markers (`crypto.randomBytes` in canary, `--dry-run` in noise-gate, `claude --version` in doctor).

## PINNED_VERSIONS.md — Authorized Edits Only

`.planning/research/PINNED_VERSIONS.md` was **untracked** at the start of Plan 00-02 (it existed on disk as an untracked artifact from Wave 1's discussion but was never committed). This plan's Task 2.3 is therefore the first commit of this file, so `git diff HEAD~1 .planning/research/PINNED_VERSIONS.md` would show the whole file as added. To still prove "diff only in the four authorized regions" (threat T-00-04), here is the explicit region-by-region audit of every non-boilerplate change applied to the pre-existing on-disk file:

### Region 1 — Toolchain table, `claude` row

```diff
-| `claude` (Claude Code) | **2.1.107** | `command claude --version` |
+| `claude` (Claude Code) | **2.1.108** | `command claude --version` |
```

Host's `command claude --version` output: `2.1.108 (Claude Code)`. This is the D-06 version-bump drift fix — the canary in Plan 00-03 re-validates the bumped version per the "canary + noise gate must re-run on any bump" policy.

### Region 2 — NPM Dependencies section

The original prose bullet list of "target — Phase 1에서 정확 patch 버전 lock" was replaced with a 4-row locked table drawn directly from `bun.lock`:

```diff
-다음 항목은 Phase 1에서 `bun install` 후 `bun.lock`을 commit하면서 구체 버전이 박힌다. 미리 명시:
-
-- `@modelcontextprotocol/sdk` ^1.29.0 (target — Phase 1에서 정확 patch 버전 lock)
-- `gray-matter` ^4.0.3
-- `markdown-it` ^14.0.0
-- `highlight.js` ^11.9.0
-- `commander` ^14.0.0
-- `@clack/prompts` ^1.0.0
-- `open` ^11.0.0
+다음 항목은 Plan 00-01 Task 1.3에서 `bun install`이 만들어낸 `bun.lock`에서 추출된 concrete 버전이다. Phase 1에서 caveman-report lift가 시작되면 `gray-matter` / `markdown-it` / `highlight.js` / `commander` / `@clack/prompts` / `open`이 추가되고 같은 형식으로 이 표에 append된다. Phase 0 기준은 아래 4개만.
+
+| Package | Locked Version | Source |
+|---|---|---|
+| `@modelcontextprotocol/sdk` | `1.29.0` | `bun.lock` |
+| `zod` | `4.3.6` | `bun.lock` |
+| `@types/bun` | `1.3.12` | `bun.lock` |
+| `typescript` | `5.9.3` | `bun.lock` |
```

The four packages are exactly the four direct top-level deps recorded in `bun.lock` (2 runtime: `@modelcontextprotocol/sdk`, `zod`; 2 dev: `@types/bun`, `typescript`). Future Phase 1 deps (gray-matter, markdown-it, etc.) are explicitly noted as "not in bun.lock yet" and will be appended when they are. No new deps were installed in this plan.

### Region 3 — Random Seeds, noise-gate row

```diff
-| Noise-sensitivity gate task selection | **TBD** in Phase 0 noise gate dry-run, recorded back here | SWE-bench Pro instance list seed |
+| Noise-sensitivity gate task selection | **1** | index into `scripts/noise-gate.ts :: PHASE_0_CANDIDATE_TASKS`, Phase 3 will replace with a real SWE-bench Pro instance id |
```

Seed `1` matches `pickTaskBySeed(1)` default in `scripts/noise-gate.ts` → `swe-bench-pro/mock-instance-002`. Mock list is intentional for Phase 0; Phase 3 replaces with real SWE-bench Pro instance ids.

### Region 4 — Pinned Versions Hash section

```diff
-**Initial hash will be computed when Phase 1 lock files (bun.lock) are committed.**
+pinned_versions_hash: 399d9277fe1bdc99589bbfa405c36a48c57a66a0473405dbdff149155a29b9c5
```

Hash computed by `bun run scripts/pinned-hash.ts` after all other edits were saved. The script's `normalize()` function strips any `pinned_versions_hash:` line before hashing, so the file is self-consistent: running pinned-hash again after writing the line produces the same value (verified in Task 2.3 acceptance gate). No other lines of PINNED_VERSIONS.md were touched.

## Final `pinned_versions_hash`

```
399d9277fe1bdc99589bbfa405c36a48c57a66a0473405dbdff149155a29b9c5
```

Reproducible: `bun run scripts/pinned-hash.ts` prints this exact hex digest. The hash will break (and re-validation via canary is required per D-06) if anything in PINNED_VERSIONS.md changes except the `pinned_versions_hash:` line itself.

## `bun run scripts/doctor.ts` — Full Output

```
✓ file: .claude/settings.json: /Users/chenjing/dev/sagol/.claude/settings.json
✓ file: src/mcp/server.ts: /Users/chenjing/dev/sagol/src/mcp/server.ts
✓ file: scripts/strip-report.ts: /Users/chenjing/dev/sagol/scripts/strip-report.ts
✓ file: scripts/canary.ts: /Users/chenjing/dev/sagol/scripts/canary.ts
✓ file: scripts/noise-gate.ts: /Users/chenjing/dev/sagol/scripts/noise-gate.ts
✓ file: scripts/pinned-hash.ts: /Users/chenjing/dev/sagol/scripts/pinned-hash.ts
✓ file: .planning/research/KILL_SWITCH.md: /Users/chenjing/dev/sagol/.planning/research/KILL_SWITCH.md
✓ file: .planning/research/PINNED_VERSIONS.md: /Users/chenjing/dev/sagol/.planning/research/PINNED_VERSIONS.md
✓ file: bun.lock: /Users/chenjing/dev/sagol/bun.lock
✓ file: package.json: /Users/chenjing/dev/sagol/package.json
✓ file: tsconfig.json: /Users/chenjing/dev/sagol/tsconfig.json
✓ bun --version: 1.3.11 (matches PINNED_VERSIONS.md 1.3.11)
✓ claude --version: 2.1.108 (Claude Code) (pinned 2.1.108)

GREEN — 0 failure(s)
```

Exit code: `0`. 13 checks, 0 failures. Note the `KILL_SWITCH.md` file-existence check is GREEN because the file is on disk (untracked from Wave 1); Plan 00-03 will commit + chmod 444 it.

## Acceptance Criteria Re-verification

**Task 2.1 — canary.ts:**
- [x] `scripts/canary.ts` exists, 183 lines (≥60)
- [x] Contains `randomBytes(16)` — `grep -q 'randomBytes(16)' scripts/canary.ts` → 0
- [x] Contains `--mcp-config` — `grep -q 'mcp-config' scripts/canary.ts` → 0
- [x] References `00-CANARY-RESULT.md` — `grep -q '00-CANARY-RESULT.md' scripts/canary.ts` → 0
- [x] `bun run scripts/canary.ts --help` exits 0 and prints a line containing `Usage:`
- [x] NO live Claude Code spawn during verification

**Task 2.2 — noise-gate.ts:**
- [x] `scripts/noise-gate.ts` exists, 104 lines (≥40)
- [x] `--dry-run` path prints `[dry-run] would run baseline ×5 and noisy ×5 for task swe-bench-pro/mock-instance-001` and exits 0
- [x] non-dry-run path prints `[noise-gate] non-dry-run path is deferred to Phase 3` and exits 1
- [x] No Docker or python process spawned (verified by running `bun run noise-gate.ts --task x` which exits before any spawn)

**Task 2.3 — pinned-hash.ts + doctor.ts + PINNED_VERSIONS.md:**
- [x] `scripts/pinned-hash.ts` exists, 34 lines, prints 64-char lowercase hex
- [x] Deterministic: two back-to-back runs printed `399d9277...5a29b9c5` identically
- [x] `scripts/doctor.ts` exists, 109 lines, exits 0 (GREEN) on this host
- [x] `doctor.ts` `REQUIRED_FILES` contains all 11 Phase 0 files
- [x] PINNED_VERSIONS.md claude row = **2.1.108** (host actual `claude --version`)
- [x] PINNED_VERSIONS.md has `| Package | Locked Version | Source |` table with `@modelcontextprotocol/sdk` + `zod` (and `@types/bun` + `typescript`) filled from `bun.lock`
- [x] PINNED_VERSIONS.md ends with a `pinned_versions_hash: <64 hex>` line
- [x] NO edits to any other region of PINNED_VERSIONS.md beyond the four authorized regions documented above

**Plan-level verification:**
- [x] `bun run scripts/canary.ts --help` → exit 0 with `Usage:` line
- [x] `bun run scripts/noise-gate.ts --task swe-bench-pro/mock-instance-001 --noise-tokens 10000 --runs 5 --dry-run` → exit 0 with expected line
- [x] `bun run scripts/doctor.ts` → `GREEN — 0 failure(s)`, exit 0
- [x] `bun run scripts/pinned-hash.ts` → deterministic 64-char hex
- [x] `grep 'pinned_versions_hash: ' .planning/research/PINNED_VERSIONS.md` → 1 hit
- [x] No live Claude Code spawn occurred

## GATE-02 / GATE-03 / GATE-04 / GATE-05 Status

- **GATE-02 (leakage canary):** Plan 00-02 prerequisite satisfied — `scripts/canary.ts` exists, loads, knows its own CLI, and contains the full spawn wiring for `claude -p --mcp-config .claude/settings.json --permission-mode bypassPermissions`. Plan 00-03 fires it live and writes `00-CANARY-RESULT.md`. GATE-02 closes in Plan 00-03.
- **GATE-03 (noise gate):** Plan 00-02 prerequisite satisfied — `scripts/noise-gate.ts` exists and its `--dry-run` path prints the expected line and exits 0, which is the Phase 0 exit condition per D-04 (real SWE-bench Pro + Docker run is deferred to Phase 3, and the non-dry-run path fails loudly to prevent accidental invocation). GATE-03 closes in Plan 00-03 (which just re-verifies doctor GREEN).
- **GATE-04 (pinned versions immutable):** Plan 00-02 prerequisite satisfied — `PINNED_VERSIONS.md` is fully populated with concrete bun.lock versions, the claude drift is fixed, and the `pinned_versions_hash` is computed and written. Plan 00-03 `chmod 444` locks the file for the rest of the Spike.
- **GATE-05 (dated kill ceremony enforcement):** Plan 00-02 prerequisite satisfied — `doctor.ts` cross-references `PINNED_VERSIONS.md`, and the canary/noise-gate scripts exist. Plan 00-03 commits `KILL_SWITCH.md` immutable (which is the canonical ceremony-date artifact), closing GATE-05.

## Deviations from Plan

None - plan executed exactly as written.

- No bugs encountered (Rule 1 n/a)
- No missing critical functionality detected (Rule 2 n/a)
- No blockers (Rule 3 n/a)
- No architectural decisions needed (Rule 4 n/a)

Every file was written verbatim from the plan's action blocks with no "improvements", no deferred items, and no auto-fixes. All three tasks executed in order with every acceptance criterion passing on first attempt.

The `claude --version` drift from the plan's "observed 2.1.108" note was the live host value; the plan anticipated this exact drift and instructed writing the actual value. No hardcoding occurred — `command claude --version` was re-queried at the start of Task 2.3 and confirmed `2.1.108 (Claude Code)`.

## Known Stubs

- `scripts/noise-gate.ts :: PHASE_0_CANDIDATE_TASKS` is a 3-element mock list, not real SWE-bench Pro instance ids. Intentional per plan — Phase 3 replaces it with real instances when SWE-bench Pro Docker wiring lands. The noise-gate non-dry-run path is explicitly non-functional and fails loudly, so this stub cannot accidentally produce invalid measurements.
- No UI stubs, no hardcoded empty data flowing to dashboards (this plan has no UI surface).

## Threat Model Compliance

- **T-00-04 (Tampering — PINNED_VERSIONS.md edited outside authorized regions):** Mitigated. All four edits are documented region-by-region in "PINNED_VERSIONS.md — Authorized Edits Only" above. No other lines were touched.
- **T-00-05 (Information Disclosure — canary token logged to .sagol/canary/):** Accepted per plan. `.sagol/` is covered by `.gitignore`, tokens are ephemeral per canary run, and exposing the token in local files is exactly what the canary measures.
- **T-00-06 (Repudiation — non-deterministic pinned hash):** Mitigated. `pinned-hash.ts :: normalize()` strips the `pinned_versions_hash:` line before hashing, so the hash is self-consistent; verified by two back-to-back runs producing `399d9277fe1bdc99589bbfa405c36a48c57a66a0473405dbdff149155a29b9c5`.

## Self-Check

Verification commands re-run after writing SUMMARY:

```
$ for f in scripts/canary.ts scripts/noise-gate.ts scripts/pinned-hash.ts scripts/doctor.ts; do [ -f "$f" ] && echo FOUND: $f || echo MISSING: $f; done
FOUND: scripts/canary.ts
FOUND: scripts/noise-gate.ts
FOUND: scripts/pinned-hash.ts
FOUND: scripts/doctor.ts
$ [ -f .planning/research/PINNED_VERSIONS.md ] && echo FOUND || echo MISSING
FOUND
$ git log --oneline --all | grep -E '(a507961|243dfbf|22b96fd)'
22b96fd feat(00-02): add pinned-hash + doctor scripts, finalize PINNED_VERSIONS.md
243dfbf feat(00-02): add noise-sensitivity gate CLI skeleton with dry-run
a507961 feat(00-02): add Day 1 leakage canary live-fire script
$ bun run scripts/doctor.ts > /dev/null; echo "exit=$?"
exit=0
$ bun run scripts/pinned-hash.ts
399d9277fe1bdc99589bbfa405c36a48c57a66a0473405dbdff149155a29b9c5
```

All files present, all commits present, doctor GREEN, pinned hash reproducible. Ready for Plan 00-03 (KILL_SWITCH.md commit + PINNED_VERSIONS.md chmod 444 + leakage canary live fire).

## Self-Check: PASSED
