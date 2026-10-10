// setup-usage-capture-wire-path.test.ts — the capture script path of a hook command line on Windows
// (spec 0256 requirement 30 and the Windows requirement 34): the shell rejects a backslash because a
// POSIX hook shell would read it as an escape; on win32 the physical path is written with forward
// slashes, as scripts/lib/hook-command.ts does, so a Windows checkout is wired and not refused.

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { wirePath } from "../lib/setup/usage-capture-fragment.ts";
import { isUnsafePath } from "../lib/setup/usage-capture-state.ts";

const WINDOWS =
  "C:\\Users\\runneradmin\\AppData\\Local\\Temp\\build-fixture-x\\hooks\\usage-capture.ts";

describe("wirePath", () => {
  test("win32 writes the physical path with forward slashes", () => {
    assert.equal(
      wirePath("win32", WINDOWS),
      "C:/Users/runneradmin/AppData/Local/Temp/build-fixture-x/hooks/usage-capture.ts",
    );
  });

  test("a POSIX platform leaves the path alone, backslash included", () => {
    assert.equal(
      wirePath("linux", "/srv/a b/hooks/usage-capture.ts"),
      "/srv/a b/hooks/usage-capture.ts",
    );
    assert.equal(wirePath("darwin", WINDOWS), WINDOWS);
  });

  test("the wired Windows path is safe, the unwired one is the backslash the shell rejects", () => {
    assert.equal(isUnsafePath(wirePath("win32", WINDOWS)), false);
    assert.equal(isUnsafePath(wirePath("linux", WINDOWS)), true);
  });

  test("a quote, a dollar sign, a backtick or a newline stays unsafe on win32", () => {
    for (const bad of ['C:\\a"b', "C:\\a$b", "C:\\a`b", "C:\\a\nb"]) {
      assert.equal(isUnsafePath(wirePath("win32", bad)), true, JSON.stringify(bad));
    }
  });
});
