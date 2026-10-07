// mempalace-transcript-golden.test.ts — the TypeScript transcript hook against
// the shell hook's recorded behaviour (spec 0247 R8-R16, R30; plan
// verification duty 2).
//
// scripts/tests/fixtures/mempalace-transcript/golden/matrix.json holds, for
// each row of scripts/tests/lib/transcript-golden-rows.ts, what the SHELL hook
// did (`git show a7468111:hooks/mempalace-transcript.sh`, run with bash, jq and
// curl on macOS under en_US.UTF-8): its exit status, both standard streams and
// every request the stub daemon received, with home, temp paths, port, date
// and palace key replaced by placeholders. Replaying a row against
// hooks/mempalace-transcript.ts must give the same record, except on a row
// carrying `deviation: "R30/<clause>"`, where it must give the recorded `ts`
// outcome instead — which itself differs from the shell's. An unlisted
// difference therefore fails, and so does a listed one that disappeared.
//
// This suite needs neither jq nor curl. To regenerate the golden data (only
// when the row matrix changes), see the header of
// scripts/tests/lib/transcript-golden-capture.ts.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, before, describe, test } from "node:test";

import { replayRow, type GoldenRow } from "./lib/transcript-golden.ts";
import { GOLDEN_ROWS } from "./lib/transcript-golden-rows.ts";
import { HOOK_TS, startStub, type Stub, type StubMode } from "./lib/transcript-runtime.ts";
import { cleanupAll, REPO, SKIP_POSIX } from "./lib/worktree-fixtures.ts";

const MATRIX = path.join(
  REPO,
  "scripts",
  "tests",
  "fixtures",
  "mempalace-transcript",
  "golden",
  "matrix.json",
);
const golden = JSON.parse(fs.readFileSync(MATRIX, "utf8")) as { source: string; rows: GoldenRow[] };

/** The clauses of R30 a row may name, each with the requirement that states it. */
const R30_CLAUSES: Readonly<Record<string, string>> = {
  "R30/exit-status": "R6, R11: status 0 where jq ended the shell with status 5",
  "R30/non-scalar-values": "R8: selected values that are not strings or numbers are absent",
  "R30/character-boundaries": "R12: byte cuts on character boundaries",
  "R30/token-key": "R14: the key over MEMPALACE_PALACE_PATH, not MEMPALACE_PATH",
  "R30/empty-token": "R14: an empty token refused instead of sent",
  "R30/response-classes": "R15: a non-2xx or non-JSON response is a failure",
  "R30/unreachable-reason": "R15: the reason in place of curl's exit code and stderr",
  "R30/trust-file": "R16: a malformed trust file reported instead of executed",
  "R30/cli-identifiers": "R3: CLI identifiers select the direct form",
  "R30/stop-summary-objects": "R11: objects selected for the Stop summary skipped",
};

describe("the golden record is well formed", () => {
  test("it was captured from the pre-migration shell hook, one record per row of the matrix", () => {
    assert.equal(golden.source, "a7468111:hooks/mempalace-transcript.sh");
    assert.deepEqual(
      golden.rows.map((row) => row.id),
      GOLDEN_ROWS.map((row) => row.id),
      "matrix.json is stale: re-run transcript-golden-capture.ts",
    );
    for (const row of golden.rows) {
      const { expect: _expect, ts: _ts, ...input } = row;
      assert.deepEqual(
        input,
        GOLDEN_ROWS.find((r) => r.id === row.id),
        `${row.id}: inputs changed since capture`,
      );
    }
  });

  test("every deviation names a clause of R30 and records a different outcome", () => {
    for (const row of golden.rows.filter((r) => r.deviation !== undefined)) {
      assert.ok(R30_CLAUSES[row.deviation!] !== undefined, `${row.id}: ${row.deviation}`);
      assert.ok(row.ts !== undefined, `${row.id}: no TypeScript outcome`);
      assert.notDeepEqual(row.ts, row.expect, `${row.id}: the deviation does not differ`);
    }
    for (const row of golden.rows.filter((r) => r.deviation === undefined)) {
      assert.equal(row.ts, undefined, row.id);
    }
  });

  test("the matrix covers every wired event, every stub mode and every token rule", () => {
    const stdin = golden.rows.map((row) => `${row.args.join(" ")} ${row.stdin}`).join("\n");
    for (const event of [
      "PreToolUse",
      "UserPromptSubmit",
      "PostToolUse",
      "Stop",
      "SessionEnd",
      "SessionStart",
      "BeforeAgent",
      "BeforeTool",
      "AfterTool",
      "AfterModel",
      "PreInvocation",
    ]) {
      assert.ok(stdin.includes(event), event);
    }
    const modes = new Set(golden.rows.map((row) => row.mode));
    for (const mode of ["ok", "rpc-error", "is-error", "http-500-html", "hang", "closed"])
      assert.ok(modes.has(mode as StubMode), mode);
    const ids = golden.rows.map((row) => row.id);
    for (const id of [
      "token-named",
      "token-mock",
      "token-computed",
      "token-wildcard",
      "token-none",
      "token-empty",
    ]) {
      assert.ok(ids.includes(id), id);
    }
  });
});

// The record comes from a POSIX host (Git top-level paths, a closed port's
// error code); the windows-latest job asserts the hook there instead.
describe("the TypeScript hook replays the golden record", { skip: SKIP_POSIX }, () => {
  const stubs = new Map<StubMode, Stub>();
  before(async () => {
    for (const mode of ["ok", "rpc-error", "is-error", "http-500-html", "hang"] as const) {
      stubs.set(mode, await startStub(mode));
    }
  });
  after(async () => {
    for (const stub of stubs.values()) await stub.stop();
    cleanupAll();
  });

  for (const row of golden.rows) {
    const label = row.deviation === undefined ? row.id : `${row.id} (${row.deviation})`;
    test(label, async () => {
      const actual = await replayRow(row, { program: process.execPath, prefix: [HOOK_TS] }, stubs);
      assert.deepEqual(actual, row.deviation === undefined ? row.expect : row.ts);
    });
  }
});
