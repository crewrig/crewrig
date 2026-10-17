// model-ci-tooling-yq-accessors.test.ts — scalar-style spike of the shared yq reader (spec 0262 PR 4):
// the TS reader versus goldens produced by real yq v4.44.3 in the oracle container
// (scripts/tests/fixtures/yq-accessors/oracle.Dockerfile.golden, generator
// scripts/tests/lib/yq-oracle-gen.ts). Each corpus file is one class. Classes whose
// reader output differs from yq are listed in KNOWN_GAPS and trigger the plan's stop
// rule (delta-spec 0262.delta-01); the test fails when the gap list changes.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import {
  get,
  getOrEmpty,
  keys,
  length,
  loadYq,
  tag,
  render,
  YqMap,
  YqSeq,
  YqParseError,
} from "../lib/yq-accessors/index.ts";

const FIX = path.join(import.meta.dirname, "fixtures", "yq-accessors");
interface Out {
  status: number;
  stdout: string;
}
const oracle = JSON.parse(fs.readFileSync(path.join(FIX, "oracle.json.golden"), "utf8")) as Record<
  string,
  Record<string, Out>
>;

/** Classes excluded from byte comparison: explicit tags (req 24 c), multi-document (req 24 d). */
const KNOWN_GAPS: string[] = ["explicit-tag-custom", "explicit-tags", "multi-doc"];

function yqLine(o: Out | undefined): string {
  return o === undefined ? "<missing>" : o.status === 0 ? o.stdout.replace(/\n$/, "") : "<error>";
}

function compareClass(name: string): string[] {
  const rec = oracle[name] as Record<string, Out>;
  const text = fs.readFileSync(path.join(FIX, "corpus", `${name}.yml.golden`), "utf8");
  const diffs: string[] = [];
  let doc;
  try {
    doc = loadYq(text);
  } catch (e) {
    const ok = e instanceof YqParseError && rec["keys"]?.status !== 0;
    return ok ? [] : [`${name}: reader throws ${(e as Error).message}, yq accepts`];
  }
  const rootKeys = rec["keys"] as Out;
  if (rootKeys.status !== 0) {
    try {
      keys(doc);
    } catch {
      return [];
    }
    return [`${name}: yq rejects keys, reader accepts`];
  }
  const expectKeys = rootKeys.stdout
    .split("\n")
    .filter((l) => l !== "")
    .flatMap((l) => JSON.parse(l) as unknown[])
    .map(String);
  if (doc instanceof YqMap || doc instanceof YqSeq) {
    const got = keys(doc);
    if (JSON.stringify(got) !== JSON.stringify(expectKeys))
      diffs.push(`${name}: keys ${got} != ${expectKeys}`);
  }
  for (const k of expectKeys) {
    const node = get(doc, [k]);
    const coll = node instanceof YqMap || node instanceof YqSeq;
    const checks: [string, string][] = [
      ["tag", tag(node)],
      ["length", String(length(node))],
    ];
    if (!coll) {
      checks.push(["get", render(node)], ["default", getOrEmpty(doc, [k])]);
    }
    for (const [acc, got] of checks) {
      const want = yqLine(rec[`${k} | ${acc}`]);
      if (got !== want)
        diffs.push(
          `${name}.${k} ${acc}: reader ${JSON.stringify(got)} != yq ${JSON.stringify(want)}`,
        );
    }
  }
  return diffs;
}

describe("yq-accessors spike versus real yq v4.44.3", () => {
  it("lists the classes the reader cannot match", () => {
    const gaps = new Map<string, string[]>();
    for (const name of Object.keys(oracle)) {
      const d = compareClass(name);
      if (d.length > 0) gaps.set(name, d);
    }
    for (const [n, d] of gaps) console.log(`GAP ${n}\n  ${d.join("\n  ")}`);
    assert.deepEqual([...gaps.keys()].sort(), KNOWN_GAPS);
  });
  it("keeps integer-like keys in document order", () => {
    assert.deepEqual(keys(loadYq("z: 1\n10: 2\n2: 3\na: 4\n")), ["z", "10", "2", "a"]);
  });
});
