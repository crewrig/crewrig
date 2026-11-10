// tools.ts — the coverage-tools guard of the exhaustive run (spec 0147 delta-02 R25, R28-R30;
// delta-03 R35, R36). Every tool required by a `changeset-gated: true` capability of
// ci/ci-capabilities.yml must also be required by `changeset-coverage`, the capability that runs
// them all; and every gated capability's `requires.install` must rank no higher than the install
// `changeset-coverage` performs (`none` < `omit-dev` < `install` = `ci`; any other value ranks
// above all of them, so the guard fails closed). The performed install is the last
// `changeset-coverage` `command:` entry that is a provisioning line of `installLines` (the GitLab
// generator's value-to-line mapping), else its own `requires.install`, else `none`. The reference
// is read at check time with the shared yq reader (aliases dereferenced); nothing about it is
// embedded here.
//
// Usage: toolsFindings(text). Exit codes: not applicable (the caller exits non-zero on a finding).
// Finding-line formats, tool findings first, then install findings, each in reference order:
//   `ci-changeset-coverage-tools: <capability-id> needs <tool> but changeset-coverage does not
//   require it`, one per (capability, tool) pair;
//   `ci-changeset-coverage-tools: <capability-id> needs requires.install <value> but
//   changeset-coverage installs only <performed>`, one per capability (an empty value prints as
//   `<empty>`, a non-scalar one as `<non-scalar>`).

import { installLines } from "../build-ci/tools.ts";
import {
  get,
  loadYq,
  render,
  tagOf,
  YqAlias,
  YqMap,
  YqSeq,
  type YqNode,
} from "../yq-accessors/index.ts";

/** The capability that runs every changeset-gated command. */
const COVERAGE_ID = "changeset-coverage";

/** A tool that any `python@*` runtime of `changeset-coverage` provides (as in gha-arm.ts). */
const PYTHON_TOOL = "python3";

/** The `requires.install` vocabulary and its ranks (delta-03 R33); a Map, so no inherited key ranks. */
const INSTALL_RANK: ReadonlyMap<string, number> = new Map([
  ["none", 0],
  ["omit-dev", 1],
  ["install", 2],
  ["ci", 2],
]);

/** Provisioning line -> `requires.install` value, from the generator's own mapping (R35). */
const PROVISIONING: ReadonlyMap<string, string> = new Map(
  [...INSTALL_RANK.keys()].flatMap((v) => installLines(v).map((l): [string, string] => [l, v])),
);

const NON_SCALAR = "<non-scalar>";

export interface ToolsResult {
  findings: string[];
  /** Number of changeset-gated capabilities evaluated. */
  gated: number;
  /** Number of distinct tools in the gated union. */
  tools: number;
}

function deref(n: YqNode): YqNode {
  let cur = n;
  while (cur instanceof YqAlias) cur = cur.target;
  return cur;
}

/** A scalar or a sequence of scalars, as a list of texts: `tools: jq` and `tools: [jq]` agree. */
function listOf(node: YqNode): string[] {
  const n = deref(node);
  if (n === null) return [];
  if (n instanceof YqSeq)
    return n.items
      .map(deref)
      .flatMap((i) => (i === null || i instanceof YqMap || i instanceof YqSeq ? [] : [render(i)]));
  if (n instanceof YqMap) return [];
  return [render(n)];
}

function isGated(item: YqNode): boolean {
  const v = deref(get(item, ["changeset-gated"]));
  if (v === null || v instanceof YqMap || v instanceof YqSeq) return false;
  return v.toString() === "true";
}

function idOf(item: YqNode): string {
  const id = deref(get(item, ["id"]));
  return id === null ? "null" : render(id);
}

/** `requires.install` as printed, or undefined when omitted (absent key or a YAML null). */
function installOf(item: YqNode): string | undefined {
  const v = deref(get(item, ["requires", "install"]));
  if (v === null || tagOf(v) === "!!null") return undefined;
  if (v instanceof YqMap || v instanceof YqSeq) return NON_SCALAR;
  return render(v);
}

/** The install `changeset-coverage` performs: last provisioning `command:` line, else its key, else none. */
function performedInstall(coverage: YqNode | undefined): string {
  if (coverage === undefined) return "none";
  const lines = listOf(get(coverage, ["command"])).map((l) => l.trim());
  const matched = lines.findLast((l) => PROVISIONING.has(l));
  if (matched !== undefined) return PROVISIONING.get(matched) as string;
  const own = installOf(coverage);
  return own === undefined || own === "" ? "none" : own;
}

function installFindings(gated: readonly YqNode[], coverage: YqNode | undefined): string[] {
  const performed = performedInstall(coverage);
  // An unknown value on changeset-coverage itself ranks as none (printed verbatim).
  const performedRank = INSTALL_RANK.get(performed) ?? 0;
  const findings: string[] = [];
  for (const cap of gated) {
    const id = idOf(cap);
    if (id === COVERAGE_ID) continue;
    const value = installOf(cap) ?? "none";
    const rank = INSTALL_RANK.get(value) ?? Number.POSITIVE_INFINITY;
    if (rank <= performedRank) continue;
    findings.push(
      `ci-changeset-coverage-tools: ${id} needs requires.install ${value === "" ? "<empty>" : value} but changeset-coverage installs only ${performed}`,
    );
  }
  return findings;
}

export function toolsFindings(referenceText: string): ToolsResult {
  const caps = deref(get(loadYq(referenceText), ["capabilities"]));
  const items = caps instanceof YqSeq ? caps.items.map(deref) : [];
  const gated = items.filter(isGated);

  const coverage = items.find((i) => idOf(i) === COVERAGE_ID);
  const provided = new Set(
    coverage === undefined ? [] : listOf(get(coverage, ["requires", "tools"])),
  );
  const runtimes = coverage === undefined ? [] : listOf(get(coverage, ["requires", "runtime"]));
  if (runtimes.some((r) => r.startsWith("python@"))) provided.add(PYTHON_TOOL);

  const union = new Set<string>();
  const findings: string[] = [];
  for (const cap of gated) {
    const id = idOf(cap);
    for (const tool of new Set(listOf(get(cap, ["requires", "tools"])))) {
      union.add(tool);
      if (id === COVERAGE_ID || provided.has(tool)) continue;
      findings.push(
        `ci-changeset-coverage-tools: ${id} needs ${tool} but changeset-coverage does not require it`,
      );
    }
  }
  findings.push(...installFindings(gated, coverage));
  return { findings, gated: gated.length, tools: union.size };
}
