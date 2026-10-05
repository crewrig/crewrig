// hook-guard-antigravity.test.ts — `hook-wiring.ts guard antigravity-rewrite`: the
// Antigravity CLI named hook `crewrig-worktree-git-guard` in `hooks.json` (spec
// 0248 R29, R30; scenario 22).
//
// The named hook's legacy command is rewritten to the command line the module
// produces for that surface (the guarded form on Windows, in state (e)); the
// `crewrig-mempalace-transcript` named hook and an operator's hook are
// byte-identical; backup-first at 0600; idempotent; a checkout path with
// whitespace on Windows is refused and nothing is written; a `hooks.json` that
// is not a JSON object is refused byte-identical.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, describe, test } from "node:test";

import {
  backups,
  CLIS,
  guardCommands,
  handler,
  makeCheckout,
  mode,
  wiring,
  type Checkout,
  type Json,
} from "./lib/guard-wiring-fixtures.ts";
import { cleanupAll, read } from "./lib/worktree-fixtures.ts";

after(cleanupAll);

describe("guard antigravity-rewrite (R30)", () => {
  const hooksJson = (co: Checkout, guards: Json[]): Json => ({
    "crewrig-mempalace-transcript": {
      Stop: [handler('bash "/x/hooks/mempalace-transcript.sh" Stop', { timeout: 10 })],
    },
    "crewrig-worktree-git-guard": { PreToolUse: [{ matcher: "run_command", hooks: guards }] },
    mine: { PreToolUse: [handler(`node "${co.guard}" --strict`)] },
  });
  const run = (file: string, co: Checkout, ...extra: string[]) =>
    wiring("guard", "antigravity-rewrite", "--hooks", file, "--repo", co.repo, ...extra);

  test("the named hook's legacy command is rewritten; the transcript hook and an operator hook are byte-identical", () => {
    const co = makeCheckout();
    const file = path.join(path.dirname(co.repo), "hooks.json");
    const config = hooksJson(co, [
      handler(`bash "${path.join(co.repo, "hooks", "worktree-git-guard.sh")}"`, { timeout: 5 }),
    ]);
    fs.writeFileSync(file, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o644 });
    const res = run(file, co);
    assert.equal(res.status, 0, res.stderr);
    const after = JSON.parse(read(file)) as Json;
    assert.deepEqual(after["crewrig-mempalace-transcript"], config["crewrig-mempalace-transcript"]);
    assert.deepEqual(after["mine"], config["mine"]);
    const guard = after["crewrig-worktree-git-guard"] as {
      PreToolUse: Array<{ matcher: string; hooks: Json[] }>;
    };
    assert.equal(guard.PreToolUse[0]?.matcher, "run_command");
    assert.deepEqual(guard.PreToolUse[0]?.hooks, [handler(`node "${co.guard}"`, { timeout: 5 })]);
    assert.equal(backups(file).length, 1);
    assert.equal(mode(file), 0o600);
  });

  test("a second run is idempotent: nothing written, no new backup", () => {
    const co = makeCheckout();
    const file = path.join(path.dirname(co.repo), "hooks.json");
    fs.writeFileSync(
      file,
      JSON.stringify(
        hooksJson(co, [handler(`bash "${path.join(co.repo, "hooks", "worktree-git-guard.sh")}"`)]),
      ),
    );
    run(file, co);
    const first = read(file);
    const again = run(file, co);
    assert.equal(again.status, 0, again.stderr);
    assert.equal(read(file), first);
    assert.equal(backups(file).length, 1);
  });

  test("on Windows (state e) the rewrite writes the guarded form", () => {
    const co = makeCheckout();
    const file = path.join(path.dirname(co.repo), "hooks.json");
    fs.writeFileSync(
      file,
      JSON.stringify(
        hooksJson(co, [handler(`bash "${path.join(co.repo, "hooks", "worktree-git-guard.sh")}"`)]),
      ),
    );
    const res = run(file, co, "--platform", "win32");
    assert.equal(res.status, 0, res.stderr);
    assert.deepEqual(
      guardCommands((JSON.parse(read(file)) as Json)["crewrig-worktree-git-guard"]),
      [`set NoDefaultCurrentDirectoryInExePath=1&& node ${co.guard}`],
    );
  });

  test("from a checkout path with whitespace on Windows the module refuses: nothing is written", () => {
    const co = makeCheckout("Ana Diaz");
    const file = path.join(path.dirname(co.repo), "hooks.json");
    const text = JSON.stringify(
      hooksJson(co, [handler(`bash "${path.join(co.repo, "hooks", "worktree-git-guard.sh")}"`)]),
    );
    fs.writeFileSync(file, text);
    const res = run(file, co, "--platform", "win32");
    assert.equal(res.status, 0, res.stderr);
    assert.match(res.stdout + res.stderr, /whitespace/);
    assert.equal(read(file), text);
    assert.equal(backups(file).length, 0);
  });

  test("a hooks.json that is not a JSON object is refused byte-identical", () => {
    const co = makeCheckout();
    const file = path.join(path.dirname(co.repo), "hooks.json");
    fs.writeFileSync(file, "[]");
    const res = run(file, co);
    assert.equal(res.status, 1);
    assert.equal(read(file), "[]");
    assert.equal(backups(file).length, 0);
  });
});

test("every CLI of the wiring tool is covered by this suite", () => {
  assert.deepEqual([...CLIS].sort(), ["antigravity", "claude", "copilot", "gemini"]);
});
