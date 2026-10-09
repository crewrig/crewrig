// extension-entry-form.test.ts — the entry form of the five extension entries and the silence it buys
// (spec 0254 R1, R4; spec 0250 R3, spec 0243 R5).
//
// Part 1 asserts the CommonJS-form entry mechanically on each entry. Part 2 is the static contract of
// the sources: imports are `node:` built-ins or repository files, `js-yaml` is named by exactly one
// module (`entry-ctx.ts`, through `loadDependency`), no POSIX tool is spawned, no module exits the
// process. Part 3 runs each entry UNSTUBBED in a fixture tree on the runner's Node.js, no flag and no
// option in the environment, and asserts nothing reaches standard error. It runs on Node.js 24.0.0 too
// (the `extension-builders-ts-node-24-0` job, after the production install).

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";

import { createFixtureTree } from "./lib/build-fixture-tree.ts";
import { minimalTree, writeTree } from "./lib/extension-trees.ts";

const REPO = path.resolve(import.meta.dirname, "..", "..");
const MODULES = "scripts/lib/extension";
const ENTRIES = [
  "scripts/build-extension.ts",
  "scripts/build-claude-plugin.ts",
  "scripts/build-copilot-plugin.ts",
  "scripts/build-antigravity-extension.ts",
  "scripts/migrate-extension.ts",
];

/** A file's code, without its full-line comments (which may name `import()`). */
function code(file: string): string {
  return fs
    .readFileSync(path.join(REPO, file), "utf8")
    .split("\n")
    .filter((line) => !/^\s*(\/\/|\/\*|\*)/.test(line))
    .join("\n");
}

const moduleFiles = (): string[] =>
  fs
    .readdirSync(path.join(REPO, MODULES))
    .filter((name) => name.endsWith(".ts"))
    .map((name) => `${MODULES}/${name}`);

describe("entry form", () => {
  for (const entry of ENTRIES) {
    const lines = fs.readFileSync(path.join(REPO, entry), "utf8").split("\n");

    test(`${entry}: no module syntax or global declaration at column 0`, () => {
      const offending = lines.filter((line) =>
        /^(import|export|const|let|var|function|class|enum|interface|type|declare|namespace|abstract|async)\b/.test(
          line,
        ),
      );
      assert.deepEqual(offending, []);
    });

    test(`${entry}: the first statement removes the warning listeners, before the first import()`, () => {
      const first = lines.find((line) => line.trim() !== "" && !line.startsWith("//"));
      assert.equal(first, 'process.removeAllListeners("warning");');
      const text = code(entry);
      assert.ok(text.search(/\bimport\(/) > text.indexOf('process.removeAllListeners("warning")'));
      assert.doesNotMatch(text, /uncaughtException/);
      assert.match(text, /process\.exitCode\s*=/);
    });
  }
});

describe("static contract", () => {
  const sources = (): string[] => [...ENTRIES, ...moduleFiles(), "scripts/lib/org-mcp.ts"];

  test("every import is a node: built-in or a repository file", () => {
    const specifier =
      /(?:^\s*(?:import|export)\b[^"'\n]*?\bfrom\s*|^\s*import\s*|\bimport\(\s*|\brequire\(\s*)["']([^"']+)["']/gm;
    let seen = 0;
    for (const file of sources()) {
      for (const match of code(file).matchAll(specifier)) {
        seen += 1;
        const spec = match[1] ?? "";
        assert.ok(spec.startsWith("node:") || spec.startsWith("."), `${file} imports ${spec}`);
      }
    }
    assert.ok(seen > 60, `only ${seen} import specifiers found: the scan is vacuous`);
  });

  test("js-yaml is named by one module, through loadDependency", () => {
    const naming = sources().filter((file) => /js-yaml/.test(code(file)));
    assert.deepEqual(naming, [`${MODULES}/entry-ctx.ts`]);
    assert.match(code(`${MODULES}/entry-ctx.ts`), /loadDependency\("js-yaml"\)/);
  });

  test("no POSIX utility, shell or yq is spawned, and no module exits the process", () => {
    for (const file of sources()) {
      assert.doesNotMatch(
        code(file),
        /(?<![.\w])(spawn|spawnSync|execFile|execFileSync|exec|execSync)\(/,
        file,
      );
      assert.doesNotMatch(code(file), /shell:\s*true/, file);
      assert.doesNotMatch(code(file), /node:child_process/, file);
      assert.doesNotMatch(code(file), /process\.exit\(/, file);
    }
  });
});

describe("silence", () => {
  // `build-extension` sends the delegated plugin builders' output to standard error (as the shell did),
  // so only the Gemini target is silent there; each plugin entry and the migration tool are silent whole.
  const runs: readonly (readonly [string, readonly string[]])[] = [
    ["scripts/build-extension.ts", ["--target", "gemini", "minimal"]],
    ["scripts/build-extension.ts", ["--check"]],
    ["scripts/build-claude-plugin.ts", ["minimal"]],
    ["scripts/build-copilot-plugin.ts", ["minimal"]],
    ["scripts/build-antigravity-extension.ts", ["minimal"]],
    ["scripts/migrate-extension.ts", ["minimal"]],
  ];
  for (const [entry, args] of runs) {
    test(`${entry} ${args.join(" ")} writes nothing to standard error`, () => {
      const tree = createFixtureTree();
      writeTree(path.join(tree.root, "extensions", "core", "minimal"), minimalTree());
      const res = tree.run(args, { entry });
      assert.equal(res.stderr, "");
      assert.equal(res.status, 0);
      tree.dispose();
    });
  }
});
