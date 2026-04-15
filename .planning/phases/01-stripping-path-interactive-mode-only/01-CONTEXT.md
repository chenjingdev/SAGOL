# Phase 1: Stripping path (interactive mode only) — Context

**Gathered:** 2026-04-15
**Status:** Ready for planning
**Mode:** Discuss (user delegated decisions, HARD GATE fired live)

<domain>
## Phase Boundary

Phase 1은 SAGOL의 stripping 메커니즘이 실제로 작동함을 **라이브로 증명**하고, 그 결과를 재현 가능하게 만들고, 최소한의 설치/진단 표면으로 감싸는 phase. 코드의 대부분(MCP 서버 스켈레톤, hook 스크립트, canary 인프라)은 Phase 0에서 이미 존재. Phase 1의 핵심은 "증명 + 재현 + 포장"이다.

Phase 1 discuss 도중 HARD GATE pre-task를 이 세션에서 직접 실행했고, 결과로 아키텍처가 한 번 더 피벗됐다 (아래 D-10 참조). 따라서 Phase 1의 실제 scope는 "PostToolUse hook이 fire하는가" 증명이 아니라 "server-side stripping이 interactive + headless 양쪽에서 leak 없이 동작하는가" 증명으로 바뀌었다.

</domain>

<decisions>
## Locked Decisions

### D-10: Stripping은 MCP 서버 안에서 — hook 경로 폐기 (2026-04-15 HARD GATE 결과)
**Context:** Phase 1 discuss 도중 `mcp__sagol__write_report`를 live interactive 세션에서 직접 호출했다. tool response에 128-bit canary 토큰이 본문 전체와 함께 그대로 반환됐다 — 즉 project-local `PostToolUse` hook은 interactive 모드에서도 fire하지 않음. Phase 0의 headless 한계 + 지금 interactive 한계 = project-local hook이 현재 CC 2.1.108 + D-08 준수 상태에서는 어느 모드에서도 로드되지 않는다.

**Decision:** `src/mcp/server.ts`의 `handleWriteReport` 가 직접 stripped form을 리턴하도록 변경. 본문은 디스크 파일(`.sagol/reports/<id>.md`)에만 저장되고, tool response는 `[report:<id>] <title>\n<summary>\n\n(full body: .sagol/reports/<id>.md)` 형태의 ≤500자 문자열만 반환.

**Rationale:** MCP stdio subprocess는 interactive/headless 양쪽에서 동일하게 spawn되므로 서버가 반환하는 내용이 parent agent에게 그대로 전달된다. hook에 의존하지 않으므로 CC의 프로젝트 로컬 hook 로딩 버그와 무관하게 동작한다. 본문은 여전히 디스크에만 있으므로 stripping 가설 자체(본문이 메인 컨텍스트에 안 남음)는 그대로 성립한다.

**Verified:** `bun run scripts/verify-server-strip.ts` — GREEN. 핵심 주장 3개 모두 통과: (a) tool response에 canary 없음, (b) 디스크 파일에 canary 있음, (c) stripped 형태 `[report:<id>] …` 일치. 단 이 검증은 `handleWriteReport`를 직접 import해서 호출한 것이며, 라이브 CC MCP round-trip을 통한 재검증은 CC 세션 재시작이 필요하다 (MCP subprocess가 세션 시작 시 1회 spawn되기 때문). 이건 Phase 1 첫 plan의 첫 verification 단계로 편성.

**Preserved for future:** `scripts/strip-report.ts` 는 삭제하지 않고 references로 남긴다. 미래 CC 버전이 프로젝트 로컬 hook 로딩 버그를 고치면 서버에서 hook으로 다시 옮기는 옵션을 열어둔다. `HEADLESS_HOOK_LIMITATION.md` 의 "Server-side workaround" 섹션이 revival condition을 기록한다.

