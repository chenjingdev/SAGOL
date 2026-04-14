<!-- GSD:project-start source:PROJECT.md -->
## Project

**SAGOL (사골)**

SAGOL은 Claude Code Skill/MCP로 동작하는 **에이전트 보고서 라우터 + 컨텍스트 청결 도구**다. 서브에이전트가 생성한 출력을 정형 보고서로 분리해서 브라우저 대시보드로 띄우고, 사용자는 거기서 보고서를 읽고 승인/거절/추가요구를 작성해 터미널과 실시간 양방향으로 주고받는다. 동시에 보고서 본문은 메인 컨텍스트에서 stripping되고 짧은 서머리만 남도록 설계해서 컨텍스트 오염을 줄인다.

이름은 "Claude Code를 사골처럼 쪽쪽 우려먹는다"는 Gemini 대화 밈에서 나왔다. 1차 독자는 한/영 LLM 개발자 커뮤니티(Threads/X/Anthropic 이슈 트래커)이며 문서는 한국어 1차 + 영어 요약 병기를 기본으로 한다.

**Core Value:** **보고서 분리 패턴이 컨텍스트 오염을 측정 가능한 만큼 줄이고 그게 SWE-bench류 평가에서 baseline 대비 성능 향상으로 이어진다는 가설을, 가장 작은 동작 도구 + 가장 작은 평가 인프라로 빠르게 검증한다.**

이 검증이 실패하면(향상 없음/미미함) 프로젝트는 폐기한다. 도구의 완성도나 UX는 이 검증을 위한 수단이다.

### Constraints

- **Tech stack**: Bun + TypeScript — caveman-report 자산 재활용에 가장 친화적, Bun이 native WebSocket/HTTP server/SQLite 내장이라 dashboard 인프라 부하 최소, Claude Code skill 생태계와 동일 언어, single-binary distribution 옵션
- **Host**: Claude Code only (v1) — 다른 호스트 통합은 hypothesis 검증 이후 v2
- **Kill-switch**: SWE-bench류 표준 평가에서 baseline 대비 의미 있는 향상(token 사용량, task 성공률, cache 안정성 중 최소 1개)이 없으면 v1 종료 시점에 프로젝트 폐기 — 도구 완성도/UX가 더 좋아지는 건 핑계가 안 됨
- **Timeline**: Spike — 1~2주 안에 "이대로 갈지/버릴지" 결정 가능한 상태 도달이 목표
- **Reuse first**: 새 코드 작성 전에 항상 caveman-report에서 lift 가능 여부 먼저 확인
- **Distribution**: v1은 본인 머신에서만 동작하면 됨. npm publish/다중 사용자 지원/CI 등 distribution 인프라는 v1 범위 밖
<!-- GSD:project-end -->

<!-- GSD:stack-start source:research/STACK.md -->
## Technology Stack

