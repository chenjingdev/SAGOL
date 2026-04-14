# Feature Research — SAGOL

**Domain:** Agent output router + browser report dashboard + context-cleanliness tool + evaluation harness (Claude Code Skill/MCP plugin)
**Researched:** 2026-04-14
**Confidence:** MEDIUM-HIGH (direct source inspection of caveman-report, official MCP Apps spec 2026-01-26, official Claude Code hooks docs; Spike scope opinions are HIGH confidence because PROJECT.md is explicit)

---

## Research Framing

SAGOL is **not** an observability tool, **not** a report-writing CLI, and **not** an eval framework. It is a **hypothesis validation rig** whose whole existence is gated by a kill-switch: "does separating agent output into reports + keeping only summaries in main context measurably improve SWE-bench?" Every feature must earn its place against that question. Anything that doesn't move the kill-switch needle is out.

Four reference families inform the feature landscape:

1. **caveman-report** (`~/dev/caveman-report`) — SAGOL's direct ancestor. Node + chokidar watcher + Express/WS dashboard + gray-matter frontmatter + markdown-it. ~1115 LOC total. Direct inspection done. See section "caveman-report Inheritance" below.
2. **MCP Apps (SEP-1865, released 2026-01-26)** — official Anthropic/OpenAI joint extension for UI resources declared by MCP servers, rendered as sandboxed iframes inside the host, with JSON-RPC-over-postMessage bidirectional channel. This is the canonical pattern SAGOL's dashboard *could* follow — but v1 probably won't (see anti-features).
3. **Agent observability tools (Langfuse, LangSmith, Helicone, Phoenix/Arize, AgentOps, OpenLLMetry)** — LLM tracing/eval platforms. They converge on OpenTelemetry, typed observation types (tool/retriever/agent/generation), trace trees, evals, prompt management. SAGOL overlaps superficially but is philosophically opposite — see "SAGOL vs Observability Tools" below.
4. **SWE-bench harness** (`swebench.harness.run_evaluation`) — Docker-based reproducible eval of model patches against real repos. Three-layer image cache (base/env/instance). Ships a run_id, predictions_path, dataset_name API. SAGOL integrates this as a child_process — not a rewrite.

---

## caveman-report Inheritance

Direct file inspection (`~/dev/caveman-report/src/*.js`, `bin/cli.js`, `package.json`, `TODO.md`). Total reusable surface is small but load-bearing.

### Features to LIFT (reuse, possibly port Node→Bun)

| caveman Feature | File | LOC | Why Valuable for SAGOL |
|-----------------|------|-----|------------------------|
| Frontmatter-based markdown report schema (id/title/type/created/tags/summary) | `src/compiler.js` + gray-matter | ~45 | Exactly R2. Already validated schema. Bun has built-in TOML but gray-matter is trivially portable. |
| chokidar file watcher with debounce | `src/watcher.js` | ~57 | Exactly R2. Debounced on `add`/`change` with 300ms. Port to Bun's `fs.watch` or keep chokidar. |
| Context index builder (`context.json` = all report metadata) | `src/context.js` | ~43 | Simple JSON sidecar. Fine for Spike. Replace with SQLite only if needed. |
| Express + ws dashboard with live reload | `src/server.js` | ~277 | Exactly R4. SPA shell + `/api/reports` + `/api/report/:id` + `ws://localhost/ws` push on new report. Port Express→Bun.serve, keep WS. |
| Markdown rendering (markdown-it + highlight.js) | `src/compiler.js` | ~10 | Table stakes for dashboard. Keep. |
| CLAUDE.md block injection with start/end markers | `bin/cli.js:injectClaudeCode` | ~15 | Useful for auto-configuring host. But SAGOL should use Skill/MCP install, not markdown injection. Conditional keep. |
| Auto-shutdown after 10min idle | `bin/cli.js:resetIdleTimer` | ~10 | Nice UX hygiene. Cheap to keep. |
| JSONL cache-break analyzer | `src/cache/*` | ~? | **OUT** — this is caveman's v2 pivot, not SAGOL's scope. SAGOL's kill-switch is SWE-bench, not cache forensics. Could be revisited post-Spike if context-pollution metric needs KV cache signal. |

