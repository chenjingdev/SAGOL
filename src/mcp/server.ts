#!/usr/bin/env bun
/**
 * SAGOL Phase 0 — Minimal MCP server (stdio).
 *
 * Exposes a single tool: `write_report` under server name `sagol`,
 * so the Claude Code hook matcher `mcp__sagol__write_report` fires.
 *
 * Behavior:
 *   - Accepts { title, body, source? }
 *   - Generates id `<timestamp>-<random8hex>`
 *   - Writes `${PROJECT_ROOT}/.sagol/reports/<id>.md` with YAML frontmatter
 *   - Returns { content: [{ type: "text", text: FULL_MARKDOWN }] }
 *
 * The tool RETURNS THE FULL BODY on purpose — the PostToolUse hook
 * (scripts/strip-report.ts) is what replaces it with a ≤200-token summary
 * via `updatedMCPToolOutput`. If we pre-stripped here, the leakage canary
 * could not tell the difference between "the hook works" and "we cheated".
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

async function handleWriteReport(input: {
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
  return {
    content: [
      {
        type: "text" as const,
        text: md,
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
        "SAGOL Phase 0: write reports via write_report. Bodies are stripped from main context by a PostToolUse hook.",
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

main().catch((err) => {
  process.stderr.write(`[sagol-mcp] fatal: ${String(err)}\n`);
  process.exit(1);
});
