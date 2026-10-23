// tools.ts — the coverage-tools guard of the exhaustive run (spec 0147 delta-02 R25, R28-R30): every
// tool required by a `changeset-gated: true` capability of ci/ci-capabilities.yml must also be
// required by `changeset-coverage`, the capability that runs them all. The reference is read at
// check time with the shared yq reader (aliases dereferenced); nothing about it is embedded here.
//
// Usage: toolsFindings(text). Exit codes: not applicable (the caller exits non-zero on a finding).
// Finding-line format: `ci-changeset-coverage-tools: <capability-id> needs <tool> but
// changeset-coverage does not require it`, one per (capability, tool) pair, in reference order.

import { get, loadYq, render, YqAlias, YqMap, YqSeq, type YqNode } from "../yq-accessors/index.ts";

/** The capability that runs every changeset-gated command. */
const COVERAGE_ID = "changeset-coverage";

/** A tool that any `python@*` runtime of `changeset-coverage` provides (as in gha-arm.ts). */
const PYTHON_TOOL = "python3";

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
  return { findings, gated: gated.length, tools: union.size };
}
