// gha-arm.ts — Arm 1 (R3/R4): reference <-> GitHub Actions at the business-step level, and the
// cache-key agreement (spec 0147 R6/R7). Judged by presence/equivalence, not exact syntax.

import { fail } from "./findings.ts";
import { jobNode, loadJobs, readJob, type JobRecord } from "./job-records.ts";
import { aptPackagesForTools, DEFAULT_YQ_VERSION } from "../build-ci/tools.ts";
import { installRecipeTool, normalizeCmd } from "./probe-tokens.ts";
import { ShellAbort, type CapRecord, type ParityState } from "./state.ts";

export const CI_JOB = "./.github/actions/ci-job";

const GUARD =
  "node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/ci-cache-guard.ts --cache-dir ";

/** `sort -u` of the non-empty lines, bytewise. */
export const sortedUnique = (xs: string[]): string[] =>
  [...new Set(xs.filter((x) => x !== ""))].sort();

/** `printf '%s' text | sort`, then `$(…)` stripping: bytewise-sorted lines. */
export function sortLines(lines: string[]): string {
  return [...lines].sort().join("\n").replace(/\n+$/, "");
}

/** `extract_hashfiles`: the files of a `hashFiles('a', 'b')` key, one per line. */
export function extractHashFiles(expr: string): string[] {
  const i = expr.indexOf("hashFiles(");
  let inner = i < 0 ? expr : expr.slice(i + "hashFiles(".length);
  const j = inner.indexOf(")");
  if (j >= 0) inner = inner.slice(0, j);
  const out = inner
    .replaceAll("'", "")
    .split(",")
    .map((s) => s.replace(/^ +/, "").replace(/ +$/, ""))
    .filter((s) => s !== "");
  // `grep -v '^$'` finds nothing: its status 1 aborts the script under pipefail + set -e.
  if (out.length === 0) throw new ShellAbort(1);
  return out;
}

function checkRuntimes(
  state: ParityState,
  c: CapRecord,
  prov: { node: string; python: string; fetch: string; tools: string[] },
): void {
  const id = c.id;
  for (const rt of c.runtime) {
    if (rt === "") continue;
    if (rt.startsWith("node@")) {
      const want = rt.slice(5);
      if (prov.node.split(".")[0] !== want.split(".")[0])
        fail(
          state,
          `capability '${id}' (github-actions): requires runtime '${rt}' but setup provides node '${prov.node || "none"}' (R4)`,
        );
    } else if (rt.startsWith("python@")) {
      if (!prov.python.startsWith(rt.slice(7)))
        fail(
          state,
          `capability '${id}' (github-actions): requires runtime '${rt}' but setup provides python '${prov.python || "none"}' (R4)`,
        );
    }
  }
  for (const tool of c.tools) {
    if (tool === "" || ["jq", "git", "diff"].includes(tool)) continue;
    if (tool === "python3" && prov.python !== "") continue;
    if (!prov.tools.includes(tool))
      fail(
        state,
        `capability '${id}' (github-actions): requires tool '${tool}' but no setup step installs it (R4)`,
      );
  }
  if (c.historyDepth === "full" && prov.fetch !== "0")
    fail(
      state,
      `capability '${id}' (github-actions): requires full source history but checkout fetch-depth is '${prov.fetch || "unset"}' (R4)`,
    );
}

function checkEnv(state: ParityState, c: CapRecord, job: JobRecord): void {
  const all = sortedUnique([...job.env, ...job.stepEnv]);
  for (const ek of c.envKeys) {
    if (ek !== "" && !all.includes(ek))
      fail(
        state,
        `capability '${c.id}' (github-actions): requires env variable '${ek}' but GHA job does not exhibit it (spec 0131)`,
      );
  }
  for (const gek of all) {
    if (!c.envKeys.includes(gek))
      fail(
        state,
        `capability '${c.id}' (github-actions): GHA job defines env variable '${gek}' not declared in reference env block (spec 0131)`,
      );
  }
}

