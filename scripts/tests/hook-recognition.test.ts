// hook-recognition.test.ts — tests for scripts/lib/hook-recognition.ts (spec 0243 R20).
//
// The corpus is shared with the Bash predicate: test-setup-usage-capture-optin.sh
// §6 (a) runs the same rows through `uc_is_capture`. Neither predicate may be
// adjusted without the corpus changing.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";

import { ANTIGRAVITY_STATUSLINE, USAGE_CAPTURE } from "../lib/hook-descriptor.ts";
import { isHookCommand, parseHandler, parseHookCommand } from "../lib/hook-recognition.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CORPUS = JSON.parse(
  fs.readFileSync(path.join(HERE, "fixtures", "usage-capture", "recognition-corpus.json"), "utf8"),
) as { command: string; capture: boolean; note: string }[];

describe("shared recognition corpus", () => {
  test("is not empty and holds both verdicts", () => {
    assert.ok(CORPUS.length >= 20);
    assert.ok(CORPUS.some((r) => r.capture) && CORPUS.some((r) => !r.capture));
  });
  for (const row of CORPUS) {
    test(`${row.capture ? "capture" : "not capture"}: ${JSON.stringify(row.command)} (${row.note})`, () => {
      assert.equal(isHookCommand(row.command, USAGE_CAPTURE), row.capture);
    });
  }
});

describe("parse result", () => {
  test("splits prefix, path, form and arguments of a direct command", () => {
    const parse = parseHookCommand(
      'FOO=1 node "/x/hooks/usage-capture.ts" claude-code Stop',
      USAGE_CAPTURE,
    );
    assert.deepEqual(parse, {
      pre: "FOO=1 node ",
      path: "/x/hooks/usage-capture.ts",
      ext: "ts",
      post: " claude-code Stop",
      quoted: true,
    });
  });

  test("an unquoted legacy path is reported as such", () => {
    const parse = parseHookCommand(
      "bash /x/hooks/usage-capture.sh gemini-cli AfterModel",
      USAGE_CAPTURE,
    );
    assert.equal(parse?.ext, "sh");
    assert.equal(parse?.quoted, false);
  });

  test("the legacy spaced Gemini form counts only when its whole path exists", () => {
    const command = "bash /My Projects/crewrig/hooks/usage-capture.sh gemini-cli AfterModel";
    assert.equal(parseHookCommand(command, USAGE_CAPTURE), null);
    assert.equal(parseHookCommand(command, USAGE_CAPTURE, { pathExists: () => false }), null);
    const parse = parseHookCommand(command, USAGE_CAPTURE, {
      pathExists: (p) => p === "/My Projects/crewrig/hooks/usage-capture.sh",
    });
    assert.equal(parse?.path, "/My Projects/crewrig/hooks/usage-capture.sh");
    assert.equal(parse?.ext, "sh");
  });

  test("a spaced compound that is not the exact legacy shape is never capture, even if it exists", () => {
    const compound = "bash /opt/prep.sh && bash /x/y/hooks/usage-capture.sh gemini-cli AfterModel";
    assert.equal(parseHookCommand(compound, USAGE_CAPTURE, { pathExists: () => true }), null);
  });
});

describe("handler shape", () => {
  const command = 'node "/x/hooks/usage-capture.ts" claude-code Stop';
  test("a handler without a type counts as a command", () => {
    assert.notEqual(parseHandler({ command }, USAGE_CAPTURE), null);
    assert.notEqual(parseHandler({ type: "command", command }, USAGE_CAPTURE), null);
  });
  test("another type, a missing or non-string command, and non-objects do not", () => {
    assert.equal(parseHandler({ type: "prompt", command }, USAGE_CAPTURE), null);
    assert.equal(parseHandler({ type: "command" }, USAGE_CAPTURE), null);
    assert.equal(parseHandler({ command: 3 }, USAGE_CAPTURE), null);
    assert.equal(parseHandler(command, USAGE_CAPTURE), null);
    assert.equal(parseHandler(null, USAGE_CAPTURE), null);
    assert.equal(parseHandler([command], USAGE_CAPTURE), null);
  });
});

describe("another descriptor (R25)", () => {
  test("the status-line shim: bare legacy path or node, no arguments", () => {
    for (const [command, ext] of [
      ["/x/hooks/antigravity-statusline-shim.sh", "sh"],
      ['node "/x/hooks/antigravity-statusline-shim.ts"', "ts"],
      ["node C:/x/hooks/antigravity-statusline-shim.ts", "ts"],
    ] as const) {
      assert.equal(parseHookCommand(command, ANTIGRAVITY_STATUSLINE)?.ext, ext, command);
    }
    assert.equal(
      parseHookCommand("/x/hooks/antigravity-statusline-shim.sh --flag", ANTIGRAVITY_STATUSLINE),
      null,
    );
    assert.equal(
      parseHookCommand("/x/hooks/usage-capture.sh claude-code Stop", ANTIGRAVITY_STATUSLINE),
      null,
    );
  });
});
