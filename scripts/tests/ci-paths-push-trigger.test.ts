// Spec 0309 delta-02 R6 and R1(d): the reverse of the invariant spec 0283 R6 set. A job of
// build.yml that the workflow runs on both `pull_request` and `push` is filtered on `pull_request`
// and runs unfiltered on a push to main and release/**: the effective path set of its `push`
// trigger is empty. The invariant that the two path sets are identical (0283 R6, the plan
// amendment of #1780) is superseded for its `push` half, together with the push inheritance of
// 0283 R3/R7 and 0049 delta-02 R25 (R1(d)): a push trigger inherits nothing. A capability with no
// push trigger at all must be listed as `no-push` in ci/push-main-exemptions.txt, which the
// wiring test ci-push-unfiltered.test.ts checks in full.
// Reads repository files only; nothing is written.

import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "node:test";

import { decide } from "../lib/ci-paths-gate/gate.ts";
import { readEffective } from "../lib/ci-paths-gate/reference.ts";
import { readCapabilities } from "../lib/ci-parity/reference-read.ts";
import { readReference } from "../lib/ci-parity/reference-read.ts";
import { parseExemptions } from "../lib/ci-push/exemptions.ts";
import { get, parse, tag, YqMap, YqSeq } from "../lib/yq-accessors/index.ts";
import { readWorkflowUnionYaml } from "./lib/workflow-union.ts";

const caps = new Map(readCapabilities(parse(readReference(".").text)).map((c) => [c.id, c]));

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

test("a build.yml job filtered on pull_request runs unfiltered on push", () => {
  const on = fs.readFileSync(".github/workflows/build.yml", "utf8");
  assert.match(on, /^ {2}pull_request:/m);
  assert.match(on, /^ {2}push:/m);
  const noPush = new Set(
    parseExemptions(fs.readFileSync("ci/push-main-exemptions.txt", "utf8"))
      .entries.filter((e) => e.kind === "no-push")
      .map((e) => e.id),
  );
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
    if (push === undefined) {
      if (!noPush.has(id)) problems.push(`${job} (${id}): no push trigger and no no-push entry`);
    } else if (push.paths.length !== 0)
      problems.push(`${job} (${id}): the push trigger is filtered (${push.paths.length} paths)`);
  }
  assert.ok(filtered > 50, `expected the filtered jobs, found ${filtered}`);
  assert.deepEqual(problems, []);
});

test("a push trigger inherits no capability-level paths, a pull-request trigger does", () => {
  const withPaths = [...caps.values()].filter((c) => c.capPaths.length > 0);
  assert.ok(withPaths.length > 50, "capabilities with a capability-level paths are found");
  for (const c of withPaths)
    for (const t of c.triggers) {
      if (t.kind === "push" && !t.keys.includes("paths")) assert.deepEqual(t.paths, [], c.id);
      if (t.kind === "pull-request" && !t.keys.includes("paths"))
        assert.deepEqual(t.paths, c.capPaths, c.id);
    }
});

// Spec 0287 R7: the split moves a job body from build.yml into a callee; the gate decision of a
// `paths:`-filtered capability must not change. The git diff is faked (decide takes the runner), so
// no repository is touched. The pre-split path set is the committed one minus the callee entry.
test("R7: the gate decision of a paths-filtered capability is unchanged by the split", async () => {
  const id = "component-drift-selftest";
  const callee = ".github/workflows/_ci-extensions.yml";
  const eff = readEffective(readReference(".").text, id).paths;
  const now = eff["pull-request"] ?? [];
  assert.ok(now.includes(".github/workflows/build.yml"), "pull-request: build.yml stays");
  assert.ok(now.includes(callee), `pull-request: the callee file is a path of ${id}`);
  assert.equal(eff["push"], undefined, "push: unfiltered (spec 0309 delta-02 R6)");
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
      // A push runs whatever the change set: no filter applies to it.
      assert.equal(d.changed, event === "push" ? true : expected, `${event} ${files.join(",")}`);
      assert.equal(d.failOpen, undefined, `${event}: no fail-open`);
      // Unchanged by the split: every case but the callee-only diff decides as before.
      if (!files.includes(callee)) {
        const was = await decide(id, event, BEFORE_SHA, before, diffOf(files));
        if (event === "pull_request")
          assert.equal(was.changed, d.changed, `${event} ${files.join(",")}: pre-split decision`);
      }
    }
  }
});
