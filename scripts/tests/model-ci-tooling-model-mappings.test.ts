// model-ci-tooling-model-mappings.test.ts — differential test of
// scripts/check-model-mappings.ts against scripts/check-model-mappings.sh (spec 0262
// requirements 1-4, 6, 24): the same input through both entries under LC_ALL=C must give
// equal stdout, stderr and status. The shell leg needs bash and yq (skipped otherwise).
// Slice 1 covers --print-selection and the shape pass; later slices add the other passes.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";

import { REPO, WINDOWS } from "./lib/worktree-fixtures.ts";

const SH = path.join(REPO, "scripts", "check-model-mappings.sh");
const TS = path.join(REPO, "scripts", "check-model-mappings.ts");
const HAS_YQ = !WINDOWS && spawnSync("yq", ["--version"], { stdio: "ignore" }).status === 0;
const SKIP = HAS_YQ ? false : "SKIP: shell leg needs bash and yq (not on win32)";
const roots: string[] = [];
after(() => {
  for (const root of roots) fs.rmSync(root, { recursive: true, force: true });
});

interface Run {
  stdout: string;
  stderr: string;
  status: number | null;
}

function run(cmd: string, args: string[], repoDir: string): Run {
  const r = spawnSync(cmd, args, {
    encoding: "utf8",
    env: { ...process.env, LC_ALL: "C", CREWRIG_REPO_DIR: repoDir },
  });
  return { stdout: r.stdout, stderr: r.stderr, status: r.status };
}

const runSh = (args: string[], repo: string): Run => run("bash", [SH, ...args], repo);
const runTs = (args: string[], repo: string): Run =>
  run(process.execPath, ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", TS, ...args], repo);

/** A scratch repository whose model-mappings/ holds the real files, then `edits`. */
function scratch(edits: Record<string, (text: string) => string> = {}): string {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "crewrig-cmm-")));
  roots.push(root);
  const dir = path.join(root, "model-mappings");
  fs.mkdirSync(dir);
  fs.mkdirSync(path.join(root, "scripts", "lib"), { recursive: true });
  fs.copyFileSync(
    path.join(REPO, "scripts", "lib", "model-resolve.sh"),
    path.join(root, "scripts", "lib", "model-resolve.sh"),
  );
  for (const name of fs.readdirSync(path.join(REPO, "model-mappings"))) {
    const text = fs.readFileSync(path.join(REPO, "model-mappings", name), "utf8");
    fs.writeFileSync(path.join(dir, name), (edits[name] ?? ((t) => t))(text));
  }
  return root;
}

function same(args: string[], repo: string): Run {
  const sh = runSh(args, repo);
  const ts = runTs(args, repo);
  assert.deepEqual(ts, sh);
  return ts;
}

describe("check-model-mappings.ts vs check-model-mappings.sh", { skip: SKIP }, () => {
  test("real repository, conform mode: clean", () => {
    const r = same([], REPO);
    assert.equal(r.status, 0);
  });

  test("real repository, --print-selection: 28 lines", () => {
    const r = same(["--print-selection"], REPO);
    assert.equal(r.stdout.split("\n").length, 29);
  });

  test("--print-selection with named files, core and org", () => {
    const named = ["claude", "copilot", "gemini"].map((t) => `${REPO}/model-mappings/${t}.yml`);
    same(["--print-selection", ...named], REPO);
    same(["--print-selection", `${REPO}/model-mappings/claude.org.yml`], REPO);
  });

  test("missing named file and missing directory exit 2", () => {
    assert.equal(same(["/nonexistent/x.yml"], REPO).status, 2);
    assert.equal(same([], fs.mkdtempSync(path.join(os.tmpdir(), "crewrig-cmm-empty-"))).status, 2);
  });

  test("shape rejections: A2 target disagreement, A3 foreign key, A7 duplicate rank", () => {
    const repo = scratch({
      "claude.yml": (t) => t.replace("    rank: 2\n", "    rank: 1\n") + "stray: 1\n",
      "gemini.yml": (t) => t.replace(/^target: gemini$/m, "target: copilot"),
    });
    const r = same([], repo);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /A7 duplicate offering rank '1'/);
    assert.match(r.stderr, /A3 the top-level document carries key 'stray'/);
    assert.match(r.stderr, /A2 target 'copilot' disagrees with filename stem 'gemini'/);
  });

  test("shape rejections: A1 foreign target and A15 missing key, print-selection unaffected", () => {
    const repo = scratch({
      "copilot.yml": (t) => t.replace(/^target: copilot$/m, "target: nope"),
      "antigravity.yml": (t) => t.replace(/^offerings:/m, "offeringz:"),
    });
    assert.equal(same([], repo).status, 1);
    same(["--print-selection"], repo);
  });
});

describe("check-model-mappings.ts deliberate deviations (spec 0262 req 24)", () => {
  test("a multi-document mapping is one Error line and exit 1", () => {
    const repo = scratch({ "claude.yml": (t) => `${t}\n---\ntarget: claude\n` });
    const r = runTs([], repo);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /^Error: .*claude\.yml: /);
    assert.equal(r.stderr.trim().split("\n").length, 1);
  });
});
