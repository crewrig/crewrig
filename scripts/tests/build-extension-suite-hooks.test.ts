// build-extension-suite-hooks.test.ts — hook-granular gaps through the real
// `node scripts/build-extension.ts` in a sandbox: Cases 8a-c, 17a-d and 18 (four CLIs, committed,
// matcher). Replaces scripts/tests/test-build-extension.sh (cases 8, 17, 18).
//
// The sed mutation of the `.sh` vocabulary twin (case 17d) is dropped: the builders read
// `hooks-vocab.ts` only, so the mutation of that file is the one that is observable.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { before, describe, test } from "node:test";

import {
  check,
  cloneTemplate,
  createTemplate,
  fixtureManifest,
  mutate,
  render,
  writeFile,
  writeManifest,
} from "./lib/extension-sandbox.ts";

let template = "";
before(() => {
  template = createTemplate();
});

const has = (text: string, ...needles: string[]): void => {
  for (const needle of needles) assert.ok(text.includes(needle), `missing ${needle} in:\n${text}`);
};
const hook = (id: string, event: string, command: string, extra = {}): Record<string, unknown> => ({
  id,
  event,
  command,
  ...extra,
});
const gap = (hookId: string, event: string, extra = {}): Record<string, unknown> => ({
  subject: "hooks",
  target: "antigravity",
  hook: hookId,
  event,
  part: "event",
  reason: "accepted",
  ...extra,
});

describe("Case 8 — a REAL hook-granular gap warns, never fails the render, and fails --check until declared", () => {
  let root = "";
  let dir = "";
  before(() => {
    root = cloneTemplate(template);
    dir = writeManifest(
      root,
      "realgap",
      fixtureManifest("realgap", { hooks: [hook("prompt-logger", "UserPromptSubmit", "echo hi")] }),
    );
  });

  test("Case 8a — the render warns and records the hook-granular gap (hook/event/part), and still exits 0", () => {
    const res = render(root, "all", "realgap");
    assert.equal(res.status, 0, res.combined);
    assert.match(res.combined, /Warning:.*prompt-logger.*antigravity/i);
    const observed = JSON.parse(
      fs.readFileSync(path.join(root, "build", "gaps", "realgap", "observed-gaps.json"), "utf8"),
    ) as Record<string, string>[];
    assert.ok(
      observed.some(
        (g) =>
          g["subject"] === "hooks" &&
          g["target"] === "antigravity" &&
          g["hook"] === "prompt-logger" &&
          g["event"] === "UserPromptSubmit" &&
          g["part"] === "event",
      ),
      JSON.stringify(observed),
    );
  });

  test("Case 8b — --check fails as GAP-UNDECLARED, naming the hook, with no accepted-gaps.json", () => {
    const res = check(root, "realgap");
    assert.notEqual(res.status, 0);
    has(res.combined, "GAP-UNDECLARED", "prompt-logger");
  });

  test("Case 8c — declaring the observed hook-granular gap in accepted-gaps.json makes --check pass", () => {
    writeFile(
      dir,
      "accepted-gaps.json",
      JSON.stringify([gap("prompt-logger", "UserPromptSubmit")]),
    );
    const res = check(root, "realgap");
    assert.equal(res.status, 0, res.combined);
  });
});

describe("Case 17 — R15 gap reconciliation mutation tests", () => {
  let root = "";
  let dir = "";
  const declare = (...gaps: Record<string, unknown>[]): void =>
    writeFile(dir, "accepted-gaps.json", JSON.stringify(gaps));
  before(() => {
    root = cloneTemplate(template);
    dir = writeManifest(
      root,
      "r15fix",
      fixtureManifest("r15fix", { hooks: [hook("probe", "UserPromptSubmit", "echo hi")] }),
    );
    declare(gap("probe", "UserPromptSubmit"));
  });

  test("Case 17a — baseline (gap declared exactly) is clean", () => {
    const res = check(root, "r15fix");
    assert.equal(res.status, 0, res.combined);
  });

  test("Case 17b — deleting the accepted entry fails GAP-UNDECLARED, naming hook/event/target", () => {
    declare();
    const res = check(root, "r15fix");
    assert.notEqual(res.status, 0);
    has(res.combined, "GAP-UNDECLARED", "probe", "UserPromptSubmit", "antigravity");
  });

  test("Case 17c — an accepted entry the render no longer observes fails GAP-STALE, naming it", () => {
    declare(
      gap("probe", "UserPromptSubmit"),
      gap("ghost", "UserPromptSubmit", { reason: "never observed" }),
    );
    const res = check(root, "r15fix");
    assert.notEqual(res.status, 0);
    has(res.combined, "GAP-STALE", "ghost");
  });

  test("Case 17d — two hooks sharing an id but differing only in event produce DISTINGUISHABLE gap keys", () => {
    mutate(
      path.join(root, "scripts", "lib", "extension", "hooks-vocab.ts"),
      'antigravity: { PreToolUse: "PreToolUse" },',
      "antigravity: {},",
    );
    writeManifest(
      root,
      "r15fix",
      fixtureManifest("r15fix", {
        hooks: [hook("probe", "PreToolUse", "echo a"), hook("probe", "UserPromptSubmit", "echo b")],
      }),
    );
    declare(gap("probe", "UserPromptSubmit", { reason: "accepted only this one" }));
    const res = check(root, "r15fix");
    assert.notEqual(res.status, 0);
    has(res.combined, "GAP-UNDECLARED", "PreToolUse");
  });
});

describe("Case 18 — the four retirements are load-bearing, on all four sections", () => {
  const CLIS = ["gemini", "claude", "copilot", "antigravity"];
  test("Case 18 — four CLI rows", () => assert.equal(CLIS.length, 4));
  for (const cli of CLIS) {
    test(`Case 18 (${cli}) — a re-added '${cli}.hooks' per-CLI key is rejected as inadmissible`, () => {
      const root = cloneTemplate(template);
      writeManifest(root, "r27fix", fixtureManifest("r27fix", { [cli]: { hooks: {} } }));
      const res = check(root, "r27fix");
      assert.notEqual(res.status, 0);
      has(res.combined, "VALIDATION-ERROR", `${cli}.hooks`);
    });
  }

  test("Case 18 (committed) — a committed hooks/hooks.json fails as COMMITTED and is named", () => {
    const root = cloneTemplate(template);
    const dir = writeManifest(root, "r27committed", fixtureManifest("r27committed"));
    writeFile(dir, "hooks/hooks.json", '{"hooks":{}}\n');
    const res = check(root, "r27committed");
    assert.notEqual(res.status, 0);
    has(res.combined, "COMMITTED", "hooks/hooks.json");
  });

  test("Case 18 (matcher) — a matcher on a matcher-rejecting event is a validation error, not silently ignored", () => {
    const root = cloneTemplate(template);
    writeManifest(
      root,
      "r27matcher",
      fixtureManifest("r27matcher", {
        hooks: [hook("probe", "UserPromptSubmit", "echo hi", { matcher: "shell" })],
      }),
    );
    const res = check(root, "r27matcher");
    assert.notEqual(res.status, 0);
    has(res.combined, "VALIDATION-ERROR");
    assert.match(res.combined, /matcher/i);
  });
});
