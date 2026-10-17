// mempalace-common-sh-twins.test.ts — ports G12h and G12l of the retired
// test-mempalace-doctor.sh (spec 0263, PR E) by sourcing scripts/lib/common.sh in bash.
// Retires with scripts/lib/common.sh (row J4). POSIX only: it spawns bash.
// G12h: `uname` is stubbed so every branch of mempalace_pipx_home runs on any host; the
// Darwin case sets XDG_DATA_HOME, which the TypeScript twin test does not (it leaves it
// unset), so "Darwin ignores XDG" is proven here. G12l: distlib wrapper text that sh would
// expand is rejected by console_script_python; "plain dir" is also covered at unit level by
// mempalace-python-shebang.test.ts, the other three are repeated here against the shell.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { COMMON_SH, POSIX, scratchDir } from "./lib/doctor-machine.ts";

const skip = POSIX ? false : "sources common.sh in bash: POSIX only";
let root = "";
before(() => {
  if (POSIX) root = scratchDir("twins");
});
after(() => {
  if (root !== "") fs.rmSync(root, { recursive: true, force: true });
});

function bash(script: string, env: Record<string, string>, arg = ""): string {
  const base: Record<string, string> = { PATH: process.env["PATH"] ?? "" };
  const r = spawnSync("/bin/bash", ["-c", script, "twin", COMMON_SH, arg], {
    env: { ...base, ...env },
    encoding: "utf8",
  });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout;
}

function pipxHomeUnder(uname: string, home: string, xdg?: string): string {
  const script = `. "$1"; uname() { printf '%s\\n' '${uname}'; }; mempalace_pipx_home`;
  return bash(script, xdg === undefined ? { HOME: home } : { HOME: home, XDG_DATA_HOME: xdg });
}

describe("G12h mempalace_pipx_home, every branch", { skip }, () => {
  test("off macOS, a set XDG_DATA_HOME places the pipx home under it", () => {
    const home = path.join(root, "h", "home");
    fs.mkdirSync(home, { recursive: true });
    const xdg = path.join(root, "h", "xdg data");
    assert.equal(pipxHomeUnder("Linux", home, xdg), `${xdg}/pipx`);
  });

  test("off macOS, an unset XDG_DATA_HOME falls back to ~/.local/share/pipx", () => {
    const home = path.join(root, "h2", "home");
    fs.mkdirSync(home, { recursive: true });
    assert.equal(pipxHomeUnder("Linux", home), `${home}/.local/share/pipx`);
  });

  test("on macOS it is ~/Library/Application Support/pipx, XDG_DATA_HOME notwithstanding", () => {
    const home = path.join(root, "h3", "home");
    fs.mkdirSync(home, { recursive: true });
    const xdg = path.join(root, "h3", "xdg data");
    assert.equal(pipxHomeUnder("Darwin", home, xdg), `${home}/Library/Application Support/pipx`);
  });
});

describe("G12l console_script_python, distlib text sh would expand", { skip }, () => {
  const cases: ReadonlyArray<readonly [string, string]> = [
    ["plain dir", "/opt/plain dir/bin/python"],
    ["d$HOME", ""],
    ["b`id`", ""],
    ["k\\x", ""],
  ];
  for (const [dir, want] of cases) {
    test(`distlib path '/opt/${dir}' gives '${want === "" ? "<none>" : want}'`, () => {
      const file = path.join(root, `w-${Buffer.from(dir).toString("hex")}`);
      fs.writeFileSync(file, `#!/bin/sh\n'''exec' "/opt/${dir}/bin/python" "$0" "$@"\n`);
      const out = bash('. "$1"; console_script_python "$2" || true', { HOME: root }, file).replace(
        /\n$/,
        "",
      );
      assert.equal(out, want);
    });
  }
});
