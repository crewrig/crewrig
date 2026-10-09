// windows-extension-proof.ts — the cross-system proof of the extension and plugin builders (spec 0254
// R22, R23). Not a test suite: a script the `windows-latest` job runs under pwsh after the production
// install, and the Linux `extension-builders-ts` job runs too, so the same bytes are proven on both
// systems against the one committed golden tree.
//
//   node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/tests/lib/windows-extension-proof.ts
//
// Steps, each timed (the times are recorded, never asserted):
//   1. `build-extension --target all` of each golden subject equals the golden tree, byte for byte, and
//      no written file holds a carriage return;
//   2. `build-extension --check` over the subjects exits 0 with its closing line;
//   3. each plugin entry's tree equals the golden tree of its target;
//   4. the migration tool converts a legacy tree, and a second run reports `Already migrated`;
//   5. an invalid manifest and a context diagnostic fail with exit 1 and leave no context file.
// Exit 0 on success; on any mismatch a message naming the first difference and exit 1.

import assert from "node:assert/strict";
import path from "node:path";

import {
  buildSubjects,
  contextFailTree,
  invalidTree,
  legacyTree,
  writeTree,
} from "./extension-trees.ts";
import {
  collectFiles,
  diffFiles,
  extensionRoot,
  outputDirs,
  runTs,
  withSkeleton,
} from "./extension-run.ts";

const GOLDEN = path.resolve(import.meta.dirname, "..", "fixtures", "extension-golden");
const CLOSING =
  "OK: every extension carries no committed generated output, renders cleanly, and matches its declared set.";

function timed<T>(label: string, work: () => T): T {
  const started = process.hrtime.bigint();
  try {
    return work();
  } finally {
    console.log(
      `windows-extension-proof: ${label}: ${Number((process.hrtime.bigint() - started) / 1_000_000n)} ms`,
    );
  }
}

function goldenStep(): void {
  for (const [name, files] of Object.entries(buildSubjects())) {
    const tree = extensionRoot({ [name]: files });
    const run = runTs(tree, "build-extension", ["--target", "all", name]);
    assert.equal(run.status, 0, `${name}: ${run.stderr}`);
    for (const [label, dir] of Object.entries(outputDirs(tree, name))) {
      const built = collectFiles(dir);
      assert.deepEqual(
        diffFiles(collectFiles(path.join(GOLDEN, name, label)), built),
        [],
        `${name}/${label}`,
      );
      for (const [rel, bytes] of built)
        assert.ok(!bytes.includes(13), `${name}/${label}/${rel} holds a carriage return`);
    }
    tree.dispose();
  }
}

function checkStep(): void {
  const tree = extensionRoot(buildSubjects());
  withSkeleton(tree);
  const run = runTs(tree, "build-extension", ["--check"]);
  assert.equal(run.status, 0, `${run.stdout}\n${run.stderr}`);
  assert.ok(run.stdout.includes(CLOSING), `the closing line is missing:\n${run.stdout}`);
  tree.dispose();
}

function pluginStep(): void {
  const subjects = buildSubjects();
  const entries = [
    ["build-claude-plugin", "claude-plugin"],
    ["build-copilot-plugin", "copilot-plugin"],
    ["build-antigravity-extension", "antigravity-plugin"],
  ] as const;
  for (const [script, label] of entries) {
    const tree = extensionRoot({ full: subjects["full"] ?? {} });
    const run = runTs(tree, script, ["full", "out"]);
    assert.equal(run.status, 0, `${script}: ${run.stdout}\n${run.stderr}`);
    const built = collectFiles(path.join(tree.root, "out"));
    // The hook file is written by `build-extension` after the plugin builder runs (spec 0254 R15): a
    // plugin entry run on its own never writes it, so it is left out of the golden side here.
    const golden = collectFiles(path.join(GOLDEN, "full", label));
    golden.delete(label === "claude-plugin" ? "hooks/hooks.json" : "hooks.json");
    assert.deepEqual(diffFiles(golden, built), [], script);
    tree.dispose();
  }
}

function migrateStep(): void {
  const tree = extensionRoot({ legacy: legacyTree() });
  const first = runTs(tree, "migrate-extension", ["legacy"]);
  assert.equal(first.status, 0, first.stderr);
  assert.match(first.stdout, /^Migrated: /);
  const dir = path.join(tree.root, "extensions", "core", "legacy");
  assert.ok(!tree.exists("extensions/core/legacy/CLAUDE.md"), "the committed output is removed");
  assert.ok(!tree.read("extensions/core/legacy/extension.json").includes('"components"'));
  const before = collectFiles(dir);
  const second = runTs(tree, "migrate-extension", ["legacy"]);
  assert.equal(second.status, 0);
  assert.match(second.stdout, /^Already migrated: /);
  assert.deepEqual(diffFiles(before, collectFiles(dir)), []);
  tree.dispose();
}

function failureStep(): void {
  const invalid = extensionRoot({ invalid: invalidTree() });
  const bad = runTs(invalid, "build-extension", ["--target", "all", "invalid"]);
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /VALIDATION-ERROR:/);
  invalid.dispose();
  const failing = extensionRoot({ ctxfail: contextFailTree() });
  const ctx = runTs(failing, "build-extension", ["--target", "claude", "ctxfail"]);
  assert.equal(ctx.status, 1);
  assert.match(ctx.stderr, /UNCLOSED-BLOCK:/);
  assert.ok(
    !failing.exists("extensions/core/ctxfail/dist-claude-plugin/ctxfail/CLAUDE.md"),
    "no context file on failure",
  );
  failing.dispose();
}

try {
  timed("golden tree", goldenStep);
  timed("--check", checkStep);
  timed("plugin entries", pluginStep);
  timed("migration tool", migrateStep);
  timed("failure statuses", failureStep);
  console.log("windows-extension-proof: OK");
} catch (error) {
  console.error(
    `windows-extension-proof: FAILED: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exitCode = 1;
}
void writeTree;
