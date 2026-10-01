// hook-command-matrix.test.ts — the guard of spec 0243 R18, R31 and R33: each
// Windows Antigravity CLI row of docs/cli-matrix.md and its MEASURED_SURFACES
// entry stay in step. Row 37e pairs with the `statusline` entry and row 37f
// with the `hooks` entry; one parser and one guard function serve both pairs.
//
// Each row carries exactly one machine-parseable token
// `[measured: key=value; key=value; …]` with the keys of TOKEN_KEYS. The guard
// fails when the presence of a row and of its entry disagree, when the entry
// lacks the bare planted-binary result (states (a2)-(a4) of R32 are malformed),
// or when interpreter, quoting, the bare result, its caveats, the guarded-form
// result or its caveats differ between row and entry, or are carried by one
// side only. hook-command.ts never reads the matrix at run time; this test does.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";

import { MEASURED_SURFACES, type MeasuredSurface } from "../lib/hook-command.ts";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const MATRIX = fs.readFileSync(path.join(REPO, "docs", "cli-matrix.md"), "utf8");

/** The guarded-form fields of spec 0243 delta-03 R31, read loosely so the guard
 * reports a missing field as a divergence rather than failing to load. */
type GuardedEntry = MeasuredSurface & {
  readonly guardedForm?: readonly { readonly plant: string; readonly ran: string }[];
  readonly guardedCaveats?: readonly string[];
};

const TOKEN_KEYS = [
  "interpreter",
  "quoting",
  "planted-binary",
  "caveats",
  "guarded-form",
  "guarded-caveats",
] as const;
type TokenKey = (typeof TOKEN_KEYS)[number];

type Parsed =
  | { ok: true; values: Partial<Record<TokenKey, string>> }
  | { ok: false; error: string };

/** Parse the single `[measured: k=v; …]` token of a row. */
function parseMeasured(row: string): Parsed {
  const tokens = [...row.matchAll(/\[measured: ([^\]]*)\]/g)];
  if (tokens.length !== 1) return { ok: false, error: `${tokens.length} [measured: …] tokens` };
  const values: Partial<Record<TokenKey, string>> = {};
  for (const pair of (tokens[0]?.[1] ?? "").split("; ")) {
    const eq = pair.indexOf("=");
    const key = pair.slice(0, eq);
    const value = pair.slice(eq + 1);
    if (eq <= 0 || value === "" || /\s/.test(value)) {
      return { ok: false, error: `malformed pair ${JSON.stringify(pair)}` };
    }
    if (!(TOKEN_KEYS as readonly string[]).includes(key)) {
      return { ok: false, error: `unknown key ${JSON.stringify(key)}` };
    }
    if (key in values) return { ok: false, error: `duplicate key ${JSON.stringify(key)}` };
    values[key as TokenKey] = value;
  }
  return { ok: true, values };
}

/** The token serialisation of an entry's guarded-form result: `node.cmd:real,…`. */
const serialiseGuarded = (form: GuardedEntry["guardedForm"]): string | undefined =>
  form?.map((c) => `${c.plant}:${c.ran}`).join(",");

/** Compare one optional field carried by the row and by the entry. */
function compare(
  failures: string[],
  rowId: string,
  label: string,
  inRow: string | undefined,
  inEntry: string | undefined,
): void {
  if (inRow === undefined && inEntry === undefined) return;
  if (inRow === undefined)
    failures.push(`row ${rowId} lacks the ${label} while the entry carries it`);
  else if (inEntry === undefined)
    failures.push(`the entry lacks the ${label} while row ${rowId} carries it`);
  else if (inRow !== inEntry)
    failures.push(`the ${label} differs between row ${rowId} and the entry`);
}

