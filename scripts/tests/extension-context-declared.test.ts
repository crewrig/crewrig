// extension-context-declared.test.ts — declared command and skill names (spec 0254 R16).
// Twins `_render_context_declared_commands/skills` (scripts/lib/render-context.sh:161-184).

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, test } from "node:test";

import { declaredCommands, declaredSkills } from "../lib/extension/context-declared.ts";
import { parseJson } from "../lib/extension/json-ordered.ts";
import type { RenderCommand } from "../lib/render-command.ts";

function manifest(json: unknown): Map<string, import("../lib/extension/types.ts").JsonValue> {
  const m = parseJson(JSON.stringify(json), "m.json");
  assert.ok(m instanceof Map);
  return m;
}

/** A renderer whose `yamlField` reads `name: <x>` from the first lines of the file. */
const renderCommand = {
  yamlField(file: string, field: string): string {
    const m = new RegExp(`^${field}: (.*)$`, "m").exec(fs.readFileSync(file, "utf8"));
    return m?.[1] ?? "";
  },
} as unknown as RenderCommand;

function tree(files: Record<string, string>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ext-declared-"));
  for (const [rel, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), text);
  }
  return root;
}

describe("declaredCommands", () => {
  const root = tree({
    "commands/b.md": "name: bee\n",
    "commands/a.md": "name: ay\n",
    "commands/none.md": "description: x\n",
    "commands/nul.md": "name: null\n",
    "commands/.hidden.md": "name: hid\n",
    "commands/note.txt": "name: txt\n",
    "commands/dir.md/x": "",
    "alt/c.md": "name: cee\n",
  });
  test("names in file code-unit order; empty, null, dotfiles and non-md skipped", () => {
    assert.deepEqual(declaredCommands(manifest({ commands: {} }), root, renderCommand), [
      "ay",
      "bee",
    ]);
  });
  test("location overrides the default and a trailing slash is stripped", () => {
    assert.deepEqual(
      declaredCommands(manifest({ commands: { location: "alt/" } }), root, renderCommand),
      ["cee"],
    );
    assert.deepEqual(
      declaredCommands(manifest({ commands: { location: "alt" } }), root, renderCommand),
      ["cee"],
    );
  });
  test("subject absent, null or directory missing: nothing", () => {
    assert.deepEqual(declaredCommands(manifest({}), root, renderCommand), []);
    assert.deepEqual(declaredCommands(manifest({ commands: null }), root, renderCommand), []);
    assert.deepEqual(
      declaredCommands(manifest({ commands: { location: "gone" } }), root, renderCommand),
      [],
    );
  });
});

describe("declaredSkills", () => {
  const root = tree({
    "skills/zeta/SKILL.md": "",
    "skills/alpha/SKILL.md": "",
    "skills/.dot/SKILL.md": "",
    "skills/file.md": "",
    "other/one/x": "",
  });
  test("subdirectory names in code-unit order; files and dotdirs skipped", () => {
    assert.deepEqual(declaredSkills(manifest({ skills: {} }), root), ["alpha", "zeta"]);
  });
  test("location and absent subject", () => {
    assert.deepEqual(declaredSkills(manifest({ skills: { location: "other/" } }), root), ["one"]);
    assert.deepEqual(declaredSkills(manifest({}), root), []);
    assert.deepEqual(declaredSkills(manifest({ skills: { location: "gone" } }), root), []);
  });
});
