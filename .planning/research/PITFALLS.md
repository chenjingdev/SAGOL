# Pitfalls Research — SAGOL

**Domain:** Claude Code Skill/MCP — agent report router + context hygiene tool (Greenfield Spike)
**Researched:** 2026-04-14
**Confidence:** HIGH for caveman-report lessons and Claude Code hook quirks (direct source reads + official issue trackers); MEDIUM for SWE-bench and Bun quirks (current web sources, not first-hand); LOW for 2026 plugin ecosystem forward-looking claims (fast-moving)

## Reading Notes (Evidence Base)

- Read `/Users/chenjing/dev/caveman-report/CLAUDE.md`, `README.md`, `TODO.md`, `prompts/er.md`, `src/server.js`, `src/watcher.js` — direct anti-pattern extraction.
- `.planning/PROJECT.md` Out of Scope and kill-switch wording drives the phase mapping.
- 2026-04 web sources: Anthropic `claude-code` issue #46829 (cache TTL regression), SWE-bench Pro paper / Epoch AI leaderboard (contamination audit), Bun compat 2026 writeups (child_process + native addons).

---

## Critical Pitfalls

### Pitfall 1: Concept Contamination — mixing a "cool idea" into the hypothesis until the hypothesis can't fail cleanly

**What goes wrong:**
caveman-report died because two orthogonal ideas — "AI reasons in compressed English to save tokens" and "AI writes reports to files instead of chat to keep context clean" — were welded together in the system prompt (`prompts/er.md`) and the README. When the tool "worked," nobody could tell which half did the work, and when it "didn't work," nobody could tell which half failed. `er.md` still encodes this fusion: `## chat (English, telegraphic)` + `## file ({lang}, normal tone)` in the same activation trigger. The caveman-cache-report analysis artifact also shipped with number mismatches (162/200 vs 300, different bucketing, different break percentages) precisely because the two halves of the concept were reported independently without a single source of truth.

SAGOL inherits the risk because (a) the user still believes in the context-hygiene insight, and (b) any small additional feature (summary length, report type taxonomy, approval-driven continuation) will look like a natural extension until it silently becomes another uncontrolled variable in the SWE-bench comparison.

**Why it happens:**
"Separation" is an infrastructure concern. "Compression" felt like a free extra win. Adding the second variable makes the demo narrative richer, so there is social/aesthetic pressure to keep it. The author does not notice the hypothesis has become unfalsifiable until the benchmark comes back ambiguous.

**How to avoid:**
- In Phase 0 (Hypothesis), write the **single** variable being measured on one line and commit it. For SAGOL: *"Stripping sub-agent report bodies out of the main transcript changes SWE-bench performance by ≥X% vs an otherwise-identical baseline."* Nothing about compression, nothing about dashboard UX, nothing about approval flow, nothing about Korean-report quality.
- **Dashboard, approval flow, and multi-report types are ablations, not the hypothesis.** They must be switch-off-able via a flag (`SAGOL_STRIP_ONLY=1`) so that the benchmark can run with *only* the stripping variable active. If a feature cannot be switched off without breaking the tool, it has infected the hypothesis.
- Any new "while we're at it" idea gets added to `.planning/OUT_OF_SCOPE.md`, not to the Spike. Review this file at every phase transition.
- Mirror caveman-report's failure mode explicitly in PROJECT.md's Out of Scope (already done for "caveman-report식 글자/문장 압축") — keep that fence standing.

**Warning signs:**
- You find yourself explaining the tool in two sentences instead of one.
- A new requirement gets written as "and also" ("strips context *and also* rewrites the summary in Korean").
- The benchmark harness starts growing a `--mode` flag with more than two values (baseline / sagol).
- You catch yourself writing "we'll also measure X" in a phase plan — that's a second hypothesis hiding.

**Phase to address:**
Phase 0 (Hypothesis Lock) — write the one-line hypothesis and the kill-switch metric before any code. Verified at every phase transition by reading PROJECT.md's Core Value aloud and checking that no code change crosses it.

---

### Pitfall 2: Architecture-level "stripping" that isn't architecture-level

**What goes wrong:**
caveman-report's TODO.md shows the exact shape of this trap: the "Report Output Trimming" section admits that removing report bodies from assistant output was *never* integrated — it was still a TODO at decommission time. They planned to do it via a post-response hook with HTML-comment markers (`<!-- report:start -->` / `<!-- report:end -->`). This is a band-aid, not architecture: the AI has already generated the tokens, the markers rely on the model's cooperation, and the "stripping" only affects the next turn's prompt (not the current turn's KV cache, not the JSONL record, not the provider-side billing). Worse, `PostToolUse` and `Stop` hooks in Claude Code cannot actually mutate the assistant message in-place — they can *append* a `system-reminder` or block stop, but the assistant text is already committed to the transcript by the time they fire (per Anthropic hooks ref, code.claude.com/docs/en/hooks, 2026-04).

SAGOL's R3 ("메인 대화 컨텍스트에는 짧은 서머리만 남고 본문은 strip된다") will smash into this wall on day one unless the architecture is chosen with the constraint in mind.

**Why it happens:**
Hooks look like they can rewrite history. They can't. The transcript file on disk (`~/.claude/projects/.../<session>.jsonl`) is authoritative and the hook fires *after* the line is written. Undocumented mutation of JSONL between turns is fragile and has already broken across Claude Code minor versions (issue #11544: hooks silently not loading; v2.0.31 broke hooks entirely; v2.0.37 removed `last_assistant_message` field; issue #34713: false "hook error" labels). Depending on "I'll just edit the JSONL in a PostToolUse hook" is depending on undocumented file-format stability.

**How to avoid:**
- **Decide the stripping mechanism in Phase 1 Spike, before writing watcher/dashboard code.** The only mechanisms that are actually architectural (vs. cosmetic):
  1. **SubAgent wrapping** — a Task-tool sub-agent writes the report; only its `final_message` returns to the parent. This is first-class Claude Code behavior and *is* architectural — the parent never sees the body. This should be the default.
  2. **MCP tool response truncation** — an MCP tool returns `{summary, report_id}` instead of the full body. Also architectural (the protocol layer enforces it).
  3. Hook-based JSONL mutation — *not* architectural; document this as a known fragile path and only use it as a fallback to clean up leakage from #1/#2.
