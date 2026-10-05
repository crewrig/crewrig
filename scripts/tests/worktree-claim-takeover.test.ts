// worktree-claim-takeover.test.ts — `takeover` and its arithmetic (spec 0248
// R20; scenario 15).
//
// The seven values of scenario 15 and their neighbours are replayed against the
// shell tool's record in worktree-claim-golden.test.ts. This suite states the
// rules those rows follow, over a claim planted with a chosen `since_epoch`, so
// a regression names the rule it broke: what reads as infinitely old, what
// reads as zero age, and how `--stale-after` is validated before any arithmetic.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, describe, test } from "node:test";

import {
  cleanupAll,
  makeFixture,
  nowEpoch,
  read,
  runClaim,
  writeClaim,
  type Result,
} from "./lib/worktree-fixtures.ts";

after(cleanupAll);

/** Plant alice's claim with this `since_epoch` text and run `takeover --agent bob <extra>`. */
function takeoverOver(sinceEpoch: string, extra: string[] = []): Result & { holder: string } {
  const fx = makeFixture();
  writeClaim(fx, { holder: "alice", sinceEpoch });
  const res = runClaim(["takeover", "--agent", "bob", ...extra], { cwd: fx.wt });
  return { ...res, holder: read(path.join(fx.claimDir, "holder")).trim() };
}

describe("a since_epoch that cannot be evaluated safely is infinitely old (R20)", () => {
  for (const [name, value] of [
    ["empty", ""],
    ["not digits", "yesterday"],
    ["a leading zero", "0900"],
    ["zero", "0"],
    ["19 digits", "1000000000000000000"],
    ["a negative sign", "-5"],
    ["a decimal point", "1.5"],
    ["padded with a space", " 1700000000"],
  ] as const) {
    test(`${name}: takeable at the default threshold`, () => {
      const res = takeoverOver(value);
      assert.equal(res.status, 0, res.stdout + res.stderr);
      assert.equal(res.holder, "bob");
    });
  }

  test("18 digits is evaluated, and in the far future it is corrupt: takeable", () => {
    assert.equal(takeoverOver("999999999999999999").status, 0);
  });

  test("a missing since_epoch file is the same state", () => {
    const fx = makeFixture();
    writeClaim(fx, { holder: "alice" });
    fs.rmSync(path.join(fx.claimDir, "since_epoch"));
    assert.equal(runClaim(["takeover", "--agent", "bob"], { cwd: fx.wt }).status, 0);
  });
});

describe("the future (R20)", () => {
  test("more than 300 seconds ahead is corrupt: takeable", () => {
    assert.equal(takeoverOver(String(nowEpoch() + 400)).status, 0);
  });

  test("up to 300 seconds ahead is skew: zero age, not stale, refused with held-for-seconds 0", () => {
    const res = takeoverOver(String(nowEpoch() + 100));
    assert.equal(res.status, 4);
    assert.match(res.stdout, /^held-for-seconds: 0$/m);
    assert.match(res.stdout, /^stale-after-seconds: 1800$/m);
    assert.equal(res.holder, "alice", "a refusal changes nothing");
  });
});

describe("--stale-after is validated as digits, before any arithmetic (R20)", () => {
  const aged = (seconds: number) => String(nowEpoch() - seconds);

  test("08 is eight minutes, not an octal error", () => {
    assert.equal(takeoverOver(aged(540), ["--stale-after", "08"]).status, 0);
    const refused = takeoverOver(aged(420), ["--stale-after", "08"]);
    assert.equal(refused.status, 4);
    assert.match(refused.stdout, /^stale-after-seconds: 480$/m);
  });

  test("leading zeros are stripped first: ten and nineteen characters accepted when at most 9 digits remain", () => {
    assert.equal(takeoverOver(aged(90), ["--stale-after", "0000000001"]).status, 0);
    const wide = takeoverOver(aged(30), ["--stale-after", "0000000000000000009"]);
    assert.equal(wide.status, 4);
    assert.match(wide.stdout, /^stale-after-seconds: 540$/m);
    assert.equal(
      takeoverOver(aged(30), ["--stale-after", "0000000000"]).status,
      0,
      "all zeros is 0",
    );
  });

  test("ten significant digits is refused with exit 1 before any arithmetic, nothing changed", () => {
    const res = takeoverOver(aged(30), ["--stale-after", "1234567890"]);
    assert.equal(res.status, 1);
    assert.match(res.stderr, /^Error: --stale-after '1234567890' is out of range/);
    assert.equal(res.holder, "alice");
  });

  test("nine digits is accepted and means never stale", () => {
    const res = takeoverOver(aged(3600), ["--stale-after", "999999999"]);
    assert.equal(res.status, 4);
    assert.match(res.stdout, /^stale-after-seconds: 59999999940$/m, "60 x 999999999, exact");
  });

  for (const value of ["abc", "-1", "", "1.5", "1e3", "٣", "0x10", " 5"]) {
    test(`${JSON.stringify(value)} is not a number of minutes`, () => {
      const res = takeoverOver(aged(9999), ["--stale-after", value]);
      assert.equal(res.status, 1);
      assert.match(
        res.stderr,
        /^Error: --stale-after must be a non-negative integer number of minutes/,
      );
    });
  }
});

describe("the transfer", () => {
  test("holder, since and since_epoch are rewritten; the ledger records the displaced agent", () => {
    const fx = makeFixture();
    writeClaim(fx, { holder: "alice", since: "2020-01-01T00:00:00Z", sinceEpoch: "1577836800" });
    const res = runClaim(["takeover", "--agent", "bob", "--stale-after", "7"], { cwd: fx.wt });
    assert.equal(res.status, 0, res.stderr);
    assert.match(
      res.stdout,
      /^Took over '736' from 'alice' \(held since 2020-01-01T00:00:00Z\)\.$/m,
    );
    assert.equal(read(path.join(fx.claimDir, "holder")), "bob\n");
    assert.notEqual(read(path.join(fx.claimDir, "since")), "2020-01-01T00:00:00Z\n");
    assert.ok(Number(read(path.join(fx.claimDir, "since_epoch"))) > 1_700_000_000);
    assert.match(
      read(fx.ledger),
      /\ttakeover\tbob\t736\tdisplaced=alice displaced-since=2020-01-01T00:00:00Z stale-after-minutes=7\n$/,
    );
    assert.match(res.stdout, /This transfers the CLAIM and nothing else\./);
  });

  test("the null cases: unclaimed exits 4, the holder itself exits 0", () => {
    const fx = makeFixture();
    const none = runClaim(["takeover", "--agent", "bob"], { cwd: fx.wt });
    assert.equal(none.status, 4);
    assert.match(none.stdout, /^Refused: '736' is not claimed, so there is nothing to take over\./);
    assert.equal(fs.existsSync(fx.claimDir), false);
    writeClaim(fx, { holder: "alice" });
    const own = runClaim(["takeover", "--agent", "alice"], { cwd: fx.wt });
    assert.equal(own.status, 0);
    assert.match(own.stdout, /^Already held by 'alice'; nothing to take over\./);
  });
});
