# Phase 1: Stripping path (interactive-mode only) — Research

**Researched:** 2026-04-15
**Domain:** Claude Code session transcripts, MCP stdio lifecycle, Task/sub-agent spawning, Bun test runner, init/doctor ergonomics
**Confidence:** HIGH for transcript layout + MCP lifecycle + sub-agent limits (verified against live filesystem + official CC docs); MEDIUM for `bun test` trade-off (verified against Bun docs, recommendation is a judgment call); HIGH for idempotent JSON merge strategy

---

## Summary for Planner

Seven actionable findings the planner should pin into task structure:

1. **Transcript JSONL is at `~/.claude/projects/<slugged-cwd>/<sessionId>.jsonl`.** Slug rule: replace `/` in `cwd` with `-` and prepend a `-`. For this project: `~/.claude/projects/-Users-chenjing-dev-sagol/<sessionId>.jsonl`. `~/.claude/sessions/<pid>.json` is the `pid → sessionId + cwd + startedAt + kind` index — `leakage-check-interactive.ts` should read it to auto-discover the newest interactive session for the current cwd. Sub-agent transcripts additionally live under `~/.claude/projects/<slugged-cwd>/<sessionId>/subagents/agent-<id>.jsonl` with a sibling `.meta.json` (agentType + description). **The main JSONL does NOT include sub-agent bodies — those stay in the subagents/ dir** — which is exactly what SAGOL's hypothesis claims, and the leakage-check script should grep both the main transcript *and* all subagents/*.jsonl files in the same session. [VERIFIED: live `ls` + `jq` on `~/.claude/projects/-Users-chenjing-dev-sagol/`]

2. **Five concurrent sub-agents fits inside one Task batch — CC caps parallelism at 10.** 5 is safely under the limit and runs in a single batch (no queueing). Sub-agents that reference an existing MCP server by string name (e.g. `mcpServers: ["sagol"]`) **share the parent session's MCP connection**, so all 5 sub-agents hit the same `src/mcp/server.ts` process and the same stripped-response code path. The test fixture does not need to spawn 5 separate MCP servers. [CITED: code.claude.com/docs/en/sub-agents — "String references share the parent session's connection"; concurrency cap from multiple 2026 community articles + CC GitHub issue #15487]

3. **There is no `/reload` or `/mcp restart` for stdio servers.** To pick up edits to `src/mcp/server.ts`, the user must quit Claude Code and start a new session. `list_changed` notifications only refresh tool/prompt/resource *schemas* within an already-connected server, not the subprocess itself. `/reload-plugins` only applies to plugin-bundled MCP servers, not project `.mcp.json` entries. **The first Phase 1 plan's first task MUST be "ask user to restart Claude Code, then fire one live `mcp__sagol__write_report` call, then record result in `01-LIVE-HARDGATE.md`."** [CITED: code.claude.com/docs/en/mcp; WebSearch confirmed anthropics/claude-code#17675 feature request for a `/restart` that doesn't exist yet]

4. **Keep `scripts/verify-server-strip.ts` as a standalone script AND add a parallel `bun test` suite — don't migrate, duplicate.** The verify-script is the canonical live direct-import check called by doctor and CI; `bun test` adds unit-level coverage for `buildStripped`, `deriveSummary`, and `buildMarkdown` edge cases (empty body, unicode title, frontmatter YAML escaping, ≤200 clipping, no-op on single-paragraph short body). Both run fast. Rationale: the verify-script's exit-code contract is already consumed by `scripts/doctor.ts` as a reachability proxy; converting it to a test file would force the planner to also rewrite doctor, and that's scope creep. `bun test` adds value by forcing coverage of the three functions the hypothesis depends on. [VERIFIED: bun.com/docs/test/writing — Jest-compatible `describe/it/expect` with `import ... from "bun:test"`]

