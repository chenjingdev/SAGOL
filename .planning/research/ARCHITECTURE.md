# Architecture Research

**Domain:** Claude Code agent report router + context hygiene tool (local dev tool, single user)
**Researched:** 2026-04-14
**Confidence:** HIGH for stripping + component boundaries (verified against current code.claude.com docs). MEDIUM for browser→terminal sync (requires a small Spike to confirm the blocking-MCP-tool pattern end-to-end).

## Executive Recommendation

1. **Context stripping** → Implement as an **MCP tool whose result is rewritten by a `PostToolUse` hook using `updatedMCPToolOutput`**. This is the only Claude Code mechanism (as of April 2026 docs) that can deterministically replace what the main agent sees without mutating the permanent transcript. The MCP tool writes the full report to a file; the hook returns only the frontmatter summary to the main agent. Non-MCP tool outputs (Bash, Read, Write) cannot be mutated, so this constrains the capture path.
2. **Browser ↔ Terminal sync** → Bidirectional via a **single local Bun HTTP + WebSocket server embedded in the SAGOL MCP server process**. Terminal→Browser uses file watcher + WS push (already proven in caveman-report). Browser→Terminal uses a **blocking MCP tool (`sagol_await_feedback`)** that the agent calls and that the MCP server holds open until the dashboard posts a reply. This turns browser input into an officially-supported tool return value — no transcript injection required, no hacks.
3. **Component boundaries** → Single Bun process, four modules that can be tested in isolation: `mcp-server` (stdio MCP + tool handlers), `report-store` (file write + frontmatter + context json), `dashboard-server` (HTTP/WS + static SPA — lifted from caveman-report), `eval-runner` (SWE-bench child_process wrapper, headless `claude -p --bare` invocation). Spike = monolith repo with these as folders, not packages.
4. **Build order** → Week 1: (1) blocking MCP tool skeleton, (2) PostToolUse `updatedMCPToolOutput` stripping proof, (3) report-store + dashboard lift. Week 2: (4) eval runner + baseline vs SAGOL comparison on 5 SWE-bench tasks, (5) spike report. Risky items (stripping, sync) come first — both must be green by end of day 3 or the project kills itself early.

## Standard Architecture

### System Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                        Claude Code (host, terminal TUI)              │
│  ┌────────────────┐   ┌────────────────┐   ┌────────────────┐       │
│  │  main agent    │   │  subagent(s)   │   │  hooks engine  │       │
│  │  (long task)   │──▶│  (report gen) │──▶│ PostToolUse    │       │
│  └───────┬────────┘   └───────┬────────┘   └───────┬────────┘       │
│          │ MCP tool call       │ tool result        │ updatedMCP    │
│          │ sagol_write_report  │ (full md body)    │ ToolOutput   │
│          │ sagol_await_feedback│                    │ = summary    │
└──────────┼─────────────────────┼────────────────────┼───────────────┘
           │ stdio (MCP)         │                    │
           ▼                     ▼                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│                      SAGOL Bun process (single)                      │
│  ┌─────────────────────┐        ┌─────────────────────┐             │
│  │  mcp-server         │◀──────▶│  report-store       │             │
│  │  - tool handlers    │  write │  - fs write md      │             │
│  │  - blocking waits   │        │  - frontmatter gen  │             │
│  │  - notify dashboard │        │  - context.json     │             │
│  └──────────┬──────────┘        └──────────┬──────────┘             │
│             │ pub/sub (in-proc emitter)    │ chokidar watch          │
│             ▼                              ▼                         │
│  ┌─────────────────────────────────────────────────────┐            │
│  │  dashboard-server (lifted from caveman-report)       │            │
│  │  - HTTP: /api/reports, /api/report/:id               │            │
│  │  - WS:   /ws  push "new report" / pull "feedback"   │            │
│  │  - static SPA shell                                  │            │
│  └─────────────────┬───────────────────────────────────┘            │
│                    │                                                 │
│  ┌─────────────────┴────────────────┐                               │
│  │  eval-runner (not MCP-exposed)   │                               │
│  │  - child_process SWE-bench       │                               │
│  │  - child_process claude -p --bare│                               │
│  │  - writes results under reports/ │                               │
│  └──────────────────────────────────┘                               │
└─────────────────────────────────────────────────────────────────────┘
                              ▲
                              │ HTTP + WS
                              ▼
                  ┌─────────────────────────┐
                  │  Browser Dashboard       │
                  │  - report list/render    │
                  │  - feedback form (WS)    │
                  │  - approve/reject/more   │
                  └─────────────────────────┘
