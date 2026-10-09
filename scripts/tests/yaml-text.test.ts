// yaml-text.test.ts — unit suite for scripts/lib/yaml-text.ts (spec 0250 R11).
//
// Every R11 bullet is asserted on a named fixture, against the real `js-yaml`
// (scripts/tests/lib/yaml-lib.ts). Where R11 claims parity with `yq -r`, a small
// set of the same fixtures is also compared with `yq` when a mikefarah `yq` is on
// the PATH (never on win32); the exhaustive corpus comparison is a separate suite.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { describe, test } from "node:test";

import { toYamlLib, type YamlPath } from "../lib/yaml-text.ts";
import { docOf, yamlLib, yamlText as y } from "./lib/yaml-lib.ts";

const yqVersion =
  process.platform === "win32"
    ? undefined
    : spawnSync("yq", ["--version"], { encoding: "utf8" }).stdout;
const noYq = yqVersion?.includes("mikefarah") ? undefined : "skipped: mikefarah yq not available";

/** `yq -r <expr>` as the shell saw it: trailing line feeds stripped, error is empty. */
function yq(text: string, expr: string, keepLfs = false): string {
  const run = spawnSync("yq", ["-r", expr], { input: text, encoding: "utf8" });
  if (run.status !== 0) return "";
  return keepLfs ? run.stdout.replace(/\n$/, "") : run.stdout.replace(/\n+$/, "");
}
const dotted = (path: string): string => (path === "" ? "." : `.${path}`);

/** name, source, key path, expected text, and `true` when R11 claims no `yq` parity. */
type Row = readonly [name: string, yaml: string, path: string, want: string, noYq?: true];

const LONG = "word ".repeat(120).trim();
const plainRows: readonly Row[] = [
  ["number-like 1.0", "a: 1.0\n", "a", "1.0"],
  ["number-like hex 0x1F", "a: 0x1F\n", "a", "0x1F"],
  ["number-like octal-looking 007", "a: 007\n", "a", "007"],
  ["number-like exponent 1e3", "a: 1e3\n", "a", "1e3"],
  ["boolean-like True", "a: True\n", "a", "True"],
  ["boolean-like yes", "a: yes\n", "a", "yes"],
  ["boolean false is written text", "a: false\n", "a", "false"],
  ["null spelling ~", "a: ~\n", "a", "~"],
  ["null spelling null", "a: null\n", "a", "null"],
  ["empty value renders empty text", "a:\n", "a", ""],
  ["quoted number (double)", 'a: "12"\n', "a", "12"],
  ["quoted number (single)", "a: '1.0'\n", "a", "1.0"],
  ["absent key renders null", "b: 1\n", "a", "null"],
  ["absent key under an empty parent", "a:\n", "a.b", "null"],
  ["literal | clips, then LFs removed", "a: |\n  x\n  y\n\n\nb: z\n", "a", "x\ny"],
  ["literal |- strips", "a: |-\n  x\n\nb: z\n", "a", "x"],
  ["literal |+ keeps, then LFs removed", "a: |+\n  x\n\n\nb: z\n", "a", "x"],
  ["folded > with a blank line", "a: >\n  x\n  y\n\n  z\n\nb: z\n", "a", "x y\nz"],
  ["folded >- strips", "a: >-\n  x\n  y\nb: z\n", "a", "x y"],
  ["multi-line plain scalar", "a: one\n  two\n\n  three\n", "a", "one two\nthree"],
  ["multi-line double-quoted scalar", 'a: "one\n  two"\n', "a", "one two"],
  ["colon-space inside quotes", 'a: "k: v"\n', "a", "k: v"],
  ["long line is not wrapped", `a: ${LONG}\n`, "a", LONG],
  [
    "timestamp-looking value stays text",
    "a: 2001-12-14t21:59:43.10-05:00\n",
    "a",
    "2001-12-14t21:59:43.10-05:00",
  ],
  ["nested path", "m:\n  p:\n    v: 1.0\n", "m.p.v", "1.0"],
  ["read through a scalar is empty (yq error)", "a: x\n", "a.b", ""],
  ["read through a sequence is empty", "a: [1]\n", "a.b", ""],
  ["a mapping renders empty", "a: {k: v}\n", "a", "", true],
  ["a sequence renders empty", "a: [1]\n", "a", "", true],
  ["CRLF text", "a: x\r\nb: |\r\n  y\r\n  z\r\n", "b", "y\nz", true],
  ["BOM text", "\uFEFFa: x\n", "a", "x", true],
];

describe("plain: the text yq -r printed", () => {
  for (const [name, yaml, path, want] of plainRows)
    test(name, () => assert.equal(y.plain(docOf(yaml), path), want));
  test("a key path is a dotted string, a leading-dot string, or an array", () => {
    const doc = docOf("m:\n  v: 1.0\n");
    for (const path of ["m.v", ".m.v", ["m", "v"]] satisfies YamlPath[])
      assert.equal(y.plain(doc, path), "1.0");
  });
  test("empty and comment-only documents read as absent", () => {
    assert.equal(y.plain(docOf(""), "a"), "null");
    assert.equal(y.plain(docOf("# only a comment\n"), "a"), "null");
  });
  test("parity with yq -r", { skip: noYq }, () => {
    for (const [name, yaml, path, , noParity] of plainRows)
      if (noParity !== true) assert.equal(y.plain(docOf(yaml), path), yq(yaml, dotted(path)), name);
  });
});

