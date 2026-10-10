// setup-stdlib-closure.test.ts — LAYER 1 of the setup graph imports only the Node.js standard library
// (spec 0256 requirement 20). LAYER 1 is the set of modules that run BEFORE the dependency step has
// installed anything: the static import closure of those modules (through `import ... from`,
// `export ... from`, `import()` and `require()` specifiers, repo-relative paths followed) must hold no
// bare specifier that is not `node:`-prefixed, i.e. no third-party package, at any depth.
//
// The second half (plan v2 step B3b.7) covers the modules the four descriptors run BEFORE the
// dependency step (`deps-install`): the entry graph (flow.ts, which statically imports every step
// registry, plus the four descriptors) and the modules of each pre-dependency step. A module loaded
// only AFTER that step (MemPalace, MCP strategies, tiers, usage capture) may reach `js-yaml`, but
// only through a lazy `import()`: a variable-specifier import is invisible to the scan, so each one is
// listed in LAZY_AFTER_DEPS with its reason, and an unlisted one fails the test.

import assert from "node:assert/strict";
import fs from "node:fs";
import { isBuiltin } from "node:module";
import os from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";

import { antigravityDescriptor } from "../lib/setup/cli-antigravity.ts";
import { claudeDescriptor } from "../lib/setup/cli-claude.ts";
import { copilotDescriptor } from "../lib/setup/cli-copilot.ts";
import { geminiDescriptor } from "../lib/setup/cli-gemini.ts";
import {
  importClosure,
  REPO,
  variableImports,
  type Closure,
  type Finding,
} from "./lib/setup-source-scan.ts";

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

/** A bare specifier is third-party unless it names a Node.js built-in (legacy CJS omits `node:`). */
const thirdParty = (c: Closure): Finding[] => c.bare.filter((f) => !isBuiltin(f.text));
const show = (f: Finding): string => `${f.file}:${f.line} ${JSON.stringify(f.text)}`;

const SETUP = "scripts/lib/setup";
const DESCRIPTORS = {
  claude: claudeDescriptor,
  gemini: geminiDescriptor,
  copilot: copilotDescriptor,
  antigravity: antigravityDescriptor,
};

/** The files that register or run each step that precedes `deps-install` in at least one descriptor. */
const PRE_DEPS_STEP_FILES: Readonly<Record<string, readonly string[]>> = {
  banner: [`${SETUP}/steps.ts`],
  "link-confirm": [`${SETUP}/flow.ts`, `${SETUP}/link-key.ts`],
  "ensure-home": [`${SETUP}/steps.ts`],
  prerequisites: [`${SETUP}/steps.ts`, `${SETUP}/prerequisites.ts`],
  "identity-check": [`${SETUP}/steps.ts`, `${SETUP}/prerequisites.ts`],
  "copilot-workspace-files": [`${SETUP}/steps-copilot.ts`],
  "rules-existing": [`${SETUP}/steps-rules.ts`],
  "rules-shared": [`${SETUP}/steps-rules.ts`],
  "rules-selection": [`${SETUP}/steps-rules.ts`],
  // steps-agy.ts loads mcp-agy-step.ts by a computed specifier: resolved here as a literal file.
  "mcp-prepare": [`${SETUP}/steps-agy.ts`, `${SETUP}/mcp-agy-step.ts`],
  "tls-offer": [`${SETUP}/steps.ts`, `${SETUP}/tls-offer.ts`],
};

/** Variable-specifier `import()` sites, each with why it is safe. Anything else is a failure. */
const LAZY_AFTER_DEPS: Readonly<Record<string, string>> = {
  "scripts/lib/require-dependency.ts":
    "loadDependency(): the sanctioned runtime loader of an installed production dependency, which fails with a plain-language MissingDependencyError when it is not installed (spec 0240 R7)",
  [`${SETUP}/steps-mcp.ts`]:
    "loads the strategy file of the `mcp` step, which every descriptor lists AFTER `deps-install`",
  [`${SETUP}/steps-agy.ts`]:
    "loads mcp-agy-step.ts for `mcp-prepare`: a pre-dependency step, whose file is resolved in PRE_DEPS_STEP_FILES",
};

const preDeps = (steps: readonly string[]): string[] =>
  steps.slice(0, steps.indexOf("deps-install"));

