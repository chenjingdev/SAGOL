# Pinned Versions — IMMUTABLE for Spike

**Committed:** 2026-04-15
**Mutability:** Immutable for Spike duration. Any version bump requires re-running leakage canary AND noise-sensitivity gate before that version's measurements become valid.

---

## Host

| Field | Value |
|---|---|
| `hostname` | `gim-alam-ui-MacStudio.local` |
| OS | macOS 26.4 (BuildVersion 25E246) |
| Architecture | (`uname -m` 결과를 PINNED_HASH 생성 시 추가) |

## Toolchain

| Tool | Version | Source |
|---|---|---|
| `claude` (Claude Code) | **2.1.108** | `command claude --version` |
| `bun` | **1.3.11** | `bun --version` |
| Node compatibility layer | (Bun built-in) | Bun 1.3.11 |

## NPM Dependencies (locked at Phase 1 install time)

다음 항목은 Plan 00-01 Task 1.3에서 `bun install`이 만들어낸 `bun.lock`에서 추출된 concrete 버전이다. Phase 1에서 caveman-report lift가 시작되면 `gray-matter` / `markdown-it` / `highlight.js` / `commander` / `@clack/prompts` / `open`이 추가되고 같은 형식으로 이 표에 append된다. Phase 0 기준은 아래 4개만.

| Package | Locked Version | Source |
|---|---|---|
| `@modelcontextprotocol/sdk` | `1.29.0` | `bun.lock` |
| `zod` | `4.3.6` | `bun.lock` |
| `@types/bun` | `1.3.12` | `bun.lock` |
| `typescript` | `5.9.3` | `bun.lock` |

## Random Seeds

| Purpose | Seed | Notes |
|---|---|---|
| Day 1 leakage canary token | (script가 매 실행마다 generate, 결과 파일에 기록) | crypto.randomBytes(16) → hex |
| Noise-sensitivity gate task selection | **1** | index into `scripts/noise-gate.ts :: PHASE_0_CANDIDATE_TASKS`, Phase 3 will replace with a real SWE-bench Pro instance id |
| Eval task ordering | **TBD** in Phase 3 first run | interleave seed for baseline/SAGOL ordering |

## Pinned Versions Hash

`bun run scripts/pinned-hash.ts`가 위 모든 항목을 정렬해서 SHA-256 해시 생성. 모든 측정 row의 `pinned_versions_hash` 필드에 첨부됨. Hash가 일치하지 않으면 측정은 invalid.

pinned_versions_hash: 399d9277fe1bdc99589bbfa405c36a48c57a66a0473405dbdff149155a29b9c5

## Re-validation Triggers

다음 중 하나가 발생하면 leakage canary + noise gate 둘 다 재실행해야 그 시점 이후 측정이 valid:

- `claude --version` 변경
- `bun --version` 변경
- `bun.lock` hash 변경
- `~/.claude/settings.json` 또는 project local `.claude/settings.json` hook 정의 변경
- macOS major version 변경

---

*Phase 0 commit. Phase 1에서 bun.lock + pinned hash 추가 commit.*