/** What the guard concludes about one (row, entry) pair; empty when they agree. */
function guardFailures(
  rowId: string,
  row: string | undefined,
  entry: GuardedEntry | undefined,
): string[] {
  const failures: string[] = [];
  if ((row !== undefined) !== (entry !== undefined)) {
    failures.push(
      `row ${rowId} present: ${row !== undefined}; entry present: ${entry !== undefined}`,
    );
  }
  if (entry !== undefined && entry.plantedBinary === undefined) {
    failures.push("the entry lacks the planted-binary result (whatever its status)");
  }
  if (entry?.guardedForm !== undefined && entry.guardedForm.length === 0) {
    failures.push("the entry's guarded-form result is empty (malformed, read as hijacked)");
  }
  if (entry?.guardedForm !== undefined && entry.guardedCaveats === undefined) {
    failures.push("the entry carries a guarded-form result without its caveats");
  }
  if (row === undefined) return failures;
  const parsed = parseMeasured(row);
  if (!parsed.ok) return [...failures, `row ${rowId}: ${parsed.error}`];
  const v = parsed.values;
  if (v["planted-binary"] === undefined) {
    failures.push(
      entry?.plantedBinary !== undefined
        ? `row ${rowId} lacks the planted-binary result while the entry carries it`
        : `row ${rowId} lacks the planted-binary result`,
    );
  }
  if (v["guarded-form"] !== undefined && v["guarded-caveats"] === undefined) {
    failures.push(`row ${rowId} carries a guarded-form result without its caveats`);
  }
  if (entry === undefined) return failures;
  if (v.interpreter !== entry.interpreter) failures.push("interpreter differs");
  if (v.quoting !== entry.quoting) failures.push("quoting differs");
  if (v["planted-binary"] !== undefined && entry.plantedBinary !== undefined) {
    compare(failures, rowId, "planted-binary result", v["planted-binary"], entry.plantedBinary);
  }
  if ((v.caveats ?? "") !== (entry.caveats ?? []).join(",")) failures.push("caveats differ");
  compare(
    failures,
    rowId,
    "guarded-form result",
    v["guarded-form"],
    serialiseGuarded(entry.guardedForm),
  );
  compare(
    failures,
    rowId,
    "guarded-form caveats",
    v["guarded-caveats"],
    entry.guardedCaveats?.join(","),
  );
  return failures;
}

const LINES = MATRIX.split("\n");
const rowOf = (id: string): string | undefined => LINES.find((l) => l.startsWith(`| ${id} |`));
const entryOf = (surface: "statusline" | "hooks"): GuardedEntry | undefined =>
  MEASURED_SURFACES.find(
    (m) => m.cli === "antigravity" && m.surface === surface && m.os === "win32",
  );

const PAIRS = [
  { rowId: "37e", surface: "statusline" },
  { rowId: "37f", surface: "hooks" },
] as const;

/** The real `node` ran on every planted candidate (R32 "holding"). */
const HOLDING = "node.cmd:real,node.bat:real,node.exe:real";

describe("rows 37e and 37f stay in step with their Antigravity CLI entries (R18, R31, R33)", () => {
  for (const { rowId, surface } of PAIRS) {
    test(`row ${rowId} and the ${surface} entry agree on every recorded field`, () => {
      assert.deepEqual(guardFailures(rowId, rowOf(rowId), entryOf(surface)), []);
    });

    test(`row ${rowId} records the bare result and a holding guarded-form result`, () => {
      const row = rowOf(rowId);
      assert.ok(row, `row ${rowId} is missing from docs/cli-matrix.md`);
      const parsed = parseMeasured(row);
      assert.ok(parsed.ok, parsed.ok ? "" : parsed.error);
      assert.equal(parsed.values["planted-binary"], "planted-runs");
      assert.equal(parsed.values["guarded-form"], HOLDING);
    });
  }

  test("both entries are conforming to row 37b's Antigravity shape", () => {
    const statusline = entryOf("statusline");
    const hooks = entryOf("hooks");
    assert.ok(statusline && hooks);
    for (const e of [statusline, hooks]) {
      assert.equal(e.status, "conforming");
      assert.equal(e.interpreter, "cmd.exe");
      assert.equal(e.quoting, "cmd-no-grouping");
    }
  });

  test("the statusline entry keeps its four bare caveats and carries the six guarded-form caveats (R31)", () => {
    const e = entryOf("statusline");
    assert.deepEqual(e?.caveats, ["arm64-vm", "agy-1.2.14", "idle-start-screen", "node.cmd-only"]);
    assert.deepEqual(e?.guardedCaveats, [
      "arm64-vm",
      "agy-1.2.14",
      "idle-start-screen",
      "one-plant-cwd-only",
      "marker-probe",
      "node.exe-control-two-draws",
    ]);
  });

  test("the hooks caveats are R31's with exactly R33's exceptions (verdict S5)", () => {
    const status = entryOf("statusline")?.guardedCaveats ?? [];
    const hooks = entryOf("hooks");
    // R33: fired by `Stop` from `agy --print`, not on the idle start-up screen;
    // the two-draw `node.exe` control is a status-line observation only.
    const expected = status
      .filter((c) => c !== "node.exe-control-two-draws")
      .map((c) => (c === "idle-start-screen" ? "stop-print-console" : c));
    assert.deepEqual(hooks?.guardedCaveats, expected);
    assert.deepEqual(hooks?.caveats, expected);
  });
});

