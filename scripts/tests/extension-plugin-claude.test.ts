// extension-plugin-claude.test.ts — the Claude Code plugin renderer (spec 0254 R11, R17, R18):
// the whole output tree and the printed lines over throwaway extension trees.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";

import { buildClaudePlugin } from "../lib/extension/plugin-claude.ts";
import { fullExtension, makeCtx, readTree, tmpRoot, writeTree } from "./lib/plugin-ctx.ts";

function build(files: Record<string, string>, outArg?: string) {
  const root = tmpRoot();
  const repo = path.join(root, "repo");
  const ext = path.join(root, "ext");
  fs.mkdirSync(repo);
  writeTree(ext, files);
  const cap = makeCtx(repo);
  const out = outArg ?? path.join(root, "out");
  const status = buildClaudePlugin(cap.ctx, ext, out);
  return { status, cap, ext, out };
}

function cleanContext(): Record<string, string> {
  const files = fullExtension();
  files["CONTEXT.md"] = "# ${TOOL} demo\nUse ${COMMAND:greet} and ${SKILL:helper}.\n";
  return files;
}

describe("buildClaudePlugin", () => {
  test("a full extension: tree, messages and exit status", () => {
    const { status, cap, ext, out } = build(cleanContext());
    assert.equal(status, 0);
    assert.deepEqual(cap.out, [
      "Building Claude Code plugin: demo v1.2.3",
      `  Source: ${ext}`,
      `  Output: ${out}`,
      "  Generated: .claude-plugin/plugin.json",
      "  Generated: .mcp.json",
      "  Copied: dist/",
      "  Copied: package.json",
      "  Rendered: CLAUDE.md",
      "  Copied skill: helper",
      "  Rendered command to skill: greet",
      "  Rendered command to skill: plain",
      "  Copied agent: flat",
      "  Copied agent (flattened): nested",
      "  Copied: hooks/",
      "  Generated: settings.json",
      "  Generated: .lsp.json",
      "  Copied: bin/",
      "",
      `Plugin built: ${out}`,
      `Test with: claude --plugin-dir ${out}`,
    ]);
    assert.deepEqual(cap.err, []);
    assert.deepEqual(Object.keys(readTree(out)).sort(), [
      ".claude-plugin/",
      ".claude-plugin/plugin.json",
      ".lsp.json",
      ".mcp.json",
      "CLAUDE.md",
      "agents/",
      "agents/flat.md",
      "agents/nested.md",
      "bin/",
      "bin/tool",
      "dist/",
      "dist/index.js",
      "hooks/",
      "hooks/h.sh",
      "package.json",
      "settings.json",
      "skills/",
      "skills/greet/",
      "skills/greet/SKILL.md",
      "skills/helper/",
      "skills/helper/SKILL.md",
      "skills/helper/extra/",
      "skills/helper/extra/note.txt",
      "skills/plain/",
      "skills/plain/SKILL.md",
    ]);
  });

  test("plugin.json carries the author with the Unknown default and the metadata", () => {
    const { out } = build(cleanContext());
    assert.equal(
      fs.readFileSync(path.join(out, ".claude-plugin", "plugin.json"), "utf8"),
      '{\n  "name": "demo",\n  "description": "A demo extension",\n  "version": "1.2.3",\n  "author": {\n    "name": "Ada"\n  }\n}\n',
    );
    const bare = build({
      "extension.json": JSON.stringify({ name: "b", version: "0.1.0", description: "x" }),
    });
    assert.match(
      fs.readFileSync(path.join(bare.out, ".claude-plugin", "plugin.json"), "utf8"),
      /"author": \{\n {4}"name": "Unknown"/,
    );
  });

  test("agents are flattened and sibling files never travel", () => {
    const { out } = build(cleanContext());
    assert.equal(fs.readFileSync(path.join(out, "agents", "nested.md"), "utf8"), "nested agent\n");
    assert.ok(!fs.existsSync(path.join(out, "agents", "PROMPT.md")));
    assert.ok(!fs.existsSync(path.join(out, "agents", "nested")));
  });

  test("settings and lsp are written as jq prints them", () => {
    const { out } = build(cleanContext());
    assert.equal(
      fs.readFileSync(path.join(out, "settings.json"), "utf8"),
      '{\n  "permissions": {\n    "allow": [\n      "Read"\n    ]\n  }\n}\n',
    );
    assert.equal(
      fs.readFileSync(path.join(out, ".lsp.json"), "utf8"),
      '{\n  "ts": {\n    "command": "tsserver"\n  }\n}\n',
    );
  });

  test("a context diagnostic fails with status 1 and no context file", () => {
    const { status, cap, out } = build(fullExtension());
    assert.equal(status, 1);
    assert.equal(cap.err.at(-1), "Error: rendering context for target 'claude' failed");
    assert.ok(!fs.existsSync(path.join(out, "CLAUDE.md")));
    assert.ok(!cap.out.some((l) => l.startsWith("Plugin built")));
  });

  test("a bare extension writes only plugin.json", () => {
    const { status, cap, out } = build({
      "extension.json": JSON.stringify({
        name: "b",
        version: "0.1.0",
        description: "x",
        claude: { settings: {}, lsp: null },
      }),
    });
    assert.equal(status, 0);
    assert.deepEqual(Object.keys(readTree(out)), [".claude-plugin/", ".claude-plugin/plugin.json"]);
    assert.equal(cap.out.length, 7);
  });

  test("a resolution failure returns 1 and prints on stdout", () => {
    const root = tmpRoot();
    const cap = makeCtx(root);
    assert.equal(buildClaudePlugin(cap.ctx, "no-such-extension-zz", undefined), 1);
    assert.deepEqual(cap.out, [
      "Error: extension directory or name 'no-such-extension-zz' not found.",
    ]);
  });
});
