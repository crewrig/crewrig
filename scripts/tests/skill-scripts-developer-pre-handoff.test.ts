// skill-scripts-developer-pre-handoff.test.ts — black-box test of developer/scripts/pre-handoff.ts
// (spec 0295 R3, R4), written from the spec: scope, lost and added non-ASCII characters, lost
// executable bit, --json shape, --help, exit codes 2 and 3, and a run from a copy of the whole
// skill directory under every package layout. Every run uses throwaway local repositories and no
// network.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";

import { type Layout, LAYOUT_PACKAGE } from "./lib/skill-scripts-observe.ts";

const REPO = path.resolve(import.meta.dirname, "..", "..");
const SKILL_DIR = path.join(REPO, "artifacts", "core", "skills", "developer");
const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "developer-pre-handoff-")));
after(() => fs.rmSync(root, { recursive: true, force: true }));
assert.ok(!root.startsWith(REPO), "the fixtures must live outside the repository");

const ENV = { HOME: root, PATH: process.env["PATH"] ?? "", LC_ALL: "C" };
const WARNING = /\bWarning\b|MODULE_TYPELESS_PACKAGE_JSON|ExperimentalWarning|DeprecationWarning/;

interface Run {
  status: number | null;
  stdout: string;
  stderr: string;
}
interface Envelope {
  ok: boolean;
  data: { base: string; scope: string[] | null; changed: { path: string; status: string }[] } | null;
  findings: { rule: string; message: string; severity?: string }[];
}

const run = (cwd: string, args: readonly string[], skillDir = SKILL_DIR): Run => {
  const r = spawnSync(process.execPath, [path.join(skillDir, "scripts", "pre-handoff.ts"), ...args], {
    cwd,
    env: ENV,
    encoding: "utf8",
    timeout: 30_000,
  });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
};
const envelope = (r: Run): Envelope => {
  const lines = r.stdout.split("\n").filter((l) => l !== "");
  assert.equal(lines.length, 1, `expected exactly one stdout line, got: ${r.stdout}`);
  return JSON.parse(lines[0] as string) as Envelope;
};
const rules = (r: Run): string[] => envelope(r).findings.map((f) => f.rule);

let counter = 0;
const git = (cwd: string, ...args: string[]): void => {
  const r = spawnSync("git", args, { cwd, env: ENV, encoding: "utf8" });
  assert.equal(r.status, 0, `git ${args.join(" ")}: ${r.stderr}`);
};
const put = (cwd: string, file: string, body: string, mode?: number): void => {
  const target = path.join(cwd, file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, body);
  if (mode !== undefined) fs.chmodSync(target, mode);
};

/** A repository with one commit: src/a.txt, src/doc.md (with arrows), bin/run.sh (executable). */
function repo(): string {
  const dir = path.join(root, `repo-${++counter}`);
  fs.mkdirSync(dir);
  git(dir, "init", "-q");
  git(dir, "symbolic-ref", "HEAD", "refs/heads/main");
  git(dir, "config", "user.name", "Fixture");
  git(dir, "config", "user.email", "fixture@example.invalid");
  git(dir, "config", "commit.gpgsign", "false");
  git(dir, "config", "core.fileMode", "true");
  put(dir, "src/a.txt", "one\n");
  put(dir, "src/doc.md", "key → value\n");
  put(dir, "bin/run.sh", "#!/bin/sh\necho hi\n", 0o755);
  put(dir, "README.md", "readme\n");
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", "initial");
  return dir;
}

describe("pre-handoff: success, --help and --json", () => {
  test("a diff inside the scope with only ASCII exits 0 and lists the changed file", () => {
    const dir = repo();
    put(dir, "src/a.txt", "one\ntwo\n");
    const r = run(dir, ["--scope", "src/", "--json"]);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const env = envelope(r);
    assert.equal(env.ok, true);
    assert.deepEqual(env.findings, []);
    assert.deepEqual(env.data, {
      base: "HEAD",
      scope: ["src/"],
      changed: [{ path: "src/a.txt", status: "M" }],
    });
  });

  test("a clean tree exits 0 with no changed file", () => {
    const r = run(repo(), ["--json"]);
    assert.equal(r.status, 0);
    assert.deepEqual(envelope(r).data?.changed, []);
  });

  test("--help prints the usage on stdout, nothing on stderr, exit 0", () => {
    const r = run(os.tmpdir(), ["--help"]);
    assert.equal(r.status, 0);
    assert.match(r.stdout, /^Usage: node pre-handoff\.ts/);
    assert.equal(r.stderr, "");
  });

  test("without --json the findings go to stdout and the summary names the counts", () => {
    const dir = repo();
    put(dir, "README.md", "readme\nmore\n");
    const r = run(dir, ["--scope", "src/"]);
    assert.equal(r.status, 1);
    assert.match(r.stdout, /error scope: README\.md/);
    assert.match(r.stdout, /1 changed file\(s\) against HEAD, 1 error\(s\), 0 warning\(s\)/);
  });

  test("--json on a failure: ok false, every finding carries rule and message, text on stderr", () => {
    const dir = repo();
    put(dir, "README.md", "readme\nmore\n");
    const r = run(dir, ["--scope", "src/", "--json"]);
    assert.equal(r.status, 1);
    const env = envelope(r);
    assert.equal(env.ok, false);
    for (const f of env.findings) {
      assert.ok(f.rule.length > 0);
      assert.ok(f.message.length > 0);
    }
    assert.match(r.stderr, /pre-handoff\.ts: 1 changed file/);
  });
});

