// lint-typescript.test.ts — black-box tests for the pr-reviewer skill's
// lint-typescript.ts (spec 0238 R6-R8, R14), the one implementation CI and the
// reviewer pass share.
//
// Fixtures are generated at test time in a throwaway directory that copies the
// repository's tsconfig.json, .oxlintrc.json and .oxfmtrc.json and symlinks its
// node_modules (oxlint and oxfmt come from there: run `npm ci` first).

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const LINTER = path.join(REPO, "artifacts/core/skills/pr-reviewer/scripts/lint-typescript.ts");

interface Run {
  status: number | null;
  out: string;
}

const temps: string[] = [];
after(() => {
  for (const dir of temps) fs.rmSync(dir, { recursive: true, force: true });
});

/** A fixture directory holding `files`; wired to the repository's toolchain unless `bare`. */
function fixture(files: Record<string, string>, bare = false): string {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "lint-ts-test-")));
  temps.push(dir);
  if (!bare) {
    for (const cfg of ["tsconfig.json", ".oxlintrc.json", ".oxfmtrc.json"]) {
      fs.copyFileSync(path.join(REPO, cfg), path.join(dir, cfg));
    }
    fs.symlinkSync(path.join(REPO, "node_modules"), path.join(dir, "node_modules"), "dir");
  }
  for (const [rel, content] of Object.entries(files))
    fs.writeFileSync(path.join(dir, rel), content);
  return dir;
}

function lintTs(dir: string, args: string[], env: NodeJS.ProcessEnv = process.env): Run {
  const res = spawnSync(
    process.execPath,
    ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", LINTER, ...args],
    { cwd: dir, env, encoding: "utf8" },
  );
  return { status: res.status, out: `${res.stdout}${res.stderr}` };
}

function expectLine(run: Run, prefix: string): string {
  const line = run.out.split("\n").find((l) => l.startsWith(prefix));
  assert.ok(line !== undefined, `expected '${prefix}...' in:\n${run.out}`);
  return line;
}

const FAILING: Record<string, string> = {
  "as-any.ts": 'const raw = "1";\nexport const value = raw as any;\n',
  "array-any.ts": "export const list: Array<any> = [];\n",
  "ts-ignore.ts": "// @ts-ignore\nexport const a = 1;\n",
  "ts-nocheck.ts": "// @ts-nocheck\nexport const b = 1;\n",
  "bare-expect-error.ts": "// @ts-expect-error\nexport const c: string = 2;\n",
  "json-any.ts": 'const text = "{}";\nexport const parsed = JSON.parse(text);\n',
};

const CLEAN: Record<string, string> = {
  "justified-expect-error.ts":
    "// @ts-expect-error -- deliberate mismatch exercised by this fixture\n" +
    "export const d: string = 3;\n",
  "json-unknown.ts": 'const text = "{}";\nexport const parsed: unknown = JSON.parse(text);\n',
  "big.ts": Array.from({ length: 350 }, (_, i) => `export const v${i} = ${i};`).join("\n") + "\n",
};

describe("lint mode: strict-typing violations fail", () => {
  let run: Run = { status: null, out: "" };
  before(() => {
    run = lintTs(fixture(FAILING), ["--mode", "lint", ...Object.keys(FAILING)]);
  });

  test("the run exits 1", () => assert.equal(run.status, 1, run.out));

  const cases: Array<[string, string, number]> = [
    ["`as any`", "typescript(no-explicit-any): as-any.ts", 2],
    ["`Array<any>`", "typescript(no-explicit-any): array-any.ts", 1],
    ["`@ts-ignore`", "typescript(ban-ts-comment): ts-ignore.ts", 1],
    ["`@ts-nocheck`", "typescript(ban-ts-comment): ts-nocheck.ts", 1],
    ["a bare `@ts-expect-error`", "typescript(ban-ts-comment): bare-expect-error.ts", 1],
    ["`JSON.parse` assigned without `unknown`", "typescript(no-unsafe-assignment): json-any.ts", 2],
  ];
  for (const [label, where, line] of cases) {
    test(`${label} is reported with its rule, file and line`, () => {
      expectLine(run, `lint-typescript: ${where}:${line}: `);
    });
  }
});

describe("lint mode: accepted constructs and the size warning", () => {
  let run: Run = { status: null, out: "" };
  before(() => {
    run = lintTs(fixture(CLEAN), ["--mode", "lint", ...Object.keys(CLEAN)]);
  });

  test("a justified `@ts-expect-error` and `JSON.parse` typed `unknown` pass (exit 0)", () => {
    assert.equal(run.status, 0, run.out);
    assert.doesNotMatch(run.out, /^lint-typescript: typescript\(/m);
  });

  test("a 350-line file warns, naming the file and 350, without failing", () => {
    const line = expectLine(
      run,
      "warning (non-blocking): lint-typescript: eslint(max-lines): big.ts",
    );
    assert.match(line, /\b350\b/);
  });
});

describe("format mode", () => {
  test("an unformatted file fails, naming the file", () => {
    const dir = fixture({
      "messy.ts": "export const  spaced   = 1\n",
      "tidy.ts": "export const t = 1;\n",
    });
    const run = lintTs(dir, ["--mode", "format", "messy.ts", "tidy.ts"]);
    assert.equal(run.status, 1, run.out);
    expectLine(run, "lint-typescript: format: messy.ts: ");
    assert.doesNotMatch(run.out, /format: tidy\.ts/);
  });
});

describe("missing tools", () => {
  // No node_modules in the fixture and a PATH without oxlint or oxfmt.
  const env: NodeJS.ProcessEnv = { ...process.env, PATH: "/usr/bin:/bin" };

  test("degrade gracefully by default: exit 0 plus a note", () => {
    const run = lintTs(fixture({ "a.ts": "export const a = 1;\n" }, true), ["a.ts"], env);
    assert.equal(run.status, 0, run.out);
    expectLine(run, "lint-typescript: oxlint not found");
    expectLine(run, "lint-typescript: oxfmt not found");
  });

  test("are a wiring fault (exit 2) with --require-tools", () => {
    const dir = fixture({ "a.ts": "export const a = 1;\n" }, true);
    const run = lintTs(dir, ["--require-tools", "a.ts"], env);
    assert.equal(run.status, 2, run.out);
    expectLine(run, "lint-typescript: oxlint not found");
  });
});
