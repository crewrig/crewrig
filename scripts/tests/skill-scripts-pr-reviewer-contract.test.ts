// skill-scripts-pr-reviewer-contract.test.ts — the ten bundled pr-reviewer scripts against the
// script contract (`docs/skill-authoring-standard.md` → *The script contract*), run from a copy of
// the whole skill directory outside the repository: `--help`, the `--json` envelope, usage exit 2,
// unreadable input exit 3 (nothing linted), tool-absent degradation and `--require-tools`.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, describe, test } from "node:test";

import {
  copySkill,
  envelope,
  run,
  tempDir,
  type Run,
} from "./lib/skill-scripts-pr-reviewer-cli.ts";

const root = tempDir("pr-reviewer-contract-");
after(() => fs.rmSync(root, { recursive: true, force: true }));
const REPO = path.resolve(import.meta.dirname, "..", "..");
assert.ok(!root.startsWith(REPO), "the copy must live outside the repository");
const skill = copySkill(root);
const work = path.join(root, "work");
fs.mkdirSync(work);
const file = (name: string, text: string): string => {
  const p = path.join(work, name);
  fs.writeFileSync(p, text);
  return p;
};
const NOPE = path.join(work, "does-not-exist");
// a PATH that holds no tool: markdownlint, ruff, flake8, oxlint and oxfmt are all absent
const EMPTY_PATH = path.join(root, "empty-bin");
fs.mkdirSync(EMPTY_PATH);
const WARNING = /\bWarning\b|MODULE_TYPELESS_PACKAGE_JSON|ExperimentalWarning/;

const SCRIPTS = [
  "check-comment-size",
  "ci-preflight",
  "iter-label",
  "lint-json",
  "lint-markdown",
  "lint-python",
  "lint-skill",
  "lint-typescript",
  "lint-verdict",
  "post-verdict",
];

describe("every script: --help, usage error, envelope", () => {
  for (const name of SCRIPTS) {
    test(`${name} --help prints the usage on stdout and exits 0, with no Node warning`, () => {
      const r = run(skill, name, ["--help"]);
      assert.equal(r.status, 0, r.stderr);
      assert.match(r.stdout, /Usage:/);
      assert.doesNotMatch(r.stderr, WARNING);
    });
    test(`${name} rejects an unknown option with exit 2 and an ok:false envelope under --json`, () => {
      const r = run(skill, name, ["--json", "--no-such-option"]);
      assert.equal(r.status, 2, r.stdout + r.stderr);
      const env = envelope(r);
      assert.equal(env.ok, false);
      assert.equal(env.data, null);
      assert.equal(env.findings[0]?.rule, "usage");
    });
  }
});

