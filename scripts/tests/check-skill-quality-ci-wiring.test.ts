// check-skill-quality-ci-wiring.test.ts — the CI reference and the GitHub workflow wire
// the skill linter (spec 0293 R19): Node.js 24, production install, the script
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
import { gatePaths } from "./lib/capability-path-scan.ts";
import { readWorkflowUnionText } from "./lib/workflow-union.ts";

interface Capability {
  readonly id: string;
  readonly paths?: readonly string[];
  readonly trigger: readonly { readonly on?: string; readonly paths?: readonly string[] }[];
  readonly requires?: { readonly runtime?: string | readonly string[] };
  readonly command?: readonly string[];
}

const ID = "check-skill-quality";
const SCRIPT = "scripts/check-skill-quality.ts";
const COVERED = [
  "artifacts/core/skills/pr-logbook/SKILL.md",
  "artifacts/library/skills/user-validate/references/x.md",
  "artifacts/core/shared/references/friction-reporting.md",
  SCRIPT,
  "scripts/lib/skill-quality/run.ts",
  "scripts/lib/skill-citations/grammar.ts",
  "scripts/lib/skill-evals/schema.ts",
  "scripts/lib/governance/description-length.ts",
  "scripts/lib/paths.ts",
  "scripts/lib/require-dependency.ts",
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
  const text = readWorkflowUnionText(REPO);
  const start = text.indexOf(`\n  ${ID}:\n`);
  assert.ok(start >= 0, `workflows have a '${ID}' job`);
  const next = text.slice(start + 1).search(/\n  [a-z0-9-]+:\n/);
  return text.slice(start, next < 0 ? undefined : start + 1 + next);
}

function assertJob(job: string): void {
  const inputs = ciJobInputs(job, ID);
  assert.ok(inputs, "the job is the thin ci-job call for this capability");
  assert.equal(inputs.node ?? "24", "24", "node 24 (the ci-job default)");
  assert.equal(inputs.install ?? "omit-dev", "omit-dev", "production install before the check");
  assert.equal(inputs.task ?? "true", "true", "runs task ci:<id> (the ci-job default)");
  assert.ok(gatePaths(ID).includes("artifacts/*/skills/**"), "skill sources in the filter");
  assert.ok(gatePaths(ID).includes("artifacts/core/shared/**"), "shared references in the filter");
}

describe("check-skill-quality CI wiring", () => {
  test("the capability is wired", () => assertCapability(loadCapability()));
  test("the GitHub job is wired", () => assertJob(workflowJob()));

  test("mutation: a capability without the shared references in its paths is rejected", () => {
    const cap = structuredClone(loadCapability()) as unknown as {
      paths?: string[];
      trigger: { paths?: string[] }[];
    };
    cap.paths = (cap.paths ?? []).filter((p) => p !== "artifacts/core/shared/**");
    for (const t of cap.trigger)
      if (t.paths) t.paths = t.paths.filter((p) => p !== "artifacts/core/shared/**");
    assert.throws(() => assertCapability(cap as unknown as Capability));
  });

  test("mutation: a capability on the wrong runtime is rejected", () => {
    const cap = { ...loadCapability(), requires: { runtime: "node@22" } };
    assert.throws(() => assertCapability(cap));
  });

  test("mutation: a job without the production install is rejected", () => {
    const job = workflowJob();
    const id = `id: ${ID}\n`;
    assert.ok(job.includes(id), "the mutation applies");
    assert.throws(() => assertJob(job.replace(id, `${id}          install: none\n`)));
  });
});
