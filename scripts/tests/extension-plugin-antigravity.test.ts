// extension-plugin-antigravity.test.ts — the Antigravity CLI plugin renderer (spec 0254 R11, R17,
// R18): the whole output tree and the printed lines over throwaway extension trees.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";

import { buildAntigravityPlugin } from "../lib/extension/plugin-antigravity.ts";
import { fullExtension, makeCtx, readTree, tmpRoot, writeTree } from "./lib/plugin-ctx.ts";

function build(files: Record<string, string>, outArg?: string) {
  const root = tmpRoot();
  const repo = path.join(root, "repo");
  const ext = path.join(root, "ext");
  fs.mkdirSync(repo);
  writeTree(ext, files);
  const cap = makeCtx(repo);
  const out = outArg ?? path.join(root, "out");
  const status = buildAntigravityPlugin(cap.ctx, ext, out);
  return { status, cap, ext, out, repo };
}

function cleanContext(): Record<string, string> {
  const files = fullExtension();
  files["CONTEXT.md"] = "# ${TOOL} demo\nUse ${COMMAND:greet} and ${SKILL:helper}.\n";
  return files;
}

describe("buildAntigravityPlugin", () => {
  test("a full extension: tree, messages and exit status", () => {
    const { status, cap, ext, out } = build(cleanContext());
    assert.equal(status, 0);
    assert.deepEqual(cap.out, [
      "Building Antigravity CLI plugin: demo v1.2.3",
      `  Source: ${ext}`,
      `  Output: ${out}`,
      "  Generated: plugin.json (name: demo)",
      "  Generated: mcp_config.json",
      "  Copied: dist/",
      "  Copied: package.json",
      "  Rendered: rules/AGENTS.md",
      "  Copied skill: helper",
      "  Rendered command to skill: greet",
      "  Rendered command to skill: plain",
      "  Copied agent: nested",
      "  Copied: hooks/",
      "",
      `Plugin built: ${out}`,
      `Validate with: agy plugin validate ${out}`,
    ]);
    assert.deepEqual(cap.err, []);
    assert.deepEqual(Object.keys(readTree(out)).sort(), [
      "agents/",
      "agents/nested/",
      "agents/nested/AGENT.md",
      "agents/nested/PROMPT.md",
      "dist/",
      "dist/index.js",
      "hooks/",
      "hooks/h.sh",
      "mcp_config.json",
      "package.json",
      "plugin.json",
      "rules/",
      "rules/AGENTS.md",
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

  test("plugin.json and the MCP file keep the neutral extension root unresolved", () => {
    const { out } = build(cleanContext());
    assert.equal(
      fs.readFileSync(path.join(out, "plugin.json"), "utf8"),
      '{\n  "name": "demo",\n  "version": "1.2.3",\n  "description": "A demo extension"\n}\n',
    );
    assert.match(
      fs.readFileSync(path.join(out, "mcp_config.json"), "utf8"),
      /\$\{extensionRoot\}\/dist\/index\.js/,
    );
  });

  test("agent directories are copied whole; loose files are skipped", () => {
    const { out } = build(cleanContext());
    assert.equal(
      fs.readFileSync(path.join(out, "agents", "nested", "PROMPT.md"), "utf8"),
      "sibling\n",
    );
    assert.ok(!fs.existsSync(path.join(out, "agents", "flat.md")));
  });

  test("the context is written raw to rules/AGENTS.md", () => {
    const { out } = build(cleanContext());
    const text = fs.readFileSync(path.join(out, "rules", "AGENTS.md"), "utf8");
    assert.ok(!text.startsWith("---"));
    assert.ok(text.endsWith("\n"));
  });

  test("a context diagnostic fails with status 1 and no context file", () => {
    const { status, cap, out } = build(fullExtension());
    assert.equal(status, 1);
    assert.equal(cap.err.at(-1), "Error: rendering context for target 'antigravity' failed");
    assert.ok(!fs.existsSync(path.join(out, "rules")));
    assert.ok(!cap.out.some((l) => l.startsWith("Plugin built")));
  });

  test("a bare extension writes only plugin.json", () => {
    const { status, cap, out } = build({
      "extension.json": JSON.stringify({ name: "b", version: "0.1.0", description: "x" }),
    });
    assert.equal(status, 0);
    assert.deepEqual(Object.keys(readTree(out)), ["plugin.json"]);
    assert.equal(cap.out.length, 7);
  });

  test("the default output directory is under the repository root", () => {
    const root = tmpRoot();
    const repo = path.join(root, "repo");
    const ext = path.join(root, "ext");
    fs.mkdirSync(repo);
    writeTree(ext, {
      "extension.json": JSON.stringify({ name: "b", version: "0.1.0", description: "x" }),
    });
    const cap = makeCtx(repo);
    assert.equal(buildAntigravityPlugin(cap.ctx, ext, undefined), 0);
    assert.ok(fs.existsSync(path.join(repo, "dist-antigravity-plugin", "b", "plugin.json")));
  });

  test("a resolution failure returns 1 and prints on stdout", () => {
    const cap = makeCtx(tmpRoot());
    assert.equal(buildAntigravityPlugin(cap.ctx, "no-such-extension-zz", undefined), 1);
    assert.deepEqual(cap.out, [
      "Error: extension directory or name 'no-such-extension-zz' not found.",
    ]);
  });
});
