// model-mapping-fixtures.ts — shared fixtures of the check-model-mappings replacement suites
// (spec 0265, row J2, P8). Replaces the `render_*` / `render_case_file` / `run_case` idiom of
// scripts/tests/test-check-model-mappings.sh: documents are objects, mutated on a
// `structuredClone` and dumped with the real js-yaml (`yamlLib`), never edited with `yq`.
//
// API:
//   baseDoc() / zeroOfferingsDoc() / orgSilentDoc()   fresh fixture objects
//   mutate(doc, fn)                                    clone, apply `fn`, return the clone
//   nth(list, i)                                       checked index (no `undefined`)
//   at(value, ...path)                                 walk an untyped js-yaml load
//   bareRoot()                                         a CREWRIG_REPO_DIR holding an empty model-mappings/
//   writeCase(stem, doc, org?)                         `<case dir>/<stem>[.org].yml`, outside the root
//   writeMapping(root, name, doc)                      `<root>/model-mappings/<name>`
//   runChecker(root, args?)                            the entry with CREWRIG_REPO_DIR=root
//   assertRejected(res, ids) / assertConform(res)      the `run_case` contract
// Nothing here deletes a path it did not create with mkdtemp (`makeSandbox`).

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { makeSandbox, REPO, runEntry, type RunResult } from "./governance-sandbox.ts";
import { yamlLib } from "./yaml-lib.ts";

export { REPO, yamlLib };

export const ENTRY = path.join(REPO, "scripts", "check-model-mappings.ts");

export interface Ground {
  declares: string;
  citation?: string;
  assumption?: string;
}
export interface Item {
  item: string;
  key?: string;
  domain?: { values: string[] };
  projection?: Record<string, string | undefined>;
  grounds: Ground[];
}
export interface Surface {
  id: string;
  kind: string;
  carries?: string[];
  template?: string;
  items: Item[];
}
export interface Offering {
  id: string;
  rank?: number;
  "native-value": string;
  provides: { intelligence?: string; specialization?: string };
  encodes?: Record<string, string>;
  "supports-reasoning-surface": boolean;
  grounds: Ground[];
}
export interface Term {
  id: string;
  statement: string;
  holds: boolean;
  evidence: string;
  grounds: Ground[];
}
export interface Doc {
  target: string;
  surfaces?: Surface[];
  offerings?: Offering[];
  guard?: { id: string; spec: string; state: string; terms: Term[] };
  [key: string]: unknown;
}

/** The element at `i`, or a thrown error: fixtures never index out of range. */
export function nth<T>(list: readonly T[] | undefined, i: number): T {
  const value = list?.[i];
  if (value === undefined) throw new Error(`fixture has no element ${i}`);
  return value;
}

/** Walk an untyped load by keys and indexes; `undefined` when a step is missing. */
export function at(value: unknown, ...steps: readonly (string | number)[]): unknown {
  let cur = value;
  for (const step of steps) {
    if (cur === null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string | number, unknown>)[step];
  }
  return cur;
}

const cite = (declares: string, citation: string): Ground => ({ declares, citation });

/** Minimal conformant Claude-shaped mapping: two offerings, frontmatter + guidance, a guard. */
export function baseDoc(): Doc {
  return {
    target: "claude",
    surfaces: [
      {
        id: "frontmatter",
        kind: "frontmatter",
        items: [
          {
            item: "model",
            key: "model",
            domain: { values: ["alpha", "beta"] },
            grounds: [cite("key", "cite-key"), cite("domain", "cite-domain")],
          },
          {
            item: "reasoning",
            key: "effort",
            domain: { values: ["low", "high"] },
            projection: {
              none: "unmapped",
              low: "low",
              medium: "low",
              high: "high",
              xhigh: "high",
              max: "high",
            },
            grounds: [cite("key", "cite-key2"), cite("domain", "cite-domain2")],
          },
        ],
      },
      {
        id: "guidance",
        kind: "guidance",
        carries: ["model", "reasoning"],
        template: "Run on {{model}}.\nUse {{reasoning}} effort.\n",
        items: [
          { item: "model", grounds: [{ declares: "item", assumption: "assume-model" }] },
          { item: "reasoning", grounds: [{ declares: "item", assumption: "assume-reasoning" }] },
        ],
      },
    ],
    offerings: [
      {
        id: "alpha",
        rank: 1,
        "native-value": "alpha",
        provides: { intelligence: "medium", specialization: "general" },
        encodes: { intelligence: "alpha" },
        "supports-reasoning-surface": false,
        grounds: [
          cite("native-value", "cite-nv-alpha"),
          cite("provides.intelligence", "cite-pi-alpha"),
          { declares: "supports-reasoning-surface", assumption: "assume-srs" },
          cite("supports-reasoning-surface.behavior", "cite-behavior"),
        ],
      },
      {
        id: "beta",
        rank: 2,
        "native-value": "beta",
        provides: { intelligence: "xxhigh", specialization: "general" },
        encodes: { intelligence: "beta" },
        "supports-reasoning-surface": true,
        grounds: [
          cite("native-value", "cite-nv-beta"),
          cite("provides.intelligence", "cite-pi-beta"),
        ],
      },
    ],
    guard: {
      id: "g1",
      spec: "spec ref",
      state: "withheld",
      terms: [
        {
          id: "t1",
          statement: "s1",
          holds: true,
          evidence: "e1",
          grounds: [cite("holds", "cite-t1")],
        },
        {
          id: "t2",
          statement: "s2",
          holds: false,
          evidence: "e2",
          grounds: [cite("holds", "cite-t2")],
        },
      ],
    },
  };
}

