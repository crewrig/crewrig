// check-subagent-conventions.test.ts — black-box cases of scripts/check-subagent-conventions.ts
// (spec 0306 R17, R18, R19): the committed mini-roots under
// scripts/tests/fixtures/subagent-conventions/, one per rule, run with CREWRIG_REPO_DIR.
//
// A mini-root holds the fragment, one core and one library agent source, the four flat agent
// trees for the core agent and the four `dist/library/` trees for the library agent. No agent
// count, file count or core path of the real repository is written here (plan v2 v1-F5).

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";

import { REPO } from "./lib/build-fixture-tree.ts";

const CHECK = path.join(REPO, "scripts", "check-subagent-conventions.ts");
const ROOTS = path.join(REPO, "scripts", "tests", "fixtures", "subagent-conventions");
const NODE_FLAGS = ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON"];

const temps: string[] = [];
after(() => {
  for (const dir of temps) fs.rmSync(dir, { recursive: true, force: true });
});

function run(root: string): {
  status: number | null;
  stdout: string;
  stderr: string;
} {
  const r = spawnSync(process.execPath, [...NODE_FLAGS, CHECK], {
    env: { ...process.env, CREWRIG_REPO_DIR: root },
    encoding: "utf8",
  });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

const fixture = (name: string): string => path.join(ROOTS, name);

/** A writable copy of a committed root, for cases the committed roots do not cover. */
function copyOf(name: string): string {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "subagent-conv-")));
  temps.push(dir);
  fs.cpSync(fixture(name), dir, { recursive: true });
  return dir;
}

/** The `- <path>: <rule>` lines of standard error. */
const findings = (stderr: string): string[] => stderr.split("\n").filter((l) => l.startsWith("- "));
const finding = (path_: string, rule: string): RegExp =>
  new RegExp(`^- (?:.*/)?${path_.replace(/[.]/g, "\\.")}: ${rule}$`, "m");

describe("committed roots: exit codes and findings (R17, R18)", () => {
  test("pass: exit 0, an OK line, no finding", () => {
    const r = run(fixture("pass"));
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /OK/);
    assert.deepEqual(findings(r.stderr), []);
  });

  test("absent-trees: agent trees that do not exist are passed with an OK line each", () => {
    const r = run(fixture("absent-trees"));
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /OK/);
  });

  test("fragment-invalid: exit 1, fragment-invalid, no tail finding", () => {
    const r = run(fixture("fragment-invalid"));
    assert.equal(r.status, 1);
    assert.match(r.stderr, /^- .*subagent-conventions\.md: fragment-invalid$/m);
    assert.doesNotMatch(r.stderr, /: (missing-block|stale-block)$/m);
  });

  test("fragment-invalid-provenance: a provenance comment without a space is refused (v1-F3)", () => {
    const r = run(fixture("fragment-invalid-provenance"));
    assert.equal(r.status, 1);
    assert.match(r.stderr, /^- .*subagent-conventions\.md: fragment-invalid$/m);
  });

  test("missing-block: the Gemini file without the block", () => {
    const r = run(fixture("missing-block"));
    assert.equal(r.status, 1);
    assert.match(r.stderr, finding(".gemini/agents/alpha.md", "missing-block"));
    assert.equal(findings(r.stderr).length, 1, r.stderr);
  });

  test("stale-block: a committed file and a dist/library file with an older block", () => {
    const r = run(fixture("stale-block"));
    assert.equal(r.status, 1);
    assert.match(r.stderr, finding(".github/agents/alpha.md", "stale-block"));
    assert.match(r.stderr, finding("dist/library/.gemini/agents/beta.md", "stale-block"));
    assert.equal(findings(r.stderr).length, 2, r.stderr);
  });

  test("missing-omit-key: the Claude Code file without the key", () => {
    const r = run(fixture("missing-omit-key"));
    assert.equal(r.status, 1);
    assert.match(r.stderr, finding(".claude/agents/alpha.md", "missing-omit-key"));
    assert.equal(findings(r.stderr).length, 1, r.stderr);
  });

  test("foreign-omit-key: the Antigravity file with the key", () => {
    const r = run(fixture("foreign-omit-key"));
    assert.equal(r.status, 1);
    assert.match(r.stderr, finding(".agents/agents/alpha.md", "foreign-omit-key"));
    assert.equal(findings(r.stderr).length, 1, r.stderr);
  });

  test("source-carries-block: the agent source with the heading line", () => {
    const r = run(fixture("source-carries-block"));
    assert.equal(r.status, 1);
    assert.match(r.stderr, finding("artifacts/core/agents/alpha/AGENT.md", "source-carries-block"));
    assert.equal(findings(r.stderr).length, 1, r.stderr);
  });

  test("no-fragment: exit 2", () => {
    const r = run(fixture("no-fragment"));
    assert.equal(r.status, 2);
    assert.match(r.stderr, /subagent-conventions\.md/);
  });

  test("a repository root that cannot be resolved: exit 2", () => {
    const r = run(path.join(os.tmpdir(), "subagent-conv-does-not-exist-0306"));
    assert.equal(r.status, 2);
  });
});

