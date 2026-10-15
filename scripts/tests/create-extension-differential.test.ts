// create-extension-differential.test.ts — the scaffolder entry against the shell and against the
// committed per-mask manifests (spec 0258 R28, R29). Everywhere: the entry (plain
// `node scripts/create-extension.ts`, no `fzf`) is compared with the 64 manifests generated from
// the shell. On Linux with `bash` and `jq`: the shell under an `fzf` stub is also run live on a
// fixed subset of masks and on the error paths, and its stdout, stderr, status and every file it
// wrote must equal the entry's. The behaviours only the entry has are tagged (h), spec 0258 R31.

import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, test } from "node:test";

import { HAS_SHELL_LEG, LIVE_MASKS, createCases, maskSpec } from "./lib/create-extension-cases.ts";
import {
  MASKS,
  diffManifests,
  goldenFile,
  manifestOf,
  nameOf,
  readGolden,
} from "./lib/create-extension-golden.ts";
import type { RunSpec } from "./lib/create-extension-observe.ts";
import { writeFile } from "./lib/create-extension-sandbox.ts";

const cases = createCases();

const BROKEN_BUILDER = (root: string): void =>
  writeFile(root, "scripts/build-extension.ts", "process.exitCode = 3;\n");

describe("the entry against the committed manifests (all 64 masks)", () => {
  test("a manifest exists for every mask", () => {
    for (const mask of MASKS) assert.ok(fs.existsSync(goldenFile(mask)), `mask ${mask}`);
  });
  for (const mask of MASKS) {
    test(`mask ${mask}`, () => {
      const observed = cases.observe("entry", maskSpec(mask));
      assert.equal(observed.status, 0, observed.stderr);
      assert.deepEqual(diffManifests(manifestOf(observed), readGolden(mask)), []);
    });
  }
});

describe(
  "the shell and the entry, live",
  { skip: !HAS_SHELL_LEG && "needs Linux, bash and jq" },
  () => {
    const same = (spec: RunSpec, prepare?: (root: string) => void): void => {
      const shell = cases.observe("shell", spec, prepare);
      const entry = cases.observe("entry", spec, prepare);
      assert.deepEqual(entry, shell);
    };
    for (const mask of LIVE_MASKS) test(`mask ${mask}`, () => same(maskSpec(mask)));
    test("no NAME prints the usage", () => same({ name: "", mask: 0 }));
    test("an unknown TIER", () => same({ ...maskSpec(5), env: { TIER: "nope" } }));
    test("an empty TIER selects org", () => same({ ...maskSpec(5), env: { TIER: "" } }));
    test("the core tier", () => same({ ...maskSpec(9), env: { TIER: "core" } }));
    test("an existing target", () =>
      same(maskSpec(3), (root) => writeFile(root, "extensions/org/combo3/keep.txt", "kept\n")));
    test("an empty selection set and empty", () =>
      same({ name: "empty", env: { CREWRIG_TEST_FZF_SELECTION: "" } }));
    test("a broken builder", () => same(maskSpec(63), BROKEN_BUILDER));
  },
);

describe("the entry alone, deviation (h)", () => {
  const entry = (spec: RunSpec, prepare?: (root: string) => void) =>
    cases.observe("entry", spec, prepare);

  test("a broken builder: its status is propagated and the run stops", () => {
    const observed = entry(maskSpec(63), BROKEN_BUILDER);
    assert.equal(observed.status, 3);
    assert.ok(
      observed.stdout.endsWith("Rendering the scaffold once to derive its gap declaration...\n"),
    );
    assert.ok(observed.files["extensions/org/combo63/extension.json"] !== undefined);
  });

  for (const name of ["../x", "a/b", "a&b", "-x", ".x", "a b", "a;b", "a\nb"]) {
    test(`NAME ${JSON.stringify(name)} is refused before anything is created`, () => {
      const observed = entry({ name, mask: 63 });
      assert.equal(observed.status, 1);
      assert.match(observed.stdout, /^Error: NAME must match /);
      assert.deepEqual(observed.files, {});
    });
  }

  test("--components wins over the environment selection", () => {
    const observed = entry({ ...maskSpec(63), name: nameOf(4), args: ["--components", "skill"] });
    assert.deepEqual(diffManifests(manifestOf(observed), readGolden(4)), []);
  });

  test("--components=<list> with blanks and an empty list", () => {
    const some = entry({ name: nameOf(5), args: ["--components=mcp-server, skill"] });
    assert.deepEqual(diffManifests(manifestOf(some), readGolden(5)), []);
    const none = entry({ name: nameOf(0), args: ["--components", ""] });
    assert.deepEqual(diffManifests(manifestOf(none), readGolden(0)), []);
  });

  test("an unknown component is refused", () => {
    const observed = entry({ name: "x", args: ["--components", "skill,nope"] });
    assert.equal(observed.status, 1);
    assert.match(observed.stdout, /unknown component 'nope'/);
    assert.deepEqual(observed.files, {});
  });

  test("an unknown positional argument is ignored, as the shell ignored it", () => {
    const observed = entry({ ...maskSpec(4), args: ["extra", "--whatever"] });
    assert.deepEqual(diffManifests(manifestOf(observed), readGolden(4)), []);
  });

  test("no selection and no terminal: exit 1 naming both forms", () => {
    const observed = entry({ name: "noterm" });
    assert.equal(observed.status, 1);
    assert.match(observed.stderr, /--components/);
    assert.match(observed.stderr, /CREWRIG_TEST_FZF_SELECTION/);
    assert.deepEqual(observed.files, {});
  });

  test("the fzf stub on PATH is ignored", () => {
    const observed = entry({
      ...maskSpec(2),
      env: {
        CREWRIG_TEST_FZF_SELECTION: "skill",
        PATH: `${cases.stubDir}:/usr/bin:/bin:${process.execPath}/..`,
      },
    });
    assert.equal(observed.status, 0, observed.stderr);
  });
});