const altRows: readonly [string, string, string][] = [
  ["absent key", "b: 1\n", ""],
  ["empty value", "a:\n", ""],
  ["null ~", "a: ~\n", ""],
  ["null null", "a: null\n", ""],
  ["null Null", "a: Null\n", ""],
  ["false", "a: false\n", ""],
  ["False", "a: False\n", ""],
  ["empty double-quoted string", 'a: ""\n', ""],
  ["empty single-quoted string", "a: ''\n", ""],
  ["zero is kept", "a: 0\n", "0"],
  ["0.0 is kept", "a: 0.0\n", "0.0"],
  ["quoted zero is kept", 'a: "0"\n', "0"],
  ["true", "a: true\n", "true"],
  ["a word that is not a YAML 1.2 boolean", "a: no\n", "no"],
  ["a version", "a: 1.0.0\n", "1.0.0"],
  ["block scalar, LFs removed", "a: |\n  v\n\n", "v"],
];

describe('alt: the // "" rule', () => {
  for (const [name, yaml, want] of altRows) {
    test(name, () => assert.equal(y.alt(docOf(yaml), "a"), want));
  }
  test("through an absent parent and through a scalar", () => {
    assert.equal(y.alt(docOf("b: 1\n"), "m.p.version"), "");
    assert.equal(y.alt(docOf("m: x\n"), "m.p"), "");
  });
  test("parity with yq -r", { skip: noYq }, () => {
    for (const [name, yaml] of altRows)
      assert.equal(y.alt(docOf(yaml), "a"), yq(yaml, '.a // ""'), name);
  });
});

describe("seq: .a // [] | .[]", () => {
  const items = 'a:\n  - 1\n  - 1.0\n  - true\n  - ~\n  - 007\n  - x y\n  - ""\n';
  test("elements in order, each rendered as its written scalar", () => {
    assert.deepEqual(y.seq(docOf(items), "a"), ["1", "1.0", "true", "~", "007", "x y", ""]);
  });
  test("a null element renders empty; a nested collection element renders empty", () => {
    assert.deepEqual(y.seq(docOf("a:\n  -\n  - [1]\n  - {k: v}\n"), "a"), ["", "", ""]);
  });
  test("a block-scalar element has its trailing LFs removed", () => {
    assert.deepEqual(y.seq(docOf("a:\n  - |\n    t\n  - u\n"), "a"), ["t", "u"]);
  });
  test("over a mapping, the values in order", () => {
    assert.deepEqual(y.seq(docOf("a:\n  z: 1\n  b: two\n"), "a"), ["1", "two"]);
  });
  test("absent, null, false, scalar and unparseable give no element", () => {
    for (const yaml of ["b: 1\n", "a:\n", "a: false\n", "a: x\n"])
      assert.deepEqual(y.seq(docOf(yaml), "a"), [], yaml);
    assert.deepEqual(y.seq(y.parse("a: [1, 2"), "a"), []);
  });
  test("parity with yq -r", { skip: noYq }, () => {
    for (const yaml of [items, "a:\n  z: 1\n  b: two\n", "b: 1\n", "a:\n", "a: x\n"]) {
      const lines = yq(yaml, ".a // [] | .[]", true);
      assert.deepEqual(y.seq(docOf(yaml), "a"), lines === "" ? [] : lines.split("\n"), yaml);
    }
  });
});

describe("has: key presence, whatever the value", () => {
  const doc = 'm:\n  s: 1\n  n: ~\n  e:\n  f: false\n  z: 0\n  q: ""\n  map: {k: v}\n  seq: [1]\n';
  const keys = ["s", "n", "e", "f", "z", "q", "map", "seq"];
  for (const key of keys) {
    test(`present with value kind ${key}`, () => assert.equal(y.has(docOf(doc), ["m", key]), true));
  }
  test("absent key, absent parent, scalar parent, sequence parent, empty path", () => {
    const d = docOf(`${doc}p: x\nl: [1]\n`);
    assert.equal(y.has(d, "m.nope"), false);
    assert.equal(y.has(d, "nope.k"), false);
    assert.equal(y.has(d, "p.k"), false);
    assert.equal(y.has(d, "l.k"), false);
    assert.equal(y.has(d, []), false);
  });
  test("metadata has provenance (the build's query)", () => {
    assert.equal(
      y.has(docOf("metadata:\n  provenance:\n    version: 1\n"), "metadata.provenance"),
      true,
    );
    assert.equal(y.has(docOf("metadata: x\n"), "metadata.provenance"), false);
  });
  test("parity with yq -r", { skip: noYq }, () => {
    const d = `${doc}p: x\nl: [1]\n`;
    const paths = [...keys.map((k) => `m.${k}`), "m.nope", "nope.k", "p.k", "l.k"];
    for (const path of paths) {
      const at = path.lastIndexOf(".");
      const expr = `${dotted(path.slice(0, at))} // {} | has("${path.slice(at + 1)}")`;
      assert.equal(y.has(docOf(d), path), yq(d, expr) === "true", path);
    }
  });
});

