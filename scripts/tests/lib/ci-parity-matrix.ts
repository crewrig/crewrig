// ci-parity-matrix.ts — the GHA-only path-filter matrix of check-ci-parity as data rows.
//
// Replaces the batched `yq -i` edits of scripts/tests/test-check-ci-parity.sh (L720-815).
// One GHA-only fixture (no .gitlab-ci.yml: the reference edits would add an unrelated
// Arm 2 failure), one mutation per capability, ONE harness run per process (memoised):
// the two path-filter test files each call `matrixRun()`. A workflow file is only touched
// through the job (or `on:` of the dedicated workflow) of the capability under test.

import fs from "node:fs";
import path from "node:path";

import {
  capOf,
  editYaml,
  list,
  makeFixture,
  map,
  refPaths,
  runCheck,
  type CheckResult,
  type YMap,
} from "./ci-parity-fixture.ts";

/** Number of `  DRIFT:` blocks each mutated row must produce; the run-level count is their sum. */
export const ROW_DRIFT: Readonly<Record<string, number>> = {
  FX1: 2,
  FX2: 2,
  FX3: 1,
  FX4: 1,
  FX5: 2,
  FX6: 1,
  FX7: 1,
  FX8: 1,
  FX9: 1,
  FX10: 1,
  FX11: 1,
  FX12: 2,
  FX13: 2,
  FX14: 2,
  FX15: 1,
  FX16: 1,
  FX17: 1,
  UX1: 1,
  UX2: 1,
  UX3: 1,
  UX4: 1,
  UX5: 1,
  UX6: 1,
  UX7: 1,
  UX8: 1,
  UX9: 1,
};
export const WANT_DRIFT: number = Object.values(ROW_DRIFT).reduce((a, b) => a + b, 0);

const triggers = (cap: YMap): YMap[] => list(cap["trigger"], "trigger").map((t) => map(t));
const trigger = (cap: YMap, on: string): YMap => {
  const t = triggers(cap).find((x) => x["on"] === on);
  if (t === undefined) throw new Error(`no '${on}' trigger`);
  return t;
};
const addPaths = (t: YMap, ...p: string[]) => void (t["paths"] = [...list(t["paths"] ?? []), ...p]);
const jobOf = (doc: YMap, name: string): YMap => map(map(doc["jobs"])[name], `job ${name}`);
const FILTER = /^dorny\/paths-filter@/;
const isFilter = (s: unknown) => FILTER.test(String(map(s)["uses"] ?? ""));
/** The filter step of a job; the dorny filters left build.yml (spec 0283 R9), so a missing one is re-created. */
function filterStep(doc: YMap, name: string): YMap {
  const job = jobOf(doc, name);
  const found = list(job["steps"]).find(isFilter);
  if (found !== undefined) return map(found);
  const filters = `${name}:\n${refPaths(name, "pull-request")
    .map((p) => `  - '${p}'\n`)
    .join("")}`;
  const [checkout, ...rest] = list(job["steps"]);
  job["steps"] = [checkout, newStep("filter", filters), ...rest];
  return filterStep(doc, name);
}
const filtersOf = (doc: YMap, name: string): string =>
  String(map(filterStep(doc, name)["with"])["filters"]);
const setFilters = (doc: YMap, name: string, f: (t: string) => string) => {
  const w = map(filterStep(doc, name)["with"]);
  w["filters"] = f(String(w["filters"]));
};
const newStep = (id: string, filters: string): YMap => ({
  uses: "dorny/paths-filter@v3",
  id,
  with: { filters },
});

/** Spec 0283 R3: the mutations below edit per-trigger lists, so expand the inherited capability list first. */
function expandInherited(doc: YMap): void {
  for (const c of list(doc["capabilities"]).map((x) => map(x))) {
    const inherited = c["paths"];
    if (inherited === undefined) continue;
    for (const t of triggers(c))
      if ((t["on"] === "pull-request" || t["on"] === "push") && t["paths"] === undefined)
        t["paths"] = [...list(inherited)];
    const cache = c["cache"];
    if (typeof cache === "object" && cache !== null && !Array.isArray(cache)) {
      const m = cache as YMap;
      if (m["files"] === undefined) m["files"] = [...list(inherited)];
    }
    delete c["paths"];
  }
}

