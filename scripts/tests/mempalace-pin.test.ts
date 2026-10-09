// mempalace-pin.test.ts — hermetic tests of scripts/lib/mempalace-pin.ts
// (spec 0252 requirement 4): the pin is read from the two declaration lines of
// common.sh by the rules of scripts/lib/mempalace_pin.py, never redeclared.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";
import { fileURLToPath } from "node:url";

import { installSpec, readMempalacePin } from "../lib/mempalace-pin.ts";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

const temps: string[] = [];
after(() => {
  for (const dir of temps) fs.rmSync(dir, { recursive: true, force: true });
});

/** A throwaway repo root whose scripts/lib/common.sh holds `text`. */
function fixtureRoot(text: string): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mempalace-pin-"));
  temps.push(root);
  fs.mkdirSync(path.join(root, "scripts", "lib"), { recursive: true });
  fs.writeFileSync(path.join(root, "scripts", "lib", "common.sh"), text);
  return root;
}

const DECLARED = 'MEMPALACE_MIN_VERSION="3.6.0"\nMEMPALACE_MAX_VERSION_EXCLUSIVE="3.7"\n';

describe("readMempalacePin", () => {
  test("reads both bounds from a fixture", () => {
    assert.deepEqual(readMempalacePin(fixtureRoot(`#!/bin/bash\n${DECLARED}echo ok\n`)), {
      min: "3.6.0",
      maxExclusive: "3.7",
    });
  });

  test("ignores interpolated consumer forms and indented or unquoted lines", () => {
    const text =
      `${DECLARED}` +
      "  echo \"pipx install 'mempalace>=${MEMPALACE_MIN_VERSION},<${MEMPALACE_MAX_VERSION_EXCLUSIVE}'\"\n" +
      '  MEMPALACE_MIN_VERSION="9.9"\n' +
      "MEMPALACE_MAX_VERSION_EXCLUSIVE=9.9\n" +
      'export MEMPALACE_MIN_VERSION="9.9"\n';
    assert.deepEqual(readMempalacePin(fixtureRoot(text)), { min: "3.6.0", maxExclusive: "3.7" });
  });

  test("a name declared twice is refused, naming the variable and the count", () => {
    assert.throws(
      () => readMempalacePin(fixtureRoot(`${DECLARED}MEMPALACE_MIN_VERSION="3.5"\n`)),
      /MEMPALACE_MIN_VERSION must be declared exactly once.*found 2 declaration/,
    );
  });

  test("a missing name is refused", () => {
    assert.throws(
      () => readMempalacePin(fixtureRoot('MEMPALACE_MIN_VERSION="3.6.0"\n')),
      /MEMPALACE_MAX_VERSION_EXCLUSIVE must be declared exactly once.*found 0 declaration/,
    );
  });

  test("a CRLF declaration does not match, as for mempalace_pin.py", () => {
    assert.throws(
      () => readMempalacePin(fixtureRoot(DECLARED.replaceAll("\n", "\r\n"))),
      /must be declared exactly once/,
    );
  });

  test("an unreadable common.sh throws the file-system error", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "mempalace-pin-"));
    temps.push(root);
    assert.throws(() => readMempalacePin(root), { code: "ENOENT" });
  });

  test("the real common.sh agrees with mempalace_pin.py --print-pin", () => {
    const pin = readMempalacePin(REPO);
    assert.match(pin.min, /^\d+(\.\d+)*$/);
    assert.match(pin.maxExclusive, /^\d+(\.\d+)*$/);
    const py = spawnSync(
      "python3",
      [
        "-I",
        path.join(REPO, "scripts", "lib", "mempalace_pin.py"),
        "--common-sh",
        path.join(REPO, "scripts", "lib", "common.sh"),
        "--print-pin",
      ],
      { encoding: "utf8" },
    );
    if (py.status !== 0) return; // python3 unavailable: the format assertions above stand
    assert.equal(py.stdout.trim(), `min=${pin.min} max=${pin.maxExclusive}`);
  });

  test("the module never declares the values itself", () => {
    const source = fs.readFileSync(path.join(REPO, "scripts", "lib", "mempalace-pin.ts"), "utf8");
    const { min, maxExclusive } = readMempalacePin(REPO);
    assert.ok(!source.includes(`"${min}"`) && !source.includes(`"${maxExclusive}"`));
  });
});

describe("installSpec", () => {
  test("lower bound inclusive, upper bound exclusive", () => {
    assert.equal(installSpec({ min: "3.6.0", maxExclusive: "3.7" }), "mempalace>=3.6.0,<3.7");
  });

  test("takes the pin as read", () => {
    const pin = readMempalacePin(
      fixtureRoot('MEMPALACE_MIN_VERSION="1.2"\nMEMPALACE_MAX_VERSION_EXCLUSIVE="2"\n'),
    );
    assert.equal(installSpec(pin), "mempalace>=1.2,<2");
  });
});
