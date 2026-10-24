// check-description-length-ci-wiring.test.ts — the CI reference and the GitHub workflow wire
// the description-length check (spec 0269 R11): Node.js 24, production install, the script
// itself, and a path filter that covers the sources and every compiled output tree.
//
// Assertions are functions over parsed data so the mutation tests run the same functions on
// in-memory mutated copies. Paths are decided by the repo glob engine.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";

import { globToRegExp } from "../lib/glob-engine.ts";
import { REPO } from "./lib/build-fixture-tree.ts";
import {
  ciJobInputs,
  ciTaskDelegatedCommands,
  effectivePaths,
  resolveCapabilityCommands,
} from "./lib/ci-task-commands.ts";
import { yamlLib } from "./lib/yaml-lib.ts";

interface Capability {
  readonly id: string;
  readonly paths?: readonly string[];
  readonly trigger: readonly { readonly on?: string; readonly paths?: readonly string[] }[];
  readonly requires?: { readonly runtime?: string | readonly string[] };
  readonly command?: readonly string[];
}

const ID = "check-description-length";
const SCRIPT = "scripts/check-description-length.ts";
const COVERED = [
  "artifacts/core/skills/spec-author/SKILL.md",
  ".claude/skills/spec-author/SKILL.md",
  ".claude/agents/spec-author.md",
  ".gemini/skills/spec-author/SKILL.md",
  ".gemini/agents/spec-author.md",
  ".github/skills/spec-author/SKILL.md",
  ".github/agents/spec-author.md",
  ".agents/skills/spec-author/SKILL.md",
  ".agents/agents/spec-author/AGENT.md",
  SCRIPT,
];

function loadCapability(): Capability {
  const text = fs.readFileSync(path.join(REPO, "ci", "ci-capabilities.yml"), "utf8");
  const caps = (yamlLib.load(text) as { capabilities?: Capability[] }).capabilities ?? [];
  const cap = caps.find((c) => c.id === ID);
  assert.ok(cap, `ci/ci-capabilities.yml has a capability '${ID}'`);
  return cap;
}

function assertCapability(cap: Capability): void {
  const runtime = cap.requires?.runtime;
  assert.equal(runtime, "node@24", "runs on node@24");
  assert.ok(
    [...resolveCapabilityCommands(cap.command), ...ciTaskDelegatedCommands(ID)].some((c) =>
      c.includes(SCRIPT),
    ),
    "the capability's task runs the script",
  );
  for (const on of ["pull-request", "push"]) {
    const trig = cap.trigger.find((t) => t.on === on);
    assert.ok(trig, `trigger ${on}`);
    const globs = effectivePaths(cap, trig);
    for (const file of COVERED) {
      assert.ok(
        globs.some((g) => globToRegExp(g).test(file)),
        `${on} paths select ${file}`,
      );
    }
    for (const glob of globs) {
      assert.ok(
        fs.globSync(glob, { cwd: REPO }).length > 0 || glob.includes("*") === false,
        `glob ${glob} matches a real path`,
      );
    }
  }
}

function workflowJob(): string {
  const text = fs.readFileSync(path.join(REPO, ".github", "workflows", "build.yml"), "utf8");
  const start = text.indexOf(`\n  ${ID}:\n`);
  assert.ok(start >= 0, `build.yml has a '${ID}' job`);
  const next = text.slice(start + 1).search(/\n  [a-z0-9-]+:\n/);
  return text.slice(start, next < 0 ? undefined : start + 1 + next);
}

function assertJob(job: string): void {
  const inputs = ciJobInputs(job, ID);
  assert.ok(inputs, "the job is the thin ci-job call for this capability");
  assert.equal(inputs.node ?? "24", "24", "node 24 (the ci-job default)");
  assert.equal(inputs.install, "omit-dev", "production install before the check");
  assert.equal(inputs.task ?? "true", "true", "runs task ci:<id> (the ci-job default)");
  for (const dir of [".claude", ".gemini", ".github", ".agents"]) {
    assert.ok(job.includes(`'${dir}/skills/**'`), `${dir}/skills in the filter`);
    assert.ok(job.includes(`'${dir}/agents/**'`), `${dir}/agents in the filter`);
  }
  assert.ok(job.includes("'artifacts/**'"));
}

describe("check-description-length CI wiring", () => {
  test("the capability is wired", () => assertCapability(loadCapability()));
  test("the GitHub job is wired", () => assertJob(workflowJob()));

  test("mutation: a capability without a compiled tree in its paths is rejected", () => {
    const cap = structuredClone(loadCapability()) as unknown as {
      paths?: string[];
      trigger: { paths?: string[] }[];
    };
    cap.paths = (cap.paths ?? []).filter((p) => p !== ".gemini/agents/**");
    for (const t of cap.trigger)
      if (t.paths) t.paths = t.paths.filter((p) => p !== ".gemini/agents/**");
    assert.throws(() => assertCapability(cap as unknown as Capability));
  });

  test("mutation: a capability on the wrong runtime is rejected", () => {
    const cap = { ...loadCapability(), requires: { runtime: "node@22" } };
    assert.throws(() => assertCapability(cap));
  });

  test("mutation: a job without the production install is rejected", () => {
    assert.throws(() => assertJob(workflowJob().replace("install: omit-dev", "install: none")));
  });
});
