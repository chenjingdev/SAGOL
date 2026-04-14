# Phase 0: Pre-flight gates - Context

**Gathered:** 2026-04-15
**Status:** Ready for planning
**Mode:** Discuss (autonomous workflow, locked decisions)

<domain>
## Phase Boundary

오늘(2026-04-15) Day 1에 SAGOL의 가설 메커니즘과 벤치마크 감수성을 둘 다 증명한다. 둘 중 하나라도 실패하면 SAGOL은 그 자리에서 폐기되거나 벤치를 바꾼다.

Phase 0는 코드를 짜는 phase가 아니라 **commit-and-fire phase**다 — 결정은 immutable 형태로 commit되고, leakage canary는 실제로 발사되며, dated kill ceremony가 calendar에 박힌다.

</domain>

<decisions>
## Locked Decisions (from user input — immutable for Phase 0)

### D-01: Dated kill ceremony = 2026-04-22 (1 week from today)
**원래 placeholder는 2026-04-28**이었으나 사용자가 더 짧은 reframe을 선택했다.
**Today (2026-04-15)는 코드/메커니즘 완성 데드라인**, **2026-04-22는 SWE-bench Pro 실측 verdict 데드라인**.
오늘 안에 코드/canary는 끝내고, Phase 3의 SWE-bench Pro 실측 런은 2026-04-15~2026-04-22 사이에 사용자가 머신 자원이 있을 때 수행. 2026-04-22까지 verdict가 commit되지 않으면 자동 폐기 commit이 강제된다.

### D-02: Hypothesis = Strict (single-variable)
**Verbatim**: *"PostToolUse hook + updatedMCPToolOutput으로 서브에이전트 보고서 본문을 메인 컨텍스트에서 제거하면 SWE-bench Pro task_success가 baseline 대비 +3%p 이상 올라간다."*

이게 KILL_SWITCH.md에 immutable로 박힌다. 다른 가설(token-only, multi-criterion soft 등)은 명시적으로 거부됨.

### D-03: Kill thresholds = 엄격
- `task_success` delta: kill if delta < **+3%p** at n ≥ **50 per condition**, 3 runs each, variance reported
- `total_tokens` delta: kill if delta > **+0%** (SAGOL은 토큰 net-negative 금지)
- `cache_creation_input_tokens`: kill if SAGOL이 baseline 대비 어떤 측정 가능한 마진으로라도 thrash
- **Pass = 셋 다 만족** (success +3%p AND tokens 비증가 AND cache 안정). 하나라도 실패하면 kill.
- Sample: SWE-bench Pro 50 task × 2 conditions × 3 runs = 300 runs. baseline/SAGOL 동일 task set, 동일 day, interleaved.
- p-hacking 금지: post-hoc subset 분석 안 함, "long task만 보면..." rescue 안 함.

### D-04: Noise-sensitivity gate task = SWE-bench Pro에서 1개 task
**선택 방식**: SWE-bench Pro instance list에서 description length 상위 10% 중 random 1개를 선택, seed를 PINNED_VERSIONS.md에 기록.
**주입**: 그 task의 problem statement에 10k tokens의 lorem ipsum 변형을 가운데 삽입.
**측정**: baseline Claude Code(SAGOL 없이)가 이 task를 5회 시도 → garbage 없는 동일 task 5회 시도와 비교. `task_success` 또는 `total_tokens` 한 쪽이라도 측정 가능하게 차이가 나야 통과 (rule-of-thumb: 평균 차이 ≥ 0.5σ).
**실패하면**: 벤치 자체가 noise에 무감각 → SWE-bench Pro 폐기, 2026-04-22 데드라인 안에서 alternative 모색.
**오늘 실행**: noise gate는 코드까지 (실제 5×2 runs는 세션 외부에서 사용자가 수동 실행) — 완전 자동화 조건은 아직 갖추지 못함.

### D-05: Day 1 leakage canary = 오늘 실제 발사
**메커니즘**: canary 스크립트가
1. `Bun.spawn`으로 `claude -p --output-format stream-json --mcp-config <pinned>` 헤드리스 세션을 띄움
2. 세션 입력으로 "Use sagol_write_report to log this random token: <RANDOM_128_BIT_TOKEN>"
3. stream-json 출력 전체를 capture한 뒤 grep으로 RANDOM_128_BIT_TOKEN이 assistant 메시지/tool result 어디에도 나타나지 않음을 확인 (보고서 파일에는 있어야 함)
4. 0 hits → green / 1+ hits → 즉시 SAGOL 폐기 (이게 설계)

**실패 시 대응**: 즉시 멈추고 user에게 "Phase 0 GATE-02 실패 — SAGOL은 architecturally 불가능합니다" 보고. 코드 더 안 짠다.

**Re-run trigger**: Claude Code 버전 bump마다, MCP SDK 버전 bump마다, hook 코드 변경마다 자동 재실행.

### D-06: Pinned versions philosophy = strict snapshot
PINNED_VERSIONS.md에 기록할 항목:
- `claude --version` (현재 호스트의 Claude Code)
- `bun --version`
- `@modelcontextprotocol/sdk` 정확 버전
- `gray-matter` / `markdown-it` / `highlight.js` 정확 버전
- macOS 버전 / 호스트 hostname (`hostname` 명령 결과)
- canary random seed
- noise gate task selection seed

