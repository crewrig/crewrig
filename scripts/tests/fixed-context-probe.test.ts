// Unit tests of the fixed-context probe (issue #1994). Fixture transcripts only: no model call.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  compare,
  findTranscript,
  firstCallTokens,
  measureSession,
  parseThreshold,
  refuseInCi,
} from "../lib/fixed-context-probe.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "..", "..");
const projects = path.join(here, "fixtures", "fixed-context-probe");
const sess1 = path.join(projects, "proj", "sess1.jsonl");

describe("firstCallTokens", () => {
  test("sums input + cache read + cache creation of the first assistant call only", () => {
    assert.equal(firstCallTokens(fs.readFileSync(sess1, "utf8")), 73003);
  });
  test("skips attachments, user turns and malformed lines", () => {
    const text =
      'oops\n{"type":"attachment"}\n{"type":"assistant","message":{"usage":{"input_tokens":5}}}';
    assert.equal(firstCallTokens(text), 5);
  });
  test("is null without any assistant usage", () => {
    assert.equal(firstCallTokens('{"type":"user"}\n'), null);
  });
});

describe("measureSession", () => {
  test("returns the worker and each subagent, typed by the meta sidecar", () => {
    const m = measureSession(sess1).map((x) => [x.kind, x.agent, x.tokens]);
    assert.deepEqual(m, [
      ["worker", "main", 73003],
      ["subagent", "developer", 30000],
      ["subagent", "agent-a2", 15002],
    ]);
  });
  test("findTranscript resolves a session id without the project slug and rejects odd ids", () => {
    assert.equal(findTranscript(projects, "sess1"), sess1);
    assert.equal(findTranscript(projects, "../sess1"), null);
    assert.equal(findTranscript(projects, "missing"), null);
  });
});

describe("threshold", () => {
  const t = parseThreshold(
    fs.readFileSync(path.join(repo, "scripts/fixed-context-threshold.json"), "utf8"),
  );
  test("the committed thresholds are the ADR-0025 targets", () => {
    assert.deepEqual(t, { worker: 40000, subagent: 30000 });
  });
  test("a value equal to the limit passes, one above breaches", () => {
    const b = compare(measureSession(sess1), t);
    assert.deepEqual(
      b.map((x) => [x.kind, x.agent, x.excess]),
      [["worker", "main", 33003]],
    );
    assert.equal(
      compare([{ kind: "subagent", agent: "d", tokens: 30001, transcript: "" }], t).length,
      1,
    );
  });
  test("rejects a non-positive limit", () => {
    assert.throws(() => parseThreshold('{"worker":0,"subagent":1}'));
  });
});

describe("never runs in CI", () => {
  test("refuseInCi refuses on CI=true and on CI=1, allows unset, empty, 0 and false", () => {
    assert.match(refuseInCi({ CI: "true" }) ?? "", /never runs in CI/);
    assert.notEqual(refuseInCi({ CI: "1" }), null);
    for (const v of [undefined, "", "0", "false"]) assert.equal(refuseInCi({ CI: v }), null);
  });
  test("the script refuses with exit 3 before any model call when CI is set", () => {
    const r = spawnSync(
      process.execPath,
      [
        "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON",
        path.join(repo, "scripts/fixed-context-probe.ts"),
      ],
      {
        env: { ...process.env, CI: "true" },
        encoding: "utf8",
      },
    );
    assert.equal(r.status, 3, r.stderr);
    assert.match(r.stderr, /never runs in CI/);
  });
  test("free mode exits 1 on a breach and 0 with --warn-only", () => {
    const run = (extra: string[]) =>
      spawnSync(
        process.execPath,
        [
          "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON",
          path.join(repo, "scripts/fixed-context-probe.ts"),
          "--transcript",
          sess1,
          ...extra,
        ],
        { env: { ...process.env, CI: "true" }, encoding: "utf8" },
      );
    assert.equal(run([]).status, 1);
    const warn = run(["--warn-only"]);
    assert.equal(warn.status, 0);
    assert.match(warn.stderr, /WARN: worker main/);
  });
  test("no workflow, CI capability, pre-push tier or CI taskfile runs the paid probe", () => {
    const files = [
      "ci/ci-capabilities.yml",
      "ci/pre-push-tier.json",
      ".gitlab-ci.yml",
      ...fs.readdirSync(path.join(repo, ".github/workflows")).map((f) => `.github/workflows/${f}`),
      ...fs.readdirSync(path.join(repo, "taskfiles/ci")).map((f) => `taskfiles/ci/${f}`),
      "taskfiles/ci.yml",
    ];
    // Only the unit suite (fixed-context-probe.test.ts, id fixed-context-probe-tests) and
    // bare quoted `paths:`/`changes:` list items may name the probe; comments are prose.
    // Every other line, quoted or not, must not invoke the script or the task.
    const forbidden =
      /task\s+(?:ci:)?fixed-context-probe\b|fixed-context-probe\.ts|ci:fixed-context-probe\b/;
    const bareItem = /^\s*-\s*"scripts\/[^"\s]*"\s*$/;
    for (const f of files) {
      const code = fs
        .readFileSync(path.join(repo, f), "utf8")
        .split("\n")
        .filter((l) => !/^\s*#/.test(l) && !bareItem.test(l));
      assert.doesNotMatch(code.join("\n"), forbidden, f);
    }
  });
  test("the guard catches a quoted invocation (self-check)", () => {
    const forbidden = /fixed-context-probe\.ts/;
    const bareItem = /^\s*-\s*"scripts\/[^"\s]*"\s*$/;
    assert.equal(bareItem.test('      - "scripts/fixed-context-probe.ts"'), true);
    assert.equal(bareItem.test('    - "node scripts/fixed-context-probe.ts"'), false);
    assert.match('    - "node scripts/fixed-context-probe.ts"', forbidden);
  });
  test("the unit suite is wired in CI as its own capability, without the paid script", () => {
    const cap = fs.readFileSync(path.join(repo, "ci/ci-capabilities.yml"), "utf8");
    assert.match(cap, /id: fixed-context-probe-tests/);
    assert.match(cap, /--test scripts\/tests\/fixed-context-probe\.test\.ts\n/);
  });
});