describe("existing linters: unreadable input first, tool absence, --json", () => {
  test("lint-json: a clean file exits 0 and --json is ok:true", () => {
    const r = run(skill, "lint-json", ["--json", file("ok.json", '{"a":1}\n')]);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(envelope(r).ok, true);
  });
  test("lint-json: a finding exits 1 and names its rule", () => {
    const r = run(skill, "lint-json", ["--json", file("bad.json", '{"a":1,}\n')]);
    assert.equal(r.status, 1);
    assert.ok(
      envelope(r).findings.some((f) => f.rule === "invalid-json" || f.rule === "trailing-comma"),
    );
  });
  test("lint-json: standard input is read when no file is given", () => {
    assert.equal(run(skill, "lint-json", [], { input: '{"a":1}' }).status, 0);
    assert.equal(run(skill, "lint-json", [], { input: "{" }).status, 1);
  });
  test("lint-json: an unreadable input wins over a finding and nothing is linted (exit 3)", () => {
    const r = run(skill, "lint-json", ["--json", file("bad2.json", "{"), NOPE]);
    assert.equal(r.status, 3);
    const env = envelope(r);
    assert.equal(env.data, null);
    assert.equal(env.findings.length, 1);
    assert.equal(env.findings[0]?.rule, "precondition");
  });
  test("lint-json: `-`, a directory and an empty name are unreadable inputs (exit 3)", () => {
    for (const bad of ["-", work, ""]) assert.equal(run(skill, "lint-json", [bad]).status, 3, bad);
  });
  test("lint-skill: a missing file exits 3 and a readable one exits with its findings", () => {
    assert.equal(run(skill, "lint-skill", [NOPE]).status, 3);
    const r = run(skill, "lint-skill", ["--json", file("SKILL.md", "no frontmatter\n")]);
    assert.equal(r.status, 1);
    assert.ok(envelope(r).findings.some((f) => f.rule === "missing-key"));
  });
  test("lint-skill: a missing file wins over a finding in another file (exit 3, nothing linted)", () => {
    const r = run(skill, "lint-skill", ["--json", file("S2.md", "x\n"), NOPE]);
    assert.equal(r.status, 3);
    assert.equal(envelope(r).findings.length, 1);
  });
  for (const [name, ext, tools] of [
    ["lint-markdown", "md", "markdownlint"],
    ["lint-python", "py", "ruff or flake8"],
  ] as const) {
    test(`${name}: with the tool absent it exits 0 with a tool-unavailable warning`, () => {
      const r = run(skill, name, ["--json", file(`a.${ext}`, "x = 1\n")], { path: EMPTY_PATH });
      assert.equal(r.status, 0, r.stdout + r.stderr);
      const env = envelope(r);
      assert.equal(env.ok, true);
      assert.equal(env.findings[0]?.rule, "tool-unavailable");
      assert.equal(env.findings[0]?.severity, "warning");
      assert.match(r.stderr, new RegExp(tools.split(" ")[0] as string));
    });
    test(`${name}: --require-tools makes the missing tool a precondition failure (exit 3)`, () => {
      const r = run(skill, name, ["--json", "--require-tools", file(`b.${ext}`, "x = 1\n")], {
        path: EMPTY_PATH,
      });
      assert.equal(r.status, 3);
      assert.equal(envelope(r).findings[0]?.rule, "precondition");
    });
    test(`${name}: an unreadable input exits 3 before the tool is looked for`, () => {
      assert.equal(run(skill, name, [NOPE]).status, 3);
    });
    test(`${name}: an option is never forwarded to the tool (exit 2)`, () => {
      assert.equal(run(skill, name, ["--fix", file(`c.${ext}`, "x\n")]).status, 2);
    });
  }
  test("lint-python: a bare print() is a finding (exit 1)", () => {
    const r = run(skill, "lint-python", ["--json", file("p.py", "print(1)\n")]);
    assert.equal(r.status, 1);
    assert.ok(envelope(r).findings.some((f) => f.rule === "bare-print"));
  });
  for (const [name, tool, ext, lead] of [
    ["lint-markdown", "markdownlint", "md", []],
    ["lint-python", "ruff", "py", ["check"]],
  ] as const) {
    test(`${name}: a path with a space reaches the tool as one argument, no option in front of it`, () => {
      const bin = path.join(root, `stub-${tool}`);
      fs.mkdirSync(bin, { recursive: true });
      const log = path.join(root, `${tool}.args`);
      fs.writeFileSync(
        path.join(bin, tool),
        `#!/bin/sh\nfor a in "$@"; do printf '%s\\n' "$a" >> "${log}"; done\nexit 0\n`,
        { mode: 0o755 },
      );
      const spaced = file(`with space.${ext}`, "x = 1\n");
      const r = run(skill, name, [spaced], { path: `${bin}${path.delimiter}/usr/bin:/bin` });
      assert.equal(r.status, 0, r.stdout + r.stderr);
      assert.deepEqual(fs.readFileSync(log, "utf8").split("\n").filter(Boolean), [...lead, spaced]);
    });
  }
  test("lint-python: a path with a space is one input", () => {
    const spaced = file("with space.py", "x = 1\n");
    assert.equal(run(skill, "lint-python", [spaced], { path: EMPTY_PATH }).status, 0);
  });
  test("lint-typescript: --require-tools without the tools exits 3, otherwise it degrades to 0", () => {
    const ts = file("a.ts", "export const a = 1;\n");
    const strict = run(skill, "lint-typescript", ["--json", "--require-tools", ts], {
      cwd: work,
      path: EMPTY_PATH,
    });
    assert.equal(strict.status, 3);
    assert.equal(envelope(strict).findings[0]?.rule, "precondition");
    const lax = run(skill, "lint-typescript", ["--json", ts], { cwd: work, path: EMPTY_PATH });
    assert.equal(lax.status, 0, lax.stderr);
    assert.ok(envelope(lax).findings.every((f) => f.severity === "warning"));
  });
  test("lint-typescript: an unreadable input exits 3 and a bad --mode exits 2", () => {
    assert.equal(run(skill, "lint-typescript", [path.join(work, "gone.ts")]).status, 3);
    assert.equal(run(skill, "lint-typescript", ["--mode", "nope", file("m.ts", "")]).status, 2);
  });
  test("check-comment-size: within budget 0, over budget 1, unreadable 3, stdin read", () => {
    assert.equal(run(skill, "check-comment-size", [file("s.txt", "abc")]).status, 0);
    const over = run(skill, "check-comment-size", ["--json", file("o.txt", "x".repeat(12289))]);
    assert.equal(over.status, 1);
    assert.equal(envelope(over).findings[0]?.rule, "over-budget");
    assert.equal(run(skill, "check-comment-size", [NOPE]).status, 3);
    assert.equal(run(skill, "check-comment-size", ["-"], { input: "abc" }).status, 0);
  });
});