이 파일은 Phase 0에서 commit된 후 immutable. 모든 Phase 1-3 측정 결과의 metadata에 자동으로 첨부된다 (eval row의 `pinned_versions_hash`).

**버전 bump 정책**: Claude Code가 자동 업데이트됐을 경우 canary와 noise gate를 재실행. 하나라도 실패하면 그 버전의 SAGOL은 invalid.

### D-07: Phase 0 deliverables for today
1. `KILL_SWITCH.md` (immutable, hypothesis + thresholds + ceremony date)
2. `PINNED_VERSIONS.md` (snapshot)
3. SAGOL 프로젝트 skeleton — `package.json`, `tsconfig.json`, `src/` 디렉토리 (Bun + TS)
4. Minimal MCP server stub (`src/mcp/server.ts`) — `sagol_write_report` tool만, 충분히 작아서 leakage canary가 통과할 수 있도록
5. Hook 설정 (`.claude/settings.json` LOCAL — 사용자 글로벌 설정 건드리지 않음) — `mcp__sagol__write_report` PostToolUse 매처
6. `scripts/canary.ts` — 실제 leakage canary 실행 스크립트
7. `scripts/noise-gate.ts` — noise gate 스크립트 (실제 실행은 사용자가 후속에 수동, 오늘은 dry-run으로 코드만 검증)

### D-08: Local-only settings
**중요**: hook 등록은 `~/.claude/settings.json`(글로벌)이 아니라 `/Users/chenjing/dev/sagol/.claude/settings.json`(프로젝트 local)에 한다. 글로벌 설정은 절대 건드리지 않는다.

### D-09: Bun 설치 결정 — 이미 있으면 사용, 없으면 사용자 명시 동의
Phase 1 plan 직전에 `which bun` 확인. 없으면 plan에서 명시적으로 "Bun 설치 필요" 게이트를 트리거.

</decisions>

<code_context>
## Existing Code Insights

**Repo state**: 빈 git repo (`.git`만 있음), 첫 commit은 .planning/ 문서들. 아직 코드 없음.

**Reusable assets**: `~/dev/caveman-report/src/` — Phase 1에서 lift 대상이지만 Phase 0에서는 손대지 않음. Phase 0는 SAGOL skeleton만 만들고 caveman 코드 lift는 Phase 1에서.

**Constraints from research**:
- Bun + TypeScript (Stack research 결정)
- `@modelcontextprotocol/sdk` ^1.29.0
- caveman lift는 Phase 1, ≤200 LOC, file whitelist (`watcher.js`, `compiler.js`, `context.js`)
- `@anthropic-ai/sdk` 직접 호출 금지

**Claude Code surface (verified in research)**:
- Hooks: `~/.claude/settings.json` 또는 project `.claude/settings.json`에 `hooks` 키. `PostToolUse` 매처에 `mcp__<server>__<tool>` 패턴.
- `updatedMCPToolOutput`: hook이 stdout으로 `{hookSpecificOutput: {hookEventName: "PostToolUse", updatedMCPToolOutput: {content: [...]}}}` JSON return하면 tool response가 그걸로 교체됨
- Headless: `claude -p "<prompt>" --output-format stream-json --mcp-config <path>`로 실행 가능

</code_context>

<specifics>
## Specific Ideas

- KILL_SWITCH.md 파일은 commit 후 `git update-index --skip-worktree`로 immutability를 강화 (혹은 단순 readonly chmod). 둘 중 plan에서 결정.
- Canary가 통과하면 `.planning/phases/00-pre-flight-gates/00-CANARY-RESULT.md`에 timestamp + Claude Code 버전 + token + grep result 기록.
- Noise gate 스크립트는 oneshot CLI: `bun run scripts/noise-gate.ts --task <id> --noise-tokens 10000 --runs 5` — 결과는 `00-NOISE-GATE-RESULT.md`로.

</specifics>

<deferred>
## Deferred Ideas

- **Bun 자동 설치**: 사용자에게 명시적 동의 받은 후. Phase 1 시작 전 게이트.
- **Real SWE-bench Pro Docker setup**: 2026-04-22 데드라인 안에 사용자가 별도 시점에 수행. 오늘은 noise gate 스크립트가 SWE-bench Pro instance에 접근 가능한지 import만 dry-run.
- **Custom SWE-bench task selection helper**: noise gate에서 description length 상위 10% 추출하는 코드는 Phase 0에 minimal로, 풍부한 task analysis는 Phase 3.
- **Hook이 transcript JSONL을 직접 mutate하는 시도**: 연구에서 architecturally 불가능 판정. 시도조차 안 함.
- **MCP Apps SDK in-chat preview**: out of scope (PROJECT.md). v2.

</deferred>

---

**Phase 0 exit gate**: KILL_SWITCH.md committed (immutable) + PINNED_VERSIONS.md committed + leakage canary returns 0 hits + noise gate script exists and dry-run succeeds. 4가지 모두 ✓일 때 Phase 1 진행.
