// extension-args.test.ts — argument parsing of the extension entries (spec 0254 R5).
// Expected messages are the literal text of scripts/build-extension.sh:60-106 and the
// `${1:?Usage: ...}` lines of the plugin builders and migrate-extension.sh.

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { parseBuildArgs, parseMigrateArgs, parsePluginArgs } from "../lib/extension/args.ts";

describe("parseBuildArgs", () => {
  test("defaults", () => {
    assert.deepEqual(parseBuildArgs([]), { ok: true, check: false, target: "all", extArgs: [] });
  });
  test("--check, --target and extension words in any order", () => {
    assert.deepEqual(parseBuildArgs(["a", "--check", "--target", "claude", "b"]), {
      ok: true,
      check: true,
      target: "claude",
      extArgs: ["a", "b"],
    });
  });
  test("every admissible target", () => {
    for (const t of ["gemini", "claude", "copilot", "antigravity", "all"]) {
      assert.equal(parseBuildArgs(["--target", t]).ok, true, t);
    }
  });
  test("the last --target wins", () => {
    const r = parseBuildArgs(["--target", "gemini", "--target", "copilot"]);
    assert.ok(r.ok);
    assert.equal(r.target, "copilot");
  });
  test("--target as the last word, or with an empty value, requires a value (status 1)", () => {
    const expected = { ok: false, status: 1, message: "Error: --target requires a value" };
    assert.deepEqual(parseBuildArgs(["x", "--target"]), expected);
    assert.deepEqual(parseBuildArgs(["--target", ""]), expected);
  });
  test("a value outside the set is status 2 and named", () => {
    assert.deepEqual(parseBuildArgs(["--target", "vim"]), {
      ok: false,
      status: 2,
      message:
        "Error: --target must be one of gemini, claude, copilot, antigravity, all (got 'vim').",
    });
  });
  test("a flag-looking word after --target is its value", () => {
    const r = parseBuildArgs(["--target", "--check"]);
    assert.ok(!r.ok);
    assert.equal(r.status, 2);
  });
  test("unknown flags are extension arguments", () => {
    const r = parseBuildArgs(["--bogus"]);
    assert.ok(r.ok);
    assert.deepEqual(r.extArgs, ["--bogus"]);
  });
});

describe("parsePluginArgs", () => {
  test("extension and optional output directory; further words are ignored", () => {
    assert.deepEqual(parsePluginArgs(["e"], "s.sh"), { ok: true, extArg: "e", outArg: undefined });
    assert.deepEqual(parsePluginArgs(["e", "o", "z"], "s.sh"), {
      ok: true,
      extArg: "e",
      outArg: "o",
    });
  });
  test("an empty output word selects the default (`${2:-}`)", () => {
    assert.deepEqual(parsePluginArgs(["e", ""], "s.sh"), {
      ok: true,
      extArg: "e",
      outArg: undefined,
    });
  });
  test("no extension: the usage line, status 1", () => {
    const expected = {
      ok: false,
      status: 1,
      message: "Usage: build-claude-plugin.sh <extension-dir-or-name> [output-dir]",
    };
    assert.deepEqual(parsePluginArgs([], "build-claude-plugin.sh"), expected);
    assert.deepEqual(parsePluginArgs([""], "build-claude-plugin.sh"), expected);
  });
});

describe("parseMigrateArgs", () => {
  test("one word, further ignored", () => {
    assert.deepEqual(parseMigrateArgs(["e", "x"]), { ok: true, extArg: "e" });
  });
  test("none: usage, status 1", () => {
    assert.deepEqual(parseMigrateArgs([]), {
      ok: false,
      status: 1,
      message: "Usage: migrate-extension.sh <extension-dir-or-name>",
    });
  });
});
