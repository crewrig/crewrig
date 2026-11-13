// skill-scripts-github-actions-sandbox.ts — sandbox, stub and golden helpers shared by the two
// github-actions contract test files (spec 0300 R10, R21).

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import {
  type Run,
  run,
  type ScriptName,
  stubTool,
  tempDir,
  writeTree,
} from "./skill-scripts-github-actions-cli.ts";

const GOLDEN = path.resolve(import.meta.dirname, "..", "fixtures", "github-actions-contract");
const REGEN = process.env["GHA_CONTRACT_REGEN"] === "1";

export const root = tempDir("gha-contract-");

let n = 0;
export interface Sandbox {
  work: string;
  tmpdir: string;
  bin: string;
  env: Record<string, string>;
}
/** A fresh working directory, a private TMPDIR, and an empty stub bin directory. */
export function sandbox(files: Record<string, string> = {}): Sandbox {
  const base = path.join(root, `s${n++}`);
  const work = path.join(base, "work");
  const tmpdir = path.join(base, "tmp");
  const bin = path.join(base, "bin");
  for (const d of [work, tmpdir, bin]) fs.mkdirSync(d, { recursive: true });
  writeTree(work, files);
  return { work, tmpdir, bin, env: { TMPDIR: tmpdir } };
}
export const exec = (
  s: Sandbox,
  script: ScriptName,
  args: readonly string[],
  withBin = true,
): Run => run(script, args, { cwd: s.work, env: s.env, bin: withBin ? [s.bin] : [] });
export const dockerOk = (s: Sandbox): void => stubTool(s.bin, "docker", "exit 0");
export const act = (s: Sandbox, body: string): void => {
  dockerOk(s);
  stubTool(s.bin, "act", body);
};
export const tmpLeft = (s: Sandbox): string[] => fs.readdirSync(s.tmpdir);

export const WF_UNPINNED =
  "name: t\non: push\njobs:\n  b:\n    runs-on: x\n    steps:\n      - uses: actions/checkout@v4\n";

/** Compare an observation with its stored golden (or write it under GHA_CONTRACT_REGEN=1). */
export function golden(name: string, s: Sandbox, r: Run): void {
  const norm = (t: string): string =>
    t
      .replaceAll(s.work, "{WORK}")
      .replaceAll(s.tmpdir, "{TMP}")
      .replace(/act-payload\.[0-9a-f]{12}\.json/g, "act-payload.{RAND}.json");
  const seen = { status: r.status, stdout: norm(r.stdout), stderr: norm(r.stderr) };
  const file = path.join(GOLDEN, `${name}.json`);
  if (REGEN) {
    fs.mkdirSync(GOLDEN, { recursive: true });
    fs.writeFileSync(file, `${JSON.stringify(seen, null, 2)}\n`);
  }
  assert.ok(fs.existsSync(file), `no golden ${file}: record with GHA_CONTRACT_REGEN=1`);
  assert.deepEqual(seen, JSON.parse(fs.readFileSync(file, "utf8")), name);
}
