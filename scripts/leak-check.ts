#!/usr/bin/env bun
/**
 * SAGOL Phase 1 — Leakage check utility.
 *
 * Reads every report persisted to `.sagol/reports/*.md`, extracts the body
 * (everything after the YAML frontmatter), and greps the current Claude Code
 * session transcript JSONL for any exact-substring match of that body. A
 * healthy, post–D-10 session should produce ZERO hits — the main agent's
 * transcript must contain only stripped forms (`[report:<id>] <title>\n<summary>`),
 * never the full body.
 *
 * Known intentional leaks:
 *   - The initial 2026-04-15 Phase 1 HARD GATE canary report was written
 *     BEFORE the D-10 pivot when the hook path was still expected to strip.
 *     That report's body DID end up in the main transcript; it is what
 *     proved hooks don't fire in interactive mode. This script flags it
 *     so the operator can visually discount it.
 *
 * Usage:
 *   bun run scripts/leak-check.ts                  # check all reports in this project
 *   bun run scripts/leak-check.ts --session <path> # override transcript file
 *   bun run scripts/leak-check.ts --report <id>    # check one specific report id
 *   bun run scripts/leak-check.ts --strict         # exit 1 on any unexpected leak
 *
 * Exit:
 *   Default mode: always exits 0 (prints a WARN summary if leaks are found).
 *   --strict:     exits 1 if any post-D-10 report body appears in the transcript.
 *
 * Limitation: running against the CURRENT session may see self-hits because
 *   the script's own stdout is captured back into the transcript by Claude
 *   Code. For an authoritative audit, run against a prior session JSONL via
 *   --session <path>. Fingerprints are shown as opaque hash tags in the
 *   output table specifically to prevent self-reference contamination on
 *   subsequent runs within the same session.
 */
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, resolve, basename } from "node:path";
import { homedir } from "node:os";

const PROJECT_ROOT = resolve(process.env.SAGOL_PROJECT_ROOT ?? process.cwd());
const REPORTS_DIR = join(PROJECT_ROOT, ".sagol", "reports");

