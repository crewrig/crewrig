// skill-scripts-doc-writer-lint-adr.test.ts — black-box test of doc-writer/scripts/lint-adr.ts
// (spec 0297 R7, R8), written from the spec.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, describe, test } from "node:test";

import {
  GOOD_ADR,
  parseEnvelope,
  run,
  SKILL_DIR,
  tempDir,
} from "./lib/skill-scripts-doc-writer-cli.ts";

const tmp = tempDir("doc-writer-lint-adr-");
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

let n = 0;
function adr(text: string): string {
  const p = path.join(tmp, `adr-${n++}.md`);
  fs.writeFileSync(p, text);
  return p;
}
const lint = (text: string) => {
  const r = run("lint-adr", [adr(text), "--json"], { cwd: tmp });
  return { r, env: parseEnvelope(r) };
};
const rules = (text: string): string[] => lint(text).env.findings.map((f) => f.rule);

describe("lint-adr: findings", () => {
  test("a filled ADR passes with exit 0", () => {
    const { r, env } = lint(GOOD_ADR);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.equal(env.ok, true);
    assert.deepEqual(env.findings, []);
  });
  test("the unmodified bundled template fails on its placeholders", () => {
    const tpl = fs.readFileSync(path.join(SKILL_DIR, "assets", "adr.template.md"), "utf8");
    const filled = tpl
      .replace("{{NUMBER}}", "0004")
      .replace("{{TITLE}}", "T")
      .replace("{{STATUS}}", "Proposed");
    const { r, env } = lint(filled);
    assert.equal(r.status, 1);
    assert.ok(env.findings.filter((f) => f.rule === "placeholder").length >= 4);
    assert.ok(lint(tpl).env.findings.some((f) => f.rule === "heading" || f.rule === "placeholder"));
  });
  test("a bad heading", () => {
    assert.ok(rules(GOOD_ADR.replace("# ADR-0004: Use", "# ADR 4 - Use")).includes("heading"));
  });
  test("a missing, a duplicated and a misordered section", () => {
    assert.ok(
      rules(GOOD_ADR.replace("## Context\n", "## Background\n")).includes("section-missing"),
    );
    assert.ok(rules(`${GOOD_ADR}\n## Decision\n\nAgain.\n`).includes("section-duplicate"));
    const swapped = GOOD_ADR.replace("## Context", "## TMP")
      .replace("## Decision", "## Context")
      .replace("## TMP", "## Decision");
    assert.ok(rules(swapped).includes("section-order"));
  });
  test("a status outside the allowed values; Superseded by ADR-NNNN is allowed", () => {
    assert.ok(rules(GOOD_ADR.replace("Accepted", "Done")).includes("status"));
    assert.equal(lint(GOOD_ADR.replace("Accepted", "Superseded by ADR-0009")).r.status, 0);
  });
  test("a missing consequence bullet", () => {
    assert.ok(rules(GOOD_ADR.replace(/- Neutral:.*\n/, "")).includes("consequence-missing"));
  });
  test("angle brackets in code spans and fences are not placeholders", () => {
    const text = GOOD_ADR.replace(
      "stored in PostgreSQL.",
      "stored in PostgreSQL as `Map<K, V>`.\n\n```ts\nconst a: Array<string> = [];\n```",
    );
    assert.equal(lint(text).r.status, 0);
  });
  test("a long Context is a warning and does not change the exit code", () => {
    const long = GOOD_ADR.replace(/The ledger needs.*\n/, "One. Two. Three. Four. Five. Six.\n");
    const { r, env } = lint(long);
    assert.equal(r.status, 0);
    const f = env.findings.find((x) => x.rule === "context-length");
    assert.equal(f?.severity, "warning");
  });
  test("several files are checked and the exit code is 1 when any has an error", () => {
    const r = run(
      "lint-adr",
      [adr(GOOD_ADR), adr(GOOD_ADR.replace("Accepted", "Done")), "--json"],
      { cwd: tmp },
    );
    assert.equal(r.status, 1);
    assert.equal((parseEnvelope(r).data?.files as unknown[]).length, 2);
  });
  test("standard input is read with -", () => {
    const r = run("lint-adr", ["-", "--json"], { cwd: tmp, input: GOOD_ADR });
    assert.equal(r.status, 0, r.stdout + r.stderr);
  });
});

describe("lint-adr: contract", () => {
  test("an unreadable file is a precondition failure (exit 3)", () => {
    const r = run("lint-adr", [path.join(tmp, "missing.md"), "--json"], { cwd: tmp });
    assert.equal(r.status, 3);
    const env = parseEnvelope(r);
    assert.equal(env.ok, false);
    assert.equal(env.data, null);
    assert.equal(env.findings[0]?.rule, "precondition");
  });
  test("usage errors exit 2", () => {
    for (const args of [[], ["--bogus"], ["-", "x.md"]]) {
      const r = run("lint-adr", [...args, "--json"], { cwd: tmp });
      assert.equal(r.status, 2, args.join(" "));
      assert.equal(parseEnvelope(r).findings[0]?.rule, "usage");
    }
  });
  test("--help prints the usage on stdout and exits 0", () => {
    const r = run("lint-adr", ["--help"], { cwd: tmp });
    assert.equal(r.status, 0);
    assert.equal(r.stderr, "");
    assert.match(r.stdout, /^Usage: /);
  });
});
