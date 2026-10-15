// skill-scripts-layouts.test.ts — the eleven skill-script entries run unchanged under any package
// layout (spec 0258 R2). Each entry's single `.ts` file is copied ALONE into a directory holding
// a `package.json` of type module, of type commonjs, a typeless one, or none; three simple cases
// of the oracle registry (a usage error, a missing path, a trivial success) run from each copy,
// and status, stdout and stderr must be identical across the four layouts and carry no Node
// warning (a module-type reparse would print one).

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { SCRIPTS } from "./lib/skill-scripts-cases.ts";
import { LAYOUT_PACKAGE, observe } from "./lib/skill-scripts-observe.ts";
import type { Layout } from "./lib/skill-scripts-observe.ts";

/** Per script: the usage-error, missing-path and trivial-success cases of its table. */
const PICKS: Readonly<Record<string, readonly string[]>> = {
  "github-actions/check-pinned-actions": ["no-argument", "missing-path", "single-file-pinned"],
  "github-actions/check-secrets-exposure": ["no-argument", "missing-path", "clean-file"],
  "github-actions/lint-workflow": ["no-argument-with-actionlint", "missing-target", "file-passes"],
  "github-actions/simulate-job": ["no-argument", "workflow-missing", "act-passthrough-streams"],
  "github-actions/simulate-workflow": [
    "no-argument",
    "workflow-missing",
    "act-passthrough-streams",
  ],
  "gitlab-ci/check-pinned-images": ["no-argument", "missing-path", "single-file-pinned"],
  "gitlab-ci/check-secrets-exposure": ["no-argument", "missing-path", "single-file-clean"],
  "pr-reviewer/lint-json": ["invalid-missing-value", "missing-file", "valid"],
  "pr-reviewer/lint-markdown": ["no-files", "tool-absent-no-file-check", "pass-silent"],
  "pr-reviewer/lint-python": ["no-files", "missing-file-no-linter", "ruff-pass"],
  "pr-reviewer/lint-skill": ["fallback-no-files", "fallback-missing-file", "fallback-complete"],
};

const LAYOUTS = Object.keys(LAYOUT_PACKAGE) as Layout[];

describe("skill-script entries: package layouts", () => {
  test("the picks cover the eleven entries of the registry", () => {
    assert.deepEqual(Object.keys(PICKS).sort(), SCRIPTS.map((s) => s.script).sort());
    assert.equal(SCRIPTS.length, 11);
    assert.deepEqual(LAYOUTS, ["module", "commonjs", "typeless", "none"]);
  });

  for (const { script, cases } of SCRIPTS) {
    for (const name of PICKS[script] ?? []) {
      test(`${script}: ${name}`, (t) => {
        if (process.platform === "win32")
          return t.skip("skipped: the case stubs are POSIX shell scripts");
        const testCase = cases.find((c) => c.name === name);
        assert.ok(testCase !== undefined, `${script}: no case ${name}`);
        const [first, ...rest] = LAYOUTS.map((layout) => observe(testCase, "entry", layout));
        assert.ok(first !== undefined);
        assert.doesNotMatch(
          first.stderr,
          /Warning|ERR_|Cannot find module/,
          "stderr has a warning",
        );
        for (const [i, other] of rest.entries()) {
          const layout = LAYOUTS[i + 1];
          assert.deepEqual(
            [other.status, other.stdout, other.stderr],
            [first.status, first.stdout, first.stderr],
            `${script}/${name}: layout ${layout} differs from ${LAYOUTS[0]}`,
          );
        }
      });
    }
  }
});