// Spec 0312 R1/R2/R12 (issue #2075): an extension skill is held to `name` and `description` only;
// every other skill keeps the five canonical-skill keys.
describe("lint-skill: extension skills need only name and description (spec 0312)", () => {
  const KEYS = [
    "name",
    "description",
    "license",
    "compatibility",
    "metadata.provenance.version",
  ] as const;
  const messages = (r: Run): string[] => envelope(r).findings.map((f) => f.message);
  const missing = (r: Run): string[] =>
    messages(r).map((m) => m.replace(/^.*missing required frontmatter key: /, ""));
  const at = (rel: string, text: string, name = rel): string => {
    const p = path.join(root, name);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, text);
    return p;
  };
  const EXT = "work/extensions/core/demo/skills/x/SKILL.md";
  const BOTH = "---\nname: x\ndescription: d\n---\n";

  test("the real greeter file exits 0 with no finding", () => {
    const greeter = path.join(
      REPO,
      "extensions",
      "core",
      "hello-world",
      "skills",
      "greeter",
      "SKILL.md",
    );
    const r = run(skill, "lint-skill", ["--json", greeter], { cwd: REPO });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.deepEqual(missing(r), []);
  });

  test("an extension skill with description but no name reports exactly that key", () => {
    at(EXT, "---\ndescription: d\n---\n");
    const r = run(skill, "lint-skill", ["--json", EXT], { cwd: root });
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.deepEqual(missing(r), ["name"]);
  });

  test("an extension skill with name but no description reports exactly that key", () => {
    at(EXT, "---\nname: x\n---\n");
    const r = run(skill, "lint-skill", ["--json", EXT], { cwd: root });
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.deepEqual(missing(r), ["description"]);
  });

  test("an extension skill with name and description exits 0", () => {
    at(EXT, BOTH);
    const r = run(skill, "lint-skill", ["--json", EXT], { cwd: root });
    assert.equal(r.status, 0, r.stdout + r.stderr);
  });

  test("an ordinary skill still reports all five keys", () => {
    at("work/skills/x/SKILL.md", "no frontmatter\n");
    const r = run(skill, "lint-skill", ["--json", "work/skills/x/SKILL.md"], {
      cwd: root,
    });
    assert.equal(r.status, 1);
    assert.deepEqual(missing(r), [...KEYS]);
  });

  test("artifacts/extensions/x/SKILL.md stays ordinary (five keys)", () => {
    const rel = "artifacts/extensions/x/SKILL.md";
    at(rel, BOTH);
    const r = run(skill, "lint-skill", ["--json", rel], { cwd: root });
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.deepEqual(missing(r), ["license", "compatibility", "metadata.provenance.version"]);
  });

  test("an extension target given with ./ is still an extension target", () => {
    at(EXT, BOTH);
    const r = run(skill, "lint-skill", ["--json", `./${EXT}`], { cwd: root });
    assert.equal(r.status, 0, r.stdout + r.stderr);
  });

  test("an extension target given with backslashes is still an extension target", () => {
    const win = EXT.replaceAll("/", "\\");
    at(EXT, BOTH, win); // on POSIX the backslashed name is one literal file name
    const r = run(skill, "lint-skill", ["--json", win], { cwd: root });
    assert.equal(r.status, 0, r.stdout + r.stderr);
  });
});
