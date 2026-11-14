// skill-evals-six.ts — a repository whose skill `demo` carries 6 evals and one probe, the shape the
// plan figures of spec 0304 are written for (12 runs at stage 1, 24 at stage 2), with an optional
// committed base results file at the merge-base. Shared by the attestation, regression, measure and
// migration suites.

import fs from "node:fs";
import path from "node:path";

import {
  commitAll,
  makeRepo,
  markOrigin,
  selectionOf,
  skillRel,
  writeSkill,
} from "./skill-evals-fixtures.ts";
import type { Repo } from "./skill-evals-fixtures.ts";
import { buildRecord, entryOf, readRecord, writeRecord, writeRaw } from "./skill-evals-record.ts";
import type { LedgerEntry } from "../../lib/skill-evals/ledger.ts";
import type { RecordOptions } from "./skill-evals-record.ts";
import { evalsWith } from "./skill-evals-run-rig.ts";

export interface SixRig {
  readonly repo: Repo;
  readonly dir: string;
  sel(): ReturnType<typeof selectionOf>;
  /** The ledger a head file must carry: the merge-base file's own measurement (none for a schema-1 or absent base). */
  readonly mbLedger: LedgerEntry[];
  /** A head record: a later `declared_at`, the merge-base entry in its ledger, then `over`. */
  head(over?: RecordOptions): ReturnType<typeof buildRecord>;
  cleanup(): void;
}

/**
 * A repo with `demo` (n evals) on main. `base` is committed as the merge-base results file: a
 * record (schema 2) built with the given options, a raw schema-1 object, or raw text. Then
 * SKILL.md is edited and committed on the branch.
 */
export function sixRig(
  opts: {
    evals?: number;
    base?: RecordOptions | { raw: unknown };
    edit?: boolean;
  } = {},
): SixRig {
  const repo = makeRepo();
  const n = opts.evals ?? 6;
  writeSkill(repo, "demo", { "evals/evals.json": evalsWith("demo", n) });
  commitAll(repo, "skill");
  const dir = path.join(repo.root, skillRel("demo"));
  if (opts.base !== undefined) {
    if ("raw" in opts.base) writeRaw(dir, opts.base.raw);
    else writeRecord(dir, buildRecord(selectionOf(repo, "demo"), opts.base));
    commitAll(repo, "base results");
  }
  markOrigin(repo);
  if (opts.edit !== false) fs.appendFileSync(path.join(dir, "SKILL.md"), "edit\n");
  commitAll(repo, "edit");
  let mbLedger: LedgerEntry[] = [];
  if (opts.base !== undefined && !("raw" in opts.base)) mbLedger = [entryOf(readRecord(dir))];
  return {
    repo,
    dir,
    mbLedger,
    head: (over = {}) =>
      buildRecord(selectionOf(repo, "demo"), {
        declaredAt: "2026-02-01T00:00:00.000Z",
        ledger: mbLedger,
        ...over,
      }),
    sel: () => selectionOf(repo, "demo"),
    cleanup: () => repo.cleanup(),
  };
}
