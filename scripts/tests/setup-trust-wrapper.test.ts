import assert from "node:assert/strict";
import { test } from "node:test";

import {
  trustWrapperPrefix,
  wrapStdioCommand,
  wrapperProgram,
  wrapperScriptPath,
} from "../lib/setup/trust-wrapper.ts";

const posix = { platform: "linux", home: "/home/a", repoDir: "/repo" } as const;
const win = { platform: "win32", home: "C:\\Users\\a b", repoDir: "C:\\src\\crewrig" } as const;

test("POSIX: bash and the repository wrapper, byte-identical to the shell registration", () => {
  assert.equal(wrapperProgram("darwin"), "bash");
  assert.equal(wrapperScriptPath(posix), "/repo/scripts/lib/tls-exec.sh");
  assert.deepEqual(trustWrapperPrefix(posix), ["bash", "/repo/scripts/lib/tls-exec.sh"]);
});

test("win32: node and the installed TypeScript wrapper, never bash", () => {
  assert.equal(wrapperProgram("win32"), "node");
  assert.equal(wrapperScriptPath(win), "C:\\Users\\a b\\.crewrig\\tls-exec.ts");
  const argv = wrapStdioCommand(win, [
    "npx.cmd",
    "-y",
    "@modelcontextprotocol/server-sequential-thinking",
  ]);
  assert.equal(argv[0], "node");
  assert.ok(!argv.includes("bash"));
  assert.deepEqual(argv.slice(2), [
    "npx.cmd",
    "-y",
    "@modelcontextprotocol/server-sequential-thinking",
  ]);
});

test("the wrapped command words follow the prefix unchanged", () => {
  assert.deepEqual(
    wrapStdioCommand(posix, ["python3", "/repo/scripts/lib/mempalace-http-wrapper.py"]),
    [
      "bash",
      "/repo/scripts/lib/tls-exec.sh",
      "python3",
      "/repo/scripts/lib/mempalace-http-wrapper.py",
    ],
  );
});
