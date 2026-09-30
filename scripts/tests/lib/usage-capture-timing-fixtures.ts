// usage-capture-timing-fixtures.ts — the inputs of the `windows-usage-capture`
// timing steps (spec 0243 R15): a transcript with a real stamp for the fast
// path, an unstamped one for the slow path, an Antigravity statusline payload
// for the shim, and the stdin payload file of each.
//
// Run as a script it writes them under a directory and appends `KEY=path`
// lines to $GITHUB_ENV, so the later steps of the job read them as environment
// variables:
//
//   node scripts/tests/lib/usage-capture-timing-fixtures.ts [<dir>]
//
//   CREWRIG_USAGE_ROOT   the usage root that holds the fast path's stamp
//   TIMING_FAST_PAYLOAD  stdin file: transcript_path of the stamped transcript
//   TIMING_SLOW_PAYLOAD  stdin file: transcript_path of an unstamped transcript
//   TIMING_SHIM_PAYLOAD  stdin file: the Antigravity statusline payload
//
// The slow and shim steps override CREWRIG_USAGE_ROOT per run with
// `check-timing-budget.ts --env-tmpdir CREWRIG_USAGE_ROOT`, so each starts from
// an empty usage root; only the fast step reads the stamped one.
//
// Standard library only.

import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const FIXTURES = path.join(REPO, "scripts", "tests", "fixtures", "usage-capture");

interface Cursor {
  touchStamp(cli: string, sourcePath: string, sourceMtimeMs: number): void;
}

export interface TimingFixtures {
  /** The usage root holding the fast path's stamp. */
  readonly usageRoot: string;
  /** The stamped transcript (fast path: nothing new to capture). */
  readonly stampedTranscript: string;
  /** An identical transcript with no stamp (slow path: one capture). */
  readonly freshTranscript: string;
  readonly fastPayload: string;
  readonly slowPayload: string;
  readonly shimPayload: string;
}

/** Run `fn` with CREWRIG_USAGE_ROOT set to `root`, restoring the variable after. */
function withUsageRoot<T>(root: string, fn: () => T): T {
  const previous = process.env["CREWRIG_USAGE_ROOT"];
  process.env["CREWRIG_USAGE_ROOT"] = root;
  try {
    return fn();
  } finally {
    if (previous === undefined) delete process.env["CREWRIG_USAGE_ROOT"];
    else process.env["CREWRIG_USAGE_ROOT"] = previous;
  }
}

function claudePayload(transcript: string): string {
  return `${JSON.stringify({
    session_id: "timing-fixture-session",
    transcript_path: transcript,
    cwd: path.dirname(transcript),
    hook_event_name: "Stop",
  })}\n`;
}

/** Write every fixture under `dir` (created when missing). */
export function writeTimingFixtures(dir: string): TimingFixtures {
  const source = path.join(FIXTURES, "claude-code", "2.1.x-jsonl", "session.jsonl");
  const stampedTranscript = path.join(dir, "transcripts", "stamped", "session.jsonl");
  const freshTranscript = path.join(dir, "transcripts", "fresh", "session.jsonl");
  for (const target of [stampedTranscript, freshTranscript]) {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(source, target);
  }

  const usageRoot = path.join(dir, "usage-root");
  fs.mkdirSync(usageRoot, { recursive: true });
  const cursor = createRequire(import.meta.url)(
    path.join(REPO, "scripts", "lib", "usage-capture", "cursor.js"),
  ) as Cursor;
  withUsageRoot(usageRoot, () => {
    cursor.touchStamp("claude-code", stampedTranscript, fs.statSync(stampedTranscript).mtimeMs);
  });

  const payloads = path.join(dir, "payloads");
  fs.mkdirSync(payloads, { recursive: true });
  const fastPayload = path.join(payloads, "fast.json");
  const slowPayload = path.join(payloads, "slow.json");
  const shimPayload = path.join(payloads, "shim.json");
  fs.writeFileSync(fastPayload, claudePayload(stampedTranscript));
  fs.writeFileSync(slowPayload, claudePayload(freshTranscript));
  fs.copyFileSync(
    path.join(FIXTURES, "antigravity", "statusline-payload", "payload.json"),
    shimPayload,
  );
  return {
    usageRoot,
    stampedTranscript,
    freshTranscript,
    fastPayload,
    slowPayload,
    shimPayload,
  };
}

/** The `KEY=path` lines a workflow step appends to $GITHUB_ENV. */
export function githubEnvLines(fixtures: TimingFixtures): string[] {
  return [
    `CREWRIG_USAGE_ROOT=${fixtures.usageRoot}`,
    `TIMING_FAST_PAYLOAD=${fixtures.fastPayload}`,
    `TIMING_SLOW_PAYLOAD=${fixtures.slowPayload}`,
    `TIMING_SHIM_PAYLOAD=${fixtures.shimPayload}`,
  ];
}

const invokedPath = process.argv[1];
if (
  invokedPath !== undefined &&
  import.meta.url === pathToFileURL(fs.realpathSync(invokedPath)).href
) {
  const dir = process.argv[2] ?? fs.mkdtempSync(path.join(os.tmpdir(), "usage-capture-timing-"));
  const lines = githubEnvLines(writeTimingFixtures(dir));
  const envFile = process.env["GITHUB_ENV"];
  if (envFile === undefined || envFile === "") {
    process.stdout.write(`${lines.join("\n")}\n`);
  } else {
    fs.appendFileSync(envFile, `${lines.join("\n")}\n`);
  }
}