- In Phase 1, prove the chosen mechanism actually keeps the body out of the next turn's prompt *at the provider API level*. Measure cache_creation tokens before/after a report — if they differ by the report size, stripping is fake.
- Freeze a minimum Claude Code version in README. When a new minor breaks hooks or Task-tool behavior, the project either upgrades on purpose or stays pinned — no silent drift.
- **Never** use HTML-comment markers in assistant text as the stripping boundary. If the model forgets the marker once, the whole dataset is poisoned.

**Warning signs:**
- Your design doc contains the phrase "we'll intercept the assistant message" (red flag — you can't, reliably).
- Your Phase 1 smoke test checks that the report is "not visible" in the dashboard, but never checks `cache_creation_input_tokens` from the API response.
- You find yourself writing a regex to parse assistant messages out of JSONL files in a hook script.
- Claude Code's next minor release notes mention "hooks" or "transcript format" and you have to patch.

**Phase to address:**
Phase 1 (Stripping Mechanism Spike). The entire rest of the roadmap depends on this being real. If SubAgent/MCP cannot actually keep the body out of the parent's input tokens, the hypothesis has no mechanism and the project is already dead.

---

### Pitfall 3: The kill-switch that can't fire

**What goes wrong:**
PROJECT.md's kill-switch is "SWE-bench류 표준 평가에서 baseline 대비 의미 있는 향상이 없으면 폐기." This is exactly the kind of kill-switch that never actually fires. Common failure modes:
1. **Sample size too small to distinguish signal from variance.** SWE-bench Verified is 500 tasks; Epoch AI runs on 484. A ±3% run-to-run variance is normal, and 20-task subsample runs (common for cost reasons) have enormous noise. If the true effect is ±2% on the full set, a 20-task comparison cannot tell you anything.
2. **Contamination.** Per the 2026 OpenAI + CodeSOTA audits, Claude Opus 4.5, GPT-5.2, and Gemini 3 Flash can all reproduce verbatim patches for some SWE-bench Verified tasks. Models are 3-6× more accurate at bug localization on this set than on decontaminated held-out sets. Measuring SAGOL on Verified in 2026 means measuring it on a benchmark where the model already memorized many of the answers.
3. **The tool's own overhead outweighs its savings.** Dashboard server, WebSocket, file I/O, and hook execution each cost latency and tokens. If SAGOL's per-task overhead is 2k tokens and the context-hygiene savings are 1.5k tokens, SAGOL is net-negative even if the core idea is right.
4. **Baseline drift.** The user runs baseline today, then SAGOL in two weeks. Anthropic silently rolls a model update (or a cache-TTL regression like the March 2026 one, issue #46829) between runs, and the "improvement" is actually just model drift.
5. **"It kind of looks better" → motivated stopping.** You eyeball the numbers, they look ambiguous, you decide "the tool clearly helps on harder tasks, let's just keep it." Kill-switch silently disengaged.

**Why it happens:**
Writing a kill-switch feels binary; executing one is emotional. Sample sizes get shrunk for cost reasons. Contamination is invisible to the experimenter. Overhead isn't measured because the "benefit" is the only thing that gets instrumented.

**How to avoid:**
- **Pick SWE-bench Pro or a decontaminated subset, not Verified alone.** SWE-bench Pro (1,865 multi-language tasks, 2025 release) was built specifically because Verified contamination is confirmed. If Verified is the only option for cost reasons, use it only as a secondary and rank results on a held-out or SWE-bench Goes Live task subset.
- **Power calculation before the run.** Before running anything, decide: "How many tasks do we need such that a 3% real effect is detectable at p<0.05?" If the answer is more tasks than budget allows, the kill-switch is already broken — either raise the effect threshold or expand budget.
- **Measure SAGOL's overhead in isolation** — wrap the tool around a no-op and measure added latency, added tokens, added cache_creation. This is your floor. Any reported gain under this floor is noise, not signal.
- **Run baseline and SAGOL within the same session, same day, same model version.** Interleave tasks. Pin model version explicitly (`claude-opus-4-6[1m]` etc.) and record the full version string with every result.
- **Pre-register the exact kill-switch numbers** in a dated `.planning/research/KILL_SWITCH.md`: "If task-success delta < +3% at n≥100 *or* token delta > +0%, we kill." Written down, signed, checked into git. Un-budgeable later.
- **Three independent full runs** on baseline and on SAGOL, not one. Report the variance. If the variance bars overlap, the result is null regardless of the means.

**Warning signs:**
- Your first eval run is 10 tasks "for speed."
- Your "improvement" number is reported to 2 decimal places from a single run.
- You're about to say "but look at which tasks it helped on" — that's cherry-picking, and your kill-switch was a summary stat.
- The benchmark tool you chose has no way to log per-task token usage.
- The dates on your baseline and SAGOL runs are more than 48h apart.

**Phase to address:**
Phase 0 (Kill-Switch Lock) for pre-registration; Phase 2 (Eval Infra) for the actual harness and power check; Phase 4 (Final Run) for the three-run protocol. Kill-switch doc is immutable after Phase 0 — any edit is itself a warning sign.

---

### Pitfall 4: Evaluation infrastructure outgrows the thing being evaluated

**What goes wrong:**
The user's Out of Scope already calls this out ("Custom evaluation framework 자체 제작" is forbidden), but the failure mode is more insidious than "writing a framework." It's: (1) wrap SWE-bench in a shell script, (2) add logging, (3) add result diffing, (4) add per-task retry logic, (5) add a results viewer — and suddenly you have 3,000 lines of eval code, a week has passed, and the SAGOL core tool is still 200 lines of prototype. By the time you run the eval, you have to debug the eval runner, not the tool, and your Spike's deadline is blown.

caveman-report's TODO.md "JSONL 캐시 모니터링 앱" section shows the same gravitational pull — a side project (cache monitoring) started growing inside the main project and was never contained.

**Why it happens:**
Eval infra is tangible, debuggable, and produces numbers that look like progress. The actual hypothesis test is one binary moment at the end that either kills the project or doesn't. Human psychology prefers the continuous feedback of infra building.

**How to avoid:**
- **Hard budget: eval infra ≤ 300 LOC.** Track it. If it crosses, stop, delete, and call SWE-bench's own CLI directly with a thin `bun run` wrapper.
- **Call SWE-bench via `child_process.spawn`, log stdout to a file, done.** Parse the result JSON SWE-bench already produces. Don't build a results database, don't build a dashboard for eval results (the SAGOL dashboard is for the *tool*, not for the benchmark).
- **In Phase 2, set a "halt-and-evaluate" rule: if eval infra work exceeds 1 calendar day, something is wrong.** Either SWE-bench is harder to invoke than expected (investigate — is there a first-party docker image?) or you're gold-plating.
- **No per-task retry logic.** SWE-bench failures are signal, not noise.
- **Use `SWE-bench Goes Live` or the Epoch AI hosted runner if available** — hosted runs avoid reinventing infra entirely. Verify cost and quotas in Phase 0.

**Warning signs:**
- The eval runner has its own logger class.
- You've written a "resume from checkpoint" feature for the eval harness.
- You're designing a cache for intermediate eval results.
- You notice you've spent two days without touching the actual SAGOL stripping code.

**Phase to address:**
Phase 2 (Eval Infra) — enforce LOC budget; Phase 0 — explicit "eval harness is a spawn wrapper" decision.

---

### Pitfall 5: Spike calendar rot — "almost done" becomes "month two"

**What goes wrong:**
1-2 week Spike, explicit kill-switch, already tried once (caveman-report) — this is a project with every ingredient for scope creep. The failure shape: Week 1 ends, stripping mechanism works but the dashboard has no approval flow yet. "Approval flow is 4 hours of work." Week 2 ends, approval flow works but reports don't re-trigger agent actions. "Just 2 more days." Week 4, everything is beautiful, nobody has run the benchmark. Week 6, project dies of indecision rather than evidence. caveman-report's phasing into "방향 전환: Claude Code Plugin 전용" in TODO.md is the exact pre-death signal — a project that can't ship the current plan pivots the plan instead of killing it.

**Why it happens:**
The kill-switch is binary; polishing is continuous. Continuous feels like progress. "Kill-switch" feels like failure. Every small polish buys the author another day of denial.

**How to avoid:**
- **Hard calendar deadline with a dated kill ceremony.** PROJECT.md says 1-2 weeks — pick the exact date (e.g., 2026-04-28). On that date, either (a) the kill-switch comparison has run and produces a verdict, or (b) the project is automatically declared failed because it couldn't even produce a verdict. No third option.
- **Walking-skeleton first, polish never.** Phase 1 (stripping mechanism) → Phase 2 (benchmark) → Phase 3 (one demo). If Phase 1 works at all, Phase 2 starts the next day even if Phase 1 is ugly. R5 (bidirectional approval flow) is a differentiator, not a prerequisite — it's Phase 3.
- **The approval-flow UI must be skippable from the benchmark run.** If the benchmark requires a human click, you will never complete a 100-task run. The benchmark mode must auto-approve by default.
- **Daily "what did the benchmark say today" check-in, starting Day 1.** Even if the answer is "the benchmark hasn't run yet," the question itself pulls work toward the kill-switch.
- **Pre-commit: if scope adds, something else drops.** Maintain a `.planning/PHASE_BUDGET.md`. Adding a feature = deleting another.

**Warning signs:**
- You're on day 8 and the benchmark has never executed end-to-end, not even on a 5-task smoke run.
- You're polishing the dashboard CSS.
- You catch yourself comparing to caveman-report UX rather than to caveman-report's hypothesis outcome.
- You write "Phase 1.5" anywhere.

**Phase to address:**
Phase 0 (Calendar Lock + Phase 3 Demo Budget); every phase transition checks days-elapsed vs days-remaining.

---

### Pitfall 6: Hook/SubAgent versioning drift — the floor moves under you

**What goes wrong:**
Claude Code has had confirmed hook breakages within a single month: v2.0.31 broke hooks entirely (GH issue tracker), v2.0.37 removed `last_assistant_message` from hook input, issue #11544 shows hooks silently not loading from settings, and the March 2026 cache TTL regression (issue #46829) silently halved the 1h cache TTL to 5m, causing 20-32% token cost inflation for all cached workloads. SAGOL's mechanism is entirely built on Claude Code hook + SubAgent semantics. Any of these, undetected, will either (a) break the stripping silently (body leaks back into context, benchmark compares apples to pears) or (b) wreck cache behavior across a run so the benchmark numbers reflect the platform, not SAGOL.

**Why it happens:**
Claude Code is moving fast in 2026. Hooks are user-level config, not a stable API. Cache TTL is not a config knob the user controls. There is no semver contract. Regressions between baseline run and SAGOL run silently rewrite the comparison.

**How to avoid:**
- **Pin the Claude Code version** for the entire Spike. Record the exact version string in every benchmark run's metadata.
- **Phase 1 smoke test: a "leakage canary."** A test report with a unique 128-bit random token in its body. After the sub-agent writes it, grep the parent's next-turn prompt / API request for that token. If it appears, stripping is broken. Run this canary every time you touch the hook or upgrade Claude Code.
- **Measure `cache_creation_input_tokens` and `cache_read_input_tokens` explicitly, every run.** If these numbers shift between baseline and SAGOL runs by more than the tool's expected effect, the platform moved under you — abort and re-pin.
- **Baseline and SAGOL runs within the same Claude Code process lifetime** when possible, to minimize hook-load and cache regression windows.
- **Subscribe to Claude Code release notes and the hook-related issues.** Watch `anthropics/claude-code` issues filtered by label `hooks` and `cache` in particular. A one-sentence entry in a changelog can invalidate days of eval.
- **Prefer MCP tool response truncation over hook JSONL mutation** (see Pitfall 2) — MCP semantics are more stable than undocumented hook transcript edits.

**Warning signs:**
- A new Claude Code version installed automatically.
- Benchmark token numbers shifted without code changes.
- The canary test starts finding the token in the transcript.
- A hook-related GitHub issue opens that mentions your exact event (PostToolUse / Stop / SubagentStop).

**Phase to address:**
Phase 1 (Stripping Mechanism) for canary design; Phase 2 (Eval Infra) for pinning + metadata logging; continuous watch throughout.

---

### Pitfall 7: Bun + SWE-bench (Python) cross-runtime impedance

**What goes wrong:**
SAGOL is Bun+TS. SWE-bench is Python + docker. These communicate via `child_process.spawn`. Bun's `child_process` is "solid" for 95% of cases per 2026 compat writeups, but has known quirks: (a) stdio `ReadStream` handling had bugs up through v1.1.5, (b) some packages that rely on N-API / node-gyp bindings (including some chokidar extensions on darwin) fall back to polling on Bun, (c) `fork()` IPC semantics differ subtly, (d) `single-file executable` builds can't embed native addons cleanly. If the eval harness calls `docker` → Python → SWE-bench, and any of that communicates over pipes with quirky stdio, the benchmark results may be noisy in a way not reproducible outside Bun.

The single-binary distribution path also hides a trap: Bun's `--compile` produces a macOS binary that ships its own runtime; if SAGOL depends on any npm package with native code (e.g. `better-sqlite3`, some `chokidar` variants), the compiled binary will either silently fall back to a slower path or fail at runtime on a fresh machine. Less relevant for a personal-use Spike, but the user's tendency to think about packaging ("v1은 본인 머신에서만") may not stay that way.

**Why it happens:**
Bun's Node-compat is 95%, but SWE-bench is exactly in the 5% tail (docker CLI, long-running Python subprocess, line-buffered stdout). "It works" on 10 quick tasks, then 100-task runs expose stdio edge cases.

**How to avoid:**
- **Do not embed SWE-bench execution inside SAGOL.** SAGOL writes a task list file; a separate shell script runs SWE-bench. Bun ↔ Python communication happens via the filesystem and exit codes, not live pipes. This is the "eval harness is a spawn wrapper" rule from Pitfall 4.
- **Write chokidar's watcher with `usePolling: false` first, but have a polling fallback path for CI.** Watch for darwin FSEvents issues on Bun (see Bun issue #595 and related). If watcher misses files, add polling with a known interval.
- **Avoid native addons in the dependency tree.** Prefer `bun:sqlite` over `better-sqlite3`; use Bun's built-in WebSocket/HTTP over `ws` and `express` where possible. This also cuts caveman-report's `express`+`ws` dependency away.
- **Do not ship a single-binary in v1.** Out of scope per PROJECT.md, and it hides compat issues. `bun run sagol.ts` is fine for the Spike.
- **Pin Bun version** and log it in benchmark metadata.

**Warning signs:**
- Watcher tests pass locally but miss files under heavy concurrency.
- SWE-bench subprocess output is truncated or interleaved.
- You add `node:child_process` directly instead of `Bun.spawn` — inconsistent APIs will bite.
- Any dependency's `install` step runs `node-gyp`.

**Phase to address:**
Phase 1 (Stack Bootstrap) — lock Bun version and forbid native addons; Phase 2 (Eval Infra) — enforce "benchmark is a separate process" boundary.

---

### Pitfall 8: Browser ↔ Terminal sync assumptions that break in real use

**What goes wrong:**
caveman-report's `src/server.js` shows the real-world patterns: a single `/ws` endpoint, auto-reconnect on `onclose` with a 2-second backoff, and a full `loadReports()` on reconnect. That works for single-user, single-tab, foreground use. SAGOL's R5 (bidirectional approval → triggers next agent action) makes this brittle:
1. **Background tab throttling.** Chrome and Edge throttle WebSocket timers in background tabs. An approval click in a backgrounded tab may be delayed by up to 15s, or worse, coalesce with other events. User approves, agent doesn't continue, user assumes broken.
2. **Reconnect race.** On reconnect, caveman-report's code calls `loadReports()` then `loadReport(match[1])` — but there is no guarantee the WebSocket is ready to *send* before the user clicks approve. A click during the 2-second reconnect window is lost silently.
3. **Multi-window behavior.** User opens two dashboard tabs. Clicks approve in tab A. Tab B doesn't know the report is approved and still shows "pending." User gets confused. Worse: user clicks approve in *both* tabs, and the agent receives two approve events for the same report.
4. **"Local only" isn't enforced.** The server binds to `0.0.0.0` by default in most Express setups (caveman-report uses Express). On a coffee-shop wifi, another user on the same LAN can see / act on your reports. SAGOL's security story is "local only" but nothing in the stack enforces it.
5. **Terminal emulator clipboard quirks.** caveman-report's "Copy ID" button calls `navigator.clipboard.writeText()`. Some terminals that launch via `open http://...` (Arc, WezTerm under certain configs) do not grant clipboard permission; the button silently fails.
6. **Auto-shutdown after 10 min idle** — caveman-report's feature. During a long benchmark run where the tab is backgrounded, the server dies, the next hook call fails, and half a benchmark run is corrupted.

**Why it happens:**
WebSocket "live reload" feels like a solved problem from 2015. The actual 2026 browser adds background throttling, BFCache restore quirks, and strict Permissions-Policy rules that nobody tests until a real user complains.

**How to avoid:**
- **Bind to `127.0.0.1`, not `0.0.0.0`.** Explicit `host: '127.0.0.1'` in Bun.serve. Verify in Phase 1 with `curl` from another machine — it should fail.
- **Include a short per-session secret in the URL** (`?t=<random>`) and reject requests without it. Local-only + secret = defense in depth against stray LAN actors.
- **Idempotent approval events.** Every approval carries the report ID + a client-generated `action_id`. The server deduplicates. Two tabs firing "approve" produces one action.
- **Server-authoritative state.** Tabs never assume they know the approval state; they always ask the server on visibility change (`document.visibilitychange` → `loadReports()`).
- **WebSocket with heartbeat and explicit pending-queue.** If disconnected, queue user actions locally and flush on reconnect. Do not fire-and-forget during the 2s reconnect window.
- **Disable the 10-min idle auto-shutdown during benchmark runs.** Or remove it entirely — the Spike doesn't need it.
- **Benchmark mode must have an approval-free path.** The benchmark cannot wait for browser clicks; auto-approve or bypass the approval flow entirely (see Pitfall 5).
- **Document: "multi-window is unsupported in v1."** Writing the limitation down is cheaper than fighting it.

**Warning signs:**
- During manual testing, you notice "sometimes the dashboard doesn't update but a refresh fixes it."
- An approval click produces no server log entry.
- A background tab, when re-foregrounded, shows stale report list.
- `netstat -an | grep <port>` shows the server listening on `0.0.0.0`.

**Phase to address:**
Phase 3 (Dashboard) — explicit local-binding + secret; Phase 1 (Stripping Mechanism) — benchmark mode bypasses dashboard entirely; document multi-window as unsupported in README.

---

### Pitfall 9: "Reuse caveman-report code" becomes "rebuild caveman-report"

**What goes wrong:**
R8 says "caveman-report 자산을 부분 lift." PROJECT.md explicitly warns against a full fork. The failure mode: you start by copying `src/watcher.js` (57 lines, clean), then `src/server.js` (277 lines, has embedded HTML/CSS/JS, `GUIDE_I18N`, i18n guide rendering, light/dark theme machinery, filter buttons). You don't want to break the "working" code so you keep its shape. Two days later you have caveman-report's architecture with the SAGOL name on it, and the "chat output is ephemeral, AI reasons in compressed English" idea is still implicitly baked into the layout (there's a "Quick Start" guide about `er/` prefix burned into `renderShell()`).

**Why it happens:**
Lifting is faster than rewriting. Each thing you lift creates pressure to lift one more thing to not break it. The i18n table is "just 50 lines" but it carries the caveman idiom with it.

**How to avoid:**
- **Lift only these files, and reimplement everything else.** From reading the source: `src/compiler.js` (45 lines, frontmatter + markdown parse) and `src/context.js` (43 lines, report index) are safe to lift verbatim. `src/watcher.js` is 57 lines and narrowly-scoped — lift, but strip the `validateSections` section-type logic (that's caveman-specific "bug/feature/review/general" taxonomy that should not carry over). **Do not lift** `src/server.js` — rewrite from scratch using `Bun.serve` (saves ~150 lines of Express/WS boilerplate anyway, and forcibly drops the `GUIDE_I18N` table and caveman Quick Start).
- **Budget: ≤200 LOC lifted total.** If you're lifting more, you're rebuilding.
- **No "caveman-report" strings in SAGOL.** Not in code, not in docs, not in config paths. The brand separation is not just aesthetic — it prevents the user from unconsciously copying caveman semantics.
- **Rewrite the system prompt.** `prompts/er.md` fuses the two concepts (compressed chat + file report) — SAGOL's equivalent prompt must mention only separation, never compression. Write from a blank file.
- **Audit with `grep` at end of Phase 1:** `grep -r "caveman\|compressed\|telegraphic\|er/" .` should return zero hits. If not, concept contamination has already happened.

**Warning signs:**
- You've copied any file from caveman-report over 100 lines.
- You're keeping a config field you don't use because "removing it might break something."
- The SAGOL dashboard has a "Quick Start" that explains a trigger prefix.
- You find yourself reading caveman-report's history to remember how a feature worked.

**Phase to address:**
Phase 1 (Lift Budget) — upfront LOC cap and file whitelist; Phase 1 exit criterion — grep audit.

---

### Pitfall 10: The tool "works" but doesn't answer the question

**What goes wrong:**
Everything is green. Stripping demonstrably removes the body. Dashboard updates live. Approval flow triggers the next agent action. You run SWE-bench. The number comes back. The number is within noise, *but* — and this is the killshot — you realize you can't tell whether the tool's overhead cancels its savings, whether the tool helps on some tasks and hurts on others, whether the benchmark you chose is the right one for the effect you're measuring (e.g., SWE-bench tests localization + patching; SAGOL's mechanism may only help on long-horizon tasks where context pollution compounds, so Verified's short-context tasks aren't sensitive to it). You spend a week post-hoc slicing the data trying to find where SAGOL "would have" helped. This is the exact place caveman-report died — the tool produced artifacts, the artifacts didn't conclusively answer the hypothesis.

**Why it happens:**
Benchmarks are a proxy for the hypothesis. A good proxy is a feature of Phase 0 design, not something you can recover post-hoc. "Does SWE-bench Verified even measure context-pollution effects?" is a question that must be asked *before* committing to it.

**How to avoid:**
- **Phase 0: validate the benchmark is sensitive to the mechanism before committing.** Design a trivial synthetic check: take one long-horizon task, artificially inject 10k tokens of noise into the context, measure success rate with and without the noise. If injecting noise doesn't degrade the baseline, SWE-bench Verified is insensitive to context pollution in the first place — pick a different benchmark (SWE-bench Pro's multi-file multi-step tasks are more likely to expose context pressure; or SWE-bench Goes Live's streaming tasks).
- **Track two outcomes per task, not one:** `task_success` *and* `total_tokens` (creation + read). A tool that keeps success flat while cutting tokens 30% is still a win under a kill-switch that includes "token usage, task success rate, cache stability — at least one." Log all three from day one.
- **Log cache_read_input_tokens vs cache_creation_input_tokens separately.** Cache stability is part of the kill-switch. A tool that improves success but thrashes cache is suspect.
- **Write the results interpretation template before running the experiment.** "If delta < X, we kill. If X ≤ delta < Y, we keep but shrink scope. If delta ≥ Y, we continue." Fill in X and Y in Phase 0.
- **Pre-register which subsets you'll slice by, if any.** Any slicing not pre-registered is p-hacking.

**Warning signs:**
- You're writing a SQL query against the benchmark results to "find where SAGOL helped."
- The phrase "but if you look only at the long tasks" appears.
- You're designing a second benchmark because the first was "the wrong kind of test."
- The kill-switch number is just barely on the "keep" side and your instinct is relief, not suspicion.

**Phase to address:**
Phase 0 (Benchmark Sensitivity Check) — synthetic noise-injection test before committing to SWE-bench Verified; Phase 4 (Results) — pre-registered interpretation template; Phase 4 exit criterion — ability to write the kill decision in one sentence.

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Lift caveman-report's `server.js` wholesale instead of rewriting with `Bun.serve` | Day-1 working dashboard | Drags in Express, `ws`, i18n table, `er/` Quick Start HTML, caveman idioms; later becomes load-bearing | Never — rewrite in `Bun.serve` is ≤100 LOC |
| Hook-based JSONL mutation for stripping (the caveman-report TODO approach) | "Good enough" stripping on a demo | Silently breaks across CC minor versions; can't mutate the current turn; leaves the hypothesis mechanism unverifiable | Only as a fallback cleanup after SubAgent/MCP-based stripping has proven architectural |
| Reuse caveman's HTML-comment `<!-- report:start -->` markers | Matches existing TODO plan | Model forgets marker once → silent leakage; markers survive in transcript anyway | Never — use structural separation (SubAgent/MCP) |
| Run SWE-bench on 10-20 tasks "to start" | Fast iteration loop | Results are dominated by noise; kill-switch is inoperable on sub-100 task runs | Only for smoke testing the harness, never for the kill-switch decision |
| Benchmark baseline + SAGOL on different days | Easier scheduling | Baseline drift (model version, cache TTL) silently confounds results | Never when kill-switch is in play — interleave within a session |
| Embed the approval flow into the benchmark path | Tests the "real" end-to-end | Benchmark can't run headless; 100-task runs are impossible; you build a bypass anyway | Never — bypass from day 1 |
| `express` + `ws` instead of `Bun.serve` | Familiar, well-documented | Doubles dependency surface, one more place for Node/Bun compat issues | If the user has a specific Express middleware already needed (unlikely for Spike) |
| `better-sqlite3` instead of `bun:sqlite` | More mature API | Native addon, breaks single-binary story, Bun/Node compat risk | Never in v1 |
| Skip the leakage canary test because "the sub-agent obviously works" | Saves an hour | A silent regression rewrites the benchmark outcome and you don't notice | Never — the canary is the cheapest defense for the hypothesis |

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| Claude Code hooks (PostToolUse / Stop) | Assume you can mutate assistant text in the current turn | You can't. Hooks fire after commit. Use SubAgent boundary or MCP tool response as the architectural strip; hooks are only for downstream cleanup |
| Claude Code SubAgent (Task tool) | Assume the sub-agent's full transcript is stripped automatically | Only the `final_message` returns. Verify via leakage canary — a buggy sub-agent implementation can still surface body text in tool_result |
| Claude Code MCP tool | Return the full report in the tool response | Return `{summary, report_id}` only. The MCP transport is the enforcement layer |
| SWE-bench (Python) from Bun (TS) | Live pipe SWE-bench stdout back into TS for UI | Use filesystem boundary: write task list, spawn benchmark, read result JSON. No live pipes |
| SWE-bench Verified as the primary metric | Treat it as a gold-standard comparison | Verified is contaminated (confirmed 2025-2026). Use SWE-bench Pro as primary or report both |
| Chokidar on macOS + Bun | Use default FSEvents config | Verify events fire reliably under Bun on darwin; have polling fallback path |
| WebSocket `/ws` auto-reconnect | Fire user actions immediately after reconnect | Queue actions locally until connection confirmed; dedupe by action_id |
| Browser clipboard API in a backgrounded tab | Assume `writeText` works silently | Requires user-gesture + visible tab; show a fallback display of the ID to copy manually |
| Bun single-file compile with native deps | `bun build --compile` with `better-sqlite3` | Native addons don't embed cleanly. Use `bun:sqlite` or no DB at all |
| Claude Code version pinning | Install latest on every dev machine | Pin in docs; record exact version in every benchmark result's metadata |

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| SAGOL overhead > SAGOL savings | Baseline and SAGOL token counts are similar, success rates indistinguishable | Measure overhead in isolation (SAGOL wrapping a no-op task) before any benchmark run | Any task where the tool's per-call token cost > the context savings it produces — typically short tasks |
| Cache thrashing from report I/O | `cache_creation_input_tokens` spikes every turn; `cache_read_input_tokens` stays low | Write reports *after* the response turn, not during; group I/O to minimize cache-busting hook injections | Long sessions (>30 min) where SAGOL activates repeatedly |
| Dashboard WebSocket chatter pollutes user's main session | Cache break messages in Claude Code logs, correlated with dashboard reload events | Keep dashboard on a separate port and entirely isolated from the Claude Code session's I/O; confirm no shared process state | When SAGOL and dashboard both run in the same Bun process with shared stdio |
| File watcher reacting to `.md` writes causes synchronous index updates that stall the hook | Hook takes 500ms+; Claude Code logs show hook timeout warnings | Debounce watcher (caveman does 300ms already — keep it); move index update off the hot path | When reports are written in bursts (10+ in a short window) |
| Benchmark run saturates Claude API rate limit | SWE-bench tasks fail with 429s, results look worse than baseline | Stagger tasks; use the same rate-limit budget for both conditions; record rate-limit hits in metadata | Any 100+ task run on a non-enterprise API plan |
| Bun HTTP server performance degrades with many WebSocket clients | Multi-tab opens cause CPU spikes | Cap client count (multi-window unsupported anyway); monitor `process.cpuUsage()` during runs | >5 concurrent WS clients — not a real v1 concern but flag it |

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| Server binds to `0.0.0.0` by default | Any LAN peer can read/act on reports | Explicit `host: '127.0.0.1'` in Bun.serve config; verify with off-host curl |
| No auth on `/api/*` routes (caveman-report pattern) | LAN peer or a local malicious process can fire approval events | Per-session URL token; reject requests without it; regenerate on each SAGOL start |
| Report bodies logged to stdout / log files | Sensitive sub-agent analysis leaks to disk in cleartext | Log only report IDs + metadata; route bodies only to the user's designated report dir |
| "Local only" claim not verified | User trusts README, attacker on same wifi reads reports | Phase 1 exit test: from a second machine on the same network, `curl http://<host>:<port>/api/reports` must fail |
| Hook scripts running arbitrary shell commands with unescaped report content | Command injection via crafted report title/content | Use Bun's `Bun.spawn([...])` array form, never shell strings; validate frontmatter against a strict schema |
| Approval flow trusts browser-supplied report IDs without signing | A stray tab or injected JS could approve arbitrary reports | Bind approval tokens to `(report_id, session_token)` server-side; reject cross-session approvals |
| Clipboard-based workflows leak report IDs to system paste history | Sensitive IDs in paste history | Use copy-to-text-area pattern, not auto-copy; document the risk |

## UX Pitfalls

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| Dashboard auto-shuts down after 10 min idle (caveman-report feature) | Long benchmark runs fail mid-way; user loses work | Disable idle shutdown in benchmark mode; make it a config flag, default off for v1 |
| No "what is SAGOL doing right now" status in the dashboard | User can't tell if stripping is active or silently broken | Persistent header badge: "Stripping: ON (last canary: 2 min ago)" with the canary token hash |
| Multi-tab users click approve twice and get duplicate agent actions | Benchmark run or debug session is corrupted | Idempotent approval events with server-side dedup |
| Reports are named only by ID (caveman's `YYYYMMDD-kebab-slug`) | Hard to find the report you just approved when the list grows | Sort by recency, pin "newly arrived since last open," link directly from terminal on report creation |
| Report summary in main chat is either too long or too short | Too long = defeats the purpose; too short = user has to go read the dashboard for every action | Standardize: ≤200 tokens with report ID + one-line title + one-line verdict |
| User opens dashboard in a backgrounded tab, approval is delayed | User gives up, decides tool is broken | Focus-on-activity: open dashboard in foreground tab automatically when a new report arrives (opt-in) |
| No explicit "this is a Spike, kill-switch is X" banner in the dashboard | User forgets the kill-switch, loses the discipline | Dashboard footer: "Kill date: 2026-04-28 — days remaining: N" |

## "Looks Done But Isn't" Checklist

Verify these at each phase exit:

- [ ] **Stripping mechanism:** Report body leaves the sub-agent but still appears in `cache_creation_input_tokens` on the next turn (platform didn't actually strip it). Verify via: run a canary report with a random 128-bit token; confirm token does *not* appear in the next API request payload.
- [ ] **Stripping mechanism:** Works in a single test, fails under concurrent report generation. Verify via: fire 5 sub-agent reports in parallel; check that all 5 bodies are absent from the parent context.
- [ ] **Dashboard:** Renders reports, but the `/api/reports` endpoint is bound to `0.0.0.0`. Verify via: `curl` from another host must fail.
- [ ] **Dashboard:** Live reload works in the foreground tab, silently fails in background tabs. Verify via: background the tab for 2 minutes, trigger a report, confirm list updates within 5s of refocusing.
- [ ] **Bidirectional approval:** Click in dashboard triggers next action, but only if the WebSocket was connected at click time. Verify via: disconnect WS, click approve, reconnect WS, confirm action still fires (client-side queue).
- [ ] **Benchmark harness:** Runs on 10 tasks, fails on 100 due to stdio buffering / rate limits. Verify via: force a 100-task dry run on cached results.
- [ ] **Benchmark harness:** Produces a number, but the number has no variance estimate. Verify via: require 3 runs per condition and report mean±stdev.
- [ ] **Benchmark harness:** Logs `task_success` but not `total_tokens` / `cache_creation` / `cache_read`. Verify via: grep the result JSON for all three fields.
- [ ] **Benchmark harness:** Baseline and SAGOL ran on different Claude Code / model versions. Verify via: metadata field `claude_code_version` and `model_id` must match across the comparison.
- [ ] **Kill-switch:** Decision criteria exist in a doc but aren't filled in with actual numbers. Verify via: `.planning/research/KILL_SWITCH.md` contains `delta_threshold: <number>` (not `<TBD>`).
- [ ] **System prompt for SAGOL:** Claims to describe separation, but accidentally includes compression language carried over from caveman. Verify via: grep for "compress", "telegraphic", "abbreviated" in the prompt file.
- [ ] **Leakage canary:** Designed but not running in CI / smoke tests. Verify via: a CI run (or manual smoke script) that executes the canary on every push.
- [ ] **README:** Claims local-only and hypothesis-driven, but links to a running public dashboard. Verify via: README "current status" says Spike with kill-switch date, no public deployment.

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Concept contamination (Pitfall 1) noticed mid-Spike | MEDIUM | Stop feature work. Re-read Core Value aloud. Add every creeping feature to Out of Scope. Re-run benchmark with the expanded-feature version disabled — if results differ, the contamination already poisoned earlier runs; rebaseline |
| Stripping mechanism doesn't actually strip (Pitfall 2) | HIGH if late | Abandon the hook path. Migrate to SubAgent boundary or MCP tool response. If neither is viable, kill the project — the hypothesis has no mechanism |
| Kill-switch can't distinguish signal from noise (Pitfall 3) | MEDIUM | Triple sample size, re-run both conditions, interleave tasks, pin model version. If still ambiguous, the effect is below the detectable threshold — kill the project |
| Eval infra grew too large (Pitfall 4) | LOW-MEDIUM | Delete the custom infra, replace with 50-line spawn wrapper, rerun. Loss is mostly sunk cost |
| Spike calendar rot (Pitfall 5) | HIGH if past deadline | Declare results as-of today even if incomplete. If no kill-switch verdict possible, mark project failed (not paused) — avoid the "just one more week" spiral |
| Claude Code version drift (Pitfall 6) | MEDIUM | Re-pin, re-run full benchmark comparison, document the drift event in KILL_SWITCH.md |
| Bun/SWE-bench subprocess flakiness (Pitfall 7) | LOW | Switch to filesystem-boundary IPC (write task file, read result file), abandon live pipe |
| Browser sync edge case in production (Pitfall 8) | LOW-MEDIUM | Document limitations, add server-authoritative state check on visibility change, restrict to single-window use |
| Over-lifted caveman code (Pitfall 9) | MEDIUM | Delete lifted files, rewrite with Bun primitives; keep only `compiler.js` + `context.js` + slimmed `watcher.js` |
| Benchmark insensitive to the mechanism (Pitfall 10) | HIGH if found late | Synthetic noise test first; if SWE-bench Verified is insensitive, switch to SWE-bench Pro or construct a long-context task subset |

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| 1. Concept contamination | Phase 0 (Hypothesis Lock) | One-line hypothesis written; re-read at every phase transition; grep for forbidden terms in prompts and code |
| 2. Fake architectural stripping | Phase 1 (Stripping Mechanism Spike) | Leakage canary test passes; `cache_creation_input_tokens` measured pre/post stripping |
| 3. Inoperable kill-switch | Phase 0 (Kill-Switch Lock) + Phase 2 (Eval Infra) | `.planning/research/KILL_SWITCH.md` has actual numbers; power calculation documented; 3-run variance protocol |
| 4. Eval infra bloat | Phase 0 (budget decision) + Phase 2 (enforce ≤300 LOC) | `wc -l` check at Phase 2 exit; eval harness is a spawn wrapper |
| 5. Spike calendar rot | Phase 0 (Calendar Lock) + every phase transition | Exact dated kill ceremony; daily "benchmark ran today?" check |
| 6. Version drift / hook breakage | Phase 1 (canary design) + Phase 2 (version pinning) | Pinned Claude Code + Bun versions in metadata; canary run on every version bump |
| 7. Bun/SWE-bench impedance | Phase 1 (Stack Bootstrap) + Phase 2 (filesystem-boundary IPC) | No native addons in dep tree; benchmark runs in separate process |
| 8. Browser/terminal sync edge cases | Phase 3 (Dashboard) | Local-bind test from second machine fails; idempotent approval; benchmark bypasses dashboard |
| 9. Over-lifted caveman code | Phase 1 (Lift Budget) | ≤200 LOC lifted; file whitelist; grep audit for "caveman", "compressed", "telegraphic", "er/" |
| 10. Tool works but benchmark insensitive | Phase 0 (Benchmark Sensitivity Check) + Phase 4 (Results interpretation) | Synthetic noise-injection test; pre-registered interpretation template |

## Sources

**Direct source reads (HIGH confidence):**
- `/Users/chenjing/dev/caveman-report/CLAUDE.md` — caveman's project-level self-diagnosis (number mismatches, overclaiming, halb-truths)
- `/Users/chenjing/dev/caveman-report/README.md` — the caveman concept and architecture
- `/Users/chenjing/dev/caveman-report/TODO.md` — the "never-integrated stripping" and "plugin pivot" evidence
- `/Users/chenjing/dev/caveman-report/prompts/er.md` — system prompt showing concept fusion
- `/Users/chenjing/dev/caveman-report/src/server.js`, `src/watcher.js` — actual code patterns to lift or avoid
- `/Users/chenjing/dev/sagol/.planning/PROJECT.md` — Out of Scope fence, kill-switch wording, Constraints

**Official / authoritative web sources (HIGH-MEDIUM confidence):**
- Claude Code Hooks reference — https://code.claude.com/docs/en/hooks (hook events, transcript access, known field removals)
- Anthropic `claude-code` issue #46829 — cache TTL silent regression from 1h → 5m, early March 2026 (HIGH)
- Anthropic Agent SDK hooks — https://platform.claude.com/docs/en/agent-sdk/hooks
- Bun docs — https://bun.com/docs/runtime/child-process, https://bun.com/blog/bun-v1.1.5 (child_process quirks)
- Bun issue #595 — Node.js child_process compatibility tracking

**Ecosystem analysis (MEDIUM confidence, 2026 dated):**
- SWE-bench Pro paper — https://static.scale.com/uploads/654197dc94d34f66c0f5184e/SWEAP_Eval_Scale%20(9).pdf (the contamination motivation for Pro over Verified)
- Epoch AI SWE-bench Verified leaderboard — https://epoch.ai/benchmarks/swe-bench-verified/ (484-task runs, variance patterns)
- CodeSOTA SWE-bench contamination debate — https://www.codesota.com/news/swe-bench-contamination-debate (verbatim patch reproduction audits for Opus 4.5, GPT-5.2, Gemini 3 Flash)
- "Your Claude Code Rate Limit Is Draining Fast" (roborhythms, March 2026) — user-reported impact of cache TTL regression
- "Bun Compatibility in 2026" (alexcloudstar / PkgPulse) — npm package compat, native addon constraints
- Claude Code Hooks practical guides (eesel AI, Pixelmojo, claudefa.st 2026 editions) — hook lifecycle enumeration, version-break incidents

**Personal / project-specific (HIGH confidence, user's own experience):**
- User's KV cache re-research v2 gist (2026-04-11) — direct evidence of context pollution impact on cache behavior
- User's explicit decommission reasons for caveman-report (cited in PROJECT.md Context section)

---
*Pitfalls research for: SAGOL (Claude Code Skill/MCP agent report router + context hygiene Spike)*
*Researched: 2026-04-14*
