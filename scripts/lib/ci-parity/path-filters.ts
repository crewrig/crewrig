// path-filters.ts — concern 6 (spec 0049 delta-01 R12-R20): the reference `paths` of each
// portable capability's pull-request and push triggers against the GitHub-side filter.

import fs from "node:fs";
import path from "node:path";

import { get, isYqFalsy, parse, tag, YqMap, YqSeq, type YqNode } from "../yq-accessors/index.ts";
import { fail } from "./findings.ts";
import { CI_JOB } from "./gha-arm.ts";
import { UnsupportedGlobError, globToRegExp } from "../glob-engine.ts";
import { plist } from "./reference-read.ts";
import type { CapRecord, ParityState } from "./state.ts";

const EVENTS = [
  ["pull_request", "pull-request"],
  ["push", "push"],
] as const;

interface EventPaths {
  present: boolean;
  paths: { tag: string; list: string[]; bad: boolean };
  ignore: { tag: string; list: string[]; bad: boolean };
}

interface WfDoc {
  onTag: string;
  onEntries: string[];
  events: EventPaths[];
  nFilters: number;
}

const bullets = (list: string[]): string => {
  const b = list.filter((l) => l !== "").map((l) => `      - ${l}`);
  return b.length > 0 ? b.join("\n") : "      (none)";
};

function readOn(on: YqNode): { onTag: string; onEntries: string[]; events: EventPaths[] } {
  const onTag = tag(on);
  const strs = (n: YqNode): string[] => (n !== null && tag(n) === "!!str" ? [String(n)] : []);
  const onEntries = on instanceof YqSeq ? on.items.flatMap(strs) : strs(on);
  const m = on instanceof YqMap ? on : null;
  const events = EVENTS.map(([ev]) => {
    const e = m === null ? null : (m.entries.findLast(([k]) => k === ev)?.[1] ?? null);
    const sub = (k: string): ReturnType<typeof plist> =>
      e instanceof YqMap ? plist(get(e, [k])) : { tag: "", list: [], bad: false };
    return {
      present: m !== null && m.entries.some(([k]) => k === ev),
      paths: sub("paths"),
      ignore: sub("paths-ignore"),
    };
  });
  return { onTag, onEntries, events };
}

/** How many `dorny/paths-filter` steps the job carries (the runtime path gate replaced them all). */
function dornySteps(jobs: YqNode, key: string): number {
  const job = jobs instanceof YqMap ? (jobs.entries.find(([k]) => k === key)?.[1] ?? null) : null;
  const steps = job === null || job instanceof YqSeq ? null : get(job, ["steps"]);
  if (!(steps instanceof YqSeq)) return 0;
  return steps.items.filter((s) => {
    if (s instanceof YqSeq || s === null) return false;
    const u = get(s, ["uses"]);
    return tag(u) === "!!str" && String(u).startsWith("dorny/paths-filter@");
  }).length;
}

/** The `with.id` of the first `ci-job` step of the job: null when the job does not use it. */
function ciJobId(jobs: YqNode, key: string): string | null {
  const job = jobs instanceof YqMap ? (jobs.entries.find(([k]) => k === key)?.[1] ?? null) : null;
  const steps = job === null || job instanceof YqSeq ? null : get(job, ["steps"]);
  if (!(steps instanceof YqSeq)) return null;
  for (const s of steps.items) {
    if (s instanceof YqSeq || s === null) continue;
    const u = get(s, ["uses"]);
    if (tag(u) !== "!!str" || String(u) !== CI_JOB) continue;
    const id = get(get(s, ["with"]), ["id"]);
    return id !== null && tag(id) === "!!str" ? String(id) : "";
  }
  return null;
}

/** R27(a) and (b): the id binding and the supported globs, for a job that uses `ci-job`. */
function ciJobChecks(s: ParityState, c: CapRecord, jobKey: string, declared: string): void {
  if (declared !== c.id || declared.includes("${{"))
    fail(
      s,
      `capability '${c.id}' (github-actions): job '${jobKey}' passes ci-job id '${declared || "(missing)"}' but its key names capability '${c.id}' (R27a)`,
    );
  for (const t of c.triggers)
    for (const g of t.paths)
      try {
        globToRegExp(g);
      } catch (e) {
        if (!(e instanceof UnsupportedGlobError)) throw e;
        fail(
          s,
          `capability '${c.id}' (reference): trigger '${t.kind}' path '${g}' is not supported by the glob engine: ${e.why} (R27b)`,
        );
      }
}

function loadWf(file: string, jobKey: string): WfDoc & { ciId: string | null } {
  const doc = parse(fs.readFileSync(file, "utf8"));
  const ciId = ciJobId(get(doc, ["jobs"]), jobKey);
  const on = readOn(get(doc, ["on"]));
  return { ...on, nFilters: dornySteps(get(doc, ["jobs"]), jobKey), ciId };
}

