// Replaces scripts/tests/test-release-package-extension.sh Cases 7-9 (spec 0183 R19, spec 0265 row J2).
// Retires with scripts/lib/extension-install.sh (row J4): this file is the library's sole consumer, so
// the row that deletes the library deletes this test too. Cases 1-6b of the Bash suite are covered by
// packaging-release-package.test.ts; the TypeScript port of the same function by antigravity-tokens.test.ts.
//
// The library is sourced in a fresh `bash -c` (POSIX only) with HOME set to a throwaway directory.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";

import { bashLibs } from "./lib/bash-libs.ts";
import { cleanEnv, realTmp, SKIP_POSIX, which } from "./lib/worktree-fixtures.ts";

const HAS_JQ = which("jq") !== null;
const SKIP: string | false =
  SKIP_POSIX || (HAS_JQ ? false : "SKIP: jq is not on PATH (the library requires it)");
const TOKEN_CONFIG = '{"default":{"command":"node","args":["${extensionRoot}/dist/index.js"]}}\n';

function env(): NodeJS.ProcessEnv {
  return cleanEnv({ CI: undefined, NODE_TEST_CONTEXT: undefined, LC_ALL: "C" });
}

/** A rendered extension output directory holding `plugin.json` (`pluginJson`) and `mcp_config.json`. */
function outDir(pluginJson: string): string {
  const dir = realTmp("ag-tokens-out-");
  fs.writeFileSync(path.join(dir, "plugin.json"), `${pluginJson}\n`);
  fs.writeFileSync(path.join(dir, "mcp_config.json"), TOKEN_CONFIG);
  return dir;
}

function resolveTokens(out: string, home?: string) {
  // bashLibs overrides HOME with its own throwaway directory, so the body re-exports ours.
  const body = `${home === undefined ? "" : `export HOME=${JSON.stringify(home)}\n`}ext_antigravity_resolve_tokens ${JSON.stringify(out)} 2>&1`;
  return bashLibs(body, env(), ["extension-install.sh"]);
}

describe("ext_antigravity_resolve_tokens (R19)", { skip: SKIP }, () => {
  test("Case 7 (R19, locate half) — an absent/empty plugin.json .name fails, naming plugin.json, with no basename fallback", () => {
    const res = resolveTokens(outDir("{}"));
    assert.notEqual(res.status, 0, `${res.stdout}${res.stderr}`);
    assert.match(res.stdout + res.stderr, /plugin\.json/);
  });

  test("Case 8 (R19, assert half) — a valid identity with no installed file at the resolved location fails, naming the expected file", () => {
    const home = realTmp("ag-tokens-home-");
    fs.mkdirSync(path.join(home, ".gemini", "config", "plugins"), { recursive: true });
    // Deliberately no plugins/probe-plugin/: the identity resolves, but nothing is installed there.
    const res = resolveTokens(outDir('{"name":"probe-plugin"}'), home);
    assert.notEqual(res.status, 0, `${res.stdout}${res.stderr}`);
    assert.match(res.stdout + res.stderr, /probe-plugin/);
  });

  test("Case 9 (R19, happy path) — a valid identity with the installed file present resolves ${extensionRoot} in place", () => {
    const home = realTmp("ag-tokens-home-");
    const installed = path.join(home, ".gemini", "config", "plugins", "probe-plugin9");
    fs.mkdirSync(installed, { recursive: true });
    fs.writeFileSync(path.join(installed, "mcp_config.json"), TOKEN_CONFIG);
    const res = resolveTokens(outDir('{"name":"probe-plugin9"}'), home);
    assert.equal(res.status, 0, `${res.stdout}${res.stderr}`);
    const config = JSON.parse(fs.readFileSync(path.join(installed, "mcp_config.json"), "utf8")) as {
      default: { args: string[] };
    };
    assert.equal(config.default.args[0], path.join(installed, "dist", "index.js"));
  });
});
