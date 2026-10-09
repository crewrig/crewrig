// extension-plugin-copilot.test.ts — the Copilot CLI plugin renderer (spec 0254 R11, R17, R18):
// the whole output tree and the printed lines over throwaway extension trees.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";

import { buildCopilotPlugin } from "../lib/extension/plugin-copilot.ts";
import { fullExtension, makeCtx, readTree, tmpRoot, writeTree } from "./lib/plugin-ctx.ts";

function build(files: Record<string, string>, outArg?: string) {
  const root = tmpRoot();
  const repo = path.join(root, "repo");
  const ext = path.join(root, "ext");
  fs.mkdirSync(repo);
  writeTree(ext, files);
  const cap = makeCtx(repo);
  const out = outArg ?? path.join(root, "out");
  const status = buildCopilotPlugin(cap.ctx, ext, out);
  return { status, cap, ext, out, repo };
}

function cleanContext(): Record<string, string> {
  const files = fullExtension();
  files["CONTEXT.md"] = "# ${TOOL} demo\nUse ${COMMAND:greet} and ${SKILL:helper}.\n";
  return files;
}

describe("buildCopilotPlugin", () => {
  test("a full extension: tree, messages and exit status", () => {
    const { status, cap, ext, out } = build(cleanContext());
    assert.equal(status, 0);
    assert.deepEqual(cap.out, [
      "Building Copilot CLI plugin: demo v1.2.3",
      `  Source: ${ext}`,
      `  Output: ${out}`,
      "  Generated: plugin.json (name: demo)",
      "  Generated: .mcp.json",
      "  Copied: dist/",
      "  Copied: package.json",
      "  Rendered: skills/demo-context/SKILL.md",
      "  Copied skill: helper",
      "  Rendered command to skill: greet",
      "  Rendered command to skill: plain",
      "  Copied agent (flattened): nested",
      "  Copied: hooks/",
      "",
      `Plugin built: ${out}`,
      `Install with: copilot plugin install ${out}`,
    ]);
    assert.deepEqual(cap.err, []);
    assert.deepEqual(Object.keys(readTree(out)).sort(), [
      ".mcp.json",
      "agents/",
      "agents/nested.agent.md",
      "dist/",
      "dist/index.js",
      "hooks/",
      "hooks/h.sh",
      "package.json",
      "plugin.json",
      "skills/",
      "skills/demo-context/",
      "skills/demo-context/SKILL.md",
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

  test("plugin.json, the context skill and a command skill carry the exact text", () => {
    const { out } = build(cleanContext());
    assert.equal(
      fs.readFileSync(path.join(out, "plugin.json"), "utf8"),
      '{\n  "name": "demo",\n  "version": "1.2.3",\n  "description": "A demo extension"\n}\n',
    );
    const context = fs.readFileSync(path.join(out, "skills", "demo-context", "SKILL.md"), "utf8");
    assert.ok(
      context.startsWith(
        '---\nname: demo-context\ndescription: "Agent-facing context for the demo extension."\nuser-invocable: true\n---\n\n',
      ),
    );
    assert.ok(context.endsWith("\n") && !context.endsWith("\n\n"));
    assert.equal(
      fs.readFileSync(path.join(out, "skills", "greet", "SKILL.md"), "utf8"),
      '---\nname: greet\ndescription: "Say hello"\nuser-invocable: true\n---\n\nHello body\n',
    );
  });

  test("agents are flattened to .agent.md; loose files and siblings never travel", () => {
    const { out } = build(cleanContext());
    assert.equal(
      fs.readFileSync(path.join(out, "agents", "nested.agent.md"), "utf8"),
      "nested agent\n",
    );
    assert.ok(!fs.existsSync(path.join(out, "agents", "flat.agent.md")));
    assert.ok(!fs.existsSync(path.join(out, "agents", "PROMPT.md")));
  });

  test("an agent directory without AGENT.md ends the build with status 1, silently", () => {
    const files = cleanContext();
    files["agents/aaa/notes.txt"] = "no agent file\n";
    const { status, cap, out } = build(files);
    assert.equal(status, 1);
    assert.equal(cap.out.at(-1), "  Rendered command to skill: plain");
    assert.deepEqual(cap.err, []);
    assert.ok(!cap.out.some((l) => l.startsWith("Plugin built")));
    assert.ok(fs.existsSync(path.join(out, "agents")));
    assert.ok(!fs.existsSync(path.join(out, "hooks")));
  });

  test("a context diagnostic fails with status 1", () => {
    const { status, cap, out } = build(fullExtension());
    assert.equal(status, 1);
    // The shell exits silently after the diagnostics (a command substitution under `set -e`).
    assert.ok(cap.err.length > 0 && cap.err.every((l) => !l.startsWith("Error:")));
    assert.ok(!fs.existsSync(path.join(out, "skills", "demo-context", "SKILL.md")));
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
    assert.equal(buildCopilotPlugin(cap.ctx, ext, undefined), 0);
    assert.ok(fs.existsSync(path.join(repo, "dist-copilot-plugin", "b", "plugin.json")));
  });

  test("a resolution failure returns 1 and prints on stdout", () => {
    const cap = makeCtx(tmpRoot());
    assert.equal(buildCopilotPlugin(cap.ctx, "no-such-extension-zz", undefined), 1);
    assert.deepEqual(cap.out, [
      "Error: extension directory or name 'no-such-extension-zz' not found.",
    ]);
  });
});