/** A valid, minimal ZERO-OFFERINGS mapping (spec 0197 R49's own scenario). */
export function zeroOfferingsDoc(): Doc {
  return {
    target: "gemini",
    surfaces: [
      {
        id: "frontmatter",
        kind: "frontmatter",
        items: [
          {
            item: "model",
            key: "model",
            domain: { values: ["only-model"] },
            grounds: [cite("key", "cite-key"), cite("domain", "cite-domain")],
          },
        ],
      },
    ],
    offerings: [],
  };
}

/** A valid org channel file declaring nothing (the shipped stub, spec 0199 R7). */
export function orgSilentDoc(): Doc {
  return { target: "claude" };
}

/** A fresh clone of `doc` with `fn` applied; `fn` may return nothing. */
export function mutate(doc: Doc, ...fns: ((d: Doc) => void)[]): Doc {
  const copy = structuredClone(doc);
  for (const fn of fns) fn(copy);
  return copy;
}

/** A bare CREWRIG_REPO_DIR: only an empty `model-mappings/` (no tier discovery, no drift guard). */
export function bareRoot(): string {
  const root = makeSandbox("crewrig-cmm-");
  fs.mkdirSync(path.join(root, "model-mappings"));
  return root;
}

let sandboxes: string | undefined;
let counter = 0;
/** `<case dir>/<stem>[.org].yml`, written outside every root; returns the absolute path. */
export function writeCase(stem: string, doc: object | string, org = false): string {
  sandboxes ??= makeSandbox("crewrig-cmm-cases-");
  const dir = path.join(sandboxes, `case-${(counter += 1)}`);
  fs.mkdirSync(dir);
  const file = path.join(dir, `${stem}${org ? ".org" : ""}.yml`);
  fs.writeFileSync(file, typeof doc === "string" ? doc : yamlLib.dump(doc));
  return file;
}

/** `<root>/model-mappings/<name>` from an object or literal text; returns the path. */
export function writeMapping(root: string, name: string, doc: object | string): string {
  const file = path.join(root, "model-mappings", name);
  fs.writeFileSync(file, typeof doc === "string" ? doc : yamlLib.dump(doc));
  return file;
}

/** The entry against `root` (CREWRIG_REPO_DIR), hermetic child environment. */
export function runChecker(root: string, args: readonly string[] = []): RunResult {
  return runEntry(ENTRY, { env: { CREWRIG_REPO_DIR: root }, args });
}

const combined = (res: RunResult): string => `${res.stdout}${res.stderr}`;

/** Exit 1 and, per id, `: <ID> ` in the union of both streams (the `run_case` contract). */
export function assertRejected(res: RunResult, ids: readonly string[]): void {
  assert.equal(res.status, 1, combined(res));
  for (const id of ids)
    assert.ok(combined(res).includes(`: ${id} `), `no ': ${id} ' in ${combined(res)}`);
}

/** Exit 0 with empty stderr (strengthening 7 of the spec mapping). */
export function assertConform(res: RunResult): void {
  assert.equal(res.status, 0, combined(res));
  assert.equal(res.stderr, "");
}
