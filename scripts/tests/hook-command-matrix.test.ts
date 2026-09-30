// hook-command-matrix.test.ts — the guard of spec 0243 R18 (plan step 17): the
// presence of row 37e in docs/cli-matrix.md and the presence of the Antigravity
// statusline entry in MEASURED_SURFACES agree, and the entry's interpreter and
// quoting equal the `[measured: interpreter=<v>; quoting=<v>]` token of the row.
// hook-command.ts never reads the matrix at run time; this test does.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";

import { MEASURED_SURFACES } from "../lib/hook-command.ts";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const MATRIX = fs.readFileSync(path.join(REPO, "docs", "cli-matrix.md"), "utf8");

const row37e = MATRIX.split("\n").find((line) => line.startsWith("| 37e |"));
const entry = MEASURED_SURFACES.find(
  (m) => m.cli === "antigravity" && m.surface === "statusline" && m.os === "win32",
);
const TOKEN = /\[measured: interpreter=([^;\]]+); quoting=([^\]]+)\]/;

describe("row 37e and the Antigravity statusline entry stay in step (R18)", () => {
  test("row 37e and the entry are both present or both absent", () => {
    assert.equal(
      row37e !== undefined,
      entry !== undefined,
      `row 37e present: ${row37e !== undefined}; MEASURED_SURFACES statusline entry present: ${entry !== undefined}`,
    );
  });

  test("row 37e carries exactly one machine-parseable [measured: …] token", () => {
    assert.ok(row37e, "row 37e is missing from docs/cli-matrix.md");
    assert.equal((row37e.match(/\[measured:/g) ?? []).length, 1);
    assert.ok(
      TOKEN.test(row37e),
      "the token does not read [measured: interpreter=<v>; quoting=<v>]",
    );
  });

  test("the token equals the entry's interpreter and quoting", () => {
    const match = TOKEN.exec(row37e ?? "");
    assert.ok(match && entry);
    assert.equal(match[1]?.trim(), entry.interpreter);
    assert.equal(match[2]?.trim(), entry.quoting);
  });

  test("the entry is conforming to row 37b's Antigravity hooks shape", () => {
    const hooks = MEASURED_SURFACES.find((m) => m.cli === "antigravity" && m.surface === "hooks");
    assert.ok(entry && hooks);
    assert.equal(entry.status, "conforming");
    assert.equal(entry.interpreter, hooks.interpreter);
    assert.equal(entry.quoting, hooks.quoting);
  });

  test("a cwd-first entry is described in row 37e and the parity gap, with #1392", () => {
    assert.equal(entry?.interpreterLookup, "cwd-first");
    assert.ok(row37e?.includes("node.cmd") && row37e.includes("#1392"), "row 37e omits the hazard");
    const gap = MATRIX.split("\n").find((line) =>
      line.startsWith("- [GAP] Windows checkout paths"),
    );
    assert.ok(
      gap?.includes("#1392") && gap.includes("current directory"),
      "the parity gap omits it",
    );
  });
});
