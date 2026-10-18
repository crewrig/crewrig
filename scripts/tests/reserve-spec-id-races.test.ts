// reserve-spec-id-races.test.ts — atomicity of scripts/reserve-spec-id.ts: Cases 7-10 and the
// same-issue race of Case 32. Cases 8 and 32 use a runtime-generated sleeping `pre-receive` hook
// (no tracked `.sh` fixture) so both clients read the ref absent before either push lands.
// POSIX-only: runtime `#!/bin/sh` hook and `sleep`; Windows coverage of the tool is
// windows-model-ci-tooling-spec-id.test.ts. Replaces scripts/tests/test-reserve-spec-id.sh (races).

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { after, describe, it } from "node:test";

import {
  EMPTY_TREE,
  gw,
  installSleepingHook,
  makeReservation,
  makeRoot,
  newFixture,
  POSIX_ONLY,
  remoteCount,
  removeHook,
  removeRoot,
  reservationMessage,
  runTool,
  runToolAsync,
} from "./lib/reserve-spec-id-fixture.ts";

const root = makeRoot();
after(() => removeRoot(root));

const hasSh = spawnSync("sh", ["-c", "exit 0"]).status === 0;
const skip = POSIX_ONLY || (hasSh ? false : "no sh on PATH");
const SPEC1 = ["specs/0001-a.md"];

describe("reserve-spec-id races", { skip }, () => {
  it("Case 7 — two concurrent sessions obtain distinct ids", async () => {
    const fx = newFixture(root, "c7", SPEC1);
    const [a, b] = await Promise.all([
      runToolAsync(fx, ["--issue", "910"]),
      runToolAsync(fx, ["--issue", "911"]),
    ]);
    assert.equal(a.status, 0, a.stderr);
    assert.equal(b.status, 0, b.stderr);
    assert.notEqual(a.stdout.trim(), b.stdout.trim());
    assert.equal(remoteCount(fx, "refs/spec-ids/*"), 2);
  });

  it("Case 8 — a true race on one identifier leaves exactly one winner", async () => {
    const fx = newFixture(root, "c8", SPEC1);
    installSleepingHook(fx, 2);
    try {
      const rs = await Promise.all([
        runToolAsync(fx, ["--id", "0500", "--issue", "920"]),
        runToolAsync(fx, ["--id", "0500", "--issue", "921"]),
      ]);
      assert.equal(rs.filter((r) => r.status === 0).length, 1);
      assert.equal(remoteCount(fx, "refs/spec-ids/*"), 1);
      assert.ok(
        ["reserve 0500 for issue #920", "reserve 0500 for issue #921"].includes(
          reservationMessage(fx, "refs/spec-ids/0500"),
        ),
      );
    } finally {
      removeHook(fx);
    }
  });

  it("Case 9 — an identifier held by another ticket is refused, incumbent untouched", () => {
    const fx = newFixture(root, "c9", SPEC1);
    makeReservation(fx, "refs/spec-ids/0600", "0600", 930);
    const r = runTool(fx, ["--id", "0600", "--issue", "931"]);
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /#930/);
    assert.equal(reservationMessage(fx, "refs/spec-ids/0600"), "reserve 0600 for issue #930");
  });

  it("Case 10 — the reservation object is parentless; a descendant at an occupied ref is accepted", () => {
    const fx = newFixture(root, "c10", SPEC1);
    assert.equal(runTool(fx, ["--issue", "940"]).status, 0);
    gw(fx, ["fetch", "-q", "crewrig", "refs/spec-ids/*:refs/observed/*"]);
    const held = gw(fx, ["rev-parse", "refs/observed/0002"]).trim();
    const descendant = gw(fx, [
      "commit-tree",
      "-p",
      held,
      "-m",
      "reserve 0002 for issue #666",
      EMPTY_TREE,
    ]).trim();
    // Premise: a fast-forward push at an occupied ref is accepted (fails loudly if git changes).
    gw(fx, ["push", "-q", "crewrig", `${held}:refs/scratch/0002`]);
    gw(fx, ["push", "-q", "crewrig", `${descendant}:refs/scratch/0002`]);
    const parents = gw(fx, ["cat-file", "-p", held])
      .split("\n")
      .filter((l) => l.startsWith("parent"));
    assert.equal(parents.length, 0);
  });

  it("Case 32 — a same-issue race converges on one reservation", async () => {
    const fx = newFixture(root, "c32", SPEC1);
    installSleepingHook(fx, 2);
    try {
      const [a, b] = await Promise.all([
        runToolAsync(fx, ["--issue", "980"]),
        runToolAsync(fx, ["--issue", "980"]),
      ]);
      assert.equal(`${a.status}${b.status}`, "00", a.stderr + b.stderr);
      const id = a.stdout.trim();
      assert.equal(id, b.stdout.trim());
      assert.equal(remoteCount(fx, "refs/spec-ids/*"), 1);
      assert.equal(reservationMessage(fx, `refs/spec-ids/${id}`), `reserve ${id} for issue #980`);
    } finally {
      removeHook(fx);
    }
  });
});
