// setup-antigravity-hooks.test.ts — scripts/lib/setup/antigravity-hooks.ts over a temporary HOME and
// checkout, with a fake spawner for the Node.js floor guard and git. The expectations are those the
// Bash suite test-setup-antigravity-transcript.sh pins for deploy_antigravity_transcript_hooks and
// the statusline block of setup-antigravity-interactive.sh.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  agyPaths,
  applyTranscriptHooks,
  deployAntigravityTranscriptHooks,
  requireNodeFloor,
  type AgyCtx,
} from "../lib/setup/antigravity-hooks.ts";
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

describe("paths and floor", () => {
  test("paths follow CREWRIG_USAGE_ROOT, else ~/.crewrig/usage", () => {
    const ctx = ctxOf();
    const p = agyPaths(ctx);
    assert.equal(
      p.marker,
      path.join(ctx.home, ".crewrig", "usage", "state", "antigravity-statusline.json"),
    );
    assert.equal(p.settings, path.join(ctx.home, ".gemini", "antigravity-cli", "settings.json"));
    assert.equal(p.hooksJson, path.join(ctx.home, ".gemini", "config", "hooks.json"));
    assert.equal(
      agyPaths({ ...ctx, env: { CREWRIG_USAGE_ROOT: "/u" } }).marker,
      "/u/state/antigravity-statusline.json",
    );
  });

  test("a missing node and a failed guard print the shell's diagnostics", () => {
    floor = { status: 127, stdout: "", stderr: "Error: cannot run 'node'\n" };
    assert.equal(requireNodeFloor(ctxOf(), spawn, "usage capture"), false);
    assert.deepEqual(err, [
      "  ERROR: crewrig: Node.js was not found on PATH; usage capture requires Node.js >= 24. Install a supported release from https://nodejs.org/en/download",
    ]);
    err = [];
    floor = { status: 1, stdout: "", stderr: "crewrig: requires Node.js >= 24\n" };
    assert.equal(requireNodeFloor(ctxOf(), spawn, "this step"), false);
    assert.deepEqual(err, ["crewrig: requires Node.js >= 24\n"]);
    fs.rmSync(path.join(root, "repo", "scripts", "lib", "node-floor-guard.js"));
    err = [];
    assert.equal(requireNodeFloor(ctxOf(), spawn, "this step"), false);
    assert.match(err[0] ?? "", /^ {2}ERROR: Node\.js floor guard not found at /);
  });
});

describe("transcript deployment", () => {
  const request = (ctx: AgyCtx) => ({
    manifestSrc: path.join(ctx.repoDir, "hooks", "antigravity-transcript-hooks.json"),
    hooksDir: path.join(ctx.home, ".gemini", "antigravity-cli", "hooks"),
    manifestTarget: path.join(ctx.home, ".gemini", "config", "hooks.json"),
    guardSrc: path.join(ctx.repoDir, "hooks", "worktree-git-guard.ts"),
  });

  test("a fresh deployment writes both named hooks at 0600 with in-repo absolute commands", () => {
    const ctx = ctxOf();
    const result = deployAntigravityTranscriptHooks(ctx, spawn, request(ctx));
    assert.deepEqual(result, { ok: true, wired: true });
    const target = request(ctx).manifestTarget;
    const doc = read(target);
    const command = String(at(doc, "crewrig-mempalace-transcript", "Stop", 0, "command"));
    assert.match(command, /mempalace-transcript\.ts"? antigravity-cli Stop$/);
    assert.ok(command.includes(path.join(ctx.repoDir, "hooks")));
    const guard = String(
      at(doc, "crewrig-worktree-git-guard", "PreToolUse", 0, "hooks", 0, "command"),
    );
    assert.ok(guard.includes(path.join(ctx.repoDir, "hooks", "worktree-git-guard.ts")));
    if (process.platform !== "win32") assert.equal(fs.statSync(target).mode & 0o777, 0o600);
    assert.ok(fs.statSync(request(ctx).hooksDir).isDirectory());
    assert.equal(out.at(-1), `  Transcript hooks deployed to ${target}`);
    assert.deepEqual(err, []);
  });

  test("an operator's hook survives, a backup is made, and a second run is stable", () => {
    const ctx = ctxOf();
    const target = request(ctx).manifestTarget;
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(
      target,
      JSON.stringify({ mine: { Stop: [{ type: "command", command: "echo hi" }] } }),
    );
    assert.equal(deployAntigravityTranscriptHooks(ctx, spawn, request(ctx)).wired, true);
    const first = fs.readFileSync(target, "utf8");
    const doc = JSON.parse(first) as Record<string, unknown>;
    assert.deepEqual(Object.keys(doc).slice(0, 1), ["mine"]);
    assert.ok(out.some((l) => l.startsWith("  Backed up: hooks.json -> hooks.json.bak.")));
    assert.equal(deployAntigravityTranscriptHooks(ctx, spawn, request(ctx)).wired, true);
    assert.equal(fs.readFileSync(target, "utf8"), first);
  });

  test("a target that is not a JSON object is refused and left byte-identical", () => {
    const ctx = ctxOf();
    const target = request(ctx).manifestTarget;
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, "[1]");
    assert.deepEqual(deployAntigravityTranscriptHooks(ctx, spawn, request(ctx)), {
      ok: false,
      wired: false,
    });
    assert.equal(fs.readFileSync(target, "utf8"), "[1]");
    assert.deepEqual(err, [
      `  ERROR: ${target} is not a JSON object; refusing to merge.`,
      "         Your original file is untouched, and a backup sits beside it.",
    ]);
  });

  test("below the floor the guard falls back to the unrendered manifest and the transcript is not wired", () => {
    floor = { status: 1, stdout: "", stderr: "crewrig: requires Node.js >= 24\n" };
    const ctx = ctxOf();
    assert.deepEqual(deployAntigravityTranscriptHooks(ctx, spawn, request(ctx)), {
      ok: true,
      wired: false,
    });
    // the shell's fallback is `del(."crewrig-worktree-git-guard")`: nothing of the guard is written
    assert.deepEqual(read(request(ctx).manifestTarget), {});
    assert.ok(
      err.includes(
        "  Worktree git guard not wired this run; an installed guard command is left as it is.",
      ),
    );
    assert.ok(
      err.includes(
        "  Session recording not wired this run; an installed transcript hook is left as it is.",
      ),
    );
  });

  test("applyTranscriptHooks prints the outcome line of the script", () => {
    const ctx = ctxOf();
    assert.equal(applyTranscriptHooks(ctx, spawn, agyPaths(ctx)), true);
    assert.ok(
      out.includes(
        `  Session recording wired to ${ctx.repoDir}/hooks/mempalace-transcript.ts (in-repo absolute path)`,
      ),
    );
  });
});
