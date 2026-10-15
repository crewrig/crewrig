// extension-golden.test.ts — the TypeScript build equals the committed golden tree, byte for byte, on
// Linux, macOS and Windows (spec 0254 R22, R23). The golden was written by the shell oracle
// (scripts/tests/lib/extension-golden-regen.ts); this suite never spawns a POSIX tool.
//
// On a `win32` build host the Antigravity plugin's `hooks.json` carries `GUARDED_PREFIX` (spec 0258
// delta-01 requirement 17), so it has its own golden, `hooks.json.win32.golden`. The second suite
// builds every subject with the platform injected as `win32` (`runBuildOn`, in this process), so the
// Windows branch is proven on every host, and the `windows-latest` proof compares a real `win32`
// build with the same overlay.

import assert from "node:assert/strict";
import path from "node:path";
import { describe, test } from "node:test";

import { GUARDED_PREFIX } from "../lib/hook-command.ts";
import { buildSubjects } from "./lib/extension-trees.ts";
import {
  collectFiles,
  collectGolden,
  collectWin32Overlay,
  diffFiles,
  expectedGolden,
  extensionRoot,
  outputDirs,
  runBuildOn,
  runTs,
} from "./lib/extension-run.ts";

const GOLDEN = path.resolve(import.meta.dirname, "fixtures", "extension-golden");

describe("build-extension --target all equals the golden tree of the host platform", () => {
  for (const [name, files] of Object.entries(buildSubjects())) {
    test(name, () => {
      const tree = extensionRoot({ [name]: files });
      const run = runTs(tree, "build-extension", ["--target", "all", name]);
      assert.equal(run.status, 0, run.stderr);
      for (const [label, dir] of Object.entries(outputDirs(tree, name))) {
        const golden = expectedGolden(path.join(GOLDEN, name, label), process.platform);
        assert.ok(golden.size > 0, `${name}/${label}: the golden is empty`);
        const built = collectFiles(dir);
        assert.deepEqual(diffFiles(golden, built), [], `${name}/${label}`);
        for (const [rel, bytes] of built) {
          assert.ok(!bytes.includes(13), `${name}/${label}/${rel} holds a carriage return`);
        }
      }
      tree.dispose();
    });
  }
});

const ANTIGRAVITY = "antigravity-plugin";

/** Every `command` of a hook file, in file order. */
function commands(text: string): string[] {
  const file = JSON.parse(text) as Record<
    string,
    Record<string, { hooks: { command: string }[] }[]>
  >;
  return Object.values(file).flatMap((events) =>
    Object.values(events).flatMap((items) =>
      items.flatMap((item) => item.hooks.map((hook) => hook.command)),
    ),
  );
}

describe("build-extension --target all on a win32 build host equals the golden tree plus the overlay", () => {
  for (const [name, files] of Object.entries(buildSubjects())) {
    test(name, async () => {
      const tree = extensionRoot({ [name]: files });
      const run = await runBuildOn(tree, ["--target", "all", name], "win32");
      assert.equal(run.status, 0, run.stderr);
      for (const [label, dir] of Object.entries(outputDirs(tree, name))) {
        const built = collectFiles(dir);
        const base = collectGolden(path.join(GOLDEN, name, label));
        const overlay = collectWin32Overlay(path.join(GOLDEN, name, label));
        // Only the Antigravity plugin's hook file has an overlay, and every other file is the base.
        const expectedOverlay =
          label === ANTIGRAVITY && base.has("hooks.json") ? ["hooks.json"] : [];
        assert.deepEqual([...overlay.keys()], expectedOverlay, `${name}/${label}: overlay set`);
        assert.deepEqual(
          diffFiles(expectedGolden(path.join(GOLDEN, name, label), "win32"), built),
          [],
          `${name}/${label}`,
        );
        const rest = new Map(built);
        for (const rel of overlay.keys()) rest.delete(rel);
        const baseRest = new Map(base);
        for (const rel of overlay.keys()) baseRest.delete(rel);
        assert.deepEqual(diffFiles(baseRest, rest), [], `${name}/${label}: files but the overlay`);
        for (const [rel, bytes] of built) {
          assert.ok(!bytes.includes(13), `${name}/${label}/${rel} holds a carriage return`);
        }
      }
      tree.dispose();
    });

    test(`${name}: the overlay differs from the base golden only by the guarded prefix`, () => {
      const dir = path.join(GOLDEN, name, ANTIGRAVITY);
      const base = collectGolden(dir).get("hooks.json");
      const overlay = collectWin32Overlay(dir).get("hooks.json");
      assert.equal(overlay === undefined, base === undefined, `${name}: overlay iff base`);
      if (base === undefined || overlay === undefined) return;
      const baseText = base.toString("utf8");
      const overlayText = overlay.toString("utf8");
      const baseCommands = commands(baseText);
      assert.ok(baseCommands.length > 0);
      assert.deepEqual(
        commands(overlayText),
        baseCommands.map((command) => `${GUARDED_PREFIX}${command}`),
      );
      assert.equal(overlayText.split(GUARDED_PREFIX).join(""), baseText);
      assert.ok(!baseText.includes(GUARDED_PREFIX), "the base golden is unguarded");
    });
  }

  test("the comparison is strict in both directions", async () => {
    const files = buildSubjects()["hello-world"];
    assert.ok(files !== undefined);
    const dir = path.join(GOLDEN, "hello-world", ANTIGRAVITY);
    const built = new Map<NodeJS.Platform, Map<string, Buffer>>();
    for (const platform of ["win32", "linux"] as const) {
      const tree = extensionRoot({ "hello-world": files });
      const run = await runBuildOn(tree, ["--target", "all", "hello-world"], platform);
      assert.equal(run.status, 0, run.stderr);
      built.set(platform, collectFiles(outputDirs(tree, "hello-world")[ANTIGRAVITY] ?? ""));
      tree.dispose();
    }
    const win = built.get("win32") ?? new Map<string, Buffer>();
    const lin = built.get("linux") ?? new Map<string, Buffer>();
    // The two builds differ in the hook file alone.
    assert.deepEqual(diffFiles(lin, win), ["differs: hooks.json"]);
    assert.deepEqual(diffFiles(expectedGolden(dir, "linux"), lin), []);
    assert.deepEqual(diffFiles(expectedGolden(dir, "win32"), win), []);
    // A win32 run that still writes the unguarded line, or a non-win32 run that writes the guarded
    // one, is not equal to the golden its platform selects.
    assert.deepEqual(diffFiles(expectedGolden(dir, "win32"), lin), ["differs: hooks.json"]);
    assert.deepEqual(diffFiles(expectedGolden(dir, "darwin"), win), ["differs: hooks.json"]);
  });
});
