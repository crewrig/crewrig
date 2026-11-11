// skill-scripts-pr-logbook-logbook-target.test.ts — black-box test of
// pr-logbook/scripts/resolve-logbook-target.ts (spec 0292 R9, R13, R16), written from the spec.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, describe, test } from "node:test";

import { type Envelope, parseEnvelope, run, tempDir } from "./lib/skill-scripts-pr-logbook-cli.ts";

const tmp = tempDir("pr-logbook-target-");
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

interface Target {
  mode: string;
  issue: number | null;
  issues: number[];
  label_required: boolean;
}

function resolve(body: string): { env: Envelope; data: Target; status: number | null } {
  const r = run("resolve-logbook-target", ["--body-file", "-", "--json"], { input: body });
  const env = parseEnvelope(r);
  return { env, data: env.data as Target, status: r.status };
}

describe("resolve-logbook-target: feature-issue mode", () => {
  test("scenario: `Fixes #12` then `closes #40` prints the exact envelope and exits 0", () => {
    const r = run("resolve-logbook-target", ["--body-file", "-", "--json"], {
      input: "Intro.\n\nFixes #12\n\nLater, closes #40\n",
    });
    assert.equal(r.status, 0);
    assert.deepEqual(JSON.parse(r.stdout), {
      ok: true,
      data: { mode: "feature-issue", issue: 12, issues: [12, 40], label_required: false },
      findings: [],
    });
  });

  test("every GitHub closing keyword counts, in any case, as a whole word", () => {
    for (const kw of [
      "close",
      "closes",
      "closed",
      "fix",
      "fixes",
      "fixed",
      "resolve",
      "resolves",
      "resolved",
      "CLOSES",
      "Fixes",
      "rEsOlVeD",
    ]) {
      const { data, status } = resolve(`${kw} #7`);
      assert.equal(status, 0, kw);
      assert.deepEqual(
        data,
        { mode: "feature-issue", issue: 7, issues: [7], label_required: false },
        kw,
      );
    }
  });

  test("`<keyword>: #N` counts", () => {
    assert.deepEqual(resolve("Fixes: #5").data.issues, [5]);
  });

  test("numbers are listed once, in order of first appearance; issue is the first", () => {
    const { data } = resolve("closes #40, fixes #12, resolves #40");
    assert.deepEqual(data.issues, [40, 12]);
    assert.equal(data.issue, 40);
  });

  test("a keyword embedded in a longer word does not count", () => {
    assert.equal(resolve("prefixes #3 and unfixed #4").data.mode, "standalone");
  });
});

describe("resolve-logbook-target: standalone mode", () => {
  test("no closing reference: standalone, issue null, issues empty, label required, exit 0", () => {
    const { data, status, env } = resolve("Refs #9 only.\n");
    assert.equal(status, 0);
    assert.equal(env.ok, true);
    assert.deepEqual(data, { mode: "standalone", issue: null, issues: [], label_required: true });
  });

  test("an empty body is standalone", () => {
    assert.equal(resolve("").data.mode, "standalone");
  });

  test("a reference to another repository does not count", () => {
    assert.equal(resolve("Fixes octo/repo#12").data.mode, "standalone");
    const mixed = resolve("Fixes octo/repo#12 and closes #3");
    assert.deepEqual(mixed.data.issues, [3]);
  });

  test("a reference inside an inline code span does not count", () => {
    assert.equal(resolve("Write `Fixes #12` in the body.").data.mode, "standalone");
  });

  test("a reference inside a fenced code block does not count, one after it does", () => {
    const body = "```\nFixes #12\n```\n\nCloses #13\n";
    assert.deepEqual(resolve(body).data.issues, [13]);
    const tilde = "~~~\nFixes #12\n~~~\n";
    assert.equal(resolve(tilde).data.mode, "standalone");
  });
});

describe("resolve-logbook-target: interface", () => {
  test("without --json it prints human-readable text and exits 0", () => {
    const r = run("resolve-logbook-target", ["--body-file", "-"], { input: "Fixes #12" });
    assert.equal(r.status, 0);
    assert.ok(r.stdout.length + r.stderr.length > 0);
    assert.throws(() => JSON.parse(r.stdout));
  });

  test("--json keeps stdout to one object", () => {
    const r = run("resolve-logbook-target", ["--body-file", "-", "--json"], { input: "x" });
    assert.equal(r.stdout.trim().split("\n").length, 1);
  });

  test("--body-file reads a path", () => {
    const p = path.join(tmp, "body.md");
    fs.writeFileSync(p, "Resolves #21\n");
    const r = run("resolve-logbook-target", ["--body-file", p, "--json"]);
    assert.equal(r.status, 0);
    assert.equal((parseEnvelope(r).data as Target).issue, 21);
  });

  test("usage errors exit 2: no option, unknown option, extra argument", () => {
    assert.equal(run("resolve-logbook-target", []).status, 2);
    assert.equal(run("resolve-logbook-target", ["--bogus"], { input: "" }).status, 2);
    assert.equal(
      run("resolve-logbook-target", ["--body-file", "-", "extra"], { input: "" }).status,
      2,
    );
  });

  test("a usage error with --json prints one envelope with ok false and a finding", () => {
    const r = run("resolve-logbook-target", ["--json", "--bogus"]);
    assert.equal(r.status, 2);
    const env = parseEnvelope(r);
    assert.equal(env.ok, false);
    assert.equal(env.data, null);
    assert.ok(env.findings[0]?.rule && env.findings[0]?.message);
  });

  test("an unreadable body file exits 3", () => {
    const r = run("resolve-logbook-target", ["--body-file", path.join(tmp, "nope.md"), "--json"]);
    assert.equal(r.status, 3);
    assert.equal(parseEnvelope(r).ok, false);
  });

  test("--help prints usage on stdout and exits 0", () => {
    const r = run("resolve-logbook-target", ["--help"]);
    assert.equal(r.status, 0);
    assert.match(r.stdout, /^Usage: /);
  });

  test("it makes no network call: it runs with no network tools and a bare environment", () => {
    // The runner passes a PATH holding only node's directory; success there is the evidence.
    assert.equal(resolve("Fixes #1").status, 0);
  });
});
