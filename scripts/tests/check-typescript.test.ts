// check-typescript.test.ts — black-box tests for scripts/check-typescript.ts
// (spec 0238 R4-R8, R12): step aggregation and built-copy-tree exclusion.
//
// Fixtures are throwaway `git init` repositories that copy the repository's
// tsconfig.json, .oxlintrc.json, .oxfmtrc.json and the pr-reviewer
// lint-typescript.ts (which check-typescript delegates to), and symlink its
// node_modules (run `npm ci` first).

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const CHECK = path.join(REPO, "scripts", "check-typescript.ts");
const LINTER = "artifacts/core/skills/pr-reviewer/scripts/lint-typescript.ts";

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
function tsRepo(files: Record<string, string>): string {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "check-ts-test-")));
  temps.push(dir);
  for (const rel of ["tsconfig.json", ".oxlintrc.json", ".oxfmtrc.json", LINTER]) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.copyFileSync(path.join(REPO, rel), path.join(dir, rel));
  }
  fs.symlinkSync(path.join(REPO, "node_modules"), path.join(dir, "node_modules"), "dir");
  fs.writeFileSync(path.join(dir, ".gitignore"), "node_modules\n");
  for (const [rel, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), content);
  }
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

function checkTs(dir: string): Run {
  return sh(process.execPath, ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", CHECK], dir);
}

function lines(run: Run): string[] {
  return run.out.split("\n");
}

describe("check-typescript", () => {
  test("aggregates steps: a type error and an unformatted file are both reported, exit 1", () => {
    const run = checkTs(
      tsRepo({
        "typed.ts": 'export const n: number = "not a number";\n',
        "messy.ts": "export const  spaced   = 1\n",
      }),
    );
    assert.equal(run.status, 1, run.out);
    assert.ok(
      lines(run).some((l) => l.startsWith("typecheck: TS2322: typed.ts:1: ")),
      `expected a TS2322 typecheck finding in:\n${run.out}`,
    );
    assert.ok(
      lines(run).some((l) => l.startsWith("lint-typescript: format: messy.ts: ")),
      `expected a format finding in:\n${run.out}`,
    );
    for (const [step, verdict] of [
      ["typecheck", "FAILED"],
      ["erasable", "OK"],
      ["lint", "OK"],
      ["format", "FAILED"],
    ]) {
      assert.match(run.out, new RegExp(`^check-typescript: ${step}: ${verdict}$`, "m"));
    }
  });

  test("ignores a tracked .ts under the built-copy tree .claude/ (R12)", () => {
    const run = checkTs(
      tsRepo({
        "clean.ts": "export const ok = 1;\n",
        ".claude/skills/built.ts":
          "export enum Bad {\n  A,\n}\nexport const  x: number = 'y' as any\n",
      }),
    );
    assert.equal(run.status, 0, run.out);
    assert.doesNotMatch(run.out, /\.claude/);
  });
});
