// setup-misc-paths.test.ts — the `misc` CI path filters cover the whole import closure of the
// declaration printer (spec 0256, seat review/1335 finding i1-F15). `misc` runs
// `scripts/check-gemini-overlay-enrollment.sh`, which reads the Gemini descriptor through
// `scripts/tests/lib/print-setup-declarations.ts`; a change to any module that printer imports
// (descriptors, facts, hook/extension/link-or-copy/manage/install/service helpers) can change the
// declaration, so it must trigger the job. Layer 1: node:fs only, no yaml dependency, runs on every OS.
// API: miscTriggerPaths(), githubMiscFilter(), globToRegExp(glob), uncovered(files, globs).

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { REPO } from "./lib/build-fixture-tree.ts";
import { importClosure } from "./lib/setup-source-scan.ts";

const PRINTER = "scripts/tests/lib/print-setup-declarations.ts";

const read = (rel: string): string => fs.readFileSync(path.join(REPO, rel), "utf8");

/** The `paths:` entries of each trigger of the `misc` capability, from a plain text scan. */
export function miscTriggerPaths(): string[][] {
  const lines = read("ci/ci-capabilities.yml").split("\n");
  const start = lines.findIndex((l) => /^ {2}- id: misc\s*$/.test(l));
  if (start < 0) return [];
  const blocks: string[][] = [];
  for (const l of lines.slice(start + 1)) {
    if (/^ {2}- id:/.test(l)) break;
    if (/^ {8}paths:\s*$/.test(l)) blocks.push([]);
    const m = /^ {10}- "([^"]+)"\s*$/.exec(l);
    if (m !== null) blocks.at(-1)?.push(m[1] ?? "");
  }
  return blocks;
}

/** The globs of the `misc:` filter of the GitHub `misc` job (dorny/paths-filter), same plain scan. */
export function githubMiscFilter(): string[] {
  const lines = read(".github/workflows/build.yml").split("\n");
  const job = lines.findIndex((l) => /^ {2}misc:\s*$/.test(l));
  if (job < 0) return [];
  const globs: string[] = [];
  let inFilter = false;
  for (const l of lines.slice(job + 1)) {
    if (/^ {2}\S/.test(l)) break;
    if (/^ {12}misc:\s*$/.test(l)) inFilter = true;
    else if (inFilter) {
      const m = /^ {14}- '([^']+)'\s*$/.exec(l);
      if (m === null) break;
      globs.push(m[1] ?? "");
    }
  }
  return globs;
}

/** `**` crosses directories, `*` does not; every other character is literal. */
export function globToRegExp(glob: string): RegExp {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i] ?? "";
    if (c === "*" && glob[i + 1] === "*") {
      re += ".*";
      i += 1;
      if (glob[i + 1] === "/") i += 1;
    } else if (c === "*") re += "[^/]*";
    else re += c.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${re}$`);
}

/** The files no glob of `globs` matches. */
export const uncovered = (files: Iterable<string>, globs: readonly string[]): string[] => {
  const res = globs.map(globToRegExp);
  return [...files].filter((f) => !res.some((r) => r.test(f))).sort();
};

const closure = (): Set<string> => importClosure([PRINTER]).files;

test("the printer closure and the misc trigger lists are non-empty (vacuity guard)", () => {
  const files = closure();
  for (const expected of [
    PRINTER,
    "scripts/tests/lib/setup-declarations-facts.ts",
    "scripts/lib/setup/cli-gemini.ts",
  ])
    assert.ok(files.has(expected), `${expected} is not in the closure of the printer`);
  assert.ok(
    [...files].some((f) => f.startsWith("scripts/lib/") && !f.startsWith("scripts/lib/setup/")),
    "the closure reaches no module outside scripts/lib/setup/ (scanner regression?)",
  );
  const blocks = miscTriggerPaths();
  assert.ok(blocks.length >= 2, "expected a pull-request and a push `paths:` block");
  assert.ok(
    blocks.every((b) => b.length > 0),
    "an empty `paths:` block",
  );
  assert.ok(githubMiscFilter().length > 0, "the GitHub `misc` filter is empty");
});

test("every module the declaration printer imports triggers the misc capability", () => {
  const files = closure();
  for (const patterns of miscTriggerPaths()) assert.deepEqual(uncovered(files, patterns), []);
});

test("the GitHub misc path filter covers the same closure", () => {
  assert.deepEqual(uncovered(closure(), githubMiscFilter()), []);
});

test("self-test: a module outside the globs is caught, covered ones are not", () => {
  const globs = ["scripts/lib/setup/**", PRINTER, "scripts/tests/lib/setup-declarations-*.ts"];
  assert.deepEqual(
    uncovered(
      [
        "scripts/lib/setup/steps.ts",
        PRINTER,
        "scripts/tests/lib/setup-declarations-facts.ts",
        "scripts/lib/link-or-copy.ts",
        "scripts/lib/extension/types.ts",
      ],
      globs,
    ),
    ["scripts/lib/extension/types.ts", "scripts/lib/link-or-copy.ts"],
  );
  assert.deepEqual(
    uncovered(["scripts/lib/service/x/y.ts", "scripts/lib/a.ts"], ["scripts/lib/**"]),
    [],
  );
  assert.deepEqual(uncovered(["scripts/lib/a/b.ts"], ["scripts/lib/*"]), ["scripts/lib/a/b.ts"]);
});
