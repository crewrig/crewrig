// skill-scripts-pr-logbook-flip-spec.test.ts — black-box test of
// pr-logbook/scripts/flip-spec-status.ts (spec 0292 R9, R14, R16), written from the spec.
// Every case works on a copy in a temp directory; the fixture is never modified.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, describe, test } from "node:test";

import { FIXTURES, parseEnvelope, run, tempDir } from "./lib/skill-scripts-pr-logbook-cli.ts";

const tmp = tempDir("pr-logbook-flip-");
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

let n = 0;
function spec(text: string | Buffer): string {
  const p = path.join(tmp, `spec-${n++}.md`);
  fs.writeFileSync(p, text);
  return p;
}
const read = (p: string): string => fs.readFileSync(p, "utf8");
const doc = (statusLine: string, nl = "\n"): string =>
  ["---", 'id: "0001"', statusLine, "version: 1.0.0", "---", "", "# Title", "status: approved", ""].join(nl);

describe("flip-spec-status: flip", () => {
  test("approved becomes implemented and every other byte is unchanged", () => {
    const original = fs.readFileSync(path.join(FIXTURES, "spec-approved.md"), "utf8");
    const p = spec(original);
    const r = run("flip-spec-status", [p]);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.equal(read(p), original.replace("status: approved", "status: implemented"));
  });

  test("the `status: approved` text in the body is not touched", () => {
    const p = spec(doc("status: approved"));
    run("flip-spec-status", [p]);
    assert.equal(read(p), doc("status: implemented"));
  });

  test("quoting, trailing whitespace and a trailing comment survive", () => {
    for (const [before, after_] of [
      ["status: 'approved'", "status: 'implemented'"],
      ['status: "approved"', 'status: "implemented"'],
      ["status: approved   ", "status: implemented   "],
      ["status: approved # keep me", "status: implemented # keep me"],
      ['status: "approved"\t# c', 'status: "implemented"\t# c'],
    ] as const) {
      const p = spec(doc(before));
      assert.equal(run("flip-spec-status", [p]).status, 0, before);
      assert.equal(read(p), doc(after_), before);
    }
  });

  test("CRLF line endings survive", () => {
    const p = spec(doc("status: approved", "\r\n"));
    assert.equal(run("flip-spec-status", [p]).status, 0);
    assert.equal(read(p), doc("status: implemented", "\r\n"));
  });

  test("--json reports the flip with the {ok, data, findings} shape", () => {
    const p = spec(doc("status: approved"));
    const r = run("flip-spec-status", [p, "--json"]);
    assert.equal(r.status, 0);
    const env = parseEnvelope(r);
    assert.equal(env.ok, true);
    assert.deepEqual(env.findings, []);
    const d = env.data as { changed: boolean; status: string };
    assert.equal(d.changed, true);
    assert.equal(d.status, "approved");
  });

  test("--dry-run reports and writes nothing", () => {
    const text = doc("status: approved");
    const p = spec(text);
    const r = run("flip-spec-status", [p, "--dry-run", "--json"]);
    assert.equal(r.status, 0);
    assert.equal(read(p), text);
    const d = parseEnvelope(r).data as { changed: boolean; would_change: boolean };
    assert.equal(d.changed, false);
    assert.equal(d.would_change, true);
  });

  test("it does not stage, commit or create files beside the spec", () => {
    const dir = path.join(tmp, "solo");
    fs.mkdirSync(dir);
    const p = path.join(dir, "s.md");
    fs.writeFileSync(p, doc("status: approved"));
    run("flip-spec-status", [p]);
    assert.deepEqual(fs.readdirSync(dir), ["s.md"]);
  });
});

describe("flip-spec-status: other states", () => {
  test("already implemented: nothing written, exit 0, changed false", () => {
    const text = doc("status: implemented");
    const p = spec(text);
    const r = run("flip-spec-status", [p, "--json"]);
    assert.equal(r.status, 0);
    assert.equal(read(p), text);
    const env = parseEnvelope(r);
    assert.equal(env.ok, true);
    assert.equal((env.data as { changed: boolean }).changed, false);
  });

  test("scenario: status draft leaves the file unchanged, names `draft` and exits 1", () => {
    const text = doc("status: draft");
    const p = spec(text);
    const r = run("flip-spec-status", [p, "--json"]);
    assert.equal(r.status, 1);
    assert.equal(read(p), text);
    const env = parseEnvelope(r);
    assert.equal(env.ok, false);
    assert.equal(env.findings.length, 1);
    assert.match(env.findings[0]?.message ?? "", /draft/);
    assert.ok(env.findings[0]?.rule);
  });

  test("a quoted, commented implemented value still counts as implemented", () => {
    const p = spec(doc('status: "implemented" # done'));
    assert.equal(run("flip-spec-status", [p]).status, 0);
    assert.equal(read(p), doc('status: "implemented" # done'));
  });

  test("a file with no frontmatter status line exits 3 and is unchanged", () => {
    const text = "---\nid: x\n---\n\nstatus: approved\n";
    const p = spec(text);
    assert.equal(run("flip-spec-status", [p]).status, 3);
    assert.equal(read(p), text);
    const noFm = spec("# no frontmatter\n");
    assert.equal(run("flip-spec-status", [noFm]).status, 3);
  });

  test("a missing file exits 3", () => {
    const r = run("flip-spec-status", [path.join(tmp, "nope.md"), "--json"]);
    assert.equal(r.status, 3);
    assert.equal(parseEnvelope(r).ok, false);
  });
});

describe("flip-spec-status: interface", () => {
  test("usage errors exit 2: no argument, extra argument, unknown option", () => {
    const p = spec(doc("status: approved"));
    assert.equal(run("flip-spec-status", []).status, 2);
    assert.equal(run("flip-spec-status", [p, p]).status, 2);
    assert.equal(run("flip-spec-status", [p, "--bogus"]).status, 2);
    assert.equal(read(p), doc("status: approved"));
  });

  test("a usage error with --json prints one envelope with ok false", () => {
    const r = run("flip-spec-status", ["--json"]);
    assert.equal(r.status, 2);
    assert.equal(parseEnvelope(r).ok, false);
  });

  test("--help prints usage on stdout and exits 0", () => {
    const r = run("flip-spec-status", ["--help"]);
    assert.equal(r.status, 0);
    assert.match(r.stdout, /^Usage: /);
  });
});
