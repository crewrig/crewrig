// skill-scripts-github-actions-cli.ts — black-box runner and fixtures for the bundled github-actions
// scripts (spec 0300 R6 to R11, R21). Each script runs as `node <entry> ...args` with a scrubbed
// environment, no network, and a PATH that holds nothing but the node binary plus the stubs a test
// asks for: no `actionlint`, `act` or `docker` unless the test installs a stub.

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
  "github-actions",
);

export type ScriptName =
  | "check-permissions"
  | "check-pull-request-target"
  | "check-expression-injection"
  | "check-pinned-actions"
  | "check-secrets-exposure"
  | "lint-workflow"
  | "simulate-job"
  | "simulate-workflow"
  | "resolve-engine"
  | "validate-pipeline";

export const ALL_SCRIPTS: readonly ScriptName[] = [
  "check-permissions",
  "check-pull-request-target",
  "check-expression-injection",
  "check-pinned-actions",
  "check-secrets-exposure",
  "lint-workflow",
  "simulate-job",
  "simulate-workflow",
  "resolve-engine",
  "validate-pipeline",
];

export interface Run {
  status: number | null;
  stdout: string;
  stderr: string;
}

export interface Finding {
  rule: string;
  message: string;
  severity?: string;
  path?: string;
  line?: number;
}

export interface Envelope {
  ok: boolean;
  data: Record<string, unknown> | null;
  findings: Finding[];
}

export function tempDir(prefix: string): string {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
}

/** Write `files` (relative path to text) under `dir`, creating parent directories. */
export function writeTree(dir: string, files: Record<string, string>): void {
  for (const [rel, text] of Object.entries(files)) {
    const file = path.join(dir, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
  }
}

/** A stub executable named `name` in `bin`; the body is a POSIX shell snippet. */
export function stubTool(bin: string, name: string, body: string): void {
  fs.mkdirSync(bin, { recursive: true });
  fs.writeFileSync(path.join(bin, name), `#!/bin/sh\n${body}\n`, { mode: 0o755 });
}

export interface RunOpts {
  cwd: string;
  skillDir?: string;
  input?: string;
  /** Directories appended to PATH after the node binary's directory (stubs). */
  bin?: readonly string[];
  env?: Record<string, string>;
  timeout?: number;
}

export function run(script: ScriptName, args: readonly string[], opts: RunOpts): Run {
  const entry = path.join(opts.skillDir ?? SKILL_DIR, "scripts", `${script}.ts`);
  const res = spawnSync(process.execPath, [entry, ...args], {
    cwd: opts.cwd,
    env: {
      HOME: os.tmpdir(),
      PATH: [path.dirname(process.execPath), ...(opts.bin ?? [])].join(path.delimiter),
      LC_ALL: "C",
      ...(opts.env ?? {}),
    },
    encoding: "utf8",
    timeout: opts.timeout ?? 30_000,
    ...(opts.input === undefined ? {} : { input: opts.input }),
  });
  return { status: res.status, stdout: res.stdout, stderr: res.stderr };
}

export function parseEnvelope(r: Run): Envelope {
  const lines = r.stdout.split("\n").filter((l) => l !== "");
  if (lines.length !== 1) throw new Error(`expected exactly one stdout line, got: ${r.stdout}`);
  return JSON.parse(lines[0] as string) as Envelope;
}

export const rulesOf = (env: Envelope): string[] => env.findings.map((f) => f.rule);

/** Run with --json and return both the run and its envelope. */
export function runJson(script: ScriptName, args: readonly string[], opts: RunOpts) {
  const r = run(script, [...args, "--json"], opts);
  return { r, env: parseEnvelope(r) };
}

/** Every `{state|status: ran|skipped|failed}` entry of a validate-pipeline report, keyed by check. */
export function checkStates(env: Envelope): Map<string, string> {
  const out = new Map<string, string>();
  const walk = (v: unknown): void => {
    if (Array.isArray(v)) return v.forEach(walk);
    if (v === null || typeof v !== "object") return;
    const o = v as Record<string, unknown>;
    const state = [o["state"], o["status"], o["result"]].find(
      (x) => x === "ran" || x === "skipped" || x === "failed",
    );
    const name = [o["check"], o["name"], o["script"], o["id"]].find(
      (x): x is string => typeof x === "string",
    );
    if (typeof state === "string" && name !== undefined) out.set(name.replace(/\.ts$/, ""), state);
    Object.values(o).forEach(walk);
  };
  walk(env.data);
  return out;
}

// ---- workflow fixtures -------------------------------------------------------------------

export const SHA = "0123456789abcdef0123456789abcdef01234567";

/** A workflow every check of the skill accepts. */
export const WF_CLEAN = `name: ci
on:
  pull_request:
permissions:
  contents: read
jobs:
  test:
    runs-on: ubuntu-latest
    timeout-minutes: 10
    steps:
      - uses: actions/checkout@${SHA} # v4.2.2
      - env:
          PR_TITLE: \${{ github.event.pull_request.title }}
        run: echo "$PR_TITLE"
`;

/** A composite action: no `jobs:` key, which every check passes. */
export const ACTION_YML = `name: setup
description: composite
runs:
  using: composite
  steps:
    - run: echo "\${{ github.event.pull_request.title }}"
      shell: bash
`;

export const wf = (body: string, head = "name: t\non: push\n"): string => `${head}${body}`;
