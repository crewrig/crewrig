// setup-mempalace-version.test.ts — inRange / rangeErrorLines of
// scripts/lib/setup/mempalace-version.ts (spec 0256 deviation (r)): the literal vectors of
// delta-01, further PEP 440 vectors, and a differential against `packaging.version.Version`
// when python3 with `packaging` is available.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { describe, it } from "node:test";

import { inRange, rangeErrorLines } from "../lib/setup/mempalace-version.ts";

const MIN = "3.6.0";
const MAX = "3.7";

function check(vectors: ReadonlyArray<readonly [string | undefined, boolean]>): void {
  for (const [version, expected] of vectors) {
    assert.equal(inRange(version, MIN, MAX), expected, `inRange(${JSON.stringify(version)})`);
  }
}

describe("inRange: the vectors of delta-01 deviation (r)", () => {
  it("orders pre, dev, final, post and local around the lower bound", () => {
    check([
      ["3.6.0rc1", false],
      ["3.6.0.dev0", false],
      ["3.6.0", true],
      ["3.6.0.post1", true],
      ["3.6.0+local", true],
      ["3.6.99", true],
    ]);
  });

  it("orders pre, dev, final and post around the upper bound", () => {
    check([
      ["3.7.0.dev0", true],
      ["3.7.0rc1", true],
      ["3.7.0", false],
      ["3.7.0.post1", false],
    ]);
  });

  it("puts an empty, absent or unparsable version out of range", () => {
    check([
      ["", false],
      [undefined, false],
      ["not-a-version", false],
    ]);
  });
});

describe("inRange: further PEP 440 vectors", () => {
  it("pads the release with zeros", () => {
    check([
      ["3.6", true],
      ["3.6.0.0", true],
      ["3.6.0.0.1", true],
      ["3.5.99.99", false],
      ["3.7.0.0", false],
    ]);
  });

  it("compares the release numerically, not lexically", () => {
    check([
      ["3.10.0", false],
      ["3.9", false],
      ["3.6.10", true],
    ]);
    assert.equal(inRange("3.9", "3.10", "3.11"), false);
    assert.equal(inRange("3.10", "3.9", "3.11"), true);
  });

  it("orders pre-release letters a < b < rc below the final release", () => {
    check([
      ["3.6.0a1", false],
      ["3.6.0b2", false],
      ["3.6.0RC1", false],
      ["3.6.0-rc.1", false],
      ["3.6.0alpha1", false],
      ["3.6.0c1", false],
    ]);
    assert.equal(inRange("3.6.0b1", "3.6.0a9", MAX), true);
    assert.equal(inRange("3.6.0rc1", "3.6.0b9", MAX), true);
    assert.equal(inRange("3.6.0a2", "3.6.0a10", MAX), false);
  });

  it("orders dev below pre below final below post", () => {
    assert.equal(inRange("3.6.0rc1.dev1", "3.6.0b9", MAX), true);
    assert.equal(inRange("3.6.0rc1.dev1", "3.6.0rc1", MAX), false);
    assert.equal(inRange("3.6.0.post1.dev1", "3.6.0", MAX), true);
    assert.equal(inRange("3.6.0.post1.dev1", "3.6.0.post1", MAX), false);
    assert.equal(inRange("3.6.0.dev9", "3.6.0a1", MAX), false);
  });

  it("reads the post-release spellings -N, rev, r and the bare post", () => {
    check([
      ["3.6.0-1", true],
      ["3.6.0rev2", true],
      ["3.6.0r3", true],
      ["3.6.0.post", true],
      ["3.7.0-1", false],
    ]);
  });

  it("accepts a leading v, whitespace and any case", () => {
    check([
      ["v3.6.0", true],
      ["V3.6.0", true],
      [" 3.6.0 ", true],
      ["3.6.0.POST1", true],
      ["3.7.0RC1", true],
    ]);
  });

  it("honours the epoch", () => {
    check([
      ["1!3.6.0", false],
      ["0!3.6.0", true],
    ]);
    assert.equal(inRange("1!1.0", "1!0.5", "1!2"), true);
    assert.equal(inRange("2.0", "1!0.5", "1!2"), false);
  });

  it("sorts a local label above its public version and orders labels", () => {
    assert.equal(inRange("3.6.0+local", "3.6.0", "3.6.1"), true);
    assert.equal(inRange("3.6.0", "3.6.0+local", "3.6.1"), false);
    assert.equal(inRange("3.6.0+abc", "3.6.0+1", "3.6.1"), false);
    assert.equal(inRange("3.6.0+1", "3.6.0+abc", "3.6.1"), true);
    assert.equal(inRange("3.6.0+a.1", "3.6.0+a", "3.6.1"), true);
    assert.equal(inRange("3.6.0+a_1", "3.6.0+A.1", "3.6.1"), true);
  });

  it("rejects strings packaging rejects", () => {
    for (const bad of ["3.", ".3", "3..6", "3.6.0+", "3.6.0+_a", "3.6.x", "3.6.0 rc1", "-1"]) {
      assert.equal(inRange(bad, "0", "100"), false, `inRange(${JSON.stringify(bad)})`);
    }
    assert.equal(inRange("3.6.0", "garbage", MAX), false);
    assert.equal(inRange("3.6.0", MIN, "garbage"), false);
  });

  it("handles segments beyond the safe integer range", () => {
    assert.equal(inRange("3.6.0", "3.6.0", "3.6.99999999999999999999999"), true);
    assert.equal(inRange("3.6.99999999999999999999999", MIN, MAX), true);
  });
});