const undet = (s: ParityState, id: string, why: string): void =>
  fail(
    s,
    `capability '${id}' (github-actions): GitHub-side path filter cannot be determined: ${why} (R17)`,
  );

function compare(
  s: ParityState,
  id: string,
  scope: string,
  rdesc: string,
  r: string,
  g: string,
): void {
  if (r === g) return;
  const rs = [...new Set(r.split("\n").filter((x) => x !== ""))];
  const gs = [...new Set(g.split("\n").filter((x) => x !== ""))];
  const onlyR = rs.filter((x) => !gs.includes(x));
  const onlyG = gs.filter((x) => !rs.includes(x));
  if (onlyR.length + onlyG.length === 0) return;
  fail(
    s,
    `capability '${id}' (github-actions): path filters diverge on ${scope}, ${rdesc} (R14)\n    only in the reference:\n${bullets(onlyR)}\n    only on the GitHub side:\n${bullets(onlyG)}`,
  );
}

function split(list: string[]): { pos: string; neg: string[] } {
  if (!list.some((l) => l.startsWith("!"))) return { pos: list.join("\n"), neg: [] };
  return {
    pos: list.filter((l) => l !== "" && !l.startsWith("!")).join("\n"),
    neg: list.filter((l) => l.startsWith("!")),
  };
}

const neg = (s: ParityState, id: string, what: string, n: string[]): void =>
  fail(
    s,
    `capability '${id}' (github-actions): ${what} holds negated entries the reference cannot express (R16):\n${bullets(n)}`,
  );

function ignore(s: ParityState, id: string, ev: string, e: EventPaths): void {
  if (e.ignore.tag === "" || e.ignore.tag === "!!null") return;
  fail(
    s,
    `capability '${id}' (github-actions): event '${ev}' declares paths-ignore, an exclusion the reference cannot express (R16):\n${bullets(e.ignore.list)}`,
  );
}

function dedicated(s: ParityState, c: CapRecord, d: WfDoc): void {
  for (let e = 0; e < EVENTS.length; e++) {
    const [ev, rk] = EVENTS[e] as (typeof EVENTS)[number];
    const evt = d.events[e] as EventPaths;
    let pos = "";
    const declared =
      d.onTag === "!!map"
        ? evt.present
        : ["!!seq", "!!str"].includes(d.onTag) && d.onEntries.includes(ev);
    if (declared) {
      if (!["", "!!null", "!!seq"].includes(evt.paths.tag))
        return undet(s, c.id, `paths under '${ev}' is not a list`);
      if (evt.paths.bad)
        return undet(s, c.id, `paths under '${ev}' holds an entry that is not a string`);
      ignore(s, c.id, ev, evt);
      const sp = split(evt.paths.list);
      if (sp.neg.length > 0) neg(s, c.id, `event '${ev}'`, sp.neg);
      pos = sp.pos;
    }
    const mine = c.triggers.filter((t) => t.kind === rk);
    for (const t of mine)
      compare(s, c.id, `event '${ev}'`, `reference trigger '${rk}'`, t.paths.join("\n"), pos);
    if (mine.length === 0)
      compare(s, c.id, `event '${ev}'`, `no reference '${rk}' trigger`, "", pos);
  }
}

/** R12-R18 for one portable capability with an attributed GitHub job. */
export function checkGhaPaths(
  state: ParityState,
  c: CapRecord,
  workflow: string,
  jobKey: string,
): void {
  for (const t of c.triggers) {
    if (t.kind !== "pull-request" && t.kind !== "push") continue;
    if (!["", "!!null", "!!seq"].includes(t.pathsTag))
      return fail(
        state,
        `capability '${c.id}' (reference): trigger '${t.kind}' declares a paths value that is not a list (R17)`,
      );
    if (t.pathsBad)
      return fail(
        state,
        `capability '${c.id}' (reference): trigger '${t.kind}' declares a paths entry that is not a string (R17)`,
      );
  }
  const d = loadWf(workflow, jobKey);
  if (d.ciId !== null) ciJobChecks(state, c, jobKey, d.ciId);
  const wfPaths = d.events.some((e) => !["", "!!null"].includes(e.paths.tag));
  if (d.nFilters > 0)
    return fail(
      state,
      `capability '${c.id}' (github-actions): job '${jobKey}' carries ${d.nFilters} dorny/paths-filter step(s); the runtime path gate replaced them (spec 0283 R6, spec 0285 R4)`,
    );
  if (d.ciId !== null && !wfPaths) return; // shape A: no GitHub-side list
  dedicated(state, c, d);
}

export { isYqFalsy, path };
