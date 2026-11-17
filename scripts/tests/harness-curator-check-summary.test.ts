// curate.ts --check and --summary over the eval fixtures, in the `--from-stdin` test mode. Needs python3.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";

import { envelope, run, skillDir } from "./lib/skill-scripts-governance-cli.ts";

const python = ["/usr/bin/python3", "/usr/local/bin/python3", "/opt/homebrew/bin/python3"].find(
  (p) => fs.existsSync(p),
);
const skip =
  process.platform === "win32"
    ? "POSIX only"
    : python === undefined
      ? "python3 not found"
      : undefined;
const files = path.join(skillDir("harness-curator"), "evals", "files");
const curate = (fixture: string, args: string[]) =>
  run("harness-curator", "curate.ts", ["--from-stdin", ...args], {
    input: fs.readFileSync(path.join(files, fixture), "utf8"),
    bin: python === undefined ? undefined : path.dirname(python),
  });

describe("curate.ts --check / --summary", { skip }, () => {
  test("a clean wing is healthy, exit 0", () => {
    const r = curate("wing-clean.json", ["--check"]);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout, "healthy\n");
  });
  test("a rotten wing is unhealthy on both signals, exit 1", () => {
    const r = curate("wing-rotten.json", ["--check", "--json"]);
    assert.equal(r.status, 1);
    const e = envelope(r);
    assert.equal(e.ok, false);
    assert.deepEqual(
      e.findings.map((f) => f.rule),
      ["skipped-malformed", "routing-failures"],
    );
  });
  test("one routing failure alone makes the wing unhealthy", () => {
    const r = curate("frictions.json", ["--check", "--json"]);
    assert.equal(r.status, 1);
    assert.deepEqual(
      envelope(r).findings.map((f) => f.rule),
      ["routing-failures"],
    );
  });
  test("--max-malformed-ratio moves the malformed limit", () => {
    const r = curate("wing-rotten.json", ["--check", "--max-malformed-ratio", "0.6", "--json"]);
    assert.deepEqual(
      envelope(r).findings.map((f) => f.rule),
      ["routing-failures"],
    );
  });
  test("--summary prints the counts and the proposed clusters, exit 0", () => {
    const r = curate("frictions.json", ["--summary"]);
    assert.equal(r.status, 0);
    assert.match(
      r.stdout,
      /^- Frictions read: 9 \(valid 8, skipped as malformed 1, already resolved 0\)\n/,
    );
    assert.match(r.stdout, /- Clusters: formed 5, above threshold 3, parked 1, truncated 0\n/);
    assert.match(r.stdout, /- Routing failures: 1\n/);
    assert.match(
      r.stdout,
      /- Proposed: yq-merge \(3\) -> https:\/\/github\.com\/acme\/agent-config\n/,
    );
  });
  test("--summary --json is one envelope with the stats", () => {
    const e = envelope(curate("wing-clean.json", ["--summary", "--json"]));
    assert.equal(e.ok, true);
    assert.equal((e.data?.["stats"] as Record<string, number>)["clusters_above_threshold"], 2);
  });
  test("usage errors keep exit 1: --check with --apply or --deep, --json alone, a bad ratio", () => {
    for (const args of [
      ["--check", "--apply"],
      ["--check", "--deep"],
      ["--json"],
      ["--check", "--max-malformed-ratio", "2"],
    ]) {
      const r = curate("wing-clean.json", args);
      assert.equal(r.status, 1, args.join(" "));
      assert.match(r.stderr, /Error:/);
    }
  });
  test("a plain dry run is unchanged: the JSON report", () => {
    const r = curate("wing-clean.json", ["--dry-run"]);
    assert.equal(
      (JSON.parse(r.stdout) as { stats: { total_drawers: number } }).stats.total_drawers,
      6,
    );
  });
});

test("curate.py --help prints usage and exits 0", { skip }, () => {
  const r = spawnSync(
    python as string,
    [path.join(skillDir("harness-curator"), "scripts", "curate.py"), "--help"],
    { encoding: "utf8" },
  );
  assert.equal(r.status, 0);
  assert.match(r.stdout, /^usage: curate\.py/);
});