describe("rangeErrorLines", () => {
  it("prints the two ERROR lines of the shell", () => {
    assert.deepEqual(rangeErrorLines("3.5.1", MIN, MAX), [
      "  ERROR: MemPalace 3.5.1 is outside the supported range >=3.6.0,<3.7.",
      "         Install a supported version with: pipx install --force 'mempalace>=3.6.0,<3.7'",
    ]);
  });

  it("prints (unknown) for an empty or absent version", () => {
    for (const version of ["", undefined]) {
      assert.match(
        rangeErrorLines(version, MIN, MAX)[0] ?? "",
        /^ {2}ERROR: MemPalace \(unknown\) is outside/,
      );
    }
  });
});

// --- differential against packaging.version.Version -------------------------------------------

const PY = `
import json, sys
from packaging.version import Version, InvalidVersion
out = []
for v, lo, hi in json.load(sys.stdin):
    try:
        out.append(Version(lo) <= Version(v) < Version(hi))
    except InvalidVersion:
        out.append(False)
json.dump(out, sys.stdout)
`;

function pythonHasPackaging(): boolean {
  const probe = spawnSync("python3", ["-I", "-c", "import packaging.version"], {
    encoding: "utf8",
  });
  return probe.status === 0;
}

function generate(): string[] {
  const releases = [
    "3.6",
    "3.6.0",
    "3.6.0.0",
    "3.5.9",
    "3.6.1",
    "3.7",
    "3.7.0",
    "3.6.99",
    "3.10.0",
    "3.9",
  ];
  const pres = [
    "",
    "a1",
    "b2",
    "rc1",
    "alpha",
    "beta3",
    "c1",
    "pre2",
    "preview",
    "-rc.1",
    "_a_1",
    "RC1",
  ];
  const posts = ["", ".post1", "-1", "rev2", "r3", ".post"];
  const devs = ["", ".dev0", ".dev3", "-dev"];
  const locals = ["", "+local", "+1", "+abc.5"];
  const all: string[] = [];
  for (const r of releases)
    for (const pre of pres)
      for (const post of posts)
        for (const dev of devs)
          for (const local of locals) all.push(`${r}${pre}${post}${dev}${local}`);
  all.push(
    "1!3.6.0",
    "0!3.6.0",
    "v3.6.0",
    " 3.6.0 ",
    "",
    "not-a-version",
    "3",
    "3.",
    "3.6.0+",
    "3.6.x",
    "3.6.0 rc1",
  );
  return all;
}

describe(
  "inRange: differential against packaging.version.Version",
  { skip: !pythonHasPackaging() },
  () => {
    it("agrees on every generated vector and bound pair", () => {
      const bounds: ReadonlyArray<readonly [string, string]> = [
        [MIN, MAX],
        ["3.6.0rc1", "3.6.1.dev0"],
        ["3.6.0.post1+a", "3.7.0+1"],
      ];
      const triples: Array<[string, string, string]> = [];
      for (const v of generate()) for (const [lo, hi] of bounds) triples.push([v, lo, hi]);
      const run = spawnSync("python3", ["-I", "-c", PY], {
        input: JSON.stringify(triples),
        encoding: "utf8",
        maxBuffer: 64 * 1024 * 1024,
      });
      assert.equal(run.status, 0, run.stderr);
      const expected: unknown = JSON.parse(run.stdout);
      assert.ok(Array.isArray(expected) && expected.length === triples.length);
      const mismatches: string[] = [];
      triples.forEach(([v, lo, hi], index) => {
        if (inRange(v, lo, hi) !== expected[index])
          mismatches.push(`${JSON.stringify(v)} in [${lo}, ${hi})`);
      });
      assert.deepEqual(mismatches.slice(0, 20), []);
    });
  },
);
