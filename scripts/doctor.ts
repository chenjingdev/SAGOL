#!/usr/bin/env bun
/**
 * SAGOL Phase 0 — environment + required-file validator.
 *
 * No mutation. Prints a checklist, exit code = number of failures.
 * Cross-references .planning/research/PINNED_VERSIONS.md as the expected
 * version source, but does NOT fail on a patch-level mismatch — the
 * policy is "canary + noise gate must be re-run on any bump" (D-06),
 * and enforcement of that policy is doctor's job: it warns, canary in
 * Plan 03 decides GREEN/RED.
 */

import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const PROJECT_ROOT = resolve(process.cwd());
const PINNED_PATH = join(PROJECT_ROOT, ".planning", "research", "PINNED_VERSIONS.md");

const REQUIRED_FILES = [
  ".claude/settings.json",
  "src/mcp/server.ts",
  "scripts/strip-report.ts",
  "scripts/canary.ts",
  "scripts/noise-gate.ts",
  "scripts/pinned-hash.ts",
  ".planning/research/KILL_SWITCH.md",
  ".planning/research/PINNED_VERSIONS.md",
  "bun.lock",
  "package.json",
  "tsconfig.json",
];

type Check = { name: string; ok: boolean; detail: string };
const checks: Check[] = [];

function check(name: string, fn: () => { ok: boolean; detail: string }) {
  try {
    checks.push({ name, ...fn() });
  } catch (e) {
    checks.push({ name, ok: false, detail: `threw: ${String(e)}` });
  }
}

async function runCmd(cmd: string[]): Promise<string> {
  const proc = Bun.spawn(cmd, { stdout: "pipe", stderr: "pipe" });
  const out = await new Response(proc.stdout).text();
  await proc.exited;
  return out.trim();
}

function readExpectedVersions(): { claude?: string; bun?: string } {
  if (!existsSync(PINNED_PATH)) return {};
  const text = readFileSync(PINNED_PATH, "utf8");
  const out: { claude?: string; bun?: string } = {};
  const claudeMatch = text.match(/`claude`[^|]*\|\s*\*\*([0-9]+\.[0-9]+\.[0-9]+)\*\*/);
  if (claudeMatch) out.claude = claudeMatch[1];
  const bunMatch = text.match(/`bun`\s*\|\s*\*\*([0-9]+\.[0-9]+\.[0-9]+)\*\*/);
  if (bunMatch) out.bun = bunMatch[1];
  return out;
}

async function main(): Promise<number> {
  const expected = readExpectedVersions();

  for (const f of REQUIRED_FILES) {
    const p = join(PROJECT_ROOT, f);
    check(`file: ${f}`, () => ({
      ok: existsSync(p),
      detail: existsSync(p) ? p : "missing",
    }));
  }

  check("bun --version", () => {
    const v = Bun.version;
    const ok = expected.bun ? v === expected.bun : true;
    return {
      ok,
      detail: ok
        ? `${v}${expected.bun ? ` (matches PINNED_VERSIONS.md ${expected.bun})` : ""}`
        : `${v} does not match PINNED_VERSIONS.md ${expected.bun}`,
    };
  });

  let claudeVer = "(not found)";
  try {
    claudeVer = await runCmd(["claude", "--version"]);
  } catch (e) {
    claudeVer = `error: ${String(e)}`;
  }
  checks.push({
    name: "claude --version",
    ok: expected.claude ? claudeVer.includes(expected.claude) : true,
    detail: expected.claude
      ? `${claudeVer} (pinned ${expected.claude})`
      : claudeVer,
  });

  for (const c of checks) {
    const mark = c.ok ? "✓" : "✗";
    console.log(`${mark} ${c.name}: ${c.detail}`);
  }

  const fails = checks.filter((c) => !c.ok).length;
  console.log(`\n${fails === 0 ? "GREEN" : "RED"} — ${fails} failure(s)`);
  return fails;
}

const code = await main();
process.exit(code);
