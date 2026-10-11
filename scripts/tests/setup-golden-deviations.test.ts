// setup-golden-deviations.test.ts — the tagged deviations of the golden comparison
// (setup-golden-deviations.ts): a tagged difference is ignored on both legs (the `shell` leg is
// the forwarding shim of the same TypeScript entry), every untagged difference still fails (spec 0256 requirement 44). Host-runnable: the golden is
// written into a temporary directory, no setup is run. The cells here ask no question; the
// question sequence and the daemon probe are proved in setup-golden-evidence.test.ts.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";

import { checkGolden, writeGolden } from "./lib/setup-golden-regen.ts";
import type { CaseResult } from "./lib/setup-golden-regen.ts";
import type { GoldenCase } from "./lib/setup-golden-types.ts";

const base = fs.mkdtempSync(path.join(os.tmpdir(), "golden-deviations-"));
after(() => fs.rmSync(base, { recursive: true, force: true }));

const c: GoldenCase = { id: "cell", cli: "claude", note: "a unit cell" };
const cS: GoldenCase = {
  id: "cell-s",
  cli: "claude",
  note: "a cell opted in to tag s",
  deviations: ["s"],
};
const entry = { path: "<HOME>/.claude/a", kind: "file", sha256: "1" };
const launcher = { path: "<HOME>/.crewrig/mcp-daemon-launcher.sh", kind: "file", sha256: "1" };
const unit = {
  path: "<HOME>/.config/systemd/user/mempalace-mcp-server.service",
  kind: "file",
  sha256: "1",
};
const shell = {
  status: 0,
  stdout: "line one\n  Installed launcher: <HOME>/.crewrig/mcp-daemon-launcher.sh\nline two\n",
  stderr: "",
  tree: [entry, launcher, unit],
  bakCount: {},
  fzfRecords: [],
  curlRecords: [{ url: "http://127.0.0.1:41893/mcp", bearer: "<TOKEN>" }],
} as unknown as CaseResult;
writeGolden("claude", "cell", shell, base);
writeGolden("claude", "cell-s", shell, base);

const ts = (patch: Partial<CaseResult>): CaseResult => ({ ...shell, ...patch });
const accepts = (leg: string, result: CaseResult): void => checkGolden(c, result, leg, base);
const rejects = (leg: string, result: CaseResult, pattern: RegExp): void =>
  assert.throws(() => checkGolden(c, result, leg, base), pattern);

describe("golden comparison: tagged deviations of the ts leg", () => {
  test("an identical run passes on both legs", () => {
    accepts("shell", shell);
    accepts("ts", shell);
  });

  test("[answer] echo lines (tag f) are not part of the stdout text on either leg", () => {
    // The echo is still counted as a question (setup-golden-evidence.test.ts): this shell asked none.
    const echoed = ts({ stdout: shell.stdout.replace("line one", "[answer] x=keep\nline one") });
    assert.throws(
      () => checkGolden(c, echoed, "ts", base),
      (error: Error) => /questions/.test(error.message) && !/stdout\.golden/.test(error.message),
    );
    assert.throws(
      () => checkGolden(c, echoed, "shell", base),
      (error: Error) => /questions/.test(error.message) && !/stdout\.golden/.test(error.message),
    );
  });

  test("an untagged stdout difference fails on ts, even beside an [answer] line", () => {
    const changed = ts({ stdout: shell.stdout.replace("line two", "line TWO") });
    rejects("ts", changed, /stdout\.golden[\s\S]*-line two[\s\S]*\+line TWO/);
    rejects("ts", ts({ stdout: `${shell.stdout}extra\n` }), /stdout\.golden/);
  });

  test("an [answer] line the question sequence would not count is not dropped (i1-F21)", () => {
    // Tag (f) drops exactly the `[answer] <id>=<value>` lines `askedByTs` counts: an `[answer]`
    // line without `=` is neither counted nor dropped, so it shows as a stdout difference.
    for (const stray of ["[answer] extra text", "[answer] =no id", "[answer]x=y"]) {
      const text = shell.stdout.replace("line one", `${stray}\nline one`);
      for (const leg of ["ts", "shell"]) {
        assert.throws(
          () => checkGolden(c, ts({ stdout: text }), leg, base),
          /stdout\.golden/,
          `${leg}: ${stray}`,
        );
      }
    }
  });

  test("a line merely containing [answer] (not starting with it) is not a deviation", () => {
    rejects("ts", ts({ stdout: `${shell.stdout}said [answer] x=y\n` }), /stdout\.golden/);
  });

  test("the curl records are NOT a tagged deviation: dropping them fails on both legs", () => {
    const dropped = ts({ curlRecords: [] });
    rejects("ts", dropped, /tree\.json\.golden/);
    rejects("shell", dropped, /tree\.json\.golden/);
  });

  test("every other tree key still fails on ts", () => {
    rejects("ts", ts({ tree: [{ ...entry, sha256: "2" }] } as Partial<CaseResult>), /tree\.json/);
    rejects("ts", ts({ bakCount: { "<HOME>/.claude/a": 1 } }), /tree\.json/);
  });

  test("status and stderr are compared as they are on ts", () => {
    rejects("ts", ts({ status: 2 }), /status\.golden/);
    rejects("ts", ts({ stderr: "boom\n" }), /stderr\.golden/);
  });
});

describe("golden comparison: opt-in tag (s), the TypeScript launcher of the service layer", () => {
  const sPaths = [
    { ...launcher, path: "<HOME>/.crewrig/mcp-daemon-launcher.ts", sha256: "2" },
    { path: "<HOME>/.crewrig/service-lib", kind: "dir" },
    { path: "<HOME>/.crewrig/service-lib/token.ts", kind: "file", sha256: "3" },
    { ...unit, sha256: "4" },
  ];
  const daemon = ts({
    stdout: shell.stdout.replace("launcher.sh", "launcher.ts"),
    tree: [entry, ...sPaths] as unknown as CaseResult["tree"],
  });
  const onS = (leg: string, result: CaseResult): void => checkGolden(cS, result, leg, base);

  test("the launcher files, service-lib, the unit and the launcher line are ignored on ts", () => {
    onS("ts", daemon);
  });

  test("a cell that did not opt in does not get tag (s)", () => {
    rejects("ts", daemon, /tree\.json\.golden|stdout\.golden/);
    rejects("ts", ts({ stdout: daemon.stdout }), /stdout\.golden/);
  });

  test("tag (s) is honoured on the shell leg too (the shim runs the same entry)", () => {
    onS("shell", daemon);
  });

  test("under tag (s) every other difference still fails", () => {
    const other = { ...daemon, tree: [{ ...entry, sha256: "9" }, ...sPaths] };
    assert.throws(() => onS("ts", other as unknown as CaseResult), /tree\.json/);
    const stdout = daemon.stdout.replace("line two", "line 2");
    assert.throws(() => onS("ts", ts({ ...daemon, stdout })), /stdout\.golden/);
    const moved = daemon.stdout.replace("<HOME>/.crewrig", "<HOME>/.other");
    assert.throws(() => onS("ts", ts({ ...daemon, stdout: moved })), /stdout\.golden/);
  });
});
