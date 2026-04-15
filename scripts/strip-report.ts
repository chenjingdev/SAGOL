#!/usr/bin/env bun
/**
 * SAGOL — PostToolUse hook: strip write_report tool_response.
 *
 * Actual hook input shape (Claude Code 2.1.108):
 * {
 *   tool_name: "mcp__sagol__write_report",
 *   tool_input: { title, body, source? },
 *   tool_response: [{ type: "text", text: "..." }],   // <-- array, NOT { content: [...] }
 * }
 *
 * The MCP server already returns a server-side stripped form, but the
 * canary token still appears in tool_response because the stripped text
 * includes the summary (which for canary IS the token). This hook
 * replaces the tool_response with a minimal pointer.
 *
 * Hook output shape:
 * {
 *   hookSpecificOutput: {
 *     hookEventName: "PostToolUse",
 *     updatedMCPToolOutput: { content: [{ type: "text", text: "<stripped>" }] }
 *   }
 * }
 */

type HookInput = {
  hook_event_name?: string;
  tool_name?: string;
  tool_input?: { title?: string; body?: string; source?: string };
  tool_response?: Array<{ type: string; text?: string }> | { content?: Array<{ type: string; text?: string }> };
};

function fail(msg: string): never {
  process.stderr.write(`[sagol-strip] ${msg}\n`);
  process.exit(0);
}

function extractText(resp: HookInput["tool_response"]): string | null {
  if (!resp) return null;
  // Handle both shapes: array or { content: array }
  const arr = Array.isArray(resp) ? resp : (resp as { content?: unknown[] }).content;
  if (!Array.isArray(arr)) return null;
  for (const entry of arr) {
    if (entry && (entry as { type: string }).type === "text" && typeof (entry as { text?: string }).text === "string") {
      return (entry as { text: string }).text;
    }
  }
  return null;
}

async function main() {
  const raw = await Bun.stdin.text();
  if (!raw.trim()) fail("empty stdin");

  let input: HookInput;
  try {
    input = JSON.parse(raw);
  } catch (e) {
    fail(`json parse: ${String(e)}`);
  }

  const toolName = input.tool_name ?? "";
  if (!toolName.endsWith("write_report") || !toolName.startsWith("mcp__")) {
    fail(`wrong tool: ${toolName}`);
  }

  const text = extractText(input.tool_response);
  if (text == null) fail("no text in tool_response");

  // Extract report id from "[report:<id>] ..." pattern
  const idMatch = text.match(/\[report:([^\]]+)\]/);
  const id = idMatch?.[1] ?? "unknown";
  const title = input.tool_input?.title ?? "(untitled)";

  const stripped = `[report:${id}] ${title}\n(full body on disk — .sagol/reports/${id}.md)`;

  const output = {
    hookSpecificOutput: {
      hookEventName: "PostToolUse",
      updatedMCPToolOutput: {
        content: [{ type: "text", text: stripped }],
      },
    },
  };

  process.stdout.write(JSON.stringify(output));
  process.exit(0);
}

await main();
