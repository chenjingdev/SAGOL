# Day 1 Leakage Canary — GREEN

- timestamp: 2026-04-15T04:50:36.635Z
- claude --version: 2.1.109 (Claude Code)
- bun --version: 1.2.13
- token: 7b984068b95bd7f65f925269293a75e2
- claude exit code: 0
- stream stdout length: 26388 bytes
- total stream hits (all locations): 1
- tool_use.input hits (unavoidable — assistant echoing prompt): 1
- tool_result hits (HOOK FAILURE if > 0): 0
- assistant text hits (HOOK FAILURE if > 0): 0
- leak hits (tool_result + assistant_text): 0
- PostToolUse hook event observed in stream: false
- new reports created: 1 (1776228631040-a248ff56.md)
- report hits: 2 (/Users/laonpeople/dev/sagol/.sagol/reports/1776228631040-a248ff56.md)
- raw stream capture: /Users/laonpeople/dev/sagol/.sagol/canary/2026-04-15T04-50-16-776Z-raw.jsonl
- raw stderr capture: /Users/laonpeople/dev/sagol/.sagol/canary/2026-04-15T04-50-16-776Z-raw.jsonl.stderr
