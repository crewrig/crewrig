// ci-paths-gate.ts — runtime path gate replacing dorny/paths-filter (spec 0283 R6).
//
// Usage: node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/ci-paths-gate.ts
//          --capability <id> [--event <name>] [--before <sha>]
//   Defaults: --event $GITHUB_EVENT_NAME, --before $GATE_BEFORE. Reads ci/ci-capabilities.yml
//   (REPO_DIR overrides the root). The diff is `git diff --name-only HEAD^1 HEAD` for
//   pull_request and `<before> HEAD` for push; any failure fails open.
// Output: `changed=true|false` appended to $GITHUB_OUTPUT (stdout when unset).
// Exit: 0, 2 usage, unknown capability or unsupported glob (never silent).
// Any event other than pull_request and push runs the job. Annotation format (countable):
//   ::notice title=ci-paths-gate::<id>: failing open, <reason>

import fs from "node:fs";
import path from "node:path";

import { UnsupportedGlobError } from "./lib/glob-engine.ts";
import { decide } from "./lib/ci-paths-gate/gate.ts";
import { readEffective } from "./lib/ci-paths-gate/reference.ts";

function usage(msg: string): number {
  process.stderr.write(`ci-paths-gate: ${msg}\n`);
  return 2;
}

async function main(argv: string[]): Promise<number> {
  const opt: Record<string, string> = {};
  for (let i = 0; i < argv.length; i += 2) {
    const k = argv[i] ?? "";
    const v = argv[i + 1];
    if (!["--capability", "--event", "--before"].includes(k) || v === undefined)
      return usage(`bad argument '${k}'`);
    opt[k] = v;
  }
  const id = opt["--capability"];
  if (id === undefined || id === "") return usage("--capability is required");
  const event = opt["--event"] ?? process.env["GITHUB_EVENT_NAME"] ?? "";
  const before = opt["--before"] ?? process.env["GATE_BEFORE"] ?? "";
  const repo = process.env["REPO_DIR"] || path.resolve(import.meta.dirname, "..");
  let d;
  try {
    const eff = readEffective(
      fs.readFileSync(path.join(repo, "ci/ci-capabilities.yml"), "utf8"),
      id,
    );
    d = await decide(id, event, before, eff.paths);
  } catch (e) {
    if (e instanceof UnsupportedGlobError) return usage(e.message);
    return usage((e as Error).message);
  }
  if (d.failOpen !== undefined)
    process.stdout.write(`::notice title=ci-paths-gate::${id}: failing open, ${d.failOpen}\n`);
  const line = `changed=${d.changed}\n`;
  const out = process.env["GITHUB_OUTPUT"];
  if (out) fs.appendFileSync(out, line);
  else process.stdout.write(line);
  return 0;
}

process.exitCode = await main(process.argv.slice(2));
