// extension-render-plugins.test.ts — the plugin delegation of `build-extension` (spec 0254 R15):
// the builder's output goes to stderr, the hook file lands in the builder's root, the gaps are
// recorded, and a failing builder does not stop the later steps.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";

import { createGapChannel } from "../lib/extension/gap-record.ts";
import { readManifest } from "../lib/extension/manifest.ts";
import { renderPlugin } from "../lib/extension/plugin-delegate.ts";
import { fullTree, minimalTree, writeTree, type FileMap } from "./lib/extension-trees.ts";
import { makeCtx, tmpRoot } from "./lib/plugin-ctx.ts";

function setup(files: FileMap) {
  const root = tmpRoot();
  const repo = path.join(root, "repo");
  const ext = path.join(root, "ext");
  fs.mkdirSync(repo);
  writeTree(ext, files);
  const cap = makeCtx(repo);
  const manifest = readManifest(path.join(ext, "extension.json"));
  return { repo, ext, cap, manifest, gaps: createGapChannel() };
}

describe("renderPlugin", () => {
  test("claude: builder lines go to stderr, hooks land in the builder root", async () => {
    const { ext, cap, manifest, gaps } = setup(fullTree());
    const rc = await renderPlugin(cap.ctx, "claude", ext, manifest, "full", gaps);
    assert.equal(rc, 0);
    assert.deepEqual(cap.out, []);
    assert.ok(cap.err.includes("Building Claude Code plugin: full v1.2.3"));
    const root = path.join(ext, "dist-claude-plugin", "full");
    assert.ok(fs.existsSync(path.join(root, ".claude-plugin", "plugin.json")));
    const hooks = JSON.parse(fs.readFileSync(path.join(root, "hooks", "hooks.json"), "utf8")) as {
      hooks?: Record<string, unknown>;
    };
    assert.ok(hooks.hooks !== undefined);
    assert.deepEqual(gaps.gaps, []);
  });

  test("copilot: the hook file goes to the repository's dist-copilot-plugin root", async () => {
    const { repo, ext, cap, manifest, gaps } = setup(fullTree());
    const rc = await renderPlugin(cap.ctx, "copilot", ext, manifest, "full", gaps);
    assert.equal(rc, 0);
    assert.deepEqual(cap.out, []);
    assert.ok(fs.existsSync(path.join(repo, "dist-copilot-plugin", "full")));
  });

  test("antigravity: the unmappable prompt event is a warning and a record", async () => {
    const { ext, cap, manifest, gaps } = setup(fullTree());
    await renderPlugin(cap.ctx, "antigravity", ext, manifest, "full", gaps);
    assert.deepEqual(cap.out, []);
    assert.ok(
      cap.err.includes(
        "Warning: hook 'prompt' declares event 'UserPromptSubmit', which has no counterpart on target 'antigravity'",
      ),
    );
    assert.deepEqual(gaps.gaps, [
      {
        subject: "hooks",
        target: "antigravity",
        hook: "prompt",
        event: "UserPromptSubmit",
        part: "event",
        reason: "neutral event has no counterpart on this target",
      },
    ]);
  });

  test("a builder failure is rc 1 and the hooks step still runs", async () => {
    const files: Record<string, string> = { ...fullTree() };
    files["CONTEXT.md"] = "${ONLY:claude}never closed\n";
    const { ext, cap, manifest, gaps } = setup(files);
    const rc = await renderPlugin(cap.ctx, "claude", ext, manifest, "full", gaps);
    assert.equal(rc, 1);
    assert.deepEqual(cap.out, []);
    assert.ok(cap.err.some((l) => l.startsWith("Error: rendering context")));
    assert.ok(fs.existsSync(path.join(ext, "dist-claude-plugin", "full", "hooks", "hooks.json")));
  });

  test("a builder that throws is rc 1 with the message on stderr", async () => {
    const { ext, cap, manifest, gaps } = setup(minimalTree());
    fs.rmSync(path.join(ext, "extension.json"));
    const rc = await renderPlugin(cap.ctx, "claude", ext, manifest, "minimal", gaps);
    assert.equal(rc, 1);
    assert.deepEqual(cap.out, []);
    assert.ok(cap.err.length > 0);
  });

  test("mcpServers on a target without delivery records the gap", async () => {
    const { cap, manifest, gaps, ext } = setup(fullTree());
    const antigravity = cap.ctx.table.antigravity.mcpDelivery;
    const noDelivery = (["claude", "copilot", "antigravity"] as const).find(
      (t) => !cap.ctx.table[t].mcpDelivery,
    );
    if (noDelivery === undefined) {
      assert.equal(antigravity, true, "every plugin target delivers MCP: nothing to record");
      return;
    }
    await renderPlugin(cap.ctx, noDelivery, ext, manifest, "full", gaps);
    assert.ok(
      cap.err.includes(
        `Warning: extension 'full' declares mcpServers, which has no expressible delivery on target '${noDelivery}'`,
      ),
    );
    assert.deepEqual(gaps.gaps.at(-1), {
      subject: "mcpServers",
      target: noDelivery,
      reason: "no resolvable path form for this target's MCP delivery (see docs/cli-matrix.md)",
    });
  });
});
