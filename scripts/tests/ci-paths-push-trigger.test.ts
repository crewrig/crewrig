// Spec 0283 R6, plan amendment of #1780: the runtime path gate has no filter list to fall back on,
// so a job of build.yml that the workflow runs on both `pull_request` and `push` must be filtered
// identically on both. A capability whose `pull-request` trigger has an effective path set but whose
// `push` trigger is missing or unfiltered would silently run on every push to main (the gap the
// dorny shadow period found on `install-ts`).
// Reads repository files only; nothing is written.

import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "node:test";

import { readCapabilities } from "../lib/ci-parity/reference-read.ts";
import { get, parse, tag, YqMap, YqSeq } from "../lib/yq-accessors/index.ts";

const caps = new Map(
  readCapabilities(parse(fs.readFileSync("ci/ci-capabilities.yml", "utf8"))).map((c) => [c.id, c]),
);

/** The capability ids of the `ci-job` steps of build.yml, by job. */
function ciJobIds(): Map<string, string> {
  const jobs = get(parse(fs.readFileSync(".github/workflows/build.yml", "utf8")), ["jobs"]);
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
