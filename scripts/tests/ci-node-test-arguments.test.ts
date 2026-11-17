// ci-node-test-arguments.test.ts — a CI command that starts `node --test` without a test file or
// directory runs every test of the repository with only the production dependencies installed
// (missing dev packages, timing suites, harnesses that need a container). This test reads the
// CI reference, the workflows and fails on such a command (spec 0266, review of PR #1715).

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";
import { readReferenceText } from "./lib/ci-reference-fixtures.ts";

const ROOT = path.resolve(import.meta.dirname, "..", "..");

/** The command lines of a CI file that run `node … --test …` (one logical line per match). */
export function nodeTestCommands(text: string): string[] {
  return text
    .split("\n")
    .filter((line) => !/^\s*(#|-\s+name:|name:)/.test(line))
    .filter((line) => /\bnode\b[^|;&]*\s--test(\s|$)/.test(line));
}

/** True when the command carries a test target after `--test` (a path, a directory or a glob). */
export function hasTestTarget(command: string): boolean {
  const rest = command.slice(command.search(/\s--test(\s|$)/) + " --test".length).trim();
  const targets = rest
    .split(/\s+/)
    .map((token) => token.replace(/^["']|["']$/g, ""))
    .filter((token) => token !== "" && !token.startsWith("-") && token !== "&&");
  return targets.some((token) => token.includes("/") || token.endsWith(".ts"));
}

/** Every CI surface as `[label, text]`: the capability reference first, then the workflows. */
function ciSources(): [string, string][] {
  const workflows = path.join(ROOT, ".github", "workflows");
  const files = fs
    .readdirSync(workflows)
    .filter((name) => name.endsWith(".yml"))
    .map((name): [string, string] => [
      path.relative(ROOT, path.join(workflows, name)),
      fs.readFileSync(path.join(workflows, name), "utf8"),
    ]);
  return [["capability reference", readReferenceText(ROOT)], ...files];
}

describe("every node --test command of the CI names a test target", () => {
  for (const [label, text] of ciSources()) {
    test(label, () => {
      const bare = nodeTestCommands(text).filter(
        (command) => !command.trim().startsWith("#") && !hasTestTarget(command),
      );
      assert.deepEqual(
        bare,
        [],
        "a node --test command without a test file runs the whole repository",
      );
    });
  }
});

describe("the detector", () => {
  test("flags a bare command, with or without flags, and accepts a named suite", () => {
    assert.equal(
      hasTestTarget("run: bash scripts/ci-cache-guard.sh -- node --disable-warning=X --test"),
      false,
    );
    assert.equal(hasTestTarget("- node --test --test-timeout=1000"), false);
    assert.equal(hasTestTarget("- node --disable-warning=X --test scripts/tests/a.test.ts"), true);
    assert.equal(hasTestTarget("- node --test scripts/tests/"), true);
  });

  test("selects only node commands that carry --test", () => {
    const text = [
      "run: node scripts/check.ts",
      "run: node --test a/b.test.ts",
      "run: echo --test",
      "- name: Claim suites, plain node --test",
    ].join("\n");
    assert.deepEqual(nodeTestCommands(text), ["run: node --test a/b.test.ts"]);
  });
});
