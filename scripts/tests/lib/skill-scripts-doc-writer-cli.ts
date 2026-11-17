// skill-scripts-doc-writer-cli.ts — black-box runner for the bundled doc-writer scripts (spec 0297 R8).
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
  "doc-writer",
);

export type ScriptName = "new-adr" | "lint-adr";

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

export function tempDir(prefix: string): string {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
}

export function run(
  script: ScriptName,
  args: readonly string[],
  opts: { cwd: string; skillDir?: string; input?: string },
): Run {
  const entry = path.join(opts.skillDir ?? SKILL_DIR, "scripts", `${script}.ts`);
  const res = spawnSync(process.execPath, [entry, ...args], {
    cwd: opts.cwd,
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

/** A filled-in ADR that satisfies every rule of lint-adr. */
export const GOOD_ADR = `# ADR-0004: Use PostgreSQL for the ledger

## Status

Accepted

## Context

The ledger needs multi-row transactions. The team already operates PostgreSQL for two services.

## Decision

The payments ledger is stored in PostgreSQL.

## Consequences

- Positive: the ledger gets transactions.
- Negative: one more cluster to size and back up.
- Neutral: the ledger no longer shares the document store.
`;
