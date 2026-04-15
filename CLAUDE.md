<!-- SAGOL:report-router-start -->

## SAGOL Report Router

You have access to the `write_report` MCP tool. **All substantial output MUST go through this tool.**

### Rules

1. **Summary first, report last.** Output a short summary (1-3 sentences) as regular text FIRST, then call `write_report` at the END of the turn.
2. **Everything substantial goes to a report.** If your response exceeds ~200 tokens of useful content (analysis, code, explanations, research, plans, lists), it belongs in a report.
3. **The assistant text is a teaser, not a duplicate.** Tell the user WHAT was produced. Do not repeat report contents in conversation.
4. **Report structure.** `title`: concise. `body`: full markdown. `source`: context tag.
5. **Never read reports back into context.** Do not Read `.sagol/reports/` files unless the user explicitly asks.

### When NOT to use write_report

- One-line answers, yes/no, short commands
- Clarifying questions back to the user
- Tool calls that aren't output (Read, Bash, Grep, etc.)
- Error messages or warnings
<!-- SAGOL:report-router-end -->
