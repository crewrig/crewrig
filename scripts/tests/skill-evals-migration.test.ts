// skill-evals-migration.test.ts — the existing schema-1 results files (spec 0304 R26, R13, R31):
// valid while their skill is not selected, `stale` once its hashed content changes, never rewritten
// by the implementation, and the implementation stales no skill of the repository. Offline.

/* oxlint-disable typescript/no-unsafe-assignment, typescript/no-unsafe-member-access, typescript/no-unsafe-call, typescript/no-unsafe-argument, typescript/no-unsafe-return -- results files are read back as untyped JSON */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { attestMain } from "../lib/skill-evals/attest-cli.ts";
import { attestSelection } from "../lib/skill-evals/attest.ts";
import { listSkills, selectChanged } from "../lib/skill-evals/select.ts";
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
import type { Repo } from "./lib/skill-evals-fixtures.ts";
import { writeRaw } from "./lib/skill-evals-record.ts";

const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..");
const NINE = [
  "architect",
  "developer",
  "doc-writer",
  "pr-logbook",
  "pr-reviewer",
  "spec-author",
  "tester",
  "github-actions",
  "gitlab-ci",
];

const v1 = (hash: string) => ({
  skill_name: "demo",
  content_hash: hash,
  runner_version: "2.0.0",
  executor_model: "m",
  judge_model: "j",
  date: "2026-01-01T00:00:00.000Z",
  status: "pass",
  effort: "medium",
  eval_pass_rate: 1,
  probe_pass_rate: null,
  base_eval_pass_rate: null,
  threshold: 0.8,
  tolerance: 0.05,
  evals_passed: 6,
  evals_total: 6,
  probes_passed: 0,
  probes_total: 0,
  executor_runs: 6,
  judge_calls: 6,
  cost_usd: 1,
});

/** A repo whose `demo` carries a committed schema-1 file for its content on main. */
function legacy(f: (repo: Repo, dir: string) => void): void {
  const repo = makeRepo();
  try {
    writeSkill(repo, "demo");
    commitAll(repo, "skill");
    const dir = path.join(repo.root, skillRel("demo"));
    writeRaw(dir, v1(selectionOf(repo, "demo").headHash as string));
    commitAll(repo, "legacy results");
    markOrigin(repo);
    f(repo, dir);
  } finally {
    repo.cleanup();
  }
}

test("a schema-1 file stays valid while the hashed content is unchanged: the skill is not selected and the file is not read", () => {
  legacy((repo, dir) => {
    fs.appendFileSync(
      path.join(dir, "evals", "files", "in.txt"),
      "a fixture edit alone selects nothing\n",
    );
    writeRaw(dir, "{ this file is never read");
    commitAll(repo, "unhashed changes only");
    const sel = selectChanged(repo.root, "origin/main");
    assert.ok("selections" in sel);
    assert.deepEqual(
      sel.selections.map((s) => s.skill.name),
      [],
    );
    const s = sink();
    assert.equal(attestMain([], cleanEnv(), repo.root, s.io), 0, s.out + s.err);
    assert.match(s.out, /nothing to check/);
  });
});

test("once the hashed content changes, the schema-1 file is stale with the migration reason, and blocks", () => {
  legacy((repo, dir) => {
    fs.appendFileSync(path.join(dir, "SKILL.md"), "a content change\n");
    commitAll(repo, "change the skill");
    const o = attestSelection(selectionOf(repo, "demo"));
    assert.equal(o.status, "stale");
    assert.equal(o.reason, "schema 1: re-measure under the sampling plan");
    assert.equal(o.blocking, true, "stale has no setting to relax it");
    const s = sink();
    assert.equal(attestMain([], cleanEnv(), repo.root, s.io), 1);
    assert.match(s.out, /demo: stale: schema 1: re-measure under the sampling plan \[blocking\]/);
  });
});

test("a schema-1 file whose recorded hash is the current one is still stale for a selected skill (v1-F4)", () => {
  legacy((repo, dir) => {
    fs.appendFileSync(path.join(dir, "SKILL.md"), "a content change\n");
    commitAll(repo, "change the skill");
    writeRaw(dir, v1(selectionOf(repo, "demo").headHash as string));
    const o = attestSelection(selectionOf(repo, "demo"));
    assert.equal(o.status, "stale");
    assert.match(o.reason, /schema 1/);
  });
});

test("the implementation rewrites no schema-1 file and changes no hashed path: no skill of the repository is staled", () => {
  const refs = ["origin/main", "crewrig/main", "main"];
  const base = refs.find((r) => {
    try {
      execFileSync("git", ["rev-parse", "--verify", "--quiet", r], {
        cwd: REPO_ROOT,
        stdio: "ignore",
      });
      return true;
    } catch {
      return false;
    }
  });
  assert.ok(base !== undefined, `none of ${refs.join(", ")} resolves`);
  const changed = execFileSync(
    "git",
    ["diff", "--name-only", `${base}...HEAD`, "--", "artifacts/"],
    {
      cwd: REPO_ROOT,
      encoding: "utf8",
    },
  ).trim();
  assert.equal(changed, "", "this change touches nothing under artifacts/");
});

test("the nine attested skills hold a schema-1 file (no schema_version key) that names them", () => {
  const present = new Map(listSkills(REPO_ROOT).map((s) => [s.name, s]));
  for (const name of NINE) {
    const skill = present.get(name);
    assert.ok(skill, `${name} exists`);
    const file = path.join(skill.dirAbs, "evals", "results.json");
    assert.ok(fs.existsSync(file), `${name} has results.json`);
    const doc = JSON.parse(fs.readFileSync(file, "utf8"));
    assert.equal("schema_version" in doc, false, `${name} is still schema 1`);
    assert.equal(doc.skill_name, name);
    assert.equal(typeof doc.evals_passed, "number");
  }
});
