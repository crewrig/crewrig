// extension-render-gemini.test.ts — the Gemini render of `build-extension` (spec 0254 R14, R17):
// the built tree, the printed lines and the exit status over the shared extension trees.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";

import { createGapChannel } from "../lib/extension/gap-record.ts";
import { renderGemini } from "../lib/extension/gemini-render.ts";
import { readManifest } from "../lib/extension/manifest.ts";
import {
  contextFailTree,
  fullTree,
  minimalTree,
  writeTree,
  type FileMap,
} from "./lib/extension-trees.ts";
import { makeCtx, readTree, tmpRoot } from "./lib/plugin-ctx.ts";

function render(files: FileMap, name: string) {
  const root = tmpRoot();
  const repo = path.join(root, "repo");
  const ext = path.join(root, "ext");
  fs.mkdirSync(repo);
  writeTree(ext, files);
  const cap = makeCtx(repo);
  const gaps = createGapChannel();
  const manifest = readManifest(path.join(ext, "extension.json"));
  const status = renderGemini(cap.ctx, ext, manifest, name, gaps);
  const build = path.join(repo, "build", "extensions", name);
  return { status, cap, gaps, ext, build };
}

describe("renderGemini", () => {
  test("the smallest extension: only the Gemini manifest", () => {
    const { status, cap, build } = render(minimalTree(), "minimal");
    assert.equal(status, 0);
    assert.deepEqual(cap.out, ["  Rendered: build/extensions/minimal/gemini-extension.json"]);
    assert.deepEqual(cap.err, []);
    assert.equal(
      fs.readFileSync(path.join(build, "gemini-extension.json"), "utf8"),
      '{\n  "name": "minimal",\n  "version": "0.0.1",\n  "description": "Minimal"\n}\n',
    );
  });

  test("a full extension: manifest keys, context, commands, hooks and gaps", () => {
    const { status, cap, gaps, ext, build } = render(fullTree(), "full");
    assert.equal(status, 0);
    const prefix = "  Rendered: build/extensions/full/";
    assert.deepEqual(cap.out, [
      `${prefix}gemini-extension.json`,
      `${prefix}GEMINI.md`,
      `${prefix}commands/hello.toml`,
      `${prefix}commands/second.toml`,
    ]);
    assert.equal(cap.err.length, 2);
    assert.match(cap.err[0] ?? "", /CONTEXT\.md:6 — '\$\{NEARMISS\}' has the shape/);
    assert.equal(cap.err[1], `Warning: ${ext}/commands/nameless.md missing 'name' field, skipping`);
    assert.deepEqual(gaps.gaps, []);

    const manifest = JSON.parse(
      fs.readFileSync(path.join(build, "gemini-extension.json"), "utf8"),
    ) as Record<string, unknown> & {
      hooks?: Record<string, unknown>;
      contextFileName?: unknown;
      mcpServers?: Record<string, { cwd?: string }>;
      themes?: unknown;
    };
    assert.deepEqual(Object.keys(manifest), [
      "name",
      "version",
      "description",
      "contextFileName",
      "mcpServers",
      "themes",
    ]);
    assert.equal(manifest.contextFileName, "GEMINI.md");
    assert.equal(manifest.mcpServers?.["local"]?.cwd, "${extensionPath}");
    assert.deepEqual(manifest.themes, [{ name: "dark", background: "#000" }]);

    const toml = fs.readFileSync(path.join(build, "commands", "hello.toml"), "utf8");
    assert.match(toml, /^description = "Say hello"\n\nprompt = """\n/);
    assert.ok(toml.endsWith('"""\n') && !toml.endsWith("\n\n"));
    assert.match(
      fs.readFileSync(path.join(build, "GEMINI.md"), "utf8"),
      /Only on Claude and Gemini\./,
    );

    const hooks = JSON.parse(
      fs.readFileSync(path.join(build, "hooks", "hooks.json"), "utf8"),
    ) as Record<string, unknown> & {
      hooks?: Record<string, unknown>;
      contextFileName?: unknown;
      mcpServers?: Record<string, { cwd?: string }>;
      themes?: unknown;
    };
    assert.ok(hooks.hooks !== undefined);
  });

  test("source strays are stripped, release debris and the nameless command leave no file", () => {
    const files: Record<string, string> = {
      ...fullTree(),
      "gemini-extension.json": "{}\n",
      "GEMINI.md": "stray\n",
    };
    const { build } = render(files, "full");
    const tree = readTree(build);
    assert.equal(tree[".releaserc.json"], undefined);
    assert.equal(tree["commands/nameless.toml"], undefined);
    assert.ok(tree["commands/hello.md"] !== undefined, "the verbatim copy keeps the sources");
    assert.notEqual(tree["gemini-extension.json"], "{}\n");
    assert.notEqual(tree["GEMINI.md"], "stray\n");
  });

  test("a build directory left over from a previous run is emptied first", () => {
    const root = tmpRoot();
    const repo = path.join(root, "repo");
    const ext = path.join(root, "ext");
    writeTree(ext, minimalTree());
    writeTree(path.join(repo, "build", "extensions", "minimal"), { "old.txt": "old\n" });
    const cap = makeCtx(repo);
    const manifest = readManifest(path.join(ext, "extension.json"));
    renderGemini(cap.ctx, ext, manifest, "minimal", createGapChannel());
    assert.equal(
      fs.existsSync(path.join(repo, "build", "extensions", "minimal", "old.txt")),
      false,
    );
  });

  test("a context failure: diagnostics on stderr, status 1, no context file, no contextFileName", () => {
    const { status, cap, build } = render(contextFailTree(), "ctxfail");
    assert.equal(status, 1);
    assert.deepEqual(cap.out, ["  Rendered: build/extensions/ctxfail/gemini-extension.json"]);
    assert.ok(cap.err.length > 0);
    assert.equal(fs.existsSync(path.join(build, "GEMINI.md")), false);
    const manifest = JSON.parse(
      fs.readFileSync(path.join(build, "gemini-extension.json"), "utf8"),
    ) as Record<string, unknown> & {
      hooks?: Record<string, unknown>;
      contextFileName?: unknown;
      mcpServers?: Record<string, { cwd?: string }>;
      themes?: unknown;
    };
    assert.equal(manifest.contextFileName, "GEMINI.md");
  });
});
