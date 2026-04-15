import { describe, it, expect } from "bun:test";
import { parseAndCompile } from "../src/dash/compiler.ts";
import { DashContext } from "../src/dash/context.ts";

describe("parseAndCompile", () => {
  it("parses frontmatter and compiles body", () => {
    const md = `---
id: "1-aa"
title: "Hello"
source: "sub-agent"
timestamp: "2026-04-15T00:00:00.000Z"
summary: "short"
---

# Heading

First paragraph.

\`\`\`ts
const x: number = 1;
\`\`\`
`;
    const r = parseAndCompile(md);
    expect(r.frontmatter.id).toBe("1-aa");
    expect(r.frontmatter.title).toBe("Hello");
    expect(r.html).toContain("<h1>Heading</h1>");
    expect(r.html).toContain("First paragraph.");
    expect(r.html).toContain("hljs"); // highlight.js <pre class="hljs">
  });

  it("throws on missing id frontmatter", () => {
    expect(() =>
      parseAndCompile(`---\ntitle: "No id"\n---\n\nbody`),
    ).toThrow();
  });

  it("renders links with linkify", () => {
    const r = parseAndCompile(
      `---\nid: "1"\ntitle: "t"\n---\n\nhttps://example.com here`,
    );
    expect(r.html).toContain(`<a href="https://example.com"`);
  });
});

describe("DashContext.upsertReport", () => {
  it("indexes reports by id and sorts by mtime desc", () => {
    const ctx = new DashContext();
    const mk = (id: string, title: string) => `---\nid: "${id}"\ntitle: "${title}"\n---\n\nbody of ${id}\n`;
    ctx.upsertReport("/path/a.md", mk("a", "A"), 100);
    ctx.upsertReport("/path/b.md", mk("b", "B"), 300);
    ctx.upsertReport("/path/c.md", mk("c", "C"), 200);
    const list = ctx.listReports();
    expect(list.map((r) => r.id)).toEqual(["b", "c", "a"]);
  });

  it("returns null on bad markdown (no id frontmatter)", () => {
    const ctx = new DashContext();
    expect(ctx.upsertReport("/x.md", "no frontmatter", 1)).toBeNull();
    expect(ctx.reports.size).toBe(0);
  });
});

describe("DashContext awaiter flow", () => {
  it("registers an awaiter and resolves it on submitFeedback", async () => {
    const ctx = new DashContext();
    const a = ctx.registerAwaiter("action-1", "report-1");
    const resolved = (async () => a.pending)();
    const status = ctx.submitFeedback("action-1", { kind: "approve" });
    expect(status).toBe("ok");
    const feedback = await resolved;
    expect(feedback).toEqual({ kind: "approve" });
  });

  it("dedups duplicate submissions", () => {
    const ctx = new DashContext();
    ctx.registerAwaiter("action-2", "r");
    expect(ctx.submitFeedback("action-2", { kind: "reject", text: "no" })).toBe("ok");
    expect(ctx.submitFeedback("action-2", { kind: "approve" })).toBe("duplicate");
  });

  it("returns 'unknown' for an unregistered action id", () => {
    const ctx = new DashContext();
    expect(ctx.submitFeedback("nope", { kind: "approve" })).toBe("unknown");
  });

  it("expireAwaiter resolves with null (timeout)", async () => {
    const ctx = new DashContext();
    const a = ctx.registerAwaiter("action-3", "r");
    ctx.expireAwaiter("action-3");
    expect(await a.pending).toBeNull();
  });
});
