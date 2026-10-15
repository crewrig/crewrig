// extension-hooks-antigravity-guard.test.ts — the Antigravity hook line is guarded on a Windows
// build host (spec 0258 delta-01, requirement 17). `cmd.exe` looks a bare `node` up in the
// working directory before `PATH` (CWE-427), so on `win32` the line carries `GUARDED_PREFIX`;
// on every other platform it is the bare plugin-relative `node "hooks/<hook>.ts"`, and the other
// three targets never change. The platform is injected through `ctx.platform`, as the entries do.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";

import { GUARDED_PREFIX } from "../lib/hook-command.ts";
import { renderHookFile } from "../lib/extension/hooks-emit.ts";
import { createGapChannel } from "../lib/extension/gap-record.ts";
import { writeJsonCompact } from "../lib/extension/json-write.ts";
import { readManifest } from "../lib/extension/manifest.ts";
import { renderPlugin } from "../lib/extension/plugin-delegate.ts";
import type { JsonValue, PluginTarget } from "../lib/extension/types.ts";
import { REPO } from "./lib/build-fixture-tree.ts";
import { makeCtx, tmpRoot } from "./lib/plugin-ctx.ts";

const HELLO_WORLD = path.join(REPO, "extensions", "core", "hello-world");
const BARE = 'node "hooks/shell-logger.ts"';

interface HookFileJson {
  readonly [id: string]: Record<
    string,
    readonly { matcher: string; hooks: readonly { command: string }[] }[]
  >;
}

/** Build `hello-world` for `target` on a build host reporting `platform`; return its `hooks.json` text. */
async function build(
  target: PluginTarget,
  platform: NodeJS.Platform,
  mutate?: (text: string) => string,
): Promise<string> {
  const root = tmpRoot();
  const repo = path.join(root, "repo");
  const ext = path.join(root, "hello-world");
  fs.mkdirSync(repo);
  fs.cpSync(HELLO_WORLD, ext, {
    recursive: true,
    filter: (src) => !src.split(path.sep).includes("node_modules"),
  });
  const cap = makeCtx(repo);
  const manifest = readManifest(path.join(ext, "extension.json"));
  const rc = await renderPlugin(
    { ...cap.ctx, platform },
    target,
    ext,
    manifest,
    "hello-world",
    createGapChannel(),
  );
  assert.equal(rc, 0, cap.err.join("\n"));
  const out =
    target === "claude"
      ? path.join(ext, "dist-claude-plugin", "hello-world", "hooks", "hooks.json")
      : path.join(repo, `dist-${target}-plugin`, "hello-world", "hooks.json");
  const text = fs.readFileSync(out, "utf8");
  return mutate === undefined ? text : mutate(text);
}

/** The `shell-logger` command of an Antigravity `hooks.json` (the only hook that maps there). */
function shellLoggerCommand(text: string): string {
  const file = JSON.parse(text) as HookFileJson;
  const events = file["hello-world-hooks"];
  assert.ok(events !== undefined);
  const commands = Object.values(events).flatMap((items) =>
    items.flatMap((item) => item.hooks.map((h) => h.command)),
  );
  assert.equal(commands.length, 1);
  return commands[0] ?? "";
}

describe("Antigravity hook line on a Windows build host", () => {
  test("the constant is the one spec 0243 delta-03 adopted", () => {
    assert.equal(GUARDED_PREFIX, "set NoDefaultCurrentDirectoryInExePath=1&& ");
  });

  test("win32 writes the guarded line", async () => {
    const command = shellLoggerCommand(await build("antigravity", "win32"));
    assert.equal(command, `set NoDefaultCurrentDirectoryInExePath=1&& ${BARE}`);
  });

  test("linux and darwin write the bare plugin-relative line", async () => {
    for (const platform of ["linux", "darwin"] as const) {
      assert.equal(shellLoggerCommand(await build("antigravity", platform)), BARE, platform);
    }
  });

  test("the Claude Code and Copilot lines do not depend on the platform", async () => {
    for (const target of ["claude", "copilot"] as const) {
      assert.equal(
        await build(target, "win32"),
        await build(target, "linux"),
        `${target} hooks.json differs between win32 and linux`,
      );
    }
  });

  test("mutation: a win32 build that drops the prefix is caught", async () => {
    const mutated = await build("antigravity", "win32", (text) =>
      text.replaceAll(GUARDED_PREFIX, ""),
    );
    assert.notEqual(shellLoggerCommand(mutated), `${GUARDED_PREFIX}${BARE}`);
    assert.equal(shellLoggerCommand(mutated), BARE);
  });

  test("renderHookFile guards every Antigravity line on win32 and no other target", () => {
    const manifest = readManifest(path.join(HELLO_WORLD, "extension.json")) as Map<
      string,
      JsonValue
    >;
    const table = makeCtx(tmpRoot()).ctx.table;
    for (const target of ["claude", "gemini", "copilot"] as const) {
      const win = renderHookFile(target, manifest, table, "win32");
      const lin = renderHookFile(target, manifest, table, "linux");
      assert.deepEqual(win, lin, target);
    }
    const file = renderHookFile("antigravity", manifest, table, "win32");
    assert.ok(file !== null);
    assert.ok(writeJsonCompact(file.value).includes(`"command":"${GUARDED_PREFIX}node `));
  });
});
