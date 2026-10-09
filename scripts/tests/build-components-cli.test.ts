// build-components-cli.test.ts — R4 (command line, REPO_DIR) and R5 (--list-output-dirs) of
// spec 0250, over scripts/lib/build-components/{args,output-dirs}.ts.
//
// The modules are tested directly; the entry runs end to end in the e2e suites. The shell
// parity of R5 lives in build-components-cli-config.test.ts, with the R7 parity set.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";

import { joinRoot, parseArgs, resolveRepoDir, words } from "../lib/build-components/args.ts";
import { outputDirLines } from "../lib/build-components/output-dirs.ts";
import type { BuildOptions } from "../lib/build-components/types.ts";
import { createFixtureTree, REPO } from "./lib/build-fixture-tree.ts";

const temps: string[] = [];
after(() => temps.forEach((dir) => fs.rmSync(dir, { recursive: true, force: true })));
const tmpDir = (): string => {
  const dir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "bc-cli-")));
  temps.push(dir);
  return dir;
};

function opts(argv: string[]): BuildOptions {
  const parsed = parseArgs(argv);
  assert.ok(parsed.ok, `parseArgs rejected ${JSON.stringify(argv)}`);
  return parsed.opts;
}
function refusal(argv: string[]): string {
  const parsed = parseArgs(argv);
  assert.ok(!parsed.ok, `parseArgs accepted ${JSON.stringify(argv)}`);
  return parsed.message;
}

describe("R4 argument rules", () => {
  test("no argument: every CLI, every tier, a build that writes", () => {
    assert.deepEqual(opts([]), {
      target: "all",
      tierFilter: null,
      check: false,
      listOutputDirs: false,
      resolve: null,
      diagnosticsPath: "",
    });
  });

  test("every flag sets its own field", () => {
    const o = opts([
      "--target",
      "claude",
      "--check",
      "--list-output-dirs",
      "--diagnostics",
      "d.log",
    ]);
    assert.equal(o.target, "claude");
    assert.ok(o.check && o.listOutputDirs);
    assert.equal(o.diagnosticsPath, "d.log");
    assert.deepEqual(opts(["--resolve", "a.md", "gemini"]).resolve, {
      source: "a.md",
      target: "gemini",
    });
  });

  test("--tier is repeatable, splits on blanks, and keeps a null filter only when absent", () => {
    assert.deepEqual(opts(["--tier", "core", "--tier", "library"]).tierFilter, ["core", "library"]);
    assert.deepEqual(opts(["--tier", "a b\tc\nd"]).tierFilter, ["a", "b", "c", "d"]);
    assert.deepEqual(opts(["--tier", ""]).tierFilter, [], "an empty tier matches nothing");
    assert.equal(opts(["--check"]).tierFilter, null);
  });

  test("an unrecognised argument is ignored one at a time", () => {
    for (const stray of ["--bogus", "positional", "--check=1", "-c", "--TARGET"]) {
      const o = opts([stray, "--check", stray, "--target", "gemini"]);
      assert.ok(o.check, stray);
      assert.equal(o.target, "gemini", stray);
    }
  });

  test("a value-taking flag swallows the next argument whatever it looks like", () => {
    const o = opts(["--target", "--check"]);
    assert.equal(o.target, "--check");
    assert.equal(o.check, false);
    assert.equal(opts(["--diagnostics", "--list-output-dirs"]).listOutputDirs, false);
    assert.deepEqual(opts(["--tier", "--check"]).tierFilter, ["--check"]);
  });

  test("a later flag overrides an earlier one", () => {
    assert.equal(opts(["--target", "a", "--target", "b"]).target, "b");
    assert.equal(opts(["--diagnostics", "x", "--diagnostics", "y"]).diagnosticsPath, "y");
    assert.equal(opts(["--resolve", "a", "b", "--resolve", "", "z"]).resolve, null);
  });

  test("a value-taking flag in final position is an Error: line, whichever flag", () => {
    for (const flag of ["--target", "--tier", "--diagnostics"]) {
      assert.equal(refusal(["--check", flag]), `Error: ${flag} requires a value`);
    }
  });

  test("--resolve with fewer than two values is an Error: line", () => {
    assert.equal(refusal(["--resolve"]), "Error: --resolve requires <source> <target>");
    assert.match(refusal(["--check", "--resolve", "only-source"]), /^Error: --resolve requires/);
  });

  test('--resolve "" consumes three arguments and leaves the arm off', () => {
    const o = opts(["--resolve", "", "gemini", "--check"]);
    assert.equal(o.resolve, null);
    assert.ok(o.check, "the argument after the three consumed ones is still read");
    assert.equal(
      opts(["--resolve", "", "--check"]).check,
      false,
      "--check is the swallowed target",
    );
    assert.deepEqual(opts(["--resolve", "s", ""]).resolve, { source: "s", target: "" });
  });

  test("words splits on blanks, tabs and line feeds only", () => {
    assert.deepEqual(words("  a \t b\nc  "), ["a", "b", "c"]);
    assert.deepEqual(words(""), []);
  });
});

