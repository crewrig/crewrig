// skill-evals-case-hash.test.ts — the case hash of an eval and the eval-list check (spec 0304 R14).
// The hash is recomputed here from the spec's definition, byte for byte, so the implementation is
// checked against the text and not against itself.

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";

import {
  canonicalJson,
  caseHash,
  caseHashesOf,
  caseProblem,
} from "../lib/skill-evals/case-hash.ts";
import { tmpDir } from "./lib/skill-evals-fixtures.ts";

const HASH = /^sha256:[0-9a-f]{64}$/;

/** The definition of R14, written out: canonical JSON, NUL, then path NUL size NUL bytes NUL per file. */
function reference(entry: unknown, files: { path: string; bytes: Buffer }[]): string {
  const canon = (v: unknown): string =>
    Array.isArray(v)
      ? `[${v.map(canon).join(",")}]`
      : typeof v === "object" && v !== null
        ? `{${Object.keys(v)
            .sort()
            .map((k) => `${JSON.stringify(k)}:${canon((v as Record<string, unknown>)[k])}`)
            .join(",")}}`
        : JSON.stringify(v);
  const h = createHash("sha256");
  h.update(Buffer.from(canon(entry), "utf8"));
  h.update(Buffer.from([0]));
  for (const f of [...files].sort((a, b) =>
    Buffer.compare(Buffer.from(a.path), Buffer.from(b.path)),
  )) {
    h.update(Buffer.from(f.path, "utf8"));
    h.update(Buffer.from([0]));
    h.update(Buffer.from(String(f.bytes.length), "ascii"));
    h.update(Buffer.from([0]));
    h.update(f.bytes);
    h.update(Buffer.from([0]));
  }
  return `sha256:${h.digest("hex")}`;
}

const entry = {
  id: 1,
  prompt: "p é",
  expected_output: "o",
  files: ["b.txt", "a.txt"],
  expectations: ["e"],
  checks: [],
};
const files = [
  { path: "b.txt", bytes: Buffer.from("bee\n") },
  { path: "a.txt", bytes: Buffer.from([0, 1, 2, 255]) },
];

test("the case hash is sha256: and 64 lowercase hex digits, equal to the definition of R14", () => {
  const h = caseHash(entry, files);
  assert.match(h, HASH);
  assert.equal(h, reference(entry, files));
});

test("key order, whitespace of the source and the order of the fixture list do not change the hash", () => {
  const shuffled = {
    checks: [],
    expectations: ["e"],
    files: ["b.txt", "a.txt"],
    expected_output: "o",
    prompt: "p é",
    id: 1,
  };
  assert.equal(caseHash(shuffled, files), caseHash(entry, files));
  assert.equal(caseHash(entry, [...files].reverse()), caseHash(entry, files));
  assert.equal(
    canonicalJson({ b: 1, a: { d: [2, { z: 1, y: 2 }], c: null } }),
    '{"a":{"c":null,"d":[2,{"y":2,"z":1}]},"b":1}',
  );
});

test("a changed prompt, expectation, check or fixture byte changes the hash", () => {
  const base = caseHash(entry, files);
  assert.notEqual(caseHash({ ...entry, prompt: "p é!" }, files), base);
  assert.notEqual(caseHash({ ...entry, expectations: ["e2"] }, files), base);
  assert.notEqual(
    caseHash({ ...entry, checks: [{ type: "file_exists", path: "x" }] }, files),
    base,
  );
  assert.notEqual(
    caseHash(entry, [files[0]!, { path: "a.txt", bytes: Buffer.from([0, 1, 2, 254]) }]),
    base,
  );
  assert.notEqual(caseHash(entry, [files[0]!, { ...files[1]!, path: "c.txt" }]), base);
});

test("the NUL separators and the size keep two different file sets apart", () => {
  const a = caseHash(entry, [{ path: "a", bytes: Buffer.from("bc") }]);
  const b = caseHash(entry, [{ path: "ab", bytes: Buffer.from("c") }]);
  assert.notEqual(a, b);
});

test("caseHashesOf reads the fixtures from the skill directory, by eval id", () => {
  const dir = tmpDir("skill-evals-case-");
  try {
    fs.mkdirSync(path.join(dir, "evals", "files"), { recursive: true });
    fs.writeFileSync(path.join(dir, "evals/files/in.txt"), "input\n");
    const e1 = {
      id: 1,
      prompt: "p",
      expected_output: "o",
      files: ["evals/files/in.txt"],
      expectations: [],
    };
    const e2 = { id: 2, prompt: "q", expected_output: "o", files: [], expectations: [] };
    const text = JSON.stringify({ skill_name: "demo", evals: [e1, e2] });
    const m = caseHashesOf(text, dir);
    assert.equal(
      m.get(1),
      reference(e1, [{ path: "evals/files/in.txt", bytes: Buffer.from("input\n") }]),
    );
    assert.equal(m.get(2), reference(e2, []));
    fs.writeFileSync(path.join(dir, "evals/files/in.txt"), "input edited\n");
    assert.notEqual(
      caseHashesOf(text, dir).get(1),
      m.get(1),
      "a fixture edit changes only its eval",
    );
    assert.equal(caseHashesOf(text, dir).get(2), m.get(2));
    assert.equal(caseHashesOf("{not json", dir).size, 0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("caseProblem names an eval that is added, removed or changed, and is silent when they agree", () => {
  const rec = new Map([
    [1, "sha256:a"],
    [2, "sha256:b"],
  ]);
  assert.equal(caseProblem(rec, new Map(rec)), undefined);
  assert.match(
    caseProblem(
      rec,
      new Map([
        [1, "sha256:a"],
        [2, "sha256:b"],
        [7, "sha256:c"],
      ]),
    ) ?? "",
    /eval 7 is in the tree but was not recorded/,
  );
  assert.match(
    caseProblem(rec, new Map([[1, "sha256:a"]])) ?? "",
    /eval 2 was recorded but is absent from the tree/,
  );
  assert.match(
    caseProblem(
      rec,
      new Map([
        [1, "sha256:a"],
        [2, "sha256:x"],
      ]),
    ) ?? "",
    /eval 2 changed after the measurement/,
  );
});
