// skill-scripts-yaml-leg.test.ts — the two legs of `pr-reviewer/lint-skill` (spec 0258 plan step
// 5). The YAML leg (`yq` on the PATH) runs live in skill-scripts-oracle.test.ts wherever `yq` is on
// the host and is skipped with a named reason elsewhere; the LINE-FALLBACK leg (no `yq`) must run
// everywhere the subject runs, so this suite FAILS, never skips, when that leg is absent: no case, no
// golden, a case that links `yq` in, or a fallback run that does not show the fallback note.

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { LINT_SKILL } from "./lib/skill-scripts-cases-reviewer-skill.ts";
import { readGolden } from "./lib/skill-scripts-golden.ts";
import { observe, shellAvailable } from "./lib/skill-scripts-observe.ts";

const fallback = LINT_SKILL.filter((c) => c.name.startsWith("fallback-"));
const yaml = LINT_SKILL.filter((c) => c.name.startsWith("yaml-"));
const MIN_FALLBACK = 40;

describe("pr-reviewer/lint-skill: the two legs", () => {
  test("the line-fallback leg is present and never links yq in", () => {
    assert.ok(fallback.length >= MIN_FALLBACK, `only ${fallback.length} fallback cases`);
    for (const c of fallback)
      assert.ok(c.tools?.includes("yq") !== true, `${c.name} links yq in a fallback case`);
    assert.equal(fallback.length + yaml.length, LINT_SKILL.length, "a case belongs to no leg");
  });

  test("every fallback case has a golden stored", () => {
    for (const c of fallback) assert.notEqual(readGolden(c).size, 0, `${c.name}: no golden`);
  });

  test("the YAML leg is present and links yq in", () => {
    assert.ok(yaml.length > 0, "no YAML-leg case");
    for (const c of yaml) assert.ok(c.tools?.includes("yq") === true, `${c.name}: no yq linked`);
  });

  test("a fallback run announces the fallback exactly once", (t) => {
    const one = fallback.find((c) => c.name === "fallback-note-printed-once");
    assert.ok(one !== undefined, "fallback-note-printed-once is missing");
    // after the switch the entry is the subject; while the `.sh` exists it runs on Linux only
    const shell = shellAvailable(one.script);
    if (shell && process.platform !== "linux")
      return t.skip("skipped: the shell leg needs a Linux host (GNU grep, awk, sed)");
    const obs = observe(one, shell ? "shell" : "entry");
    // the observation is latin1: encode the note's em dash the same way; the script name is normalised
    const text = shell
      ? "lint-skill: yq not found — using grep fallback for required keys."
      : "lint-skill: js-yaml not found — using line fallback for the required keys and the version; run it from a CrewRig checkout after setup for the full check.";
    const note = Buffer.from(text, "utf8").toString("latin1");
    assert.equal(obs.stdout.split(note).length - 1, 1, obs.stdout);
  });
});
