# SAGOL (사골)

## What This Is

SAGOL은 Claude Code Skill/MCP로 동작하는 **에이전트 보고서 라우터 + 컨텍스트 청결 도구**다. 서브에이전트가 생성한 출력을 정형 보고서로 분리해서 브라우저 대시보드로 띄우고, 사용자는 거기서 보고서를 읽고 승인/거절/추가요구를 작성해 터미널과 실시간 양방향으로 주고받는다. 동시에 보고서 본문은 메인 컨텍스트에서 stripping되고 짧은 서머리만 남도록 설계해서 컨텍스트 오염을 줄인다.

이름은 "Claude Code를 사골처럼 쪽쪽 우려먹는다"는 Gemini 대화 밈에서 나왔다. 1차 독자는 한/영 LLM 개발자 커뮤니티(Threads/X/Anthropic 이슈 트래커)이며 문서는 한국어 1차 + 영어 요약 병기를 기본으로 한다.

## Core Value

**보고서 분리 패턴이 컨텍스트 오염을 측정 가능한 만큼 줄이고 그게 Claude Code 기반 에이전트 작업의 품질/토큰/캐시 안정성에 긍정적 영향을 준다는 가설을, 먼저 작동하는 앱을 만들어서 실제로 써보고 직접 비교해서 판단한다.**

**(2026-04-15 pivot)** 원래는 자동화된 SWE-bench Pro harness로 가설을 검증할 계획이었으나 Phase 0 Day-1 canary에서 `claude -p` headless 모드가 프로젝트 로컬 `PostToolUse` 훅을 로드하지 않는다는 아키텍처 한계가 드러났다(`.planning/research/HEADLESS_HOOK_LIMITATION.md`). 자동 harness 경로가 막혔지만 수동 벤치마크 경로는 멀쩡하다 — interactive 세션에서 baseline vs SAGOL 트랜스크립트를 사람 눈으로 비교하거나, baseline 트랜스크립트를 손으로 편집해 stripping이 일어난 상태를 시뮬레이션해서 이어 달리게 하면 된다. v1은 앱을 먼저 완성하고 Phase 2 exit 직후 그 수동 벤치마크 세션을 한 번 돌려서 "계속" 또는 "폐기" 판단을 내린다.

검증이 실패하면(향상 없음/미미함) 프로젝트는 폐기한다. 자동화 수준이 낮아졌다는 이유로 kill-switch 자체를 버리지는 않는다 — 단지 그 방아쇠를 사람이 당긴다.

## Requirements

### Validated

<!-- Shipped and confirmed valuable. -->

(None yet — ship to validate)

### Active

<!-- Current scope. Building toward these (v1 / Spike milestone). All are hypotheses until shipped. -->

- [ ] **R1**: Claude Code Skill/MCP 형태로 SAGOL을 호스트에 attach할 수 있다
- [ ] **R2**: 서브에이전트(또는 hook으로 가로챈 tool 결과) 출력을 markdown 보고서 파일로 캡처한다 — 보고서 frontmatter에 id/title/source/timestamp/summary 포함
- [ ] **R3**: 보고서가 생성되면 메인 대화 컨텍스트에는 짧은 서머리(≤200 토큰)만 남고 본문은 strip된다 — Claude Code hook(PostToolUse/Stop) 또는 SubAgent wrapping으로 구현
- [ ] **R4**: 로컬 HTTP 서버 + WebSocket으로 브라우저 대시보드를 띄운다 — 보고서 리스트, 본문 렌더링, 실시간 추가/업데이트
- [ ] **R5**: 브라우저에서 사용자가 보고서를 승인/거절/추가요구사항 작성 → 터미널의 SAGOL이 그 액션을 받아 다음 에이전트 액션을 트리거할 수 있다 (양방향)
- [ ] **R6**: Phase 2 exit 직후 **수동 벤치마크 세션**을 한 번 돌린다. interactive Claude Code 세션에서 baseline(SAGOL 미장착) vs SAGOL 두 조건을 작은 N(≈5~10 태스크)로 비교하고, 필요시 baseline 트랜스크립트를 손으로 편집해 stripping 시뮬레이션 상태도 추가 비교한다. 결과는 한 문서의 정성 요약 + 간단 수치(토큰/캐시/품질 impression)로 남긴다. 자동화된 eval runner 코드는 v1에 포함하지 않는다
- [ ] **R7**: Spike 결과 리포트 — "이대로 갈지/버릴지" 결정에 충분한 정량+정성 데이터를 한 문서에 모은다
- [ ] **R8**: caveman-report 코드자산(watcher / dashboard server / markdown·frontmatter parser)을 부분 lift해 재활용한다 — zero에서 다시 만들지 않는다
- [ ] **R9**: README 한/영 병기 — 소개/설치/Quick Start/현재 상태(실험 중) 명시

