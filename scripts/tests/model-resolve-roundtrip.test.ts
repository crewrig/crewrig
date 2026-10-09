// model-resolve-roundtrip.test.ts — the property of plan finding v1-F2 (spec 0250 R20, R33(h)):
// after the merge writes its document and either reader loads it again, every `plain`, `alt`,
// `seq`, `has` and `entries` result over the merged document equals the same result over the
// source it was merged from, and `yq` agrees on every node's path, kind, tag and written text.
//
// The merge has its own emitter (strings double-quoted, numbers, booleans and nulls keep the
// characters they were written with, an empty value stays empty), so the awkward scalars below
// are the ones a plain `dump` would have corrupted: strings that spell a boolean, a null, a
// number or a float, floats whose trailing zero a typed round trip drops, empty values, a dotted
// key, keys that are YAML 1.1 words and U+2028. The `yq` half runs on Linux (or macOS with
// CREWRIG_SHELL_PARITY=1) when mikefarah `yq` is present, and is skipped visibly otherwise.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { after, describe, test } from "node:test";

import type { YamlDoc } from "../lib/yaml-text.ts";
import { elementAt } from "../lib/model-resolve/yaml-nodes.ts";
import {
  cleanupTmp,
  docOf,
  idsOf,
  makeRun,
  mergeOf,
  mkTmp,
  orgRoot,
  resolveProbe,
  writeProfile,
  yamlText as y,
} from "./fixtures/build-components/model-resolve-kit.ts";

after(cleanupTmp);
const LS = String.fromCharCode(0x2028);
// Every value is written exactly as the org author wrote it; `awk` sorts last (rank 1000).
const AWKWARD = `target: claude
offerings:
  - id: awk
    rank: 1000
    native-value: "true"
    provides:
      intelligence: "null"
      context: "007"
      speed: "1e3"
      locality: 0.0
      specialization: 2.0
      modalities: [True, "~", ~, "", "007", 0.0, "1e3"]
    encodes:
      reasoning: ~
      dotted.key: x
      "dotted.key.2": "y"
      empty:
      on: 1
      "null": 2
      y: "n"
      tilde: ~
      sep: "one${LS}two"
      sep.escaped: "one\\u2028two"
      "nel": "one\\u0085two"
      "del": "one\\u007ftwo"
      bom: "\\ufeffone"
      "007": s
      "1.0": s
      "a: b": s
      "#hash": s
      "true": s
      "~": s
      "- dash": s
    supports-reasoning-surface: True
    grounds:
      - declares: "true"
        assumption:
      - declares: 007
        citation: "null"
`;

/** One line per node: path, then what every reader answers there. */
function readings(doc: YamlDoc, label: string[] = [], path: string[] = []): string[] {
  const here = [
    label,
    path,
    y.plain(doc, path),
    y.alt(doc, path),
    y.has(doc, path),
    y.seq(doc, path),
    y.entries(doc, path),
  ];
  const lines = [JSON.stringify(here)];
  const { text } = path.length === 0 ? doc : { text: pick(doc.text, path) };
  if (Array.isArray(text)) {
    text.forEach((_, i) => {
      const item = elementAt(
        path.length === 0 ? doc : sub(doc, path),
        path.length === 0 ? [] : [],
        i,
      );
      if (item !== null) lines.push(...readings(item, [...label, ...path, String(i)]));
    });
  } else if (typeof text === "object" && text !== null) {
    for (const key of Object.keys(text)) lines.push(...readings(doc, label, [...path, key]));
  }
  return lines;
}
function pick(text: unknown, path: string[]): unknown {
  return path.reduce<unknown>(
    (node, key) => (typeof node === "object" && node !== null ? Reflect.get(node, key) : undefined),
    text,
  );
}
function sub(doc: YamlDoc, path: string[]): YamlDoc {
  return { core: pick(doc.core, path), text: pick(doc.text, path) };
}

const root = orgRoot("claude", AWKWARD);
const merged = mergeOf(root);
const orgFile = `${root}/model-mappings/claude.org.yml`;
const at = idsOf(merged.handle).indexOf("awk");

