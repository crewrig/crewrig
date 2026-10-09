// extension-check.test.ts — the `--check` arms and the stray-output cleanup (spec 0254 R14, R19).

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import {
  checkExtension,
  checkSkeleton,
  cleanupStrayPluginDist,
} from "../lib/extension/check-arms.ts";
import { renderExtension } from "../lib/extension/render-extension.ts";
import { fullTree, strayTree, versionDriftTree, writeTree } from "./lib/extension-trees.ts";
import type { FileMap } from "./lib/extension-trees.ts";
import { makeCtx, tmpRoot } from "./lib/plugin-ctx.ts";

function setup(name: string, files: FileMap) {
  const repo = tmpRoot();
  const extDir = path.join(repo, "extensions", "core", name);
  writeTree(extDir, files);
  const captured = makeCtx(repo);
  return { repo, extDir, ...captured };
}

describe("check arms", () => {
  it("COMMITTED: charges a class member and a name-axis file once each", async () => {
    const t = setup("stray", strayTree());
    const failures = await checkExtension(t.ctx, t.extDir);
    assert.equal(failures >= 2, true);
    const committed = t.out.filter((l) => l.startsWith("  FAIL COMMITTED stray"));
    assert.equal(committed.length, 2);
    const text = committed.join("\n");
    assert.match(text, /GEMINI\.md is a member of the generated-output class/);
    assert.match(text, /gemini-extension\.json is a member of the generated-output class/);
  });

  it("RENDER-FAIL: prints the captured render indented by nine spaces", async () => {
    const t = setup("invalid", {
      "extension.json": JSON.stringify({
        name: "invalid",
        version: "1.0.0",
        description: "x",
        hooks: [{ id: "x", event: "Bogus", command: "c" }],
      }),
    });
    const failures = await checkExtension(t.ctx, t.extDir);
    assert.equal(failures, 1);
    const at = t.out.indexOf("  FAIL RENDER-FAIL invalid — a fresh --target all render failed:");
    assert.equal(at >= 0, true, t.out.join("\n"));
    const rest = t.out.slice(at + 1);
    assert.equal(rest.length >= 2, true);
    assert.equal(
      rest.every((l) => l.startsWith("         ")),
      true,
    );
    assert.equal(
      rest.some((l) => l.includes("VALIDATION-ERROR")),
      true,
    );
    assert.equal(rest.at(-1)!.includes("manifest validation failed"), true);
    assert.equal(t.err.length, 0);
  });

  it("VERSION-DRIFT: the built version against package.json", async () => {
    const t = setup("drift", versionDriftTree());
    await checkExtension(t.ctx, t.extDir);
    assert.equal(
      t.out.includes(
        "  FAIL VERSION-DRIFT drift — built gemini-extension.json version '1.0.0' != authoritative version '9.9.9'",
      ),
      true,
      t.out.join("\n"),
    );
  });

  it("GAP: the full tree passes with its accepted-gaps.json", async () => {
    const { ".releaserc.json": _debris, ...files } = fullTree();
    const t = setup("full", files);
    assert.equal(await checkExtension(t.ctx, t.extDir), 0, t.out.join("\n"));
    assert.equal(t.out.includes("  OK   GAP full"), true);
    assert.equal(
      t.out.includes("  OK   MISSING/UNDECLARED full (produced set matches declared set)"),
      true,
    );
    assert.equal(t.out.includes("  OK   VERSION-DRIFT full (version 1.2.3)"), true);
  });

  it("GAP-UNDECLARED without the accepted file, GAP-STALE with an extra entry", async () => {
    const { ".releaserc.json": _d, "accepted-gaps.json": accepted, ...files } = fullTree();
    const bare = setup("full", files);
    assert.equal((await checkExtension(bare.ctx, bare.extDir)) > 0, true);
    assert.equal(
      bare.out.some((l) => l.startsWith("  FAIL GAP-UNDECLARED full — observed gap '")),
      true,
    );

    const stale = JSON.parse(accepted!) as Array<Record<string, string>>;
    stale.push({ subject: "mcpServers", target: "claude", reason: "x" });
    const t = setup("full", { ...files, "accepted-gaps.json": JSON.stringify(stale) });
    assert.equal(await checkExtension(t.ctx, t.extDir), 1, t.out.join("\n"));
    assert.equal(
      t.out.some((l) => l.includes("FAIL GAP-STALE full") && l.includes("'mcpServers@claude'")),
      true,
    );
  });

  it("the skeleton arm charges a tool-named file", async () => {
    const repo = tmpRoot();
    const { ctx, out } = makeCtx(repo);
    const dir = path.join(repo, "extension-skeleton");
    assert.equal(checkSkeleton(ctx, dir), 0);
    writeTree(dir, { "ok.md": "x", ".claude-plugin/plugin.json": "{}" });
    assert.equal(checkSkeleton(ctx, dir), 1);
    assert.equal(out[0], "  OK   COMMITTED extension-skeleton (no tool-designated file committed)");
    assert.match(
      out[1]!,
      /^  FAIL COMMITTED extension-skeleton — \.claude-plugin\/plugin\.json is named for/,
    );
  });
});

describe("plugin staging cleanup", () => {
  it("removes dist-*-plugin directories at depth 3 only, and a build keeps them", async () => {
    const repo = tmpRoot();
    writeTree(repo, {
      "extensions/core/a/dist-claude-plugin/x": "x",
      "extensions/library/b/dist-copilot-plugin/y": "y",
      "extensions/core/a/keep/dist-claude-plugin/z": "z",
      "extensions/core/a/dist-notes": "n",
      "dist-copilot-plugin/top": "t",
    });
    cleanupStrayPluginDist(repo);
    assert.equal(fs.existsSync(path.join(repo, "extensions/core/a/dist-claude-plugin")), false);
    assert.equal(fs.existsSync(path.join(repo, "extensions/library/b/dist-copilot-plugin")), false);
    assert.equal(
      fs.existsSync(path.join(repo, "extensions/core/a/keep/dist-claude-plugin/z")),
      true,
    );
    assert.equal(fs.existsSync(path.join(repo, "extensions/core/a/dist-notes")), true);
    assert.equal(fs.existsSync(path.join(repo, "dist-copilot-plugin/top")), true);
  });

  it("a build leaves the Claude plugin directory in place", async () => {
    const { ".releaserc.json": _d, ...files } = fullTree();
    const t = setup("full", files);
    assert.equal(await renderExtension(t.ctx, t.extDir, ["claude"]), 0, t.err.join("\n"));
    assert.equal(fs.existsSync(path.join(t.extDir, "dist-claude-plugin")), true);
  });
});