### Out of Scope

<!-- Explicit boundaries. Includes reasoning to prevent re-adding. -->

- **caveman-report식 글자/문장 압축** — caveman의 "AI가 영어로 압축 reasoning" 컨셉은 폐기됐음. SAGOL은 압축이 아니라 분리(report vs context) 전략. 압축은 hypothesis 검증을 흐리고 caveman의 폐기 원인 일부였음
- **Codex/OpenCode 등 비-Claude Code 호스트 통합** — v1은 Claude Code first. 가설 검증이 끝난 뒤 v2+에서 다중 에이전트 라우터로 확장 (R5의 양방향 프로토콜은 이를 염두에 두고 설계해야 하지만 v1에서 실제 통합은 안 함)
- **Custom evaluation framework 자체 제작** — v1에서는 자동화된 eval runner 자체를 만들지 않는다. Phase 0의 headless hook 한계로 자동 harness 경로가 막혔고, 수동 벤치마크 세션으로 대체됨. SWE-bench류 외부 평가 통합은 v2+로 연기
- **Public OSS distribution / npm publish / 멀티 사용자 지원** — v1은 본인 머신에서 가설 검증용. 패키징/배포는 가설 통과 후 별도 마일스톤
- **caveman-report 전체 코드베이스 fork** — 부분 lift만. caveman의 architecture(특히 chat output을 watcher가 줍는 방식)는 그대로 가져오지 않는다
- **글로벌 dashboard / cloud sync** — 로컬 only. 보안/배포 단순화
- **다국어 i18n 시스템** — 보고서 자체는 LLM이 작성하므로 자유. UI는 한/영 정도만 하드코딩

## Context

**기술 환경:**
- Claude Code (Skill, SubAgent, Hooks, MCP) 위에서 동작
- 호스트 OS: macOS (개발자 본인 환경), Linux 호환은 best-effort
- 평가 러너: v1에서는 자동화된 러너 없음. Phase 2 완료 후 사람이 interactive 세션을 직접 돌려 비교 (자동화는 v2+)
- 브라우저: Chromium 계열(Edge/Chrome) 우선, Firefox best-effort

**선행 작업 / 학습:**
- **caveman-report (페기됨, ~/dev/caveman-report)**: SAGOL의 직접 선조. Node + chokidar watcher + Express + WebSocket dashboard 구조였음. 페기 사유는 ① 글자압축 컨셉이 컨텍스트 오염 측정과 섞여서 가설이 흐려졌음 ② "AI가 출력을 chat에 안 남긴다"는 핵심 아이디어가 architecture 수준에서 자연스럽게 통합되지 못함. SAGOL은 동일한 인사이트를 더 깔끔한 분리 모델로 재구현
- **Claude Code KV 캐시 재조사 리포트 v2 (2026-04-11, 현재 gist 공개 중)**: caveman-report에서 만든 분석 산출물. SAGOL은 이런 리포트를 만드는 패턴을 도구 수준에서 자동화하는 게 목적
- 사용자는 Claude Code의 KV 캐시 동작과 컨텍스트 누적 비용을 직접 측정한 경험이 있어, 컨텍스트 오염이 cache break/cost/품질에 미치는 영향에 대한 이해가 깊음

