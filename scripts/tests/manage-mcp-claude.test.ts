// manage-mcp-claude.test.ts — tests of scripts/lib/manage/mcp-claude.ts, the twin of
// `register_mcp_server` of manage-claude-component.sh (spec 0255 R8, R24). `claude` is a
// stand-in behind the spawn seam; the file on PATH only has to exist.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";

import type { Io } from "../lib/extension/types.ts";
import { ExtError } from "../lib/extension/types.ts";
import { registerClaudeMcp } from "../lib/manage/mcp-claude.ts";
import type { ClaudeMcpCtx, SpawnFn } from "../lib/manage/mcp-claude.ts";

let work: string;
let bin: string;
let n = 0;

before(() => {
  work = fs.mkdtempSync(path.join(os.tmpdir(), "manage-mcp-claude-"));
  bin = path.join(work, "bin");
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, "claude"), "", { mode: 0o755 });
});
after(() => {
  fs.rmSync(work, { recursive: true, force: true });
});

interface Call {
  file: string;
  args: readonly string[];
}

function setup(declaration: string, listing: string, addStatus: number | null = 0) {
  const decl = path.join(work, `case-${n++}`, "playwright.json");
  fs.mkdirSync(path.dirname(decl));
  fs.writeFileSync(decl, declaration);
  const calls: Call[] = [];
  const spawn: SpawnFn = (file, args) => {
    calls.push({ file, args });
    if (args[1] === "list") return { status: 0, stdout: listing };
    return { status: addStatus, stdout: "" };
  };
  const out: string[] = [];
  const io: Io = { out: (l) => out.push(l), err: () => {}, errRaw: () => {} };
  const ctx: ClaudeMcpCtx = { env: { PATH: bin }, platform: process.platform, spawn };
  return { decl, calls, out, io, ctx };
}

describe("registerClaudeMcp", () => {
  test("registers with an argument array and prints the registered line", () => {
    const s = setup('{"command":"npx","args":["-y","@x/y","--flag=a b"]}', "other: ok\n");
    assert.deepEqual(registerClaudeMcp(s.decl, s.ctx, s.io), { status: 0, abort: false });
    assert.deepEqual(s.out, ["  playwright: registered (scope=user)"]);
    assert.equal(s.calls.length, 2);
    assert.equal(path.basename(s.calls[0]?.file ?? ""), "claude");
    assert.deepEqual(s.calls[0]?.args, ["mcp", "list"]);
    assert.deepEqual(s.calls[1]?.args, [
      "mcp",
      "add",
      "--scope",
      "user",
      "playwright",
      "--",
      "npx",
      "-y",
      "@x/y",
      "--flag=a b",
    ]);
  });

  test("an entry listed as `name: ...` is already registered and nothing is added", () => {
    const s = setup('{"command":"npx"}', "a: x\nplaywright: npx - Connected\n");
    assert.deepEqual(registerClaudeMcp(s.decl, s.ctx, s.io), { status: 0, abort: false });
    assert.deepEqual(s.out, ["  playwright: already registered, skipping"]);
    assert.equal(s.calls.length, 1);
  });

  test("a longer name, or the name without a following blank, is not a match", () => {
    for (const listing of ["playwright-extra: x\n", "playwright:x\n", "  playwright: x\n"]) {
      const s = setup('{"command":"npx"}', listing);
      registerClaudeMcp(s.decl, s.ctx, s.io);
      assert.deepEqual(s.out, ["  playwright: registered (scope=user)"], listing);
    }
  });

  test("a name's regex characters match literally", () => {
    const s = setup('{"command":"npx"}', "playwrightX: x\n");
    s.ctx = { ...s.ctx };
    const dotted = path.join(path.dirname(s.decl), "play.wright.json");
    fs.copyFileSync(s.decl, dotted);
    registerClaudeMcp(dotted, s.ctx, s.io);
    assert.deepEqual(s.out, ["  play.wright: registered (scope=user)"]);
  });

  test("a declaration without a command (absent, null, false, empty) is skipped with status 1", () => {
    for (const body of [
      '{"args":["x"]}',
      '{"command":null}',
      '{"command":false}',
      '{"command":""}',
      "[]",
    ]) {
      const s = setup(body, "");
      assert.deepEqual(registerClaudeMcp(s.decl, s.ctx, s.io), { status: 1, abort: false });
      assert.deepEqual(s.out, ["  playwright: missing 'command' field, skipping"], body);
      assert.equal(s.calls.length, 1);
    }
  });

  test("a failed add prints the FAILED line with the manual command and returns 1", () => {
    const s = setup('{"command":"npx","args":["-y","pkg"]}', "", 1);
    assert.deepEqual(registerClaudeMcp(s.decl, s.ctx, s.io), { status: 1, abort: false });
    assert.deepEqual(s.out, [
      "  playwright: FAILED — re-run manually: claude mcp add --scope user playwright -- npx -y pkg",
    ]);
  });

  test("a failed add without arguments leaves the shell's trailing blank", () => {
    const s = setup('{"command":"npx"}', "", null);
    registerClaudeMcp(s.decl, s.ctx, s.io);
    assert.deepEqual(s.out, [
      "  playwright: FAILED — re-run manually: claude mcp add --scope user playwright -- npx ",
    ]);
  });

  test("args that are not strings follow jq -r; a newline splits an argument, as the read loop did", () => {
    const s = setup('{"command":"c","args":[1,true,null,"a\\nb",""]}', "");
    registerClaudeMcp(s.decl, s.ctx, s.io);
    assert.deepEqual(s.calls[1]?.args.slice(7), ["1", "true", "null", "a", "b", ""]);
  });

  test("an absent claude binary prints the diagnostic on stdout, spawns nothing and aborts", () => {
    const s = setup('{"command":"npx"}', "");
    s.ctx = { ...s.ctx, env: { PATH: path.join(work, "empty") } };
    assert.deepEqual(registerClaudeMcp(s.decl, s.ctx, s.io), { status: 1, abort: true });
    assert.deepEqual(s.out, ["Error: 'claude' CLI required to register MCP servers."]);
    assert.equal(s.calls.length, 0);
  });

  test("a declaration that is not JSON throws an ExtError naming the file", () => {
    const s = setup("{nope", "");
    assert.throws(
      () => registerClaudeMcp(s.decl, s.ctx, s.io),
      (error: unknown) => error instanceof ExtError && error.message.startsWith(s.decl),
    );
  });

  test("Windows: claude resolves through the PATH search and starts as a plain argument array", () => {
    const s = setup('{"command":"npx","args":["a"]}', "");
    const ctx: ClaudeMcpCtx = {
      ...s.ctx,
      platform: "win32",
      env: { PATH: "C:\\bin" },
      isFile: (p) => p.toLowerCase() === "c:\\bin\\claude.exe",
    };
    assert.deepEqual(registerClaudeMcp(s.decl, ctx, s.io), { status: 0, abort: false });
    assert.equal(s.calls[0]?.file, "C:\\bin\\claude.EXE");
    assert.deepEqual(s.calls[1]?.args, [
      "mcp",
      "add",
      "--scope",
      "user",
      "playwright",
      "--",
      "npx",
      "a",
    ]);
  });

  test("Windows: no claude on PATH aborts like the POSIX case", () => {
    const s = setup('{"command":"npx"}', "");
    const ctx: ClaudeMcpCtx = {
      ...s.ctx,
      platform: "win32",
      env: { PATH: "C:\\bin" },
      isFile: () => false,
    };
    assert.deepEqual(registerClaudeMcp(s.decl, ctx, s.io), { status: 1, abort: true });
  });
});
