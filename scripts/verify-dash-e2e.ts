#!/usr/bin/env bun
/**
 * Phase 2 end-to-end verification.
 *
 * Exercises three MCP ↔ dashboard IPC scenarios in-process against a real
 * running `src/dash/server.ts`:
 *
 *   1. Benchmark mode bypass — `SAGOL_BENCHMARK_MODE=1` should make
 *      `handleAwaitFeedback` return the fallback instantly without touching
 *      the filesystem or opening any sockets.
 *
 *   2. No-dashboard fallback — delete `.sagol/dashboard-url.txt`, call
 *      `handleAwaitFeedback`, expect the "(no feedback — dashboard not
 *      running, proceed)" string.
 *
 *   3. Full round-trip — start the dashboard, call `handleAwaitFeedback` as a
 *      sub-agent would (blocking long-poll), concurrently POST feedback to
 *      the dashboard, expect the MCP handler to return with the submitted
 *      feedback.
 *
 * Each scenario runs in an ISOLATED project root (tempdir) so nothing leaks
 * between them and nothing leaks into the real repo state.
 */
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdir, unlink } from "node:fs/promises";

// Import handleAwaitFeedback lazily per-test because server.ts captures
// PROJECT_ROOT at module load time from env.
async function runIsolated(
  label: string,
  body: (root: string) => Promise<void>,
): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), "sagol-e2e-"));
  const prevRoot = process.env.SAGOL_PROJECT_ROOT;
  process.env.SAGOL_PROJECT_ROOT = root;
  try {
    console.log(`\n--- ${label} ---`);
    await body(root);
    console.log(`    ✓ ${label}`);
  } finally {
    if (prevRoot == null) delete process.env.SAGOL_PROJECT_ROOT;
    else process.env.SAGOL_PROJECT_ROOT = prevRoot;
    rmSync(root, { recursive: true, force: true });
  }
}

function assertEqual(actual: unknown, expected: unknown, msg: string): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${msg}: expected ${e}, got ${a}`);
}

async function scenario1_benchmarkModeBypass(): Promise<void> {
  const prev = process.env.SAGOL_BENCHMARK_MODE;
  process.env.SAGOL_BENCHMARK_MODE = "1";
  try {
    // Fresh import so the module captures SAGOL_PROJECT_ROOT.
    const mod = await import(
      "../src/mcp/server.ts?bm=" + Math.random()
    );
    const res = await mod.handleAwaitFeedback({ reportId: "does-not-matter" });
    const text = res.content[0]?.text;
    assertEqual(text, "(no feedback — proceed)", "benchmark bypass fallback");
  } finally {
    if (prev == null) delete process.env.SAGOL_BENCHMARK_MODE;
    else process.env.SAGOL_BENCHMARK_MODE = prev;
  }
}

async function scenario2_noDashboardFallback(root: string): Promise<void> {
  // Make sure the url file is definitely absent.
  const urlFile = join(root, ".sagol", "dashboard-url.txt");
  try {
    await unlink(urlFile);
  } catch {
    /* ok */
  }
  if (existsSync(urlFile)) throw new Error("unexpected url file present");
  const mod = await import(
    "../src/mcp/server.ts?nf=" + Math.random()
  );
  const res = await mod.handleAwaitFeedback({ reportId: "rid-1" });
  const text = res.content[0]?.text;
  assertEqual(
    text,
    "(no feedback — dashboard not running, proceed)",
    "no-dashboard fallback",
  );
}

async function scenario3_roundtrip(root: string): Promise<void> {
  await mkdir(join(root, ".sagol", "reports"), { recursive: true });
  const dashMod = await import(
    "../src/dash/server.ts?rt=" + Math.random()
  );
  const running = await dashMod.startDashServer({
    projectRoot: root,
    benchmarkMode: false,
  });
  try {
    const mcpMod = await import("../src/mcp/server.ts?rt=" + Math.random());

    // Kick off the blocking long-poll from the MCP side.
    const awaitPromise = mcpMod.handleAwaitFeedback({
      reportId: "rid-abc",
      prompt: "e2e test",
    }) as Promise<{ content: Array<{ type: "text"; text: string }> }>;

    // Give the MCP server a tick to POST /api/await and start the long-poll.
    await new Promise((r) => setTimeout(r, 100));

    // Find the actionId that the MCP handler just registered. The in-memory
    // DashContext isn't exposed, so we list awaiters via /api/state.
    const stateRes = await fetch(`${running.url.split("?")[0]}api/state?t=${running.token}`);
    const state = (await stateRes.json()) as {
      awaiters: Array<{ actionId: string; reportId: string }>;
    };
    const match = state.awaiters.find((a) => a.reportId === "rid-abc");
    if (!match) throw new Error("awaiter did not register on dashboard");

    // Submit feedback via HTTP.
    const feedbackRes = await fetch(
      `http://127.0.0.1:${running.port}/api/feedback/${encodeURIComponent(match.actionId)}?t=${running.token}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind: "revise", text: "please retry with verbose" }),
      },
    );
    if (!feedbackRes.ok) {
      throw new Error(`feedback POST failed: ${feedbackRes.status}`);
    }

    // The MCP handler's long-poll should now return with our feedback.
    const result = await awaitPromise;
    const text = result.content[0]?.text;
    assertEqual(
      text,
      "revise\nplease retry with verbose",
      "round-trip feedback formatting",
    );
  } finally {
    await running.stop();
  }
}

async function main(): Promise<void> {
  await runIsolated("scenario 1: benchmark-mode bypass", async () => {
    await scenario1_benchmarkModeBypass();
  });

  await runIsolated("scenario 2: no-dashboard fallback", async (root) => {
    await scenario2_noDashboardFallback(root);
  });

  await runIsolated("scenario 3: full round-trip", async (root) => {
    await scenario3_roundtrip(root);
  });

  console.log("\nGREEN — dashboard e2e verification complete");
  // Force-exit: the dashboard server's long-poll setTimeouts may still be
  // sitting in the event loop even after `stop()`. We don't care — we're
  // done.
  process.exit(0);
}

main().catch((e) => {
  console.error(`[verify-dash-e2e] FAIL: ${String(e)}`);
  process.exit(1);
});
