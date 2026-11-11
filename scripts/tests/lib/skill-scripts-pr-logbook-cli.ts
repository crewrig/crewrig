// skill-scripts-pr-logbook-cli.ts — black-box runner for the bundled pr-logbook scripts (spec 0292 R16).
// Each script runs as `node <entry> ...args` with a scrubbed environment and no network.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const SKILL_DIR = path.resolve(
  import.meta.dirname,
  "..",
  "..",
  "..",
  "artifacts",
  "core",
  "skills",
  "pr-logbook",
);
export const FIXTURES = path.resolve(import.meta.dirname, "..", "fixtures", "skill-scripts", "pr-logbook");

export type ScriptName = "lint-pr-body" | "resolve-logbook-target" | "flip-spec-status";

export interface Run {
  status: number | null;
  stdout: string;
  stderr: string;
}

export interface Envelope {
  ok: boolean;
  data: unknown;
  findings: { rule: string; message: string }[];
}

/** Run a script of `skillDir` (default: the repository copy) with no `--disable-warning` flag. */
export function run(
  script: ScriptName,
  args: readonly string[],
  opts: { input?: string; cwd?: string; skillDir?: string } = {},
): Run {
  const entry = path.join(opts.skillDir ?? SKILL_DIR, "scripts", `${script}.ts`);
  const res = spawnSync(process.execPath, [entry, ...args], {
    cwd: opts.cwd ?? os.tmpdir(),
    env: { HOME: os.tmpdir(), PATH: path.dirname(process.execPath), LC_ALL: "C" },
    encoding: "utf8",
    timeout: 30_000,
    ...(opts.input === undefined ? {} : { input: opts.input }),
  });
  return { status: res.status, stdout: res.stdout, stderr: res.stderr };
}

export function parseEnvelope(r: Run): Envelope {
  const lines = r.stdout.split("\n").filter((l) => l !== "");
  if (lines.length !== 1) throw new Error(`expected exactly one stdout line, got: ${r.stdout}`);
  return JSON.parse(lines[0] as string) as Envelope;
}

export function tempDir(prefix: string): string {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
}
