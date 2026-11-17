// skill-scripts-doc-writer-new-adr.test.ts — black-box test of doc-writer/scripts/new-adr.ts
// (spec 0297 R6, R8), written from the spec.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, describe, test } from "node:test";

import { parseEnvelope, run, tempDir } from "./lib/skill-scripts-doc-writer-cli.ts";

const tmp = tempDir("doc-writer-new-adr-");
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

let n = 0;
function work(files: string[] = []): string {
  const dir = path.join(tmp, `w${n++}`);
  fs.mkdirSync(path.join(dir, "docs", "adr"), { recursive: true });
  for (const f of files) fs.writeFileSync(path.join(dir, "docs", "adr", f), "x");
  return dir;
}
const list = (dir: string, sub = "docs/adr"): string[] =>
  fs.readdirSync(path.join(dir, sub)).sort();

describe("new-adr: numbering and content", () => {
  test("next number is the highest prefix plus one; heading, status and sections in place", () => {
    const d = work(["0001-a.md", "0003-c.md", "notes.md"]);
    const r = run("new-adr", ["--title", "Use PostgreSQL for the ledger", "--json"], { cwd: d });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const env = parseEnvelope(r);
    assert.equal(env.ok, true);
    assert.equal(env.data?.number, "0004");
    assert.equal(env.data?.slug, "use-postgresql-for-the-ledger");
    const text = fs.readFileSync(
      path.join(d, "docs/adr/0004-use-postgresql-for-the-ledger.md"),
      "utf8",
    );
    assert.match(text, /^# ADR-0004: Use PostgreSQL for the ledger\n/);
    assert.match(
      text,
      /\n## Status\n\nProposed\n\n## Context\n[\s\S]*\n## Decision\n[\s\S]*\n## Consequences\n/,
    );
  });
  test("an empty or missing directory starts at 0001 and is created", () => {
    const d = tmp;
    const dir = path.join(tmp, `fresh${n++}`);
    fs.mkdirSync(dir);
    const r = run("new-adr", ["--title", "First", "--dir", "adrs"], { cwd: dir });
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(list(dir, "adrs"), ["0001-first.md"]);
    assert.ok(d);
  });
  test("--status sets the status line; --dir and --opt=value forms work", () => {
    const d = work();
    const r = run("new-adr", ["--title=Pick a thing", "--status=Accepted", "--dir=docs/adr"], {
      cwd: d,
    });
    assert.equal(r.status, 0, r.stderr);
    assert.match(
      fs.readFileSync(path.join(d, "docs/adr/0001-pick-a-thing.md"), "utf8"),
      /\n## Status\n\nAccepted\n/,
    );
  });
  test("accents are removed, not dropped", () => {
    const d = work();
    const env = parseEnvelope(run("new-adr", ["--title", "Décision éàè", "--json"], { cwd: d }));
    assert.equal(env.data?.slug, "decision-eae");
  });
  test("a long title gives a slug of at most 50 characters without a trailing hyphen", () => {
    const d = work();
    const env = parseEnvelope(
      run("new-adr", ["--title", "word ".repeat(30), "--json"], { cwd: d }),
    );
    const slug = env.data?.slug as string;
    assert.ok(slug.length <= 50 && !slug.endsWith("-"), slug);
  });
});

describe("new-adr: refusals (exit 1, nothing written)", () => {
  const refused = (args: string[], rule: string, d = work(["0001-a.md"])): void => {
    const r = run("new-adr", [...args, "--json"], { cwd: d });
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.equal(parseEnvelope(r).findings[0]?.rule, rule);
    assert.deepEqual(list(d), ["0001-a.md"]);
  };
  test("an empty title", () => refused(["--title", "   "], "title"));
  test("a title that leaves an empty slug", () => refused(["--title", "!!!"], "slug"));
  test("an unknown status", () => refused(["--title", "x", "--status", "Done"], "status"));
  test("the same title twice gives two different files, never an overwrite", () => {
    const d = work();
    assert.equal(run("new-adr", ["--title", "x"], { cwd: d }).status, 0);
    assert.equal(run("new-adr", ["--title", "x"], { cwd: d }).status, 0);
    assert.deepEqual(list(d), ["0001-x.md", "0002-x.md"]);
  });
});

describe("new-adr: dry run, preconditions, contract", () => {
  test("--dry-run writes nothing and prints the path and the content", () => {
    const d = work(["0001-a.md"]);
    const r = run("new-adr", ["--title", "Dry", "--dry-run"], { cwd: d });
    assert.equal(r.status, 0);
    assert.match(r.stdout, /docs\/adr\/0002-dry\.md/);
    assert.match(r.stdout, /# ADR-0002: Dry/);
    assert.deepEqual(list(d), ["0001-a.md"]);
    const j = parseEnvelope(run("new-adr", ["--title", "Dry", "--dry-run", "--json"], { cwd: d }));
    assert.equal(j.data?.written, false);
    assert.equal(j.data?.dry_run, true);
  });
  test("an unreadable template is a precondition failure (exit 3)", () => {
    const d = work();
    const r = run("new-adr", ["--title", "x", "--template", "missing.md", "--json"], { cwd: d });
    assert.equal(r.status, 3);
    const env = parseEnvelope(r);
    assert.equal(env.ok, false);
    assert.equal(env.data, null);
    assert.equal(env.findings[0]?.rule, "precondition");
  });
  test("a file where the directory should be is a precondition failure (exit 3)", () => {
    const d = work();
    fs.writeFileSync(path.join(d, "afile"), "x");
    const r = run("new-adr", ["--title", "x", "--dir", "afile", "--json"], { cwd: d });
    assert.equal(r.status, 3);
  });
  test("usage errors exit 2 with the --json object", () => {
    const d = work();
    for (const args of [[], ["--bogus"], ["--title"], ["--title", "x", "extra"]]) {
      const r = run("new-adr", [...args, "--json"], { cwd: d });
      assert.equal(r.status, 2, args.join(" "));
      assert.equal(parseEnvelope(r).findings[0]?.rule, "usage");
    }
  });
  test("--help prints the usage, exits 0 and warns that numbers are local", () => {
    const r = run("new-adr", ["--help"], { cwd: tmp });
    assert.equal(r.status, 0);
    assert.equal(r.stderr, "");
    assert.match(r.stdout, /^Usage: /);
    assert.match(r.stdout, /open pull requests/);
  });
});
