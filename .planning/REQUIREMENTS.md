# Requirements: SAGOL (사골)

**Defined:** 2026-04-15
**Core Value:** 보고서 분리 패턴이 컨텍스트 오염을 측정 가능한 만큼 줄이고 그게 SWE-bench류 평가에서 baseline 대비 성능 향상으로 이어진다는 가설을, 가장 작은 동작 도구 + 가장 작은 평가 인프라로 빠르게 검증한다. 검증이 실패하면 프로젝트는 폐기한다.

## v1 Requirements (Spike)

각 requirement는 user-centric / atomic / testable. v1에서 빠지면 kill-switch가 발사 못 하거나 신뢰할 수 없는 항목만 v1에 있음.

### Gate (Phase 0 — 게이트가 통과해야 후속 phase 시작)

- [ ] **GATE-01**: 사용자가 한 줄짜리 가설(single-variable)과 kill 임계값을 `.planning/research/KILL_SWITCH.md`에 commit하면, 그 파일이 immutable 표시되고 Phase 0 진입이 허용된다
- [ ] **GATE-02**: Day 1 leakage canary가 자동 실행되어 — 랜덤 128-bit 토큰을 SAGOL 보고서 본문에 쓴 뒤, 다음 Claude Code API 요청 payload를 grep해서 본문이 나타나지 않음을 확인한다 (실패 시 SAGOL은 그 자리에서 폐기되는 게 설계)
- [ ] **GATE-03**: Noise-sensitivity gate가 자동 실행되어 — baseline long-horizon task 1개에 10k 토큰 garbage를 주입하고 `task_success` 또는 `total_tokens`가 측정 가능하게 변하는지 확인한다 (변하지 않으면 벤치를 바꾼다)
- [ ] **GATE-04**: 사용자가 dated kill ceremony 날짜(예: 2026-04-28)를 `KILL_SWITCH.md`에 박아 commit하면, 그 날짜에 verdict 또는 자동 폐기 두 outcome 중 하나가 강제된다
- [ ] **GATE-05**: 핀 박힌 Claude Code 버전 + Bun 버전이 `.planning/research/PINNED_VERSIONS.md`에 기록되며, 모든 후속 측정 결과의 metadata에 자동 첨부된다

### Install (Phase 1 — Claude Code 호스트에 SAGOL을 attach)

- [ ] **INST-01**: 사용자가 `claude` CLI에서 SAGOL을 single command로 install/enable한다 (Skill manifest + `~/.claude/settings.json`의 hook 등록 + `.mcp.json` MCP 서버 등록이 자동)
- [ ] **INST-02**: 사용자가 SAGOL이 활성화돼 있는지 `bunx sagol doctor`로 확인하면 hook 등록 / MCP 서버 reachable / Skill discoverable 모든 항목이 ✓로 표시된다

### Capture (Phase 1 — 보고서 캡처 funnel)

- [ ] **CAP-01**: 메인 에이전트(또는 서브에이전트)가 MCP tool `sagol_write_report`를 호출하면 markdown 보고서가 `.sagol/reports/<id>.md`에 frontmatter(id/title/source/timestamp/summary) 포함 형태로 저장된다
- [ ] **CAP-02**: 동시에 `PostToolUse` hook (`matcher: mcp__sagol__write_report`)이 `updatedMCPToolOutput`로 tool response를 ≤200 토큰 stripped form (`[report:<id>] <title>\n<summary>`)으로 교체해, 메인 에이전트의 컨텍스트에는 본문이 절대 포함되지 않는다
- [ ] **CAP-03**: 5개의 동시 서브에이전트가 각각 보고서를 작성한 뒤, 메인 에이전트의 메시지 히스토리에 본문 텍스트가 단 한 줄도 포함되지 않음을 leakage canary로 자동 검증한다
- [ ] **CAP-04**: ≤200 토큰 summary는 v1에서는 frontmatter `summary` 필드 또는 첫 단락 naive 추출만 사용한다 — `@anthropic-ai/sdk` 직접 호출은 금지 (off-session summarization은 측정 변수를 바꿈)
- [ ] **CAP-05**: 보고서 파일은 flat `.sagol/reports/*.md` 디렉토리에 저장되며, DB 사용 안 함 (Spike 단순성)

### Dashboard (Phase 2 — 브라우저 inspection 표면)

- [ ] **DASH-01**: 사용자가 `bunx sagol dash`를 실행하면 `Bun.serve`가 `127.0.0.1`의 무작위 free port에 HTTP+WebSocket 서버를 띄우고 stderr에 per-session URL token이 포함된 dashboard URL을 출력한다
- [ ] **DASH-02**: 브라우저에서 dashboard에 접속하면 `.sagol/reports/`의 모든 보고서 list가 나타나고, 새 보고서가 추가되면 WebSocket으로 실시간 push된다
- [ ] **DASH-03**: 사용자가 list에서 보고서를 클릭하면 markdown이 (markdown-it + highlight.js로) 가독성 좋게 렌더링된다
- [ ] **DASH-04**: 다른 머신/로컬 다른 호스트에서 dashboard port에 `curl`해도 접근 차단된다 (URL token 검증 + 127.0.0.1 binding)
- [ ] **DASH-05**: caveman-report에서 lift 가능한 컴포넌트는 `watcher.js` / `compiler.js` / `context.js`만이며 총 LOC ≤ 200, 그리고 최종 코드에서 `caveman|compressed|telegraphic|er/` grep이 0 hit이다

