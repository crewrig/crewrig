// fixed-context-probe.ts — measure the fixed context of a Claude Code worker and subagent
// session and compare it with the committed threshold (issue #1994, ADR-0025 appendix).
//
// Usage:
//   node scripts/fixed-context-probe.ts [--settings <file>] [--model <id>] [--warn-only]
//        [--threshold-file <file>] [--cwd <dir>]            paid run: 1 main call + 1 developer subagent
//   node scripts/fixed-context-probe.ts --session <id> | --transcript <file>   free: read an existing session
//
// COST: the paid mode makes real model calls (about 0.2-0.4 USD). It REFUSES to run when `CI`
// is set and is wired in no workflow and not in `ci:pre-push`.
// Output: one JSON document on stdout (measures, threshold, breaches). Exit 0 within the
// threshold, 1 on a breach (0 with --warn-only, which prints a WARN line on stderr), 2 usage,
// 3 CI refusal or probe failure.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  compare,
  findTranscript,
  measureSession,
  parseThreshold,
  refuseInCi,
} from "./lib/fixed-context-probe.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const PROMPT =
  "Call the Agent tool once with subagent_type developer and the prompt 'Reply with the single word OK'. Then answer DONE.";

const args = process.argv.slice(2);
const opts: Record<string, string | boolean> = {};
const valued = ["settings", "model", "threshold-file", "cwd", "session", "transcript"];
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === "--warn-only") opts["warn-only"] = true;
  else if (a.startsWith("--") && valued.includes(a.slice(2)) && i + 1 < args.length) {
    opts[a.slice(2)] = args[++i];
  } else usage(`unknown or incomplete argument: ${a}`);
}

function usage(msg: string): never {
  process.stderr.write(`Error: ${msg}\n`);
  process.exit(2);
}
function fail(msg: string): never {
  process.stderr.write(`Error: ${msg}\n`);
  process.exit(3);
}

const claudeDir = process.env.CLAUDE_CONFIG_DIR ?? path.join(os.homedir(), ".claude");
const projectsDir = path.join(claudeDir, "projects");
const threshold = parseThreshold(
  fs.readFileSync(
    String(opts["threshold-file"] ?? path.join(here, "fixed-context-threshold.json")),
    "utf8",
  ),
);

let transcript: string | null;
let cost: number | null = null;
if (typeof opts.transcript === "string") {
  transcript = opts.transcript;
} else if (typeof opts.session === "string") {
  transcript = findTranscript(projectsDir, opts.session);
  if (transcript === null) fail(`no transcript for session ${opts.session} under ${projectsDir}`);
} else {
  const refusal = refuseInCi(process.env);
  if (refusal !== null) fail(refusal);
  const cmd = [
    "-p", PROMPT, "--model", String(opts.model ?? "claude-sonnet-5-5"),
    "--output-format", "json", "--allowedTools", "Agent",
  ];
  if (typeof opts.settings === "string") cmd.push("--settings", opts.settings);
  const run = spawnSync("claude", cmd, {
    cwd: String(opts.cwd ?? process.cwd()),
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (run.status !== 0) fail(`claude exited ${run.status}: ${(run.stderr ?? "").slice(-300)}`);
  let result: { session_id?: string; total_cost_usd?: number };
  try {
    result = JSON.parse(run.stdout);
  } catch {
    fail("claude did not print JSON");
  }
  cost = result.total_cost_usd ?? null;
  if (result.session_id === undefined) fail("no session_id in the claude output");
  transcript = findTranscript(projectsDir, result.session_id);
  if (transcript === null) fail(`no transcript for session ${result.session_id}`);
}

const measures = measureSession(transcript);
if (!measures.some((m) => m.kind === "worker")) fail(`no assistant call in ${transcript}`);
const breaches = compare(measures, threshold);
const warnOnly = opts["warn-only"] === true;
process.stdout.write(
  `${JSON.stringify({ settings: opts.settings ?? null, cost_usd: cost, threshold, measures, breaches }, null, 2)}\n`,
);
for (const b of breaches) {
  process.stderr.write(
    `${warnOnly ? "WARN" : "FAILED"}: ${b.kind} ${b.agent} first call ${b.tokens} > ${b.limit} (+${b.excess})\n`,
  );
}
process.exitCode = breaches.length > 0 && !warnOnly ? 1 : 0;