### D-11: Leakage 검증 방법론 — 반자동 Task() fixture + 트랜스크립트 grep
**Decision:** CAP-03 "5 concurrent sub-agents → 메인 컨텍스트에 본문 0줄" 은 다음 방식으로 검증:
1. `scripts/leakage-check-interactive.ts` — Claude Code 세션 트랜스크립트 JSONL (CC가 로컬에 저장) 을 파싱해서 assistant/user/tool_result 메시지 중 `.sagol/reports/*.md` 의 본문 텍스트가 등장하는 line 수를 카운트
2. 재현 가능한 테스트 프롬프트: 메인 에이전트가 Task() 로 5개 sub-agent를 spawn, 각각이 canary 토큰 포함 보고서를 `sagol_write_report` 로 작성. 테스트 프롬프트는 `.planning/phases/01-…/01-LEAKAGE-CHECK.md` 에 고정 문구로 박음
3. 사용자는 이 프롬프트를 fresh interactive 세션에 붙여넣고 완료 후 `scripts/leakage-check-interactive.ts` 를 실행해서 0 hits 확인
4. 0 hits + 5개 보고서가 디스크에 존재 → Phase 1 CAP-03 gate pass. 결과는 같은 파일에 timestamp와 함께 기록

**자동화 하지 않는 이유:** interactive 모드는 사람이 프롬프트를 붙여 넣어야 하므로 끝까지 수동. 대신 프롬프트 문구와 post-hoc 검증 스크립트를 고정하면 재현성은 보장된다.

### D-12: Caveman lift는 전면 Phase 2로 미룸
**Decision:** Phase 1은 caveman-report 코드를 전혀 lift하지 않는다. `src/mcp/server.ts` 의 `deriveSummary` (first paragraph, naive ≤200 chars) 가 이미 충분하며, Phase 1의 증명 목표는 "stripping이 일어난다"이지 "summary 품질"이 아니다. CAP-05/DASH-05의 ≤200 LOC + 3파일 whitelist 제약은 Phase 2 대시보드 lift에만 적용된다.

**Rationale:** caveman의 watcher/compiler/context는 전부 대시보드 경로 자산이다. Phase 1에는 dashboard가 없다. lift를 억지로 하면 scope creep이며 Phase 1 증명 목표를 흐린다.

### D-13: Install/doctor 스코프 — bunx 한 줄만, plugin manifest는 v1.5
**Decision:** Phase 1의 INST-01/02 "single command install + doctor" 는 다음으로 만족시킨다:
1. `bunx sagol init` (또는 `bun run scripts/init.ts`) — `.mcp.json` + `.claude/settings.json` (stripping은 서버 안이니 hook 등록 불필요, `enabledMcpjsonServers` 만 등록) 을 현재 작업 디렉토리에 생성/업데이트
2. `bunx sagol doctor` — 이미 존재 (`scripts/doctor.ts`). 필요 시 MCP 서버 reachability + 버전 체크 추가
3. README 한 단락 — "어떻게 SAGOL을 내 프로젝트에 붙이나" 설명. Claude Code plugin manifest(`.claude-plugin/`) 는 v1.5+ 로 미룸

**Rationale:** v1 Spike는 본인 머신에서만 동작하면 된다 (PROJECT.md constraint). 정식 배포 surface는 거기에 맞춤. plugin manifest는 멀티 사용자 배포가 의미를 가질 때 의미가 있다.

### D-14: 요약 파생(summary derivation)은 현재 naive deriveSummary 유지
**Decision:** `src/mcp/server.ts` 의 `deriveSummary` 그대로. 첫 non-empty 단락을 공백 정규화 후 ≤200 chars 로 clip. frontmatter에 `summary` 가 있으면 우선, 아니면 이 fallback.

**Not in scope:** tokenizer 도입, `@anthropic-ai/sdk` 호출(금지), LLM-based summarization. 모두 v2.

### D-15: Phase 1 exit gate는 4개
1. `bun run scripts/verify-server-strip.ts` — GREEN (이미 확보, 1회 재확인)
2. Live CC 라운드트립 HARD GATE 재검증 — CC 세션 재시작 후 `mcp__sagol__write_report` 를 한 번 직접 호출해서 tool response에 canary가 없음을 육안으로 확인, 결과를 `01-LIVE-HARDGATE.md` 에 기록
3. `scripts/leakage-check-interactive.ts` + 5-subagent 테스트 프롬프트 — 0 hits 기록을 `01-LEAKAGE-CHECK.md` 에 commit
4. `bunx sagol doctor` GREEN + README 한 단락 install 설명 존재

모두 충족 시 Phase 1 완료, Phase 2로 이동.