describe("rows 37e and 37f state their caveats in prose (R31, R33, R35, R36)", () => {
  const needles: Record<string, string[]> = {
    "37e": [
      "ARM64",
      "windows-latest",
      "1.2.14",
      "1.2.13",
      "idle start-up screen",
      "node.cmd",
      "node.bat",
      "node.exe",
      "NoDefaultCurrentDirectoryInExePath",
      "%CMDCMDLINE%",
      "wmic",
      "5934346722",
    ],
    "37f": [
      "ARM64",
      "windows-latest",
      "1.2.14",
      "~\\.gemini\\config",
      "agy --print",
      "Stop",
      "node.cmd",
      "node.bat",
      "node.exe",
      "NoDefaultCurrentDirectoryInExePath",
      "5934346722",
      // Verdict S5: the row names R33's exceptions so the shorter list is not read as drift.
      "R33",
      "two-draw",
    ],
  };
  for (const [rowId, list] of Object.entries(needles)) {
    test(`row ${rowId} names every caveat beside its token`, () => {
      const row = rowOf(rowId);
      assert.ok(row, `row ${rowId} is missing`);
      const missing = list.filter((n) => !row.includes(n));
      assert.deepEqual(missing, [], `row ${rowId} omits ${missing.join(", ")}`);
    });
  }

  test("row 37e no longer describes the delta-02 refusal", () => {
    const row = rowOf("37e") ?? "";
    assert.ok(!row.includes("refuses the command line pending #1392"), "stale refusal text");
    assert.ok(
      !row.includes("cwd-first"),
      "stale `cwd-first` flag: no such flag exists in hook-command.ts",
    );
  });

  test("the parity gap names both surfaces, rows 37e/37f, #1392 and the PATH residual (R17, R36)", () => {
    const gap = LINES.find((l) => l.startsWith("- [GAP] Windows checkout paths"));
    assert.ok(gap, "the [GAP] Windows checkout paths entry is missing");
    const missing = ["row 37e", "row 37f", "#1392", "statusLine.command", "hooks", "PATH"].filter(
      (n) => !gap.includes(n),
    );
    assert.deepEqual(missing, [], `the GAP entry omits ${missing.join(", ")}`);
  });
});

