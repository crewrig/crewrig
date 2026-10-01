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

import { GUARDED_PREFIX } from "../lib/hook-command.ts";
import {
  ANTIGRAVITY_STATUSLINE,
  USAGE_CAPTURE,
  type HookDescriptor,
} from "../lib/hook-descriptor.ts";
import { isHookCommand, parseHandler, parseHookCommand } from "../lib/hook-recognition.ts";
import { rewriteConfig } from "../lib/hook-rewrite.ts";

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
      guarded: false,
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

// Spec 0243 delta-03 R34, scenario "Only the framework's own guarded prefix is recognised".
describe("the guarded prefix (R34)", () => {
  const SHIM = "C:/repo/hooks/antigravity-statusline-shim.ts";
  const GUARDED = `set NoDefaultCurrentDirectoryInExePath=1&& node ${SHIM}`;
  // The R25 fixture shape (hook-rewrite-dedup.test.ts), opted in to the prefix.
  const FIXTURE: HookDescriptor = {
    id: "worktree-guard-fixture",
    basename: "fixture-guard",
    cliIds: { claude: "c", gemini: "g", copilot: "p" },
    args: (_cli, event) => [event],
    argsPattern: "\\s+[A-Za-z]+\\s*",
    guardedPrefix: true,
  };

  test("the statusline descriptor opts in, the usage-capture one does not", () => {
    assert.equal(ANTIGRAVITY_STATUSLINE.guardedPrefix, true);
    assert.equal(USAGE_CAPTURE.guardedPrefix, undefined);
  });

  test("the exact prefix parses as the guarded direct form", () => {
    assert.ok(GUARDED.startsWith(GUARDED_PREFIX));
    assert.deepEqual(parseHookCommand(GUARDED, ANTIGRAVITY_STATUSLINE), {
      pre: `${GUARDED_PREFIX}node `,
      path: SHIM,
      ext: "ts",
      post: "",
      quoted: false,
      guarded: true,
    });
  });

  test("any unquoted forward-slash absolute path is accepted, with or without a drive (v1-F1)", () => {
    const posixPath = "/tmp/co/hooks/antigravity-statusline-shim.ts";
    const parse = parseHookCommand(`${GUARDED_PREFIX}node ${posixPath}`, ANTIGRAVITY_STATUSLINE);
    assert.equal(parse?.guarded, true);
    assert.equal(parse?.path, posixPath);
  });

  const NULL_CASES: [string, string][] = [
    ["another variable", `set FOO=1&& node ${SHIM}`],
    ["a space before &&", `set NoDefaultCurrentDirectoryInExePath=1 && node ${SHIM}`],
    ["another letter case", `set nodefaultcurrentdirectoryinexepath=1&& node ${SHIM}`],
    ["SET in upper case", `SET NoDefaultCurrentDirectoryInExePath=1&& node ${SHIM}`],
    ["a second set before", `set FOO=1&& ${GUARDED}`],
    ["a second set after", `${GUARDED_PREFIX}set FOO=1&& node ${SHIM}`],
    ["a doubled prefix", `${GUARDED_PREFIX}${GUARDED}`],
    ["a quoted path", `${GUARDED_PREFIX}node "${SHIM}"`],
    ["other arguments", `${GUARDED} --brief`],
    ["no space after &&", `set NoDefaultCurrentDirectoryInExePath=1&&node ${SHIM}`],
    ["two spaces after &&", `set NoDefaultCurrentDirectoryInExePath=1&&  node ${SHIM}`],
    ["another value", `set NoDefaultCurrentDirectoryInExePath=0&& node ${SHIM}`],
    ["a relative path", `${GUARDED_PREFIX}node repo/hooks/antigravity-statusline-shim.ts`],
    ["a backslashed path", `${GUARDED_PREFIX}node C:\\repo\\hooks\\antigravity-statusline-shim.ts`],
    ["a cmd.exe metacharacter in the path", `${GUARDED_PREFIX}node C:/a&b/hooks/antigravity-statusline-shim.ts`],
    ["a $ in the path", `${GUARDED_PREFIX}node C:/a$b/hooks/antigravity-statusline-shim.ts`],
    ["a backtick in the path", `${GUARDED_PREFIX}node C:/a\`b/hooks/antigravity-statusline-shim.ts`],
    ["no node", `${GUARDED_PREFIX}${SHIM}`],
    ["bash instead of node", `${GUARDED_PREFIX}bash ${SHIM}`],
    ["the legacy .sh", `${GUARDED_PREFIX}node C:/repo/hooks/antigravity-statusline-shim.sh`],
  ];
  for (const [name, command] of NULL_CASES) {
    test(`null case: ${name}`, () => {
      assert.equal(parseHookCommand(command, ANTIGRAVITY_STATUSLINE), null, command);
    });
  }

  test("the usage-capture signature keeps rejecting the prefix (R20, R34)", () => {
    for (const path of ['"/repo/hooks/usage-capture.ts"', "/repo/hooks/usage-capture.ts", "C:/repo/hooks/usage-capture.ts"]) {
      const command = `${GUARDED_PREFIX}node ${path} claude-code Stop`;
      assert.equal(parseHookCommand(command, USAGE_CAPTURE), null, command);
    }
  });

  test("the opt-in is per descriptor: a hooks-surface fixture recognises it with its own arguments", () => {
    const command = `${GUARDED_PREFIX}node C:/repo/hooks/fixture-guard.ts Stop`;
    const parse = parseHookCommand(command, FIXTURE);
    assert.equal(parse?.guarded, true);
    assert.equal(parse?.post, " Stop");
    assert.equal(parseHookCommand(`${command} extra`, FIXTURE), null);
    const { guardedPrefix: _off, ...withoutOptIn } = FIXTURE;
    assert.equal(parseHookCommand(command, withoutOptIn), null);
  });

  // v1-F4 pin: a guarded command is never left or reported for an environment prefix.
  test("a guarded command is never reported as carrying an environment prefix", () => {
    const command = `${GUARDED_PREFIX}node C:/repo/hooks/fixture-guard.ts Stop`;
    const config = { hooks: { Stop: [{ hooks: [{ type: "command", command }] }] } };
    const result = rewriteConfig(config, { descriptor: FIXTURE, cli: "claude", platform: "win32" });
    assert.equal(result.changed, false);
    assert.deepEqual(
      result.lines.map((l) => l.detail),
      ["already the direct form"],
    );
  });
});
