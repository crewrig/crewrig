// require-dependency.test.ts — tests for scripts/lib/require-dependency.ts (spec 0240 R7).
//
// Each case builds its own mkdtemp fixture with a package.json and a
// node_modules/ tree, and points loadDependency at it through its options.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";

import { loadDependency, MissingDependencyError } from "../lib/require-dependency.ts";

const temps: string[] = [];
after(() => {
  for (const dir of temps) fs.rmSync(dir, { recursive: true, force: true });
});

interface Fixture {
  manifestPath: string;
  resolveFrom: string;
}

/** A fixture root declaring `declared` and installing each entry of `installed`. */
function fixture(declared: string[], installed: Record<string, string>): Fixture {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "crewrig-reqdep-"));
  temps.push(root);
  const manifestPath = path.join(root, "package.json");
  const dependencies = Object.fromEntries(declared.map((n) => [n, "1.0.0"]));
  fs.writeFileSync(manifestPath, JSON.stringify({ name: "fixture", dependencies }));
  for (const [name, source] of Object.entries(installed)) {
    const dir = path.join(root, "node_modules", name);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name, main: "index.js" }));
    fs.writeFileSync(path.join(dir, "index.js"), source);
  }
  return { manifestPath, resolveFrom: manifestPath };
}

describe("loadDependency", () => {
  test("loads a declared, installed package", async () => {
    const opts = fixture(["answer"], { answer: "module.exports = 42;\n" });
    const mod = (await loadDependency("answer", opts)) as { default: unknown };
    assert.equal(mod.default, 42);
  });

  test("a declared but absent package raises MissingDependencyError", async () => {
    const opts = fixture(["absent-pkg"], {});
    await assert.rejects(loadDependency("absent-pkg", opts), (error: unknown) => {
      assert.ok(error instanceof MissingDependencyError);
      assert.equal(error.packageName, "absent-pkg");
      assert.match(error.message, /'absent-pkg' is not installed/);
      assert.match(error.message, /re-run setup/);
      return true;
    });
  });

  test("an undeclared name is a programming error, not MissingDependencyError", async () => {
    const opts = fixture([], { answer: "module.exports = 42;\n" });
    await assert.rejects(loadDependency("answer", opts), (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.equal(error instanceof MissingDependencyError, false);
      assert.match(error.message, /not declared in the dependencies/);
      return true;
    });
  });

  test("an error thrown by the package on load is rethrown unchanged", async () => {
    const opts = fixture(["broken"], { broken: "throw new Error('boom from broken');\n" });
    await assert.rejects(loadDependency("broken", opts), (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.equal(error instanceof MissingDependencyError, false);
      assert.equal(error.message, "boom from broken");
      return true;
    });
  });

  test("a copy found only in a parent directory's node_modules is not accepted", async () => {
    const outer = fs.mkdtempSync(path.join(os.tmpdir(), "crewrig-reqdep-outer-"));
    temps.push(outer);
    const stray = path.join(outer, "node_modules", "stray");
    fs.mkdirSync(stray, { recursive: true });
    fs.writeFileSync(
      path.join(stray, "package.json"),
      JSON.stringify({ name: "stray", main: "index.js" }),
    );
    fs.writeFileSync(path.join(stray, "index.js"), "module.exports = 'outside';\n");
    const checkout = path.join(outer, "checkout");
    fs.mkdirSync(checkout);
    const manifestPath = path.join(checkout, "package.json");
    fs.writeFileSync(
      manifestPath,
      JSON.stringify({ name: "fixture", dependencies: { stray: "1.0.0" } }),
    );
    await assert.rejects(
      loadDependency("stray", { manifestPath, resolveFrom: manifestPath }),
      MissingDependencyError,
    );
  });

  test("defaults to the repository root manifest", async () => {
    // The root declares no production dependency today, so any name is refused
    // by the phantom-import guard, never resolved.
    await assert.rejects(loadDependency("semver"), /not declared in the dependencies/);
  });
});
