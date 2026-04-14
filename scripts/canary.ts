#!/usr/bin/env bun
/**
 * SAGOL Phase 0 — Day 1 leakage canary (D-05 + KILL_SWITCH.md).
 *
 * Pass condition (GREEN):
 *   - RANDOM_128_BIT_TOKEN appears 0 times in the entire Claude Code
 *     stream-json output (no assistant message, no tool_use, no tool_result
 *     content, no nested JSON field — plain substring match is strict).
 *   - RANDOM_128_BIT_TOKEN appears ≥1 time in `.sagol/reports/<id>.md`
 *     (proving the MCP tool actually wrote the report).
 *
 * Any other outcome = RED = SAGOL is architecturally infeasible on this
 * Claude Code version. Plan says: stop, commit the RED result, escalate.
 */

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { randomBytes } from "node:crypto";

const PROJECT_ROOT = resolve(process.cwd());
const CANARY_DIR = join(PROJECT_ROOT, ".sagol", "canary");
const REPORTS_DIR = join(PROJECT_ROOT, ".sagol", "reports");
const RESULT_PATH = join(
  PROJECT_ROOT,
  ".planning",
  "phases",
  "00-pre-flight-gates",
  "00-CANARY-RESULT.md",
);
const MCP_CONFIG_PATH = join(PROJECT_ROOT, ".claude", "settings.json");

function nowIso(): string {
  return new Date().toISOString();
}

async function claudeVersion(): Promise<string> {
  try {
    const proc = Bun.spawn(["claude", "--version"], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const out = await new Response(proc.stdout).text();
    await proc.exited;
    return out.trim();
  } catch {
    return "(unknown)";
  }
}

function listReportsBefore(snapshot: Set<string>): string[] {
  try {
    return readdirSync(REPORTS_DIR).filter((f) => !snapshot.has(f));
  } catch {
    return [];
  }
}

function snapshotReports(): Set<string> {
  try {
    return new Set(readdirSync(REPORTS_DIR));
  } catch {
    return new Set();
  }
}

function writeResult(verdict: "GREEN" | "RED" | "INCONCLUSIVE", body: string) {
  mkdirSync(join(PROJECT_ROOT, ".planning", "phases", "00-pre-flight-gates"), {
    recursive: true,
  });
  writeFileSync(
    RESULT_PATH,
    `# Day 1 Leakage Canary — ${verdict}\n\n${body}\n`,
    "utf8",
  );
}

async function main(): Promise<number> {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    console.log(
      "Usage: bun run scripts/canary.ts\n\n" +
        "Runs the Day 1 leakage canary. See .planning/research/KILL_SWITCH.md.\n" +
        "Exit codes: 0 = GREEN, 2 = RED, 3 = INCONCLUSIVE.",
    );
    return 0;
  }

  mkdirSync(CANARY_DIR, { recursive: true });

  const token = randomBytes(16).toString("hex"); // 128-bit
  const ts = nowIso().replace(/[:.]/g, "-");
  const rawPath = join(CANARY_DIR, `${ts}-raw.jsonl`);
  const cliVer = await claudeVersion();
  const beforeReports = snapshotReports();

  const prompt =
    `Use the sagol write_report tool to log exactly this token in the body, ` +
    `then stop: ${token}. Use title "canary" and source "leakage-canary".`;

  const proc = Bun.spawn(
    [
      "claude",
      "-p",
      "--output-format",
      "stream-json",
      "--verbose",
      "--mcp-config",
      MCP_CONFIG_PATH,
      "--permission-mode",
      "bypassPermissions",
      prompt,
    ],
    {
      cwd: PROJECT_ROOT,
      stdout: "pipe",
      stderr: "pipe",
    },
  );

  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  const code = await proc.exited;

  writeFileSync(rawPath, stdout, "utf8");
  writeFileSync(rawPath + ".stderr", stderr, "utf8");

  // Check 1: token must NOT appear in the stream-json output at all.
  const streamHits = (stdout.match(new RegExp(token, "g")) ?? []).length;

  // Check 2: token MUST appear in a report file created after we started.
  const newReports = listReportsBefore(beforeReports);
  let reportHits = 0;
  let reportPath = "(none)";
  for (const f of newReports) {
    const p = join(REPORTS_DIR, f);
    const text = readFileSync(p, "utf8");
    const hits = (text.match(new RegExp(token, "g")) ?? []).length;
    if (hits > 0) {
      reportHits += hits;
      reportPath = p;
    }
  }

  const metadata = [
    `- timestamp: ${nowIso()}`,
    `- claude --version: ${cliVer}`,
    `- bun --version: ${Bun.version}`,
    `- token: ${token}`,
    `- claude exit code: ${code}`,
    `- stream stdout length: ${stdout.length} bytes`,
    `- stream hits: ${streamHits}`,
    `- new reports created: ${newReports.length} (${newReports.join(", ") || "-"})`,
    `- report hits: ${reportHits} (${reportPath})`,
    `- raw stream capture: ${rawPath}`,
    `- raw stderr capture: ${rawPath}.stderr`,
  ].join("\n");

  if (streamHits === 0 && reportHits > 0) {
    writeResult("GREEN", metadata);
    console.log("[canary] GREEN — 0 stream hits, report contains token");
    return 0;
  }
  if (streamHits > 0) {
    writeResult(
      "RED",
      metadata +
        "\n\nSAGOL is architecturally infeasible on this Claude Code version — " +
        "the PostToolUse hook did not strip the report body from the main context.",
    );
    console.error("[canary] RED — token leaked into stream");
    return 2;
  }
  writeResult(
    "INCONCLUSIVE",
    metadata +
      "\n\nNo report file was created. The MCP tool likely did not fire. " +
      "Check .claude/settings.json wiring and stderr capture.",
  );
  console.error("[canary] INCONCLUSIVE — no report created");
  return 3;
}

const code = await main();
process.exit(code);
