// pr-logbook-label-scope.test.ts — regression test for spec 0190 (issue #1063).
// Replaces scripts/tests/test-pr-logbook-label-scope.sh (spec 0265, annex P1 step 2.3).
//
// The pr-logbook skill instructions must not tell an agent to add the `logbook` label to a
// pre-existing feature issue, must tell it to create dedicated logbook issues with that label,
// must carry one version in the source and the four compiled outputs, and must show zero drift.
// The version is read from the source frontmatter (V6): the historical literal 1.3.1 is not pinned.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { before, describe, test } from "node:test";

import { scratch } from "./fixtures/build-components/entry-kit.ts";
import { REPO } from "./lib/build-fixture-tree.ts";
import { baseEnv, readFrontmatter } from "./lib/build-sandbox.ts";

const SOURCE = `${REPO}/artifacts/core/skills/pr-logbook/SKILL.md`;
const FORBID = "Do not add the `logbook` label to a pre-existing feature issue.";
const CLIS = [".claude", ".gemini", ".github", ".agents"];

let source = "";
let version = "";

function provenanceVersion(text: string): string {
  const meta = readFrontmatter(text).metadata as { provenance?: { version?: unknown } } | undefined;
  return String(meta?.provenance?.version);
}

before(() => {
  assert.ok(fs.existsSync(SOURCE), `cannot find ${SOURCE}`);
  source = fs.readFileSync(SOURCE, "utf8");
  version = provenanceVersion(source);
});

describe("source skill", () => {
  test("S1 source::no unconditional add-label", () => {
    assert.ok(!source.includes("--add-label logbook"));
  });

  test("S2 source::forbids label on feature issues", () => {
    assert.ok(source.includes(FORBID));
  });

  test("S3 source::dedicated logbook issues carry the label", () => {
    assert.ok(source.includes("--label logbook"));
  });

  test("S4 source::version line", () => {
    assert.match(version, /^\d+\.\d+\.\d+$/);
    assert.ok(source.includes(`version: "${version}"`));
  });
});

for (const cli of CLIS) {
  describe(`compiled skill ${cli}`, () => {
    const file = `${REPO}/${cli}/skills/pr-logbook/SKILL.md`;

    test(`C1 compiled::exists (${cli})`, () => {
      assert.ok(fs.existsSync(file), `missing ${file}`);
    });

    test(`C2 compiled::no add-label (${cli})`, () => {
      assert.ok(!fs.readFileSync(file, "utf8").includes("--add-label logbook"));
    });

    test(`C3 compiled::forbids label (${cli})`, () => {
      assert.ok(fs.readFileSync(file, "utf8").includes(FORBID));
    });

    test(`C4 compiled::version equals the source's (${cli})`, () => {
      assert.ok(fs.readFileSync(file, "utf8").includes(`version: "${version}"`));
    });
  });
}

describe("drift", () => {
  test("D drift::--check on the checkout exits 0", () => {
    const res = spawnSync(
      process.execPath,
      [
        "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON",
        "scripts/build-components.ts",
        "--target",
        "all",
        "--check",
      ],
      {
        cwd: REPO,
        encoding: "utf8",
        env: { ...process.env, ...baseEnv(), TMPDIR: scratch("pr-logbook-drift-") },
      },
    );
    assert.equal(res.status, 0, res.stdout + res.stderr);
  });
});
