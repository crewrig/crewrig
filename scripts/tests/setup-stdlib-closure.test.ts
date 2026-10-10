// setup-stdlib-closure.test.ts — LAYER 1 of the setup graph imports only the Node.js standard library
// (spec 0256 requirement 20). LAYER 1 is the set of modules that run BEFORE the dependency step has
// installed anything: the static import closure of those modules (through `import ... from`,
// `export ... from`, `import()` and `require()` specifiers, repo-relative paths followed) must hold no
// bare specifier that is not `node:`-prefixed, i.e. no third-party package, at any depth.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";

import { importClosure, REPO } from "./lib/setup-source-scan.ts";

/** Modules that must always exist: deleting or renaming one is a failure, never a silent skip. */
const REQUIRED = [
  "argv",
  "answers",
  "prompt-ids",
  "prompt-queue",
  "prompt",
  "link-key",
  "catalogue",
  "validation-backend",
  "files",
  "backup",
  "worktree-warning",
  "tls-detect",
  "tls-offer",
  "trust-wrapper",
  "deps-step",
  "prerequisites",
  "spawner",
  "context",
  "exit",
];
/**
 * The only modules NOT scanned: they run after the dependency step and reach the service layer, whose
 * usage-store CommonJS code requires built-ins without the `node:` prefix. Every other module under
 * scripts/lib/setup/ is in LAYER 1 by default, so a new module is scanned until it is listed here.
 * A name listed here that no longer exists fails the run.
 */
const AFTER_DEPENDENCY_STEP = [
  "chroma-install",
  "chroma-install-win",
  "ensure-http",
  "ensure-http-probe",
  "trust-wrapper-install",
];
const MIN_CLOSURE = 20;

const SETUP_DIR = path.join(REPO, "scripts/lib/setup");
const rel = (name: string): string => `scripts/lib/setup/${name}.ts`;
const onDisk = new Set(
  fs
    .readdirSync(SETUP_DIR)
    .filter((n) => n.endsWith(".ts"))
    .map((n) => n.slice(0, -".ts".length)),
);
const entries = [...onDisk]
  .filter((n) => !AFTER_DEPENDENCY_STEP.includes(n))
  .sort()
  .map(rel);

describe("LAYER 1 import closure", () => {
  test("every required module exists and is scanned (trust-wrapper, tls-detect, tls-offer included)", () => {
    assert.deepEqual(
      REQUIRED.filter((n) => !onDisk.has(n)),
      [],
    );
    assert.deepEqual(
      REQUIRED.map(rel).filter((p) => !entries.includes(p)),
      [],
    );
  });

  test("an exempt name that does not exist fails", () => {
    assert.deepEqual(
      AFTER_DEPENDENCY_STEP.filter((n) => !onDisk.has(n)),
      [],
    );
    assert.deepEqual(
      AFTER_DEPENDENCY_STEP.filter((n) => REQUIRED.includes(n)),
      [],
    );
  });

  test("the closure holds no third-party package and no unresolvable relative import", () => {
    const closure = importClosure(entries);
    assert.ok(
      closure.files.size >= MIN_CLOSURE,
      `closure of ${closure.files.size} files (< ${MIN_CLOSURE}): the scan is vacuous`,
    );
    for (const e of entries)
      assert.ok(closure.files.has(e), `${e} is missing from its own closure`);
    // Reuse of the shared repo modules is the point of the closure walk: it must have reached them.
    assert.ok(closure.files.has("scripts/lib/link-or-copy.ts"), "link-or-copy.ts not reached");
    assert.ok(closure.files.has("scripts/lib/tls-env.ts"), "tls-env.ts not reached from tls-offer");
    const show = (f: { file: string; line: number; text: string }): string =>
      `${f.file}:${f.line} imports ${JSON.stringify(f.text)}`;
    assert.deepEqual(closure.bare.map(show), []);
    assert.deepEqual(closure.unresolved.map(show), []);
  });
});

describe("closure walker self-test", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "setup-closure-"));
  after(() => fs.rmSync(root, { recursive: true, force: true }));
  const write = (file: string, body: string): void => {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), body);
  };
  write(
    "a/entry.ts",
    'import fs from "node:fs";\nimport { b } from "./b.ts";\nexport { c } from "../c/c.ts";\n',
  );
  write(
    "a/b.ts",
    '// import x from "commented-out";\nimport { d } from "./deep/d.ts";\nexport const b = 1;\n',
  );
  write(
    "a/deep/d.ts",
    'import type { T } from "js-yaml";\nexport const d = await import("lodash");\n',
  );
  write("c/c.ts", 'export const c = 1;\nconst s = "import nothing from nowhere";\n');
  write("ok/entry.ts", 'import path from "node:path";\nexport * from "./leaf.ts";\n');
  write("ok/leaf.ts", 'import { x } from "./missing.ts";\nexport const leaf = path;\n');

  test("a bare specifier two levels deep is caught, with its file and line", () => {
    const closure = importClosure(["a/entry.ts"], root);
    assert.deepEqual(closure.bare.map((f) => `${f.file}:${f.line} ${f.text}`).sort(), [
      "a/deep/d.ts:1 js-yaml",
      "a/deep/d.ts:2 lodash",
    ]);
    assert.deepEqual([...closure.files].sort(), ["a/b.ts", "a/deep/d.ts", "a/entry.ts", "c/c.ts"]);
  });

  test("a commented-out import and a string that looks like one are not specifiers", () => {
    const closure = importClosure(["a/entry.ts"], root);
    assert.ok(!closure.bare.some((f) => f.text === "commented-out" || f.text === "nowhere"));
  });

  test("an unresolvable relative import is reported, node: specifiers are not", () => {
    const closure = importClosure(["ok/entry.ts"], root);
    assert.deepEqual(closure.bare, []);
    assert.deepEqual(
      closure.unresolved.map((f) => `${f.file}:${f.line} ${f.text}`),
      ["ok/leaf.ts:1 ./missing.ts"],
    );
  });
});
