// mempalace-python-shebang.test.ts — hermetic tests of `consoleScriptPython` in
// scripts/lib/mempalace-python.ts (spec 0252 requirement 4): the console-script
// shebang forms of issue #1417. Split from mempalace-python.test.ts to stay under
// the 300-line threshold. Every fixture lives in a throwaway temp dir.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";

import { consoleScriptPython } from "../lib/mempalace-python.ts";

const temps: string[] = [];
after(() => {
  for (const dir of temps) fs.rmSync(dir, { recursive: true, force: true });
});

function tempDir(): string {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "mempalace-python-")));
  temps.push(dir);
  return dir;
}

function writeFile(file: string, text: string, mode = 0o644): string {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text, { mode });
  fs.chmodSync(file, mode);
  return file;
}

/** An env with an empty PATH dir, so no real `mempalace` is ever found. */
function hermeticEnv(extra: Record<string, string> = {}): {
  env: NodeJS.ProcessEnv;
  home: string;
  bin: string;
} {
  const home = tempDir();
  const bin = path.join(home, "bin");
  fs.mkdirSync(bin);
  return { env: { HOME: home, PATH: bin, ...extra }, home, bin };
}

const POSIX = { platform: "linux" } as const;

describe("consoleScriptPython", () => {
  const fixture = (text: string): string =>
    writeFile(path.join(tempDir(), "mempalace"), text, 0o755);

  test("plain shebang and the env form (second token)", () => {
    assert.equal(consoleScriptPython(fixture("#!/a/b/python\nprint(1)\n")), "/a/b/python");
    assert.equal(consoleScriptPython(fixture("#!/usr/bin/env python3\n")), "python3");
    assert.equal(consoleScriptPython(fixture("#!/usr/bin/env python3 -u\n")), "python3");
  });

  test("a CRLF shebang does not leak the carriage return", () => {
    assert.equal(consoleScriptPython(fixture("#!/a/python\r\n")), "/a/python");
  });

  test("no shebang, a missing file and a directory give undefined", () => {
    assert.equal(consoleScriptPython(fixture("print(1)\n")), undefined);
    assert.equal(consoleScriptPython(path.join(tempDir(), "absent")), undefined);
    assert.equal(consoleScriptPython(tempDir()), undefined);
    assert.equal(consoleScriptPython(fixture("#!\n")), undefined);
  });

  test("pip/distlib polyglot wrapper: double-quoted path with a space", () => {
    const script = fixture(
      `#!/bin/sh\n'''exec' "/Users/agent/Library/Application Support/pipx/venvs/mempalace/bin/python" "$0" "$@"\n' '''\n`,
    );
    assert.equal(
      consoleScriptPython(script),
      "/Users/agent/Library/Application Support/pipx/venvs/mempalace/bin/python",
    );
  });

  test("uv polyglot wrapper: single-quoted path", () => {
    const script = fixture(`#!/bin/sh\n'''exec' '/venv path/bin/python' "$0" "$@"\n' '''\n`);
    assert.equal(consoleScriptPython(script), "/venv path/bin/python");
  });

  test("uv escapes an apostrophe as '\\'' and the escape is undone", () => {
    const script = fixture(`#!/bin/sh\n'''exec' '/o'\\''brien dir/bin/python' "$0" "$@"\n' '''\n`);
    assert.equal(consoleScriptPython(script), "/o'brien dir/bin/python");
  });

  test("the wrapper is recognised behind env and other shells", () => {
    const wrapper = `'''exec' "/v p/bin/python" "$0" "$@"\n' '''\n`;
    for (const head of [
      "#!/usr/bin/env sh",
      "#!/bin/bash",
      "#!/bin/dash",
      "#!/bin/zsh",
      "#!/bin/ksh",
    ]) {
      assert.equal(consoleScriptPython(fixture(`${head}\n${wrapper}`)), "/v p/bin/python", head);
    }
  });

  test("a wrapper path that does not exist is still returned", () => {
    const script = fixture(`#!/bin/sh\n'''exec' "/gone/venv/bin/python" "$0" "$@"\n' '''\n`);
    assert.equal(consoleScriptPython(script), "/gone/venv/bin/python");
  });

  test("distlib text that sh would expand is not the path", () => {
    for (const bad of ["/a/$HOME/python", "/a/`x`/python", "/a/b\\c/python"]) {
      const script = fixture(`#!/bin/sh\n'''exec' "${bad}" "$0" "$@"\n' '''\n`);
      assert.equal(consoleScriptPython(script), undefined, bad);
    }
  });

  test("a truncated or option-carrying exec line cannot match", () => {
    for (const line of [
      `'''exec' "/v p/bin/python`,
      `'''exec' "/v p/bin/python" -E "$0" "$@"`,
      `'''exec' '/v p/bin/python' -E "$0" "$@"`,
      `'''exec' '/v p/bin/python`,
      `'''exec' "relative/python" "$0" "$@"`,
    ]) {
      assert.equal(consoleScriptPython(fixture(`#!/bin/sh\n${line}\n`)), undefined, line);
    }
  });

  test("an unparseable wrapper falls back to an executable sibling python only", () => {
    const dir = tempDir();
    const script = writeFile(path.join(dir, "mempalace"), `#!/bin/sh\n# relocatable\n`, 0o755);
    assert.equal(consoleScriptPython(script), undefined);
    writeFile(path.join(dir, "python"), "", 0o644);
    assert.equal(consoleScriptPython(script), undefined, "a non-executable sibling is not a guess");
    writeFile(path.join(dir, "python"), "", 0o755);
    assert.equal(consoleScriptPython(script), path.join(dir, "python"));
  });

  test("the sibling is looked up next to the script's real path", () => {
    const real = tempDir();
    writeFile(path.join(real, "mempalace"), "#!/bin/sh\n# relocatable\n", 0o755);
    writeFile(path.join(real, "python"), "", 0o755);
    const link = path.join(tempDir(), "mempalace");
    fs.symlinkSync(path.join(real, "mempalace"), link);
    assert.equal(consoleScriptPython(link), path.join(real, "python"));
  });

  test("a shell is never returned", () => {
    for (const head of [
      "#!/bin/sh",
      "#!/usr/bin/env bash",
      "#!/bin/zsh -e",
      "#!C:\\Git\\bin\\SH.EXE",
    ]) {
      assert.equal(consoleScriptPython(fixture(`${head}\n`)), undefined, head);
    }
    const sibling = tempDir();
    writeFile(path.join(sibling, "python"), "", 0o755);
    const wrapped = writeFile(
      path.join(sibling, "m"),
      `#!/bin/sh\n'''exec' "/bin/sh" "$0" "$@"\n`,
      0o755,
    );
    assert.equal(consoleScriptPython(wrapped), undefined);
  });
});
