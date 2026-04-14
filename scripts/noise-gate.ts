#!/usr/bin/env bun
/**
 * SAGOL Phase 0 — Noise-sensitivity gate CLI skeleton (D-04).
 *
 * In Phase 0 only the --dry-run path is functional. The real run wires
 * SWE-bench Pro via Bun.spawn → python + Docker and is scoped to Phase 3
 * (see ROADMAP.md). Calling without --dry-run in Phase 0 fails loudly.
 *
 * Usage:
 *   bun run scripts/noise-gate.ts --task <id> --noise-tokens 10000 --runs 5 --dry-run
 */

type Args = {
  task: string;
  noiseTokens: number;
  runs: number;
  dryRun: boolean;
  help: boolean;
};

function parseArgs(argv: string[]): Args {
  const args: Args = {
    task: "",
    noiseTokens: 10000,
    runs: 5,
    dryRun: false,
    help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--help" || a === "-h") args.help = true;
    else if (a === "--dry-run") args.dryRun = true;
    else if (a === "--task") args.task = argv[++i] ?? "";
    else if (a === "--noise-tokens") args.noiseTokens = Number(argv[++i] ?? "0");
    else if (a === "--runs") args.runs = Number(argv[++i] ?? "0");
  }
  return args;
}

// Phase 0 hard-coded candidate list. Real SWE-bench Pro instance fetch is
// deferred to Phase 3 — we only need a syntactically valid task id to
// prove the CLI wiring. Seed is recorded in PINNED_VERSIONS.md.
const PHASE_0_CANDIDATE_TASKS = [
  "swe-bench-pro/mock-instance-001",
  "swe-bench-pro/mock-instance-002",
  "swe-bench-pro/mock-instance-003",
];

function pickTaskBySeed(seed: number): string {
  const idx = ((seed % PHASE_0_CANDIDATE_TASKS.length) +
    PHASE_0_CANDIDATE_TASKS.length) %
    PHASE_0_CANDIDATE_TASKS.length;
  return PHASE_0_CANDIDATE_TASKS[idx]!;
}

function loremBlock(tokens: number): string {
  // Approximate: ~1 token ≈ 4 chars. 10k tokens ≈ 40 KB of filler.
  const unit =
    "lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod ";
  const target = tokens * 4;
  let out = "";
  while (out.length < target) out += unit;
  return out.slice(0, target);
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(
      "Usage: bun run scripts/noise-gate.ts --task <id> --noise-tokens 10000 --runs 5 [--dry-run]\n\n" +
        "Phase 0: only --dry-run is wired. Real run deferred to Phase 3.",
    );
    return 0;
  }
  if (!args.dryRun) {
    console.error(
      "[noise-gate] non-dry-run path is deferred to Phase 3 (SWE-bench Pro + Docker). " +
        "Pass --dry-run for Phase 0 verification.",
    );
    return 1;
  }

  const task = args.task || pickTaskBySeed(1);
  const filler = loremBlock(args.noiseTokens);
  const mockProblem = `# Problem\nStart.\n\n${filler}\n\nEnd.`;

  console.log(
    `[dry-run] would run baseline ×${args.runs} and noisy ×${args.runs} for task ${task}`,
  );
  console.log(
    `[dry-run] mock problem statement length: ${mockProblem.length} chars ` +
      `(~${Math.round(mockProblem.length / 4)} tokens)`,
  );
  console.log(
    `[dry-run] noise tokens requested: ${args.noiseTokens}, runs: ${args.runs}`,
  );
  console.log(
    "[dry-run] real run will write .planning/phases/00-pre-flight-gates/00-NOISE-GATE-RESULT.md in Phase 3",
  );
  return 0;
}

const code = await main();
process.exit(code);
