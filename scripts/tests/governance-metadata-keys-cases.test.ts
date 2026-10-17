// governance-metadata-keys-cases.test.ts — Replaces scripts/tests/test-check-component-metadata-keys.sh
// (sections S1 migrated/legacy shapes, S2 tier scoping, S3 default glob and exit 2).
// Spec 0265 (row J2): black-box on scripts/check-component-metadata-keys.ts. Findings are on
// stderr, the OK line on stdout; the streams are never merged. The entry loads js-yaml from
// the checkout's own node_modules.
//
// S3's literal 45 is a forcing function: update it when a governed source is legitimately added.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";
import { makeSandbox, REPO, runEntry } from "./lib/governance-sandbox.ts";

const ENTRY = path.join(REPO, "scripts", "check-component-metadata-keys.ts");
const root = makeSandbox("metadata-keys-");

/** Write a fixture source under the sandbox root and return its path. */
function fixture(rel: string, frontMatter: string): string {
  const file = path.join(root, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `---\n${frontMatter}---\nBody.\n`);
  return file;
}
const run = (file: string) => runEntry(ENTRY, { args: [file], env: { CREWRIG_REPO_DIR: root } });
const PROV = '  provenance:\n    canonical: "x"\n    version: "1.0.0"\n';

describe("S1 — the migrated shape, the legacy key, R9's top-level exemption", () => {
  test("S1 migrated shape (metadata: {model, provenance}) is green", () => {
    const f = fixture(
      "artifacts/core/agents/probe-migrated/AGENT.md",
      `name: probe\nmetadata:\n  model:\n    intelligence: high\n${PROV}`,
    );
    const r = run(f);
    assert.equal(r.status, 0, r.stderr);
    assert.doesNotMatch(r.stderr, /K1/);
    assert.equal(r.stderr, "");
  });

  test("S1 R38 mutation 1: metadata.claude is rejected, naming the metadata. path", () => {
    const f = fixture(
      "artifacts/core/agents/probe-legacy/AGENT.md",
      `name: probe\nmetadata:\n  claude:\n    model: sonnet\n${PROV}`,
    );
    const r = run(f);
    assert.equal(r.status, 1);
    assert.match(
      r.stderr,
      new RegExp(
        `^${f.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}: K1 metadata\\.claude is not admitted`,
        "m",
      ),
    );
    assert.match(r.stderr, /\nFAILED: 1 rejection\(s\) across 1 source\(s\)/);
    assert.equal(r.stdout, "");
  });

  test("S1 both keys: metadata.claude beside metadata.model is still rejected", () => {
    const f = fixture(
      "artifacts/core/agents/probe-both/AGENT.md",
      `name: probe\nmetadata:\n  claude:\n    model: sonnet\n  model:\n    intelligence: high\n${PROV}`,
    );
    const r = run(f);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /: K1 metadata\.claude /);
  });

  test("S1 no metadata: a source with no metadata key at all is green", () => {
    const f = fixture("artifacts/core/skills/probe-none/SKILL.md", "name: probe\ndescription: x\n");
    const r = run(f);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stderr, "");
    assert.match(r.stdout, /^OK: 1 source\(s\) checked/);
  });

  test("S1 R9: a top-level claude: section is a legal override surface, never named", () => {
    const f = fixture(
      "artifacts/core/agents/probe-toplevel/AGENT.md",
      `name: probe\nmetadata:\n  model:\n    intelligence: high\n${PROV}claude:\n  allowed-tools:\n    - Bash\n`,
    );
    const r = run(f);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stderr, "");
  });
});

describe("S2 — tier scoping (R8 last clause)", () => {
  test("S2 library: a source carrying metadata.claude is governed and rejected", () => {
    const f = fixture(
      "artifacts/library/agents/probe/AGENT.md",
      `name: probe\nmetadata:\n  claude:\n    model: sonnet\n${PROV}`,
    );
    const r = run(f);
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stderr, /: K1 metadata\.claude /);
  });

  for (const tier of ["community", "org"]) {
    test(`S2 ${tier}: a source carrying metadata.claude is not governed`, () => {
      const f = fixture(
        `artifacts/${tier}/agents/probe/AGENT.md`,
        `name: probe\nmetadata:\n  claude:\n    model: sonnet\n${PROV}`,
      );
      const r = run(f);
      assert.equal(r.status, 0, r.stderr);
      assert.equal(r.stderr, "");
    });
  }
});

describe("S3 — default glob over the real checkout, and prerequisite failure", () => {
  test("S3 default glob: no arguments reports 45 sources, clean", () => {
    const r = runEntry(ENTRY, { env: { CREWRIG_REPO_DIR: undefined } });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /^OK: 45 source\(s\) checked/m);
  });

  test("S3 exit 2: a named argument that does not exist is a prerequisite failure", () => {
    const r = run(path.join(root, "does-not-exist.md"));
    assert.equal(r.status, 2);
  });
});
