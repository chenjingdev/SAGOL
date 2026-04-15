#!/usr/bin/env bun
/**
 * SAGOL Phase 0/1 — environment + required-file + live-handler validator.
 *
 * No mutation. Prints a checklist, exit code = number of failures.
 *
 * Post-Phase-1 (D-10 server-side stripping pivot) this script adds:
 *   - verify-server-strip.ts exit-code check (the direct-import proof)
 *   - .mcp.json well-formedness + sagol server entry
 *   - .claude/settings.json has "sagol" in enabledMcpjsonServers
 *   - MCP server spawn + initialize handshake smoke
 *   - .sagol/reports directory writability
 *
 * Cross-references .planning/research/PINNED_VERSIONS.md as the expected
 * version source but does NOT fail on a patch-level mismatch — D-06 says
 * "re-run the canary on any bump" and this script only warns.
 */

import { existsSync, readFileSync, mkdirSync, writeFileSync, unlinkSync } from "node:fs";
import { join, resolve } from "node:path";

const PROJECT_ROOT = resolve(process.cwd());
const PINNED_PATH = join(PROJECT_ROOT, ".planning", "research", "PINNED_VERSIONS.md");

const REQUIRED_FILES = [
  ".claude/settings.json",
  ".mcp.json",
  "src/mcp/server.ts",
  "src/dash/server.ts",
  "src/dash/compiler.ts",
  "src/dash/context.ts",
  "src/dash/watcher.ts",
  "src/dash/html.ts",
  "scripts/strip-report.ts",
  "scripts/verify-server-strip.ts",
  "scripts/verify-dash-e2e.ts",
  "scripts/leak-check.ts",
  "scripts/canary.ts",
  "scripts/noise-gate.ts",
  "scripts/pinned-hash.ts",
  "scripts/dash.ts",
  "tests/mcp-server.test.ts",
  "tests/dash.test.ts",
  ".planning/research/KILL_SWITCH.md",
  ".planning/research/PINNED_VERSIONS.md",
  ".planning/research/HEADLESS_HOOK_LIMITATION.md",
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

  // --- Phase 1 additional checks (D-10 server-side stripping) ---

  // Check: verify-server-strip.ts exit code
  try {
    const proc = Bun.spawn(["bun", "run", "scripts/verify-server-strip.ts"], {
      stdout: "pipe",
      stderr: "pipe",
      cwd: PROJECT_ROOT,
    });
    await proc.exited;
    const code = proc.exitCode ?? 1;
    checks.push({
      name: "verify-server-strip",
      ok: code === 0,
      detail: code === 0 ? "exit 0 — server-side stripping GREEN" : `exit ${code}`,
    });
  } catch (e) {
    checks.push({
      name: "verify-server-strip",
      ok: false,
      detail: `threw: ${String(e)}`,
    });
  }

  // Check: .mcp.json well-formedness + sagol entry
  check(".mcp.json sagol entry", () => {
    const mcpPath = join(PROJECT_ROOT, ".mcp.json");
    if (!existsSync(mcpPath)) return { ok: false, detail: "missing" };
    try {
      const mcp = JSON.parse(readFileSync(mcpPath, "utf8")) as {
        mcpServers?: Record<string, { command?: string; args?: string[] }>;
      };
      const entry = mcp.mcpServers?.sagol;
      if (!entry) return { ok: false, detail: "no mcpServers.sagol entry" };
      if (entry.command !== "bun") {
        return { ok: false, detail: `mcpServers.sagol.command = ${entry.command}, expected "bun"` };
      }
      if (!entry.args?.includes("src/mcp/server.ts")) {
        return {
          ok: false,
          detail: `mcpServers.sagol.args does not include "src/mcp/server.ts"`,
        };
      }
      return { ok: true, detail: `command=${entry.command} args=${JSON.stringify(entry.args)}` };
    } catch (e) {
      return { ok: false, detail: `parse error: ${String(e)}` };
    }
  });

  // Check: .claude/settings.json has "sagol" in enabledMcpjsonServers
  check(".claude/settings.json enabledMcpjsonServers", () => {
    const sPath = join(PROJECT_ROOT, ".claude", "settings.json");
    if (!existsSync(sPath)) return { ok: false, detail: "missing" };
    try {
      const s = JSON.parse(readFileSync(sPath, "utf8")) as {
        enabledMcpjsonServers?: string[];
      };
      const enabled = s.enabledMcpjsonServers ?? [];
      if (!enabled.includes("sagol")) {
        return {
          ok: false,
          detail: `enabledMcpjsonServers = ${JSON.stringify(enabled)} — "sagol" not present`,
        };
      }
      return { ok: true, detail: `enabled: ${JSON.stringify(enabled)}` };
    } catch (e) {
      return { ok: false, detail: `parse error: ${String(e)}` };
    }
  });

  // Check: MCP server spawn + initialize handshake smoke
  try {
    const proc = Bun.spawn(["bun", "run", "src/mcp/server.ts"], {
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
      cwd: PROJECT_ROOT,
    });
    const initReq = JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "sagol-doctor", version: "0.0.0" },
      },
    }) + "\n";
    proc.stdin.write(initReq);
    const reader = proc.stdout.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    let got: unknown = null;
    const timeout = setTimeout(() => {
      try { proc.kill(); } catch {}
    }, 3000);
    try {
      while (!got) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const nl = buf.indexOf("\n");
        if (nl >= 0) {
          const line = buf.slice(0, nl);
          try {
            got = JSON.parse(line);
          } catch {
            break;
          }
        }
      }
    } finally {
      clearTimeout(timeout);
      try { proc.kill(); } catch {}
      try { await proc.exited; } catch {}
    }
    const parsed = got as { result?: { serverInfo?: { name?: string } } } | null;
    const name = parsed?.result?.serverInfo?.name;
    checks.push({
      name: "mcp spawn + initialize",
      ok: name === "sagol",
      detail:
        name === "sagol"
          ? `serverInfo.name = "sagol"`
          : `got ${JSON.stringify(parsed ?? buf.slice(0, 200))}`,
    });
  } catch (e) {
    checks.push({
      name: "mcp spawn + initialize",
      ok: false,
      detail: `threw: ${String(e)}`,
    });
  }

  // Check: dashboard URL file (informational — not a failure if absent)
  check("dashboard", () => {
    const urlFile = join(PROJECT_ROOT, ".sagol", "dashboard-url.txt");
    if (!existsSync(urlFile)) {
      return { ok: true, detail: "not running (no .sagol/dashboard-url.txt — informational)" };
    }
    try {
      const raw = readFileSync(urlFile, "utf8").trim();
      const u = new URL(raw);
      if (u.hostname !== "127.0.0.1") {
        return { ok: false, detail: `URL hostname ${u.hostname} is not 127.0.0.1` };
      }
      if (!u.searchParams.get("t")) {
        return { ok: false, detail: "URL has no ?t= token query" };
      }
      return { ok: true, detail: `running at ${u.host} (token length ${u.searchParams.get("t")!.length})` };
    } catch (e) {
      return { ok: false, detail: `bad URL file: ${String(e)}` };
    }
  });

  // Check: .sagol/reports directory is writable
  check(".sagol/reports writable", () => {
    const dir = join(PROJECT_ROOT, ".sagol", "reports");
    try {
      mkdirSync(dir, { recursive: true });
      const probe = join(dir, `.doctor-probe-${Date.now()}`);
      writeFileSync(probe, "probe", "utf8");
      unlinkSync(probe);
      return { ok: true, detail: dir };
    } catch (e) {
      return { ok: false, detail: `not writable: ${String(e)}` };
    }
  });

  // ---

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