### Features to KILL (explicitly do not bring)

| caveman Feature | Why Drop |
|-----------------|----------|
| `er/` prefix trigger convention | Caveman's "AI decides when to write a report" model is exactly what TODO.md was already trying to abandon. SAGOL triggers on **every** subagent/tool result via PostToolUse/SubagentStop hooks — not per-prompt opt-in. |
| "Reason in compressed English" system prompt | Explicitly in PROJECT.md Out of Scope. This was caveman's kill reason — it conflated compression with separation. |
| Multi-client inject (Cursor/Windsurf/Copilot) | PROJECT.md Out of Scope: v1 = Claude Code only. Caveman's own TODO.md lists this for removal too. |
| Themes system + custom CSS | Zero kill-switch value. Default theme only. |
| `caveman-report init` interactive clack TUI | SAGOL installs as Skill/MCP, not as a per-project CLI. No init flow. |
| Report type taxonomy (bug-analysis/feature-design/code-review/general) with H2 section validation | Premature schema. SAGOL reports come from subagents of any shape. Single "report" type with free-form markdown body is enough for Spike. |
| `list`/`read`/`summary`/`delete`/`uninstall` CLI commands | Dashboard covers list/read. `delete` via dashboard button. CLI commands aren't on kill-switch path. |
| i18n guide text (ko/en/ja/zh hardcoded) | Dashboard UI in ko+en only, hardcoded in one place. No lookup table. |

**Net inherited LOC (estimate):** ~400 lines of logic worth lifting (watcher + server + compiler + context), plus architectural patterns. The rest is rewritten cleanly around hooks + Skill/MCP install, not around file-prefix triggers.

---

## SAGOL vs Agent Observability Tools (Langfuse / LangSmith / Helicone / Phoenix / AgentOps)

Despite surface similarity ("capture agent output, show it in a dashboard"), SAGOL is **categorically different** and must not drift into this space:

| Dimension | Obs tools (Langfuse et al) | SAGOL |
|-----------|---------------------------|-------|
| **Primary purpose** | Post-hoc debugging + production monitoring of LLM apps | Live **context surgery** during active coding session |
| **Data model** | OpenTelemetry spans, typed observations (generation/tool/retriever/chain), trace trees | Flat list of markdown reports with frontmatter |
| **Integration** | SDK/proxy wrapping LLM clients; OTEL exporters | Claude Code PostToolUse/SubagentStop hook, MCP tool |
| **Direction** | Read-only — observes what happened | **Bidirectional** — user approval in dashboard flows back to terminal as next agent action (R5) |
| **Context effect** | Zero — doesn't touch the agent's actual context | **Core purpose is to strip output from context** (R3) |
| **Target user** | Platform/ML team monitoring prod | Single developer in active Claude Code session |
| **Eval** | LLM-as-judge, annotation queues, datasets | Standard SWE-bench harness, external, run_id diff |
| **Scale** | 10K–1M+ requests, multi-tenant | localhost, single user, single session |
| **Persistence** | Days-to-months retention, search | Session-local markdown files |

**What SAGOL can learn from them:**