describe("the awkward offering survives the merge", () => {
  test("it is in the merged document, last by rank, and the merge did not throw", () => {
    assert.deepEqual([at, idsOf(merged.handle).length], [4, 5]);
    assert.deepEqual(merged.err, ["mapping-merge\tclaude\tofferings/awk\tadded"]);
  });

  test("TypeScript readers: every plain, alt, seq, has and entries result equals the source's", () => {
    const source = elementAt(docOf(fs.readFileSync(orgFile, "utf8")), ["offerings"], 0);
    const after = elementAt(docOf(fs.readFileSync(merged.handle, "utf8")), ["offerings"], at);
    assert.ok(source !== null && after !== null);
    const [want, got] = [readings(source), readings(after)];
    assert.ok(want.length > 30, `the walk covers ${want.length} nodes`);
    assert.deepEqual(got, want);
  });

  test("the awkward strings are still strings, and the numbers still numbers, under the CORE reader", () => {
    const el = elementAt(docOf(fs.readFileSync(merged.handle, "utf8")), ["offerings"], at);
    const provides = (el?.core as { provides: Record<string, unknown> }).provides;
    assert.deepEqual(
      [provides["intelligence"], provides["context"], provides["speed"]],
      ["null", "007", "1e3"],
    );
    assert.deepEqual([provides["locality"], provides["specialization"]], [0, 2]);
    assert.equal(y.plain(el, ["provides", "locality"]), "0.0");
    assert.equal(y.plain(el, ["encodes", "sep"]), `one${LS}two`);
  });

  test("a nested empty value is carried as empty, not as the text null", () => {
    const el = elementAt(docOf(fs.readFileSync(merged.handle, "utf8")), ["offerings"], at);
    assert.deepEqual(
      [
        y.plain(el, ["encodes", "empty"]),
        y.alt(el, ["encodes", "empty"]),
        y.has(el, ["encodes", "empty"]),
      ],
      ["", "", true],
    );
  });

  test("the merged offering still resolves: the awkward fields do not break selection", () => {
    const run = makeRun(root, { MAPPING_MERGE_DIR: merged.mergeDir });
    const r = resolveProbe(run, writeProfile(mkTmp(), "intelligence: max"), "claude");
    assert.deepEqual([r.offeringId, r.nativeValue], ["fable", "fable"]);
  });
});

const yqOk =
  (process.platform === "linux" || process.env["CREWRIG_SHELL_PARITY"] === "1") &&
  (spawnSync("yq", ["--version"], { encoding: "utf8" }).stdout ?? "").includes("mikefarah");
const noYq = yqOk
  ? undefined
  : "skipped: needs Linux (or CREWRIG_SHELL_PARITY=1) with mikefarah yq";
const EXPR =
  '.. | (path | @json) + "\\t" + kind + "\\t" + tag + "\\t" + (select(kind == "scalar") | to_string) // (length | tostring)';

describe("yq reads the merged document as it reads the source", () => {
  // `path` is absolute in yq: drop the leading ["offerings", <index>] so both sides compare.
  const yq = (file: string, index: number): string[] => {
    const run = spawnSync("yq", ["-r", `.offerings[${index}] | ${EXPR}`, file], {
      encoding: "utf8",
    });
    assert.equal(run.status, 0, run.stderr);
    return run.stdout.split("\n").map((line) => {
      const [path = "", ...rest] = line.split("\t");
      const keys: unknown = JSON.parse(path === "" ? "[]" : path);
      return [JSON.stringify(Array.isArray(keys) ? keys.slice(2) : keys), ...rest].join("\t");
    });
  };

  test("every node has the same path, kind, tag and written text", { skip: noYq }, () => {
    const [want, got] = [yq(orgFile, 0), yq(merged.handle, at)];
    assert.ok(want.length > 30, `the query lists ${want.length} lines`);
    assert.deepEqual(got, want);
  });

  test("the awkward scalars keep the tag they were written with", { skip: noYq }, () => {
    const tags = new Map(
      yq(merged.handle, at)
        .map((l) => l.split("\t"))
        .map((c) => [c[0] ?? "", c[2] ?? ""]),
    );
    assert.equal(tags.get('["provides","intelligence"]'), "!!str");
    assert.equal(tags.get('["provides","context"]'), "!!str");
    assert.equal(tags.get('["provides","locality"]'), "!!float");
    assert.equal(tags.get('["supports-reasoning-surface"]'), "!!bool");
    assert.equal(tags.get('["encodes","reasoning"]'), "!!null");
    assert.equal(tags.get('["encodes","empty"]'), "!!null");
    assert.equal(tags.get('["encodes","dotted.key"]'), "!!str");
  });
});