describe("R4 REPO_DIR", () => {
  test("a non-empty REPO_DIR is kept verbatim, trailing slash included", () => {
    assert.equal(resolveRepoDir({ REPO_DIR: "/x/y/" }, "/ignored/scripts/e.ts"), "/x/y/");
  });

  test("unset or empty: the physical parent of the entry file's directory", () => {
    const root = tmpDir();
    fs.mkdirSync(path.join(root, "scripts"));
    const entry = path.join(root, "scripts", "build-components.ts");
    assert.equal(resolveRepoDir({}, entry), root);
    assert.equal(resolveRepoDir({ REPO_DIR: "" }, entry), root);
    assert.equal(resolveRepoDir({ REPO_DIR: undefined }, entry), root);
  });

  test("it never searches upward for a .git entry", () => {
    const outer = tmpDir();
    fs.mkdirSync(path.join(outer, ".git"));
    fs.mkdirSync(path.join(outer, "inner", "scripts"), { recursive: true });
    assert.equal(
      resolveRepoDir({}, path.join(outer, "inner", "scripts", "e.ts")),
      path.join(outer, "inner"),
    );
  });

  test("a copy of scripts/ in a throwaway tree resolves to that tree", () => {
    const tree = createFixtureTree({ deps: "none" });
    assert.equal(resolveRepoDir({}, tree.resolve("scripts/build-components.ts")), tree.root);
  });

  test(
    "a checkout reached through a symbolic link resolves to its physical path",
    {
      skip:
        process.platform === "win32" ? "skipped: symbolic links need privileges on Windows" : false,
    },
    () => {
      const real = tmpDir();
      fs.mkdirSync(path.join(real, "scripts"));
      const link = path.join(tmpDir(), "link");
      fs.symlinkSync(real, link, "dir");
      assert.equal(resolveRepoDir({}, path.join(link, "scripts", "e.ts")), real);
    },
  );

  test("joinRoot: root + '/' + rel on POSIX (a trailing slash kept), native separators on win32", () => {
    assert.equal(joinRoot("linux", "/r", ".gemini/skills"), "/r/.gemini/skills");
    assert.equal(joinRoot("darwin", "/r/", "a/b"), "/r//a/b");
    assert.equal(joinRoot("win32", "C:\\r", ".gemini/skills"), "C:\\r\\.gemini\\skills");
  });
});

const ALL = [
  ".agents/agents",
  ".agents/skills",
  ".claude/agents",
  ".claude/skills",
  ".gemini/agents",
  ".gemini/commands",
  ".gemini/skills",
  ".github/agents",
  ".github/skills",
];
const lines = (target: string, tiers: readonly string[] | null = null): string[] =>
  outputDirLines({ target, tierFilter: tiers });

