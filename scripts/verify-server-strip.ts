#!/usr/bin/env bun
/**
 * Phase 1 — Direct verification that the in-process MCP server handler
 * returns a stripped form, not the full body. Does NOT go through Claude
 * Code or stdio transport — imports handleWriteReport directly.
 *
 * Pass criteria:
 *   - Tool response contains the report id and title
 *   - Tool response does NOT contain the canary token
 *   - The on-disk file DOES contain the canary token
 */
import { handleWriteReport, buildStripped } from "../src/mcp/server.ts";
import { readFileSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";

const CANARY = "SAGOL_SERVERSTRIP_CANARY_" + crypto.randomUUID().replace(/-/g, "");

const body = [
  "Phase 1 verification report. The canary must only appear on disk.",
  "",
  "Canary token below:",
  "",
  CANARY,
  "",
  "End of body.",
].join("\n");

const result = await handleWriteReport({
  title: "Phase 1 verify-server-strip",
  body,
  source: "phase-1-verify-script",
});

if (!result.content?.[0] || result.content[0].type !== "text") {
  console.error("FAIL: tool result shape wrong");
  process.exit(1);
}
const toolText = result.content[0].text;

// The tool response must NOT contain the canary.
if (toolText.includes(CANARY)) {
  console.error("FAIL: canary leaked into tool response");
  console.error("tool response =", JSON.stringify(toolText));
  process.exit(1);
}
console.log("✓ tool response does not contain canary");

// The tool response SHOULD match the stripped shape from buildStripped.
const idMatch = toolText.match(/^\[report:(\d+-[0-9a-f]+)\] /);
if (!idMatch) {
  console.error("FAIL: tool response not in stripped shape");
  console.error("tool response =", JSON.stringify(toolText));
  process.exit(1);
}
const id = idMatch[1]!;
console.log(`✓ tool response is stripped form for id=${id}`);

// The on-disk file SHOULD exist and contain the canary.
const projectRoot = resolve(process.env.SAGOL_PROJECT_ROOT ?? process.cwd());
const filePath = join(projectRoot, ".sagol", "reports", `${id}.md`);
if (!existsSync(filePath)) {
  console.error(`FAIL: on-disk file not found at ${filePath}`);
  process.exit(1);
}
const onDisk = readFileSync(filePath, "utf8");
if (!onDisk.includes(CANARY)) {
  console.error(`FAIL: on-disk file does not contain canary`);
  process.exit(1);
}
console.log(`✓ on-disk file contains canary (${filePath})`);

// Length check — stripped form should be << full body.
if (toolText.length > 500) {
  console.error(`FAIL: stripped form is suspiciously long (${toolText.length} chars)`);
  process.exit(1);
}
console.log(`✓ stripped form is ${toolText.length} chars`);

console.log("\nGREEN — server-side stripping works");
