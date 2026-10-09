// build-components-hardening-yaml-e2e.test.ts — the effects of requirement 34 of spec 0250 delta 01
// through the entry, in a fixture tree: a refused organisation mapping reads as empty and silent
// (the core mapping alone is in force, the build output is the build with no organisation mapping),
// and a refused component frontmatter skips that one source with the missing-name warning while
// the others build. A build that expanded the aliases ran out of heap, so a status of 0 is the
// signal; the unit suite is build-components-hardening-yaml.test.ts.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";

import {
  aliasBomb,
  createSandbox,
  namedSource,
} from "./fixtures/build-components/hardening-kit.ts";
import type { Sandbox } from "./fixtures/build-components/hardening-kit.ts";
import { createFixtureTree } from "./lib/build-fixture-tree.ts";
import type { RunResult } from "./lib/build-fixture-tree.ts";

const tree = createFixtureTree();
/** Printed paths are native on win32 (spec 0250 R33(d)); the Windows proof is scripts/tests/lib/windows-build-proof.ts. */
const SKIP =
  process.platform === "win32" ? "skipped: printed paths use the native separator" : false;
const AGENT = [
  "---",
  "name: probe-agent",
  'description: "An agent."',
  "metadata:",
  "  model:",
  "    intelligence: high",
  "---",
  "Agent body.",
  "",
].join("\n");
/** The 8-level, 10-wide bomb of the review, declared as a replacing organisation mapping. */
const BOMB_MAPPING = `replaces-core: true\n${aliasBomb(8, 10).join("\n")}\n`;

/** A sandbox holding one profiled core agent and the real mappings, plus `org` for claude. */
function sandbox(org: string | null): Sandbox {
  const box = createSandbox(tree);
  box.seedMappings();
  box.write("artifacts/core/agents/probe-agent/AGENT.md", AGENT);
  if (org !== null) box.write("model-mappings/claude.org.yml", org);
  return box;
}

/** A run's streams with the sandbox path removed, so two sandboxes compare. */
const portable = (box: Sandbox, run: RunResult): [number | null, string, string] => [
  run.status,
  run.stdout.replaceAll(box.repo, "<REPO>"),
  run.stderr.replaceAll(box.repo, "<REPO>"),
];

describe("R34 a refused organisation mapping declares nothing", { skip: SKIP }, () => {
  test("a build continues on the core mapping, as if there were no organisation mapping", () => {
    const bomb = sandbox(BOMB_MAPPING);
    const none = sandbox(null);
    const refused = bomb.run(["--target", "claude", "--tier", "core"]);
    const baseline = none.run(["--target", "claude", "--tier", "core"]);
    assert.equal(refused.status, 0, refused.stderr);
    assert.deepEqual(portable(bomb, refused), portable(none, baseline));
    assert.deepEqual(
      bomb.inside().filter((f) => f.startsWith(".claude/")),
      [".claude/agents/probe-agent.md"],
    );
    for (const file of bomb.inside().filter((f) => f.startsWith(".claude/"))) {
      assert.equal(
        fs.readFileSync(path.join(bomb.repo, file), "utf8"),
        fs.readFileSync(path.join(none.repo, file), "utf8"),
        file,
      );
    }
  });

  test("no merge-unavailable note, no mapping-merge line, and no temporary root left", () => {
    const bomb = sandbox(BOMB_MAPPING);
    const run = bomb.run(["--target", "claude", "--tier", "core"]);
    assert.equal(run.status, 0, run.stderr);
    assert.doesNotMatch(run.stderr + run.stdout, /merge-unavailable|mapping-merge|Error/);
    assert.deepEqual(bomb.leftovers(), []);
  });

  test("--resolve answers from the core mapping alone, as without the organisation mapping", () => {
    const bomb = sandbox(BOMB_MAPPING);
    const none = sandbox(null);
    const args = (box: Sandbox): string[] => [
      "--resolve",
      path.join(box.repo, "artifacts/core/agents/probe-agent/AGENT.md"),
      "claude",
    ];
    const refused = bomb.run(args(bomb));
    assert.equal(refused.status, 0, refused.stderr);
    assert.deepEqual(portable(bomb, refused), portable(none, none.run(args(none))));
    assert.match(refused.stdout, /\S/, "an offering is resolved from the core mapping");
  });

  test("--check against the same tree is as quiet as the build was", () => {
    const bomb = sandbox(BOMB_MAPPING);
    assert.equal(bomb.run(["--target", "claude", "--tier", "core"]).status, 0);
    const check = bomb.run(["--target", "claude", "--tier", "core", "--check"]);
    assert.equal(check.status, 0, check.stdout + check.stderr);
    assert.match(check.stdout, /OK: All generated files match source/);
  });
});

describe("R34 a refused frontmatter skips one source", { skip: SKIP }, () => {
  const SKILL_BOMB = namedSource("bomb", aliasBomb(8, 10));

  for (const tier of ["core", "overlay"]) {
    test(`tier ${tier}: the warning names the source, the other skill is built, status 0`, () => {
      const box = createSandbox(tree);
      box.write(`artifacts/${tier}/skills/bomb/SKILL.md`, SKILL_BOMB);
      box.write(`artifacts/${tier}/skills/fine/SKILL.md`, namedSource("fine"));
      const run = box.run(["--target", "claude"]);
      assert.equal(run.status, 0, run.stderr);
      const source = `${box.repo}/artifacts/${tier}/skills/bomb//SKILL.md`;
      assert.ok(
        run.stdout.split("\n").includes(`Warning: ${source} missing 'name' field, skipping`),
        run.stdout,
      );
      assert.match(run.stdout, /^Building skill: fine$/m);
      assert.doesNotMatch(run.stdout, /Building skill: bomb/);
      const written = box.inside().filter((f) => f.includes(".claude/skills/"));
      assert.deepEqual(
        written.map((f) => f.split("/").slice(-2, -1)[0]),
        ["fine"],
      );
      assert.equal(run.stderr.includes("Error"), false);
    });
  }
});