### Feedback (Phase 2 — 양방향 sync)

- [ ] **FB-01**: 메인 에이전트가 MCP tool `sagol_await_feedback({reportId})`을 호출하면 SAGOL은 in-process Promise waiter를 등록하고 응답을 보류한다 (blocking)
- [ ] **FB-02**: 사용자가 dashboard에서 해당 보고서에 대해 승인/거절/추가요구사항 텍스트를 작성해 submit하면, 그 내용이 WebSocket(또는 POST `/api/feedback`)으로 SAGOL로 전달되고 Promise가 resolve되어 tool 결과로 에이전트에게 반환된다
- [ ] **FB-03**: 사용자가 10분 이내 응답하지 않으면 default `"(no feedback — proceed)"`로 timeout한다
- [ ] **FB-04**: action_id dedup으로 사용자의 중복 submit이 한 번만 적용되며, dashboard 탭이 background로 갔다가 돌아왔을 때 `visibilitychange`로 server-authoritative state를 재동기화한다
- [ ] **FB-05**: Eval/benchmark mode에서는 `sagol_await_feedback`가 자동 bypass되어 항상 즉시 `"(no feedback — proceed)"`를 반환한다 (벤치 결과 오염 방지)

### Eval (Phase 3 — kill-switch가 실제로 발사)

- [ ] **EVAL-01**: 사용자가 `bunx sagol eval --mode {baseline|sagol} --tasks N`을 실행하면 `Bun.spawn`으로 `claude -p --bare --mcp-config <pinned>`와 `python -m swebench.harness.run_evaluation`가 host shell에서 spawn되고, 결과가 filesystem-boundary로 SAGOL eval store에 기록된다
- [ ] **EVAL-02**: SAGOL은 SWE-bench Pro를 primary headline benchmark로 사용하며, SWE-bench Verified는 contamination-aware smoke set으로만 사용한다
- [ ] **EVAL-03**: baseline 조건과 SAGOL 조건이 동일 task set, 동일 모델/Claude Code 버전, 동일 day 안에서 interleaved로 3 runs씩 실행된다 (각 run의 random seed 기록)
- [ ] **EVAL-04**: 각 task 결과는 `{task_success, total_tokens, cache_creation_input_tokens, cache_read_input_tokens, wall_ms}` 모두를 row 단위로 SQLite(`.sagol/eval.sqlite`)에 기록한다
- [ ] **EVAL-05**: `bunx sagol eval report`가 baseline vs SAGOL diff를 markdown으로 출력하며, variance(IQR/std), per-task delta, sample size, contamination warnings를 포함한다
- [ ] **EVAL-06**: Eval harness 코드 자체는 ≤300 LOC hard cap. 초과 시 무엇을 잘라낼지 PR/commit 메시지에 명시한다
- [ ] **EVAL-07**: Eval은 SAGOL의 dashboard 컴포넌트를 일절 거치지 않고(`bunx sagol eval`이 standalone) 실행되어, 측정 환경이 dashboard side effect로 오염되지 않음을 코드 수준에서 보장한다

### Doc (Phase 3 — Spike 결론을 문서로)

- [ ] **DOC-01**: `SPIKE-RESULTS.md`에 (a) 가설 한 줄 (b) 사용한 벤치/세팅 (c) baseline vs SAGOL 결과 표 (d) variance (e) 한 문장 verdict("계속" 또는 "폐기")이 commit된다
- [ ] **DOC-02**: README가 ko/en 병기로 작성되어 — SAGOL이 무엇이고, 현재 상태(실험 중/폐기/계속)가 명확하며, install/quick start와 reproducibility 안내가 포함된다
- [ ] **DOC-03**: dated kill ceremony 날짜에 verdict가 commit돼 있거나, "verdict 못 만듦 → 자동 폐기"가 commit된다 (이 commit이 v1 마일스톤 종료의 정의)

## v2 Requirements (deferred — Spike 통과 후에만 의미)

### Multi-host

- **MHOST-01**: Codex CLI가 출력한 보고서를 SAGOL dashboard로 ingest (file drop 또는 HTTP POST)
- **MHOST-02**: OpenCode 등 다른 에이전트 host에서 SAGOL MCP 서버로 보고서 forward
- **MHOST-03**: dashboard 한 창에서 여러 호스트의 보고서를 하나의 stream으로 표시

### Smarter summarization

