// check-agent-profiles-rejections.test.ts — the rejection coverage of
// scripts/check-agent-profiles.ts: a conformant baseline, then one single-cell mutation per
// assertion id P1-P11 (spec 0195 R23-R25, spec 0198 R36-R39; spec 0265, row J2, P8).
// Replaces scripts/tests/test-check-agent-profiles.sh (section 1). The Bash section 3 (exit 2
// without yq on PATH) is not replaced here: the TypeScript entry has no yq prerequisite, and its
// green-without-yq replacement is an I2 test, model-ci-tooling-agent-profiles.test.ts.
//
// P6 is the assertion id of this checker (speed / locality / modalities member); it is unrelated
// to the `test-check-ci-parity.sh` fixture-only case P6. P6 and P8 bundle several distinct
// predicates under one id, hence three and seven mutations. Every row asserts the exit code and
// that `: <ID> ` appears in stdout+stderr (the union, as the Bash `2>&1` did).

import assert from "node:assert/strict";
import path from "node:path";
import { describe, test } from "node:test";

import { modelOf, writeSource, type Doc } from "./lib/agent-profile-fixtures.ts";
import { makeSandbox, REPO, runEntry } from "./lib/governance-sandbox.ts";

const ENTRY = path.join(REPO, "scripts", "check-agent-profiles.ts");

const sandbox = makeSandbox("agent-profiles-rej-");
let counter = 0;

/** Write the mutated source in a fresh directory and run the entry on that one file. */
function check(mutate?: (doc: Doc) => void): { code: number | null; out: string } {
  const file = writeSource(path.join(sandbox, `case-${(counter += 1)}`), "probe", mutate);
  const r = runEntry(ENTRY, { args: [file] });
  return { code: r.status, out: r.stdout + r.stderr };
}

const tuning = (doc: Doc): Doc => modelOf(doc)["tuning"] as Doc;

interface Row {
  readonly title: string;
  readonly id: string;
  readonly mutate: (doc: Doc) => void;
}

const set = (key: string, value: unknown) => (doc: Doc) => {
  modelOf(doc)[key] = value;
};
const knob = (key: string, value: unknown) => (doc: Doc) => {
  tuning(doc)[key] = value;
};

const ROWS: readonly Row[] = [
  {
    title: "P1 — metadata.model is not a mapping",
    id: "P1",
    mutate: (doc) => {
      (doc["metadata"] as Doc)["model"] = "not-a-map";
    },
  },
  { title: "P2 — unknown metadata.model key", id: "P2", mutate: set("bogus", "x") },
  { title: "P3 — unknown tuning key", id: "P3", mutate: knob("bogus-knob", 1) },
  { title: "P4 — intelligence outside domain", id: "P4", mutate: set("intelligence", "bogus") },
  {
    title: "P4 — intelligence: sonnet is rejected (a model alias, not a rung; spec 0200 R38)",
    id: "P4",
    mutate: set("intelligence", "sonnet"),
  },
  { title: "P5 — reasoning outside domain", id: "P5", mutate: set("reasoning", "off") },
  { title: "P6 — speed outside domain", id: "P6", mutate: set("speed", "bogus") },
  { title: "P6 — locality outside domain", id: "P6", mutate: set("locality", "bogus") },
  {
    title: "P6 — modalities member outside domain",
    id: "P6",
    mutate: set("modalities", ["text", "bogus"]),
  },
  { title: "P7 — context not a positive integer", id: "P7", mutate: set("context", 0) },
  {
    title: "P8 — temperature above its closed ceiling",
    id: "P8",
    mutate: knob("temperature", 5.0),
  },
  { title: "P8 — temperature wrong type", id: "P8", mutate: knob("temperature", "hot") },
  { title: "P8 — top-p at the open floor (forbidden)", id: "P8", mutate: knob("top-p", 0) },
  { title: "P8 — top-p above its closed ceiling", id: "P8", mutate: knob("top-p", 1.5) },
  { title: "P8 — top-k below its integer minimum", id: "P8", mutate: knob("top-k", 0) },
  {
    title: "P8 — max-output-tokens below its integer minimum",
    id: "P8",
    mutate: knob("max-output-tokens", 0),
  },
  { title: "P8 — max-turns below its integer minimum", id: "P8", mutate: knob("max-turns", 0) },
  {
    title: "P9 — specialization not kebab-case",
    id: "P9",
    mutate: set("specialization", "Not_Kebab"),
  },
  {
    title: "P10 — tuning is a list, not a mapping (the v3-F4 case)",
    id: "P10",
    mutate: set("tuning", ["a", "b"]),
  },
  { title: "P10 — tuning is a scalar, not a mapping", id: "P10", mutate: set("tuning", 3) },
  {
    title: "P11 — modalities is a scalar, not a list",
    id: "P11",
    mutate: set("modalities", "text"),
  },
  {
    title: "P11 — modalities is a mapping, not a list",
    id: "P11",
    mutate: set("modalities", { a: "text" }),
  },
];

describe("check-agent-profiles.ts rejections (spec 0198 R36-R39)", () => {
  test("baseline conforms", () => {
    const { code, out } = check();
    assert.equal(code, 0, out);
    assert.doesNotMatch(out, /: P\d+ /);
  });

  for (const row of ROWS) {
    test(row.title, () => {
      const { code, out } = check(row.mutate);
      assert.equal(code, 1, out);
      assert.ok(out.includes(`: ${row.id} `), `expected ": ${row.id} " in:\n${out}`);
    });
  }
});
