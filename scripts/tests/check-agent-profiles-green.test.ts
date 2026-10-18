// check-agent-profiles-green.test.ts — the green cases of scripts/check-agent-profiles.ts and the
// build-resilience case (spec 0195 R23-R25, spec 0198 R36-R39; spec 0265, row J2, P8).
// Replaces scripts/tests/test-check-agent-profiles.sh (section 2). The Bash section 3 (exit 2
// without yq on PATH) is not replaced here: the TypeScript entry has no yq prerequisite, and its
// green-without-yq replacement is an I2 test, model-ci-tooling-agent-profiles.test.ts.
//
// Strengthening over the Bash suite: stderr of every green case is asserted EMPTY, and the
// baseline file is proven to round-trip through js-yaml (the fixtures are js-yaml dumps, not
// `yq` output). Build resilience runs `node scripts/build-components.ts --target claude` on a
// sandbox copy, never in the checkout.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";

import {
  baseFrontmatter,
  modelOf,
  sourceText,
  writeSource,
  type Doc,
} from "./lib/agent-profile-fixtures.ts";
import {
  copyTracked,
  makeSandbox,
  REPO,
  runEntry,
  stageNodeModules,
} from "./lib/governance-sandbox.ts";
import { docOf, yamlLib } from "./lib/yaml-lib.ts";

const ENTRY = path.join(REPO, "scripts", "check-agent-profiles.ts");
const sandbox = makeSandbox("agent-profiles-green-");
let counter = 0;
const dirOf = (): string => path.join(sandbox, `case-${(counter += 1)}`);

function assertGreen(file: string): void {
  const r = runEntry(ENTRY, { args: [file] });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(r.stderr, "");
}

function writeRaw(text: string): string {
  const dir = dirOf();
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, "probe.md");
  fs.writeFileSync(file, text);
  return file;
}

describe("check-agent-profiles.ts green cases", () => {
  test("baseline file round-trips through js-yaml", () => {
    const file = writeSource(dirOf(), "probe");
    const text = fs.readFileSync(file, "utf8");
    assert.equal(text, sourceText(baseFrontmatter()));
    const fm = text.split("---\n")[1] ?? "";
    assert.deepEqual(yamlLib.load(fm), baseFrontmatter());
    assert.notEqual(docOf(fm), null);
  });

  test("specialization: image-generation is green (open enum)", () => {
    assertGreen(
      writeSource(dirOf(), "probe", (doc: Doc) => {
        modelOf(doc)["specialization"] = "image-generation";
      }),
    );
  });

  test("metadata.claude.model alone is green", () => {
    assertGreen(
      writeRaw(
        '---\nname: probe\ndescription: "Fixture carrying the legacy metadata.claude.model key alone."\n' +
          "metadata:\n  claude:\n    model: sonnet\n---\nBody.\n",
      ),
    );
  });

  test("empty tuning: mapping is green", () => {
    assertGreen(
      writeSource(dirOf(), "probe", (doc: Doc) => {
        modelOf(doc)["tuning"] = {};
      }),
    );
  });

  test("no metadata.model at all is green", () => {
    assertGreen(
      writeRaw(
        '---\nname: probe\ndescription: "Fixture with no capability profile at all."\n---\nBody.\n',
      ),
    );
  });
});

describe("build resilience", () => {
  test("build still compiles an offending source (degrading the unreadable key, not failing)", () => {
    const root = makeSandbox("agent-profiles-build-");
    copyTracked(root, [
      "scripts/lib",
      "scripts/build-components.ts",
      "model-mappings",
      "crewrig.config.toml",
    ]);
    stageNodeModules(root);
    writeSource(path.join(root, "artifacts", "core", "agents", "probe"), "AGENT", (doc: Doc) => {
      modelOf(doc)["intelligence"] = "bogus";
    });
    const r = runEntry(path.join(root, "scripts", "build-components.ts"), {
      cwd: root,
      args: ["--target", "claude"],
      env: { REPO_DIR: root },
    });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.ok(fs.existsSync(path.join(root, ".claude", "agents", "probe.md")), r.stdout + r.stderr);
  });
});
