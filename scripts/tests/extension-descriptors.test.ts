// extension-descriptors.test.ts — the typed descriptor readers against the real descriptors (spec 0254 R8).

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";

import {
  mcpDeliveryOf,
  readGeneratedClass,
  readLegacyShape,
  readPerCliKeys,
  readTargetTable,
} from "../lib/extension/descriptors.ts";
import { ExtError, TARGETS } from "../lib/extension/types.ts";

const LIB = path.resolve(import.meta.dirname, "../lib");
const scratch: string[] = [];

function libWith(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ext-desc-"));
  scratch.push(dir);
  for (const [name, text] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), text);
  return dir;
}

after(() => {
  for (const dir of scratch) fs.rmSync(dir, { recursive: true, force: true });
});

describe("readTargetTable", () => {
  it("has the four targets and no _readme row", () => {
    const table = readTargetTable(LIB);
    assert.deepEqual(Object.keys(table), [...TARGETS]);
  });

  it("renders every column as text and mcpDelivery as a boolean, like the real file", () => {
    const raw = JSON.parse(fs.readFileSync(path.join(LIB, "extension-targets.json"), "utf8"));
    const table = readTargetTable(LIB);
    for (const target of TARGETS) {
      const row = raw[target];
      assert.equal(table[target].shellTool, row.shellTool ?? "");
      assert.equal(table[target].rootToken, row.rootToken ?? "");
      assert.equal(table[target].hookFile, row.hookFile ?? "");
      assert.equal(table[target].displayName, row.displayName ?? "");
      assert.equal(table[target].contextOutput, row.contextOutput ?? "");
      assert.equal(table[target].mcpDelivery, row.mcpDelivery === true);
    }
  });

  it("reads absent, null and false columns as empty text, and a missing row as empty", () => {
    const lib = libWith({
      "extension-targets.json": JSON.stringify({
        _readme: "x",
        gemini: { shellTool: "run", rootToken: null, hookFile: false, mcpDelivery: true },
        claude: "not a row",
      }),
    });
    const table = readTargetTable(lib);
    assert.equal(table.gemini.shellTool, "run");
    assert.equal(table.gemini.rootToken, "");
    assert.equal(table.gemini.hookFile, "");
    assert.equal(table.gemini.mcpDelivery, true);
    assert.deepEqual(table.claude, { ...table.copilot });
    assert.equal(table.claude.mcpDelivery, false);
    assert.equal(table.copilot.shellTool, "");
  });

  it("throws an ExtError on a malformed file", () => {
    const lib = libWith({ "extension-targets.json": "{" });
    assert.throws(() => readTargetTable(lib), ExtError);
  });
});

describe("mcpDeliveryOf", () => {
  it("is fail-closed", () => {
    assert.equal(mcpDeliveryOf(libWith({}), "gemini"), false);
    assert.equal(mcpDeliveryOf(libWith({ "extension-targets.json": "nope" }), "gemini"), false);
    assert.equal(
      mcpDeliveryOf(
        libWith({ "extension-targets.json": '{"gemini":{"mcpDelivery":"true"}}' }),
        "gemini",
      ),
      false,
    );
    assert.equal(
      mcpDeliveryOf(
        libWith({ "extension-targets.json": '{"gemini":{"mcpDelivery":true}}' }),
        "gemini",
      ),
      true,
    );
  });

  it("agrees with the real table", () => {
    const table = readTargetTable(LIB);
    for (const target of TARGETS)
      assert.equal(mcpDeliveryOf(LIB, target), table[target].mcpDelivery);
  });
});

describe("readPerCliKeys", () => {
  it("lists the key of every real row, in file order", () => {
    const raw = JSON.parse(fs.readFileSync(path.join(LIB, "extension-percli-keys.json"), "utf8"));
    assert.deepEqual(
      readPerCliKeys(LIB),
      raw.map((row: { key: string }) => row.key),
    );
    assert.ok(readPerCliKeys(LIB).includes("claude.author"));
  });

  it("admits nothing from a missing or malformed file, and skips rows without a string key", () => {
    assert.deepEqual(readPerCliKeys(libWith({})), []);
    assert.deepEqual(readPerCliKeys(libWith({ "extension-percli-keys.json": "{}" })), []);
    assert.deepEqual(
      readPerCliKeys(libWith({ "extension-percli-keys.json": '[{"key":"a.b"},{"key":3},"x"]' })),
      ["a.b"],
    );
  });
});

describe("readGeneratedClass", () => {
  it("reads the real class", () => {
    const cls = readGeneratedClass(LIB);
    assert.ok(cls.manifestClass.includes("GEMINI.md"));
    assert.ok(cls.generatedGlobs.includes("commands/*.toml"));
  });
});

describe("readLegacyShape", () => {
  it("reads the real enumeration", () => {
    const result = readLegacyShape(LIB);
    assert.equal(result.kind, "ok");
    if (result.kind === "ok") {
      assert.equal(result.shape.componentsKey, "components");
      assert.deepEqual(result.shape.componentsSubjects, ["commands", "skills", "agents", "hooks"]);
      assert.equal(result.shape.perCliKeys.length, 5);
    }
  });

  it("says missing for an absent file and malformed for the rest", () => {
    assert.equal(readLegacyShape(libWith({})).kind, "missing");
    for (const text of [
      "{",
      "[]",
      '{"componentsKey":1,"componentsSubjects":[],"perCliKeys":[]}',
      '{"componentsKey":"c","componentsSubjects":"x","perCliKeys":[]}',
      '{"componentsKey":"c","componentsSubjects":[],"perCliKeys":[1]}',
    ]) {
      assert.equal(
        readLegacyShape(libWith({ "extension-legacy-shape.json": text })).kind,
        "malformed",
        text,
      );
    }
  });
});