describe("pre-handoff: scope", () => {
  test("a modified file outside the scope is an error finding naming it", () => {
    const dir = repo();
    put(dir, "src/a.txt", "one\ntwo\n");
    put(dir, "README.md", "readme\nmore\n");
    const r = run(dir, ["--scope", "src/", "--json"]);
    assert.equal(r.status, 1);
    const f = envelope(r).findings;
    assert.equal(f.length, 1);
    assert.equal(f[0]?.rule, "scope");
    assert.match(f[0]?.message ?? "", /README\.md/);
  });

  test("an untracked file outside the scope is reported too", () => {
    const dir = repo();
    put(dir, "notes.txt", "scratch\n");
    const r = run(dir, ["--scope", "src/", "--json"]);
    assert.equal(r.status, 1);
    assert.deepEqual(rules(r), ["scope"]);
    assert.deepEqual(envelope(r).data?.changed, [{ path: "notes.txt", status: "A" }]);
  });

  test("a file entry, a directory entry and a glob each cover their files", () => {
    const dir = repo();
    put(dir, "src/a.txt", "one\ntwo\n");
    put(dir, "README.md", "readme\nmore\n");
    put(dir, "bin/new.sh", "x\n");
    assert.equal(run(dir, ["--scope", "src/a.txt", "--scope", "README.md", "--scope", "bin/*.sh"]).status, 0);
    assert.equal(run(dir, ["--scope=src", "--scope=README.md", "--scope=bin/**"]).status, 0);
    assert.deepEqual(rules(run(dir, ["--scope", "src/*.txt", "--json"])), ["scope", "scope"]);
  });

  test("without --scope the check is skipped and the data lists the changed files", () => {
    const dir = repo();
    put(dir, "README.md", "readme\nmore\n");
    const r = run(dir, ["--json"]);
    assert.equal(r.status, 0);
    assert.equal(envelope(r).data?.scope, null);
    assert.deepEqual(envelope(r).data?.changed, [{ path: "README.md", status: "M" }]);
  });
});

describe("pre-handoff: non-ASCII characters", () => {
  test("an arrow replaced by -> is an error finding naming the file and the character", () => {
    const dir = repo();
    put(dir, "src/doc.md", "key -> value\n");
    const r = run(dir, ["--scope", "src/", "--json"]);
    assert.equal(r.status, 1);
    const f = envelope(r).findings;
    assert.deepEqual(
      f.map((x) => x.rule),
      ["non-ascii-lost"],
    );
    assert.match(f[0]?.message ?? "", /src\/doc\.md/);
    assert.match(f[0]?.message ?? "", /→/);
    assert.match(f[0]?.message ?? "", /U\+2192/);
  });

  test("an arrow kept on a rewritten line is not lost", () => {
    const dir = repo();
    put(dir, "src/doc.md", "key → other value\n");
    const r = run(dir, ["--scope", "src/", "--json"]);
    assert.equal(r.status, 0, r.stdout);
    assert.deepEqual(envelope(r).findings, []);
  });

  test("an added non-ASCII character is a warning: listed, exit 0", () => {
    const dir = repo();
    put(dir, "src/a.txt", "one\ncafé\n");
    const r = run(dir, ["--scope", "src/", "--json"]);
    assert.equal(r.status, 0);
    const f = envelope(r).findings;
    assert.equal(f[0]?.rule, "non-ascii-added");
    assert.equal(f[0]?.severity, "warning");
    assert.equal(envelope(r).ok, true);
  });

  test("a non-ASCII character in an untracked file is a warning", () => {
    const dir = repo();
    put(dir, "src/new.txt", "naïve\n");
    const r = run(dir, ["--scope", "src/", "--json"]);
    assert.equal(r.status, 0);
    assert.deepEqual(rules(r), ["non-ascii-added"]);
  });

  test("a staged change is reviewed like an unstaged one", () => {
    const dir = repo();
    put(dir, "src/doc.md", "key -> value\n");
    git(dir, "add", "src/doc.md");
    assert.deepEqual(rules(run(dir, ["--json"])), ["non-ascii-lost"]);
  });
});

