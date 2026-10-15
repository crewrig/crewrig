// extension-hooks-timing-fixtures.ts — the input of the `windows-extension-hooks` timing steps (spec
// 0258 R18): one fixed one-line JSON payload, the standard input of every budgeted run.
//
// Run as a script it writes `payload.json` under a directory and appends `HOOK_PAYLOAD=<path>` to
// $GITHUB_ENV, so the later steps of the job read it as an environment variable:
//
//   node scripts/tests/lib/extension-hooks-timing-fixtures.ts [<dir>]
//
// Standard library only.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/** The payload every budgeted run reads: one JSON line, no carriage return. */
export const HOOK_PAYLOAD_LINE = '{"event":"hooks-timing","tool":"shell","args":["ls","-la"]}';

/** Write `payload.json` under `dir` (created when missing) and return its path. */
export function writeHookPayload(dir: string): string {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, "payload.json");
  fs.writeFileSync(file, `${HOOK_PAYLOAD_LINE}\n`);
  return file;
}

/** The `KEY=path` lines a workflow step appends to $GITHUB_ENV. */
export function githubEnvLines(payload: string): string[] {
  return [`HOOK_PAYLOAD=${payload}`];
}

if (import.meta.main) {
  const dir = process.argv[2] ?? fs.mkdtempSync(path.join(os.tmpdir(), "hooks-timing-"));
  const lines = githubEnvLines(writeHookPayload(dir));
  const envFile = process.env["GITHUB_ENV"];
  if (envFile === undefined || envFile === "") {
    process.stdout.write(`${lines.join("\n")}\n`);
  } else {
    fs.appendFileSync(envFile, `${lines.join("\n")}\n`);
  }
}