function reference(doc: YMap): void {
  expandInherited(doc);
  const cap = (id: string) => capOf(doc, id);
  for (const t of triggers(cap("figure-labels"))) addPaths(t, "zz/ref-only/**"); // FX1
  addPaths(trigger(cap("docs-index"), "pull-request"), "zz/c/**"); // FX2
  addPaths(trigger(cap("usage-storage"), "pull-request"), "zz/d/**"); // FX3
  for (const t of triggers(cap("markdown-links"))) {
    // FX5: a different spelling of the same glob (R13)
    if (Array.isArray(t["paths"])) {
      t["paths"] = list(t["paths"]).map((p) => (p === "docs/**" ? "docs/**/*" : p));
    }
  }
  addPaths(trigger(cap("check-model-mappings"), "push"), "zz/p/**"); // FX11
  for (const id of ["mempalace", "windows-hook-probe"]) {
    // FX12, FX14: reference unfiltered
    for (const t of triggers(cap(id))) delete t["paths"];
  }
  list(cap("audit")["trigger"]).push({ on: "push", paths: ["zz/g/**"] }); // FX16
  cap("extension-manifest")["trigger"] = [{ on: "manual" }]; // FX17
  trigger(cap("e2e"), "pull-request")["paths"] = "x"; // UX8: scalar reference paths
  for (const t of triggers(cap("usage-pricing"))) t["branches"] = ["zz-ref"]; // PF4 (R19)
  const ci = cap("ci-parity"); // PF5: no push trigger in the reference (the s2-F1 decision)
  ci["trigger"] = triggers(ci).filter((t) => t["on"] !== "push");
}

function buildYml(doc: YMap): void {
  // Jobs whose reference-side mutation (FX1, FX5, FX11, FX12, FX17, UX1) needs a baseline filter to face.
  for (const j of [
    "figure-labels",
    "markdown-links",
    "check-model-mappings",
    "mempalace",
    "extension-manifest",
    "setup",
  ])
    filterStep(doc, j);
  setFilters(doc, "docs-index", (t) => `${t}  - zz/a/**\n  - zz/b/**\n`); // FX2
  setFilters(doc, "frontmatter", (t) => `${t}  - "!zz/neg/**"\n`); // FX7
  // FX13: the filter step is deleted. check-description-length is a `ci-job` job, where a job without a
  // filter is the legitimate shape A, so the mutation also unrolls the `ci-job` step into its plain
  // provisioning steps: a bare filterless GitHub job against a filtered reference, as FX13 always meant.
  const bare = jobOf(doc, "check-description-length");
  bare["steps"] = list(bare["steps"])
    .filter((s) => !isFilter(s))
    .flatMap((s) =>
      String(map(s)["uses"] ?? "").endsWith("/ci-job")
        ? [
            { uses: "actions/setup-node@v4", with: { "node-version": 24 } },
            { uses: "./.github/actions/setup-task" },
            { run: "task ci:check-description-length" },
          ]
        : [s],
    );
  list(jobOf(doc, "setup")["steps"]).push(newStep("filter2", "setup:\n  - zz/s/**\n")); // UX1
  setFilters(doc, "check-agent-profiles", (t) => `${t}other-filter:\n  - zz/o/**\n`); // UX2
  setFilters(doc, "check-metadata-keys", (t) => t.replace(/^check-metadata-keys:/, "other-name:")); // UX3
  setFilters(doc, "check-claude-agent-layout", () => "check-claude-agent-layout: zz/x/**\n"); // UX4
  setFilters(doc, "core-paths", () => "core-paths:\n  - 1\n  - true\n"); // UX5
  setFilters(doc, "extension-provenance", () => ".github/filters.yml"); // UX6
  setFilters(doc, "test-wiring", () => "test-wiring: [unclosed\n"); // UX9
  setFilters(doc, "extension-install", (t) => {
    // PF3: reversed, one entry repeated, quotes changed
    const l = t.split("\n").filter((x) => x.length > 0);
    return [l[0], ...l.slice(1).reverse(), l[1]].join("\n").replaceAll("'", '"') + "\n";
  });
  if (filtersOf(doc, "extension-install") === "") throw new Error("PF3 precondition");
}

