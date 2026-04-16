# SAGOL (사골)

**Status: v1 폐기 (2026-04-16)**

Claude Code 서브에이전트 보고서 라우터 + 컨텍스트 청결 도구. 서브에이전트가 만드는 긴 보고서를 디스크 파일로 분리하고, 메인 에이전트 컨텍스트에는 stripped marker만 남기는 MCP 서버.

이름은 "Claude Code를 사골처럼 쪽쪽 우려먹는다"는 Gemini 대화 밈에서 왔다.

## 가설

> 서브에이전트 보고서 본문을 메인 컨텍스트에서 제거하면 후속 응답 품질이 올라간다.

정식 버전 (KILL_SWITCH.md):
> PostToolUse hook + updatedMCPToolOutput으로 서브에이전트 보고서 본문을 메인 컨텍스트에서 제거하면 SWE-bench Pro task_success가 baseline 대비 +3%p 이상 올라간다.

## 구현

MCP 서버(`src/mcp/server.ts`)가 `write_report` 도구를 제공. 본문은 `.sagol/reports/<id>.md`에 저장하고, tool response로는 `[report:<id>] <title>` stripped form만 반환. 본문이 애초에 메인 컨텍스트에 들어가지 않는 구조.

대시보드(`src/dash/`)는 보고서를 브라우저에서 열람하고 approve/reject/revise 피드백을 보내는 UI.

## 벤치마크 결과 — 효과 없음

### Stage 1 Case 1 (방법론 오류 → 폐기)

- 벤치마크 설계 자체가 SAGOL 메커니즘을 테스트하지 않았음
- assistant 메시지 전체를 교체하는 방식 (SAGOL은 tool_result만 strip)
- 서브에이전트에 도구 접근 허용 → 도구호출 2.7배 증가 관측 → noise로 판명
- 상세: `.planning/research/bench-stage1/case1_verdict.md`

### Stage 1 Case 2 (수정된 방법론)

설계:
- 150K chars 실제 세션 filler + 합성 보고서 3,232 chars
- baseline: tool_result에 full body / treatment: tool_result에 stripped marker 136 chars
- assistant 요약 텍스트 양쪽 동일, tool_use/tool_result 구조 포함
- N=3 per condition, "도구 사용 금지" 명시

결과:

| Metric | Full (baseline) avg | Stripped (treatment) avg | Delta |
|--------|---------------------|--------------------------|-------|
| tool_uses | 19.0 | 15.0 | -21% |
| total_tokens | 85,922 | 83,231 | -3.1% |
| duration_ms | 118,225 | 102,531 | -13.3% |
| 응답 품질 | neutral | neutral | 차이 없음 |

- 6개 응답 전부 동일한 root causes (3개), 동일한 fix proposals (3개), 동일한 코드 예시 패턴
- Case 1의 도구호출 증가는 재현 안 됨 (오히려 stripped가 적게 씀)
- 상세: `.planning/research/bench-stage1/case2_verdict.md`

## 폐기 사유

1. **축소 비율이 너무 작음.** 세션당 보고서 3-5개 × 3K = 15K chars. 200K+ 토큰 컨텍스트에서 3-5%. 모델이 이 정도 차이를 체감할 메커니즘이 약함.
2. **현대 모델은 긴 컨텍스트를 잘 처리함.** 무관한 텍스트가 있어서 품질이 떨어지는 게 아니라, 관련 정보를 못 찾는 게 문제. 보고서 본문 제거는 후자에 해당 안 함.
3. **KILL_SWITCH 기준 달성 불가.** task_success +3pp + 토큰 증가 0%. 2% 컨텍스트 축소로는 현실적 경로 없음.
4. **토큰 절약은 미미.** stripped가 3.1% 적게 썼지만, 보고서 안 쓰고 짧게 답하는 것과 차이 없음.
5. **UX 가치는 있으나 벤치마크 가설과 무관.** 보고서가 대시보드에 정리되는 건 편리하지만, "컨텍스트 청결이 품질을 올린다"는 가설은 지지되지 않음.

## 타임라인

| 날짜 | 사건 |
|------|------|
| 2026-04-07 | 프로젝트 시작, GSD 워크플로우 초기화 |
| 2026-04-12 | Phase 0 완료 — PostToolUse hook 한계 발견, server-side stripping pivot |
| 2026-04-13 | Phase 1 완료 — MCP 서버 + stripping + canary GREEN |
| 2026-04-15 | Phase 2 완료 — 대시보드 + await_feedback + doctor |
| 2026-04-15 | Phase 3 시작 — KILL_SWITCH 작성, Stage 1 벤치마크 |
| 2026-04-16 | Stage 1 Case 1 실행 → 방법론 오류 발견 → Case 2 재설계/실행 → 효과 없음 확인 |
| 2026-04-16 | **v1 폐기** |

## 남는 것

- `src/mcp/server.ts` — server-side stripping MCP 서버 패턴. 다른 프로젝트에서 MCP tool response를 가공하는 레퍼런스로 활용 가능.
- `src/dash/` — Preact + Hono 기반 경량 대시보드. 보고서 열람/피드백 UI.
- `.planning/research/KILL_SWITCH.md` — 가설 검증 프레임워크. pre-registered criteria + dated kill ceremony 패턴.