describe("the parser and the guard fail on each divergence (the guard is itself tested)", () => {
  const ok =
    "| 37f | x | [measured: interpreter=cmd.exe; quoting=cmd-no-grouping; planted-binary=planted-runs; caveats=arm64-vm,agy-1.2.14; guarded-form=node.cmd:real,node.bat:real; guarded-caveats=arm64-vm,marker-probe] |";
  const good: GuardedEntry = {
    cli: "antigravity",
    surface: "hooks",
    os: "win32",
    interpreter: "cmd.exe",
    quoting: "cmd-no-grouping",
    status: "conforming",
    plantedBinary: "planted-runs",
    caveats: ["arm64-vm", "agy-1.2.14"],
    guardedForm: [
      { plant: "node.cmd", ran: "real" },
      { plant: "node.bat", ran: "real" },
    ],
    guardedCaveats: ["arm64-vm", "marker-probe"],
  };
  const has = (failures: string[], needle: string): boolean =>
    failures.some((f) => f.includes(needle));
  const without = (key: "plantedBinary" | "guardedForm" | "guardedCaveats"): GuardedEntry => {
    const { [key]: _omitted, ...rest } = good;
    return rest as GuardedEntry;
  };

  test("agreeing row and entry pass", () => {
    assert.deepEqual(guardFailures("37f", ok, good), []);
  });

  test("the parser rejects an unknown key, a duplicate key, an empty value and two tokens", () => {
    for (const [row, error] of [
      [ok.replace("caveats=arm64-vm,agy", "cavats=arm64-vm,agy"), "unknown key"],
      [ok.replace("; caveats=", "; quoting=x; caveats="), "duplicate key"],
      [ok.replace("guarded-form=node.cmd:real,node.bat:real", "guarded-form="), "malformed pair"],
      [`${ok} [measured: interpreter=cmd.exe]`, "2 [measured"],
      ["| 37f | no token |", "0 [measured"],
    ] as const) {
      assert.ok(has(guardFailures("37f", row, good), error), `${error}: ${row}`);
    }
  });

  test("row present, entry absent (and the reverse)", () => {
    assert.ok(has(guardFailures("37f", ok, undefined), "present"));
    assert.ok(has(guardFailures("37f", undefined, good), "present"));
  });

  for (const status of ["conforming", "contradicting"] as const) {
    test(`an entry lacking the bare result fails whatever its status (${status}; R32 (a2)-(a4))`, () => {
      const failures = guardFailures("37f", ok, { ...without("plantedBinary"), status });
      assert.ok(has(failures, "entry lacks the planted-binary result"), failures.join("; "));
    });
  }

  test("the bare result differs, or the row lacks it while the entry carries it", () => {
    const differs = ok.replace("planted-binary=planted-runs", "planted-binary=real-runs");
    assert.ok(has(guardFailures("37f", differs, good), "planted-binary result differs"));
    const lacks = ok.replace("; planted-binary=planted-runs", "");
    assert.ok(
      has(guardFailures("37f", lacks, good), "row 37f lacks the planted-binary result while"),
    );
  });

  test("interpreter, quoting and bare caveats divergences", () => {
    assert.ok(
      guardFailures("37f", ok.replace("cmd.exe", "powershell-5.1"), good).includes(
        "interpreter differs",
      ),
    );
    assert.ok(
      guardFailures("37f", ok.replace("cmd-no-grouping", "cmd"), good).includes("quoting differs"),
    );
    assert.ok(
      guardFailures("37f", ok.replace("arm64-vm,agy-1.2.14", "arm64-vm"), good).includes(
        "caveats differ",
      ),
    );
  });

  test("the guarded-form result is carried by one side only", () => {
    const rowLacks = ok.replace("; guarded-form=node.cmd:real,node.bat:real", "");
    assert.ok(has(guardFailures("37f", rowLacks, good), "row 37f lacks the guarded-form result"));
    const entryLacks = without("guardedForm");
    assert.ok(has(guardFailures("37f", ok, entryLacks), "entry lacks the guarded-form result"));
  });

  test("the guarded-form result differs: a single hijacked candidate is a divergence", () => {
    const hijacked = ok.replace("node.bat:real", "node.bat:planted");
    assert.ok(has(guardFailures("37f", hijacked, good), "guarded-form result differs"));
    const fewer = ok.replace(",node.bat:real", "");
    assert.ok(has(guardFailures("37f", fewer, good), "guarded-form result differs"));
  });

  test("an empty guarded-form result in the entry is malformed (S3, fail closed)", () => {
    assert.ok(has(guardFailures("37f", ok, { ...good, guardedForm: [] }), "empty"));
  });

  test("the guarded-form caveats differ, or a guarded result comes without its caveats", () => {
    const differs = ok.replace("guarded-caveats=arm64-vm,marker-probe", "guarded-caveats=arm64-vm");
    assert.ok(has(guardFailures("37f", differs, good), "guarded-form caveats differs"));
    const rowNoCaveats = ok.replace("; guarded-caveats=arm64-vm,marker-probe", "");
    assert.ok(has(guardFailures("37f", rowNoCaveats, good), "without its caveats"));
    assert.ok(has(guardFailures("37f", ok, without("guardedCaveats")), "without its caveats"));
  });
});