// The path CC uses for this project's session transcripts. The slug is
// "-Users-chenjing-dev-sagol" when CWD is /Users/chenjing/dev/sagol — CC
// replaces path separators with dashes.
function transcriptDir(): string {
  const slug = PROJECT_ROOT.replace(/^\//, "-").replace(/\//g, "-");
  return join(homedir(), ".claude", "projects", slug);
}

function newestJsonl(dir: string): string | null {
  if (!existsSync(dir)) return null;
  const entries = readdirSync(dir)
    .filter((f) => f.endsWith(".jsonl"))
    .map((f) => ({ name: f, path: join(dir, f), mtime: statSync(join(dir, f)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);
  return entries[0]?.path ?? null;
}

function parseReport(mdPath: string): { id: string; body: string } | null {
  const raw = readFileSync(mdPath, "utf8");
  if (!raw.startsWith("---\n")) return null;
  const fmEnd = raw.indexOf("\n---\n", 4);
  if (fmEnd < 0) return null;
  const frontmatter = raw.slice(4, fmEnd);
  const idMatch = frontmatter.match(/^id:\s*(\S+)/m);
  if (!idMatch) return null;
  const body = raw.slice(fmEnd + 5).trim();
  return { id: idMatch[1]!, body };
}

// A "fingerprint" for a body: the longest substring that isn't also in the
// stripped form. For a naively derived summary (first 200 chars of the first
// paragraph), the body's LATER paragraphs are guaranteed absent from the
// stripped form. Take a distinctive chunk from the body tail.
function fingerprint(body: string): string {
  const lines = body.split(/\n/).map((l) => l.trim()).filter(Boolean);
  // Prefer a line 30–200 chars long from the back half (more unique than
  // opening boilerplate).
  const backHalf = lines.slice(Math.floor(lines.length / 2));
  for (const line of backHalf.reverse()) {
    if (line.length >= 30 && line.length <= 200) return line;
  }
  // Fallback: the longest line in the body.
  return [...lines].sort((a, b) => b.length - a.length)[0] ?? body.slice(0, 80);
}

// D-10 pivot cutoff — any report whose id timestamp predates this was
// written while the (broken) hook path was still expected to strip. Those
// reports' bodies legitimately reach the transcript and must not count
// as leaks. Commit de66c83 ("feat(phase-1): server-side stripping") at
// 2026-04-15 09:23:42 +0900 is the marker. All id epochMs < this value
// → historical.
const D10_CUTOFF_MS = Date.parse("2026-04-15T09:23:42+09:00");

function isHistorical(reportId: string): boolean {
  const idMs = parseInt(reportId.split("-")[0] ?? "0", 10);
  return Number.isFinite(idMs) && idMs < D10_CUTOFF_MS;
}

function parseArgs(argv: string[]): {
  session?: string;
  report?: string;
  strict: boolean;
} {
  const out: { session?: string; report?: string; strict: boolean } = {
    strict: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--session") out.session = argv[++i];
    else if (a === "--report") out.report = argv[++i];
    else if (a === "--strict") out.strict = true;
  }
  return out;
}

// Hash a fingerprint to a short display-safe tag so printing the table
// output into the terminal (and thus the CC session transcript) cannot
// create a self-reference hit on the next run.
function tagFor(fp: string): string {
  let h = 0;
  for (let i = 0; i < fp.length; i++) {
    h = (h * 31 + fp.charCodeAt(i)) | 0;
  }
  return `fp-${(h >>> 0).toString(16).padStart(8, "0")}`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const sessionPath =
    args.session ?? newestJsonl(transcriptDir());
  if (!sessionPath) {
    console.error(`[leak-check] no transcript found under ${transcriptDir()}`);
    console.error(`[leak-check] run a session in this project first, or pass --session <path>`);
    process.exit(1);
  }
  if (!existsSync(sessionPath)) {
    console.error(`[leak-check] session file not found: ${sessionPath}`);
    process.exit(1);
  }

  const transcript = readFileSync(sessionPath, "utf8");
  console.log(`[leak-check] transcript: ${sessionPath}`);
  console.log(`[leak-check] transcript size: ${transcript.length} bytes`);

  if (!existsSync(REPORTS_DIR)) {
    console.error(`[leak-check] no reports dir at ${REPORTS_DIR}`);
    process.exit(1);
  }
  const allFiles = readdirSync(REPORTS_DIR)
    .filter((f) => f.endsWith(".md"))
    .map((f) => join(REPORTS_DIR, f));
  const files = args.report
    ? allFiles.filter((f) => basename(f).startsWith(args.report!))
    : allFiles;

  if (files.length === 0) {
    console.error(`[leak-check] no report files matched`);
    process.exit(1);
  }
  console.log(`[leak-check] checking ${files.length} report(s)`);

  let leaks = 0;
  let historical = 0;
  const rows: Array<{ id: string; tag: string; hits: number; note: string }> = [];
  for (const f of files) {
    const rep = parseReport(f);
    if (!rep) continue;
    const fp = fingerprint(rep.body);
    const hits = transcript.split(fp).length - 1;
    const isHist = isHistorical(rep.id);
    let note = "";
    if (isHist) {
      note = "pre-D-10 historical";
      if (hits > 0) historical++;
    } else if (hits > 0) {
      note = "LEAK";
      leaks++;
    } else {
      note = "ok";
    }
    rows.push({ id: rep.id, tag: tagFor(fp), hits, note });
  }

  console.log(`\n| id | hits | note | fp-tag |`);
  console.log(`|---|---|---|---|`);
  for (const r of rows) {
    console.log(`| ${r.id} | ${r.hits} | ${r.note} | ${r.tag} |`);
  }

  console.log(
    `\n[leak-check] summary: ${leaks} unexpected leak(s), ${historical} historical (excluded), ${rows.length - leaks - historical} clean`,
  );
  console.log(
    `[leak-check] note: fingerprints are shown as opaque hash tags so this output cannot self-leak into the transcript on future runs.`,
  );
  console.log(
    `[leak-check] note: for an authoritative audit, run against a FRESH session transcript (pass --session <path>). Current-session checks may be contaminated by the script's own output.`,
  );
  if (leaks > 0) {
    if (args.strict) {
      console.error(`[leak-check] FAIL (--strict) — ${leaks} unexpected leak(s)`);
      process.exit(1);
    }
    console.error(
      `[leak-check] WARN — ${leaks} unexpected leak(s); re-run with --strict against a fresh session to escalate.`,
    );
  } else {
    console.log(`[leak-check] PASS — zero unexpected leaks`);
  }
}

main().catch((e) => {
  console.error(`[leak-check] fatal: ${String(e)}`);
  process.exit(1);
});