```

### Component Responsibilities

| Component | Responsibility | Typical Implementation |
|---|---|---|
| `mcp-server` | Exposes MCP tools `sagol_write_report`, `sagol_await_feedback`, `sagol_list_reports`. Maintains an in-process event emitter for dashboard notifications and pending feedback waiters. | TypeScript module using `@modelcontextprotocol/sdk`, stdio transport, launched via Claude Code `.mcp.json`. |
| `report-store` | Writes reports to `.sagol/reports/*.md` with frontmatter (id, title, source, timestamp, summary, tags). Maintains `.sagol/context.json` index. Lifted directly from caveman-report `src/compiler.js` + `src/context.js`. | Bun `fs` + `gray-matter` (or a Bun-native frontmatter util). Synchronous writes; atomic via `.tmp` rename. |
| `dashboard-server` | Local HTTP + WebSocket server. Serves SPA shell, report JSON/HTML, pushes live updates, accepts user feedback POSTs. Lifted from caveman-report `src/server.js`. | Bun `Bun.serve()` with `websocket` handler (native, no `express` dep — one of the reasons for the Bun choice). |
| `eval-runner` | Runs SWE-bench harness as `child_process`. Runs baseline and SAGOL-enabled Claude Code via `claude -p --bare --mcp-config` headless mode. Captures metrics: token usage, task success, cache stability. | Bun `Bun.spawn` wrappers. Not an MCP tool — invoked via `bunx sagol eval` CLI. |
| `claude-code-bridge` (logical, not a module) | Configuration files that wire SAGOL into Claude Code: `.mcp.json` entry, `~/.claude/settings.json` `PostToolUse` hook pointed at the stripping script, optional `.claude/skills/sagol/SKILL.md`. | YAML/JSON configs + one tiny shell wrapper that calls a Bun script. |

## Recommended Project Structure

```
sagol/
├── package.json                # Bun + TS, type: module
├── tsconfig.json
├── .mcp.json.example           # sample wiring for Claude Code users
├── src/
│   ├── mcp/
│   │   ├── server.ts           # MCP server entrypoint (stdio)
│   │   ├── tools/
│   │   │   ├── write-report.ts # sagol_write_report
│   │   │   ├── await-feedback.ts # blocking feedback tool
│   │   │   └── list-reports.ts
│   │   └── events.ts           # in-proc EventEmitter bus
│   ├── store/
│   │   ├── report.ts           # lifted compiler.js (TS port)
│   │   ├── frontmatter.ts      # lifted gray-matter usage
│   │   └── context.ts          # lifted context.js
│   ├── dashboard/
│   │   ├── server.ts           # Bun.serve HTTP + WS (lifted server.js)
│   │   ├── watcher.ts          # chokidar (lifted watcher.js) OR Bun fs.watch
│   │   └── ui/                 # static SPA (HTML + JS, lifted renderShell)
│   ├── hooks/
│   │   └── strip-report.ts     # PostToolUse hook, reads stdin JSON,
│   │                            # replaces tool_response with summary
│   ├── eval/
│   │   ├── runner.ts           # SWE-bench invocation
│   │   ├── baseline.ts         # spawn claude -p --bare without MCP
│   │   └── sagol.ts            # spawn claude -p --bare with MCP
│   └── cli.ts                  # `sagol start | eval | init`
├── .sagol/                     # runtime state (gitignored)
│   ├── reports/                # *.md files
│   ├── context.json            # index
│   └── sessions/               # eval run outputs
└── tests/
    ├── mcp-tools.test.ts       # tool input/output, blocking behavior
    ├── strip-hook.test.ts      # hook stdin/stdout contract
    ├── report-store.test.ts    # frontmatter roundtrip
    └── dashboard.test.ts       # HTTP/WS smoke
```

### Structure Rationale

- **`src/mcp/` leads the tree.** The MCP server is the primary surface Claude Code sees. Tools are one file each so they can be unit-tested without booting the full server.
- **`src/store/` is a direct lift.** Zero new decisions. Porting caveman-report's three files (~150 LOC total) to TypeScript is the fastest route to a working capture loop.
- **`src/dashboard/` is also a direct lift** but rewritten to use Bun's native `Bun.serve` (no `express`, no `ws` dep) because the caveman dependency list doubles the install footprint for no benefit.
- **`src/hooks/strip-report.ts` is a standalone executable.** Claude Code runs hooks as subprocesses with JSON on stdin and expects JSON on stdout — it must not depend on the MCP server process. Keep it dependency-free (pure TypeScript, bun shebang).
- **`src/eval/` is not an MCP tool.** Eval runs are driven from the host shell via `bunx sagol eval`, not from inside a Claude session. This prevents the evaluation from polluting the very context we are measuring.

## Architectural Patterns

### Pattern 1: MCP Tool + PostToolUse Hook for Context Stripping

**What:** The main agent calls `sagol_write_report` with full report content. The MCP tool writes the markdown to disk and returns the full content (so that a `PostToolUse` hook has something to mutate). A Claude Code `PostToolUse` hook configured for `matcher: "mcp__sagol__write_report"` reads the tool response, extracts the frontmatter summary, and returns `{ "hookSpecificOutput": { "hookEventName": "PostToolUse", "updatedMCPToolOutput": { "content": [{ "type": "text", "text": "[report:<id>] <title>\n<summary>" }] } } }`. The main agent sees only the short summary in its transcript going forward.

**When to use:** Every subagent-produced output that exceeds ~500 tokens. Frontmatter summary target ≤200 tokens (matches R3).

**Trade-offs:**
- ✅ Officially supported. `updatedMCPToolOutput` is a documented field (verified against https://code.claude.com/docs/en/hooks, April 2026).
- ✅ Deterministic. The hook fires before the agent sees the result, so the LLM never trains on the full body.
- ✅ Works with tool-call caching — the stripped result is what gets cached.
- ⚠️ **Hard constraint:** `updatedMCPToolOutput` **only applies to MCP tools**. A `PostToolUse` hook cannot modify `Bash`, `Read`, `Write`, or subagent-tool outputs. This means the capture path must funnel through SAGOL's MCP tool; you cannot strip arbitrary subagent output retroactively.
- ⚠️ The permanent transcript `.jsonl` still records the original call on disk (hooks do not mutate it), but the model's context going forward only sees the replaced version. This is acceptable — our concern is LLM context pollution, not disk logs.

**Example:**

```typescript
// src/mcp/tools/write-report.ts (MCP tool side)
export async function writeReport(args: { title: string; body: string; source: string }) {
  const id = nanoid(8);
  const summary = args.body.split('\n').slice(0, 3).join(' ').slice(0, 400);
  const md = `---\nid: ${id}\ntitle: ${args.title}\nsource: ${args.source}\ncreated: ${new Date().toISOString()}\nsummary: ${JSON.stringify(summary)}\n---\n\n${args.body}`;
  await Bun.write(`.sagol/reports/${id}.md`, md);
  dashboardEvents.emit('report:new', { id });
  return { content: [{ type: 'text', text: md }] };  // full body; hook will strip
}
```

```typescript
// src/hooks/strip-report.ts (standalone executable, called by Claude Code)
#!/usr/bin/env bun
const input = JSON.parse(await Bun.stdin.text());
if (input.tool_name !== 'mcp__sagol__write_report') {
  console.log('{}'); process.exit(0);
}
const fullMd: string = input.tool_response.content[0].text;
const { data } = parseFrontmatter(fullMd);
const stripped = `[report:${data.id}] ${data.title}\n${data.summary}\n(full body at .sagol/reports/${data.id}.md)`;
console.log(JSON.stringify({
  hookSpecificOutput: {
    hookEventName: 'PostToolUse',
    updatedMCPToolOutput: { content: [{ type: 'text', text: stripped }] }
  }
}));
```

```json
// ~/.claude/settings.json
{
  "hooks": {
    "PostToolUse": [
      { "matcher": "mcp__sagol__write_report",
        "hooks": [{ "type": "command", "command": "bun /abs/path/sagol/src/hooks/strip-report.ts" }] }
    ]
  }
}
```

### Pattern 2: Blocking MCP Tool for Browser → Terminal Injection

**What:** The agent calls `sagol_await_feedback({ reportId })`. Inside the MCP tool handler, SAGOL registers a pending waiter keyed by `reportId` and awaits a Promise. The dashboard server receives a `POST /api/feedback` (or WS message) from the browser, resolves the Promise with the user's text. The MCP tool returns `{ content: [{ type: 'text', text: userFeedback }] }` — which becomes the tool result the agent sees and acts on.

**When to use:** Whenever the agent wants user approval, rejection, or additional requirements on a report. This is the R5 bidirectional path.

**Trade-offs:**
- ✅ Uses only existing Claude Code primitives — no transcript injection, no terminal hacks, no named pipes.
- ✅ Works identically in interactive Claude Code TUI and in headless `claude -p`.
- ✅ The agent literally pauses on the tool call, which is exactly the UX we want: "agent produced a report, waiting for user review".
- ✅ Same mechanism serves a future v2 "AskUserQuestion-style" flow — trivially extensible.
- ⚠️ Long waits are fine (the MCP server just holds the Promise), but if the user never opens the browser, the agent stalls. Mitigation: timeout with a default ("proceed with no feedback") after N minutes.
- ⚠️ Requires the agent to *decide* to call the tool. Mitigation: make the report-writing tool return a summary that explicitly says "call `sagol_await_feedback` next". This is a prompt-engineering concern, not architectural.

**Example:**

```typescript
// src/mcp/events.ts
const waiters = new Map<string, (feedback: string) => void>();

export function registerWaiter(reportId: string): Promise<string> {
  return new Promise((resolve) => {
    waiters.set(reportId, resolve);
    setTimeout(() => {
      if (waiters.has(reportId)) {
        waiters.delete(reportId);
        resolve('(no feedback within timeout — proceed)');
      }
    }, 10 * 60 * 1000);
  });
}

export function deliverFeedback(reportId: string, text: string) {
  const w = waiters.get(reportId);
  if (w) { waiters.delete(reportId); w(text); }
}
```

### Pattern 3: Single-Process Dashboard + MCP Server

**What:** SAGOL runs as **one Bun process** that Claude Code spawns via `.mcp.json`. The process opens stdio for MCP traffic and simultaneously binds `localhost:<port>` for HTTP/WS. When Claude Code shuts down the MCP server (session end), the dashboard dies with it — no orphaned processes.

**When to use:** v1 only, single-user local. For a future multi-session setup, you would separate the dashboard into a long-lived daemon, but that is out of scope.

**Trade-offs:**
- ✅ One lifetime to reason about. No daemon management, no PID files, no "dashboard already running" bugs.
- ✅ In-process event emitter (no IPC, no redis) connects MCP tools directly to the WS push layer.
- ⚠️ Multiple concurrent Claude Code sessions would fight for the same port. Mitigation: pick port from env (`SAGOL_PORT`) with a random fallback; print the URL on MCP server start via `stderr` (Claude Code surfaces it).
- ⚠️ Dashboard state dies when the Claude Code session ends. That's acceptable for v1 — reports persist on disk and re-load when the next session starts.

## Data Flow

### Forward flow (agent → report → dashboard → stripped context)

```
subagent produces analysis
    │
    ▼
main agent calls MCP tool: sagol_write_report({title, body, source})
    │
    ├─▶ MCP server writes .sagol/reports/<id>.md  (with frontmatter)
    ├─▶ MCP server emits 'report:new' on in-proc bus
    │     │
    │     └─▶ dashboard-server pushes WS {type:'new', id} to browser
    │                    │
    │                    └─▶ browser fetches /api/report/<id>, renders
    │
    └─▶ MCP server returns full md as tool result
              │
              ▼
        PostToolUse hook (matcher: mcp__sagol__write_report)
              │
              ▼ replaces tool_response with
              { content: [{ type: 'text',
                text: '[report:<id>] <title>\n<summary>' }] }
              │
              ▼
        main agent's context now contains only the short form
```

### Reverse flow (browser → terminal)

```
user writes feedback in browser
    │
    ▼
browser POST /api/feedback { reportId, text }   OR   WS {type:'feedback', ...}
    │
    ▼
dashboard-server calls deliverFeedback(id, text) on in-proc bus
    │
    ▼
MCP tool sagol_await_feedback's pending Promise resolves
    │
    ▼
tool returns { content: [{ type: 'text', text }] } to Claude Code
    │
    ▼
main agent sees user feedback as tool result, continues task
```

### Format transitions at each hop

| Hop | From format | To format |
|---|---|---|
| Subagent → main | full assistant text | natively summarized by Claude Code subagent runtime (built-in) |
| Main → MCP tool | tool_use JSON | `{title, body, source}` params |
| MCP → disk | params | markdown with gray-matter frontmatter |
| MCP → hook | tool_response (full md) | hook stdin JSON |
| Hook → Claude | hook stdout JSON | `updatedMCPToolOutput` → short text |
| MCP → dashboard | in-proc event | WS JSON `{type, id}` |
| Dashboard → user | HTTP JSON | rendered HTML (markdown-it) |
| User → dashboard | form submit | HTTP/WS JSON `{reportId, text}` |
| Dashboard → MCP | in-proc bus | Promise resolution |
| MCP → Claude | Promise value | tool result `content[0].text` |

## Build Order

Risk-driven. The two kill-switches (stripping, sync) must be proven by **end of day 3** or cut scope.

### Week 1 — De-risk the two unknowns

**Day 1: MCP server + stripping hook (vertical slice)**
- Bare `@modelcontextprotocol/sdk` server exposing `sagol_write_report` (writes to `/tmp/sagol-test/<id>.md`, returns stub body).
- `src/hooks/strip-report.ts` hook script that reads stdin, returns hardcoded `updatedMCPToolOutput`.
- Wire to Claude Code via `.mcp.json` + `~/.claude/settings.json`.
- **Exit criterion:** start Claude Code, tell it to call the tool, verify in `/transcript` or `--output-format stream-json` that the main agent's tool_result contains only the summary. **If this doesn't work, the project dies on day 1.**

**Day 2: Real report-store (lift from caveman)**
- Port `compiler.js`, `context.js`, `watcher.js` to TypeScript.
- Frontmatter schema finalized (id, title, source, summary, created, tags).
- MCP tool now writes real reports with real frontmatter; hook extracts real summary.
- Unit tests for roundtrip.

**Day 3: Blocking feedback tool**
- `sagol_await_feedback` MCP tool using the waiter pattern.
- Tiny `/api/feedback` endpoint (curl test, no browser yet).
- **Exit criterion:** in a live Claude session, agent calls `sagol_await_feedback`, user curls the endpoint, agent receives the text. **If this doesn't work, browser sync is dead — kill project or rescope.**

**Day 4: Dashboard lift**
- Port `server.js` to `Bun.serve` (drop express + ws deps). Keep renderShell as-is for v1 (translate later).
- Add a feedback textarea + submit button to the SPA.
- WS push on new reports.
- Open browser via `open` equivalent when MCP server starts.

**Day 5: End-to-end smoke**
- Full loop: run a Claude Code task → subagent writes report → dashboard shows it → user submits feedback → agent consumes feedback → task continues.
- Record GIF/video for the spike report.

### Week 2 — Evaluation loop

**Day 6–7: eval runner**
- `bunx sagol eval baseline --tasks 5` → runs 5 SWE-bench tasks via `claude -p --bare` with no MCP attached.
- `bunx sagol eval sagol --tasks 5` → same tasks with `--mcp-config` pointing at SAGOL.
- Capture: tokens in/out, wall time, task success (SWE-bench's own pass/fail), cache hit ratio (parse `stream-json` usage events).

**Day 8–9: run comparison, analyze**
- 20–50 tasks per condition if time allows; 5 minimum.
- Generate `.planning/research/SPIKE-RESULTS.md` with tables + caveats.

**Day 10: Spike report + kill/continue decision**
- If no measurable improvement on at least one of {tokens, success rate, cache stability} → **kill**, write post-mortem.
- If positive → roadmap for v1.1.

### Build-order rationale

- Stripping and sync are **both** hard-dependency risks. If either fails, nothing downstream matters. Front-load them.
- Dashboard UI is low-risk (caveman-report proved it) and is parallelizable — it could even slip to week 2 without killing the spike.
- Eval runner goes last because it consumes 80% of the time budget and has zero value until the tool actually strips. Running eval on a broken tool would waste the budget.

## caveman-report → SAGOL Component Mapping

Verified by reading `/Users/chenjing/dev/caveman-report/src/*` (total ~300 LOC).

| caveman-report file | LOC | SAGOL destination | Lift type | Notes |
|---|---|---|---|---|
| `src/compiler.js` | 46 | `src/store/report.ts` | Direct port | `parseFrontmatter`, `validateSections`, `compileMarkdown`. Keep gray-matter + markdown-it. Replace Node `highlight.js` → `highlight.js` still works on Bun. |
| `src/context.js` | 44 | `src/store/context.ts` | Direct port | `updateContext` + `loadContext`. Minimal changes — switch `fs` → Bun's `fs/promises`. |
| `src/watcher.js` | 58 | `src/dashboard/watcher.ts` | Port with simplification | chokidar still works on Bun. Alternative: `Bun.fs.watch` (native, lighter). Debounce stays. |
| `src/server.js` | 278 | `src/dashboard/server.ts` | Rewrite (concept lift) | Drop `express` + `ws`. Use `Bun.serve({ fetch, websocket })`. Keep the route map (`/api/reports`, `/api/report/:id`) and the SPA shell inline HTML. Add `POST /api/feedback`. |
| `src/server.js` renderShell() | — | `src/dashboard/ui/index.html` | Extract to static file | The huge inline HTML string is the UI. Move to a real file for sane editing. Add feedback form. |
| `src/opener.js` | 9 | `src/dashboard/opener.ts` | Direct port | Use `open` npm package or Bun's `Bun.spawn(['open', url])`. |
| `bin/cli.js` | ? (not read) | `src/cli.ts` | Rewrite | New commands: `sagol start` (launches MCP server), `sagol eval`, `sagol init`. |
| `prompts/er.md` | ? | **Do not lift** | — | caveman's `er/` prompt style is compression-oriented; SAGOL uses separation instead. Write a fresh `prompts/sagol.md` + `.claude/skills/sagol/SKILL.md`. |
| `themes/` CSS | — | `src/dashboard/ui/theme.css` | Copy | Visual continuity is fine; CSS is not on the critical path. |
| `package.json` deps | — | `package.json` | Subset | Keep: `gray-matter`, `markdown-it`, `highlight.js`, `chokidar` (optional), `open`. **Drop:** `express`, `ws`, `commander` (use Bun's built-ins or a small CLI parser), `@clack/prompts` (not needed for a daemon). |

**Lift-first rule:** before writing any new module in weeks 1–2, grep caveman-report for an analog. caveman is ~300 LOC of shipping code; most of the non-MCP parts of SAGOL already exist there.

## Anti-Patterns

### Anti-Pattern 1: Trying to strip Bash/Write/Read output via hooks

**What people do:** Assume a `PostToolUse` hook can filter any tool's output before the agent sees it.
**Why it's wrong:** `updatedMCPToolOutput` is **MCP-tools-only** per the April 2026 docs. Built-in Claude Code tools (Bash, Read, Write, Edit, Grep, Glob) have immutable outputs from the agent's perspective. Trying to intercept them leads to either `decision: "block"` (which removes the tool result entirely, breaking the agent) or unsupported transcript-file mutation hacks.
**Do this instead:** Force all report-worthy output through SAGOL's MCP tool. The subagent or skill explicitly calls `sagol_write_report`. Don't try to auto-capture arbitrary tool output.

### Anti-Pattern 2: Running the dashboard as a separate daemon

**What people do:** Split the dashboard server into a standalone background process, talk to it from the MCP server over HTTP or a socket.
**Why it's wrong:** Two processes = two lifetimes = PID files, health checks, "is it running?" logic, stale state, orphaned ports. None of this adds value for a single-user v1.
**Do this instead:** One Bun process, stdio for MCP, localhost socket for dashboard. Both die together when Claude Code shuts down the MCP child.

### Anti-Pattern 3: Relying on transcript mutation for stripping

**What people do:** Write a `Stop` or `PreCompact` hook that rewrites the session `.jsonl` file on disk.
**Why it's wrong:** The docs explicitly state hooks cannot modify the permanent transcript. Even if you hack the `.jsonl`, Claude Code's in-memory context is already tainted for the current turn. You'd also fight the cache invalidation because the prefix would change retroactively.
**Do this instead:** Prevent pollution at the tool-result boundary using `updatedMCPToolOutput`. Never let the full body enter context in the first place.

### Anti-Pattern 4: Using UserPromptSubmit to inject browser feedback

**What people do:** Write a hook on `UserPromptSubmit` that pulls from a file the browser writes to and injects the feedback as `additionalContext`.
**Why it's wrong:** `UserPromptSubmit` only fires when the **user** types into the terminal. The hook has no trigger when the browser alone submits feedback — the agent won't wake up. You'd also be racing the user's actual prompts.
**Do this instead:** Blocking MCP tool. The agent calls it when it's ready for feedback, the tool holds until feedback arrives, the return value is the feedback.

### Anti-Pattern 5: Making the eval runner an MCP tool

**What people do:** Expose `sagol_run_swebench` as an MCP tool so the agent can self-evaluate.
**Why it's wrong:** Evaluation must run in a clean context to measure pollution effects. If the eval is triggered from inside a Claude session, that session's context is already tainted — you're measuring the wrong thing.
**Do this instead:** Drive eval from the outside shell (`bunx sagol eval`). Each eval run spawns its own `claude -p --bare` with and without SAGOL's `.mcp.json`.

## Integration Points

### External Services

| Service | Integration Pattern | Notes |
|---|---|---|
| Claude Code (host) | stdio MCP child process | Wired via `.mcp.json` entry pointing at `bun /abs/path/sagol/src/mcp/server.ts`. |
| Claude Code hooks | subprocess stdin/stdout JSON | `PostToolUse` hook matcher: `mcp__sagol__write_report`. |
| Claude Code (headless) for eval | `claude -p --bare --mcp-config <cfg> --output-format stream-json` | Used by eval-runner to spawn baseline and SAGOL conditions. `--bare` ensures a clean reproducible environment. |
| SWE-bench harness | `Bun.spawn(['python', 'run_swebench.py', ...])` | Shell out to the Python harness; parse its JSON result file. No direct API. |
| Browser (Chromium/Firefox) | HTTP + WebSocket to `localhost:<port>` | Dashboard SPA. |

### Internal Boundaries

| Boundary | Communication | Notes |
|---|---|---|
| `mcp-server` ↔ `report-store` | Direct function call | Same process, same module tree. |
| `mcp-server` ↔ `dashboard-server` | In-process `EventEmitter` + shared `waiters` map | No serialization, no port. |
| `dashboard-server` ↔ browser | HTTP (JSON) + WebSocket (JSON frames) | Same as caveman-report; lifted wire format. |
| `hooks/strip-report.ts` ↔ Claude Code | subprocess stdin/stdout JSON | Hook script is **not** part of the MCP server process — it's a standalone executable spawned per tool call. Keep it deterministic and fast (<50ms). |
| `eval-runner` ↔ Claude Code | `claude -p` subprocess | `eval-runner` is a separate CLI command, not running inside Claude. |

## Scaling Considerations

SAGOL is explicitly single-user local v1. Scaling is out of scope, but documenting the "what breaks first" path so v2 has a map:

| Scale | Architecture Adjustments |
|---|---|
| 1 user, 1 session (v1 target) | Monolith Bun process. Everything in this doc. |
| 1 user, concurrent sessions | Dashboard needs to become a long-lived daemon (process per session fights for port). Introduce a tiny shared broker or use per-session random ports + a registry file. |
| Multi-user (team) | Dashboard needs auth + multi-tenant report namespacing. Move report-store to a DB (SQLite → Postgres). Out of v1. |

### First bottleneck
Port collision between concurrent Claude Code sessions. **Fix:** random port + print URL on startup. 10 LOC.

### Second bottleneck
Blocking `sagol_await_feedback` tool with no dashboard open → agent hangs. **Fix:** built-in timeout (already planned at 10 min) + log a warning to stderr.

## Sources

- Claude Code Hooks reference (April 2026): https://code.claude.com/docs/en/hooks — HIGH confidence. Key fields: `updatedMCPToolOutput` (PostToolUse, MCP-only), `additionalContext`, `updatedInput`, `decision: block`.
- Claude Code Subagents: https://code.claude.com/docs/en/sub-agents — HIGH. Confirms "returns only the summary" is built-in subagent behavior, reducing R3's burden for subagent-produced content (though not for non-subagent tool output).
- Claude Code Skills: https://code.claude.com/docs/en/skills — HIGH. Confirms Skill can attach hooks and MCP servers; SAGOL can ship as a single `.claude/skills/sagol/` dir.
- Claude Code MCP: https://code.claude.com/docs/en/mcp — HIGH. Tool names in hooks appear as `mcp__<server>__<tool>`.
- Claude Code headless / Agent SDK: https://code.claude.com/docs/en/headless, https://code.claude.com/docs/en/agent-sdk/overview — HIGH. `claude -p --bare --mcp-config` enables deterministic eval runs. `--output-format stream-json` emits token/usage events needed for metrics.
- Agent SDK user input: https://code.claude.com/docs/en/agent-sdk/user-input — HIGH. `AskUserQuestion` and `canUseTool` callback exist but only in SDK mode, not interactive Claude Code. This is why SAGOL uses a blocking MCP tool instead — it works in both interactive TUI and headless `-p`.
- caveman-report source: `/Users/chenjing/dev/caveman-report/src/{compiler,context,watcher,server,opener}.js` — HIGH. Read in full; direct LOC counts above.
- SAGOL PROJECT.md: `/Users/chenjing/dev/sagol/.planning/PROJECT.md` — HIGH. R1–R9 requirements, kill-switch, 1–2 week Spike.

---
*Architecture research for: Claude Code agent report router + context hygiene tool*
*Researched: 2026-04-14*