/** Arm 1 for one portable capability and its attributed job. */
export function checkGhaJob(
  state: ParityState,
  c: CapRecord,
  job: JobRecord,
  jobKey: string,
): void {
  let ci = 0;
  const prov = { node: "", python: "", fetch: "", tools: [] as string[] };
  for (let s = 0; s < job.nsteps; s++) {
    const step = job.steps[s];
    if (step === undefined) continue;
    if (step.uses !== "" && step.uses !== "null") {
      if (step.uses.includes("/checkout@")) prov.fetch = step.fetchDepth;
      else if (step.uses.includes("/setup-node@")) prov.node = step.nodeVersion;
      else if (step.uses.includes("/setup-python@")) prov.python = step.pythonVersion;
      else if (step.uses === "./.github/actions/setup-task") prov.tools.push("task");
      else if (step.uses === CI_JOB) {
        // The composite runs setup-node, setup-task (unless task: false), `task ci:<id>` and
        // cancel-on-failure itself (spec 0283 R5, spec 0049 delta-02 R27).
        prov.node = step.withNode === "" ? "24" : step.withNode;
        if (step.withTask !== "false") prov.tools.push("task");
        if (step.withYq !== "") prov.tools.push("yq");
        // `requires.install` (omitted = none) must equal the job's `install` input (the action's
        // own default is ci), so provisioning lives in exactly one declared place (spec 0283 R1).
        const want = c.install === "" ? "none" : c.install;
        const got = step.withInstall === "" ? "ci" : step.withInstall;
        if (want !== got)
          fail(
            state,
            `capability '${c.id}' (github-actions): job '${jobKey}' passes ci-job install '${got}' but the reference requires.install is '${want}' (spec 0283 R1)`,
          );
        // The GitHub `yq` input must equal the version the GitLab recipe installs (no silent
        // engine asymmetry): `requires.yq`, else the default version.
        if (step.withYq !== "" && step.withYq !== (c.yq === "" ? DEFAULT_YQ_VERSION : c.yq))
          fail(
            state,
            `capability '${c.id}' (github-actions): job '${jobKey}' passes ci-job yq '${step.withYq}' but GitLab installs yq '${c.yq === "" ? DEFAULT_YQ_VERSION : c.yq}' (requires.yq)`,
          );
        // `apt` must equal the packages the capability's `requires.tools` implies (the GitLab recipe
        // reads the same map), `python` the secondary `runtime` entry `python@<version>`.
        const gotApt = sortedUnique(step.withApt.split(" "));
        const wantApt = aptPackagesForTools(c.tools);
        if (gotApt.join(" ") !== wantApt.join(" "))
          fail(
            state,
            `capability '${c.id}' (github-actions): job '${jobKey}' passes ci-job apt '${gotApt.join(" ")}' but requires.tools implies '${wantApt.join(" ")}' (spec 0283)`,
          );
        prov.tools.push(...gotApt.map((p) => (p === "tesseract-ocr" ? "tesseract" : p)));
        const wantPy = c.runtime.find((r) => r.startsWith("python@"))?.slice(7) ?? "";
        if (step.withPython !== wantPy && !(step.withPython === "" && wantPy === ""))
          fail(
            state,
            `capability '${c.id}' (github-actions): job '${jobKey}' passes ci-job python '${step.withPython}' but the reference runtime is python '${wantPy}' (spec 0283)`,
          );
        prov.python = step.withPython;
        if (c.ncmd === 1 && normalizeCmd(c.cmds[0] ?? "") === `task ci:${c.id}`) ci++;
      }
      continue;
    }
    if (step.run === "" || step.run === "null") continue;
    let nrun = normalizeCmd(step.run);
    if (nrun.startsWith(GUARD)) {
      const k = nrun.indexOf(" -- ");
      if (k >= 0) nrun = nrun.slice(k + 4);
    }
    if (ci < c.ncmd) {
      const next =
        c.cmdTag === "!!seq" && ci < c.cmds.length ? normalizeCmd(c.cmds[ci] as string) : "";
      if (nrun === next) {
        ci++;
        continue;
      }
    }
    const rtool = installRecipeTool(nrun);
    if (rtool !== "") {
      prov.tools.push(rtool);
      continue;
    }
    fail(
      state,
      `capability '${c.id}' (github-actions): business step diverges from the declared command — unexpected step: '${nrun}' (R3)`,
    );
    return;
  }
  if (ci !== c.ncmd)
    fail(
      state,
      `capability '${c.id}' (github-actions): job '${jobKey}' exhibits ${ci} of ${c.ncmd} declared business steps (R3)`,
    );
  checkRuntimes(state, c, prov);
  checkEnv(state, c, job);
}

/** Cache-key agreement of a cached capability (R6). */
export function checkGhaCache(state: ParityState, c: CapRecord, job: JobRecord): void {
  const ref = sortLines(c.cacheFiles);
  let gha = "";
  for (let s = 0; s < job.nsteps; s++) {
    const step = job.steps[s];
    if (step?.uses === CI_JOB && step.withCache === "true") return; // the action keys it
    if (step?.uses.includes("/cache@")) gha = sortLines(extractHashFiles(step.key));
  }
  if (gha === "") {
    fail(
      state,
      `capability '${c.id}' (github-actions): declares cache: but no actions/cache step with a hashFiles key found (R6)`,
    );
    return;
  }
  if (ref !== gha)
    fail(
      state,
      `capability '${c.id}' (github-actions): cache key inputs diverge from the reference cache.files (R6)`,
    );
}

export { jobNode, loadJobs, readJob };
