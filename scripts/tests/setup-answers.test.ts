// setup-answers.test.ts — the command line and the pre-answers of a setup run (spec 0256 req. 13).

import assert from "node:assert/strict";
import { test } from "node:test";

import { createAnswers, unusedWarning } from "../lib/setup/answers.ts";
import { parseSetupArgv } from "../lib/setup/argv.ts";
import type { Cli } from "../lib/setup/context.ts";
import { UsageError } from "../lib/setup/exit.ts";

function recorder() {
  const out: string[] = [];
  const err: string[] = [];
  return {
    out,
    err,
    io: {
      out: (l: string) => void out.push(l),
      err: (l: string) => void err.push(l),
      errRaw: (t: string) => void err.push(t),
    },
  };
}

/** Parse then validate; both steps may throw a usage error. */
function run(argv: string[], cli: Cli = "claude") {
  const r = recorder();
  const answers = () => createAnswers(parseSetupArgv(argv, r.io), cli, r.io);
  return { r, answers };
}

function usageError(argv: string[], pattern: RegExp): void {
  const { r, answers } = run(argv);
  assert.throws(answers, (e: unknown) => e instanceof UsageError && e.status === 2);
  assert.equal(r.err.length, 1, "exactly one diagnostic line");
  assert.match(r.err[0] ?? "", pattern);
  assert.deepEqual(r.out, []);
}

test("--link sets link; unknown arguments are ignored", () => {
  const r = recorder();
  const parsed = parseSetupArgv(["--verbose", "--link", "stray", "-x", "--answer-ish"], r.io);
  assert.equal(parsed.link, true);
  assert.deepEqual(parsed.answers, []);
  assert.equal(parseSetupArgv([], r.io).link, false);
  assert.deepEqual(r.err, []);
});

test("--answer accepts the two-argument and the one-argument forms, repeatably", () => {
  const r = recorder();
  const parsed = parseSetupArgv(
    ["--answer", "transcripts=yes", "--answer=tls-delegation=no"],
    r.io,
  );
  assert.deepEqual(parsed.answers, [
    { id: "transcripts", value: "yes" },
    { id: "tls-delegation", value: "no" },
  ]);
});

test("--answer=a=b splits on the first equals sign only", () => {
  const r = recorder();
  const parsed = parseSetupArgv(["--answer=catalogue.team=a=b"], r.io);
  assert.deepEqual(parsed.answers, [{ id: "catalogue.team", value: "a=b" }]);
});

test("a malformed flag is a usage error with a one-line Error message", () => {
  usageError(["--answer", "transcripts"], /^Error: .*<id>=<value>/);
  usageError(["--answer=transcripts"], /^Error: /);
  usageError(["--answer", "=yes"], /^Error: .*non-empty id/);
  usageError(["--answer=", "x"], /^Error: /);
  usageError(["--answer"], /^Error: .*no argument/);
});

test("an id outside the inventory is a usage error", () => {
  usageError(
    ["--answer", "no-such-question=yes"],
    /^Error: .*unknown question id 'no-such-question'/,
  );
});

test("an id given twice with different values is a usage error; the same value twice is accepted", () => {
  usageError(["--answer", "transcripts=yes", "--answer", "transcripts=no"], /^Error: .*twice/);
  const { answers } = run(["--answer", "transcripts=yes", "--answer", "transcripts=YES"]);
  assert.equal(answers().take("transcripts"), "yes");
});

test("a value outside the question's options is a usage error naming the options", () => {
  usageError(["--answer", "transcripts=maybe"], /^Error: .*'maybe' is not one of: no, yes/);
  usageError(["--answer", "validation.pedagogy="], /^Error: /);
  usageError(["--answer", "transcripts=2"], /^Error: /);
});

test("an option is matched case-insensitively and returned in its own spelling", () => {
  const a = run([
    "--answer",
    "validation.backend=PlanNotator",
    "--answer",
    "rules-action=KEEP",
  ]).answers();
  assert.equal(a.take("validation.backend"), "plannotator");
  assert.equal(a.take("rules-action"), "keep");
});

test("catalogue ids accept an entry name or the empty value", () => {
  const a = run([
    "--answer",
    "catalogue.team=SFEIR-Ouest",
    "--answer=catalogue.expertise=",
    "--answer",
    "catalogue.level=Any Thing",
  ]).answers();
  assert.equal(a.take("catalogue.team"), "SFEIR-Ouest");
  assert.equal(a.take("catalogue.expertise"), "");
  assert.equal(a.take("catalogue.level"), "Any Thing");
});

test("take marks an answer consumed; a missing answer is undefined", () => {
  const a = run(["--answer", "transcripts=yes", "--answer", "overlay.org=no"]).answers();
  assert.equal(a.take("tls-delegation"), undefined);
  assert.deepEqual(a.unused(), ["transcripts", "overlay.org"]);
  assert.equal(a.take("transcripts"), "yes");
  assert.deepEqual(a.unused(), ["overlay.org"]);
});

test("a known id the setup does not ask is accepted, then reported as unused", () => {
  const { r, answers } = run(
    ["--answer", "install-settings=yes", "--answer", "transcripts=no"],
    "copilot",
  );
  const a = answers();
  assert.equal(a.take("transcripts"), "no");
  assert.deepEqual(a.unused(), ["install-settings"]);
  assert.equal(
    unusedWarning(a.unused()),
    "Warning: --answer given for a question that was not asked: install-settings",
  );
  assert.deepEqual(r.err, []);
});

test("the warning lists every unused id and is absent when none", () => {
  assert.equal(unusedWarning([]), undefined);
  assert.equal(
    unusedWarning(["a", "b"]),
    "Warning: --answer given for a question that was not asked: a, b",
  );
});
