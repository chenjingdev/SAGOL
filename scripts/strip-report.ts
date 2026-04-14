#!/usr/bin/env bun
/**
 * SAGOL Phase 0 — PostToolUse hook: strip sagol write_report output.
 *
 * Claude Code invokes this script as a subprocess with the hook event JSON
 * on stdin. We parse the tool result, extract the report id + summary from
 * the markdown frontmatter, and emit a replacement via `updatedMCPToolOutput`.
 *
 * On ANY parse/shape failure we log to stderr and exit 0 with no stdout —
 * the goal is never to block the tool by accident. The leakage canary is
 * what catches failures; this script stays passthrough-safe.
 *
 * Hook input shape (PostToolUse, Claude Code 2.1.x):
 * {
 *   hook_event_name: "PostToolUse",
 *   tool_name: "mcp__sagol__write_report",
 *   tool_input: { title, body, source? },
 *   tool_response: { content: [{ type: "text", text: "<full markdown>" }] },
 *   ...
 * }
 *
 * Hook output shape for MCP replacement:
 * {
 *   hookSpecificOutput: {
 *     hookEventName: "PostToolUse",
 *     updatedMCPToolOutput: { content: [{ type: "text", text: "<stripped>" }] }
 *   }
 * }
 */

type ToolContent = { type: string; text?: string };
type HookInput = {
  hook_event_name?: string;
  tool_name?: string;
  tool_response?: {
    content?: ToolContent[];
    structuredContent?: unknown;
    isError?: boolean;
  };
};

function fail(msg: string): never {
  process.stderr.write(`[sagol-strip] ${msg}\n`);
  process.exit(0); // passthrough — never block
}

function extractFullText(input: HookInput): string | null {
  const content = input.tool_response?.content;
  if (!Array.isArray(content)) return null;
  for (const entry of content) {
    if (entry && entry.type === "text" && typeof entry.text === "string") {
      return entry.text;
    }
  }
  return null;
}

function parseFrontmatter(
  md: string,
): { id?: string; title?: string; summary?: string } | null {
  if (!md.startsWith("---\n")) return null;
  const end = md.indexOf("\n---\n", 4);
  if (end < 0) return null;
  const block = md.slice(4, end);
  const out: Record<string, string> = {};
  for (const rawLine of block.split("\n")) {
    const m = rawLine.match(/^([a-zA-Z_][a-zA-Z0-9_]*):\s*(.*)$/);
    if (!m) continue;
    const key = m[1]!;
    let val = m[2] ?? "";
    // Unwrap double-quoted YAML string (handles \\, \", \n escapes we wrote).
    if (val.startsWith('"') && val.endsWith('"') && val.length >= 2) {
      val = val
        .slice(1, -1)
        .replace(/\\n/g, "\n")
        .replace(/\\r/g, "\r")
        .replace(/\\"/g, '"')
        .replace(/\\\\/g, "\\");
    }
    out[key] = val;
  }
  return out;
}

async function readStdin(): Promise<string> {
  // Bun: Bun.stdin.text() works when hook runs under `bun run`.
  const anyBun = (globalThis as { Bun?: { stdin: { text: () => Promise<string> } } }).Bun;
  if (anyBun && typeof anyBun.stdin?.text === "function") {
    return anyBun.stdin.text();
  }
  // Fallback: node-style chunked read.
  return await new Promise<string>((resolvePromise, rejectPromise) => {
    let buf = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (c: string) => {
      buf += c;
    });
    process.stdin.on("end", () => resolvePromise(buf));
    process.stdin.on("error", rejectPromise);
  });
}

async function main() {
  let raw: string;
  try {
    raw = await readStdin();
  } catch (e) {
    fail(`stdin read error: ${String(e)}`);
  }
  if (!raw.trim()) fail("empty stdin — passthrough");

  let input: HookInput;
  try {
    input = JSON.parse(raw);
  } catch (e) {
    fail(`json parse error: ${String(e)}`);
  }

  // Sanity: only fire on our tool. The matcher should already filter this,
  // but belt-and-suspenders — we'd rather silently passthrough than clobber
  // some unrelated tool result.
  const toolName = input.tool_name ?? "";
  if (!toolName.endsWith("write_report") || !toolName.startsWith("mcp__")) {
    fail(`wrong tool_name: ${toolName}`);
  }

  const fullText = extractFullText(input);
  if (fullText == null) fail("no text content in tool_response");

  const fm = parseFrontmatter(fullText);
  if (!fm || !fm.id) fail("no frontmatter id found — passthrough");

  const id = fm.id;
  const title = fm.title ?? "(untitled)";
  const summary =
    fm.summary && fm.summary.length > 0
      ? fm.summary
      : fullText.slice(0, 200);

  const stripped = `[report:${id}] ${title}\n${summary}`;

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
