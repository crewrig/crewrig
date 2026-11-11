// skill-evals-no-model-ci.test.ts — no CI job of the skill evals makes a model call or holds a
// credential (spec 0290 R17, R18, R39, R25).

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { load } from "js-yaml";

import { REPO } from "./lib/build-fixture-tree.ts";

interface Capability {
  id: string;
  trigger?: { on: string }[];
  paths?: string[];
  env?: Record<string, string>;
  command?: string[];
  requires?: Record<string, unknown>;
  portability?: string;
  "changeset-gated"?: boolean;
  secrets?: unknown;
}

const caps = (
  load(fs.readFileSync(path.join(REPO, "ci", "ci-capabilities.yml"), "utf8")) as {
    capabilities: Capability[];
  }
).capabilities;
const byId = (id: string): Capability => {
  const c = caps.find((x) => x.id === id);
  assert.ok(c, `capability ${id} exists`);
  return c;
};

test("skill-evals-attestation: pull-request only, full history, no secret, only BASE_REF in env, command task ci:skill-evals-attestation", () => {
  const c = byId("skill-evals-attestation");
  assert.deepEqual(
    c.trigger?.map((t) => t.on),
    ["pull-request"],
  );
  assert.equal(c.paths, undefined, "unfiltered: the check selects changed skills itself");
  assert.equal(c.requires?.["history-depth"], "full");
  assert.deepEqual(Object.keys(c.env ?? {}), ["BASE_REF"]);
  assert.deepEqual(c.command, ["task ci:skill-evals-attestation"]);
  assert.equal(c.portability, "portable");
  assert.equal("secrets" in c, false);
});

test("skill-evals-tests: the runner's own suites, changeset-gated, no secret, no env", () => {
  const c = byId("skill-evals-tests");
  assert.deepEqual(c.command, ["task ci:skill-evals-tests"]);
  assert.equal(c["changeset-gated"], true);
  assert.ok(c.paths?.includes("scripts/lib/skill-evals/**"));
  assert.equal(c.env, undefined);
});

test("no capability, workflow or task of the skill evals names a model credential or secret", () => {
  const ci = fs.readFileSync(
    path.join(REPO, ".github", "workflows", "_ci-integration.yml"),
    "utf8",
  );
  assert.equal(ci.includes("secrets."), false, "_ci-integration.yml holds no secret");
  const tasks = fs.readFileSync(path.join(REPO, "taskfiles", "ci", "integration.yml"), "utf8");
  for (const name of ["skill-evals-attestation", "skill-evals-tests"]) {
    const block =
      new RegExp(`^  ${name}:\\n([\\s\\S]*?)(?=^  \\S|(?![\\s\\S]))`, "m").exec(tasks)?.[1] ?? "";
    assert.ok(block.length > 0, `${name} task exists`);
    for (const forbidden of [
      "CLAUDE_CODE_OAUTH_TOKEN",
      "ANTHROPIC_API_KEY",
      "ANTHROPIC_EXECUTOR_API_KEY",
      "SKILL_EVALS_PR_NUMBER",
      "SKILL_EVALS_REPO",
    ])
      assert.equal(block.includes(forbidden), false, `${name} mentions ${forbidden}`);
  }
  assert.equal(
    JSON.stringify(caps.filter((c) => c.id.startsWith("skill-evals"))).includes("secret"),
    false,
  );
});

test("the attestation check runs and exits 0 with every credential variable unset", async () => {
  const { spawnSync } = await import("node:child_process");
  const r = spawnSync(
    process.execPath,
    [
      "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON",
      path.join(REPO, "scripts", "skill-evals-attestation.ts"),
      "HEAD",
    ],
    {
      cwd: REPO,
      encoding: "utf8",
      env: { PATH: process.env["PATH"] ?? "", HOME: process.env["HOME"] ?? "" },
    },
  );
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /nothing to check/);
});

test("no scheduled or push-to-branch run of the evals exists: the attestation is pull-request only, the runner suites never schedule", () => {
  assert.deepEqual(
    byId("skill-evals-attestation").trigger?.map((t) => t.on),
    ["pull-request"],
  );
  const kinds = byId("skill-evals-tests").trigger?.map((t) => t.on) ?? [];
  assert.equal(kinds.includes("schedule") || kinds.includes("scheduled"), false);
  assert.equal(
    caps.some((c) =>
      c.command?.some((cmd) => /scripts\/skill-evals\.ts|task skill-evals(\s|$)/.test(cmd)),
    ),
    false,
    "no capability runs the evals",
  );
});
