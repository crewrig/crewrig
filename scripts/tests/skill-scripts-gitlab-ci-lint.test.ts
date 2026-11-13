// skill-scripts-gitlab-ci-lint.test.ts — lint-gitlab-ci.ts (spec 0301 R6, R10), driven only through a
// GLAB_BIN stub, from a copy of the built skill outside the repository, with no network. The replay
// fixtures are real glab 1.130.0 captures, scrubbed, plus a few derived outputs (see
// fixtures/skill-scripts/gitlab-ci-0301/glab/PROVENANCE.txt).

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, beforeEach, describe, test } from "node:test";

import {
  copySkill,
  envelope,
  glabStub,
  gone,
  run,
  tempDir,
} from "./lib/skill-scripts-gitlab-ci-cli.ts";

const REPO = path.resolve(import.meta.dirname, "..", "..");
const root = tempDir("gitlab-ci-lint-");
after(() => fs.rmSync(root, { recursive: true, force: true }));
assert.ok(!root.startsWith(REPO), "the copy must live outside the repository");
const skill = copySkill(root);
const glab = glabStub(root);
const work = path.join(root, "work");
fs.mkdirSync(work);
fs.writeFileSync(path.join(work, "ci.yml"), "build:\n  script: make\n");
fs.writeFileSync(path.join(work, ".gitlab-ci.yml"), "build:\n  script: make\n");
beforeEach(() => glab.reset());

const lint = (args: string[], env: Record<string, string>) =>
  run(skill, "lint-gitlab-ci", args, { cwd: work, env });
const json = (fixture: string, extra: string[] = []) => {
  const r = lint(["ci.yml", "--json", ...extra], glab.replay(fixture));
  return { r, env: envelope(r) };
};
const NOT_VALIDATED = /not validated/i;

describe("verdicts", () => {
  test("valid (real capture): exit 0, ok true, no finding, data names the file and the verdict", () => {
    const { r, env } = json("valid");
    assert.equal(r.status, 0, r.stderr);
    assert.equal(env.ok, true);
    assert.deepEqual(env.findings, []);
    assert.equal(env.data?.["file"], "ci.yml");
    assert.equal(env.data?.["verdict"], "valid");
  });
  test("invalid (real capture): exit 1, one invalid-config finding carrying the numbered error", () => {
    const { r, env } = json("invalid");
    assert.equal(r.status, 1, r.stderr);
    assert.equal(env.ok, false);
    assert.equal(env.findings.length, 1);
    assert.equal(env.findings[0]?.rule, "invalid-config");
    assert.match(env.findings[0]?.message ?? "", /chosen stage nope does not exist/);
    assert.equal(env.data?.["verdict"], "invalid");
  });
  for (const [fixture, error] of [
    ["invalid-syntax", /did not find expected/],
    ["invalid-rules", /invalid expression syntax/],
    ["invalid-include", /nope\.yml.*does not exist/],
  ] as [string, RegExp][])
    test(`${fixture} (real capture): exit 1 with an invalid-config finding stating the error`, () => {
      const { r, env } = json(fixture);
      assert.equal(r.status, 1, r.stderr);
      assert.deepEqual(
        env.findings.map((f) => f.rule),
        ["invalid-config"],
      );
      assert.match(env.findings[0]?.message ?? "", error);
    });
  test("derived: two numbered lines give two findings, one per line", () => {
    const { r, env } = json("derived-two-lines");
    assert.equal(r.status, 1);
    assert.equal(env.findings.length, 2);
    assert.ok(env.findings.every((f) => f.rule === "invalid-config"));
    assert.match(env.findings[0]?.message ?? "", /\ba\b/);
    assert.match(env.findings[1]?.message ?? "", /\bb\b/);
  });
  test("derived: both markers on exit 0, invalid takes precedence", () => {
    const { r, env } = json("derived-both-markers");
    assert.equal(r.status, 1);
    assert.equal(env.ok, false);
    assert.ok(env.findings.some((f) => f.rule === "invalid-config"));
    assert.ok(!env.findings.some((f) => f.rule === "precondition"));
  });
  test("human mode: the error text is printed and the exit code is the same", () => {
    const r = lint(["ci.yml"], glab.replay("invalid"));
    assert.equal(r.status, 1);
    assert.match(r.stdout + r.stderr, /chosen stage nope/);
  });
});