describe("edge cases on a copy of the pass root (R17)", () => {
  test("the check follows CREWRIG_REPO_DIR: the same copy turns red when a file is trimmed", () => {
    const root = copyOf("pass");
    assert.equal(run(root).status, 0);
    const file = path.join(root, ".claude", "agents", "alpha.md");
    fs.writeFileSync(file, fs.readFileSync(file, "utf8").replace(/\n## [\s\S]*$/, "\n"));
    const r = run(root);
    assert.equal(r.status, 1);
    assert.match(r.stderr, finding(".claude/agents/alpha.md", "missing-block"));
  });

  test("a block followed by extra content is stale, not accepted as a suffix match", () => {
    const root = copyOf("pass");
    const file = path.join(root, ".github", "agents", "alpha.md");
    fs.appendFileSync(file, "\ntrailing hand edit\n");
    const r = run(root);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /alpha\.md: (stale|missing)-block$/m);
  });

  test("a block without the blank line before it is not the block (R6 needs \\n\\n)", () => {
    const root = copyOf("pass");
    const file = path.join(root, ".gemini", "agents", "alpha.md");
    fs.writeFileSync(file, fs.readFileSync(file, "utf8").replace("\n\n## ", "\n## "));
    const r = run(root);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /\.gemini\/agents\/alpha\.md: (stale|missing)-block$/m);
  });

  test("a nested .agents/agents/<name>/AGENT.md is not read: only flat *.md files count (s1-F4)", () => {
    const root = copyOf("pass");
    const nested = path.join(root, ".agents", "agents", "legacy");
    fs.mkdirSync(nested, { recursive: true });
    fs.writeFileSync(path.join(nested, "AGENT.md"), "no block, no key\n");
    const r = run(root);
    assert.equal(r.status, 0, r.stderr);
  });

  test("a fragment of 1,501 characters is fragment-invalid (R3)", () => {
    const root = copyOf("pass");
    const frag = path.join(root, "artifacts", "core", "fragments", "subagent-conventions.md");
    fs.writeFileSync(frag, `## T\n${"x".repeat(1501 - 6)}\n`);
    const r = run(root);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /subagent-conventions\.md: fragment-invalid$/m);
  });

  test("a CRLF fragment, a ${KEY} placeholder and a --- line are each fragment-invalid (R2, R4)", () => {
    for (const text of ["## T\r\nbody\r\n", "## T\n${KEY}\n", "## T\n---\nbody\n", "## T\n\n\n"]) {
      const root = copyOf("pass");
      const frag = path.join(root, "artifacts", "core", "fragments", "subagent-conventions.md");
      fs.writeFileSync(frag, text);
      const r = run(root);
      assert.equal(r.status, 1, JSON.stringify(text));
      assert.match(r.stderr, /subagent-conventions\.md: fragment-invalid$/m, JSON.stringify(text));
    }
  });

  test("the key appearing twice in a Claude Code file is not 'exactly once'", () => {
    const root = copyOf("pass");
    const file = path.join(root, ".claude", "agents", "alpha.md");
    fs.writeFileSync(
      file,
      fs
        .readFileSync(file, "utf8")
        .replace("omitClaudeMd: true\n", "omitClaudeMd: true\nomitClaudeMd: true\n"),
    );
    const r = run(root);
    assert.equal(r.status, 1);
    assert.match(r.stderr, finding(".claude/agents/alpha.md", "(missing|foreign)-omit-key"));
  });
});

describe("the check against the repository itself (R17, R22)", () => {
  test("the committed trees and the sources satisfy the check", () => {
    const r = run(REPO);
    assert.equal(r.status, 0, r.stderr);
  });
});

describe("independence from the emitter (R17)", () => {
  test("no check source imports scripts/lib/build-components/", () => {
    for (const rel of [
      "scripts/check-subagent-conventions.ts",
      "scripts/lib/governance/subagent-conventions.ts",
    ]) {
      const text = fs.readFileSync(path.join(REPO, rel), "utf8");
      assert.doesNotMatch(text, /build-components/, `${rel} reaches the build code`);
    }
  });
});

describe("the dist fixture is committable (R19, plan v2 v1-F2)", () => {
  test("the dist/library agent files of the pass root are tracked or staged, not ignored", () => {
    const dist = "scripts/tests/fixtures/subagent-conventions/pass/dist/library";
    const ls = spawnSync("git", ["ls-files", "--cached", "--", dist], {
      cwd: REPO,
      encoding: "utf8",
    });
    const tracked = ls.stdout.split("\n").filter((l) => l.endsWith(".md"));
    assert.ok(
      tracked.length > 0,
      `no tracked agent file under ${dist}: stage the fixtures after the .gitignore negation`,
    );
    const ign = spawnSync("git", ["check-ignore", "--", `${dist}/.claude/agents/beta.md`], {
      cwd: REPO,
      encoding: "utf8",
    });
    assert.equal(ign.status, 1, `${dist} is git-ignored: ${ign.stdout}`);
  });
});
