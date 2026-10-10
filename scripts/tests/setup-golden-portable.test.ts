// setup-golden-portable.test.ts — no committed setup golden carries a host-specific Node path
// (spec 0256 R7, seat review/1335 finding i3-F1). The setups write `process.execPath` into hook and
// settings files; the normaliser replaces it by `<NODE>`, so a golden that still holds a Node path
// only reproduces on one host (`/usr/local/bin/node` here, `/opt/hostedtoolcache/...` on a runner).
// Layer 1: node:fs only, runs on every OS.
// API: hostPathsIn(text, extra) -> the host-specific Node paths found in `text`.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { REPO } from "./lib/build-fixture-tree.ts";
import { nodePaths } from "./lib/setup-golden-tree.ts";

const GOLDENS = path.join(REPO, "scripts/tests/fixtures/setup-golden");
const NODE_PATH = /\/(?:usr\/local|opt\/hostedtoolcache|usr)\/[^"\s]*\/node\b/g;

/** Node executable paths in `text`: the known install prefixes, the running Node, `hostedtoolcache`. */
export function hostPathsIn(text: string, extra: readonly string[] = nodePaths()): string[] {
  const found = [...(text.match(NODE_PATH) ?? [])];
  for (const exe of extra) if (text.includes(exe)) found.push(exe);
  if (text.includes("hostedtoolcache")) found.push("hostedtoolcache");
  return found;
}

function goldenFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return goldenFiles(full);
    return e.name.endsWith(".golden") ? [full] : [];
  });
}

test("the committed goldens exist (vacuity guard)", () => {
  assert.ok(goldenFiles(GOLDENS).length > 100, "fewer than 100 .golden files under setup-golden");
});

test("no committed golden contains the path of a Node executable", () => {
  const dirty = goldenFiles(GOLDENS).flatMap((file) => {
    const hits = hostPathsIn(fs.readFileSync(file, "utf8"));
    return hits.length === 0 ? [] : [`${path.relative(REPO, file)}: ${hits.join(", ")}`];
  });
  assert.deepEqual(dirty, []);
});

test("self-test: a planted Node path is detected, a placeholder is not", () => {
  const exe = process.execPath;
  assert.notEqual(hostPathsIn(`"command": "/usr/local/bin/node check"`, []).length, 0);
  assert.notEqual(hostPathsIn(`/opt/hostedtoolcache/node/24.1.0/x64/bin/node`, []).length, 0);
  assert.notEqual(hostPathsIn(`/usr/bin/node`, []).length, 0);
  assert.notEqual(hostPathsIn(`${exe} x`, [exe]).length, 0);
  assert.deepEqual(hostPathsIn(`"command": "<NODE> check", "/usr/local/lib/node_modules"`, []), []);
});

test("self-test: the normaliser output carries no Node path", async () => {
  const { normalize } = await import("./lib/setup-golden-tree.ts");
  const roots = {
    root: "/nonexistent/r",
    repo: "/nonexistent/r/repo",
    home: "/nonexistent/r/home",
  };
  const out = normalize(`run ${process.execPath} and ${fs.realpathSync(process.execPath)}`, roots);
  assert.equal(out, "run <NODE> and <NODE>");
  assert.deepEqual(hostPathsIn(out), []);
});
