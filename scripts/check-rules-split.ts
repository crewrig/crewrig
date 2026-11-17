// check-rules-split.ts — verifies that artifacts/core/rules/60-tools.md and 60-memory.md,
// interleaved in base order with N reversed and the pointers P removed, rebuild the
// 60-tools.md of a base ref byte for byte (spec 0308 R2).
//
// Usage: node scripts/check-rules-split.ts --base <ref> [--dir <rules dir>]
// `dir` defaults to artifacts/core/rules (relative to the current directory, a git work tree).
//
// Exit: 0 on a match, 1 with `FAIL section "<heading>"` lines on stdout, 2 on a usage error
// or an unreadable input.

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { checkRulesSplit } from "./lib/governance/rules-split.ts";
import { fail, fatal, ok } from "./lib/governance/report.ts";

const args = process.argv.slice(2);
const opt = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const baseRef = opt("--base");
const dir = opt("--dir") ?? "artifacts/core/rules";
if (!baseRef) {
  fatal("Usage: check-rules-split.ts --base <ref> [--dir <rules dir>]");
  process.exit(2);
}

const show = spawnSync("git", ["show", `${baseRef}:artifacts/core/rules/60-tools.md`], {
  encoding: "utf8",
  maxBuffer: 1 << 24,
});
if (show.status !== 0) {
  fatal(`Error: cannot read 60-tools.md at ${baseRef}: ${show.stderr.trim()}`);
  process.exit(2);
}
let tools: string;
let memory: string;
try {
  tools = readFileSync(path.join(dir, "60-tools.md"), "utf8");
  memory = readFileSync(path.join(dir, "60-memory.md"), "utf8");
} catch (e) {
  fatal(`Error: ${(e as Error).message}`);
  process.exit(2);
}

const findings = checkRulesSplit(show.stdout, tools, memory);
if (findings.length === 0) {
  ok(`OK: 60-tools.md and 60-memory.md rebuild 60-tools.md at ${baseRef} byte for byte`);
} else {
  for (const line of findings) fail(line);
  process.exitCode = 1;
}
