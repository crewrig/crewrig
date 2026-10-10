import assert from "node:assert/strict";
import { test } from "node:test";

import { CLIS } from "../lib/setup/context.ts";
import type { Cli } from "../lib/setup/context.ts";
import {
  mempalaceStdioCommand,
  mempalaceStdioEntry,
  npxName,
  sequentialThinkingCommand,
  sequentialThinkingEntry,
} from "../lib/setup/mempalace-stdio.ts";
import type { WrapperEnv } from "../lib/setup/trust-wrapper.ts";

const posix: WrapperEnv = { platform: "linux", home: "/home/a", repoDir: "/opt/crew rig" };
const win: WrapperEnv = {
  platform: "win32",
  home: "C:\\Users\\Jane Doe",
  repoDir: "C:\\Program Files\\crewrig",
};
const PY = "/usr/bin/python3";
const WIN_PY = "C:\\Python 3\\python.exe";

// The shell text, copied: `$REPO_DIR/scripts/lib/tls-exec.sh`, `$py`, the wrapper path, and the
// sequential-thinking words of setup-*-interactive.sh and gemini_framework_mcp.
const TLS = `${posix.repoDir}/scripts/lib/tls-exec.sh`;
const WRAPPER = `${posix.repoDir}/scripts/lib/mempalace-http-wrapper.py`;
const SEQ = ["npx", "-y", "@modelcontextprotocol/server-sequential-thinking"];

function shellMempalace(cli: Cli): string {
  const args = [TLS, PY, WRAPPER];
  switch (cli) {
    case "claude":
      return JSON.stringify({ type: "stdio", command: "bash", args, env: {} });
    case "copilot":
      return JSON.stringify({ type: "stdio", command: "bash", args });
    default:
      return JSON.stringify({ command: "bash", args });
  }
}

function shellSeq(cli: Cli): string {
  const args = [TLS, ...SEQ];
  switch (cli) {
    case "claude":
      return JSON.stringify({ type: "stdio", command: "bash", args, env: {} });
    case "copilot":
      return JSON.stringify({ type: "stdio", command: "bash", args });
    default:
      return JSON.stringify({ command: "bash", args });
  }
}

test("npxName: npx on POSIX, npx.cmd on win32", () => {
  assert.equal(npxName("linux"), "npx");
  assert.equal(npxName("darwin"), "npx");
  assert.equal(npxName("win32"), "npx.cmd");
});

test("POSIX commands equal the shell argv", () => {
  assert.deepEqual(mempalaceStdioCommand(posix, PY), ["bash", TLS, PY, WRAPPER]);
  assert.deepEqual(sequentialThinkingCommand(posix, "npx"), ["bash", TLS, ...SEQ]);
});

for (const cli of CLIS) {
  test(`POSIX ${cli}: entries are byte-identical to the shell's (keys in order)`, () => {
    assert.equal(JSON.stringify(mempalaceStdioEntry(cli, posix, PY)), shellMempalace(cli));
    assert.equal(JSON.stringify(sequentialThinkingEntry(cli, posix)), shellSeq(cli));
  });
}

test("the entry key order per CLI", () => {
  const keys = (cli: Cli): string[] => Object.keys(mempalaceStdioEntry(cli, posix, PY));
  assert.deepEqual(keys("claude"), ["type", "command", "args", "env"]);
  assert.deepEqual(keys("copilot"), ["type", "command", "args"]);
  assert.deepEqual(keys("gemini"), ["command", "args"]);
  assert.deepEqual(keys("antigravity"), ["command", "args"]);
});

test("win32: node, the home wrapper, npx.cmd; a home with spaces stays one argv element", () => {
  const wrapper = "C:\\Users\\Jane Doe\\.crewrig\\tls-exec.ts";
  assert.deepEqual(mempalaceStdioCommand(win, WIN_PY), [
    "node",
    wrapper,
    WIN_PY,
    "C:\\Program Files\\crewrig\\scripts\\lib\\mempalace-http-wrapper.py",
  ]);
  assert.deepEqual(sequentialThinkingCommand(win, npxName("win32")), [
    "node",
    wrapper,
    "npx.cmd",
    "-y",
    "@modelcontextprotocol/server-sequential-thinking",
  ]);
  for (const cli of CLIS) {
    const seq = sequentialThinkingEntry(cli, win);
    assert.equal(seq.command, "node");
    assert.deepEqual(seq.args.slice(0, 2), [wrapper, "npx.cmd"]);
    const mem = mempalaceStdioEntry(cli, win, WIN_PY);
    assert.equal(mem.command, "node");
    assert.equal(mem.args[0], wrapper);
    assert.equal(mem.args[1], WIN_PY);
  }
});

test("win32: no stdio command of any builder names bash (requirement 39)", () => {
  const argvs: (readonly string[])[] = [
    mempalaceStdioCommand(win, WIN_PY),
    sequentialThinkingCommand(win, npxName("win32")),
  ];
  for (const cli of CLIS) {
    for (const e of [mempalaceStdioEntry(cli, win, WIN_PY), sequentialThinkingEntry(cli, win)]) {
      argvs.push([e.command, ...e.args]);
    }
  }
  for (const argv of argvs) {
    for (const word of argv) {
      assert.ok(!/\bbash\b/.test(word), `win32 argv names bash: ${JSON.stringify(argv)}`);
    }
  }
});
