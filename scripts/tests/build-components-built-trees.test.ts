// build-components-built-trees.test.ts — built copies stay outside the TypeScript toolchain
// (spec 0250 R14, R30; spec Scenario 24; plan step 23).
//
// NEEDS THE DEV TOOLCHAIN (Oxlint, Oxfmt, tsc): it joins the `lint-typescript` capability, NOT
// the production-install job (`build-components-ts`, `npm ci --omit=dev`) where those tools do
// not exist. A fixture skill with a deliberately bad `scripts/probe.ts` (unformatted, an explicit
// `any`, an `enum` that type stripping cannot erase, more than 300 lines) is built by the REAL
// entry into the four trees of a throwaway git root that carries copies of the toolchain
// configuration, `scripts/check-typescript.ts` with its libraries, the pr-reviewer linter it
// delegates to, and a `node_modules` LINK (the toolchain, not a production dependency: the
// build itself runs from the real checkout's entry). Then:
//   - Oxlint, Oxfmt in check mode and `check-typescript.ts` report the SOURCE copy under
//     `artifacts/` (the control: the tools see the file and would report it) and report
//     NOTHING for any of the four built copies;
//   - every built copy is byte-identical to its source (R14: the bytes do not depend on the
//     formatter).
// `.oxlintrc.json`, `.oxfmtrc.json` and `scripts/lib/ts-scope.ts` are copied, never edited.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";

import { cleanEnv, CONFIG, REPO, scratch, skill } from "./fixtures/build-components/entry-kit.ts";

const BUILT = [".claude", ".gemini", ".github", ".agents"] as const;
const SOURCE = "artifacts/core/skills/probe-skill/scripts/probe.ts";
const TOOLCHAIN = [
  "tsconfig.json",
  ".oxlintrc.json",
  ".oxfmtrc.json",
  "package.json",
  "scripts/check-typescript.ts",
  "scripts/lib/erasable-syntax.ts",
  "scripts/lib/erasable-probe.ts",
  "scripts/lib/ts-scope.ts",
  "artifacts/core/skills/pr-reviewer/scripts/lint-typescript.ts",
];
const hasTools = ["oxlint", "oxfmt", "tsc"].every((tool) =>
  fs.existsSync(path.join(REPO, "node_modules", ".bin", tool)),
);
const SKIP = hasTools
  ? undefined
  : "skipped: needs the dev toolchain (run `npm ci`, not the production install)";
const POSIX = process.platform === "win32" ? "skipped: node_modules link" : undefined;

/** Unformatted, over 300 lines, an explicit `any`, an enum: it breaks every rule the toolchain has. */
function probeSource(): string {
  const filler = Array.from({ length: 320 }, (_, i) => `const   filler${i}=${i}  ;`);
  return ["const   loose:any = { a:1 }", "enum Bad {A,B}", ...filler, ""].join("\n");
}