describe("entries: key, kind and text, in document order", () => {
  test("every kind, in order; a block scalar keeps its own trailing LF; a null is empty", () => {
    const doc = docOf(
      'a:\n  z: 1.0\n  b: |\n    t\n  n: ~\n  e:\n  s: [1]\n  m: {k: v}\n  q: "x"\n  t: 2001-01-01\n',
    );
    assert.deepEqual(y.entries(doc, "a"), [
      { key: "z", kind: "scalar", text: "1.0" },
      { key: "b", kind: "scalar", text: "t\n" },
      { key: "n", kind: "scalar", text: "" },
      { key: "e", kind: "scalar", text: "" },
      { key: "s", kind: "sequence", text: "" },
      { key: "m", kind: "mapping", text: "" },
      { key: "q", kind: "scalar", text: "x" },
      { key: "t", kind: "scalar", text: "2001-01-01" },
    ]);
  });
  test("a key spelled differently by the two schemas is still listed", () => {
    assert.deepEqual(
      y.entries(docOf("a:\n  1.0: x\n  ~: y\n"), "a").map((e) => e.key),
      ["1.0", "~"],
    );
  });
  test("absent, scalar and unparseable give no entry", () => {
    assert.deepEqual(y.entries(docOf("b: 1\n"), "a"), []);
    assert.deepEqual(y.entries(docOf("a: x\n"), "a"), []);
    assert.deepEqual(y.entries(y.parse("a: [1, 2"), "a"), []);
  });
});

describe("parse: unparseable input and the pinned schemas", () => {
  const rejected: readonly [string, string][] = [
    ["an unterminated flow sequence", "a: [1, 2"],
    ["a duplicate key", "a: 1\na: 2\n"],
    ["a non-core tag (!!binary)", "a: !!binary aGk=\n"],
    ["a non-core tag (!!set)", "a: !!set {x}\n"],
    ["a local tag", "a: !foo bar\n"],
    ["a core tag the failsafe load cannot resolve (!!int)", "a: !!int 5\n"],
  ];
  for (const [name, yaml] of rejected) {
    test(`${name} gives null, and every reader degrades to empty`, () => {
      const doc = y.parse(yaml);
      assert.equal(doc, null);
      assert.equal(y.plain(doc, "a"), "");
      assert.equal(y.alt(doc, "a"), "");
      assert.deepEqual(y.seq(doc, "a"), []);
      assert.equal(y.has(doc, "a"), false);
      assert.deepEqual(y.entries(doc, "a"), []);
    });
  }
  test("a core tag that both schemas know (!!str) is accepted", () => {
    assert.equal(y.plain(docOf("a: !!str 5\n"), "a"), "5");
  });
  test("a timestamp is text, never a Date (the library default would resolve one)", () => {
    for (const written of ["2001-01-01", "2001-12-14T21:59:43.10Z"]) {
      const doc = docOf(`a: ${written}\n`);
      assert.deepEqual(doc.core, { a: written });
      assert.equal(y.plain(doc, "a"), written);
      assert.ok((yamlLib.load(`a: ${written}\n`) as { a: unknown }).a instanceof Date);
    }
  });
  // DOCUMENTED DEVIATION (R11): yq expands a merge key (`.c.b` reads `1` below); the
  // build pins CORE_SCHEMA, which does not resolve `<<`, so the key stays a plain
  // entry and nothing is merged. No shipped source uses a merge key.
  test("a << key is an ordinary entry and merges nothing (documented deviation from yq)", () => {
    const src = "x: &x {b: 1}\nc:\n  <<: *x\n  d: 2\n";
    const doc = docOf(src);
    assert.equal(y.plain(doc, "c.b"), "null");
    assert.equal(y.has(doc, "c.b"), false);
    assert.deepEqual(
      y.entries(doc, "c").map((e) => [e.key, e.kind]),
      [
        ["<<", "mapping"],
        ["d", "scalar"],
      ],
    );
    assert.equal((yamlLib.load(src) as { c: { b?: unknown } }).c.b, 1); // the library default merges
  });
  // CHARACTERISATION, not a parity claim: the loader expands an alias to the value
  // it names, where `yq -r` prints the alias token (`*x`). No shipped source uses one.
  test("an alias to a scalar reads as the value it names (loader behaviour)", () => {
    assert.equal(y.plain(docOf("a: &x v\nb: *x\n"), "b"), "v");
  });
});

describe("toYamlLib", () => {
  test("narrows the real namespace and one wrapped under default", () => {
    for (const ns of [yamlLib, { default: yamlLib }, { default: { load: 1 }, ...yamlLib }])
      assert.equal(typeof toYamlLib(ns).load, "function");
  });
  test("refuses a namespace without load, dump, CORE_SCHEMA and FAILSAFE_SCHEMA", () => {
    for (const ns of [undefined, null, {}, { load() {}, dump() {} }])
      assert.throws(() => toYamlLib(ns), TypeError);
  });
});
