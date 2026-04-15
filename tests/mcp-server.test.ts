import { describe, it, expect, beforeAll, afterAll, beforeEach } from "bun:test";
import { mkdtempSync, rmSync, existsSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Isolate the server's PROJECT_ROOT to a temp dir BEFORE importing the module.
// server.ts reads SAGOL_PROJECT_ROOT at import time, so env must be set first.
let tmpRoot: string;
tmpRoot = mkdtempSync(join(tmpdir(), "sagol-test-"));
process.env.SAGOL_PROJECT_ROOT = tmpRoot;

const { buildStripped, deriveSummary, handleWriteReport } = await import(
  "../src/mcp/server.ts"
);

afterAll(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

describe("buildStripped", () => {
  it("returns a string starting with [report:<id>] <title>", () => {
    const out = buildStripped({
      id: "1234567890-deadbeef",
      title: "hello",
      summary: "first line only",
    });
    expect(out.startsWith("[report:1234567890-deadbeef] hello\n")).toBe(true);
    expect(out).toContain("first line only");
    expect(out).toContain(".sagol/reports/1234567890-deadbeef.md");
    expect(out.length).toBeLessThanOrEqual(500);
  });

  it("never leaks arbitrary body text (structural — body is not an input)", () => {
    // Fabricate a 2KB random body and confirm buildStripped cannot possibly
    // include it, because the function signature only takes id/title/summary.
    const body = "X".repeat(2048);
    const out = buildStripped({
      id: "1-aa",
      title: "t",
      summary: "s",
    });
    expect(out).not.toContain(body);
  });
});

describe("deriveSummary", () => {
  it("returns at most 200 characters", () => {
    const body = "a".repeat(500);
    expect(deriveSummary(body).length).toBeLessThanOrEqual(200);
  });

  it("collapses internal whitespace runs", () => {
    const body = "foo\n\tbar    baz";
    expect(deriveSummary(body)).toBe("foo bar baz");
  });

  it("uses only the first non-empty paragraph", () => {
    const body = "first paragraph\n\nsecond paragraph should not appear";
    const out = deriveSummary(body);
    expect(out).toBe("first paragraph");
    expect(out).not.toContain("second");
  });

  it("handles whitespace-only body without throwing", () => {
    expect(() => deriveSummary("   \n\n\t  ")).not.toThrow();
    expect(deriveSummary("   \n\n\t  ").length).toBeLessThanOrEqual(200);
  });

  it("leaves a short single-paragraph body unchanged after whitespace collapse", () => {
    expect(deriveSummary("hello world")).toBe("hello world");
  });
});

describe("handleWriteReport round-trip", () => {
  it("tool response does not contain the canary body; disk file does", async () => {
    const canary = "BUNTEST_CANARY_" + crypto.randomUUID().replace(/-/g, "");
    const body = [
      "summary head — this should become the summary",
      "",
      "canary in a later paragraph: " + canary,
    ].join("\n");
    const result = await handleWriteReport({
      title: "round-trip-1",
      body,
      source: "bun-test",
    });
    const toolText = result.content[0]!.text;
    expect(toolText.includes(canary)).toBe(false);
    const idMatch = toolText.match(/^\[report:(\d+-[0-9a-f]+)\]/);
    expect(idMatch).not.toBeNull();
    const id = idMatch![1]!;
    const diskPath = join(tmpRoot, ".sagol", "reports", `${id}.md`);
    expect(existsSync(diskPath)).toBe(true);
    expect(readFileSync(diskPath, "utf8")).toContain(canary);
  });

  it("returned text matches the stripped shape", async () => {
    const result = await handleWriteReport({
      title: "shape check",
      body: "alpha beta gamma",
    });
    expect(result.content[0]!.text).toMatch(/^\[report:\d+-[0-9a-f]+\] shape check\n/);
  });

  it("unicode title round-trips into the frontmatter", async () => {
    const result = await handleWriteReport({
      title: "사골 테스트",
      body: "korean title body",
    });
    const id = result.content[0]!.text.match(/^\[report:(\d+-[0-9a-f]+)\]/)![1]!;
    const disk = readFileSync(join(tmpRoot, ".sagol", "reports", `${id}.md`), "utf8");
    expect(disk).toContain('title: "사골 테스트"');
  });

  it("two consecutive calls return distinct ids", async () => {
    const a = await handleWriteReport({ title: "a", body: "body a" });
    const b = await handleWriteReport({ title: "b", body: "body b" });
    const idA = a.content[0]!.text.match(/^\[report:(\d+-[0-9a-f]+)\]/)![1]!;
    const idB = b.content[0]!.text.match(/^\[report:(\d+-[0-9a-f]+)\]/)![1]!;
    expect(idA).not.toBe(idB);
  });
});
