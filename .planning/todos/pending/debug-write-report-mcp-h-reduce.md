---
title: Debug write_report MCP failure — "H.reduce is not a function"
date: 2026-04-16
priority: medium
status: pending
found_during: post-Phase-2 manual benchmark session (2026-04-16)
---

# Bug — write_report MCP returns runtime error

## Symptom

Calling `mcp__sagol__write_report` twice during the 2026-04-16 benchmark session resulted in:

```
H.reduce is not a function. (In 'H.reduce((_,q)=>_+(q.type==="text"?q.text.length:0),0)', 'H.reduce' is undefined)
```

Both attempts had valid body strings (one ~4KB, one ~3KB markdown). Second attempt used a simpler body structure to rule out body-content issues — same error.

## Impact

- write_report is the v1 app's primary MCP surface
- **CORRECTION (2026-04-16):** the file write itself **succeeds** — both failed calls from this benchmark session wrote valid markdown files to `.sagol/reports/` (see `1776297784127-03c2e145.md`, `1776297834602-33481f15.md`). The error is in the MCP response serialization path, NOT the write path.
- Behavior from caller's perspective: tool appears to fail, but artifact is produced. Misleading — masks success.
- Any user attempting to use SAGOL v1 may see the error message and assume the write failed, leading to redundant retries or fallback work.

## Hypothesis (unverified)

The error message mentions iterating `H.reduce((_,q)=>_+(q.type==="text"?q.text.length:0),0)` — reducer over a content-block array to compute total text length. `H` is presumably a tool-response content array that is `undefined` at some code path. Possibly:

1. Tool response format changed in a dependency upgrade (zod schema, MCP SDK version)
2. The tool returns a structure that harness code expects to be an array but is sometimes undefined
3. A recent change to the MCP server's response builder broke the expected shape

## Investigation steps

1. Locate the `H.reduce` site — likely in the Claude Code harness MCP-response post-processing, not the SAGOL server itself (error is raised in client-side reducer code)
2. Inspect what SAGOL server returns for write_report call — is the tool response a plain string vs `{content: [{type: "text", text: "..."}]}` array?
3. Check MCP SDK version in `package.json` vs what Claude Code CLI expects
4. Reproduce in isolation — minimal harness call to write_report, capture raw response

## Likely fix direction

Ensure the MCP server's write_report response conforms to the expected `content: Array<{type, text}>` shape. Validate against the SDK's schema. This may be a minor return-value change.

## Evidence location

- Benchmark session transcript (current session, 2026-04-16)
- Sagol server code: likely `apps/sagol-server/*` or similar

## Dependency on kill/pivot decision

- If **Path 1 (Kill):** this bug becomes moot; do not fix
- If **Path 2 (Pivot):** fix only if keeping the MCP write_report surface in the new design
- If **Path 3 (Narrow scope):** fix required, this is the primary surface