describe("not validated: exit 3, rule precondition, says NOT validated server-side", () => {
  const cases: [string, string, RegExp | undefined][] = [
    ["authentication failure (real capture, 401)", "auth-failure", /authenticat/i],
    ["connection failure (real capture, no such host)", "connection-failure", /connect/i],
    ["outside a git repository (real capture)", "not-a-repository", /checkout|repositor/i],
    ["derived: exit 0 without a marker", "derived-exit0-no-marker", /unrecogni[sz]ed/i],
    ["derived: exit 1 without a marker", "derived-exit1-no-marker", /unrecogni[sz]ed/i],
    ["derived: unclassifiable standard error", "derived-unrecognized-stderr", /unrecogni[sz]ed/i],
  ];
  for (const [title, fixture, cause] of cases)
    test(title, () => {
      const { r, env } = json(fixture);
      assert.equal(r.status, 3, r.stdout + r.stderr);
      assert.equal(env.ok, false);
      assert.equal(env.data, null);
      assert.deepEqual(
        env.findings.map((f) => f.rule),
        ["precondition"],
      );
      assert.match(env.findings[0]?.message ?? "", NOT_VALIDATED);
      if (cause !== undefined) assert.match(env.findings[0]?.message ?? "", cause);
    });

  test("missing binary: exit 3 naming the missing binary", () => {
    const r = lint(["ci.yml", "--json"], { GLAB_BIN: path.join(root, "no-such", "glab") });
    assert.equal(r.status, 3, r.stdout + r.stderr);
    const env = envelope(r);
    assert.equal(env.findings[0]?.rule, "precondition");
    assert.match(
      env.findings[0]?.message ?? "",
      /not installed|not found|missing|no such|binary|could not be started/i,
    );
    assert.match(env.findings[0]?.message ?? "", NOT_VALIDATED);
  });

  test("hang past --timeout: exit 3 naming the timeout, and the whole process tree is gone", () => {
    const pidFile = path.join(root, "hang.pid");
    fs.rmSync(pidFile, { force: true });
    fs.rmSync(`${pidFile}.child`, { force: true });
    const started = Date.now();
    const r = lint(["ci.yml", "--json", "--timeout", "1"], glab.hang(pidFile));
    assert.ok(Date.now() - started < 20_000, "the bounded wait must end the run");
    assert.equal(r.status, 3, r.stdout + r.stderr);
    const env = envelope(r);
    assert.equal(env.findings[0]?.rule, "precondition");
    assert.match(env.findings[0]?.message ?? "", /timeout|timed out/i);
    assert.match(env.findings[0]?.message ?? "", NOT_VALIDATED);
    const pids = [pidFile, `${pidFile}.child`].map((f) => Number(fs.readFileSync(f, "utf8")));
    assert.ok(pids.every((pid) => pid > 0));
    assert.notEqual(pids[0], pids[1]);
    const deadline = Date.now() + 2_000;
    while (!pids.every(gone) && Date.now() < deadline)
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
    const leaked = pids.filter((pid) => !gone(pid));
    for (const pid of leaked) process.kill(pid, "SIGKILL"); // do not leak it from a failing run
    assert.deepEqual(leaked, [], "the stub and its child must both be gone (ESRCH)");
  });
});

