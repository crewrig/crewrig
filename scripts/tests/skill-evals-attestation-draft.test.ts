// skill-evals-attestation-draft.test.ts — a stale attestation warns until the PR is ready (spec 0290 R52, R37 as modified by delta-08).
//
// Pre-push path: `ci:pre-push` hands CREWRIG_PR_DRAFT=true to the attestation task. CI path: the check
// reads that variable; the GitHub job and the GitLab capability map the PR draft state onto it.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";

import yaml from "js-yaml";

import { attestMain } from "../lib/skill-evals/attest-cli.ts";
import { taskEnv } from "../lib/ci-pre-push/run.ts";
import { writeResults } from "../lib/skill-evals/results.ts";
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

const ROOT = path.resolve(import.meta.dirname, "..", "..");

/** A repo with one changed skill, `stale` (results written, then SKILL.md edited again), and optionally `broken` (invalid). */
function staleRepo(f: (repo: Repo) => void, withInvalid = false): void {
  const repo = makeRepo();
  try {
    writeSkill(repo, "demo");
    if (withInvalid) writeSkill(repo, "broken", { "evals/evals.json": "{}" });
    commitAll(repo, "base");
    markOrigin(repo);
    fs.appendFileSync(path.join(repo.root, skillRel("demo"), "SKILL.md"), "edit\n");
    const sel = selectionOf(repo, "demo");
    writeResults(sel.skill.dirAbs, {
      skill_name: "demo",
      content_hash: sel.headHash as string,
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
      tolerance: 0.1,
      evals_passed: 2,
      evals_total: 2,
      probes_passed: 0,
      probes_total: 0,
      executor_runs: 4,
      judge_calls: 6,
      cost_usd: 0.4,
    });
    commitAll(repo, "results");
    fs.appendFileSync(path.join(repo.root, skillRel("demo"), "SKILL.md"), "later\n");
    if (withInvalid) fs.appendFileSync(path.join(repo.root, skillRel("broken"), "SKILL.md"), "x\n");
    commitAll(repo, "skill");
    f(repo);
  } finally {
    repo.cleanup();
  }
}

test("CI draft: a stale attestation warns and exits 0", () => {
  staleRepo((repo) => {
    const s = sink();
    const code = attestMain([], cleanEnv({ CREWRIG_PR_DRAFT: "true" }), repo.root, s.io);
    assert.equal(code, 0, s.out + s.err);
    assert.match(s.out, /^demo: stale: .* \[warning\]$/m);
    assert.doesNotMatch(s.out, /\[blocking\]/);
  });
});

for (const [label, extra] of [
  ["ready (false)", { CREWRIG_PR_DRAFT: "false" }],
  ["ready (empty)", { CREWRIG_PR_DRAFT: "" }],
  ["no PR context (unset)", {}],
  ["a value other than the exact string true", { CREWRIG_PR_DRAFT: "TRUE" }],
] as const) {
  test(`CI ${label}: a stale attestation blocks`, () => {
    staleRepo((repo) => {
      const s = sink();
      assert.equal(attestMain([], cleanEnv({ ...extra }), repo.root, s.io), 1);
      assert.match(s.out, /^demo: stale: .* \[blocking\]$/m);
    });
  });
}

test("CI draft: invalid still blocks, and a mixed run names only the invalid skill as blocking", () => {
  staleRepo((repo) => {
    const s = sink();
    assert.equal(attestMain([], cleanEnv({ CREWRIG_PR_DRAFT: "true" }), repo.root, s.io), 1);
    assert.match(s.out, /^broken: invalid: .* \[blocking\]$/m);
    assert.match(s.out, /^demo: stale: .* \[warning\]$/m);
  }, true);
});

test("pre-push: ci:pre-push hands the draft signal to the attestation task only (and lint-specs)", () => {
  const opts = { cwd: "/repo", env: { PATH: "/usr/bin", CREWRIG_PR_DRAFT: "true" }, baseRef: "origin/main" };
  assert.equal(taskEnv("skill-evals-attestation", opts)["CREWRIG_PR_DRAFT"], "true");
  assert.equal(taskEnv("lint-specs", opts)["CREWRIG_PR_DRAFT"], "true");
  assert.equal(taskEnv("lint-markdown", opts)["CREWRIG_PR_DRAFT"], undefined);
  assert.equal(
    taskEnv("skill-evals-attestation", { ...opts, env: { PATH: "/usr/bin" } })["CREWRIG_PR_DRAFT"],
    "true",
  );
});

test("CI wiring: the GitHub job and the GitLab capability map the PR draft state", () => {
  const wf = yaml.load(
    fs.readFileSync(path.join(ROOT, ".github/workflows/_ci-integration.yml"), "utf8"),
  ) as { jobs: Record<string, { env?: Record<string, string> }> };
  assert.match(
    wf.jobs["skill-evals-attestation"]?.env?.["CREWRIG_PR_DRAFT"] ?? "",
    /github\.event\.pull_request\.draft && 'true' \|\| ''/,
  );
  const gate = yaml.load(
    fs.readFileSync(path.join(ROOT, ".github/workflows/_ci-gate.yml"), "utf8"),
  ) as { jobs: Record<string, { env?: Record<string, string> }> };
  assert.equal(
    wf.jobs["skill-evals-attestation"]?.env?.["CREWRIG_PR_DRAFT"],
    gate.jobs["lint-specs"]?.env?.["CREWRIG_PR_DRAFT"],
    "same mapping as spec 0168 delta-01",
  );
  const caps = yaml.load(
    fs.readFileSync(path.join(ROOT, "ci/ci-capabilities.yml"), "utf8"),
  ) as { capabilities?: Array<{ id: string; env?: Record<string, string> }> } | Array<{ id: string; env?: Record<string, string> }>;
  const list = Array.isArray(caps) ? caps : (caps.capabilities ?? []);
  assert.equal(
    list.find((c) => c.id === "skill-evals-attestation")?.env?.["CREWRIG_PR_DRAFT"],
    "$CI_MERGE_REQUEST_DRAFT",
  );
});
