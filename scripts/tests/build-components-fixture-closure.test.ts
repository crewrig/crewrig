// build-components-fixture-closure.test.ts — the drift guard of PLAN step 21 (spec 0250 R4,
// R24, R26, scenario 21), and the unit suite of scripts/tests/lib/build-fixture-tree.ts.
//
// The Bash suites of PR A cannot call TypeScript, so each hard-codes the production
// closure of `js-yaml` ("js-yaml argparse") when it stages a throwaway tree. This suite
// fails when that literal stops equalling the closure computed from package-lock.json,
// and when a new file hard-codes the same literal without being registered here.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";
import { pathToFileURL } from "node:url";

import { createFixtureTree, productionClosure, REPO } from "./lib/build-fixture-tree.ts";

const temps: string[] = [];
after(() => {
  for (const dir of temps) fs.rmSync(dir, { recursive: true, force: true });
});

/** Where each suite writes its literal, and how to read the package list out of its text. */
const LITERALS: readonly { file: string; pattern: RegExp }[] = [
  {
    file: "scripts/tests/test-component-tier-resolution.sh",
    pattern: /^STAGED_NODE_PACKAGES="([^"]*)"$/m,
  },
  {
    file: "scripts/tests/test-check-extension-hook-tokens.sh",
    pattern: /^STAGED_NODE_PACKAGES="([^"]*)"$/m,
  },
  {
    file: "scripts/tests/test-build-extension.sh",
    pattern: /^STAGED_NODE_PACKAGES="([^"]*)"$/m,
  },
  {
    file: "scripts/tests/test-extension-render-conformance.sh",
    pattern: /^STAGED_NODE_PACKAGES="([^"]*)"$/m,
  },
  {
    file: "scripts/tests/test-migrate-extension.sh",
    pattern: /^STAGED_NODE_PACKAGES="([^"]*)"$/m,
  },
  {
    file: "scripts/tests/test-create-extension-combinations.sh",
    pattern: /^STAGED_NODE_PACKAGES="([^"]*)"$/m,
  },
  {
    file: "scripts/tests/test-release-package-extension.sh",
    pattern: /^STAGED_NODE_PACKAGES="([^"]*)"$/m,
  },
  {
    file: "scripts/tests/test-monorepo-release-engine.sh",
    pattern: /^STAGED_NODE_PACKAGES="([^"]*)"$/m,
  },
  {
    file: "tests/e2e/scenarios/03-skill-build/run.sh",
    pattern: /^for staged_pkg in ([^;]+); do$/m,
  },
];
const sortedWords = (text: string): string[] => text.split(/\s+/).filter(Boolean).sort();

describe("the staged package list of the Bash suites equals the computed closure", () => {
  const closure = productionClosure();

  test("the closure is computed from the lockfile and holds js-yaml", () => {
    assert.ok(closure.includes("js-yaml"), `closure: ${closure.join(" ")}`);
  });

  for (const { file, pattern } of LITERALS) {
    test(`${file}`, () => {
      const text = fs.readFileSync(path.join(REPO, file), "utf8");
      const found = pattern.exec(text);
      assert.ok(found !== null, `no package list found in ${file}`);
      assert.deepEqual(
        sortedWords(found[1] ?? ""),
        closure,
        `${file} stages a list that is not the production closure of package-lock.json`,
      );
    });
  }

  test("no other suite hard-codes the same literal unregistered", () => {
    const registered = new Set(LITERALS.map((l) => l.file));
    const stagingLiteral = /\bjs-yaml\s+argparse\b|\bargparse\s+js-yaml\b/;
    const unregistered = fs
      .globSync(["scripts/tests/**/*.sh", "scripts/tests/**/*.ts", "tests/**/*.sh"], { cwd: REPO })
      .map((rel) => rel.split(path.sep).join("/"))
      .filter((rel) => rel !== "scripts/tests/build-components-fixture-closure.test.ts")
      .filter((rel) => !registered.has(rel))
      .filter((rel) => stagingLiteral.test(fs.readFileSync(path.join(REPO, rel), "utf8")));
    assert.deepEqual(unregistered, [], "register these files in LITERALS");
  });
});

