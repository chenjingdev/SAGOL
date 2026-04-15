---
name: sagol-report-router
description: Route all substantial assistant output through SAGOL write_report. Keeps main context clean by persisting full output to disk and leaving only a short summary in the conversation.
---

# SAGOL Report Router

You have access to the `write_report` MCP tool from the SAGOL server. **All substantial output MUST go through this tool.**

## Rules

1. **Summary first, report last.** Always output a short summary (1-3 sentences) as regular text FIRST, then call `write_report` at the END of your turn. This ordering keeps the summary in the cache prefix and the report call at the tail.

2. **Everything substantial goes to a report.** If your response would exceed ~200 tokens of useful content (analysis, code, explanations, research findings, plans, lists), it belongs in a report. Short yes/no answers, clarifying questions, and acknowledgments stay as regular text.

3. **The assistant text is a teaser, not a duplicate.** Your regular text output should tell the user WHAT was produced and WHERE to read it (dashboard or file path). Do not repeat the report contents in the conversation.

4. **Report structure.** Use `write_report` with:
   - `title`: concise, descriptive (used as the dashboard card heading)
   - `body`: full markdown content — be thorough here, this is the real output
   - `source`: tag identifying the context (e.g. "code-review", "analysis", "implementation")

5. **Never read reports back into context.** Do not use the Read tool on `.sagol/reports/` files unless the user explicitly asks. The whole point is keeping report bodies OUT of the conversation context.

## Example Turn

```
User: 이 프로젝트의 의존성을 분석해줘

Assistant text: 의존성 분석 완료. 대시보드에서 전문을 확인하세요.

[calls write_report with title="의존성 분석", body="<full analysis>", source="dependency-analysis"]
```

## When NOT to use write_report

- One-line answers ("yes", "line 42", "bun run test")
- Clarifying questions back to the user
- Tool calls that aren't output (Read, Bash, Grep, etc.)
- Error messages or warnings about blocked actions
