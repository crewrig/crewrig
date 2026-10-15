// skill-scripts-mutation.test.ts — the oracle has teeth (spec 0258 R28, R29). A sandbox holds a
// real `git init`, the root `package.json`, REAL copies of `node_modules/js-yaml` and
// `node_modules/argparse` (the loader refuses a symlink) and the oracle files of the one script. ONE
// rule is mutated in the shell script and the same rule in its entry; the oracle subset of that
// script must pass on the pristine sandbox and FAIL on each leg of the mutated one. The shell leg
// runs on Linux only.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";

const REPO = path.resolve(import.meta.dirname, "..", "..");
const NO_REAL_GIT = "skipped: git is needed to build the sandbox";

interface Mutation {
  readonly script: string;
  readonly rule: string;
  /** The oracle cases that exercise the rule, as the full test name pattern. */
  readonly pattern: string;
  readonly shell: readonly [string, string];
  readonly entry: readonly [string, string];
}

const MUTATIONS: readonly Mutation[] = [
  {
    script: "github-actions/check-pinned-actions",
    rule: "the [UNPINNED] SHA length 40 -> 39",
    pattern:
      "github-actions/check-pinned-actions: oracle (single-file-pinned|single-file-unpinned)$",
    shell: ["sha_re='@[0-9a-fA-F]{40}$'", "sha_re='@[0-9a-fA-F]{39}$'"],
    entry: ["const shaRe = /@[0-9a-fA-F]{40}$/;", "const shaRe = /@[0-9a-fA-F]{39}$/;"],
  },
  {
    script: "github-actions/check-secrets-exposure",
    rule: "the `set -x` rule looks for `set -y`",
    pattern: "github-actions/check-secrets-exposure: oracle (set-minus-x|set-plus-x)$",
    shell: ["set[[:space:]]+[-+]x([[:space:]]|$)", "set[[:space:]]+[-+]y([[:space:]]|$)"],
    entry: ["set${SP}+[-+]x(${SP}|$)", "set${SP}+[-+]y(${SP}|$)"],
  },
];

const roots: string[] = [];
after(() => {
  for (const root of roots) fs.rmSync(root, { recursive: true, force: true });
});

function git(args: string[], cwd: string): string {
  const res = spawnSync("git", args, { cwd, encoding: "utf8" });
  assert.equal(res.status, 0, `git ${args.join(" ")}: ${res.stderr}`);
  return res.stdout;
}

/** The files under a repository path (a file itself, or a directory walked), repository-relative. */
function files(rel: string): string[] {
  const abs = path.join(REPO, rel);
  if (!fs.statSync(abs).isDirectory()) return [rel];
  return fs
    .readdirSync(abs)
    .sort()
    .flatMap((entry) => files(`${rel}/${entry}`));
}

/** A sandbox with the oracle subset of one script; `mutate` rewrites the two files of the script. */
function sandbox(m: Mutation, mutate: boolean): string {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "skill-mutation-")));
  roots.push(root);
  const [skill, name] = m.script.split("/") as [string, string];
  const scriptDir = `artifacts/core/skills/${skill}/scripts`;
  const tracked = [
    "scripts/tests/lib",
    "scripts/tests/skill-scripts-oracle.test.ts",
    `scripts/tests/fixtures/skill-scripts/${m.script}`,
    `${scriptDir}/${name}.sh`,
    `${scriptDir}/${name}.ts`,
  ].flatMap((rel) => files(rel));
  for (const rel of [...tracked, "package.json"]) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.copyFileSync(path.join(REPO, rel), path.join(root, rel));
  }
  for (const dep of ["js-yaml", "argparse"])
    fs.cpSync(path.join(REPO, "node_modules", dep), path.join(root, "node_modules", dep), {
      recursive: true,
    });
  git(["init", "-q"], root);
  if (mutate)
    for (const [ext, [from, to]] of [
      ["sh", m.shell],
      ["ts", m.entry],
    ] as const) {
      const file = path.join(root, scriptDir, `${name}.${ext}`);
      const text = fs.readFileSync(file, "utf8");
      assert.equal(text.split(from).length, 2, `${ext}: the rule text occurs once: ${from}`);
      fs.writeFileSync(
        file,
        text.replace(from, () => to),
      );
    }
  return root;
}

interface Run {
  readonly status: number | null;
  readonly pass: number;
  readonly fail: number;
  readonly log: string;
}

/** The oracle subset in the sandbox, forced onto one leg: exit status and TAP counts. */
function oracle(root: string, m: Mutation, leg: "shell" | "entry"): Run {
  const env: Record<string, string | undefined> = { ...process.env, SKILL_ORACLE_LEG: leg };
  delete env["NODE_TEST_CONTEXT"]; // a nested `node --test` would run nothing
  delete env["CI"];
  const res = spawnSync(
    process.execPath,
    [
      "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON",
      "--test",
      "--test-reporter=tap",
      `--test-name-pattern=${m.pattern}`,
      "scripts/tests/skill-scripts-oracle.test.ts",
    ],
    { cwd: root, env, encoding: "utf8", timeout: 120_000 },
  );
  const count = (key: string): number =>
    Number(new RegExp(`^# ${key} (\\d+)$`, "m").exec(res.stdout)?.[1]);
  return {
    status: res.status,
    pass: count("pass"),
    fail: count("fail"),
    log: `${res.stdout}${res.stderr}`.slice(-1500),
  };
}

const LEGS = process.platform === "linux" ? (["shell", "entry"] as const) : (["entry"] as const);

for (const m of MUTATIONS) {
  describe(`${m.script}: mutating ${m.rule}`, () => {
    for (const leg of LEGS)
      test(`the pristine sandbox passes the ${leg} leg`, (t) => {
        if (spawnSync("git", ["--version"]).status !== 0) return t.skip(NO_REAL_GIT);
        const run = oracle(sandbox(m, false), m, leg);
        assert.deepEqual(
          [run.status, run.pass, run.fail], // two cases ran, not zero
          [0, 2, 0],
          run.log,
        );
      });
    for (const leg of LEGS)
      test(`the mutated sandbox fails the ${leg} leg`, (t) => {
        if (spawnSync("git", ["--version"]).status !== 0) return t.skip(NO_REAL_GIT);
        const run = oracle(sandbox(m, true), m, leg);
        assert.equal(run.status, 1, run.log);
        assert.ok(run.fail > 0, `the mutation is not caught: ${run.log}`);
      });
    if (!LEGS.includes("shell" as never))
      test("the shell leg", (t) => t.skip("skipped: the shell leg needs a Linux host"));
  });
}