describe("pre-handoff: executable bit and --base", () => {
  test("a file that went from 100755 to 100644 is an error finding", () => {
    const dir = repo();
    fs.chmodSync(path.join(dir, "bin/run.sh"), 0o644);
    const r = run(dir, ["--json"]);
    assert.equal(r.status, 1);
    const f = envelope(r).findings;
    assert.deepEqual(
      f.map((x) => x.rule),
      ["mode-lost"],
    );
    assert.match(f[0]?.message ?? "", /bin\/run\.sh/);
    assert.match(f[0]?.message ?? "", /100755 to 100644/);
  });

  test("a deleted executable file is not a lost mode", () => {
    const dir = repo();
    fs.rmSync(path.join(dir, "bin/run.sh"));
    assert.equal(run(dir, ["--json"]).status, 0);
  });

  test("--base includes the commits of the branch", () => {
    const dir = repo();
    git(dir, "checkout", "-q", "-b", "work");
    put(dir, "src/doc.md", "key -> value\n");
    git(dir, "commit", "-q", "-am", "replace the arrow");
    assert.equal(run(dir, ["--json"]).status, 0, "against HEAD the tree is clean");
    const r = run(dir, ["--base", "main", "--json"]);
    assert.equal(r.status, 1);
    assert.deepEqual(rules(r), ["non-ascii-lost"]);
    assert.equal(envelope(r).data?.base, "main");
  });
});

describe("pre-handoff: usage and precondition errors", () => {
  test("an unknown option, a missing value and an extra argument exit 2", () => {
    const dir = repo();
    for (const args of [["--nope"], ["--scope"], ["--base="], ["stray"]]) {
      const r = run(dir, args);
      assert.equal(r.status, 2, args.join(" "));
      assert.equal(r.stdout, "", args.join(" "));
      assert.match(r.stderr, /pre-handoff\.ts:/);
    }
  });

  test("--json on exit 2 still prints the object: ok false, data null, rule usage", () => {
    const r = run(repo(), ["--nope", "--json"]);
    assert.equal(r.status, 2);
    const env = envelope(r);
    assert.equal(env.ok, false);
    assert.equal(env.data, null);
    assert.deepEqual(rules(r), ["usage"]);
  });

  test("outside a git repository: exit 3 with a message, rule precondition, nothing written", () => {
    const dir = fs.mkdtempSync(path.join(root, "plain-"));
    const r = run(dir, ["--json"]);
    assert.equal(r.status, 3);
    const env = envelope(r);
    assert.equal(env.ok, false);
    assert.equal(env.data, null);
    assert.deepEqual(rules(r), ["precondition"]);
    assert.match(env.findings[0]?.message ?? "", /not inside a git repository/);
    assert.deepEqual(fs.readdirSync(dir), []);
  });

  test("an unknown base ref exits 3", () => {
    const r = run(repo(), ["--base", "no-such-ref", "--json"]);
    assert.equal(r.status, 3);
    assert.deepEqual(rules(r), ["precondition"]);
  });

  test("the script writes nothing: the tree and the index are unchanged by a run", () => {
    const dir = repo();
    put(dir, "src/doc.md", "key -> value\n");
    const before = spawnSync("git", ["status", "--porcelain=v2"], { cwd: dir, env: ENV, encoding: "utf8" }).stdout;
    run(dir, ["--scope", "src/"]);
    const after = spawnSync("git", ["status", "--porcelain=v2"], { cwd: dir, env: ENV, encoding: "utf8" }).stdout;
    assert.equal(after, before);
  });
});

describe("pre-handoff from a copy of the whole skill directory", () => {
  for (const layout of Object.keys(LAYOUT_PACKAGE) as Layout[]) {
    test(`layout ${layout}: runs with no Node warning`, () => {
      const dir = path.join(root, "copies", layout, "developer");
      fs.mkdirSync(dir, { recursive: true });
      fs.cpSync(SKILL_DIR, dir, { recursive: true });
      const pkg = LAYOUT_PACKAGE[layout];
      if (pkg !== undefined) fs.writeFileSync(path.join(dir, "package.json"), pkg);

      const work = repo();
      put(work, "src/doc.md", "key -> value\n");
      const r = run(work, ["--scope", "src/", "--json"], dir);
      assert.equal(r.status, 1, r.stdout + r.stderr);
      assert.doesNotMatch(r.stderr, WARNING);
      assert.deepEqual(rules(r), ["non-ascii-lost"]);
      const help = run(work, ["--help"], dir);
      assert.equal(help.status, 0);
      assert.equal(help.stderr, "");
    });
  }
});