function sh(root: string, cmd: string, args: string[]) {
  const res = spawnSync(cmd, args, {
    cwd: root,
    env: cleanEnv(),
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  return { status: res.status, out: `${res.stdout}${res.stderr}`, stdout: res.stdout };
}

function throwawayRoot(): string {
  const root = scratch("trees-");
  assert.equal(sh(root, "git", ["init", "-q"]).status, 0);
  for (const rel of TOOLCHAIN) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.copyFileSync(path.join(REPO, rel), path.join(root, rel));
  }
  fs.symlinkSync(path.join(REPO, "node_modules"), path.join(root, "node_modules"));
  fs.writeFileSync(path.join(root, "crewrig.config.toml"), CONFIG);
  const dir = path.join(root, "artifacts/core/skills/probe-skill");
  fs.mkdirSync(path.join(dir, "scripts"), { recursive: true });
  fs.writeFileSync(path.join(dir, "SKILL.md"), skill("probe-skill"));
  fs.writeFileSync(path.join(dir, "scripts/probe.ts"), probeSource());
  const build = spawnSync(
    process.execPath,
    [path.join(REPO, "scripts/build-components.ts"), "--target", "all", "--tier", "core"],
    {
      cwd: root,
      env: cleanEnv({ REPO_DIR: root }),
      encoding: "utf8",
    },
  );
  assert.equal(build.status, 0, build.stderr);
  assert.equal(sh(root, "git", ["add", "-A"]).status, 0);
  return root;
}

const underBuilt = (text: string): string[] =>
  text.split("\n").filter((line) => BUILT.some((tree) => line.includes(`${tree}/`)));

describe(
  "a built .ts copy is neither linted nor reformatted (R30)",
  { skip: SKIP ?? POSIX },
  () => {
    const root = throwawayRoot();
    const copies = BUILT.map((tree) => `${tree}/skills/probe-skill/scripts/probe.ts`);

    test("the build wrote one copy per tree, each byte-identical to the source, and git tracks them", () => {
      const source = fs.readFileSync(path.join(root, SOURCE));
      for (const copy of copies) {
        assert.deepEqual(fs.readFileSync(path.join(root, copy)), source, copy);
      }
      const tracked = sh(root, "git", ["ls-files"]).stdout.split("\n");
      for (const copy of copies) assert.ok(tracked.includes(copy), `${copy} is tracked`);
    });

    test("Oxlint reports the source (error and size warning) and no built copy", () => {
      const res = sh(root, path.join(root, "node_modules/.bin/oxlint"), [
        "--type-aware",
        "--format=json",
      ]);
      const report = JSON.parse(res.stdout.slice(res.stdout.indexOf("{"))) as {
        diagnostics: Array<{ filename: string; code: string }>;
      };
      const files = report.diagnostics.map((d) => d.filename);
      assert.ok(files.includes(SOURCE), `the control: ${files.join(", ")}`);
      assert.ok(
        report.diagnostics.some((d) => d.filename === SOURCE && /no-explicit-any/.test(d.code)),
      );
      assert.ok(
        report.diagnostics.some((d) => d.filename === SOURCE && /max-lines/.test(d.code)),
        "the size rule fires on the source",
      );
      assert.deepEqual(
        files.filter((f) => BUILT.some((tree) => f.startsWith(`${tree}/`))),
        [],
      );
    });

    test("Oxfmt in check mode lists the source and no built copy", () => {
      const res = sh(root, path.join(root, "node_modules/.bin/oxfmt"), ["--list-different"]);
      const listed = res.stdout.split("\n").map((l) => l.trim());
      assert.ok(listed.includes(SOURCE), `the control: ${res.out}`);
      assert.deepEqual(
        listed.filter((f) => BUILT.some((tree) => f.startsWith(`${tree}/`))),
        [],
      );
    });

    test("scripts/check-typescript.ts fails on the source in the lint, format and erasable steps, and names no built copy", () => {
      const res = sh(root, process.execPath, [
        "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON",
        "scripts/check-typescript.ts",
      ]);
      assert.equal(res.status, 1, res.out);
      assert.match(res.out, /check-typescript: lint: FAILED/);
      assert.match(res.out, /check-typescript: format: FAILED/);
      assert.match(res.out, /check-typescript: erasable: FAILED/);
      const named = res.out.split("\n").filter((l) => l.includes(SOURCE));
      for (const kind of [/no-explicit-any/, /not formatted/, /enum|erasable|TS1294/i]) {
        assert.ok(
          named.some((l) => kind.test(l)),
          `${kind}: the source is named in ${res.out}`,
        );
      }
      assert.deepEqual(underBuilt(res.out), []);
    });

    test("fixing the source leaves the toolchain green: the findings were the source's alone", () => {
      const fixed = "export const ok: number = 1;\n";
      fs.writeFileSync(path.join(root, SOURCE), fixed);
      const res = sh(root, process.execPath, [
        "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON",
        "scripts/check-typescript.ts",
      ]);
      assert.equal(res.status, 0, res.out);
      assert.deepEqual(underBuilt(res.out), []);
    });
  },
);