### D-16: 벤치마크 un-pivot 옵션은 정보로만 기록 (이번 phase에서는 action 없음)
**Context:** D-10 덕분에 stripping이 MCP 서버 안에 있으므로 **headless 모드에서도 stripping이 작동할 가능성**이 생겼다 (subprocess는 양 모드에서 동일하게 spawn된다). 즉 원래 Phase 0 kill을 override하게 만든 "자동 SWE-bench Pro harness 불가" 전제가 무너졌다.

**Decision for Phase 1:** 이번 phase에서 벤치마크 경로를 재개하지 않는다. 사용자는 이미 "벤치마크 빼버리자 / 앱부터 만들자" 를 명시했다. un-pivot 기회는 HEADLESS_HOOK_LIMITATION.md 의 "Benchmark path implication" 섹션에 기록됐으며 Phase 2 discuss 또는 그 이후에 사용자가 원할 때 꺼낼 수 있는 카드로 남긴다.

### Inherited from Phase 0 (still locked)
- Stack = Bun + TypeScript, MCP SDK ^1.29, `@anthropic-ai/sdk` 금지
- MCP 등록 = `.mcp.json` + `enabledMcpjsonServers` (canonical 프로젝트 스코프 패턴, 확인됨)
- D-08 변경 없음 — `~/.claude/settings.json` 절대 안 건드림. 서버사이드 우회가 D-08을 무효화하지 않고 보존하면서 동일 결과를 냄 → D-08이 더 강해졌다고 볼 수 있음
- 요약 도출은 in-session only (LLM 호출 금지)

</decisions>

<code_context>
## Existing Code Insights

**MCP 서버 (`src/mcp/server.ts`):**
- 이미 `handleWriteReport` + `deriveSummary` 존재. D-10 이후 handler가 `buildStripped` 를 통해 stripped form 반환하도록 변경됨 (de66c83)
- `import.meta.main` 가드 추가 — 모듈을 import해도 `main()` 이 자동 실행되지 않음. 테스트에서 직접 handler import 가능
- `buildStripped` 와 `handleWriteReport` 둘 다 named export — 향후 테스트/재사용 가능

**Hook 스크립트 (`scripts/strip-report.ts`):**
- 기능적으로 정확 — 제대로 된 JSON 입력 주면 stripped 문자열 리턴. Phase 0에서 dry-run으로만 검증됐으나, 지금 `bun run scripts/strip-report.ts < /tmp/sagol-hook-test.json` 으로 직접 실행해도 GREEN
- 단 CC가 interactive + headless 어느 모드에서도 이 스크립트를 invoke 하지 않음 → 코드는 맞지만 경로가 막힘
- **유지 이유:** D-10의 "preserved for future" 노트대로 revival condition 충족 시 재활용

**검증 스크립트 (`scripts/verify-server-strip.ts`):**
- 새로 작성 (de66c83). `handleWriteReport` 를 직접 import해서 canary leak 검증. exit 0/1로 CI-friendly
- Phase 1 첫 plan에서 이걸 unit test 또는 `bun test` 기반으로 정식화할지 결정 (plan 단계 판단)

**Claude Code 설정:**
- 프로젝트 로컬 `.claude/settings.json` 은 `enabledMcpjsonServers: ["sagol"]` 및 PostToolUse hook 매처(mcp__sagol__write_report) 를 가지고 있음
- hook 매처 블록은 D-10 이후 **dead code** 지만 삭제하지 않음 — revival condition 대비 + "여기에 hook이 있었다" 는 역사적 맥락 유지. 다만 Phase 1 첫 plan에서 주석 한 줄 추가해서 "not load-bearing, kept for future CC version revival" 명시하는 걸 권장

**MCP registration (`.mcp.json`):**
- 그대로 정상. Phase 0에서 canonical 패턴(`.mcp.json` + `enabledMcpjsonServers`) 로 확정된 상태 유지

**테스트 인프라:**
- 아직 `bun test` 도입 안 됨. Phase 1에서 최소 3개 테스트(handleWriteReport strip, deriveSummary edge cases, buildMarkdown 프론트매터 정확성) 을 `bun test` 로 정식화할지, 현재의 verify-script 패턴을 유지할지 plan에서 결정

**재활용 가능 자산:**
- `~/dev/caveman-report/src/*` — Phase 2 대상, Phase 1에서는 사용 안 함 (D-12)
- `@modelcontextprotocol/sdk` — 이미 사용 중

