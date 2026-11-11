// skill-evals-audit-attest.test.ts — traceability gap-fillers, second half (spec 0290 + delta-01).
//
// The exec-bit stale scenario (R35, R37), the --changed / attestation selection equality (R34) and the
// documentation contract (R19, R26, R38). No key, no network, no model call.

/* oxlint-disable typescript/no-unsafe-assignment, typescript/no-unsafe-member-access, typescript/no-unsafe-call, typescript/no-unsafe-argument, typescript/no-unsafe-return -- the runner output files are read back as untyped JSON */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { attestMain } from "../lib/skill-evals/attest-cli.ts";
import { attestSelection } from "../lib/skill-evals/attest.ts";
import { writeResults } from "../lib/skill-evals/results.ts";
import type { ResultsRecord } from "../lib/skill-evals/results.ts";
import { selectChanged } from "../lib/skill-evals/select.ts";
import {
  cleanEnv,
  commitAll,
  makeRepo,
  markOrigin,
  selectionOf,
  sink,
  skillRel,
  writeSkill,
} from "./lib/skill-evals-fixtures.ts";

const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..");

// ------------------------------------------------------------------- R35, R37 (exec bit), R34

const record = (sel: ReturnType<typeof selectionOf>): ResultsRecord => ({
  skill_name: sel.skill.name,
  content_hash: sel.headHash as string,
  runner_version: "1.0.0",
  executor_model: "m",
  judge_model: "j",
  date: "2026-01-01T00:00:00.000Z",
  status: "pass",
  benchmark: {
    with_skill_mean: 1,
    without_skill_mean: 0.5,
    base_mean: null,
    delta_value: 0.5,
    tolerance: 0.05,
  },
  executor_runs: 4,
  judge_calls: 6,
  cost_usd: 0.4,
});

test("the executable bit makes a results file stale: index mode toggled, bytes untouched (scenario: exec bit through the index)", () => {
  const repo = makeRepo();
  try {
    writeSkill(repo, "demo");
    commitAll(repo, "base");
    markOrigin(repo);
    fs.appendFileSync(path.join(repo.root, skillRel("demo"), "SKILL.md"), "edit\n");
    commitAll(repo, "edit");
    const before = selectionOf(repo, "demo");
    writeResults(before.skill.dirAbs, record(before));
    repo.git("add", "-A");
    assert.equal(attestSelection(selectionOf(repo, "demo")).status, "pass");
    repo.git("update-index", "--chmod=-x", `${skillRel("demo")}/scripts/run.sh`);
    const after = selectionOf(repo, "demo");
    assert.notEqual(after.headHash, before.headHash);
    assert.equal(attestSelection(after).status, "stale");
    const s = sink();
    assert.equal(attestMain([], cleanEnv(), repo.root, s.io), 1);
    assert.match(s.out, /demo: stale/);
  } finally {
    repo.cleanup();
  }
});

test("the set `--changed` selects equals the set the attestation check examines for the same base (R34)", () => {
  const repo = makeRepo();
  try {
    for (const n of ["alpha", "beta", "gamma", "delta"]) writeSkill(repo, n);
    commitAll(repo, "base");
    markOrigin(repo);
    fs.appendFileSync(path.join(repo.root, skillRel("alpha"), "references", "ref.md"), "more\n");
    fs.writeFileSync(path.join(repo.root, skillRel("beta"), "evals", "results.json"), "{}\n");
    fs.appendFileSync(path.join(repo.root, skillRel("gamma"), "scripts", "run.sh"), "echo x\n");
    writeSkill(repo, "epsilon");
    commitAll(repo, "changes");
    const picked = selectChanged(repo.root, "origin/main");
    assert.ok("selections" in picked);
    const names = picked.selections.map((s) => s.skill.name).sort();
    assert.deepEqual(names, ["alpha", "epsilon", "gamma"]);
    const s = sink();
    attestMain([], cleanEnv(), repo.root, s.io);
    const examined = [...s.out.matchAll(/^(\w+): /gm)].map((m) => m[1]).sort();
    assert.deepEqual(examined, names);
  } finally {
    repo.cleanup();
  }
});

// ---------------------------------------------------------------------- documentation contract

test("docs/skill-evals.md documents every declared setting, the provisional calibration, the trust model and the Claude Code scope (R19, R23, R26, R38)", () => {
  const doc = fs.readFileSync(path.join(REPO_ROOT, "docs", "skill-evals.md"), "utf8");
  const settings = fs.readFileSync(
    path.join(REPO_ROOT, "scripts", "lib", "skill-evals", "settings.ts"),
    "utf8",
  );
  const names = [...settings.matchAll(/^export const ([A-Z_]+)\s*=/gm)].map((m) => m[1] as string);
  assert.ok(names.length >= 15);
  const undocumented = names.filter(
    (n) =>
      ![
        "RUNNER_VERSION",
        "EVIDENCE_MIN_CHARS",
        "JUDGE_MAX_TOKENS",
        "JUDGE_RETRY_ALLOWANCE",
        "JUDGE_QUORUM",
        "EXECUTOR_TOOLS",
        "DEFAULT_OUT_DIR",
        "JUDGE_MODEL",
        "TOKEN_VAR",
        "API_KEY_VAR",
      ].includes(n) && !doc.includes(n),
  );
  assert.deepEqual(undocumented, [], "every spec-declared setting appears in the documentation");
  for (const needle of [
    /regression-blocking|REGRESSION_BLOCKING/,
    /missing-evals-blocking|MISSING_EVALS_BLOCKING/,
    /#1852/,
    /provisional/i,
    /pr-logbook/,
    /Trust model/,
    /forgeable/,
    /Claude Code only/,
    /`claude`/,
    /docs\/cli-matrix\/rows/,
  ])
    assert.match(doc, needle);
});
