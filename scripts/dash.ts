#!/usr/bin/env bun
/**
 * SAGOL dashboard CLI entry.
 *
 * Starts the dashboard server, writes `.sagol/dashboard-url.txt`, and opens
 * the default browser. Intended to be run as `bun run dash` or directly.
 *
 * Flags:
 *   --no-open           skip `open(url)` auto-launch
 *   --benchmark-mode    advertise benchmark mode to the dashboard UI
 *                       (the MCP server's `sagol_await_feedback` bypass is
 *                       controlled by the SAGOL_BENCHMARK_MODE env var,
 *                       NOT by this flag; this flag is purely for the UI badge)
 *
 * The dashboard runs until SIGINT / SIGTERM. On shutdown, removes
 * `.sagol/dashboard-url.txt` so MCP servers stop trying to reach a dead
 * dashboard.
 */
import { startDashServer } from "../src/dash/server.ts";
import { unlink } from "node:fs/promises";
import { join, resolve } from "node:path";

const ARGS = process.argv.slice(2);
const NO_OPEN = ARGS.includes("--no-open");
const BENCHMARK_MODE =
  ARGS.includes("--benchmark-mode") || !!process.env.SAGOL_BENCHMARK_MODE;

const PROJECT_ROOT = resolve(process.env.SAGOL_PROJECT_ROOT ?? process.cwd());

async function maybeOpen(url: string): Promise<void> {
  if (NO_OPEN) return;
  // macOS: `open`. Linux: `xdg-open`. Windows: `start`. Best-effort.
  const cmd =
    process.platform === "darwin"
      ? ["open", url]
      : process.platform === "win32"
      ? ["cmd", "/c", "start", "", url]
      : ["xdg-open", url];
  try {
    const p = Bun.spawn(cmd, { stdout: "ignore", stderr: "ignore" });
    await p.exited;
  } catch {
    /* non-fatal */
  }
}

async function main(): Promise<void> {
  const { url, port, stop } = await startDashServer({
    projectRoot: PROJECT_ROOT,
    benchmarkMode: BENCHMARK_MODE,
  });

  process.stderr.write(`[sagol-dash] listening on 127.0.0.1:${port}\n`);
  process.stderr.write(`[sagol-dash] URL (with token): ${url}\n`);
  process.stderr.write(
    `[sagol-dash] URL file:    ${join(PROJECT_ROOT, ".sagol/dashboard-url.txt")}\n`,
  );
  if (BENCHMARK_MODE) {
    process.stderr.write(`[sagol-dash] benchmark-mode: ON (UI badge)\n`);
  }

  await maybeOpen(url);

  let stopped = false;
  const shutdown = async (sig: string) => {
    if (stopped) return;
    stopped = true;
    process.stderr.write(`[sagol-dash] ${sig} — shutting down\n`);
    try {
      await unlink(join(PROJECT_ROOT, ".sagol/dashboard-url.txt"));
    } catch {
      /* ignore */
    }
    await stop();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));

  // Keep process alive until signal.
  await new Promise(() => {
    /* never */
  });
}

main().catch((e) => {
  process.stderr.write(`[sagol-dash] fatal: ${String(e)}\n`);
  process.exit(1);
});