/** Rewrite the `paths` list of `on.<event>` in the workflow TEXT, so quote styles stay under control. */
function rewriteEventPaths(
  file: string,
  event: string,
  rewrite: (paths: string[]) => string[],
): void {
  const lines = fs.readFileSync(file, "utf8").split("\n");
  const at = lines.findIndex((l) => l === `  ${event}:`);
  const p = lines.findIndex((l, i) => i > at && l === "    paths:");
  if (at < 0 || p < 0) throw new Error(`no ${event} paths in ${file}`);
  let end = p + 1;
  while (lines[end]?.startsWith("      - ")) end++;
  const old = lines.slice(p + 1, end).map((l) => l.slice(8).replace(/^["']|["']$/g, ""));
  const next = rewrite(old).map((v, i) => `      - ${i === 0 ? `'${v}'` : i === 1 ? v : `"${v}"`}`);
  lines.splice(p + 1, end - p - 1, ...next);
  fs.writeFileSync(file, lines.join("\n"));
}

function dedicated(wf: string): void {
  const edit = (name: string, f: (doc: YMap) => void) => editYaml(path.join(wf, name), f);
  const on = (d: YMap) => map(d["on"], "on");
  // Like `yq '.on.push.paths = ...'`: a missing event is created.
  const ev = (d: YMap, e: string) => map((on(d)[e] ??= {}), e);
  edit("usage-capture.yml", (d) => addPaths(ev(d, "push"), "zz/e/**")); // FX4
  edit("release-notes.yml", (d) => {
    // FX6: a different spelling of the same glob (R13)
    const e = ev(d, "pull_request");
    e["paths"] = list(e["paths"]).map((p) => (p === "scripts/lib/release-notes/**" ? `${p}/*` : p));
  });
  edit("usage-attribution.yml", (d) => addPaths(ev(d, "pull_request"), "!zz/neg/**")); // FX8
  edit("usage-dashboard.yml", (d) => void (ev(d, "push")["paths-ignore"] = ["docs/**"])); // FX9
  edit("ticket-pickup.yml", (d) => {
    // FX10: reshaped to an in-job filter equal to the reference
    delete ev(d, "pull_request")["paths"];
    delete ev(d, "push")["paths"];
    ev(d, "push")["paths-ignore"] = ["docs/**"];
    const f = `ticket-pickup:\n${refPaths("ticket-pickup", "pull-request")
      .map((p) => `  - "${p}"\n`)
      .join("")}`;
    const j = jobOf(d, "ticket-pickup");
    j["steps"] = [newStep("filter", f), ...list(j["steps"])];
  });
  edit("scripting-conventions.yml", (d) => void (ev(d, "push")["paths"] = ["zz/f/**"])); // FX15
  edit("usage-record-schema.yml", (d) =>
    // UX7: in-job filter in a workflow that has on.*.paths
    list(jobOf(d, "usage-record-schema")["steps"]).push(
      newStep("filter", "usage-record-schema:\n  - zz/r/**\n"),
    ),
  );
  edit("release-monorepo.yml", (d) => void delete on(d)["push"]); // PF1a
  edit("release-rehearsal.yml", (d) => {
    // PF1b: events declared without a filter
    on(d)["pull_request"] = null;
    on(d)["push"] = { branches: ["main"] };
  });
  rewriteEventPaths(path.join(wf, "release-tests.yml"), "pull_request", (p) =>
    [...p].reverse().concat(p[0] ?? ""),
  ); // PF2
  edit("usage-pricing.yml", (d) => {
    // PF4: branches differ from the reference (R19)
    ev(d, "pull_request")["branches"] = ["zz-gh"];
    ev(d, "push")["branches"] = ["zz-gh"];
  });
}

let memo: CheckResult | undefined;
/** Build the mutated GHA-only fixture and run the entry once per process. */
export function matrixRun(): CheckResult {
  if (memo !== undefined) return memo;
  const fx = makeFixture();
  fs.rmSync(path.join(fx, ".gitlab-ci.yml"), { force: true });
  const wf = path.join(fx, ".github", "workflows");
  editYaml(path.join(fx, "ci", "ci-capabilities.yml"), reference);
  editYaml(path.join(wf, "build.yml"), buildYml);
  dedicated(wf);
  memo = runCheck(fx);
  return memo;
}