**가설의 출발:**
"메인 대화에 잔여물 거의 안 남기기 + 출력은 외부 정형 산출물로 분리"라는 발상은 caveman 시절부터 일관됨. SAGOL은 그 발상의 두 번째 시도이며, v1에서는 앱을 먼저 완성한 뒤 수동 벤치마크 세션으로 "계속 vs 폐기"를 사람이 판단한다. (원래 계획은 자동 SWE-bench Pro harness였으나 2026-04-15 Phase 0 canary에서 headless hook 한계로 자동 경로가 막혔음 — `.planning/research/HEADLESS_HOOK_LIMITATION.md` 참조.)

## Constraints

- **Tech stack**: Bun + TypeScript — caveman-report 자산 재활용에 가장 친화적, Bun이 native WebSocket/HTTP server/SQLite 내장이라 dashboard 인프라 부하 최소, Claude Code skill 생태계와 동일 언어, single-binary distribution 옵션
- **Host**: Claude Code only (v1) — 다른 호스트 통합은 hypothesis 검증 이후 v2
- **Kill-switch**: Phase 2 exit 직후 수동 벤치마크 세션에서 baseline 대비 의미 있는 향상(token 사용량, task 성공률/품질 인상, cache 안정성 중 최소 1개)이 보이지 않으면 v1 종료 시점에 프로젝트 폐기 — 도구 완성도/UX가 더 좋아지는 건 핑계가 안 됨. 자동화가 아니라 사람이 방아쇠를 당길 뿐 기준은 그대로
- **Timeline**: Spike — 1~2주 안에 "이대로 갈지/버릴지" 결정 가능한 상태 도달이 목표
- **Reuse first**: 새 코드 작성 전에 항상 caveman-report에서 lift 가능 여부 먼저 확인
- **Distribution**: v1은 본인 머신에서만 동작하면 됨. npm publish/다중 사용자 지원/CI 등 distribution 인프라는 v1 범위 밖

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| 이름은 SAGOL (사골) 유지 | Gemini 대화 밈에서 나온 이름. 본인의 정체성/맥락이 담겨있고 폐기된 caveman과 명확히 다른 브랜드 | — Pending |
| caveman-report는 페기, SAGOL은 후속이 아닌 새 시도 | caveman의 압축 컨셉이 가설을 흐렸음. 분리 전략으로 재출발 | — Pending |
| v1 = 앱 우선, 수동 벤치마크는 Phase 2 exit 직후 | 원래는 도구+자동 벤치 병렬이었으나 2026-04-15 Phase 0 headless hook 한계 발견으로 자동 벤치 경로 불가 → 앱 먼저 완성, 사람이 수동으로 판단 | 🔄 Revised 2026-04-15 |
| **Phase 3 제거 (2026-04-15)** | 자동 SWE-bench Pro harness는 headless hook 제약으로 불가. 수동 세션으로 대체되며 별도 코드 phase가 필요 없음. 연구 자료(STACK/ARCHITECTURE 등)는 보존 — 수동 방법론에 재활용 | ✅ Committed 2026-04-15 |
| Stack = Bun + TypeScript | 재활용 친화 + dashboard 인프라 부하 최소 + Claude Code skill 동일 언어. 스택 결정은 사용자가 위임 | — Pending |
| Browser↔Terminal 연동 = Local HTTP + WebSocket | caveman-report 검증된 패턴. Bun에 native 지원 | — Pending |
| Host = Claude Code only (v1) | 다중 에이전트 라우터 비전은 v2+. v1은 hypothesis 검증에 집중 | — Pending |
| 평가는 v1에서 수동 세션, 자동 harness 없음 | Phase 0 headless hook 한계로 자동 경로 불가. 사람이 interactive 세션을 돌려 baseline vs SAGOL을 직접 비교 (트랜스크립트 편집 시뮬레이션도 허용) | 🔄 Revised 2026-04-15 |
| 보고서 본문은 컨텍스트에서 stripping | Core Value의 핵심 메커니즘. 구현은 Hook/SubAgent wrapping 중 Spike에서 결정 | — Pending |
| caveman-report 재활용은 부분 lift | 전체 fork는 architecture 부담. watcher/dashboard/parser만 떼어 옴 | — Pending |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd-transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd-complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority? (특히 kill-switch 결과)
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state (벤치 수치, 사용 경험)

---
*Last updated: 2026-04-15 — app-first pivot, Phase 3 removed, manual benchmark session replaces automated harness*
