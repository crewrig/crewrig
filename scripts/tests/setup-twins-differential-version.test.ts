// setup-twins-differential-version.test.ts — spec 0256 requirement 10 (last clause) and delta-01 deviation (r):
// `inRange` of scripts/lib/setup/mempalace-version.ts against the shell comparator `mempalace_version_in_range`
// of scripts/lib/common.sh, which reads the installed `mempalace` distribution through `importlib.metadata` and
// compares with `packaging.version`. Each vector is installed as a fake dist-info on PYTHONPATH, so the shell
// function runs unchanged. Needs python3 with `packaging`; otherwise it skips and prints the vectors not compared.
// (setup-mempalace-version.test.ts compares `inRange` with packaging directly; this reaches the shell function.)
// Linux only; retired with the shell libraries.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";

import { inRange } from "../lib/setup/mempalace-version.ts";
import { bashLibs } from "./lib/bash-libs.ts";
import { cleanEnv, REPO } from "./lib/worktree-fixtures.ts";

const VECTORS: readonly string[] = [
  // The vectors of delta-01 deviation (r), around both bounds.
  "3.6.0rc1",
  "3.6.0.dev0",
  "3.6.0",
  "3.6.0.post1",
  "3.6.0+local",
  "3.6.99",
  "3.7.0.dev0",
  "3.7.0rc1",
  "3.7.0",
  "3.7.0.post1",
  // Further spellings, outside both bounds, the epoch and strings packaging rejects.
  "3.5.9",
  "3.6",
  "3.7",
  "3.10.0",
  "3.6.0-1",
  "v3.6.0",
  "1!3.6.0",
  "3.6.0 rc1",
  "not-a-version",
];

const LINUX = process.platform === "linux";
const PY_OK =
  spawnSync("python3", ["-I", "-c", "import packaging.version"], { encoding: "utf8" }).status === 0;
const HAS_BASH = spawnSync("bash", ["--version"]).status === 0;
const SKIP =
  !LINUX || !HAS_BASH ? "SKIP: Linux with bash only (retired with the shell libraries)" : false;

const roots: string[] = [];
after(() => roots.forEach((dir) => fs.rmSync(dir, { recursive: true, force: true })));

function bound(name: "MEMPALACE_MIN_VERSION" | "MEMPALACE_MAX_VERSION_EXCLUSIVE"): string {
  const text = fs.readFileSync(path.join(REPO, "scripts", "lib", "common.sh"), "utf8");
  const found = new RegExp(`^${name}="([^"]+)"`, "m").exec(text)?.[1];
  assert.ok(found, `${name} not found in common.sh`);
  return found;
}

/** A directory holding one `mempalace` dist-info of `version` (none when undefined). */
function site(version: string | undefined): string {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "twins-ver-")));
  roots.push(dir);
  if (version === undefined) return dir;
  const info = path.join(dir, "mempalace-0.dist-info");
  fs.mkdirSync(info);
  fs.writeFileSync(
    path.join(info, "METADATA"),
    `Metadata-Version: 2.1\nName: mempalace\nVersion: ${version}\n`,
  );
  return dir;
}

function shellVerdict(version: string | undefined): boolean {
  const res = bashLibs(`mempalace_version_in_range python3; echo "__RC__$?"`, {
    ...cleanEnv(),
    PYTHONPATH: site(version),
  });
  const rc = /__RC__(\d+)/.exec(res.stdout)?.[1];
  assert.ok(rc === "0" || rc === "1", `unexpected rc ${rc}: ${res.stderr}`);
  return rc === "0";
}

if (!PY_OK) {
  console.log(
    `# setup-twins-differential-version: python3 with packaging is absent; not compared: ${VECTORS.join(", ")}, (absent)`,
  );
}

describe(
  "inRange against mempalace_version_in_range",
  { skip: SKIP || (!PY_OK && "SKIP: python3 with packaging is absent") },
  () => {
    const min = bound("MEMPALACE_MIN_VERSION");
    const max = bound("MEMPALACE_MAX_VERSION_EXCLUSIVE");

    test("the shell's bounds are the ones the twin is exercised with", () => {
      assert.deepEqual([min, max], ["3.6.0", "3.7"]);
    });

    test("the verdict is the shell's on every vector, and on an absent distribution", () => {
      const mismatches: string[] = [];
      for (const version of [...VECTORS, undefined]) {
        const shell = shellVerdict(version);
        const twin = inRange(version, min, max);
        if (shell !== twin)
          mismatches.push(`${JSON.stringify(version)}: shell ${shell}, twin ${twin}`);
      }
      assert.deepEqual(mismatches, []);
    });

    test("the comparison is not vacuous: the shell accepts and refuses", () => {
      assert.equal(shellVerdict("3.6.0"), true);
      assert.equal(shellVerdict("3.7.0"), false);
      assert.equal(shellVerdict(undefined), false);
    });
  },
);