## TL;DR Recommendation
## Recommended Stack
### Core Technologies
| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| Bun | 1.3.12 (2026-04-09) | Runtime, package manager, bundler, test runner | Already decided. Native `Bun.serve` covers HTTP + WebSocket in one primitive, `bun:sqlite` is the fastest SQLite binding in JS land (3-6x `better-sqlite3`), `Bun.spawn` handles SWE-bench Python harness cleanly. Removes 4+ deps that caveman-report needed on Node. |
| TypeScript | 5.9.x (bundled with Bun) | Type system | Already decided. Bun ships a transpiler that executes `.ts` directly — no `tsc` build step needed for v1. |
| `@modelcontextprotocol/sdk` | ^1.29.0 (npm, 2026-04-01) | MCP server/client library for exposing SAGOL as an MCP server | Official TypeScript SDK. v1.29 ships `McpServer`/`Client` APIs, stdio + Streamable HTTP transports, and resource/tool/prompt primitives. Runs natively on Bun per the SDK README. |
| `@anthropic-ai/claude-agent-sdk` | ^0.2.104 (npm, 2026-04 daily releases) | Claude Agent SDK for programmatic subagent orchestration from inside the plugin (needed for R3 context stripping experiments) | Official SDK from Anthropic. Exposes `query()` + streaming + hook contracts. v0.2.100+ added `agentProgressSummaries` and `taskBudget` which are directly useful for SAGOL's report-summary pattern. Used only in the eval harness branch where SAGOL drives Claude Code headlessly; inside an interactive Claude Code session the plugin uses hooks/Skills, not this SDK. |
| Claude Code Plugin + Skill system | Built into Claude Code (code.claude.com/docs) | SAGOL's user-facing installation surface | Claude Code plugins can bundle a Skill (SKILL.md), MCP server, and hooks (`PostToolUse`, `Stop`, `SessionStart`) in a single `.claude-plugin/` directory. This is the only supported way to ship a Claude-Code-native tool as of 2026-04. Agent Skills became an open standard in Dec 2025. |
### Bun-Native Primitives (zero-dependency)
| Capability | Bun API | Replaces |
|-----------|---------|----------|
| HTTP server | `Bun.serve({ fetch, websocket })` | `express` (caveman had express ^5.2.1) |
| WebSocket | `server.upgrade(req, { data })` + `websocket` handler in `Bun.serve` | `ws` (caveman had `ws` ^8.20.0) |
| SQLite | `import { Database } from "bun:sqlite"` | `better-sqlite3` |
| File watch | `fs.watch` (Bun's implementation; works for single-dir recursive) | `chokidar` (caveman had `chokidar` ^5.0.0) |
| Spawn Python | `Bun.spawn(["python", "-m", "swebench.harness.run_evaluation", ...])` | `child_process.spawn` |
| Markdown (v2 option) | `Bun.markdown(src)` — CommonMark + GFM, ships in 1.3.8+, ~25x faster than unified | `markdown-it` (but see note below) |
### Supporting Libraries (third-party, must install)
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `gray-matter` | ^4.0.3 | YAML frontmatter parsing on report files | Direct lift from caveman-report. Pure JS, Bun-compatible, battle-tested (Astro/VitePress/Next use it). Parses the `id/title/source/timestamp/summary` frontmatter block R2 specifies. |
| `markdown-it` | ^14.1.1 | Markdown → HTML rendering for the dashboard | Direct lift from caveman-report. Plugin ecosystem (anchor, footnote, task-list) + `highlight.js` integration already wired in `caveman-report/src/compiler.js`. |
| `highlight.js` | ^11.11.1 | Code block syntax highlighting | Direct lift from caveman-report. Server-side highlight keeps the dashboard bundle tiny and lets us reuse the highlight.js CSS theme caveman already shipped. |
| `zod` | ^3.24.x | Runtime validation of MCP tool inputs, hook payloads, report frontmatter schema | Required by `@modelcontextprotocol/sdk` for tool schemas. Already a transitive dep; make it explicit. |
| `commander` | ^14.0.3 | CLI (`sagol serve`, `sagol eval`, `sagol capture`) | Direct lift from caveman-report. Considered alternatives (`citty`, `yargs`); commander is already in the source we're porting, so no reason to churn. |
| `@clack/prompts` | ^1.2.0 | Interactive prompts in CLI (eval run confirmation, kill-switch summary display) | Direct lift from caveman-report. Keeps the UX consistent with the prior tool the user is familiar with. |
| `open` | ^11.0.0 | Launch dashboard in default browser on `sagol serve` | Direct lift. Single-purpose utility, no reason to reimplement. |
### Dashboard UI
| Library | Version | Purpose | Why |
|---------|---------|---------|-----|
| `preact` | ^10.25.x | 3KB React-compatible view layer | Small, no build step required when paired with HTM, integrates with Bun bundler later if dashboard grows. |
| `htm` | ^3.1.x | JSX-in-tagged-templates — removes the JSX compile step | Lets us ship `dashboard.html` + `dashboard.ts` served directly by `Bun.serve` with **zero bundler step in v1**. Critical for Spike velocity. |
| `@preact/signals` | ^2.0.x (optional) | Reactive WebSocket-driven state for the report list | Adopt only if `useState`/`useReducer` becomes ugly once multi-report sync lands. Not on day-one list. |
### Evaluation Harness
| Tool | Version | Purpose | Notes |
|------|---------|---------|-------|
| `swebench` (PyPI) | 2.1.x (latest on PyPI 2026-04) | SWE-bench Verified runner | `pip install swebench`, then `python -m swebench.harness.run_evaluation --dataset_name princeton-nlp/SWE-bench_Verified --predictions_path ... --run_id ...`. Called from Bun via `Bun.spawn`. |
| Docker Desktop / OrbStack | latest | Per-instance test containers for SWE-bench | **Hard dependency.** SWE-bench Verified runs each instance in its own Docker image with the target repo's environment. macOS users should use OrbStack (faster than Docker Desktop). The "1 hour on 1 machine" Epoch AI guide is the canonical reference. |
| Python | 3.11+ | Runs the harness | Required by `swebench`. Install via `uv` or `pyenv`; document both in README. |
| SWE-bench Verified dataset | 500 instances, princeton-nlp/SWE-bench_Verified on HuggingFace | Task set for baseline vs SAGOL comparison | 500 human-verified solvable instances. Preferred over SWE-bench Lite (300, cheaper but noisier) for a kill-switch decision. |
- **SWE-bench Lite (300):** Cheaper but its curation is weaker; signal-to-noise is lower for a pass/fail kill-switch.
- **SWE-Lancer:** Job-market-style tasks, more interesting for product but much harder to wire up in 1-2 weeks and does not have a Python harness as clean as swebench.
- **Aider Polyglot (133):** Tests the *model*, not the *agent orchestration* — Aider has no subagents to strip reports from, so it cannot measure the context-hygiene hypothesis SAGOL is built to test. **Reject for v1.**
- **MultiSWE-Bench:** Multi-language, but still maturing in 2026-04; Python-only is enough for the kill-switch.
- **SWE-bench Pro:** Proprietary behind SEAL; not usable for an open Spike.
### Results Storage & Analysis
| Technology | Version | Purpose | Why |
|-----------|---------|---------|-----|
| `bun:sqlite` | built-in | Per-run eval results database | Built into Bun. Single file, zero deps, fast enough for 500 rows per run. Schema: `runs(id, condition, model, started_at, finished_at)`, `results(run_id, instance_id, passed, tokens_in, tokens_out, cache_read, cache_write, wall_ms, trace_path)`. |
| JSONL | native `Bun.file` append | Raw per-task trace dumps (hook events, report summaries, tool calls) | JSONL for append-only trace streams, SQLite for queryable aggregates. Don't put multi-KB traces inside SQLite rows. |
| DuckDB (CLI) | 1.1.x | Ad-hoc cross-run analysis when comparing 5+ runs | **Not a v1 runtime dep.** Install via `brew install duckdb` and point it at the SQLite file with `ATTACH 'sagol.db' AS s`. Use only when the human wants to slice results interactively. SQLite is enough for the binary kill-switch call. |
### What About the Anthropic SDK Directly?
## Development Tools
| Tool | Purpose | Notes |
|------|---------|-------|
| `bun test` | Unit + integration tests | Replaces `vitest` (caveman had vitest ^4.1.3). Same describe/it API, runs without transformation. Lift caveman tests directly — they usually work after changing the import. |
| `bun build` | Optional bundler if dashboard grows | Not needed in v1 with the import-map approach. |
| `typescript` | ^5.9.x (or Bun's bundled) | Type checking via `bun tsc --noEmit`. Bun executes TS directly but `tsc` is still the reference type checker. |
| `@types/bun` | latest | Bun global types (`Bun.serve`, `bun:sqlite`). Required for TS intellisense. |
| `eslint` + `@typescript-eslint` | latest | Optional, only if the v1 code grows past ~2k LOC. Spike is fine without. |
| Docker / OrbStack | latest | SWE-bench instance sandboxes. OrbStack on macOS. |
| Python 3.11+ + `uv` | latest | `uv pip install swebench` in a managed venv. `uv` is faster than plain pip and keeps the harness install isolated. |
## Installation
# Core runtime — already installed (Bun 1.3.12+)
# Bun project init (inside SAGOL repo)
# Dev dependencies
# Dashboard UI — NO bun add needed if using import-map approach.
# If you'd rather vendor locally:
# and later: bun build ./public/dashboard.ts --target=browser --outfile=public/dashboard.js
# Evaluation harness (separate Python env)
## Alternatives Considered
| Recommended | Alternative | When to Use Alternative |
|-------------|-------------|--------------------------|
| `Bun.serve` | `hono` / `elysia` | Only if you need advanced routing/middleware (auth, rate limiting, openapi). SAGOL's Spike has 5-10 routes, raw `Bun.serve` is fine. |
| `bun:sqlite` | `better-sqlite3` | Only if you need a dependency that doesn't work on Bun yet. `bun:sqlite` is strictly faster. |
| `fs.watch` | `chokidar` (lift from caveman) | Use chokidar **only** if cross-platform recursive watch becomes a problem (macOS FSEvents vs Linux inotify quirks). v1 is local-only, so `fs.watch` is fine. |
| `markdown-it` + `highlight.js` | `Bun.markdown` native | Adopt native when syntax highlighting + theming becomes a problem, likely v2. Native is 25x faster but has no plugin hooks. |
| `gray-matter` | `front-matter`, `@astrojs/markdown-remark`, custom regex | gray-matter is already in caveman-report and supports JSON/TOML/YAML. Don't switch. |
| Preact + HTM (no build) | React + Vite, Lit, Solid | React+Vite is overkill for Spike (adds a build pipeline). Lit is fine but the team is familiar with React semantics; Preact wins on familiarity. Solid has slightly better perf but no no-build story. |
| SWE-bench Verified | SWE-bench Lite, Aider Polyglot, SWE-Lancer | Lite only if Verified is too expensive (it's not — Epoch shows ~1 hour on one machine). Aider tests models not agents — **do not use**. SWE-Lancer is too hard to wire for 1-2 weeks. |
| `bun test` | `vitest` | Only if a lift from caveman hits a vitest-specific API (unlikely for plain unit tests). |
| Claude Code subagent for summarization | `@anthropic-ai/sdk` direct call | Direct call only if eval reproducibility demands a fixed, non-session summarizer. Defer to v1.5+. |
| SQLite for eval results | DuckDB runtime, JSONL only | DuckDB only for interactive post-analysis. JSONL-only loses queryability. SQLite is the sweet spot. |
## What NOT to Use
| Avoid | Why | Use Instead |
|-------|-----|-------------|
| `express` (caveman's choice) | Bun has a native HTTP server; pulling in express adds ~50 transitive deps and bypasses `Bun.serve`'s performance win | `Bun.serve({ fetch, websocket })` |
| `ws` (caveman's choice) | Bun's WebSocket is integrated into `Bun.serve` via `server.upgrade()` | `server.upgrade(req)` + `websocket` handler |
| `chokidar` (caveman's choice) | Works on Bun but is unnecessary extra surface for a local-only Spike | `fs.watch()` (Bun implements it, debounce manually) |
| `better-sqlite3` | `bun:sqlite` is 3-6x faster, zero install, first-party | `import { Database } from "bun:sqlite"` |
| `vitest` (caveman's choice) | `bun test` is faster and built-in; no reason to maintain a second test runner config | `bun test` |
| `node-fetch` / `axios` | `fetch` is global in Bun | Global `fetch` |
| `dotenv` | Bun loads `.env` files automatically | Bun's native env loading |
| React + full Vite pipeline for dashboard | Adds build complexity that fights the "Spike velocity" goal | Preact + HTM + import map |
| Aider polyglot benchmark as the kill-switch | It tests raw model code-gen across languages, not agent orchestration — SAGOL's hypothesis is about agent context management, so Aider literally cannot measure the thing | SWE-bench Verified (agent-level, single repo, Python) |
| Custom in-house eval framework | Out of scope per PROJECT.md; burns Spike time on infrastructure instead of measurement | The `swebench` PyPI package via `Bun.spawn` |
| `@anthropic-ai/sdk` direct calls inside v1 | Moves summarization tokens out of the Claude Code session, breaking what the hypothesis measures | Let Claude Code itself generate summaries via a scoped subagent, then capture via hook |
| MCP Apps SDK (`@modelcontextprotocol/ext-apps` + `@mcp-ui/server`) for the dashboard | It renders UI *inside the Claude Code conversation*, in a sandboxed iframe — but the R4/R5 requirements are for a **separate browser dashboard** that lives outside the conversation so the main context stays clean | Separate local browser dashboard served by `Bun.serve` |
| `gray-matter` custom engine config | Default YAML parser is correct for SAGOL's report frontmatter schema | Defaults |
## Stack Patterns by Variant
- Add `@anthropic-ai/sdk@^0.88.0` with 1-hour cache TTL for eval-only summarization reproducibility
- Migrate dashboard to `bun build` + Preact with a proper bundler pipeline
- Add DuckDB via `duckdb-wasm` for in-browser cross-run analytics
- Consider `Bun.markdown` migration for 25x markdown parse speedup
- Fall back to SWE-bench Lite (300 instances) for inner-loop development
- Keep Verified as the single kill-switch evaluation at end of Spike
- Both use the same `swebench` PyPI package — just change `--dataset_name`
- SWE-bench now has a "SWE-bench Docker" prebuilt image path (see Epoch AI's 1-hour guide)
- Use OrbStack on macOS — noticeably faster than Docker Desktop for SWE-bench workloads
- Do **not** try to run SWE-bench without Docker — the environment isolation is load-bearing for reproducibility
- Fall back to wrapping subagents via `@anthropic-ai/claude-agent-sdk` and capturing their full transcript externally, then injecting only a summary back into the parent session
- The Agent SDK's `agentProgressSummaries` option (added 2026-Q1) is a close match for this pattern and should be the first thing tried
## Version Compatibility Notes
| Package A | Compatible With | Notes |
|-----------|-----------------|-------|
| `@modelcontextprotocol/sdk@^1.29` | Bun 1.3.x | Confirmed by SDK README — runs on Node/Bun/Deno. Use stdio transport for the Claude Code plugin case. |
| `@anthropic-ai/claude-agent-sdk@^0.2.104` | Bun 1.3.x | Runs on Bun; daily releases, pin to a minor version to avoid breakage during Spike. |
| `markdown-it@^14` + `highlight.js@^11` | Bun 1.3.x | Pure JS, no native bindings; direct lift from caveman-report works unchanged. |
| `gray-matter@^4` | Bun 1.3.x | Pure JS. Only issue historically was `js-yaml`'s old versions; v4 uses modern js-yaml and works on Bun. |
| SWE-bench 2.1.x harness | Python 3.11+ | Do **not** run harness on Python 3.12 without verifying — some repo env scripts assume 3.11. |
| Docker on macOS | OrbStack 1.7+ or Docker Desktop 4.40+ | OrbStack strongly preferred for SWE-bench (lower memory pressure, faster container start). |
| Preact 10 + HTM 3 | All modern browsers (2020+) | No build step when loaded via `esm.sh` or `unpkg`. Chrome/Edge/Firefox/Safari supported. |
## caveman-report Asset Reuse Map
| caveman file | SAGOL status | Action |
|--------------|--------------|--------|
| `src/compiler.js` (markdown-it + gray-matter) | **Lift + port to TS** | Drop the `REQUIRED_H2_COUNTS` domain-specific validation. Keep parse/compile functions. |
| `src/watcher.js` (chokidar) | **Rewrite** | Replace chokidar with `fs.watch` + 100ms debounce. Keep the file-event → report-emit logic. |
| `src/server.js` (express + ws) | **Rewrite** | Replace with `Bun.serve({ fetch, websocket })`. Route shape stays similar. |
| `src/context.js` | **Evaluate case by case** | caveman's "context" concept differs from SAGOL's. Only lift the frontmatter→summary extraction. |
| `src/opener.js` (open) | **Lift unchanged** | Single call to `open`, trivial. |
| `bin/cli.js` (commander + @clack/prompts) | **Lift + port to TS** | Commands change (`serve`, `eval`, `capture`), but the CLI scaffolding is reusable verbatim. |
| Theme CSS / highlight.js CSS | **Lift unchanged** | Visual continuity with the user's past tool; zero cost. |
| `cache/` utilities | **Skip** | Not needed for v1 — reports are ephemeral. |
## Sources
### HIGH confidence — Official docs / Context7-equivalent
- [Bun official docs — WebSockets](https://bun.com/docs/runtime/http/websockets) — confirms `Bun.serve` + `server.upgrade` API and WebSocket handler shape
- [Bun official docs — SQLite](https://bun.com/docs/runtime/sqlite) — confirms `bun:sqlite` API and 3-6x perf claim
- [Bun 1.3 release](https://bun.com/blog) + [GitHub releases](https://github.com/oven-sh/bun/releases) — confirms 1.3.12 (2026-04-09) as current
- [@modelcontextprotocol/sdk npm](https://www.npmjs.com/package/@modelcontextprotocol/sdk) — v1.29.0 current, Bun-compatible
- [Claude Code Hooks reference](https://code.claude.com/docs/en/hooks) — PostToolUse/Stop/SessionStart events, JSON I/O contract, exit code semantics
- [Claude Code Skills docs](https://code.claude.com/docs/en/skills) — SKILL.md structure, plugin packaging
- [@anthropic-ai/claude-agent-sdk npm](https://www.npmjs.com/package/@anthropic-ai/claude-agent-sdk) — v0.2.104, `agentProgressSummaries` / `taskBudget` features
- [SWE-bench official quickstart](https://www.swebench.com/SWE-bench/guides/quickstart/) — `pip install swebench`, `python -m swebench.harness.run_evaluation`
- [Epoch AI: SWE-bench Verified in 1 hour on one machine](https://epoch.ai/blog/swebench-docker/) — Docker + OrbStack guidance
- [swebench PyPI](https://pypi.org/project/swebench/) — 2.1.x current
- [gray-matter GitHub](https://github.com/jonschlinkert/gray-matter) — used by Astro/VitePress/Gatsby, pure JS
- [Preact No-Build Workflows guide](https://preactjs.com/guide/v11/no-build-workflows/) — import maps + esm.sh pattern
### MEDIUM confidence — Official blog / announcement, single source
- [MCP Apps blog post (2026-01-26)](https://blog.modelcontextprotocol.io/posts/2026-01-26-mcp-apps/) — MCP Apps is GA; relevant for *rejecting* it as v1 dashboard path
- [Bun 1.3.8 markdown native](https://messageplus.io/blog/engineering/remark-to-bun-markdown-migration-25x-faster) — 25x speedup claim, CommonMark+GFM scope
- [@anthropic-ai/sdk npm v0.88.0](https://www.npmjs.com/package/@anthropic-ai/sdk) — prompt caching via `cache_control: ephemeral`
### LOW confidence — needs live verification before committing
- Exact interaction between Claude Code plugin `hooks:` frontmatter and MCP-provided tools (there's a known upstream bug anthropics/claude-code#13898 stripping MCP tools from agents that have a `tools:` frontmatter restriction — verify whether this affects SAGOL's plugin Skill at implementation time)
- Whether `fs.watch` on macOS picks up atomic-replace writes from Claude Code subagent file writes reliably (test during Phase 1 — fall back to chokidar if flaky)
## Open Questions for Phase Planning
<!-- GSD:stack-end -->

<!-- GSD:conventions-start source:CONVENTIONS.md -->
## Conventions

Conventions not yet established. Will populate as patterns emerge during development.
<!-- GSD:conventions-end -->

<!-- GSD:architecture-start source:ARCHITECTURE.md -->
## Architecture

Architecture not yet mapped. Follow existing patterns found in the codebase.
<!-- GSD:architecture-end -->

<!-- GSD:skills-start source:skills/ -->
## Project Skills

No project skills found. Add skills to any of: `.claude/skills/`, `.agents/skills/`, `.cursor/skills/`, or `.github/skills/` with a `SKILL.md` index file.
<!-- GSD:skills-end -->

<!-- GSD:workflow-start source:GSD defaults -->
## GSD Workflow Enforcement

Before using Edit, Write, or other file-changing tools, start work through a GSD command so planning artifacts and execution context stay in sync.

Use these entry points:
- `/gsd-quick` for small fixes, doc updates, and ad-hoc tasks
- `/gsd-debug` for investigation and bug fixing
- `/gsd-execute-phase` for planned phase work

Do not make direct repo edits outside a GSD workflow unless the user explicitly asks to bypass it.
<!-- GSD:workflow-end -->



<!-- GSD:profile-start -->
## Developer Profile

> Profile not yet configured. Run `/gsd-profile-user` to generate your developer profile.
> This section is managed by `generate-claude-profile` -- do not edit manually.
<!-- GSD:profile-end -->
