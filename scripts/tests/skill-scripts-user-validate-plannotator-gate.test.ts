// Black-box test of user-validate/scripts/plannotator-gate.ts. A fake `plannotator` is injected
// through PATH; the real binary is never needed and no browser opens.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, describe, test } from "node:test";

import { envelope, run, tempDir } from "./lib/skill-scripts-governance-cli.ts";

const tmp = tempDir("plannotator-gate-");
after(() => fs.rmSync(tmp, { recursive: true, force: true }));
const fake = (name: string, body: string): string => {
  const bin = path.join(tmp, name);
  fs.mkdirSync(bin, { recursive: true });
  const f = path.join(bin, "plannotator");
  fs.writeFileSync(f, `#!/bin/sh\n${body}\n`);
  fs.chmodSync(f, 0o755);
  return bin;
};
const doc = path.join(tmp, "doc.md");
fs.writeFileSync(doc, "# doc\n");
const gate = (args: string[], bin?: string) =>
  run(
    "user-validate",
    "plannotator-gate.ts",
    [...args, "--json"],
    bin === undefined ? {} : { bin },
  );
const REPLY = (reply: string, code = 0): string =>
  `if [ "$1" = "--version" ]; then echo "plannotator 9.9"; exit 0; fi\n` +
  `[ "$1 $3 $4" = "annotate --gate --json" ] || { echo "bad argv: $*" >&2; exit 64; }\n` +
  `printf '%s' '${reply}'\nexit ${code}`;

describe("plannotator-gate map", () => {
  const map = (code: number, stdout: string) => {
    const f = path.join(tmp, "out.txt");
    fs.writeFileSync(f, stdout);
    return gate(["map", "--exit-code", String(code), "--stdout-file", f]);
  };
  test("approved", () => {
    const r = map(0, '{"decision":"approved"}');
    assert.equal(r.status, 0);
    assert.equal(envelope(r).data?.["outcome"], "approved");
  });
  test("annotated carries the feedback as changes-requested", () => {
    const e = envelope(map(0, '{"decision":"annotated","feedback":"Tighten section 2"}'));
    assert.equal(e.data?.["outcome"], "changes-requested");
    assert.equal(e.data?.["feedback"], "Tighten section 2");
  });
  test("dismissed, non-zero exit, malformed and unknown decisions are rejected with exit 1", () => {
    for (const [code, out, rule] of [
      [0, '{"decision":"dismissed"}', "dismissed"],
      [1, '{"decision":"approved"}', "non-zero-exit"],
      [0, "Review closed", "malformed-output"],
      [0, "", "malformed-output"],
      [0, '{"decision":"maybe"}', "unknown-decision"],
    ] as const) {
      const r = map(code, out);
      assert.equal(r.status, 1, out);
      const e = envelope(r);
      assert.equal(e.data?.["outcome"], "rejected");
      assert.equal(e.findings[0]?.rule, rule);
    }
  });
  test("standard input and a missing file", () => {
    const r = run(
      "user-validate",
      "plannotator-gate.ts",
      ["map", "--exit-code", "0", "--stdout-file", "-"],
      {
        input: '{"decision":"approved"}',
      },
    );
    assert.equal(r.status, 0);
    assert.equal(
      gate(["map", "--exit-code", "0", "--stdout-file", path.join(tmp, "nope")]).status,
      3,
    );
  });
  test("--exit-code is required and must be an integer", () => {
    assert.equal(gate(["map"]).status, 2);
    assert.equal(gate(["map", "--exit-code", "x"]).status, 2);
  });
});

describe("plannotator-gate check and run", () => {
  test("check without plannotator exits 3 with a fallback message", () => {
    const r = gate(["check"], path.join(tmp, "empty-bin"));
    assert.equal(r.status, 3);
    const e = envelope(r);
    assert.equal(e.findings[0]?.rule, "precondition");
    assert.match(e.findings[0]?.message ?? "", /internal backend/);
  });
  test("check with a fake plannotator reports the version", () => {
    const r = gate(["check"], fake("ok", REPLY("")));
    assert.equal(r.status, 0);
    assert.equal(envelope(r).data?.["version"], "plannotator 9.9");
  });
  test("run invokes `annotate <file> --gate --json` and maps an approval", () => {
    const r = gate(["run", doc], fake("approve", REPLY('{"decision":"approved"}')));
    assert.equal(r.status, 0, r.stderr);
    assert.equal(envelope(r).data?.["outcome"], "approved");
  });
  test("run maps annotated to changes-requested", () => {
    const r = gate(
      ["run", doc],
      fake("annot", REPLY('{"decision":"annotated","feedback":"fix it"}')),
    );
    const e = envelope(r);
    assert.equal(r.status, 0);
    assert.equal(e.data?.["outcome"], "changes-requested");
    assert.equal(e.data?.["feedback"], "fix it");
  });
  test("run with a non-zero exit is rejected (exit 1)", () => {
    const r = gate(["run", doc], fake("fail", REPLY('{"decision":"approved"}', 3)));
    assert.equal(r.status, 1);
    assert.equal(envelope(r).data?.["outcome"], "rejected");
  });
  test("run without plannotator exits 3, run on a missing file exits 3, run without file exits 2", () => {
    assert.equal(gate(["run", doc], path.join(tmp, "empty-bin")).status, 3);
    assert.equal(gate(["run", path.join(tmp, "nope.md")], fake("ok2", REPLY(""))).status, 3);
    assert.equal(gate(["run"]).status, 2);
  });
  test("--help and bad usage", () => {
    const h = run("user-validate", "plannotator-gate.ts", ["--help"]);
    assert.equal(h.status, 0);
    assert.match(h.stdout, /^Usage:/);
    assert.equal(gate(["frobnicate"]).status, 2);
    assert.equal(gate([]).status, 2);
    assert.equal(gate(["check", "--exit-code", "0"]).status, 2);
  });
});
