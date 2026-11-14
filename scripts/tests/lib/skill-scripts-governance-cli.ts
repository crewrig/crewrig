// skill-scripts-governance-cli.ts — black-box runner for the bundled scripts of the library skills
// user-validate, harness-report and harness-curator. Each script runs as `node <entry> ...args`
// with a scrubbed environment and no network; PATH holds the node directory plus any extra bin
// directory a test supplies (a fake `plannotator`, for instance).

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const REPO = path.resolve(import.meta.dirname, "..", "..", "..");

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

export const skillDir = (skill: string): string =>
  path.join(REPO, "artifacts", "library", "skills", skill);

export function run(
  skill: string,
  script: string,
  args: readonly string[],
  opts: {
    input?: string;
    cwd?: string;
    bin?: string;
    env?: Record<string, string>;
    skillRoot?: string;
  } = {},
): Run {
  const entry = path.join(opts.skillRoot ?? skillDir(skill), "scripts", script);
  const pathValue = [opts.bin, path.dirname(process.execPath)].filter(Boolean).join(path.delimiter);
  const res = spawnSync(process.execPath, [entry, ...args], {
    cwd: opts.cwd ?? os.tmpdir(),
    env: { HOME: os.tmpdir(), PATH: pathValue, LC_ALL: "C", ...opts.env },
    encoding: "utf8",
    timeout: 30_000,
    ...(opts.input === undefined ? {} : { input: opts.input }),
  });
  return { status: res.status, stdout: res.stdout, stderr: res.stderr };
}

export function envelope(r: Run): Envelope {
  const lines = r.stdout.split("\n").filter((l) => l !== "");
  if (lines.length !== 1) throw new Error(`expected exactly one stdout line, got: ${r.stdout}`);
  return JSON.parse(lines[0] as string) as Envelope;
}

export const tempDir = (prefix: string): string =>
  fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
