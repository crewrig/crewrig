// setup-oracle-paths.test.ts — the `setup-oracle` CI path filter covers everything the sandbox
// copies from the real repository (spec 0256 R40, seat review/1335 finding i2-F1). Layer 1: node:fs
// only, no yaml dependency, runs on every OS. Reads the copy sources from `setup-sandbox.ts` and
// `build-fixture-tree.ts` and the capability `paths:` from `ci/ci-capabilities.yml`.
// API: sandboxSources(), capabilityPaths(), uncovered(sources, patterns) -> sources no pattern covers.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { REPO } from "./lib/build-fixture-tree.ts";
import { capabilityTriggerPaths } from "./lib/capability-path-scan.ts";

const read = (rel: string): string => fs.readFileSync(path.join(REPO, rel), "utf8");

/** A literal or templated path argument, cut before any `${` and trimmed to its directory. */
const literalPart = (raw: string): string => {
  const cut = raw.includes("${") ? raw.slice(0, raw.indexOf("${")).replace(/\/[^/]*$/, "") : raw;
  return cut.replace(/\/$/, "");
};

/** Repo-relative paths the sandbox copies; `node_modules` is copied from the checkout. */
export function sandboxSources(): string[] {
  const found = new Set<string>();
  const text = `${read("scripts/tests/lib/setup-sandbox.ts")}\n${read("scripts/tests/lib/build-fixture-tree.ts")}`;
  for (const m of text.matchAll(/\bcopy\(\s*["`]([^"`]+)["`]/g)) found.add(literalPart(m[1] ?? ""));
  for (const m of text.matchAll(/path\.join\(\s*REPO,\s*["`]([^"`]+)["`],?\s*\)/g))
    found.add(literalPart(m[1] ?? ""));
  // `createFixtureTree` copies every script (minus tests) through `copyScripts`.
  if (text.includes("copyScripts(root)")) found.add("scripts");
  found.delete("");
  return [...found].filter((p) => !p.startsWith("node_modules")).sort();
}

/** The `paths:` entries of each trigger of the `setup-oracle` capability, from a plain text scan. */
export function capabilityPaths(): string[][] {
  return capabilityTriggerPaths(read("ci/ci-capabilities.yml"), "setup-oracle");
}

/** A pattern covers a source when it names it, or names `dir/**` / `dir/*` for an ancestor `dir`. */
const covers = (pattern: string, source: string): boolean => {
  if (pattern === source) return true;
  const dir = /^(.*)\/\*\*?$/.exec(pattern)?.[1];
  return dir !== undefined && (source === dir || source.startsWith(`${dir}/`));
};

export const uncovered = (sources: readonly string[], patterns: readonly string[]): string[] =>
  sources.filter((s) => !patterns.some((p) => covers(p, s)));

test("the sandbox copy list and the capability paths are non-empty (vacuity guard)", () => {
  const sources = sandboxSources();
  for (const expected of [
    "scripts",
    "config",
    "hooks",
    "scripts/tests/fixtures/setup-golden/package-lock.json.golden",
  ])
    assert.ok(sources.includes(expected), `${expected} is not detected in the sandbox copies`);
  const blocks = capabilityPaths();
  assert.ok(blocks.length >= 2, "expected a pull-request and a push `paths:` block");
  assert.ok(
    blocks.every((b) => b.length > 0),
    "an empty `paths:` block",
  );
});

test("every directory or file the sandbox copies is covered by a setup-oracle path", () => {
  for (const patterns of capabilityPaths())
    assert.deepEqual(uncovered(sandboxSources(), patterns), []);
});

test("self-test: an uncovered directory is caught, covered ones are not", () => {
  const patterns = ["scripts/lib/**", "config/**", "package.json"];
  assert.deepEqual(uncovered(["scripts", "config/x.md", "package.json", "hooks"], patterns), [
    "scripts",
    "hooks",
  ]);
  assert.deepEqual(uncovered(["scripts/lib"], ["scripts/**"]), []);
});
