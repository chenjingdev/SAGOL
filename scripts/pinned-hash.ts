#!/usr/bin/env bun
/**
 * Deterministic SHA-256 over the versioned fields of PINNED_VERSIONS.md.
 *
 * We hash the raw file contents with normalized line endings. This means
 * the hash changes if ANY character of PINNED_VERSIONS.md changes — which
 * is exactly what "immutable after commit" demands (verification via
 * `bun run scripts/pinned-hash.ts` recomputing the same hex string).
 */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const PROJECT_ROOT = resolve(process.cwd());
const PINNED_PATH = join(
  PROJECT_ROOT,
  ".planning",
  "research",
  "PINNED_VERSIONS.md",
);

function normalize(text: string): string {
  // LF only, strip any existing "pinned_versions_hash:" line (circular).
  return text
    .replace(/\r\n/g, "\n")
    .split("\n")
    .filter((line) => !/^pinned_versions_hash:/i.test(line.trim()))
    .join("\n");
}

const raw = readFileSync(PINNED_PATH, "utf8");
const hash = createHash("sha256").update(normalize(raw)).digest("hex");
process.stdout.write(hash + "\n");