/** A lockfile with the edges `productionClosure` must and must not follow. */
const LOCK = {
  packages: {
    "": {
      dependencies: { alpha: "1", "@scope/beta": "1" },
      devDependencies: { devonly: "1" },
    },
    "node_modules/alpha": { dependencies: { gamma: "1" }, optionalDependencies: { opt: "1" } },
    "node_modules/gamma": { peerDependencies: { peer: "1" } },
    "node_modules/peer": {},
    "node_modules/opt": {},
    "node_modules/@scope/beta": { dependencies: { delta: "1" } },
    "node_modules/@scope/beta/node_modules/delta": {},
    "node_modules/devonly": { dependencies: { devdep: "1" } },
    "node_modules/devdep": {},
    "node_modules/unrelated": {},
  },
};

describe("productionClosure", () => {
  test("follows dependencies, optional and peer edges, scoped and nested packages; skips dev edges", () => {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), "closure-lock-"));
    temps.push(repo);
    fs.writeFileSync(path.join(repo, "package-lock.json"), JSON.stringify(LOCK));
    assert.deepEqual(productionClosure(repo), ["@scope/beta", "alpha", "gamma", "opt", "peer"]);
  });

  test("a package nested under its parent is found by the node_modules walk-up", () => {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), "closure-nest-"));
    temps.push(repo);
    const lock = {
      packages: {
        "": { dependencies: { a: "1", b: "1" } },
        "node_modules/a": { dependencies: { shared: "1" } },
        "node_modules/a/node_modules/shared": {},
        "node_modules/b": { dependencies: { shared: "1" } },
        "node_modules/shared": {},
      },
    };
    fs.writeFileSync(path.join(repo, "package-lock.json"), JSON.stringify(lock));
    assert.deepEqual(productionClosure(repo), ["a", "b", "shared"]);
  });
});

describe("createFixtureTree", () => {
  const tree = createFixtureTree();

  test("holds a .git directory, the root package.json and a copy of scripts/ without scripts/tests", () => {
    assert.ok(fs.statSync(tree.resolve(".git")).isDirectory());
    assert.equal(
      tree.read("package.json"),
      fs.readFileSync(path.join(REPO, "package.json"), "utf8"),
    );
    assert.ok(tree.exists("scripts/lib/build-components/args.ts"));
    assert.ok(!tree.exists("scripts/tests"));
  });

  test("the dependency closure is a REAL copy, never a link, with its own package.json", () => {
    for (const name of productionClosure()) {
      const dir = tree.resolve(`node_modules/${name}`);
      assert.ok(!fs.lstatSync(dir).isSymbolicLink(), `${name} is a symbolic link`);
      assert.ok(fs.statSync(path.join(dir, "package.json")).isFile());
    }
  });

  test("loadDependency run from the tree's own copy loads js-yaml from the tree", async () => {
    const mod = (await import(
      pathToFileURL(tree.resolve("scripts/lib/require-dependency.ts")).href
    )) as {
      loadDependency(name: string): Promise<unknown>;
    };
    const yaml = (await mod.loadDependency("js-yaml")) as { load(text: string): unknown };
    assert.deepEqual(yaml.load("a: 1"), { a: 1 });
  });

  test("a tree without packages makes loadDependency refuse js-yaml (the R24 premise)", async () => {
    const bare = createFixtureTree({ deps: "no-packages" });
    assert.ok(!bare.exists("node_modules"));
    const mod = (await import(
      pathToFileURL(bare.resolve("scripts/lib/require-dependency.ts")).href
    )) as {
      loadDependency(name: string): Promise<unknown>;
    };
    await assert.rejects(mod.loadDependency("js-yaml"), { name: "MissingDependencyError" });
  });

  test('deps "none" copies scripts/ only; dispose removes the root', () => {
    const none = createFixtureTree({ deps: "none" });
    assert.ok(!none.exists(".git") && !none.exists("package.json"));
    assert.ok(none.exists("scripts/build-components.ts"));
    none.dispose();
    assert.ok(!fs.existsSync(none.root));
  });

  test("write, read, remove and the artifact, mapping and config helpers address the root", () => {
    tree.artifact("core/skills/x/SKILL.md", "s");
    tree.mapping("m.yaml", "m");
    tree.config('a = "b"\n');
    assert.equal(tree.read("artifacts/core/skills/x/SKILL.md"), "s");
    assert.equal(tree.read("model-mappings/m.yaml"), "m");
    assert.equal(tree.read("crewrig.config.toml"), 'a = "b"\n');
    tree.remove("artifacts");
    assert.ok(!tree.exists("artifacts"));
  });
});
