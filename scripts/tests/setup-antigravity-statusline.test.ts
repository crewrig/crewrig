// setup-antigravity-statusline.test.ts — scripts/lib/setup/antigravity-statusline.ts over a temporary HOME and
// checkout, with a fake spawner for the Node.js floor guard and git. The expectations are those the
// Bash suite test-setup-antigravity-transcript.sh pins for deploy_antigravity_transcript_hooks and
// the statusline block of setup-antigravity-interactive.sh.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, test } from "node:test";
import { fileURLToPath } from "node:url";

import { agyPaths, type AgyCtx } from "../lib/setup/antigravity-hooks.ts";
import {
  enableStatusline,
  keepStatusline,
  removeStatusline,
  STATUSLINE_MARKER_STRING,
  statuslineInstalled,
} from "../lib/setup/antigravity-statusline.ts";
import type { SpawnResult, Spawner } from "../lib/setup/context.ts";

const REAL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (file: string): unknown => JSON.parse(fs.readFileSync(file, "utf8"));
const at = (value: unknown, ...keys: (string | number)[]): unknown =>
  keys.reduce<unknown>(
    (node, key) =>
      typeof node === "object" && node !== null
        ? (node as Record<string | number, unknown>)[key]
        : undefined,
    value,
  );

let root = "";
let out: string[] = [];
let err: string[] = [];
let calls: string[][] = [];
let floor: SpawnResult = { status: 0, stdout: "", stderr: "" };

const spawn: Spawner = (argv) => {
  calls.push([...argv]);
  if (argv[0] === "git") return { status: 0, stdout: ".git\n", stderr: "" };
  return floor;
};

function ctxOf(): AgyCtx {
  return {
    io: {
      out: (l) => void out.push(l),
      err: (l) => void err.push(l),
      errRaw: (t) => void err.push(t),
    },
    env: {},
    platform: process.platform,
    home: path.join(root, "home"),
    repoDir: path.join(root, "repo"),
  };
}

beforeEach(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "agy-hooks-")));
  out = [];
  err = [];
  calls = [];
  floor = { status: 0, stdout: "", stderr: "" };
  const repo = path.join(root, "repo");
  fs.mkdirSync(path.join(repo, "hooks"), { recursive: true });
  fs.mkdirSync(path.join(repo, "scripts", "lib"), { recursive: true });
  fs.writeFileSync(path.join(repo, "scripts", "lib", "node-floor-guard.js"), "");
  fs.copyFileSync(
    path.join(REAL, "hooks", "antigravity-transcript-hooks.json"),
    path.join(repo, "hooks", "antigravity-transcript-hooks.json"),
  );
  for (const name of [
    "worktree-git-guard",
    "mempalace-transcript",
    "antigravity-statusline-shim",
  ]) {
    fs.writeFileSync(path.join(repo, "hooks", `${name}.ts`), "");
  }
  fs.mkdirSync(path.join(root, "home"), { recursive: true });
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

describe("statusline channel", () => {
  const SHIM = (ctx: AgyCtx) => path.join(ctx.repoDir, "hooks", "antigravity-statusline-shim.ts");

  test("enable over an empty command installs, records the marker and says so", () => {
    const ctx = ctxOf();
    const paths = agyPaths(ctx);
    enableStatusline(ctx, spawn, paths);
    const marker = read(paths.marker) as Record<string, string>;
    assert.equal(marker["installedBy"], STATUSLINE_MARKER_STRING);
    assert.equal(marker["priorStatusLineCommand"], "");
    assert.ok(marker["installedStatusLineCommand"]?.includes(SHIM(ctx)));
    assert.equal(
      at(read(paths.settings), "statusLine", "command"),
      marker["installedStatusLineCommand"],
    );
    assert.equal(out.at(-1), `  Prior statusLine.command (empty) recorded at ${paths.marker}`);
    assert.equal(statuslineInstalled(paths).installed, true);
    assert.ok(!fs.existsSync(path.join(paths.agyHome, "hooks", "antigravity-statusline-shim.ts")));
  });

  test("a foreign command is left untouched with the R20 explanation", () => {
    const ctx = ctxOf();
    const paths = agyPaths(ctx);
    fs.mkdirSync(paths.agyHome, { recursive: true });
    fs.writeFileSync(paths.settings, JSON.stringify({ statusLine: { command: "my-line" } }));
    enableStatusline(ctx, spawn, paths);
    assert.equal(
      out[0],
      "  statusLine.command already carries a value this framework did not install:",
    );
    assert.equal(out[1], "    my-line");
    assert.equal(out.length, 6);
    assert.ok(!fs.existsSync(paths.marker));
    assert.equal(statuslineInstalled(paths).installed, false);
  });

  test("below the floor enable writes nothing and says so on standard error", () => {
    floor = { status: 1, stdout: "", stderr: "" };
    const ctx = ctxOf();
    enableStatusline(ctx, spawn, agyPaths(ctx));
    assert.deepEqual(err, ["  Antigravity usage capture NOT enabled — setup continues."]);
    assert.ok(!fs.existsSync(agyPaths(ctx).marker));
  });

  test("the transitional previous command still reads as installed", () => {
    const ctx = ctxOf();
    const paths = agyPaths(ctx);
    fs.mkdirSync(path.dirname(paths.marker), { recursive: true });
    fs.mkdirSync(paths.agyHome, { recursive: true });
    fs.writeFileSync(
      paths.marker,
      JSON.stringify({
        installedStatusLineCommand: "new",
        previousInstalledStatusLineCommand: "old",
      }),
    );
    fs.writeFileSync(paths.settings, JSON.stringify({ statusLine: { command: "old" } }));
    assert.deepEqual(statuslineInstalled(paths), { installed: true, current: "old" });
    fs.writeFileSync(paths.settings, JSON.stringify({ statusLine: { command: "other" } }));
    assert.equal(statuslineInstalled(paths).installed, false);
  });

  test("remove restores the prior command and drops the marker; with none it deletes the key", () => {
    const ctx = ctxOf();
    const paths = agyPaths(ctx);
    enableStatusline(ctx, spawn, paths);
    out = [];
    removeStatusline(ctx, paths);
    assert.equal(read(paths.settings) && JSON.stringify(read(paths.settings)), '{"statusLine":{}}');
    assert.ok(!fs.existsSync(paths.marker));
    assert.ok(out.some((l) => l.startsWith("  Backed up: settings.json -> settings.json.bak.")));
    assert.equal(
      out.at(-1),
      "  Antigravity usage capture removed; statusLine.command restored to its prior value.",
    );

    fs.mkdirSync(path.dirname(paths.marker), { recursive: true });
    fs.writeFileSync(paths.marker, JSON.stringify({ priorStatusLineCommand: "mine" }));
    removeStatusline(ctx, paths);
    assert.equal(at(read(paths.settings), "statusLine", "command"), "mine");
  });

  test("keep says so and rewrites; below the floor it leaves the command as it is", () => {
    const ctx = ctxOf();
    const paths = agyPaths(ctx);
    enableStatusline(ctx, spawn, paths);
    out = [];
    keepStatusline(ctx, spawn, paths);
    assert.equal(out[0], "  Antigravity usage capture kept.");
    assert.ok(calls.some((c) => c[0] === "node"));
    floor = { status: 1, stdout: "", stderr: "" };
    err = [];
    keepStatusline(ctx, spawn, paths);
    assert.deepEqual(err, ["  statusLine.command left as it is."]);
  });
});
