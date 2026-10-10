// component-overlay.test.ts — unit suite for scripts/lib/component-overlay.ts (spec 0255, row F2).
//
// Written from reading `ensure_overlay_tiers_fresh` in scripts/lib/component-resolve.sh (the
// oracle): the CLI-to-root map, the `core` refusal before any removal, the prune, the rebuild
// spawned with an argument array and the exact refusal block.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";

import { ensureOverlayTiersFresh, type SpawnFn } from "../lib/component-overlay.ts";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "component-overlay-test-"));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

const TIERS = ["library", "community", "org"];

/** A repository root whose staging roots for `.claude` exist, each holding a residue file. */
function sandbox(stub?: string): string {
  const root = fs.mkdtempSync(path.join(tmp, "r"));
  for (const tier of TIERS) {
    fs.mkdirSync(`${root}/dist/${tier}/.claude/skills`, { recursive: true });
    fs.writeFileSync(`${root}/dist/${tier}/.claude/skills/residue`, "x");
  }
  fs.mkdirSync(`${root}/scripts`, { recursive: true });
  fs.writeFileSync(`${root}/package.json`, '{"type":"module"}');
  if (stub !== undefined) fs.writeFileSync(`${root}/scripts/build-components.ts`, stub);
  return root;
}

function collect(): { sink: (text: string) => void; text: () => string } {
  const chunks: string[] = [];
  return { sink: (t) => chunks.push(t), text: () => chunks.join("") };
}

describe("ensureOverlayTiersFresh", () => {
  test("a refused rebuild returns the child's status and prints the refusal block", () => {
    const stub =
      'console.log("report line 1");\nconsole.error("report line 2");\nprocess.exitCode = 3;\n';
    const repo = sandbox(stub);
    const err = collect();
    const status = ensureOverlayTiersFresh("claude", TIERS, { repoDir: repo, stderr: err.sink });
    assert.equal(status, 3);
    const expected =
      "The rebuild of the served overlay tiers was refused (exit 3).\n" +
      "Nothing has been installed. These staging roots were emptied before the\n" +
      "rebuild was attempted, so they are empty now; the next rebuild that\n" +
      "succeeds repopulates them, and nothing outside them was touched:\n" +
      TIERS.map((t) => `  - ${repo}/dist/${t}/.claude\n`).join("") +
      "The refused rebuild's own report follows verbatim.\n" +
      "report line 1\nreport line 2\n";
    assert.equal(err.text(), expected);
    for (const tier of TIERS) assert.equal(fs.existsSync(`${repo}/dist/${tier}/.claude`), false);
  });

  test("a successful rebuild returns 0, prints nothing and receives the tiers", () => {
    const stub = "console.log(JSON.stringify(process.argv.slice(2)));\n";
    const repo = sandbox(stub);
    const err = collect();
    let seen = "";
    const spawn: SpawnFn = (command, args) => {
      seen = JSON.stringify([command, ...args]);
      return { status: 0, output: "ignored" };
    };
    assert.equal(
      ensureOverlayTiersFresh("gemini", TIERS, { repoDir: repo, stderr: err.sink, spawn }),
      0,
    );
    assert.equal(err.text(), "");
    assert.deepEqual(JSON.parse(seen), [
      process.execPath,
      `${repo}/scripts/build-components.ts`,
      "--target",
      "gemini",
      "--tier",
      "library",
      "--tier",
      "community",
      "--tier",
      "org",
    ]);
  });

  test("the default spawn runs the build script with the shell's arguments", () => {
    const repo = sandbox(
      "console.log(JSON.stringify(process.argv.slice(2)));\nprocess.exitCode = 5;\n",
    );
    const err = collect();
    assert.equal(
      ensureOverlayTiersFresh("copilot", ["org"], { repoDir: repo, stderr: err.sink }),
      5,
    );
    assert.match(err.text(), /\(exit 5\)\.\n/);
    assert.match(err.text(), /\["--target","copilot","--tier","org"\]\n$/);
    assert.match(err.text(), new RegExp(`  - ${repo}/dist/org/\\.github\\n`));
  });

  test("the spawn is made with an array of arguments, never through bash", () => {
    const repo = sandbox();
    const calls: Array<{ command: string; args: unknown }> = [];
    const spawn: SpawnFn = (command, args) => {
      calls.push({ command, args });
      return { status: 0, output: "" };
    };
    ensureOverlayTiersFresh("antigravity", ["library"], { repoDir: repo, spawn });
    assert.equal(calls.length, 1);
    assert.ok(Array.isArray(calls[0]?.args));
    assert.notEqual(path.basename(calls[0]?.command ?? ""), "bash");
    assert.ok(!(calls[0]?.args as string[]).some((a) => a.includes("build-components.sh")));
  });

  test("the cli-to-root map prunes .claude, .gemini, .github and .agents", () => {
    const spawn: SpawnFn = () => ({ status: 0, output: "" });
    for (const [cli, root] of [
      ["claude", ".claude"],
      ["gemini", ".gemini"],
      ["copilot", ".github"],
      ["antigravity", ".agents"],
    ] as const) {
      const repo = fs.mkdtempSync(path.join(tmp, "m"));
      fs.mkdirSync(`${repo}/dist/org/${root}`, { recursive: true });
      fs.mkdirSync(`${repo}/dist/org/.other`, { recursive: true });
      assert.equal(ensureOverlayTiersFresh(cli, ["org"], { repoDir: repo, spawn }), 0);
      assert.equal(fs.existsSync(`${repo}/dist/org/${root}`), false, cli);
      assert.equal(fs.existsSync(`${repo}/dist/org/.other`), true, cli);
    }
  });

  test("the core tier is refused before anything is removed", () => {
    const repo = sandbox();
    const err = collect();
    let spawned = false;
    const spawn: SpawnFn = () => {
      spawned = true;
      return { status: 0, output: "" };
    };
    const status = ensureOverlayTiersFresh("claude", ["library", "core"], {
      repoDir: repo,
      stderr: err.sink,
      spawn,
    });
    assert.equal(status, 2);
    assert.equal(
      err.text(),
      "Internal error: the 'core' tier is never pruned by an install command.\n",
    );
    assert.equal(spawned, false);
    assert.equal(fs.existsSync(`${repo}/dist/library/.claude/skills/residue`), true);
  });

  test("an unknown CLI returns 2 and removes nothing", () => {
    const repo = sandbox();
    const err = collect();
    const status = ensureOverlayTiersFresh("codex", TIERS, { repoDir: repo, stderr: err.sink });
    assert.equal(status, 2);
    assert.equal(err.text(), "Internal error: no staging root is defined for CLI 'codex'.\n");
    assert.equal(fs.existsSync(`${repo}/dist/org/.claude/skills/residue`), true);
  });

  test("an inherited object key is not a CLI", () => {
    const err = collect();
    assert.equal(ensureOverlayTiersFresh("constructor", [], { repoDir: tmp, stderr: err.sink }), 2);
  });

  test("an empty tier or repository directory throws before removing anything", () => {
    const repo = sandbox();
    const spawn: SpawnFn = () => ({ status: 0, output: "" });
    assert.throws(() => ensureOverlayTiersFresh("claude", [""], { repoDir: repo, spawn }));
    assert.throws(() => ensureOverlayTiersFresh("claude", ["org"], { repoDir: "", spawn }));
    assert.equal(fs.existsSync(`${repo}/dist/org/.claude/skills/residue`), true);
  });
});
