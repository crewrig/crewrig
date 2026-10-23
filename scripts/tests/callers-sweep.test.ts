// callers-sweep.test.ts — no tracked file outside the allow-list names a retired spelling of the
// eleven skill scripts or the three curator scripts (spec 0258 R39), and the scan is not vacuous.

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { taskfilePaths } from "../lib/taskfile-tree.ts";
import { repoRoot } from "../lib/ts-scope.ts";
import { ALLOWED, retired, scannedFiles, sweep } from "./lib/callers-sweep.ts";

describe("callers sweep: the whole repository", () => {
  test("no tracked file outside the allow-list carries a retired spelling", () => {
    assert.deepEqual(sweep(scannedFiles()), []);
  });

  test("the scan reaches the callers the fixed lists name, and the Taskfile", () => {
    const files = scannedFiles();
    for (const needed of [
      "README.md",
      ...taskfilePaths(repoRoot()),
      "artifacts/core/agents/ci-debugger/AGENT.md",
    ])
      assert.ok(files.includes(needed), `${needed} is scanned`);
    assert.ok(files.length > 100, `${files.length} files scanned`);
  });

  test("every allow-list entry has a reason and matches a tracked path", () => {
    const all = scannedFiles([]);
    for (const entry of ALLOWED) {
      assert.notEqual(entry.reason, "", entry.prefix);
      assert.ok(
        all.some((f) => f.startsWith(entry.prefix)),
        `${entry.prefix} matches no tracked text file`,
      );
    }
  });

  test("the scan is not vacuous: it reports a planted spelling and a planted bare name", () => {
    assert.deepEqual(retired("run lint-json.sh now"), ["lint-json.sh"]);
    assert.deepEqual(retired("bash scripts/check-secrets-exposure --x"), [
      "scripts/check-secrets-exposure",
    ]);
    assert.deepEqual(retired("bash scripts/curate.sh --apply"), ["curate.sh"]);
    assert.deepEqual(retired("lint-skill.ts and lint-json.ts stay"), []);
    const texts: Record<string, string> = { "a.md": "node lint-json.sh x", "b.md": "clean" };
    assert.deepEqual(
      sweep(["a.md", "b.md"], (file) => texts[file] ?? ""),
      ["a.md: lint-json.sh"],
    );
  });
});