- **Typed observations idea** — Langfuse's span types (tool/retriever/agent/generation) are a better long-term schema than caveman's rigid H2 section validation. For Spike v1, a single `source` field (subagent name | tool name | hook event) is enough; don't build a taxonomy yet.
- **OpenTelemetry** — tempting, but **anti-feature for Spike**. Adding OTEL pulls in exporters, collectors, and a schema commitment. Keep JSON sidecar.
- **Prompt caching awareness** (Helicone's angle) — relevant but already covered by SWE-bench as the kill-switch metric.

**What SAGOL must NOT become:**

- Another generic LLM tracing platform. There are ≥8 of them and the space is saturated.
- An eval framework. PROJECT.md explicit: use SWE-bench externally, don't build one.

---

## MCP Apps Inheritance

MCP Apps (SEP-1865, released **2026-01-26** — verified via blog.modelcontextprotocol.io) is the standard pattern for MCP servers to return UI resources rendered as sandboxed iframes with JSON-RPC-over-postMessage bidirectional channels. Supported in Claude, Goose, VS Code Insiders, ChatGPT.

### What MCP Apps gives you "for free"

- `_meta.ui.resourceUri` field on tool returns → points to `ui://...` resource
- Host fetches, renders in sandboxed iframe, handles messaging
- UI can invoke server tools directly
- Apps can modify model context based on user interaction

### Why SAGOL's dashboard is NOT an MCP App in v1

This is the single biggest architectural temptation, and the answer for Spike is **no**:

1. **Inline iframe ≠ external browser window.** SAGOL's value ("bigger workspace for reports, separate from chat window") requires a real browser tab, not a 400px iframe inside Claude Code's TUI/web chat.
2. **Multi-report dashboard with filters/navigation** is a persistent window, not per-tool-call UI.
3. **Two surface areas** — MCP Apps could still be useful as a *secondary* thin preview ("tool returned this report, click to open in dashboard") but that's v1.x, not Spike.
4. **Dev velocity** — standing up MCP App plumbing vs reusing caveman's Bun HTTP+WS in 2 days is a no-contest for Spike timeline.

**Revisit in v2** if hypothesis validates and a hosted/packaged distribution is wanted.

---

## SWE-bench Harness Integration

Verified via official docs (`swebench.com/SWE-bench/reference/harness/`). Key surface:

```bash
python -m swebench.harness.run_evaluation \
  --dataset_name princeton-nlp/SWE-bench_Lite \
  --predictions_path <path> \
  --max_workers 8 \
  --run_id <id> \
  --cache_level env
```

Three-layer Docker cache (base/env/instance), ~100 GB for `env`. Instance layer is ~30-60 min build per task cold.

**SAGOL's job is minimal:** produce a valid predictions JSONL and invoke the harness. The harness writes logs to `logs/run_evaluation/<run_id>/<model>/<instance>/` and SAGOL reads the result summary.

**What matters for kill-switch:**
- **SWE-bench Lite subset** (300 tasks) — still too big for Spike. Pick a ≤20-task subsample for first pass. Full Lite for final kill-switch call.
- **Two runs on identical task set**: baseline (no SAGOL) vs SAGOL. Compare pass rates, total tokens, cache-read ratio.
- **Deterministic prediction** requires temperature=0 and pinned model version.
- **Docker disk cost** → pre-warm env cache once, reuse across baseline+SAGOL runs.

---

## Feature Landscape

### Table Stakes (Spike v1 — REQUIRED for kill-switch decision)

Features without which the SWE-bench comparison cannot happen or cannot be trusted. Missing these = can't make a go/kill call.

| Feature | Why Expected / Why Required for Kill-Switch | Complexity | Notes |
|---------|---------------------------------------------|------------|-------|
| **F1. MCP/Skill install into Claude Code** | R1. Without this, SAGOL isn't attached — no hooks fire, no reports, no context strip. Foundation. | LOW | Skill = `SKILL.md` + scripts. MCP = tiny Bun server exposing `list_reports`/`get_report`/`create_report` tools. Spike: do both minimal. |
| **F2. Report capture from subagent/tool output** | R2. The data source. No capture = no reports = nothing to measure. | LOW-MED | Claude Code hook `PostToolUse` + `SubagentStop` (verified exists in official hook docs). Write markdown to `.sagol/reports/<id>.md` with frontmatter. Lift caveman `compiler.js` + `watcher.js` verbatim. |
| **F3. Context stripping hook (core mechanism)** | R3. Literally the hypothesis under test. If this doesn't work, there's nothing to evaluate. | MED | Use `PostToolUse` hook's `updatedMCPToolOutput` (MCP tools) and/or `SubagentStop` `decision: "block"` + inject `additionalContext` with a ≤200-token summary pointing to the report id. Verified this exists in hook reference. |
| **F4. Report summary generation (≤200 tokens)** | R3. The thing left behind in main context. Too long = no context benefit; absent = main context loses the reference entirely. | LOW | Simplest: take first paragraph or frontmatter `summary`. Optional: LLM-generated via Haiku. Keep simple for Spike. |
| **F5. Local HTTP + WebSocket dashboard with live list + report view** | R4. The human surface. Without it, you can't eyeball reports during a session to know if the capture is even working. | MED | Lift caveman `server.js` nearly verbatim. Bun.serve + Bun native WebSocket. `/api/reports`, `/api/report/:id`, `ws://localhost/ws`. Auto-open browser on first report. |
| **F6. Bidirectional approve/reject/revise flow** | R5. Core differentiator vs all observability tools. Even for Spike, need a minimum channel: approve/reject as 2 buttons, revise as a textarea. Result is POSTed back, picked up by the running SAGOL (file poll or WS client held open by a running `sagol wait-for-action` command). | MED-HIGH | Simplest mechanism: dashboard POST writes `actions/<report_id>.json`; an MCP tool `await_user_action(report_id)` polls that file. This is the trickiest spike piece. Timeout + default=approve to avoid deadlock during benchmarks. |
| **F7. SWE-bench runner wrapper (external child_process)** | R6. The kill-switch itself. Must produce identical task sets for baseline vs SAGOL. | MED | `sagol bench run --mode=baseline|sagol --dataset=SWE-bench_Lite --instances=<subset> --run-id=<id>`. Wraps `python -m swebench.harness.run_evaluation`. Parses result log into `results/<run_id>.json`. No custom harness. |
| **F8. Result comparison report (baseline vs SAGOL diff)** | R6+R7. The kill-switch *output*. Pass rate delta, token usage delta, per-instance diff table. Saved as markdown so it becomes the final Spike report artifact. | LOW-MED | Single script reads two run JSONs, emits markdown table + verdict. |
| **F9. Minimal frontmatter schema (id/title/source/timestamp/summary)** | R2 prerequisite. Defines what a report *is*. | LOW | gray-matter or Bun's built-in YAML. No type taxonomy. |
| **F10. Markdown rendering in dashboard (code highlight)** | R4 table stakes — reports are LLM-written markdown. Unreadable dashboard = can't inspect capture quality. | LOW | markdown-it + highlight.js (lifted) or Bun alternatives. |
| **F11. Reports persisted as flat markdown files in project** | Deterministic, inspectable, diffable, survives crashes. Aligns with caveman's pattern. | LOW | `.sagol/reports/*.md`. No database. |
| **F12. Spike runbook + result template** | R7. Without a fixed protocol, the baseline/SAGOL runs aren't comparable and the kill-switch decision is hand-wavy. | LOW | Markdown checklist: preconditions, commands, expected artifacts, decision rubric. |
| **F13. README ko+en bilingual** | R9. Publication/write-up is part of Spike deliverable — this is a "share the learning" project. | LOW | Single README with both languages. |

**Rough Spike v1 complexity budget (1-2 weeks, 1 dev):**
- Days 1-2: F1, F9, F11 (skill/MCP scaffold + file schema + dirs)
- Days 3-4: F2, F3, F4 (capture + strip + summary via hooks)
- Days 5-6: F5, F10 (dashboard lift from caveman + Bun port)
- Days 7-8: F6 (bidirectional loop — highest risk)
- Days 9-10: F7 (SWE-bench wrapper + first subset run)
- Days 11-12: F8, F12, F13 (comparison + runbook + README)
- Days 13-14: buffer + kill-switch decision meeting with self

### Differentiators (What SAGOL does that nothing else does)

Features that set SAGOL apart from caveman-report, observability tools, and MCP Apps generically.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| **D1. Context-strip-on-capture via hooks** | No existing tool in the obs/trace space actually mutates the host agent's context. This IS the hypothesis — it's the whole reason to build SAGOL. | MED | See F3. |
| **D2. Bidirectional approval loop (dashboard → terminal → agent)** | Langfuse/Phoenix are read-only; MCP Apps iframes can push messages but only within the chat UI. SAGOL makes the browser a *peer surface* for approvals, meaningful during multi-minute agent runs. | MED-HIGH | See F6. |
| **D3. Integrated measurement against standardized coding benchmark** | Obs tools ship LLM-as-judge evals; SAGOL ships actual SWE-bench runs so "does it help" is a compiled/tested number, not a judge score. | MED | See F7+F8. |
| **D4. Outlives single chat window** | Browser tab persists across Claude Code sessions, TUI resizes, crashes. caveman already proved this pattern valuable. | LOW | Falls out of F5. |
| **D5. "Boss approves employee reports" mental model** | Product framing from PROJECT.md. Makes the tool comprehensible to non-power-users in one sentence. | LOW | Documentation differentiator, not code. |
| **D6. Kill-switch built in from day 1** | The project ships with its own termination criterion. Refreshing honesty in LLM tooling space. | LOW | Runbook + README framing. |

### Anti-Features (Explicitly NOT built)

Features that seem natural extensions but **would dilute the kill-switch, explode scope, or duplicate existing tools.**

| Anti-Feature | Why Tempting | Why NOT in Spike | Alternative / Defer To |
|--------------|-------------|------------------|------------------------|
| **Multi-host support (Codex, Cursor, Windsurf, OpenCode)** | caveman had it; "broader reach = more feedback" | PROJECT.md Out of Scope. Quadruples integration surface before hypothesis is validated. | v2+ if Spike passes. R5 design should leave the door open but not implement it. |
| **OpenTelemetry / generic tracing / OTEL exporters** | Industry standard; Langfuse/Phoenix converge on it | Adds schema commitment + exporter maintenance. SAGOL isn't a trace DB. | If telemetry signal ever needed, export to Langfuse via OTEL at v2+, don't reinvent. |
| **LLM-as-judge evals / annotation queues** | Langfuse + LangSmith core feature; "Eval is hard, let's add helpers" | PROJECT.md: use standard SWE-bench, don't build custom eval. LLM-judge for coding tasks is strictly inferior to actual test execution. | SWE-bench is authoritative. Only thing SAGOL "evals" is the hypothesis. |
| **Prompt management / versioning / playground** | Every obs tool has this | Zero kill-switch value. | Defer indefinitely. Not SAGOL's category. |
| **Custom evaluation framework** | "I know my domain better" | PROJECT.md Out of Scope explicit. | External benches only. |
| **Report compression ("AI writes in English, translates to user lang")** | Caveman's whole pitch | Caveman's documented kill reason. Conflates compression with separation hypothesis. | Separation only. If tokens matter, the SWE-bench number will show it. |
| **MCP App UI resources for dashboard (sandboxed iframe in chat)** | 2026-01 standard, "the right thing" | Dashboard is an external *workspace*, not an in-chat widget. Also kills dev velocity. | v1.x: add a secondary MCP App thin preview ("Open report in dashboard") linked to main dashboard. v2: consider full MCP App mode as alternate surface. |
| **Multi-user / auth / cloud sync** | "If it's useful, people will want it" | PROJECT.md Out of Scope. Localhost-only + security-simpler. | v2+ if hypothesis validates + there's demand. |
| **npm publish / binary distribution / homebrew tap** | Standard OSS path | PROJECT.md: hypothesis validation first. Publishing infrastructure is separate milestone. | Post-Spike, if kill-switch passes. |
| **Report type taxonomy with section validation** (caveman-style) | "Enforces report quality" | Premature schema. Subagent outputs don't fit fixed shapes. | Single "report" type, free-form body. Add taxonomy only if analysis needs it. |
| **Real-time token counting / cost tracking** | Helicone's niche; easy to see value | Out of scope for hypothesis. SWE-bench run outputs total tokens — that's enough. | Helicone proxy if someone wants it later. |
| **Dashboard auth / remote access** | "What if I want to view from laptop while running on desktop" | localhost-only = PROJECT.md constraint. | SSH tunnel, don't build auth. |
| **Auto-summary via Haiku API call** (instead of naive first-paragraph) | Quality summaries | Adds network cost + API key management + non-determinism to measurement rig. | F4 starts naive. Only upgrade if summaries are demonstrably hurting the hypothesis (e.g., losing key info that would keep agent on track). |
| **KV cache forensics (lifted from caveman)** | caveman has working code | Different project. Signal useful post-Spike if hypothesis partially validates. | Keep caveman's `src/cache/*` as reference; do not merge into Spike. |
| **i18n system beyond ko/en hardcode** | "LLMs are global" | PROJECT.md Out of Scope. | Hardcoded strings only. |
| **Report editing / commenting / threading** | "Dashboard should be collaborative" | localhost + single user. Explicitly Out of Scope. | Approve/reject/revise covers the single-user case. |
| **Report search / full-text index** | "When I have 1000 reports..." | Spike will have <100 reports/session. YAGNI. | Browser Ctrl-F on list is fine. |

---

## Feature Dependencies

```
F1 (Skill/MCP install)
  └── F2 (Report capture via hooks)
        ├── F9 (Frontmatter schema) ─────┐
        ├── F11 (Markdown file persist) ─┤
        ├── F3 (Context strip hook) ─────┤
        │     └── F4 (Summary generation)─┤
        └── F5 (HTTP+WS dashboard) ──────┤
              ├── F10 (Markdown render)  │
              └── F6 (Bidirectional loop)┤
                                         ▼
                            F7 (SWE-bench runner wrapper)
                                         │
                                         ▼
                            F8 (Baseline vs SAGOL diff report)
                                         │
                                         ▼
                            F12 (Spike runbook)
                                         │
                                         ▼
                            Kill-switch decision
                                         │
                                         ▼
                            F13 (README bilingual — writeup)
```

### Dependency Notes

- **F1 gates everything** — no install mechanism, no hooks fire.
- **F2 → F3** — can't strip what wasn't captured; capture must land the body somewhere before hook can replace tool output with a summary.
- **F3 → F4** — strip needs a thing to leave behind; naive summary (first paragraph) is on the critical path even if prettier summaries are deferred.
- **F6 is independent of F7/F8** — bidirectional loop does NOT affect kill-switch measurement (benchmark runs are autonomous). **F6 could be deferred to week 2** if week 1 is tight. **Consider this the biggest schedule lever.**
- **F7 requires F2+F3+F4 working end-to-end** in the SAGOL mode run — the baseline mode run doesn't need SAGOL at all. Baseline run can start while F3 is still being debugged.
- **F11 (flat files) conflicts with** any database/schema DI — forces simple, portable persistence. Deliberate.
- **Anti-feature conflicts:** D1 (context strip) conflicts with OTEL passive tracing philosophically; MCP App iframe dashboard conflicts with D4 (external workspace). These are deliberate incompatibilities.

---

## MVP Definition

### Launch With (Spike v1, 1-2 weeks — Kill-Switch Bundle)

Minimum for kill-switch decision. Everything else is noise.

- [ ] **F1** Skill + minimal MCP server — Claude Code attaches SAGOL
- [ ] **F2** PostToolUse/SubagentStop hook captures agent output to `.sagol/reports/<id>.md`
- [ ] **F3** Same hook strips output, replaces with ≤200-token summary pointing to report id — **this is the hypothesis mechanism**
- [ ] **F4** Naive summary (frontmatter `summary` field or first paragraph)
- [ ] **F5** Bun HTTP+WS dashboard, reports list, click-to-view (lift from caveman)
- [ ] **F7** `sagol bench run` wrapping `swebench.harness.run_evaluation`, baseline + SAGOL modes
- [ ] **F8** Result diff report (markdown) comparing the two runs
- [ ] **F9** Frontmatter schema with id/title/source/created/summary
- [ ] **F10** Markdown rendering in dashboard
- [ ] **F11** Flat markdown file persistence
- [ ] **F12** Spike runbook + decision rubric
- [ ] **F13** Bilingual README (ko/en)

### Add During Week 2 If Week 1 Slips (Stretch — drop to preserve kill-switch)

- [ ] **F6** Bidirectional approve/reject/revise loop — **high value differentiator but orthogonal to the SWE-bench number**. Ship it in week 2 if possible; defer to v1.1 if week 1 bleeds. The hypothesis can be validated without it.

### Add After Validation (v1.x — only if Spike passes kill-switch)

- [ ] Richer report taxonomy (`source_kind: subagent|tool|hook` → filterable dashboard)
- [ ] LLM-generated summaries via Haiku (if naive summaries measurably lose hypothesis signal)
- [ ] MCP App thin preview ("Open full report in dashboard") as secondary surface
- [ ] Full SWE-bench (not just Lite subset) run
- [ ] Report search / filtering in dashboard
- [ ] Polished Claude Code plugin package
- [ ] Approval loop timeouts, retries, batch approvals

### Future Consideration (v2+ — requires clear pull from users)

- [ ] Multi-host support (start with Codex CLI because of shared MCP surface, then Cursor)
- [ ] OpenTelemetry exporter (so users of Langfuse/Phoenix can pipe SAGOL reports into existing obs stack)
- [ ] Full MCP App mode as alternate UI surface (iframe inside chat)
- [ ] npm package / binary distribution
- [ ] Cloud sync / hosted dashboard (risk: becomes an obs tool — resist)
- [ ] Remote access / multi-user
- [ ] KV cache forensics re-integration from caveman for deeper context-pollution metrics

---

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority | Rationale |
|---------|-----------|---------------------|----------|-----------|
| F1 Skill/MCP install | HIGH | LOW | **P1** | Foundation. Nothing works without it. |
| F2 Report capture hook | HIGH | LOW | **P1** | Data source for everything. |
| F3 Context strip hook | HIGH | MED | **P1** | The hypothesis. No strip = no SAGOL. |
| F4 Naive summary | HIGH | LOW | **P1** | Co-dependent with F3. |
| F5 Dashboard (lift) | HIGH | MED | **P1** | Needed to inspect capture quality; lift from caveman. |
| F6 Bidirectional loop | MED (v1) / HIGH (long-term) | MED-HIGH | **P1-/P2+** | P1 target, P2 acceptable slip. |
| F7 SWE-bench wrapper | HIGH | MED | **P1** | The kill-switch itself. |
| F8 Result diff report | HIGH | LOW | **P1** | The kill-switch *output*. |
| F9 Frontmatter schema | HIGH | LOW | **P1** | Report definition. |
| F10 Markdown render | MED | LOW | **P1** | Dashboard readability. |
| F11 Flat file persist | HIGH | LOW | **P1** | Diffable, inspectable, robust. |
| F12 Spike runbook | HIGH | LOW | **P1** | Without this the kill-switch decision is hand-wavy. |
| F13 Bilingual README | MED | LOW | **P1** | Publication is part of Spike deliverable. |
| LLM summary via Haiku | MED | MED | P3 | Only if naive summaries hurt hypothesis. |
| Report taxonomy | LOW | LOW | P3 | Premature. |
| MCP App iframe mode | LOW (Spike) | HIGH | P3 | v2+. |
| OTEL export | LOW (Spike) | HIGH | P3 | v2+. |
| Multi-host | LOW (Spike) | HIGH | P3 | v2+. |

**Priority key:**
- **P1**: Must have for Spike kill-switch decision
- **P1-**: P1 target but formal degradation path exists (F6)
- **P2**: Should have, slip to v1.x if necessary
- **P3**: Post-validation only

---

## Competitor Feature Analysis

| Feature | caveman-report | Langfuse/Phoenix (obs) | MCP Apps (Anthropic 2026-01) | SAGOL approach |
|---------|---------------|------------------------|------------------------------|----------------|
| Agent output capture | via AI prefix (`er/`) | SDK instrumentation / OTEL | via tool return | **PostToolUse/SubagentStop hook** — automatic, not opt-in |
| Report persistence | Markdown files | DB (Postgres/Clickhouse) | Ephemeral UI resource | Markdown files (lift from caveman) |
| Dashboard | Local Express+WS | Hosted web app | Sandboxed iframe in host | Local Bun HTTP+WS (lift pattern) |
| Context modification | None | None (read-only) | Via model context updates field | **Active strip via updatedMCPToolOutput** — SAGOL's core differentiator |
| User feedback loop | None | Annotations post-hoc | postMessage JSON-RPC | **Approve/reject/revise back to terminal** (F6) |
| Eval integration | None | LLM-as-judge, custom | None | **Standard SWE-bench harness child_process** |
| Multi-tenant | No | Yes | N/A | **No — single-user local** |
| Install | `npm i -g` + init | SDK/proxy | MCP server registration | **Skill + MCP** in Claude Code |
| Host support | Any AI w/ CLAUDE.md | LLM apps generally | Claude/Goose/VSCode Insiders/ChatGPT | **Claude Code only (v1)** |
| Kill-switch | None | None (product) | None (protocol) | **SWE-bench baseline delta** |
| Taxonomy | Rigid (bug/feature/review) | Typed observations | Tool-declared | **Flat — single type, free body** |

**Key insight:** SAGOL occupies an empty quadrant — "active context surgery + external browser surface + standard benchmark gating". No competitor combines these. This justifies the build *conditional on the hypothesis holding*.

---

## Critical Risks to the Feature Set

These aren't pitfalls (that's PITFALLS.md's job), they're feature-level risks to the Spike:

1. **F3 may not be implementable cleanly.** `updatedMCPToolOutput` works for MCP tools but subagent outputs route through `SubagentStop` which only supports `block`, not replace. If subagent output can't be surgically replaced, context-strip only works for tool outputs — and the hypothesis has a narrower blast radius than advertised. **Mitigation:** early prototype of F3 on day 1-2 before committing to rest of stack.

2. **SWE-bench Docker setup eats a day.** ~100 GB disk, ~60 env images, Python deps. **Mitigation:** pre-warm on day 1 in parallel to other work. Don't let this block the scoring protocol design.

3. **F6 bidirectional may require sticky MCP session.** If Claude Code's MCP runs are short-lived per tool call, "await user approval" tool can't block for minutes. May need a separate background SAGOL process with IPC. **Mitigation:** F6 has formal P2 escape hatch.

4. **Sample size matters.** <20 task subsample may not show statistically meaningful delta even if hypothesis is real. **Mitigation:** F12 runbook defines decision rubric including "inconclusive" verdict that triggers more-tasks-before-kill.

---

## Sources

### Direct code inspection (HIGH confidence)
- `/Users/chenjing/dev/caveman-report/src/watcher.js` — chokidar pattern
- `/Users/chenjing/dev/caveman-report/src/server.js` — Express+WS pattern
- `/Users/chenjing/dev/caveman-report/src/compiler.js` — gray-matter frontmatter + markdown-it
- `/Users/chenjing/dev/caveman-report/src/context.js` — JSON sidecar index
- `/Users/chenjing/dev/caveman-report/bin/cli.js` — CLAUDE.md injection
- `/Users/chenjing/dev/caveman-report/TODO.md` — caveman's own migration plans (plugin pivot, output trimming)
- `/Users/chenjing/dev/caveman-report/package.json` — dependency surface

### Official documentation (HIGH confidence)
- [MCP Apps blog post (2026-01-26 release)](https://blog.modelcontextprotocol.io/posts/2026-01-26-mcp-apps/) — SEP-1865, UI resource spec, sandboxed iframe rendering, JSON-RPC postMessage
- [Claude Code hooks reference](https://code.claude.com/docs/en/hooks) — `PostToolUse` with `updatedMCPToolOutput`, `SubagentStop` with `decision: "block"`, 10K-char context cap
- [SWE-bench harness reference](https://www.swebench.com/SWE-bench/reference/harness/) — `run_evaluation` API, three-layer Docker cache
- [SWE-bench Docker setup guide](https://www.swebench.com/SWE-bench/guides/docker_setup/) — ~100 GB env layer, cache levels

### Agent observability landscape (MEDIUM confidence — WebSearch synthesis)
- [Langfuse docs — observability overview](https://langfuse.com/docs/observability/overview) — OTEL, typed observation types
- [Langfuse observation types](https://langfuse.com/docs/observability/features/observation-types)
- [Helicone vs LangSmith 2026 comparison (Morph)](https://www.morphllm.com/comparisons/helicone-vs-langsmith) — proxy vs SDK architecture
- [15 AI Agent Observability Tools 2026 (AIMultiple)](https://aimultiple.com/agentic-monitoring)
- [8 AI Observability Platforms (Softcery)](https://softcery.com/lab/top-8-observability-platforms-for-ai-agents-in-2025) — category landscape

### MCP Apps landscape (MEDIUM confidence)
- [Anthropic/OpenAI joint MCP Apps standard (Inkeep)](https://inkeep.com/blog/anthropic-openai-mcp-apps-extension)
- [The New Stack: Anthropic extends MCP with a UI framework](https://thenewstack.io/anthropic-extends-mcp-with-an-app-framework/)

---
*Feature research for: SAGOL — Claude Code Skill/MCP agent report router + context-cleanliness tool + SWE-bench validation rig*
*Researched: 2026-04-14*
