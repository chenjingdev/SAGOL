---
title: Stage 1 Case 2 — Corrected methodology verdict
date: 2026-04-16
case: case2_corrected_methodology
methodology_fixes: [tool_use/tool_result structure, no-tool instruction, assistant summary identical both sides]
---

# Stage 1 Case 2 — Verdict

## Setup

- **Filler**: 150K chars from real ezplanet session (323 turns)
- **Report**: 3,232 chars auth architecture review
- **Baseline (full)**: tool_result = full report body (3,232 chars)
- **Treatment (stripped)**: tool_result = stripped marker (136 chars)
- **Shared**: assistant summary text identical in both (219 chars)
- **Followup**: DatePicker timezone bug (independent topic)
- **N**: 3 runs per condition
- **Instruction**: "도구 절대 사용하지 마세요. 텍스트로만 응답하세요."

### Case 1 → Case 2 방법론 수정

| 수정 항목 | Case 1 (잘못됨) | Case 2 (수정) |
|-----------|-----------------|---------------|
| assistant 메시지 | 전체가 report body 또는 placeholder | 양쪽 동일한 요약 텍스트 |
| tool_use/tool_result | 없음 | 있음 |
| 차이점 | assistant 메시지 전체 | tool_result 내용만 |
| 도구 사용 지시 | 없음 (자유) | "절대 사용 금지" |
| N | 1 | 3 |

## 정량 비교

### Tool usage & tokens

| Run | Condition | tool_uses | total_tokens | duration_ms |
|-----|-----------|-----------|--------------|-------------|
| r1  | full      | 22        | 86,829       | 129,528     |
| r2  | full      | 16        | 84,693       | 98,944      |
| r3  | full      | 19        | 86,243       | 126,204     |
| r1  | stripped  | 17        | 84,434       | 114,657     |
| r2  | stripped  | 13        | 82,403       | 91,483      |
| r3  | stripped  | 15        | 82,857       | 101,454     |

| Metric | Full avg | Stripped avg | Delta |
|--------|----------|-------------|-------|
| tool_uses | 19.0 | 15.0 | **-21%** (stripped가 적음) |
| total_tokens | 85,922 | 83,231 | **-3.1%** (stripped가 적음) |
| duration_ms | 118,225 | 102,531 | **-13.3%** (stripped가 빠름) |

**Case 1 도구호출 2.7배 증가는 재현 안 됨.** 오히려 stripped가 도구를 적게 씀. Case 1의 결과는 noise였음 확정.

### 응답 품질

| Dimension | Full (r1/r2/r3) | Stripped (r1/r2/r3) |
|-----------|-----------------|---------------------|
| Root causes listed | 3/3/2 = avg 2.67 | 3/3/3 = avg 3.0 |
| Fix proposals | 3/3/3 = avg 3.0 | 3/3/3 = avg 3.0 |
| Code examples | 6/5/5 = avg 5.3 | 6/4/6 = avg 5.3 |
| Response lines | 82/61/57 = avg 66.7 | 80/74/90 = avg 81.3 |

### 내용 분석

6개 응답 모두 동일한 핵심 진단을 함:
1. useState 초기값에 timezone 캡처 후 미갱신
2. useMemo/useEffect deps에 timezone 누락
3. 서드파티 라이브러리 인스턴스 캐싱

6개 응답 모두 동일한 fix 패턴을 제안:
- A: useEffect deps에 timezone 추가
- B: derived state (useMemo with timezone dep)
- C: key={timezone} 강제 리마운트

### Unique insights (한쪽에만 등장)

| Insight | Full | Stripped |
|---------|------|----------|
| Provider value mutation 체크 | r3에서 언급 | - |
| module-scope caching 강조 | r3에서 언급 | - |
| "파생 상태" + rawDate UTC 패턴 | - | r3에서 언급 |
| moment 라이브러리 언급 | - | r1에서 언급 |
| React.memo 비교 대상 누락 | - | r2에서 언급 |

양쪽 모두 unique insight가 있으나 실질적 차이 없음. 모든 unique insight는 run 간 variance에 해당.

## Verdict

**품질 차이: 없음 (neutral).**

150K 컨텍스트에서 2% 축소 (3,096 chars) — 독립 주제 followup에서 응답 품질 차이 관측 불가.

## Case 1 결과 폐기

Case 1에서 관측된 "도구호출 2.7배 증가"는:
- Case 2에서 재현 안 됨 (오히려 stripped가 21% 적음)
- 원인: Case 1의 서브에이전트 도구 접근 + N=1 noise
- 결론: Case 1 도구호출 데이터 전체 폐기

## 이 테스트가 알려주는 것

1. **2% 축소에서 품질 영향 없음** — 예상대로. 150K 중 3K는 무시할 수 있는 양.
2. **독립 주제 followup은 SAGOL 가설의 쉬운 케이스** — 보고서 내용이 followup과 무관하므로 존재 여부가 영향을 줄 메커니즘이 약함.
3. **stripped가 약간 빠르고 토큰 적음** — 3% 차이. 컨텍스트가 작으면 입력 토큰이 줄어드니 당연.

## 이 테스트가 알려주지 않는 것

1. **보고서 누적 효과** — 보고서 1개 vs 10개 누적 시 차이
2. **관련 주제 followup** — 보고서 내용을 참조해야 하는 followup에서 stripped가 품질 저하를 일으키는지
3. **300K+ 컨텍스트** — 사용자가 가설한 임계점
4. **실제 SWE-bench 태스크** — KILL_SWITCH 기준인 task_success 측정

## 다음 단계 옵션

1. **보고서 누적 테스트** — 보고서 10개를 누적시키고 11번째 followup 품질 비교. 축소 비율이 20%+가 되어 signal이 커짐.
2. **관련 주제 followup (negative control)** — 보고서 내용을 참조해야 하는 질문. stripped에서 품질 저하가 나야 정상 → 테스트 설계 검증.
3. **SWE-bench Pro 직행** — Stage 1 preliminary signal 없이 본 벤치 진행. 리스크: 인프라 구축 비용이 크고 데드라인 4/22.
4. **중단** — 2% 축소에서 signal 없음. 가설이 효과가 있더라도 현실적 사용량(보고서 1-2개/세션)에서는 의미 없는 수준일 가능성.
