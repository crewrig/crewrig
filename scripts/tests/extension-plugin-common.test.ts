// extension-plugin-common.test.ts — the part shared by the plugin renderers (spec 0254 R11, R17,
// R18): the start, the MCP file, the context shapes, the skills copy, the commands-to-skills renderer.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";

import {
  convertToSkills,
  copyHooks,
  copySkills,
  emitContext,
  emitMcp,
  startPlugin,
} from "../lib/extension/plugin-common.ts";
import { makeCtx, readTree, tmpRoot, writeTree, fullExtension } from "./lib/plugin-ctx.ts";

function setup(files: Record<string, string>) {
  const root = tmpRoot();
  const repo = path.join(root, "repo");
  const ext = path.join(root, "ext");
  fs.mkdirSync(repo);
  writeTree(ext, files);
  const cap = makeCtx(repo);
  return { root, repo, ext, cap, out: path.join(root, "out") };
}

describe("startPlugin", () => {
  test("prints a resolution failure on stdout and returns null", () => {
    const { cap } = setup({});
    assert.equal(startPlugin(cap.ctx, "claude", "no-such-ext-zz", undefined), null);
    assert.deepEqual(cap.out, ["Error: extension directory or name 'no-such-ext-zz' not found."]);
    assert.deepEqual(cap.err, []);
  });

  test("a missing extension.json names the migration tool on stdout", () => {
    const { cap, ext } = setup({ "x.txt": "" });
    assert.equal(startPlugin(cap.ctx, "claude", ext, undefined), null);
    assert.equal(
      cap.out[0],
      `Error: No extension.json found in ${ext} — run scripts/migrate-extension.sh if this is an old-shape extension (see docs/adoption-guide.md).`,
    );
  });

  test("the shape guard prints on stderr and returns null", () => {
    const { cap, ext } = setup({
      "extension.json": JSON.stringify({ name: "a", version: "1", components: { skills: {} } }),
    });
    assert.equal(startPlugin(cap.ctx, "copilot", ext, undefined), null);
    assert.deepEqual(cap.out, []);
    assert.match(cap.err[0] ?? "", /^VALIDATION-ERROR: .*retired 'components' object/);
  });

  test("resets the output directory and prints the banner", () => {
    const { cap, ext, out } = setup({
      "extension.json": JSON.stringify({ name: "demo", version: "1.0.0", description: "d" }),
    });
    writeTree(out, { "stale.txt": "old" });
    const plan = startPlugin(cap.ctx, "antigravity", ext, out);
    assert.ok(plan);
    assert.deepEqual(readTree(out), {});
    assert.deepEqual(cap.out, [
      "Building Antigravity CLI plugin: demo v1.0.0",
      `  Source: ${ext}`,
      `  Output: ${out}`,
    ]);
  });

  test("the per-target default output directories", () => {
    const { cap, ext, repo } = setup({
      "extension.json": JSON.stringify({ name: "demo", version: "1.0.0" }),
    });
    assert.equal(
      startPlugin(cap.ctx, "claude", ext, undefined)?.outDir,
      path.join(ext, "dist-claude-plugin", "demo"),
    );
    assert.equal(
      startPlugin(cap.ctx, "copilot", ext, "")?.outDir,
      path.join(repo, "dist-copilot-plugin", "demo"),
    );
    assert.equal(
      startPlugin(cap.ctx, "antigravity", ext, undefined)?.outDir,
      path.join(repo, "dist-antigravity-plugin", "demo"),
    );
  });

  test("refuses an output directory that holds the repository", () => {
    const { cap, ext, repo } = setup({
      "extension.json": JSON.stringify({ name: "demo", version: "1.0.0" }),
    });
    assert.throws(
      () => startPlugin(cap.ctx, "claude", ext, path.dirname(repo)),
      /refusing to remove/,
    );
  });
});

describe("emitMcp", () => {
  test("writes the file, dist and package.json for a delivering target", () => {
    const { cap, ext, out } = setup(fullExtension());
    const plan = startPlugin(cap.ctx, "claude", ext, out);
    assert.ok(plan);
    cap.out.length = 0;
    emitMcp(plan, ".mcp.json");
    assert.deepEqual(cap.out, [
      "  Generated: .mcp.json",
      "  Copied: dist/",
      "  Copied: package.json",
    ]);
    assert.equal(
      fs.readFileSync(path.join(out, ".mcp.json"), "utf8"),
      `{\n  "mcpServers": {\n    "srv": {\n      "command": "node",\n      "args": [\n        "\${CLAUDE_PLUGIN_ROOT}/dist/index.js"\n      ]\n    }\n  }\n}\n`,
    );
    assert.ok(fs.existsSync(path.join(out, "dist", "index.js")));
  });

  test("an empty declaration writes nothing", () => {
    const { cap, ext, out } = setup({
      "extension.json": JSON.stringify({ name: "d", version: "1" }),
    });
    const plan = startPlugin(cap.ctx, "claude", ext, out);
    assert.ok(plan);
    emitMcp(plan, ".mcp.json");
    assert.deepEqual(readTree(out), {});
  });
});