describe("target and arguments", () => {
  test("missing file: exit 3 naming the file, glab is not called", () => {
    const r = lint(["absent.yml", "--json"], glab.replay("valid"));
    assert.equal(r.status, 3);
    const env = envelope(r);
    assert.equal(env.findings[0]?.rule, "precondition");
    assert.match(env.findings[0]?.message ?? "", /absent\.yml/);
    assert.deepEqual(glab.calls(), []);
  });
  test("a bad target is reported before tool availability: the finding names the file, not glab", () => {
    const r = lint(["absent.yml", "--json"], { GLAB_BIN: path.join(root, "no-such", "glab") });
    assert.equal(r.status, 3);
    const msg = envelope(r).findings[0]?.message ?? "";
    assert.match(msg, /absent\.yml/);
    assert.doesNotMatch(msg, /not installed|binary/i);
  });
  test("the file argument defaults to .gitlab-ci.yml", () => {
    const r = lint(["--json"], glab.replay("valid"));
    assert.equal(r.status, 0, r.stderr);
    assert.match(JSON.stringify(envelope(r).data), /\.gitlab-ci\.yml/);
    assert.match(glab.calls()[0]?.join(" ") ?? "", /\.gitlab-ci\.yml/);
  });
  test("glab receives `ci lint`, the file and --repo, and nothing else", () => {
    lint(["ci.yml", "--repo", "group/project", "--json"], glab.replay("valid"));
    const [call] = glab.calls();
    assert.deepEqual(call?.slice(0, 2), ["ci", "lint"]);
    const rest = (call ?? []).slice(2);
    assert.deepEqual(
      [...rest.map((a) => (a.endsWith("ci.yml") ? "<file>" : a))].sort(),
      ["--repo", "<file>", "group/project"].sort(),
    );
    glab.reset();
    lint(["ci.yml", "--json"], glab.replay("valid"));
    assert.deepEqual(glab.calls()[0]?.slice(0, 2), ["ci", "lint"]);
    assert.equal(glab.calls()[0]?.length, 3, "without --repo only the file follows `ci lint`");
  });
  test("the script writes nothing in the working directory", () => {
    const before = fs.readdirSync(work).sort();
    lint(["ci.yml"], glab.replay("valid"));
    assert.deepEqual(fs.readdirSync(work).sort(), before);
  });
  for (const [title, args] of [
    ["unknown option", ["--frobnicate"]],
    ["two files", ["a.yml", "b.yml"]],
    ["--repo without a value", ["ci.yml", "--repo"]],
    ["--timeout without a number", ["ci.yml", "--timeout", "soon"]],
    ["--timeout zero", ["ci.yml", "--timeout", "0"]],
  ] as [string, string[]][])
    test(`usage error (${title}): exit 2, glab not called`, () => {
      const r = lint(args, glab.replay("valid"));
      assert.equal(r.status, 2, r.stdout + r.stderr);
      assert.deepEqual(glab.calls(), []);
      const j = lint(["--json", ...args], glab.replay("valid"));
      assert.equal(j.status, 2);
      const env = envelope(j);
      assert.equal(env.ok, false);
      assert.equal(env.data, null);
      assert.equal(env.findings[0]?.rule, "usage");
    });
  test("usage is checked before the target: a bad option with a missing file exits 2", () => {
    assert.equal(lint(["absent.yml", "--frobnicate"], glab.replay("valid")).status, 2);
  });
});

describe("--json and --help shape", () => {
  test("--json prints exactly one object on stdout, human text on stderr", () => {
    const r = lint(["ci.yml", "--json"], glab.replay("derived-two-lines"));
    assert.equal(r.stdout.trimEnd().split("\n").length, 1);
    assert.deepEqual(Object.keys(envelope(r)).sort(), ["data", "findings", "ok"]);
    assert.notEqual(r.stderr, "");
  });
  test("--help: usage on stdout, exit 0, naming the network call, GLAB_BIN, --timeout and the exit 3 meaning", () => {
    const r = lint(["--help"], {});
    assert.equal(r.status, 0);
    assert.equal(r.stderr, "");
    for (const needle of [/glab ci lint/, /GLAB_BIN/, /--timeout/, /--repo/, /\b3\b/, /server/i])
      assert.match(r.stdout, needle);
  });
});
