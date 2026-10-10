// antigravity-tokens.test.ts — unit tests of scripts/lib/install/antigravity-tokens.ts
// (spec 0255 R10, R26): every string leaf is rewritten and the three diagnostics of
// `ext_antigravity_resolve_tokens` keep their text, stream and status.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";

import type { Io } from "../lib/extension/types.ts";
import { replaceLeaves, resolveTokens } from "../lib/install/antigravity-tokens.ts";

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((d) => fs.rmSync(d, { recursive: true, force: true })));

function setup(plugin: string | null, installed: string | null) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tokens-test-"));
  dirs.push(root);
  const outDir = path.join(root, "out");
  const home = path.join(root, "home");
  fs.mkdirSync(outDir);
  fs.writeFileSync(path.join(outDir, "mcp_config.json"), "{}");
  if (plugin !== null) fs.writeFileSync(path.join(outDir, "plugin.json"), plugin);
  const installedRoot = path.join(home, ".gemini", "config", "plugins", "p");
  fs.mkdirSync(installedRoot, { recursive: true });
  if (installed !== null) fs.writeFileSync(path.join(installedRoot, "mcp_config.json"), installed);
  const out: string[] = [];
  const err: string[] = [];
  const io: Io = { out: (l) => void out.push(l), err: (l) => void err.push(l), errRaw: () => {} };
  return {
    outDir,
    home,
    installedRoot,
    mcp: path.join(installedRoot, "mcp_config.json"),
    io,
    out,
    err,
  };
}

describe("resolveTokens", () => {
  it("rewrites every string leaf, keys and key order untouched, and prints the Resolved line", () => {
    const text = JSON.stringify({
      b: "${extensionRoot}/x",
      "${extensionRoot}": 1,
      a: {
        args: ["${extensionRoot}/i.js", "--flag", 3, null, true],
        env: { K: "a${extensionRoot}b${extensionRoot}" },
      },
    });
    const s = setup('{"name":"p"}', text);
    assert.equal(resolveTokens(s.outDir, s.home, s.io), true);
    const root = s.installedRoot;
    assert.equal(
      JSON.stringify(JSON.parse(fs.readFileSync(s.mcp, "utf8"))),
      JSON.stringify({
        b: `${root}/x`,
        "${extensionRoot}": 1,
        a: { args: [`${root}/i.js`, "--flag", 3, null, true], env: { K: `a${root}b${root}` } },
      }),
    );
    assert.deepEqual(s.out, [`  Resolved \${extensionRoot} -> ${root} in ${s.mcp}`]);
    assert.deepEqual(s.err, []);
  });

  it("returns silently when the output holds no mcp_config.json", () => {
    const s = setup('{"name":"p"}', null);
    fs.rmSync(path.join(s.outDir, "mcp_config.json"));
    assert.equal(resolveTokens(s.outDir, s.home, s.io), true);
    assert.deepEqual([s.out, s.err], [[], []]);
  });

  for (const [title, plugin] of [
    ["an absent .name", '{"nom":"p"}'],
    ["an empty .name", '{"name":""}'],
    ["an unreadable plugin.json", "{bad"],
    ["no plugin.json", null],
  ] as const) {
    it(`fails on ${title}, naming plugin.json on stderr`, () => {
      const s = setup(plugin, "{}");
      assert.equal(resolveTokens(s.outDir, s.home, s.io), false);
      assert.ok(
        s.err[0]?.startsWith(`Error: ${s.outDir}/plugin.json carries no (or an empty) .name`),
      );
      assert.deepEqual(s.out, []);
    });
  }

  it("fails when the installed mcp_config.json is missing", () => {
    const s = setup('{"name":"p"}', null);
    assert.equal(resolveTokens(s.outDir, s.home, s.io), false);
    assert.equal(
      s.err[0],
      `Error: expected ${s.mcp} after install (spec 0180 R16: a target that receives a declaration without the artifacts it names is a failure).`,
    );
  });

  it("fails when the installed file cannot be rewritten, leaving it as it was", () => {
    const s = setup('{"name":"p"}', "{bad");
    assert.equal(resolveTokens(s.outDir, s.home, s.io), false);
    assert.deepEqual(s.err, [`Error: failed to rewrite \${extensionRoot} in ${s.mcp}`]);
    assert.equal(fs.readFileSync(s.mcp, "utf8"), "{bad");
    assert.deepEqual(s.out, []);
  });
});

describe("replaceLeaves", () => {
  it("replaces a literal root, whatever characters it holds", () => {
    assert.equal(replaceLeaves("${extensionRoot}!", "C:\\a $& b"), "C:\\a $& b!");
  });
});