- **SUMR-01**: 별도 SAGOL agent가 in-session에서 보고서를 읽고 압축 요약 생성 (여전히 off-session SDK 사용 안 함)
- **SUMR-02**: Report taxonomy (bug/feature/review/general) — 자동 분류 또는 frontmatter 입력

### Distribution

- **DIST-01**: `npm publish` 또는 `bun install -g sagol`로 다른 사용자 머신에 install
- **DIST-02**: SAGOL doctor가 SWE-bench/Docker/Claude Code 버전 호환성을 자동 점검하고 fix 가이드를 출력

### Observability (post-Spike)

- **OBS-01**: OpenTelemetry trace 통합 — Langfuse/Helicone/Phoenix와 호환되는 spans 출력
- **OBS-02**: 보고서 자체에 대한 evaluation (LLM-as-judge로 보고서 품질 측정)

## Out of Scope

| Feature | Reason |
|---------|--------|
| caveman식 글자/문장 압축 | caveman 페기 사유. SAGOL은 "분리"이지 "압축"이 아님. 두 컨셉을 섞으면 가설이 unfalsifiable해짐 |
| 비-Claude Code 호스트 통합 (v1) | v1은 Claude Code first. multi-host는 v2+ |
| Custom evaluation framework 자체 제작 | SWE-bench 등 표준을 child_process로 호출. 자체 eval framework 만들지 않음 |
| `@anthropic-ai/sdk` 직접 호출 (summary 생성용 포함) | off-session summarization은 측정 변수를 바꿔 kill-switch 무효화 |
| MCP Apps in-chat iframe | dashboard는 외부 브라우저 창. in-chat widget은 hypothesis 측정과 무관 |
| Auto-shutdown after idle | benchmark mode에서 dashboard가 죽으면 안 됨. caveman의 10-min idle 패턴 의도적 비활성화 |
| 보고서 type taxonomy / 자동 분류 | v1에서는 plain frontmatter only. taxonomy는 v2 |
| 글로벌 dashboard / cloud sync / 멀티 사용자 | local-only. v1은 본인 머신에서 hypothesis 검증용 |
| OpenTelemetry / Langfuse 통합 | v1 kill-switch에 무관. v2 |
| MCP Apps SDK UI resource 사용 | v1 dashboard는 vanilla `Bun.serve` + Preact + HTM (import map). MCP Apps는 v2 후보 |
| `npm publish` / 패키지 배포 | v1은 본인 머신에서만 동작. distribution은 hypothesis 통과 후 |
| caveman-report 전체 fork | 전체 fork는 architecture 부담 + 페기 컨셉 오염. 부분 lift만 (`watcher.js` / `compiler.js` / `context.js` 한정 ≤200 LOC) |
| 보고서 KV cache forensics 재통합 | 별도 분석 작업이며 SAGOL의 가설과 무관 |
| Hook으로 Bash/Read/Write/Edit 출력 stripping | 기술적으로 불가능 — `updatedMCPToolOutput`는 MCP tool에만 적용. 시도 자체가 anti-pattern |
| Off-session summarizer | 측정 변수 오염. ALL summarization stays in-session |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| GATE-01 | Phase 0 | Pending |
| GATE-02 | Phase 0 | Pending |
| GATE-03 | Phase 0 | Pending |
| GATE-04 | Phase 0 | Pending |
| GATE-05 | Phase 0 | Pending |
| INST-01 | Phase 1 | Pending |
| INST-02 | Phase 1 | Pending |
| CAP-01 | Phase 1 | Pending |
| CAP-02 | Phase 1 | Pending |
| CAP-03 | Phase 1 | Pending |
| CAP-04 | Phase 1 | Pending |
| CAP-05 | Phase 1 | Pending |
| DASH-01 | Phase 2 | Pending |
| DASH-02 | Phase 2 | Pending |
| DASH-03 | Phase 2 | Pending |
| DASH-04 | Phase 2 | Pending |
| DASH-05 | Phase 2 | Pending |
| FB-01 | Phase 2 | Pending |
| FB-02 | Phase 2 | Pending |
| FB-03 | Phase 2 | Pending |
| FB-04 | Phase 2 | Pending |
| FB-05 | Phase 2 | Pending |
| EVAL-01 | Phase 3 | Pending |
| EVAL-02 | Phase 3 | Pending |
| EVAL-03 | Phase 3 | Pending |
| EVAL-04 | Phase 3 | Pending |
| EVAL-05 | Phase 3 | Pending |
| EVAL-06 | Phase 3 | Pending |
| EVAL-07 | Phase 3 | Pending |
| DOC-01 | Phase 3 | Pending |
| DOC-02 | Phase 3 | Pending |
| DOC-03 | Phase 3 | Pending |

**Coverage:**
- v1 requirements: 31 total
- Mapped to phases: 31 (pre-mapped — roadmapper will confirm)
- Unmapped: 0

---
*Requirements defined: 2026-04-15*
*Last updated: 2026-04-15 after initial definition*
