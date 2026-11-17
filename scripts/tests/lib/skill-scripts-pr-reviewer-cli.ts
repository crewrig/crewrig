// skill-scripts-pr-reviewer-cli.ts — black-box runner for the bundled pr-reviewer scripts. Each
// script runs from a COPY of the whole skill directory placed outside the repository, as
// `node <entry> ...args`, with a scrubbed environment and no network: `gh` is a fake that logs its
// arguments and answers from files, so no test reaches a forge.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const REPO = path.resolve(import.meta.dirname, "..", "..", "..");
export const SKILL_SOURCE = path.join(REPO, "artifacts", "core", "skills", "pr-reviewer");

export interface Run {
  status: number | null;
  stdout: string;
  stderr: string;
}
export interface Envelope {
  ok: boolean;
  data: Record<string, unknown> | null;
  findings: { rule: string; message: string; severity?: string }[];
}

export const tempDir = (prefix: string): string =>
  fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));

/** A copy of the skill directory outside the repository (evals/ never ships, so it is left out). */
export function copySkill(root: string): string {
  const dir = path.join(root, "pr-reviewer");
  fs.cpSync(SKILL_SOURCE, dir, {
    recursive: true,
    filter: (src) => !src.includes(`${path.sep}evals`),
  });
  return dir;
}

/** A fake `gh`: logs its arguments, answers from `<key>[.<n>].out` and exits with `<key>.rc`. */
export function fakeGh(dir: string): { bin: string; state: string } {
  const bin = path.join(dir, "bin");
  const state = path.join(dir, "gh-state");
  fs.mkdirSync(bin, { recursive: true });
  fs.mkdirSync(state, { recursive: true });
  const script = `#!/bin/sh
PATH=/usr/bin:/bin
state="${state}"
echo "$*" >> "$state/calls.log"
key="$1_$2"
n=$(cat "$state/$key.count" 2>/dev/null || echo 0)
n=$((n + 1))
echo "$n" > "$state/$key.count"
if [ -f "$state/$key.$n.out" ]; then cat "$state/$key.$n.out"; elif [ -f "$state/$key.out" ]; then cat "$state/$key.out"; fi
if [ -f "$state/$key.err" ]; then cat "$state/$key.err" >&2; fi
if [ -f "$state/$key.rc" ]; then exit "$(cat "$state/$key.rc")"; fi
exit 0
`;
  fs.writeFileSync(path.join(bin, "gh"), script, { mode: 0o755 });
  return { bin, state };
}

export function run(
  skillDir: string,
  script: string,
  args: readonly string[],
  opts: { input?: string; cwd?: string; path?: string } = {},
): Run {
  const entry = path.join(skillDir, "scripts", `${script}.ts`);
  const res = spawnSync(process.execPath, [entry, ...args], {
    cwd: opts.cwd ?? os.tmpdir(),
    env: {
      HOME: os.tmpdir(),
      PATH: opts.path ?? path.dirname(process.execPath),
      LC_ALL: "C",
    },
    encoding: "utf8",
    timeout: 60_000,
    ...(opts.input === undefined ? {} : { input: opts.input }),
  });
  return { status: res.status, stdout: res.stdout, stderr: res.stderr };
}

export function envelope(r: Run): Envelope {
  const lines = r.stdout.split("\n").filter((l) => l !== "");
  if (lines.length !== 1) throw new Error(`expected exactly one stdout line, got: ${r.stdout}`);
  return JSON.parse(lines[0] as string) as Envelope;
}