5. **`bunx sagol init` default = merge, skip-if-key-exists, never hard-overwrite.** For `.mcp.json`: if the file exists, parse JSON, preserve all existing `mcpServers.*` entries, add/replace only the `sagol` entry. For `.claude/settings.json`: same treatment — preserve everything, add `"sagol"` to `enabledMcpjsonServers` array if missing, leave existing hooks/permissions untouched. Use a simple shallow-merge helper (no lodash). Write back with `JSON.stringify(merged, null, 2)` + trailing newline. Dry-run flag (`--dry-run`) prints the diff without writing. This is safer than overwrite (protects customizations) without being as annoying as skip-if-exists (the user doesn't need to manually edit). [VERIFIED: pattern is ~30 LOC with zero deps — see "Idempotent init recipe" section below]

6. **`scripts/doctor.ts` should gain exactly three checks, cap remains ≤150 LOC.** (a) `verify-server-strip.ts` exit code — the authoritative stripping proof, not file-existence theater. (b) `.mcp.json` JSON well-formedness + presence of `sagol.command = "bun"` entry. (c) `.claude/settings.json` has `"sagol"` in `enabledMcpjsonServers`. Do NOT attempt to actually spawn the MCP server and send a JSON-RPC `initialize` handshake — the direct-import verify-script already exercises the handler, and a spawn-with-initialize path adds 80+ LOC for a redundant signal. [JUDGMENT: minimizes LOC while covering all exit-gate failure modes]

7. **Canonical refs the planner + executors must read.** (See "Canonical Refs" section at the bottom.) Two new files become load-bearing: `01-LIVE-HARDGATE.md` (exit-gate receipt) and `01-LEAKAGE-CHECK.md` (reproducible prompt + grep result). These do not exist yet — they are produced by the Phase 1 plans.

---

## User Constraints (from CONTEXT.md)

### Locked Decisions (D-10 through D-16, all locked 2026-04-15)

- **D-10:** Stripping is inside `src/mcp/server.ts` (`handleWriteReport` returns stripped form). The `PostToolUse` hook path is dead code. `scripts/strip-report.ts` and the hook block in `.claude/settings.json` are preserved dormant with a comment flag, not deleted.
- **D-11:** Leakage verification is **semi-automated**: fixed prompt text in `01-LEAKAGE-CHECK.md` + user-driven 5-subagent run in a fresh interactive session + post-hoc `scripts/leakage-check-interactive.ts` that parses the transcript JSONL and asserts 0 body-text hits.
- **D-12:** **No caveman-report code lift in Phase 1.** `deriveSummary` is sufficient. Caveman lift is entirely Phase 2.
- **D-13:** Install surface is `bunx sagol init` + `bunx sagol doctor` + README paragraph. No `.claude-plugin/` manifest (v1.5+).
- **D-14:** Summary derivation stays as the current naive `deriveSummary` (≤200 char clip). No tokenizer, no `@anthropic-ai/sdk`.
- **D-15:** Phase 1 exit gate = 4 items: verify-server-strip GREEN, live CC round-trip recorded, 5-subagent leakage check recorded, doctor GREEN + README paragraph.
- **D-16:** Benchmark un-pivot is informational only — no action this phase.

### Claude's Discretion
- Whether `bun test` is adopted in Phase 1 (this research recommends yes, additive, not a migration).
- Exact JSON merge implementation shape for init.
- Doctor's extra checks, bounded by ≤150 LOC.
- How the leakage-check script handles the `~/.claude/projects/<slug>/<sessionId>/subagents/*.jsonl` subdirectory (this research recommends: grep both main + all subagents files in the same session).

### Deferred Ideas (OUT OF SCOPE for Phase 1)
- Caveman lift (Phase 2)
- Dashboard / `bunx sagol dash` (Phase 2)
- Plugin manifest `.claude-plugin/` (v1.5+)
- Tokenizer-based summary (v2)
- `@anthropic-ai/sdk` direct calls (forbidden in v1)
- Benchmark methodology (manual session, post-Phase 2)
- MCP Apps in-chat iframe (v2)
- Hook revival (only if a future CC version fixes project-local hook loading)

---

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| INST-01 | Single-command install attaches SAGOL to a Claude Code project | Finding 5 (idempotent merge for `.mcp.json` + `.claude/settings.json`) + D-13 bounds scope to `bunx sagol init` |
| INST-02 | `bunx sagol doctor` confirms SAGOL is active | Finding 6 (doctor gains verify-strip + JSON well-formedness + `enabledMcpjsonServers` check) |
| CAP-01 | Report tool produces `.sagol/reports/<id>.md` with frontmatter | Already implemented in `handleWriteReport` (de66c83); Phase 1 bun tests lock behavior |
| CAP-02 | Main agent context sees only the stripped form | Finding 1 + Finding 3 (server-side strip works when session is fresh; transcript JSONL grep confirms) |
| CAP-03 | 5 concurrent sub-agents leave 0 body text in main transcript | Finding 1 + Finding 2 (sub-agents share parent MCP connection; leakage-check script greps main + subagents JSONLs) |
| CAP-04 | Summary is naive, in-session only | D-14 locked; no research needed |
| CAP-05 | Reports stored as flat files, no DB | Already implemented; only thing to verify in doctor is `.sagol/reports/` is writable |

---

## 1. Claude Code Transcript JSONL — Location & Structure

**Canonical path layout on macOS (verified 2026-04-15 against CC 2.1.108):**

```
~/.claude/
├── sessions/
│   └── <pid>.json              # live pid → session index (tiny, single-line JSON)
├── projects/
│   └── <slugged-cwd>/          # slug = cwd with every '/' replaced by '-'
│       ├── <sessionId>.jsonl   # MAIN session transcript (append-only)
│       ├── <sessionId>/        # per-session sub-directory (created lazily)
│       │   ├── subagents/
│       │   │   ├── agent-<id>.jsonl       # sub-agent transcript
│       │   │   └── agent-<id>.meta.json   # {agentType, description}
│       │   └── tool-results/
│       │       └── toolu_<id>.txt         # persisted spillover of large tool outputs
```

For this project the slug is `-Users-chenjing-dev-sagol` (confirmed via `ls ~/.claude/projects/`).

### `~/.claude/sessions/<pid>.json` — the discovery index

Single-line JSON, example (real data from this session):

```json
{"pid":94878,"sessionId":"b152b7cc-4d78-455a-b51b-7eba9caa92f0",
 "cwd":"/Users/chenjing/dev/sagol","startedAt":1776210970581,
 "kind":"interactive","entrypoint":"cli",
 "bridgeSessionId":"session_01EBjLQtCjUop38RNfrsUnwc"}
```

Fields: `pid`, `sessionId`, `cwd`, `startedAt` (epoch ms), `kind` (`interactive` | `headless`), `entrypoint`, `bridgeSessionId`. **The discovery strategy for `scripts/leakage-check-interactive.ts`:**

1. Read every file in `~/.claude/sessions/*.json`.
2. Filter to `cwd === <current working directory>` and `kind === "interactive"`.
3. Sort by `startedAt` descending — pick the newest.
4. Construct transcript path: `~/.claude/projects/${slug(cwd)}/${sessionId}.jsonl`.
5. Also enumerate `~/.claude/projects/${slug(cwd)}/${sessionId}/subagents/*.jsonl`.

Slug function (straightforward, no surprises):
```ts
const slug = (p: string) => "-" + p.replace(/^\//, "").replace(/\//g, "-");
// "/Users/chenjing/dev/sagol" -> "-Users-chenjing-dev-sagol"
```

### Main `<sessionId>.jsonl` structure

The transcript is JSONL with these top-level `type` values (measured on a real 400+ line file from 2026-04-15):

| type | purpose | relevant fields |
|------|---------|-----------------|
| `permission-mode` | one-off header | `permissionMode`, `sessionId` |
| `attachment` | hook event receipts, session-start metadata | `attachment.hookEvent`, `attachment.content` |
| `file-history-snapshot` | file edit tracking | `snapshot.trackedFileBackups` |
| `user` | user messages + **tool_result blocks from main agent's tools** | `message.content` (array of blocks) |
| `assistant` | model turns (thinking + text + tool_use blocks) | `message.content` (array) |
| `system` | hook firing notifications, slash commands, stop reasons | `subtype`, `hookInfos`, `hookErrors` |
| `queue-operation` | prompt queueing | `operation`, `content` |

**The fields that matter for a leakage grep:**

- `assistant.message.content[*]` where `type === "text"` → assistant-visible text
- `assistant.message.content[*]` where `type === "tool_use"` → tool input (this leaks into context too! — report bodies passed as `body:` param would appear here)
- `user.message.content[*]` where `type === "tool_result"` and `content` is a string → **this is the channel the hook was supposed to rewrite**. For the current server-side path, this field should only ever contain the stripped `[report:<id>] ...` string.
- `user.message.content[*]` where `type === "tool_result"` and `content` is an array of `{type:"text", text:"..."}` blocks → same check, nested.

**Anti-target fields:** `assistant.message.content[*].type === "thinking"` is encrypted/opaque and cannot be grepped. This is fine — thinking blocks are not context the next turn sees, so they don't count as leakage.

### Sub-agent JSONLs

`~/.claude/projects/<slug>/<sessionId>/subagents/agent-<id>.jsonl` has the same `type: user|assistant` shape but **scoped to that sub-agent's own context**. The sub-agent's body text *will* appear here (that's correct — the sub-agent wrote it), but it must **not** appear in the parent `<sessionId>.jsonl`. The leakage-check script's assertion:

```
grep canary in   <sessionId>.jsonl               → MUST be 0
grep canary in   <sessionId>/subagents/*.jsonl  → MAY be > 0 (sub-agent's own turn)
grep canary in   .sagol/reports/*.md             → MUST be 5 (one per sub-agent)
```

### Implementation sketch for `scripts/leakage-check-interactive.ts`

```ts
// Input: list of canary tokens (one per expected sub-agent report)
// Output: pass/fail + per-canary hit counts
import { readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

function slug(cwd: string) {
  return "-" + cwd.replace(/^\//, "").replace(/\//g, "-");
}

function findNewestInteractiveSession(cwd: string) {
  const dir = join(homedir(), ".claude", "sessions");
  const entries = readdirSync(dir).map((f) => {
    const o = JSON.parse(readFileSync(join(dir, f), "utf8"));
    return o;
  });
  return entries
    .filter((e) => e.cwd === cwd && e.kind === "interactive")
    .sort((a, b) => b.startedAt - a.startedAt)[0];
}

function countInFile(path: string, needle: string): number {
  try {
    return readFileSync(path, "utf8").split(needle).length - 1;
  } catch { return 0; }
}

// canaries: string[]; exit 0 if every main-transcript count === 0
```

**Why naive string grep (not JSON-aware parse) is fine:** the only thing that matters is whether the canary token — a random 128-bit hex — appears anywhere in the main transcript. JSON escaping of quotes doesn't affect hex digits. A 10-line grep is more robust than a 100-line JSONL parser that might miss a nested field.

**Confidence:** HIGH. Every claim here was verified against a live transcript file on 2026-04-15 in this exact session.

---

## 2. Task / Sub-Agent Spawning for the 5-Agent Leakage Fixture

### Concurrency cap

- **Hard cap: 10 concurrent sub-agents per Task batch.** Sources report this consistently across 2026 community articles (DEV.to, claudefa.st, zachwills.net) and it's acknowledged in anthropics/claude-code issue #15487 (request for a configurable `maxParallelAgents`). 5 < 10, so Phase 1's fixture runs in a single batch with no queueing.
- **Batching semantics:** Tasks 1-10 all start together and all must complete before tasks 11-20 start. With 5 agents, there is no batch-2 to worry about.
- **Background vs foreground:** Sub-agents default to foreground (blocking the parent until all resolve). Setting `background: true` in the agent frontmatter makes them concurrent with the parent. For the leakage test, foreground is fine — the parent is a test harness that has nothing else to do.

### MCP connection sharing

From the official docs (`code.claude.com/docs/en/sub-agents`):

> "Use the `mcpServers` field to give a subagent access to MCP servers that aren't available in the main conversation. Inline servers defined here are connected when the subagent starts and disconnected when it finishes. **String references share the parent session's connection.**"

**Implication for SAGOL:** if the 5-agent fixture does NOT override `mcpServers` in agent frontmatter, all 5 sub-agents inherit and share the single parent-session `sagol` MCP stdio subprocess. This is what we want — it means the 5 calls all exercise the same `handleWriteReport` in-process, not 5 separate spawns. It also means the stripping path is tested under real concurrency (5 near-simultaneous writes to `.sagol/reports/`).

**Gotcha:** `mkdirSync(REPORTS_DIR, { recursive: true })` in `handleWriteReport` is called on every tool call. This is fine — `mkdir -p` is idempotent — but it's worth noting that `generateId()` uses `Date.now()` + 4 random hex bytes. A 5-concurrent burst could in principle produce two calls in the same millisecond; the 32-bit random suffix makes collision probability ~1 in 4.3 billion per matching ms, which is not worth mitigating for a 5-agent test. If the planner wants belt-and-suspenders, bump the random suffix to 8 bytes — trivial.

### Fixture prompt design

The fixture prompt (to be committed verbatim in `01-LEAKAGE-CHECK.md`) should be explicit that each sub-agent must call `mcp__sagol__write_report` exactly once and must include its assigned canary token in the report body. Template:

```
You are the orchestrator for a leakage check. Spawn 5 sub-agents in parallel using
the Task tool. Each sub-agent receives one of these canary tokens and must call
mcp__sagol__write_report with:
  title: "leakage-check-<agent-number>"
  body:  "canary: <assigned-token>\n\nThis is a leakage check report."
  source: "leakage-check-agent-<agent-number>"

Canaries:
  A1: <random 128-bit hex>
  A2: <random 128-bit hex>
  A3: <random 128-bit hex>
  A4: <random 128-bit hex>
  A5: <random 128-bit hex>

After all 5 sub-agents return, output "done" and wait.
```

The canaries are generated fresh for each run by a helper (`scripts/leakage-fixture-prep.ts`) and printed for the user to paste — or the fixture could be stored as a template with `{{A1}}` placeholders and the helper prints both the filled prompt and the canary list to disk for the post-hoc check.

**Confidence:** HIGH for concurrency cap and MCP sharing (official docs + multiple community sources). MEDIUM for the ID-collision gotcha (it's a derivation, not a tested failure).

---

## 3. MCP Server Lifecycle Across Sessions

### Canonical answer: session restart is required

- **Stdio MCP servers are spawned once per session.** Claude Code launches `bun run src/mcp/server.ts` when the session starts (after the user accepts the `.mcp.json` trust prompt on first use). The subprocess lives for the entire session and is killed when the session ends.
- **There is no built-in slash command to restart an individual stdio MCP server.** `/mcp` opens an interactive menu that lets you view server status, re-authenticate OAuth flows, and clear auth, but it does NOT expose a "restart this server" action for stdio transports. Confirmed via direct read of `code.claude.com/docs/en/mcp` and WebSearch (feature request anthropics/claude-code#17675 is open as of 2026, not yet merged).
- **`/reload-plugins` only reloads plugin-bundled MCP servers**, not project `.mcp.json` entries. SAGOL in Phase 1 ships via `.mcp.json`, so this command does not apply.
- **`list_changed` notifications do NOT restart the subprocess.** They only push updated tool/prompt/resource schemas. Code changes to `handleWriteReport` require a fresh spawn.

### Community workarounds (informational only, not adopted)

- `mcp-hot-reload` (community tool): wraps the stdio transport in a passthrough that restarts the child process on file change. Not officially supported.
- `kill -HUP $PPID`: sends SIGHUP to the parent Claude Code process, forcing it to re-init. Destroys the session.
- `rusty-restart-claude`: Rust wrapper that preserves the terminal while restarting CC.

**Decision for SAGOL:** none of these are worth the complexity. The canonical instruction is: "Quit Claude Code (Ctrl+D / `exit`), start a new session, then call `mcp__sagol__write_report` once." This instruction is load-bearing for the first task of the first Phase 1 plan.

### Planner implication

**The first task of Plan 01-01 MUST be a USER-DRIVEN restart gate**, not a code task. The plan should literally be:

> 1. Instruct user to restart Claude Code.
> 2. After restart, call `mcp__sagol__write_report` once with a canary token.
> 3. Human verifies the tool response is canary-free.
> 4. Commit `01-LIVE-HARDGATE.md` with timestamp, CC version, Bun version, observed stripped response, report ID.

Only after this gate closes does the rest of Phase 1 proceed.

**Confidence:** HIGH. Official CC docs + GitHub issue tracker both confirm no built-in restart.

---

## 4. `bun test` Adoption for Phase 1

### Recommendation: **additive, not replacement**

Keep `scripts/verify-server-strip.ts` exactly as it is (it's already GREEN and consumed by doctor as an exit-code proxy). In parallel, add `tests/mcp-server.test.ts` using `bun test` to lock unit-level invariants.

### Why `bun test`

- **Jest-compatible API** via `import { describe, it, expect } from "bun:test"`. Zero configuration, zero extra dependencies — it ships with Bun.
- **Runs natively on .ts files** without a transpiler step (same as everything else in this project).
- **Fast startup** (~1-2× faster than Vitest on small suites per 2026 benchmarks).
- **Matches CAP-04 invariants** the verify-script can't cover (edge cases of `deriveSummary`, YAML escaping correctness of `buildMarkdown`, deterministic shape of `buildStripped`).

### Why NOT migrate verify-server-strip

The verify-script's contract is "exit 0 = server-side strip is live." Doctor reads that exit code. Converting it to a `.test.ts` file forces doctor to shell out to `bun test --bail` and parse its output — strictly more fragile than the current `bun run scripts/verify-server-strip.ts; echo $?` contract. The verify-script is a proof, the test suite is coverage. They're different artifacts.

### Minimum viable test suite

```ts
// tests/mcp-server.test.ts
import { describe, it, expect } from "bun:test";
import { buildStripped, handleWriteReport } from "../src/mcp/server.ts";
// (deriveSummary is currently not exported — Plan task: export it)

describe("buildStripped", () => {
  it("has the [report:id] prefix", () => { /* ... */ });
  it("is short (≤500 chars for a typical summary)", () => { /* ... */ });
  it("includes the full body path", () => { /* ... */ });
});

describe("deriveSummary", () => {
  it("clips at 200 chars", () => { /* ... */ });
  it("collapses whitespace", () => { /* ... */ });
  it("uses first non-empty paragraph", () => { /* ... */ });
  it("handles body with only whitespace", () => { /* ... */ });
  it("handles single-paragraph body under the limit", () => { /* ... */ });
});

describe("handleWriteReport end-to-end", () => {
  it("returns stripped form, writes full body to disk", async () => { /* ... */ });
  it("generates a unique id per call", async () => { /* ... */ });
  it("handles unicode title (e.g., 사골) in frontmatter", async () => { /* ... */ });
});
```

**Scope:** ≤80 LOC of test code, one file, zero fixtures beyond what `handleWriteReport` already accepts. Uses `SAGOL_PROJECT_ROOT` env var + `Bun.env` or an `afterEach` cleanup to avoid polluting `.sagol/reports/`.

**Gotcha:** `deriveSummary` is currently declared but not exported in `src/mcp/server.ts`. The plan task is "add `export` keyword" — a 5-character change, trivial.

**Confidence:** HIGH (bun test API verified against official docs); MEDIUM on the recommendation (it's a judgment call on marginal value vs Spike velocity — the research takes a position but a reasonable planner could also choose to defer).

---

## 5. `bunx sagol init` Idempotency Strategy

### Recommendation: merge-preserve, never overwrite

For both `.mcp.json` and `.claude/settings.json`, the strategy is:

1. If the file does not exist → write a minimal SAGOL-only template.
2. If the file exists → parse JSON (fail loudly on invalid JSON, instruct user to fix manually), shallow-merge SAGOL keys in, preserve every other key, write back.
3. On `--dry-run` → print the computed merged JSON diff to stdout, do not write.

### `.mcp.json` merge

```ts
// pseudocode
const existing = readJsonOrEmpty(".mcp.json", { mcpServers: {} });
existing.mcpServers ??= {};
existing.mcpServers.sagol = {
  command: "bun",
  args: ["run", "src/mcp/server.ts"],
};
writeJson(".mcp.json", existing);
```

**Idempotency:** re-running `init` overwrites the `sagol` entry with the same value. No duplication, no drift.

### `.claude/settings.json` merge

```ts
const existing = readJsonOrEmpty(".claude/settings.json", {});
existing.$schema ??= "https://json.schemastore.org/claude-code-settings.json";
existing.enabledMcpjsonServers ??= [];
if (!existing.enabledMcpjsonServers.includes("sagol")) {
  existing.enabledMcpjsonServers.push("sagol");
}
// Hooks block: intentionally not touched by init. Dormant hook matcher
// lives in the existing project file; init does not re-introduce it on
// virgin installs because D-10 says stripping is server-side, not hook-side.
writeJson(".claude/settings.json", existing);
```

**Critical non-behavior:** `init` MUST NOT write the dead `PostToolUse` hook block on virgin installs. The hook block is preserved in *this* repo's `.claude/settings.json` for historical continuity + revival optionality, but a user attaching SAGOL to a fresh project should get a clean, minimal settings file with no dead code. Let the hook path stay buried until a future CC version fixes it.

### Why not "hard overwrite"

- Destroys user customizations (their other hooks, their permissions block, their other MCP servers).
- Users stop trusting the tool. `init` becomes something to fear running twice.

### Why not "skip if exists"

- Forces the user to manually diff + merge, which is the entire reason a CLI init exists in the first place.
- In v1 the user is always "the developer themselves" (per PROJECT.md), so the developer-ergonomics tradeoff favors automation over paranoia.

### Dependencies

Zero. Bun has `Bun.file().json()`, `Bun.write()`, and the native `JSON` object. A full implementation is ~50 LOC including error handling.

**Confidence:** HIGH. This is the standard pattern for dev-tool init commands (e.g., `tsc --init`, `eslint --init`, `prettier --init`) in 2026.

---

## 6. Doctor CLI Extensions

### Current state (`scripts/doctor.ts`)

- ~110 LOC.
- Checks: 11 required files exist, `bun --version` matches pinned, `claude --version` matches pinned.
- Output: `✓ / ✗` checklist, exits with count of failures.

### Recommended Phase 1 additions (≤3 new checks, ≤40 LOC delta)

1. **Run `verify-server-strip.ts` as a sub-check.** Spawn `bun run scripts/verify-server-strip.ts`, capture exit code, report `✓ server-side stripping live` or `✗ stripping regression (exit N)`. This is the authoritative functional proof — far more valuable than file-existence checks.

2. **`.mcp.json` JSON well-formedness + sagol entry check.** Parse the file, confirm `mcpServers.sagol.command === "bun"` and `args` contains `src/mcp/server.ts`. Fail with a specific message pointing to `bunx sagol init`.

3. **`.claude/settings.json` has `sagol` in `enabledMcpjsonServers`.** Parse, verify. Same remediation hint.

### Explicitly NOT added

- **Live MCP stdio handshake** (spawn server, send `initialize` JSON-RPC, wait for response). Reasoning: the direct-import verify-script already proves the handler works; the only thing a live handshake would add is "confirms Claude Code can *connect*", and that is what the live HARD GATE task and the leakage check already exercise. Adding it to doctor would be 80+ LOC of JSON-RPC framing and timeout handling for a redundant signal. Bad LOC/value trade.

- **`bunx sagol init` idempotency check** (e.g., run init in dry-run, confirm it's a no-op). Reasoning: this couples doctor to init semantics. If init changes, doctor breaks for reasons unrelated to the system state it's supposed to report on. Keep them decoupled.

- **Version drift warnings beyond current Bun + claude version checks.** Already covered by the `PINNED_VERSIONS.md` cross-reference.

**LOC budget after additions: ~150 LOC.** Still fits the "minimal Spike doctor" envelope.

**Confidence:** HIGH. The new checks have direct 1:1 mapping to Phase 1 exit-gate items.

---

## 7. Canonical Refs for Downstream Agents

### Must read before planning

- `.planning/ROADMAP.md` (Phase 1 section with post-pivot architecture note)
- `.planning/REQUIREMENTS.md` (INST-01, INST-02, CAP-01 through CAP-05)
- `.planning/PROJECT.md` (Core Value — app-first pivot language)
- `.planning/STATE.md` (current position + decisions log)
- `.planning/phases/00-pre-flight-gates/00-CONTEXT.md` (D-01 through D-09 — still binding; especially D-08 global settings taboo)
- `.planning/phases/01-stripping-path-interactive-mode-only/01-CONTEXT.md` (D-10 through D-16 — AUTHORITATIVE for Phase 1 scope)
- `.planning/research/HEADLESS_HOOK_LIMITATION.md` (Server-side workaround section — anchor for D-10)
- `.planning/research/PITFALLS.md` (hook + benchmark + MCP pitfalls — planner scans for anything touching Phase 1's surface)
- `.planning/research/STACK.md` (stack rationale — version pinning context)
- `.planning/research/PINNED_VERSIONS.md` (CC 2.1.108, Bun 1.3.11)
- **`.planning/phases/01-stripping-path-interactive-mode-only/01-RESEARCH.md` (this file)**

### Must read before executing

Everything above, plus:

- `src/mcp/server.ts` — current implementation (commit de66c83)
- `scripts/verify-server-strip.ts` — the direct-import verification harness
- `scripts/strip-report.ts` — dormant, kept for revival (do not delete, add a header comment noting dormant status if not already present)
- `scripts/doctor.ts` — current doctor (extending, not replacing)
- `.claude/settings.json` — has dead hook block (see D-10 note); do not delete the hook block from this repo, but DO NOT write it on a virgin `bunx sagol init` run
- `.mcp.json` — current canonical form

### Produced during Phase 1 (will not exist until plans run)

- `.planning/phases/01-stripping-path-interactive-mode-only/01-LIVE-HARDGATE.md` — exit gate receipt (task 1)
- `.planning/phases/01-stripping-path-interactive-mode-only/01-LEAKAGE-CHECK.md` — fixture prompt + post-run record (one of the later tasks)
- `scripts/leakage-check-interactive.ts` — the transcript grep script (new)
- `scripts/init.ts` — the idempotent init command (new)
- `scripts/leakage-fixture-prep.ts` — optional canary generator helper (new, if planner decides to factor it out)
- `tests/mcp-server.test.ts` — `bun test` unit suite (new, if planner accepts Finding 4's recommendation)

### Environment / availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Bun | All scripts, MCP server | ✓ | 1.3.11 (pinned) | — |
| Claude Code CLI | Live HARD GATE + leakage check | ✓ | 2.1.108 (pinned) | — |
| `@modelcontextprotocol/sdk` | `src/mcp/server.ts` | ✓ | ^1.29.0 | — |
| `zod` | MCP tool schemas | ✓ | ^4.3.6 | — |
| Read access to `~/.claude/projects/<slug>/*.jsonl` | leakage-check-interactive.ts | ✓ | — | — |
| Read access to `~/.claude/sessions/*.json` | leakage-check-interactive.ts | ✓ | — | — |

No external tools, no network dependencies (leakage check is 100% local filesystem).

---

## 8. Phase 1 Pitfalls (filtered from `.planning/research/PITFALLS.md`)

| Pitfall | Relevance | Mitigation in Phase 1 |
|---------|-----------|------------------------|
| Hook-based JSONL mutation fragile across CC versions (P2) | SUPERSEDED by D-10 (no hook in hot path) | N/A — server-side strip makes this moot |
| Leakage canary false-positive from tool_use.input containing the body (P2) | **LIVE RISK** — if a sub-agent passes a huge `body:` arg, that body DOES appear in the parent transcript as a `tool_use.input` field | Leakage-check script must grep in BOTH `tool_result` AND `tool_use.input` blocks; flag tool_use.input leakage separately (it's "unavoidable input leak", distinct from "output leak" which is what stripping fixes). Pitfalls doc already notes this distinction. |
| SubAgent wrapping assumption (P2) | Phase 1 uses Task tool + shared MCP connection — verified in Finding 2 | Leakage-check confirms real behavior instead of assuming it |
| Version drift breaks hooks silently (P6) | Applies to hook path (dormant), not server path | Doctor's pinned version check catches CC bumps; re-run verify-server-strip on any bump |
| File watcher stalling hooks on burst writes (P9 runtime table) | Not applicable in Phase 1 (no dashboard, no watcher) | Deferred to Phase 2 |
| Bun/Python subprocess flakiness (P7) | Not applicable in Phase 1 (no Python harness) | Deferred — no benchmark code in v1 |
| `Bun.spawn` array form vs shell string (P9 security table) | Applies to `scripts/init.ts` if it shells out | Init should be pure fs + JSON, no `Bun.spawn` needed |
| Command injection via unescaped frontmatter (P9 security table) | Applies to `buildMarkdown` YAML escaping | `yamlEscape()` already correctly escapes `\`, `"`, `\n`, `\r`. Add a `bun test` case for unicode + embedded quotes. |
| Cross-session transcript parsing drift (P6 hook area) | If CC changes JSONL shape, leakage-check breaks | Pin CC version in `PINNED_VERSIONS.md` (already done per D-06); rerun verify + leakage on any CC bump |

**New pitfall surfaced by this research:**

- **Tool_use.input leakage is unavoidable and not a stripping failure.** When Claude passes `body: "...10KB of text..."` as an argument to `mcp__sagol__write_report`, the 10KB goes into the parent transcript as a `tool_use` block BEFORE the tool runs, and stripping cannot remove it (the tool hasn't even been called yet). This is acceptable — the hypothesis is about the *reply* not re-polluting context, and a body written once in a tool_use block is still vastly better than the same body appearing in both the tool_use and the tool_result. But the leakage-check script and the final report must **distinguish** these two leakage types. The SAGOL pattern naturally handles this: sub-agents write reports from their own context, the parent agent's `tool_use` for Task() only contains the task description, not the sub-agent's report body. So for the 5-subagent test, tool_use.input leakage SHOULD be zero because the main agent never directly calls `mcp__sagol__write_report` — only sub-agents do, and sub-agent tool_use blocks live in `subagents/*.jsonl`, not in the main transcript.

---

## Code Examples

### Verified: current server-side strip (src/mcp/server.ts:88-130)

```ts
export function buildStripped(args: { id; title; summary }): string {
  return (
    `[report:${args.id}] ${args.title}\n` +
    `${args.summary}\n\n` +
    `(full body persisted to .sagol/reports/${args.id}.md — read that file ` +
    `only if the summary is not enough to proceed)`
  );
}

export async function handleWriteReport(input) {
  // ... writes .sagol/reports/<id>.md with full body
  return { content: [{ type: "text", text: buildStripped(...) }] };
}
```

This is the entire hypothesis-preserving surface. Everything else in Phase 1 either proves it works (verify-script, live HARD GATE, leakage check) or packages it (init, doctor).

### Verified: session discovery helper (to write in Phase 1)

```ts
// scripts/leakage-check-interactive.ts — discovery portion
import { readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export function findNewestSession(cwd: string) {
  const dir = join(homedir(), ".claude", "sessions");
  const sessions = readdirSync(dir)
    .map((f) => {
      try { return JSON.parse(readFileSync(join(dir, f), "utf8")); }
      catch { return null; }
    })
    .filter((e): e is { sessionId: string; cwd: string; kind: string; startedAt: number } =>
      !!e && e.cwd === cwd && e.kind === "interactive");
  sessions.sort((a, b) => b.startedAt - a.startedAt);
  return sessions[0] ?? null;
}
```

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Every transcript I/O field relevant to leakage is one of `assistant.message.content[*]` or `user.message.content[*]` | §1 | Leakage-check script might miss a new block type in a future CC version — pin the CC version and re-verify on bump |
| A2 | 5 concurrent sub-agents won't produce colliding `generateId()` outputs at the millisecond boundary | §2 | Extremely low probability (32-bit random per ms); belt-and-suspenders is to widen to 8 bytes |
| A3 | `bun test` on `src/mcp/server.ts` can import the module without a separate tsconfig for the test folder | §4 | Low — Bun executes .ts natively and `tests/` would be in the default module graph; verified by default Bun project layouts in 2026 docs |
| A4 | `bunx sagol init`'s merge strategy won't collide with a user's existing `enabledMcpjsonServers` array containing `"sagol"` | §5 | None — the `includes()` check makes append idempotent |
| A5 | The `subagents/*.jsonl` directory is created only when Task() sub-agents actually run in a session (not empty-created at session start) | §1 | Low — leakage-check handles "directory does not exist" as "0 sub-agents ran" and that is a meaningful failure signal |

---

## Sources

### HIGH confidence — Official docs + live filesystem
- [Claude Code Sub-agents docs](https://code.claude.com/docs/en/sub-agents) — confirms MCP connection sharing, session persistence of subagent transcripts, `mcpServers: ["..."]` string-reference semantics
- [Claude Code MCP docs](https://code.claude.com/docs/en/mcp) — confirms `list_changed` only refreshes capabilities, `/reload-plugins` is plugin-only, `/mcp` menu is status+OAuth only
- [Bun test docs](https://bun.com/docs/test/writing) — Jest-compatible `describe/it/expect` API
- Live read of `~/.claude/sessions/*.json` and `~/.claude/projects/-Users-chenjing-dev-sagol/` on 2026-04-15 — confirms transcript path layout, JSONL `type` field enumeration, subagents subdirectory structure

### MEDIUM confidence — Community sources verified against official
- [DEV.to: Claude Code subagents parallel limits](https://dev.to/subprime2010/claude-code-subagents-how-to-run-parallel-tasks-without-hitting-rate-limits-4bpl) — 10-concurrent cap
- [claudefa.st: Sub-agents best practices](https://claudefa.st/blog/guide/agents/sub-agent-best-practices) — batching semantics
- [anthropics/claude-code#15487](https://github.com/anthropics/claude-code/issues/15487) — `maxParallelAgents` feature request, implies 10-cap is current behavior
- [anthropics/claude-code#17675](https://github.com/anthropics/claude-code/issues/17675) — open feature request for `/restart` command — confirms no built-in restart

### Cross-referenced but not load-bearing
- [Bun vs Vitest vs Jest 2026 benchmarks](https://www.pkgpulse.com/blog/bun-test-vs-vitest-vs-jest-test-runner-benchmark-2026) — performance context for Finding 4
- [mcp-hot-reload](https://lobehub.com/mcp/claude-code-mcp-reload-mcp-hot-reload) — community workaround, informational only

---

## Metadata

**Confidence breakdown:**
- Transcript JSONL layout & structure: HIGH — verified against live filesystem in this session
- Sub-agent concurrency + MCP sharing: HIGH — official docs + multiple community confirmations
- MCP server lifecycle (restart required): HIGH — official docs + GitHub issue tracker
- `bun test` tradeoff: MEDIUM — API is verified, recommendation is a judgment call
- Init merge strategy: HIGH — standard pattern, zero-dep implementation
- Doctor extensions: HIGH — directly maps to exit-gate items
- Phase 1 pitfall coverage: HIGH — filtered from existing `.planning/research/PITFALLS.md` + one new surfaced finding (tool_use.input leakage distinction)

**Research date:** 2026-04-15
**Valid until:** 2026-05-15 (or any Claude Code minor version bump above 2.1.108 — rerun verify + leakage, re-read transcript layout)

**Phase 1 exit gate map (from D-15) → research anchor:**

| Gate item | Research anchor |
|-----------|-----------------|
| 1. `verify-server-strip.ts` GREEN | §4 (kept as standalone) |
| 2. Live CC round-trip HARD GATE | §3 (session restart is the first task) |
| 3. 5-subagent leakage check | §1 + §2 (transcript path + concurrency + fixture design) |
| 4. `doctor` GREEN + README paragraph | §5 + §6 (init merge + doctor extensions) |