</code_context>

<specifics>
## Specific Ideas

- `bunx sagol init` 스크립트는 idempotent여야 함 — 이미 `.mcp.json` / `.claude/settings.json` 이 있으면 덮어쓰지 않고 병합 또는 skip. plan에서 merge 전략 결정
- `scripts/leakage-check-interactive.ts` 는 Claude Code transcript JSONL 경로를 자동 탐지해야 함. macOS 기준 `~/.claude/sessions/*.json` 아래에 있을 가능성 높음 — plan 연구 단계에서 확정
- `01-LIVE-HARDGATE.md` 에는: 실행 일시, CC 버전, Bun 버전, 실제 tool_response 문자열 일부(canary prefix 없이), 파일 ID — 한 화면 분량
- `01-LEAKAGE-CHECK.md` 에는: 5-agent 테스트 프롬프트 정확한 문구, 실행 일시, transcript JSONL 경로, grep 결과 (0 hits 기대), 5개 보고서 파일 ID 목록
- Phase 1 첫 plan의 첫 task는 **CC 세션 재시작 가이드** — 사용자가 CC를 끄고 다시 켜서 새 세션을 시작하면 새 MCP subprocess가 D-10 코드로 spawn됨. 재시작 전 상태에서는 live 재검증 불가

</specifics>

<deferred>
## Deferred Ideas

- **Claude Code plugin manifest (`.claude-plugin/`):** v1.5+ (D-13). 멀티 사용자 배포 시점에 의미
- **Tokenizer 기반 summary:** v2. naive char-clip 으로 충분
- **Dashboard (Phase 2)**: Phase 2가 담당. 지금 건드리지 않음
- **벤치마크 un-pivot (자동 SWE-bench Pro 복귀)**: D-16. 정보로만 기록. Phase 2 이후 결정
- **MCP Apps in-chat iframe:** out of scope (PROJECT.md). v2
- **보고서 taxonomy / auto-classification:** v2
- **전역 `~/.claude/settings.json` 훅 경로:** 명시적으로 거부 — D-08 유지. 서버사이드 우회가 D-08을 무효화하지 않고 동일 결과를 달성
- **plugin install 사용자 trust flow 조사:** 혹시라도 CC가 프로젝트 로컬 hook 을 trust 과정 없이는 로드 안 하는 정책이라면 이 경로도 탐색 가치 있음 — 하지만 서버사이드 우회가 이미 문제를 해결했으므로 긴급하지 않음. 별도 연구 노트로 남김

</deferred>

<canonical_refs>
## Canonical Refs

- `.planning/ROADMAP.md` — Phase 1 goal, success criteria, dependencies
- `.planning/PROJECT.md` — Core Value, Constraints, Key Decisions (D-10/D-11/... will be appended to Key Decisions after Phase 1 commit)
- `.planning/REQUIREMENTS.md` — INST-01, INST-02, CAP-01~05
- `.planning/STATE.md` — current position, decisions log
- `.planning/research/HEADLESS_HOOK_LIMITATION.md` — 아키텍처 finding + server-side workaround + benchmark un-pivot 힌트
- `.planning/research/PITFALLS.md` — hook/MCP 관련 기존 함정 목록 (plan 단계에서 scan)
- `.planning/research/STACK.md` — Bun/TypeScript/MCP SDK 전체 스택 근거
- `.planning/research/PINNED_VERSIONS.md` — CC 2.1.108, Bun 1.3.11 스냅샷
- `.planning/phases/00-pre-flight-gates/00-CONTEXT.md` — Phase 0 decisions 전부 (D-01 ~ D-09)
- `.planning/phases/00-pre-flight-gates/00-CANARY-RESULT.md` — 3회 headless canary 실측 결과
- `src/mcp/server.ts` — 현재 구현 (de66c83)
- `scripts/verify-server-strip.ts` — 검증 스크립트 (de66c83)
- `scripts/strip-report.ts` — 벡시 상 dead, revival 용 보존
- `.claude/settings.json` — hook 블록 dead code 상태로 보존

</canonical_refs>

---

**Phase 1 exit gate (복제):** D-15의 4가지 모두 충족 시 Phase 1 완료, Phase 2로 이동.

**Next step:** `/gsd-plan-phase 1` — planner가 D-15 exit gate를 기준으로 plan들을 분해한다.