describe("emitContext", () => {
  test("raw shape: renders, prints diagnostics-free warnings and the Rendered line", () => {
    const files = fullExtension();
    files["CONTEXT.md"] = "# ${TOOL} demo\nUse ${COMMAND:greet} and ${SKILL:helper}.\n";
    const { cap, ext, out } = setup(files);
    const plan = startPlugin(cap.ctx, "claude", ext, out);
    assert.ok(plan);
    assert.equal(emitContext(plan, "raw"), true);
    assert.equal(cap.out.at(-1), "  Rendered: CLAUDE.md");
    const text = fs.readFileSync(path.join(out, "CLAUDE.md"), "utf8");
    assert.match(text, /^# Claude Code demo\n/);
    assert.match(text, /\/demo:greet/);
  });

  test("a diagnostic fails with the Error line and writes nothing", () => {
    const { cap, ext, out } = setup(fullExtension());
    const plan = startPlugin(cap.ctx, "claude", ext, out);
    assert.ok(plan);
    assert.equal(emitContext(plan, "raw"), false);
    assert.ok(
      cap.err.some((l) => l.startsWith("UNKNOWN-TARGET: ") && l.includes("CONTEXT.md:3 - ")),
    );
    assert.equal(cap.err.at(-1), "Error: rendering context for target 'claude' failed");
    assert.deepEqual(readTree(out), {});
  });

  test("copilot shape: five frontmatter lines, an empty line, the body and one line feed", () => {
    const files = fullExtension();
    files["CONTEXT.md"] = "body line\n\n\n";
    const { cap, ext, out } = setup(files);
    const plan = startPlugin(cap.ctx, "copilot", ext, out);
    assert.ok(plan);
    assert.equal(emitContext(plan, "copilot"), true);
    assert.equal(cap.out.at(-1), "  Rendered: skills/demo-context/SKILL.md");
    assert.equal(
      fs.readFileSync(path.join(out, "skills", "demo-context", "SKILL.md"), "utf8"),
      '---\nname: demo-context\ndescription: "Agent-facing context for the demo extension."\nuser-invocable: true\n---\n\nbody line\n',
    );
  });

  test("no context source renders nothing", () => {
    const { cap, ext, out } = setup({
      "extension.json": JSON.stringify({ name: "d", version: "1" }),
    });
    const plan = startPlugin(cap.ctx, "claude", ext, out);
    assert.ok(plan);
    assert.equal(emitContext(plan, "raw"), true);
    assert.deepEqual(readTree(out), {});
  });
});

describe("skills, commands and hooks", () => {
  test("copySkills copies directories only, in code-unit order", () => {
    const { cap, ext, out } = setup(fullExtension());
    const plan = startPlugin(cap.ctx, "copilot", ext, out);
    assert.ok(plan);
    cap.out.length = 0;
    copySkills(plan);
    assert.deepEqual(cap.out, ["  Copied skill: helper"]);
    assert.ok(fs.existsSync(path.join(out, "skills", "helper", "extra", "note.txt")));
    assert.ok(!fs.existsSync(path.join(out, "skills", "README.md")));
  });

  test("convertToSkills: name fallback to the basename, one line feed, allowed-tools only with the flag", () => {
    const { cap, ext, out } = setup(fullExtension());
    const plan = startPlugin(cap.ctx, "claude", ext, out);
    assert.ok(plan);
    cap.out.length = 0;
    convertToSkills(plan, true);
    assert.deepEqual(cap.out, [
      "  Rendered command to skill: greet",
      "  Rendered command to skill: plain",
    ]);
    assert.equal(
      fs.readFileSync(path.join(out, "skills", "greet", "SKILL.md"), "utf8"),
      '---\nname: greet\ndescription: "Say hello"\nuser-invocable: true\nallowed-tools:\n  - Read\n  - Bash(ls)\n---\n\nHello body\n',
    );
    assert.equal(
      fs
        .readFileSync(path.join(out, "skills", "plain", "SKILL.md"), "utf8")
        .includes("name: plain\n"),
      true,
    );
    const second = startPlugin(cap.ctx, "copilot", ext, out);
    assert.ok(second);
    convertToSkills(second, false);
    assert.ok(
      !fs
        .readFileSync(path.join(out, "skills", "greet", "SKILL.md"), "utf8")
        .includes("allowed-tools"),
    );
  });

  test("convertToSkills does nothing unless the flag is true", () => {
    const files = fullExtension();
    files["extension.json"] = JSON.stringify({
      name: "demo",
      version: "1",
      commands: { location: "commands/" },
    });
    const { cap, ext, out } = setup(files);
    const plan = startPlugin(cap.ctx, "claude", ext, out);
    assert.ok(plan);
    convertToSkills(plan, true);
    assert.deepEqual(readTree(out), {});
  });

  test("copyHooks copies the directory when hooks are declared", () => {
    const { cap, ext, out } = setup(fullExtension());
    const plan = startPlugin(cap.ctx, "claude", ext, out);
    assert.ok(plan);
    cap.out.length = 0;
    copyHooks(plan);
    assert.deepEqual(cap.out, ["  Copied: hooks/"]);
    assert.ok(fs.existsSync(path.join(out, "hooks", "h.sh")));
  });
});
