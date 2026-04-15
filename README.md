# SAGOL (사골)

**Claude Code 서브에이전트 보고서 라우터 + 컨텍스트 청결 도구.**

Claude Code 세션 안에서 서브에이전트가 만들어내는 긴 보고서를 자동으로 디스크 파일로 분리하고, 메인 에이전트의 컨텍스트에는 한 줄짜리 stripped form (`[report:<id>] <title>\n<summary>`) 만 남긴다. 이를 통해 메인 대화의 컨텍스트 오염을 측정 가능한 만큼 줄이는 게 목적이다. 이름은 "Claude Code를 사골처럼 쪽쪽 우려먹는다"는 Gemini 대화 밈에서 왔다.

> **Status:** v1 Spike — 본인 머신에서만 동작. 멀티 사용자 배포/플러그인 매니페스트는 v2 이후.
> **Last Phase 1 update:** 2026-04-15 — D-10 server-side stripping pivot 이후 앱 우선 작업 중.

## What it does

서브에이전트(또는 임의의 MCP 호환 호출자)가 다음 MCP 툴을 호출한다:

```
mcp__sagol__write_report({
  title: string,
  body: string,    // 보고서 본문 markdown 전체
  source?: string, // "subagent name" 등 출처 태그
})
```

SAGOL MCP 서버(`src/mcp/server.ts`)는:
1. 본문 전체를 `.sagol/reports/<id>.md` 에 frontmatter(id/title/source/timestamp/summary) 포함해서 저장
2. **Tool response로는 stripped form만 반환**:
   ```
   [report:<id>] <title>
   <summary>
   
   (full body persisted to .sagol/reports/<id>.md — read that file only if the summary is not enough to proceed)
   ```

메인 Claude Code 에이전트의 컨텍스트에는 본문이 절대 들어가지 않는다. 필요하면 메인 에이전트가 명시적으로 디스크 파일을 읽게 된다 — 그 읽기 행위 자체가 "본문이 컨텍스트로 올라갔다"는 로그 역할을 한다.

## Architecture note — server-side stripping (2026-04-15 pivot)

v1 최초 설계는 Claude Code의 `PostToolUse` hook + `updatedMCPToolOutput` 으로 stripping을 하려고 했다. Phase 0 canary에서 `claude -p` headless 모드가 프로젝트 로컬 hook을 로드하지 않는다는 한계가 드러났고, Phase 1 HARD GATE에서 interactive 모드도 마찬가지임이 확인됐다. 상세는 [`.planning/research/HEADLESS_HOOK_LIMITATION.md`](./.planning/research/HEADLESS_HOOK_LIMITATION.md) 에 기록돼 있다.

해결은 stripping을 MCP 서버 내부로 옮기는 것이다 — MCP stdio subprocess는 interactive/headless 양쪽에서 동일하게 spawn되므로, 서버가 tool response로 stripped form만 반환하면 hook 로딩 상태와 무관하게 동작한다. `scripts/strip-report.ts` (원래 hook 경로) 는 미래의 Claude Code 버전이 프로젝트 로컬 hook 로딩 버그를 고치는 날을 위해 dormant 상태로 보존돼 있다.

이 피벗은 D-10 으로 `.planning/phases/01-stripping-path-interactive-mode-only/01-CONTEXT.md` 에 기록돼 있다.

## Repository layout

```
.claude/settings.json    Claude Code 프로젝트 로컬 설정 — enabledMcpjsonServers: ["sagol"]
.mcp.json                MCP 서버 등록 (canonical project-scoped 패턴)
.planning/               GSD workflow 아티팩트 (ROADMAP / REQUIREMENTS / STATE / phases/*)
.planning/research/      배경 연구 문서 (STACK, PITFALLS, HEADLESS_HOOK_LIMITATION, KILL_SWITCH...)
.sagol/reports/          쓰여진 보고서 파일들 (gitignored)
src/mcp/server.ts        SAGOL MCP 서버 — handleWriteReport가 server-side stripping 수행
scripts/doctor.ts        환경 + 파일 + 라이브 MCP 핸드셰이크 진단
scripts/verify-server-strip.ts  직접 import 기반 서버사이드 stripping 검증 (GREEN 필수)
scripts/leak-check.ts    세션 트랜스크립트 대상 leak 감사 (현재 세션 상대는 경고만, 과거 세션은 --strict)
scripts/strip-report.ts  Dormant — 미래 hook 경로 revival용 보존
tests/mcp-server.test.ts bun test 유닛 스위트 — buildStripped / deriveSummary / handleWriteReport
```

## Developer commands (this machine)

```bash
bun install             # 한 번만
bun run doctor          # 모든 게이트를 한 번에 확인 (25개 정도 GREEN)
bun run test            # 유닛 테스트 11개
bun run scripts/verify-server-strip.ts   # 직접 import 기반 stripping 증명
bun run scripts/leak-check.ts            # 보고서 본문이 현재 CC 세션 트랜스크립트에 유출됐는지 확인
```

`bun run doctor` 가 GREEN이면 이 저장소의 SAGOL 스택 전체가 건강함을 의미한다.

## What v1 explicitly does NOT ship

- 다른 프로젝트로 SAGOL을 install하는 `bunx sagol init` CLI — v2
- Claude Code `.claude-plugin/` 매니페스트 — v2
- 브라우저 대시보드 + 양방향 feedback — Phase 2
- Caveman-report 코드 lift — Phase 2
- 자동화된 SWE-bench Pro eval harness — 삭제됨. 벤치마크는 Phase 2 완료 후 수동 세션으로
- `@anthropic-ai/sdk` 직접 호출 — 측정 변수 오염 위험, v1 전체 금지

## License / status

아직 배포되지 않음. SAGOL v1은 저자의 개인 머신에서 가설을 실측하기 위한 실험 도구이다. 결과에 따라 폐기되거나 v2로 확장된다.