describe("R5 --list-output-dirs", () => {
  test("default: core, every CLI, unique, in code-unit order", () => {
    assert.deepEqual(lines("all"), ALL);
  });

  test("one CLI each; copilot and github are the same", () => {
    assert.deepEqual(lines("gemini"), [".gemini/agents", ".gemini/commands", ".gemini/skills"]);
    assert.deepEqual(lines("claude"), [".claude/agents", ".claude/skills"]);
    assert.deepEqual(lines("antigravity"), [".agents/agents", ".agents/skills"]);
    assert.deepEqual(lines("copilot"), [".github/agents", ".github/skills"]);
    assert.deepEqual(lines("github"), lines("copilot"));
  });

  test("a target list splits on blanks while 'all' is the whole text only", () => {
    assert.deepEqual(lines("gemini claude"), [...lines("claude"), ...lines("gemini")].sort());
    assert.deepEqual(lines(" all"), [""]);
  });

  test("a target that selects no CLI prints one empty line, as does an empty one", () => {
    assert.deepEqual(lines("nope"), [""]);
    assert.deepEqual(lines(""), [""]);
  });

  test("non-core tiers are prefixed dist/<tier>/; core is not; a repeated tier is listed once", () => {
    assert.deepEqual(lines("claude", ["library"]), [
      "dist/library/.claude/agents",
      "dist/library/.claude/skills",
    ]);
    assert.deepEqual(lines("claude", ["core", "library"]), [
      ".claude/agents",
      ".claude/skills",
      "dist/library/.claude/agents",
      "dist/library/.claude/skills",
    ]);
    assert.deepEqual(lines("claude", ["core", "core"]), lines("claude"));
  });

  test("an empty --tier selects no tier: one empty line", () => {
    assert.deepEqual(lines("all", []), [""]);
  });

  test("it answers with no config, no artifacts/, no node_modules: the module loads alone", () => {
    const tree = createFixtureTree({ deps: "none" });
    const script = `
      import { parseArgs } from "./scripts/lib/build-components/args.ts";
      import { outputDirLines } from "./scripts/lib/build-components/output-dirs.ts";
      const p = parseArgs(["--list-output-dirs", "--target", "gemini", "--tier", "x"]);
      console.log(JSON.stringify(p.ok ? outputDirLines(p.opts) : null));`;
    const run = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
      cwd: tree.root,
      encoding: "utf8",
    });
    assert.equal(run.status, 0, run.stderr);
    assert.deepEqual(JSON.parse(run.stdout), [
      "dist/x/.gemini/agents",
      "dist/x/.gemini/commands",
      "dist/x/.gemini/skills",
    ]);
    assert.ok(
      !tree.exists("node_modules") &&
        !tree.exists("artifacts") &&
        !tree.exists("crewrig.config.toml"),
    );
  });

  test("its import graph holds no YAML library: only args.ts, and node: builtins", () => {
    const seen = new Set<string>();
    const walk = (rel: string): void => {
      if (seen.has(rel)) return;
      seen.add(rel);
      const text = fs.readFileSync(path.join(REPO, "scripts/lib/build-components", rel), "utf8");
      for (const m of text.matchAll(/^import (?!type\b)[^"]*from "([^"]+)";?$/gm)) {
        const spec = m[1] ?? "";
        if (spec.startsWith("./")) walk(spec.slice(2));
        else assert.ok(spec.startsWith("node:"), `${rel} imports ${spec}`);
      }
    };
    walk("output-dirs.ts");
    assert.deepEqual([...seen].sort(), ["args.ts", "output-dirs.ts"]);
  });

  test("the entry prints the listing in a tree with no packages, config or artifacts", () => {
    const tree = createFixtureTree({ deps: "none" });
    const run = tree.run(["--list-output-dirs", "--target", "claude", "--tier", "library"]);
    assert.equal(run.status, 0, run.stderr);
    assert.equal(run.stdout, "dist/library/.claude/agents\ndist/library/.claude/skills\n");
    assert.equal(run.stderr, "");
  });
});
