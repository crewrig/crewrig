// mempalace-doctor-shell-wrappers.test.ts — ports G12a-g and G12i-k of the retired
// test-mempalace-doctor.sh (spec 0263, PR E, issue #1417): `#!/bin/sh` console-script
// wrappers and pipx home resolution. pip/distlib and uv put a space-path venv behind a
// shell polyglot; the doctor must report the venv python, never the shell. POSIX only.
// G12h and G12l (shell twins) live in mempalace-common-sh-twins.test.ts.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import {
  GOOD_VERSION,
  POSIX,
  assertNoShellInterpreter,
  fieldLine,
  hasLine,
  makeFakesite,
  makeInterpreter,
  makeToolbin,
  runDoctorIsolated,
  scratchDir,
} from "./lib/doctor-machine.ts";
import { makeBadWrapper, makeShWrapper } from "./lib/doctor-wrappers.ts";
import { realHomeGuard } from "./lib/real-home-guard.ts";

const skip = POSIX ? false : "sh-shim interpreters and /bin/sh wrappers are POSIX only";
const guard = realHomeGuard();
let root = "";
let toolbin = "";
let site = "";

before(() => {
  if (!POSIX) return;
  root = scratchDir("shwrap");
  toolbin = path.join(root, "toolbin");
  makeToolbin(toolbin);
  site = path.join(root, "site");
  makeFakesite(site, GOOD_VERSION);
});
after(() => {
  if (root !== "") fs.rmSync(root, { recursive: true, force: true });
  guard.assertUnchanged();
});

interface Case {
  readonly home: string;
  readonly bin: string;
}
function layout(name: string): Case {
  const home = path.join(root, name, "home");
  const bin = path.join(root, name, "bin");
  fs.mkdirSync(home, { recursive: true });
  fs.mkdirSync(bin, { recursive: true });
  return { home, bin };
}
const doctor = (c: Case, extra?: Record<string, string | undefined>) =>
  runDoctorIsolated(c.home, c.bin, toolbin, extra);
const interp = (venv: string): string => path.join(venv, "bin", "python");
const shebangLine = (py: string): string => fieldLine("shebang interpreter:", py);
const selection = (n: number, py: string): string =>
  `${"selection:".padEnd(24)}candidate ${n}: ${py}`;

