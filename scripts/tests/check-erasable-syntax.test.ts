// check-erasable-syntax.test.ts — tests for the spec 0238 R5 erasable-syntax
// step (scripts/check-typescript.ts --step erasable, scripts/lib/erasable-syntax.ts).
//
// Fixtures are generated at test time in a throwaway `git init` repository
// that copies the repository's tsconfig.json and .oxfmtrc.json and symlinks
// its node_modules (tsc and oxfmt come from there: run `npm ci` first).

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { classify } from "../lib/erasable-syntax.ts";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const CHECK = path.join(REPO, "scripts", "check-typescript.ts");
const OXFMT = path.join(REPO, "node_modules", ".bin", "oxfmt");

interface Run {
  status: number | null;
  out: string;
}

const temps: string[] = [];
after(() => {
  for (const dir of temps) fs.rmSync(dir, { recursive: true, force: true });
});

function sh(cmd: string, args: string[], cwd: string): Run {
  const env: NodeJS.ProcessEnv = { ...process.env, CREWRIG_REPO_DIR: cwd };
  for (const key of ["BASE_REF", "GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE"]) delete env[key];
  const res = spawnSync(cmd, args, { cwd, env, encoding: "utf8" });
  return { status: res.status, out: `${res.stdout}${res.stderr}` };
}

/** A committed fixture repository holding `files`, wired to the repository's toolchain. */
function tsRepo(files: Record<string, string>, prepare?: (dir: string) => void): string {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "erasable-test-")));
  temps.push(dir);
  for (const cfg of ["tsconfig.json", ".oxfmtrc.json"]) {
    fs.copyFileSync(path.join(REPO, cfg), path.join(dir, cfg));
  }
  fs.symlinkSync(path.join(REPO, "node_modules"), path.join(dir, "node_modules"), "dir");
  fs.writeFileSync(path.join(dir, ".gitignore"), "node_modules\n");
  for (const [rel, content] of Object.entries(files))
    fs.writeFileSync(path.join(dir, rel), content);
  prepare?.(dir);
  const id = ["-c", "user.email=t@example.invalid", "-c", "user.name=t"];
  for (const args of [
    ["init", "-q", "-b", "main"],
    ["add", "-A"],
    ["commit", "-q", "-m", "x"],
  ]) {
    const res = sh("git", [...id, ...args], dir);
    assert.equal(res.status, 0, res.out);
  }
  return dir;
}

function erasable(dir: string): Run {
  return sh(
    process.execPath,
    ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", CHECK, "--step", "erasable"],
    dir,
  );
}

const LONG_CTOR =
  "export class Service {\n" +
  "  constructor(private readonly alphaRepository: Map<string, number>, " +
  "protected readonly betaRepository: Set<string>) {}\n" +
  "}\n";

const FIXTURES: Record<string, string> = {
  "enum.ts": "export const before = 1;\nexport enum Color {\n  Red,\n}\n",
  "namespace.ts":
    "export const before = 1;\nexport namespace Runtime {\n  export const x = 1;\n}\n",
  "param.ts": "export class Point {\n  constructor(private x: number) {}\n}\n",
  "decorator.ts":
    "function tag(value: unknown, context: unknown): void {\n  void value;\n  void context;\n}\n\n" +
    "@tag\nexport class Tagged {}\n",
  "import-equals.ts": 'import fs = require("node:fs");\nexport const read = fs.readFileSync;\n',
  "multiline.ts": LONG_CTOR,
};

const NEGATIVE =
  "export namespace Types {\n  export type Name = string;\n}\n" +
  'import type { Stats } from "node:fs";\n' +
  "export type Both = Stats | Types.Name;\n";

/** 1-based line of the first line in `src` containing `needle`. */
function lineOf(src: string, needle: string): number {
  const i = src.split("\n").findIndex((l) => l.includes(needle));
  assert.notEqual(i, -1, `'${needle}' not found`);
  return i + 1;
}

describe("erasable step: one fixture per forbidden construct", () => {
  let dir = "";
  let run: Run = { status: null, out: "" };
  let multiline = "";

  before(() => {
    dir = tsRepo(FIXTURES, (d) => {
      const fmt = sh(OXFMT, ["multiline.ts"], d);
      assert.equal(fmt.status, 0, fmt.out);
    });
    multiline = fs.readFileSync(path.join(dir, "multiline.ts"), "utf8");
    run = erasable(dir);
  });

  function expectConstruct(construct: string, file: string, line: number): void {
    const prefix = `erasable: ${construct}: ${file}:${line}: `;
    assert.ok(
      run.out.split("\n").some((l) => l.startsWith(prefix)),
      `expected '${prefix}...' in:\n${run.out}`,
    );
  }

  test("the step fails with exit 1", () => {
    assert.equal(run.status, 1, run.out);
    assert.match(run.out, /^check-typescript: erasable: FAILED$/m);
  });

  test("an enum is named with its file and line", () => expectConstruct("enum", "enum.ts", 2));

  test("a runtime namespace is named with its file and line", () =>
    expectConstruct("namespace", "namespace.ts", 2));

  test("a single-line parameter property is named with its file and line", () =>
    expectConstruct("parameter-property", "param.ts", 2));

  test("a decorator is named with its file and line", () =>
    expectConstruct("decorator", "decorator.ts", 6));

  test("an import-equals is named with its file and line", () =>
    expectConstruct("import-equals", "import-equals.ts", 1));

  test("an Oxfmt-formatted multi-line parameter property is still a parameter-property (v1-F1)", () => {
    const ctor = multiline.split("\n")[lineOf(multiline, "constructor(") - 1] ?? "";
    assert.doesNotMatch(ctor, /readonly/, "oxfmt was expected to split the parameters");
    assert.equal(sh(OXFMT, ["--check", "multiline.ts"], dir).status, 0);
    expectConstruct("parameter-property", "multiline.ts", lineOf(multiline, "alphaRepository"));
    expectConstruct("parameter-property", "multiline.ts", lineOf(multiline, "betaRepository"));
    assert.doesNotMatch(run.out, /non-erasable: multiline\.ts/);
  });
});

describe("erasable step: erasable TypeScript", () => {
  test("a type-only namespace plus `import type` passes", () => {
    const run = erasable(tsRepo({ "types.ts": NEGATIVE }));
    assert.equal(run.status, 0, run.out);
    assert.doesNotMatch(run.out, /^erasable: /m);
  });
});

describe("classify()", () => {
  const multi =
    "export class S {\n  constructor(\n    private readonly a: number,\n    b: string,\n  ) {}\n}\n";

  test("a modifier on its own line inside a constructor parameter list is a parameter-property", () => {
    assert.equal(classify(multi, 3, 5), "parameter-property");
  });

  test("a class-field modifier outside any constructor is not a parameter-property", () => {
    assert.equal(classify("class F {\n  private x = 1;\n}\n", 2, 3), "non-erasable");
  });

  test("a modifier inside a nested call within the constructor body is not a parameter-property", () => {
    const src = "class G {\n  constructor() {\n    f(\n      private\n    );\n  }\n}\n";
    assert.equal(classify(src, 4, 7), "non-erasable");
  });
});