describe("the modules that run before the dependency step", () => {
  const graphEntries = [
    `${SETUP}/flow.ts`,
    ...Object.keys(DESCRIPTORS).map((cli) => `${SETUP}/cli-${cli}.ts`),
    // The four entries (scripts/setup-<cli>-interactive.ts) join the graph when they exist.
    ...Object.keys(DESCRIPTORS)
      .map((cli) => `scripts/setup-${cli}-interactive.ts`)
      .filter((p) => fs.existsSync(path.join(REPO, p))),
  ];

  test("every descriptor reaches deps-install, and every step before it is classified", () => {
    for (const [cli, d] of Object.entries(DESCRIPTORS)) {
      assert.ok(d.steps.includes("deps-install"), `${cli} has no deps-install step`);
      const unknown = preDeps(d.steps).filter((id) => !(id in PRE_DEPS_STEP_FILES));
      assert.deepEqual(unknown, [], `${cli}: unclassified pre-dependency steps`);
    }
  });

  test("each classified step is still registered in the file the table names", () => {
    const wrong: string[] = [];
    for (const [id, files] of Object.entries(PRE_DEPS_STEP_FILES)) {
      const first = fs.readFileSync(path.join(REPO, files[0] as string), "utf8");
      if (!new RegExp(`(?<![\\w-])${id}(?![\\w-])`).test(first)) wrong.push(`${id} in ${files[0]}`);
    }
    assert.deepEqual(wrong, []);
  });

  test("the entry graph (flow, registries, descriptors) holds no third-party package", () => {
    const closure = importClosure(graphEntries);
    assert.ok(closure.files.size >= 50, `entry graph of ${closure.files.size} files: vacuous`);
    for (const f of [
      "steps.ts",
      "steps-rules.ts",
      "steps-agy.ts",
      "steps-copilot.ts",
      "deps-step.ts",
    ])
      assert.ok(closure.files.has(`${SETUP}/${f}`), `${f} not reached from the entry graph`);
    assert.deepEqual(thirdParty(closure).map(show), []);
    assert.deepEqual(closure.unresolved.map(show), []);
  });

  for (const [cli, d] of Object.entries(DESCRIPTORS)) {
    test(`the ${cli} pre-dependency steps import no third-party package at any depth`, () => {
      const files = [...new Set(preDeps(d.steps).flatMap((id) => PRE_DEPS_STEP_FILES[id] ?? []))];
      const closure = importClosure(files);
      assert.ok(closure.files.size >= 20, `closure of ${closure.files.size} files: vacuous`);
      assert.deepEqual(thirdParty(closure).map(show), []);
      assert.deepEqual(closure.unresolved.map(show), []);
    });
  }

  test("every variable-specifier import() of the entry graph is listed with a reason", () => {
    const sites = variableImports(importClosure(graphEntries).files);
    const unlisted = sites.filter((s) => !(s.file in LAZY_AFTER_DEPS));
    assert.deepEqual(unlisted.map(show), []);
    const stale = Object.keys(LAZY_AFTER_DEPS).filter((f) => !sites.some((s) => s.file === f));
    assert.deepEqual(stale, [], "listed files with no variable import left: drop them");
  });

  test("the `mcp` step, whose strategy files load lazily, follows deps-install everywhere", () => {
    for (const [cli, d] of Object.entries(DESCRIPTORS))
      assert.ok(d.steps.indexOf("mcp") > d.steps.indexOf("deps-install"), `${cli}: mcp is early`);
  });
});

describe("pre-dependency scan self-test", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "setup-predeps-"));
  after(() => fs.rmSync(root, { recursive: true, force: true }));
  const write = (file: string, body: string): void => {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), body);
  };
  write("flow.ts", 'import { rules } from "./steps-rules.ts";\nexport const f = rules;\n');
  write("steps-rules.ts", 'import { pick } from "./pick.ts";\nexport const rules = pick;\n');
  write(
    "pick.ts",
    'import fs from "fs";\nimport yaml from "js-yaml";\nexport const pick = [fs, yaml];\n',
  );
  write("lazy.ts", 'const f = "./later.ts";\nexport const go = () => import(f);\n');
  write("later.ts", 'import yaml from "js-yaml";\nexport const l = yaml;\n');

  test("a third-party import in a pre-dependency module is caught, a legacy builtin is not", () => {
    const closure = importClosure(["flow.ts"], root);
    assert.deepEqual(thirdParty(closure).map(show), ['pick.ts:2 "js-yaml"']);
  });

  test("a lazy variable import hides its target from the closure but not from the site scan", () => {
    const closure = importClosure(["lazy.ts"], root);
    assert.deepEqual(thirdParty(closure), []);
    assert.deepEqual(
      variableImports(closure.files, root).map((f) => `${f.file}:${f.line}`),
      ["lazy.ts:2"],
    );
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