describe("G12 /bin/sh console-script wrappers (#1417)", { skip }, () => {
  test("12a: a space-path venv behind a double-quoted wrapper is a clean machine", () => {
    const c = layout("a");
    const venv = path.join(
      root,
      "a",
      "Library",
      "Application Support",
      "pipx",
      "venvs",
      "mempalace",
    );
    makeInterpreter(interp(venv), site);
    makeShWrapper(path.join(venv, "bin", "mempalace"), "dq", interp(venv));
    makeShWrapper(path.join(venv, "bin", "mempalace-mcp"), "dq", interp(venv));
    fs.symlinkSync(path.join(venv, "bin", "mempalace"), path.join(c.bin, "mempalace"));
    fs.symlinkSync(path.join(venv, "bin", "mempalace-mcp"), path.join(c.bin, "mempalace-mcp"));
    const { rc, out } = doctor(c);
    assert.equal(rc, 0, out);
    assert.ok(hasLine(out, shebangLine(interp(venv))), out);
    assertNoShellInterpreter(out);
    assert.ok(out.includes(selection(2, interp(venv))), out);
  });

  test("12b: uv single-quoted form", () => {
    const c = layout("b");
    const venv = path.join(root, "b", "tool dir", "mempalace");
    makeInterpreter(interp(venv), site);
    makeShWrapper(path.join(c.bin, "mempalace"), "sq", interp(venv));
    const { out } = doctor(c);
    assert.ok(hasLine(out, shebangLine(interp(venv))), out);
    assertNoShellInterpreter(out);
    assert.ok(out.includes(selection(2, interp(venv))), out);
  });

  test("12c: an unparseable exec line falls back to the realpath's sibling python", () => {
    const c = layout("c");
    const venv = path.join(root, "c", "reloc venv");
    makeInterpreter(interp(venv), site);
    makeShWrapper(path.join(venv, "bin", "mempalace"), "reloc");
    fs.symlinkSync(path.join(venv, "bin", "mempalace"), path.join(c.bin, "mempalace"));
    const { out } = doctor(c);
    assert.ok(hasLine(out, shebangLine(interp(venv))), out);
    assertNoShellInterpreter(out);
    assert.ok(out.includes(selection(2, interp(venv))), out);
  });

  test("12d: unparseable and no sibling: reported as unresolvable, still no shell", () => {
    const c = layout("d");
    makeShWrapper(path.join(c.bin, "mempalace"), "reloc");
    const { out } = doctor(c);
    assert.ok(out.includes("NO SHEBANG INTERPRETER"), out);
    assertNoShellInterpreter(out);
  });

  test("12e: PIPX_HOME is candidate 1, selected, without fallback or duplicate", () => {
    const c = layout("e");
    const py = path.join(root, "e", "custom pipx home", "venvs", "mempalace", "bin", "python");
    makeInterpreter(py, site);
    makeShWrapper(path.join(c.bin, "mempalace"), "dq", py);
    const { out } = doctor(c, { PIPX_HOME: path.join(root, "e", "custom pipx home") });
    assert.ok(hasLine(out, `    1. ${py}  (resolves)`), out);
    assert.ok(out.includes(selection(1, py)), out);
    assert.ok(!out.includes("fallback selected:"), out);
    assert.equal(out.split(`. ${py}  (`).length - 1, 1, "candidate listed more than once");
    assertNoShellInterpreter(out);
  });

  test("12f: an existing legacy ~/.local/pipx is candidate 1", () => {
    const c = layout("f");
    fs.mkdirSync(path.join(c.home, ".local", "pipx"), { recursive: true });
    const { out } = doctor(c);
    const want = `    1. ${c.home}/.local/pipx/venvs/mempalace/bin/python  (does not resolve)`;
    assert.ok(hasLine(out, want), out);
  });

  const g12g = process.platform === "darwin" ? ["darwin"] : ["xdg", "default"];
  for (const kind of g12g) {
    test(`12g (${kind}): the stock pipx home's venv is candidate 1`, () => {
      const c = layout(`g-${kind}`);
      const xdg = path.join(root, `g-${kind}`, "xdg data");
      const pipxHome =
        kind === "darwin"
          ? path.join(c.home, "Library", "Application Support", "pipx")
          : kind === "xdg"
            ? path.join(xdg, "pipx")
            : path.join(c.home, ".local", "share", "pipx");
      const venv = path.join(pipxHome, "venvs", "mempalace");
      makeInterpreter(interp(venv), site);
      makeShWrapper(path.join(venv, "bin", "mempalace"), "dq", interp(venv));
      fs.symlinkSync(path.join(venv, "bin", "mempalace"), path.join(c.bin, "mempalace"));
      const { out } = doctor(c, kind === "xdg" ? { XDG_DATA_HOME: xdg } : undefined);
      assert.ok(hasLine(out, `    1. ${interp(venv)}  (resolves)`), out);
      assert.ok(out.includes(selection(1, interp(venv))), out);
      assert.ok(!out.includes("fallback selected:"), out);
      assertNoShellInterpreter(out);
    });
  }

  test("12i: a #!/usr/bin/env sh wrapper resolves to the venv python", () => {
    const c = layout("i");
    const venv = path.join(root, "i", "env sh venv");
    makeInterpreter(interp(venv), site);
    makeShWrapper(path.join(c.bin, "mempalace"), "dq", interp(venv), "/usr/bin/env sh");
    const { out } = doctor(c);
    assert.ok(hasLine(out, shebangLine(interp(venv))), out);
    assertNoShellInterpreter(out);
  });

  describe("12j apostrophe-escaped uv paths", () => {
    const venvOf = (): string => path.join(root, "j", "it's dir", "mempalace");
    const trunc = (): string => path.join(root, "j", "it");
    const notTruncated = (out: string): void => {
      assert.ok(!hasLine(out, shebangLine(trunc())), out);
      assert.ok(!out.includes(`. ${trunc()}  (`), out);
    };

    test("(1) the escape is undone, with no sibling to fall back on", () => {
      const c = layout("j/1");
      makeInterpreter(interp(venvOf()), site);
      makeShWrapper(path.join(c.bin, "mempalace"), "sq", interp(venvOf()));
      const { out } = doctor(c);
      assert.ok(hasLine(out, shebangLine(interp(venvOf()))), out);
      assert.ok(out.includes(selection(2, interp(venvOf()))), out);
      notTruncated(out);
      assertNoShellInterpreter(out);
    });

    test("(2) an unparseable line 2 inside the venv falls back to the sibling", () => {
      const c = layout("j/2");
      makeInterpreter(interp(venvOf()), site);
      makeBadWrapper(path.join(venvOf(), "bin", "mempalace-bad"), interp(venvOf()));
      fs.symlinkSync(path.join(venvOf(), "bin", "mempalace-bad"), path.join(c.bin, "mempalace"));
      const { out } = doctor(c);
      assert.ok(hasLine(out, shebangLine(interp(venvOf()))), out);
      notTruncated(out);
      assertNoShellInterpreter(out);
    });

    test("(3) the same unparseable wrapper on PATH, no sibling: unresolvable", () => {
      const c = layout("j/3");
      makeBadWrapper(path.join(c.bin, "mempalace"), interp(venvOf()));
      const { out } = doctor(c);
      assert.ok(out.includes("NO SHEBANG INTERPRETER"), out);
      notTruncated(out);
      assertNoShellInterpreter(out);
    });
  });

  test("12k: a dangling venv python behind a wrapper is still named", () => {
    const c = layout("k");
    const venv = path.join(
      root,
      "k",
      "Library",
      "Application Support",
      "pipx",
      "venvs",
      "mempalace",
    );
    fs.mkdirSync(path.join(venv, "bin"), { recursive: true });
    fs.symlinkSync(path.join(root, "k", "nonexistent", "python3.12"), interp(venv));
    makeShWrapper(path.join(venv, "bin", "mempalace"), "dq", interp(venv));
    fs.symlinkSync(path.join(venv, "bin", "mempalace"), path.join(c.bin, "mempalace"));
    const { out } = doctor(c);
    assert.ok(hasLine(out, shebangLine(interp(venv))), out);
    assert.ok(!out.includes("NO SHEBANG INTERPRETER"), out);
    assertNoShellInterpreter(out);
  });
});
