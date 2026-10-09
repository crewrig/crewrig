// history-import-prune-python.test.ts — the offline end-to-end test of scripts/prune-transcripts.ts
// (spec 0253 R27, R16-R18; ticket #1331), run by the `windows-history-import` CI job on
// `windows-latest` and on Linux and macOS. The Python body of the prune really runs, under the
// runner's REAL Python, against the FAKE `mempalace.mcp_server` of tests/lib/fake-mempalace.ts.
// No bash, no shell, no `.cmd`. Timings are printed, never asserted.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, before, describe, test } from "node:test";

import { Harness } from "./lib/history-import-harness.ts";
import type { Run } from "./lib/history-import-harness.ts";

const h = new Harness();
before(() => h.setup());
after(() => h.teardown());

const pad = (n: number): string => String(n).padStart(2, "0");
/** The local calendar date `n` days before today, as YYYY-MM-DD. */
function daysAgo(n: number): string {
  const t = new Date();
  const d = new Date(t.getFullYear(), t.getMonth(), t.getDate() - n);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
const room = (project: string, age: number, sid: string): string =>
  `${project}-${daysAgo(age)}-${sid}`;

describe("prune-transcripts.ts", () => {
  const OLD1 = room("alpha", 60, "aaaaaaa1");
  const OLD2 = room("alpha", 45, "aaaaaaa2");
  const RECENT = room("alpha", 5, "aaaaaaa3");
  const drawers = (items: readonly [string, string][]): string => {
    const file = path.join(h.fresh(), "drawers.json");
    fs.writeFileSync(file, JSON.stringify(items.map(([drawer_id, r]) => ({ drawer_id, room: r }))));
    return file;
  };
  const base = (): string =>
    drawers([
      ["d1", OLD1],
      ["d2", OLD2],
      ["d3", RECENT],
      ["d4", "not-a-transcript-room"],
    ]);
  const prune = (name: string, args: string[], e: NodeJS.ProcessEnv): Run =>
    h.run(`prune ${name}`, "prune-transcripts.ts", args, e);
  const withPython = (file: string): NodeJS.ProcessEnv =>
    h.env({ MEMPALACE_PYTHON: h.python }, 0, file);

  test("a dry run lists exactly the two old rooms and deletes nothing", () => {
    const r = prune("dry-run", ["--days", "30"], withPython(base()));
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.ok(r.out.includes("Eligible for deletion: 2"));
    const at = r.out.indexOf("DRY RUN - would delete:");
    assert.ok(at >= 0, "dry-run listing present");
    const listed = r.out.slice(at + 1).filter((l) => l.startsWith("  - "));
    assert.equal(listed.length, 2);
    assert.ok(listed[0]?.startsWith(`  - ${OLD1} `));
    assert.ok(listed[1]?.startsWith(`  - ${OLD2} `));
    assert.deepEqual(h.deletedIds(), []);
  });

  test("--apply deletes the two old drawers", () => {
    const r = prune("apply", ["--days", "30", "--apply"], withPython(base()));
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.ok(r.out.includes("Deleted: 2 drawer(s)"));
    assert.deepEqual(h.deletedIds(), ["d1", "d2"]);
  });

  test("--project restricts the prune to one project", () => {
    const file = drawers([
      ["a1", OLD1],
      ["b1", room("beta", 50, "bbbbbbb1")],
    ]);
    const r = prune("project", ["--project", "beta", "--apply"], withPython(file));
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.ok(r.out.includes("Deleted: 1 drawer(s)"));
    assert.deepEqual(h.deletedIds(), ["b1"]);
  });

  test("a missing interpreter is reported with the pipx install line", () => {
    const e = h.envNoPython();
    const r = prune("no-python", [], e);
    assert.equal(r.status, 1);
    assert.equal(
      r.err[0],
      `Error: ${process.platform === "win32" ? "python" : "python3"} not found`,
    );
    assert.match(r.err[1] ?? "", /^Install MemPalace via pipx: pipx install 'mempalace.*'$/);
  });

  test("--help prints the usage and the prerequisite, exit 0", () => {
    const r = prune("help", ["--help"], h.env());
    assert.equal(r.status, 0);
    assert.match(r.out[0] ?? "", /^Usage: .*scripts[\\/]prune-transcripts\.ts /);
    assert.ok(r.out.includes("Prerequisites:"));
  });

  for (const [value, message] of [
    ["0", "Error: --days must be at least 1"],
    ["x", "Error: --days must be a positive integer"],
  ] as const) {
    test(`--days ${value} is refused`, () => {
      const r = prune(`days-${value}`, ["--days", value], h.env());
      assert.equal(r.status, 1);
      assert.deepEqual(r.err, [message]);
    });
  }

  test("an unknown option names the entry in the hint", () => {
    const r = prune("bogus", ["--bogus"], h.env());
    assert.equal(r.status, 1);
    assert.equal(r.err[0], "Unknown option: --bogus");
    assert.match(r.err[1] ?? "", /^Run '.*prune-transcripts\.ts --help' for usage\.$/);
  });
});
