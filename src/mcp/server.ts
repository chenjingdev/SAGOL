#!/usr/bin/env bun
/**
 * SAGOL Phase 1 — MCP server (stdio) with server-side stripping.
 *
 * Exposes a single tool: `write_report` under server name `sagol`.
 *
 * Behavior:
 *   - Accepts { title, body, source? }
 *   - Generates id `<timestamp>-<random8hex>`
 *   - Writes `${PROJECT_ROOT}/.sagol/reports/<id>.md` with YAML frontmatter
 *     (the on-disk file contains the FULL body — this is the ground truth)
 *   - Returns a ≤200-char stripped form to the caller:
 *       `[report:${id}] ${title}\n${summary}\n\n(full body: .sagol/reports/${id}.md)`
 *
 * Why server-side stripping instead of a PostToolUse hook:
 *   Phase 0 Day-1 canary (2026-04-15) established that project-local
 *   `PostToolUse` hooks do not fire in `claude -p` headless mode on Claude
 *   Code 2.1.108 (see .planning/research/HEADLESS_HOOK_LIMITATION.md).
 *   Phase 1 HARD GATE pre-task (2026-04-15) then proved the same hook also
 *   does not fire in interactive mode on the same CC version. Rather than
 *   give up or modify global settings (D-08), SAGOL moves stripping inside
 *   the MCP server itself — the subprocess is spawned identically in both
 *   modes so this path works universally without any hook involvement.
 *
 *   scripts/strip-report.ts is preserved as a fallback / reference in case a
 *   future CC version fixes project-local hook loading and we want to move
 *   the strip logic back out of the server.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { randomBytes } from "node:crypto";

const PROJECT_ROOT = resolve(
  process.env.SAGOL_PROJECT_ROOT ?? process.cwd(),
);
const REPORTS_DIR = join(PROJECT_ROOT, ".sagol", "reports");

function generateId(): string {
  const ts = Date.now();
  const rand = randomBytes(4).toString("hex");
  return `${ts}-${rand}`;
}

function deriveSummary(body: string): string {
  // Naive: first non-empty paragraph, capped at 200 chars.
  const paragraphs = body.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const first = paragraphs[0] ?? body.trim();
  const collapsed = first.replace(/\s+/g, " ");
  if (collapsed.length <= 200) return collapsed;
  return collapsed.slice(0, 200);
}

function yamlEscape(value: string): string {
  // Wrap in double quotes and escape backslashes + quotes + newlines.
  const escaped = value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r");
  return `"${escaped}"`;
}

function buildMarkdown(args: {
  id: string;
  title: string;
  source: string;
  timestamp: string;
  summary: string;
  body: string;
}): string {
  const fm = [
    "---",
    `id: ${args.id}`,
    `title: ${yamlEscape(args.title)}`,
    `source: ${yamlEscape(args.source)}`,
    `timestamp: ${args.timestamp}`,
    `summary: ${yamlEscape(args.summary)}`,
    "---",
    "",
  ].join("\n");
  return `${fm}\n${args.body}\n`;
}

export function buildStripped(args: {
  id: string;
  title: string;
  summary: string;
}): string {
  return (
    `[report:${args.id}] ${args.title}\n` +
    `${args.summary}\n\n` +
    `(full body persisted to .sagol/reports/${args.id}.md — read that file ` +
    `only if the summary is not enough to proceed)`
  );
}

export async function handleWriteReport(input: {
  title: string;
  body: string;
  source?: string;
}): Promise<{ content: Array<{ type: "text"; text: string }> }> {
  mkdirSync(REPORTS_DIR, { recursive: true });
  const id = generateId();
  const timestamp = new Date().toISOString();
  const source = input.source ?? "unknown";
  const summary = deriveSummary(input.body);
  const md = buildMarkdown({
    id,
    title: input.title,
    source,
    timestamp,
    summary,
    body: input.body,
  });
  const path = join(REPORTS_DIR, `${id}.md`);
  await Bun.write(path, md);
  const stripped = buildStripped({ id, title: input.title, summary });
  return {
    content: [
      {
        type: "text" as const,
        text: stripped,
      },
    ],
  };
}

async function main() {
  const server = new McpServer(
    { name: "sagol", version: "0.0.0-phase0" },
    {
      capabilities: { tools: {} },
      instructions:
        "SAGOL: call write_report to persist a sub-agent report. The tool response is ALWAYS a stripped form ([report:<id>] <title>\\n<summary> + file path) — the full body is written to .sagol/reports/<id>.md on disk. Read that file only if the summary is not enough.",
    },
  );

  server.registerTool(
    "write_report",
    {
      title: "SAGOL: write report",
      description:
        "Write a sub-agent report as a markdown file under .sagol/reports/. Returns the full body; the PostToolUse hook strips it to a summary before the main agent sees it.",
      inputSchema: {
        title: z.string().min(1).describe("Short title for the report"),
        body: z.string().min(1).describe("Full markdown body of the report"),
        source: z
          .string()
          .optional()
          .describe("Origin tag: subagent name, task id, etc."),
      },
    },
    async (args) => handleWriteReport(args),
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
  // stderr so Claude Code surfaces it without polluting stdio transport
  process.stderr.write(
    `[sagol-mcp] ready. reports dir: ${REPORTS_DIR}\n`,
  );
}

if (import.meta.main) {
  main().catch((err) => {
    process.stderr.write(`[sagol-mcp] fatal: ${String(err)}\n`);
    process.exit(1);
  });
}
