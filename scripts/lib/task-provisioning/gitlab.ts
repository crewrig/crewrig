// gitlab.ts — check (b) of the Task provisioning guard (spec 0282 R6): a GitLab job whose
// capability requires `task` carries the generated recipe once and contiguously, and no job
// carries the fail-open command substitution.

import fs from "node:fs";

import { jobNode } from "../ci-parity/job-records.ts";
import type { ParityState } from "../ci-parity/state.ts";
import { type TaskPin, taskRecipe } from "../build-ci/tools.ts";
import { get, isYqFalsy, parse, render, YqMap, YqSeq, type YqNode } from "../yq-accessors/index.ts";

/** A job's `key` lines; a `!reference [job, key]` item (read as a two-scalar sequence) expands. */
function lines(doc: YqMap, job: YqNode, key: string, depth = 0): string[] {
  const n = jobNode(job, key);
  if (!(n instanceof YqSeq)) return [];
  return n.items
    .filter((i) => !isYqFalsy(i))
    .flatMap((i) => {
      if (i instanceof YqSeq && i.items.length === 2 && depth < 5) {
        const [rj, rk] = i.items.map((x) =>
          typeof x === "string" || x instanceof String ? String(x) : "",
        );
        return rj && rk ? lines(doc, jobNode(doc, rj), rk, depth + 1) : [];
      }
      return [render(i).replace(/\n+$/, "")];
    });
}

function occurrences(have: readonly string[], want: readonly string[]): number {
  let n = 0;
  for (let i = 0; i + want.length <= have.length; i++)
    if (want.every((w, k) => have[i + k] === w)) n++;
  return n;
}

export function checkGitlab(state: ParityState, pin: TaskPin): string[] {
  if (!fs.existsSync(state.gitlabCi)) return [];
  const doc = get(parse(fs.readFileSync(state.gitlabCi, "utf8")), []);
  if (!(doc instanceof YqMap)) return [".gitlab-ci.yml: top level is not a mapping (R6b)"];
  const out: string[] = [];
  const recipe = taskRecipe(pin);
  const needs = new Set(state.caps.filter((c) => c.tools.includes("task")).map((c) => c.id));
  for (const [key, job] of doc.entries) {
    if (!(job instanceof YqMap)) continue;
    const before = lines(doc, job, "before_script");
    const all = [...before, ...lines(doc, job, "script")];
    if (all.some((l) => /sh -c "?\$\(curl/.test(l)))
      out.push(`.gitlab-ci.yml job '${key}': fail-open command substitution (R6b)`);
    if (needs.has(key) && occurrences(before, recipe) !== 1)
      out.push(
        `.gitlab-ci.yml job '${key}': does not carry the generated Task recipe exactly once (R6b)`,
      );
  }
  return out;
}
