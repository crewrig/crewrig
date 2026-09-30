// hook-command-matrix.test.ts — the guard of spec 0243 R18 and R31 (plan step
// 17): the presence of row 37e in docs/cli-matrix.md and the presence of the
// Antigravity statusline entry in MEASURED_SURFACES agree; the entry's
// interpreter, quoting and planted-binary result equal the
// `[measured: interpreter=<v>; quoting=<v>; planted-binary=<v>; caveats=<v,…>]`
// token of the row; and an entry without the planted-binary result is
// malformed. hook-command.ts never reads the matrix at run time; this test does.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";

import { MEASURED_SURFACES, type MeasuredSurface } from "../lib/hook-command.ts";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const MATRIX = fs.readFileSync(path.join(REPO, "docs", "cli-matrix.md"), "utf8");
const TOKEN =
  /\[measured: interpreter=([^;\]]+); quoting=([^;\]]+)(?:; planted-binary=([^;\]]+))?(?:; caveats=([^\]]+))?\]/;

/** What the guard concludes about one (row, entry) pair; empty when they agree. */
function guardFailures(row: string | undefined, entry: MeasuredSurface | undefined): string[] {
  const failures: string[] = [];
  if ((row !== undefined) !== (entry !== undefined)) {
    failures.push(
      `row 37e present: ${row !== undefined}; statusline entry present: ${entry !== undefined}`,
    );
  }
  if (entry !== undefined && entry.plantedBinary === undefined) {
    failures.push("the entry lacks the planted-binary result (whatever its status)");
  }
  if (row === undefined) return failures;
  const match = TOKEN.exec(row);
  if (match === null) return [...failures, "row 37e carries no [measured: …] token"];
  const [, interpreter, quoting, planted, caveats] = match;
  if (planted === undefined) {
    failures.push(
      entry?.plantedBinary !== undefined
        ? "row 37e lacks the planted-binary result while the entry carries it"
        : "row 37e lacks the planted-binary result",
    );
  }
  if (entry === undefined) return failures;
  if (interpreter?.trim() !== entry.interpreter) failures.push("interpreter differs");
  if (quoting?.trim() !== entry.quoting) failures.push("quoting differs");
  if (
    planted !== undefined &&
    entry.plantedBinary !== undefined &&
    planted.trim() !== entry.plantedBinary
  ) {
    failures.push("the planted-binary result differs between row and entry");
  }
  if ((caveats ?? "") !== (entry.caveats ?? []).join(",")) failures.push("caveats differ");
  return failures;
}

const row37e = MATRIX.split("\n").find((line) => line.startsWith("| 37e |"));
const entry = MEASURED_SURFACES.find(
  (m) => m.cli === "antigravity" && m.surface === "statusline" && m.os === "win32",
);

describe("row 37e and the Antigravity statusline entry stay in step (R18, R31)", () => {
  test("the committed row and entry agree on presence, interpreter, quoting, result and caveats", () => {
    assert.deepEqual(guardFailures(row37e, entry), []);
  });

  test("row 37e carries exactly one machine-parseable [measured: …] token with the planted-binary result", () => {
    assert.ok(row37e, "row 37e is missing from docs/cli-matrix.md");
    assert.equal((row37e.match(/\[measured:/g) ?? []).length, 1);
    assert.ok(/planted-binary=planted-runs/.test(row37e), "the planted-binary result is missing");
  });

  test("row 37e states the four caveats in prose, beside the token", () => {
    assert.ok(row37e);
    for (const needle of [
      "ARM64",
      "windows-latest",
      "1.2.14",
      "1.2.13",
      "idle start-up screen",
      "node.cmd",
      "NoDefaultCurrentDirectoryInExePath",
    ]) {
      assert.ok(row37e.includes(needle), `row 37e omits ${needle}`);
    }
  });

  test("the entry is conforming to row 37b's Antigravity hooks shape and carries four caveats", () => {
    const hooks = MEASURED_SURFACES.find((m) => m.cli === "antigravity" && m.surface === "hooks");
    assert.ok(entry && hooks);
    assert.equal(entry.status, "conforming");
    assert.equal(entry.interpreter, hooks.interpreter);
    assert.equal(entry.quoting, hooks.quoting);
    assert.equal(entry.caveats?.length, 4);
  });

  test("the parity gap records the refusal with row 37e and #1392 as evidence (R18)", () => {
    const gap = MATRIX.split("\n").find((line) =>
      line.startsWith("- [GAP] Windows checkout paths"),
    );
    assert.ok(
      gap?.includes("#1392") && gap.includes("row 37e") && gap.includes("current directory"),
    );
  });
});

describe("the guard fails on each divergence of R18 and R31", () => {
  const ok =
    "| 37e | x | [measured: interpreter=cmd.exe; quoting=cmd-no-grouping; planted-binary=planted-runs; caveats=arm64-vm,agy-1.2.14,idle-start-screen,node.cmd-only] |";
  const good: MeasuredSurface = {
    cli: "antigravity",
    surface: "statusline",
    os: "win32",
    interpreter: "cmd.exe",
    quoting: "cmd-no-grouping",
    status: "conforming",
    plantedBinary: "planted-runs",
    caveats: ["arm64-vm", "agy-1.2.14", "idle-start-screen", "node.cmd-only"],
  };

  test("agreeing row and entry pass", () => {
    assert.deepEqual(guardFailures(ok, good), []);
  });

  test("row present, entry absent (and the reverse)", () => {
    assert.ok(guardFailures(ok, undefined).some((f) => f.includes("present")));
    assert.ok(guardFailures(undefined, good).some((f) => f.includes("present")));
  });

  test("the planted-binary result differs between row and entry", () => {
    const row = ok.replace("planted-binary=planted-runs", "planted-binary=real-runs");
    assert.ok(guardFailures(row, good).some((f) => f.includes("planted-binary result differs")));
  });

  for (const status of ["conforming", "contradicting"] as const) {
    test(`an entry lacking the result fails whatever its status (${status})`, () => {
      const { plantedBinary: _omitted, ...rest } = good;
      const failures = guardFailures(ok, { ...rest, status });
      assert.ok(
        failures.some((f) => f.includes("entry lacks the planted-binary result")),
        failures.join("; "),
      );
    });
  }

  test("the row lacks the result while the entry carries it", () => {
    const row = ok.replace("; planted-binary=planted-runs", "");
    assert.ok(
      guardFailures(row, good).some((f) =>
        f.includes("row 37e lacks the planted-binary result while the entry carries it"),
      ),
    );
  });

  test("interpreter, quoting and caveats divergences", () => {
    assert.ok(
      guardFailures(ok.replace("cmd.exe", "powershell-5.1"), good).includes("interpreter differs"),
    );
    assert.ok(
      guardFailures(ok.replace("cmd-no-grouping", "cmd"), good).includes("quoting differs"),
    );
    assert.ok(guardFailures(ok.replace(",node.cmd-only", ""), good).includes("caveats differ"));
  });
});
