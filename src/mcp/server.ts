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
import { mkdirSync, readFileSync, existsSync } from "node:fs";
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

export function deriveSummary(body: string): string {
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

// ---------------------------------------------------------------------------
// Phase 2 — await_feedback tool (blocking, with dashboard long-poll IPC).
//
// Flow:
//   1. Check SAGOL_BENCHMARK_MODE env var → immediate fallback if set (D-23).
//   2. Read .sagol/dashboard-url.txt to discover the running dashboard (D-21).
//      If absent/unreadable → fallback.
//   3. POST /api/await with {actionId, reportId, prompt?} + X-Sagol-Token.
//   4. GET /api/poll/<actionId> (long-poll) and unwrap the feedback.
//      On 408 / 404 / fetch error → fallback.
//   5. Return feedback.kind [+ "\n" + feedback.text] as the MCP tool result.
//
// Fallback string (FB-03): "(no feedback — proceed)"
// ---------------------------------------------------------------------------
const FALLBACK_FEEDBACK = "(no feedback — proceed)";
const DASHBOARD_URL_FILE = join(PROJECT_ROOT, ".sagol", "dashboard-url.txt");

function parseDashboardUrlFile(): { base: string; token: string } | null {
  if (!existsSync(DASHBOARD_URL_FILE)) return null;
  try {
    const raw = readFileSync(DASHBOARD_URL_FILE, "utf8").trim();
    if (!raw) return null;
    const u = new URL(raw);
    const token = u.searchParams.get("t");
    if (!token) return null;
    return { base: `${u.protocol}//${u.host}`, token };
  } catch {
    return null;
  }
}

function formatFeedback(f: {
  kind: "approve" | "reject" | "revise";
  text?: string;
}): string {
  if (f.kind === "approve") return "approve";
  if (f.kind === "reject") return "reject" + (f.text ? `\n${f.text}` : "");
  return "revise" + (f.text ? `\n${f.text}` : "");
}

export async function handleAwaitFeedback(input: {
  reportId: string;
  prompt?: string;
}): Promise<{ content: Array<{ type: "text"; text: string }> }> {
  // D-23: benchmark mode bypass — do NOT touch filesystem or network.
  if (process.env.SAGOL_BENCHMARK_MODE) {
    return { content: [{ type: "text" as const, text: FALLBACK_FEEDBACK }] };
  }

  const dash = parseDashboardUrlFile();
  if (!dash) {
    return {
      content: [
        {
          type: "text" as const,
          text: "(no feedback — dashboard not running, proceed)",
        },
      ],
    };
  }

  const actionId = `${Date.now()}-${randomBytes(4).toString("hex")}`;
  const headers = {
    "content-type": "application/json",
    "X-Sagol-Token": dash.token,
  };

  try {
    const reg = await fetch(`${dash.base}/api/await`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        actionId,
        reportId: input.reportId,
        prompt: input.prompt,
      }),
    });
    if (!reg.ok) {
      return {
        content: [{ type: "text" as const, text: FALLBACK_FEEDBACK }],
      };
    }

    const poll = await fetch(
      `${dash.base}/api/poll/${encodeURIComponent(actionId)}`,
      { method: "GET", headers },
    );
    if (poll.status === 408 || !poll.ok) {
      return {
        content: [{ type: "text" as const, text: FALLBACK_FEEDBACK }],
      };
    }
    const body = (await poll.json()) as {
      feedback?: { kind: "approve" | "reject" | "revise"; text?: string };
    };
    if (!body?.feedback) {
      return {
        content: [{ type: "text" as const, text: FALLBACK_FEEDBACK }],
      };
    }
    return {
      content: [
        { type: "text" as const, text: formatFeedback(body.feedback) },
      ],
    };
  } catch {
    return { content: [{ type: "text" as const, text: FALLBACK_FEEDBACK }] };
  }
}

async function main() {
  const server = new McpServer(
    { name: "sagol", version: "0.0.0-phase0" },
    {
      capabilities: { tools: {} },
      instructions:
        "SAGOL: (1) write_report persists sub-agent reports; tool response is the stripped form only, full body on disk at .sagol/reports/<id>.md. (2) await_feedback blocks until a human submits approve/reject/revise feedback via the SAGOL dashboard; falls back to '(no feedback — proceed)' if the dashboard isn't running, timeout, or benchmark mode.",
    },
  );

  server.registerTool(
    "write_report",
    {
      title: "SAGOL: write report",
      description:
        "Write a sub-agent report as a markdown file under .sagol/reports/. Returns a ≤200-char stripped form ([report:<id>] <title>\\n<summary> + file path). The full body is persisted to .sagol/reports/<id>.md on disk only.",
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

  server.registerTool(
    "await_feedback",
    {
      title: "SAGOL: wait for human feedback",
      description:
        "Pause and wait for human feedback on a previously written report via the SAGOL dashboard. Returns one of: 'approve', 'reject\\n<text>', 'revise\\n<text>', or a fallback '(no feedback — proceed)' string if the dashboard is not running, the user did not respond within 10 minutes, or benchmark mode is active. This tool blocks until one of those outcomes.",
      inputSchema: {
        reportId: z
          .string()
          .min(1)
          .describe(
            "The id of a report previously written via write_report (e.g. '1776215025113-d2dbc488').",
          ),
        prompt: z
          .string()
          .optional()
          .describe(
            "Optional one-sentence question shown to the human alongside the report.",
          ),
      },
    },
    async (args) => handleAwaitFeedback(args),
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
