// extension-shape-guard.test.ts — the retired-shape guard, twin of ext_assert_current_shape (spec 0254 R8).

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";

import { assertCurrentShape, detectShape } from "../lib/extension/shape-guard.ts";
import { readLegacyShape } from "../lib/extension/descriptors.ts";
import type { Manifest } from "../lib/extension/manifest.ts";
import { parseJson } from "../lib/extension/json-ordered.ts";

const LIB = path.resolve(import.meta.dirname, "../lib");
const scratch: string[] = [];
const TAIL = "run scripts/migrate-extension.sh, see docs/adoption-guide.md";

function manifestOf(value: unknown): Manifest {
  return parseJson(JSON.stringify(value), "m.json") as Manifest;
}

after(() => {
  for (const dir of scratch) fs.rmSync(dir, { recursive: true, force: true });
});

describe("assertCurrentShape", () => {
  it("is silent for a current manifest", () => {
    assert.deepEqual(assertCurrentShape("m.json", manifestOf({ name: "x", claude: {} }), LIB), []);
    assert.deepEqual(assertCurrentShape("m.json", manifestOf({ components: null }), LIB), []);
  });

  it("names the retired components object, with the shell's empty subjects clause", () => {
    const m = manifestOf({ components: { hooks: {}, commands: {}, other: 1 } });
    assert.deepEqual(assertCurrentShape("m.json", m, LIB), [
      `VALIDATION-ERROR: m.json — declares the retired 'components' object  — ${TAIL}`,
    ]);
  });

  it("keeps the shell's double space when no subject is listed", () => {
    assert.deepEqual(assertCurrentShape("m.json", manifestOf({ components: {} }), LIB), [
      `VALIDATION-ERROR: m.json — declares the retired 'components' object  — ${TAIL}`,
    ]);
    assert.equal(assertCurrentShape("m.json", manifestOf({ components: "x" }), LIB).length, 1);
    assert.equal(assertCurrentShape("m.json", manifestOf({ components: false }), LIB).length, 1);
  });

  it("lists every retired per-CLI key in enumeration order, after the components line", () => {
    const m = manifestOf({
      copilot: { pluginName: "p" },
      claude: { rules: 1, skills: 2 },
      components: { agents: {} },
    });
    assert.deepEqual(assertCurrentShape("m.json", m, LIB), [
      `VALIDATION-ERROR: m.json — declares the retired 'components' object  — ${TAIL}`,
      `VALIDATION-ERROR: m.json — declares the retired per-CLI key 'claude.skills' — ${TAIL}`,
      `VALIDATION-ERROR: m.json — declares the retired per-CLI key 'claude.rules' — ${TAIL}`,
      `VALIDATION-ERROR: m.json — declares the retired per-CLI key 'copilot.pluginName' — ${TAIL}`,
    ]);
  });

  it("ignores a per-CLI section that is not an object", () => {
    assert.deepEqual(
      assertCurrentShape("m.json", manifestOf({ claude: "skills", copilot: null }), LIB),
      [],
    );
  });

  it("fails closed, with the one shell message, on a missing or malformed enumeration", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ext-shape-"));
    scratch.push(dir);
    const expected = `VALIDATION-ERROR: m.json — legacy-shape enumeration not found at ${dir}/extension-legacy-shape.json (spec 0183 R12)`;
    assert.deepEqual(assertCurrentShape("m.json", manifestOf({}), dir), [expected]);
    fs.writeFileSync(path.join(dir, "extension-legacy-shape.json"), "{ nope");
    assert.deepEqual(assertCurrentShape("m.json", manifestOf({ components: {} }), dir), [expected]);
  });
});

describe("detectShape", () => {
  it("reports the detection for the migration tool", () => {
    const result = readLegacyShape(LIB);
    assert.equal(result.kind, "ok");
    if (result.kind !== "ok") return;
    const m = manifestOf({
      components: { skills: 1 },
      antigravity: { pluginName: "x" },
      claude: { agents: 1 },
    });
    assert.deepEqual(detectShape(m, result.shape), {
      hasComponents: true,
      componentsSubjects: ["skills"],
      perCliHits: ["claude.agents", "antigravity.pluginName"],
    });
    assert.deepEqual(detectShape(manifestOf({}), result.shape), {
      hasComponents: false,
      componentsSubjects: [],
      perCliHits: [],
    });
  });
});
