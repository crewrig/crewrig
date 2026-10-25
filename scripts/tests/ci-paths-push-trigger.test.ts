// Spec 0283 R6, plan amendment of #1780: the runtime path gate has no filter list to fall back on,
// so a job of build.yml that the workflow runs on both `pull_request` and `push` must be filtered
// identically on both. A capability whose `pull-request` trigger has an effective path set but whose
// `push` trigger is missing or unfiltered would silently run on every push to main (the gap the
// dorny shadow period found on `install-ts`).
// Reads repository files only; nothing is written.

import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "node:test";

import { decide } from "../lib/ci-paths-gate/gate.ts";
import { readEffective } from "../lib/ci-paths-gate/reference.ts";
import { readCapabilities } from "../lib/ci-parity/reference-read.ts";
import { get, parse, tag, YqMap, YqSeq } from "../lib/yq-accessors/index.ts";
import { readWorkflowUnionYaml } from "./lib/workflow-union.ts";

const caps = new Map(
  readCapabilities(parse(fs.readFileSync("ci/ci-capabilities.yml", "utf8"))).map((c) => [c.id, c]),
);

/** The capability ids of the `ci-job` steps of build.yml, by job. */
function ciJobIds(): Map<string, string> {
  const jobs = get(parse(readWorkflowUnionYaml(".")), ["jobs"]);
  assert.ok(jobs instanceof YqMap);
  const ids = new Map<string, string>();
  for (const [key, job] of jobs.entries) {
    const steps = get(job, ["steps"]);
    if (!(steps instanceof YqSeq)) continue;
    for (const s of steps.items) {
      const u = get(s, ["uses"]);
      if (tag(u) !== "!!str" || !String(u).endsWith("/actions/ci-job")) continue;
      ids.set(key, String(get(get(s, ["with"]), ["id"])));
    }
  }
  return ids;
}

test("a build.yml job filtered on pull_request is filtered identically on push", () => {
  const on = fs.readFileSync(".github/workflows/build.yml", "utf8");
  assert.match(on, /^ {2}pull_request:/m);
  assert.match(on, /^ {2}push:/m);
  const problems: string[] = [];
  let filtered = 0;
  for (const [job, id] of ciJobIds()) {
    const cap = caps.get(id);
    if (cap === undefined) {
      problems.push(`${job}: no capability '${id}'`);
      continue;
    }
    const pr = cap.triggers.find((t) => t.kind === "pull-request");
    if (pr === undefined || pr.paths.length === 0) continue;
    filtered++;
    const push = cap.triggers.find((t) => t.kind === "push");
    if (push === undefined || push.paths.length === 0)
      problems.push(`${job} (${id}): filtered on pull-request but runs unfiltered on push`);
    else if (JSON.stringify([...push.paths].sort()) !== JSON.stringify([...pr.paths].sort()))
      problems.push(`${job} (${id}): the push and pull-request path sets differ`);
  }
  assert.ok(filtered > 50, `expected the 55 filtered jobs, found ${filtered}`);
  assert.deepEqual(problems, []);
});

// Spec 0287 R7: the split moves a job body from build.yml into a callee; the gate decision of a
// `paths:`-filtered capability must not change. The git diff is faked (decide takes the runner), so
// no repository is touched. The pre-split path set is the committed one minus the callee entry.
test("R7: the gate decision of a paths-filtered capability is unchanged by the split", async () => {
  const id = "component-drift-selftest";
  const callee = ".github/workflows/_ci-extensions.yml";
  const eff = readEffective(fs.readFileSync("ci/ci-capabilities.yml", "utf8"), id).paths;
  for (const kind of ["pull-request", "push"]) {
    const now = eff[kind] ?? [];
    assert.ok(now.includes(".github/workflows/build.yml"), `${kind}: build.yml stays`);
    assert.ok(now.includes(callee), `${kind}: the callee file is a path of ${id}`);
  }
  const before = Object.fromEntries(
    Object.entries(eff).map(([k, v]) => [k, v.filter((p) => p !== callee)]),
  );
  const diffOf = (files: string[]) => async (a: string[]) => {
    if (a[0] === "diff") return files.join("\n") + "\n";
    if (a[0] === "rev-parse") return "b".repeat(40) + "\n";
    return "";
  };
  const BEFORE_SHA = "b".repeat(40);
  const cases: [string[], boolean][] = [
    [["scripts/build-components.ts"], true], // a source path: unchanged
    [["README.md"], false], // an unrelated file: unchanged
    [[".github/workflows/build.yml"], true], // the caller still matches
    [[callee], true], // the callee now carries the body: it matches too
    [[".github/workflows/_ci-windows.yml"], false], // another stage's callee does not
  ];
  for (const [files, expected] of cases) {
    for (const event of ["pull_request", "push"]) {
      const d = await decide(id, event, BEFORE_SHA, eff, diffOf(files));
      assert.equal(d.changed, expected, `${event} ${files.join(",")}`);
      assert.equal(d.failOpen, undefined, `${event}: no fail-open`);
      // Unchanged by the split: every case but the callee-only diff decides as before.
      if (!files.includes(callee)) {
        const was = await decide(id, event, BEFORE_SHA, before, diffOf(files));
        assert.equal(was.changed, d.changed, `${event} ${files.join(",")}: pre-split decision`);
      }
    }
  }
});
