// service-exec.test.ts — scripts/lib/service/exec.ts (spec 0252 requirements 5
// and 27): argument arrays without a shell, a timeout, captured output, no
// token in the child environment, and no path to the inspection tools.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, afterEach, test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  executableFor,
  launchDaemon,
  runManager,
  scrubbedEnv,
  setExecutableOverride,
} from "../lib/service/exec.ts";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "service-exec-"));
after(() => fs.rmSync(dir, { recursive: true, force: true }));
afterEach(() => {
  setExecutableOverride("systemctl", null);
  setExecutableOverride("launchctl", null);
  setExecutableOverride("schtasks", null);
});

function fake(name: string, body: string): string {
  const file = path.join(dir, name);
  fs.writeFileSync(file, `#!/bin/sh\n${body}\n`, { mode: 0o755 });
  return file;
}

test("service managers resolve to the operating system's own path, never a bare name on Windows", () => {
  assert.equal(
    executableFor("schtasks", "win32", { SystemRoot: "D:\\Win" }),
    "D:\\Win\\System32\\schtasks.exe",
  );
  assert.equal(executableFor("schtasks", "win32", {}), "C:\\Windows\\System32\\schtasks.exe");
  assert.equal(executableFor("launchctl", "darwin"), "/bin/launchctl");
  assert.equal(
    executableFor("systemctl", "linux", {}, (f) => f === "/bin/systemctl"),
    "/bin/systemctl",
  );
  assert.equal(
    executableFor("systemctl", "linux", {}, () => false),
    "systemctl",
  );
  setExecutableOverride("schtasks", "/seam/schtasks");
  assert.equal(executableFor("schtasks", "win32", {}), "/seam/schtasks");
  setExecutableOverride("schtasks", null);
});

test("the seam replaces the executable and can be removed", () => {
  assert.equal(executableFor("systemctl"), "systemctl");
  setExecutableOverride("systemctl", "/x/fake");
  assert.equal(executableFor("systemctl"), "/x/fake");
  setExecutableOverride("systemctl", null);
  assert.equal(executableFor("systemctl"), "systemctl");
});

test(
  "captures stdout, stderr and status; arguments arrive verbatim, unexpanded",
  { skip: process.platform === "win32" },
  () => {
    setExecutableOverride("systemctl", fake("ok", 'printf "%s|" "$@"; echo err >&2; exit 3'));
    const result = runManager("systemctl", ["--user", "$HOME;touch x", "a b", "*"]);
    assert.equal(result.kind, "nonzero");
    assert.equal(result.status, 3);
    assert.equal(result.stdout, "--user|$HOME;touch x|a b|*|");
    assert.equal(result.stderr, "err\n");
    assert.equal(fs.existsSync(path.join(process.cwd(), "x")), false);
  },
);

test("exit status 0 is ok", { skip: process.platform === "win32" }, () => {
  setExecutableOverride("launchctl", fake("zero", "exit 0"));
  assert.equal(runManager("launchctl", ["list"]).kind, "ok");
});

test(
  "a call that outlives its bound is killed and reported as a timeout",
  { skip: process.platform === "win32" },
  () => {
    setExecutableOverride("systemctl", fake("slow", "sleep 5"));
    const started = Date.now();
    const result = runManager("systemctl", [], { timeoutMs: 200 });
    assert.equal(result.kind, "timeout");
    assert.ok(Date.now() - started < 3000);
  },
);

test("a missing program is absent, never a throw", () => {
  setExecutableOverride("systemctl", path.join(dir, "does-not-exist"));
  const result = runManager("systemctl", []);
  assert.equal(result.kind, "absent");
  assert.equal(result.status, null);
});

test(
  "secret-looking environment variables never reach the child",
  { skip: process.platform === "win32" },
  () => {
    setExecutableOverride("systemctl", fake("env", "env"));
    const result = runManager("systemctl", [], {
      env: {
        PATH: "/usr/bin:/bin",
        MEMPALACE_MCP_TOKEN: "s3cret",
        GH_TOKEN: "s3cret",
        KEEP: "yes",
      },
    });
    assert.ok(result.stdout.includes("KEEP=yes"));
    assert.ok(!result.stdout.includes("s3cret"));
    assert.deepEqual(scrubbedEnv({ A: "1", MY_API_KEY: "x", Password: "x" }), { A: "1" });
  },
);

test(
  "launchDaemon starts the program detached and logs to the file",
  { skip: process.platform === "win32" },
  async () => {
    const log = path.join(dir, "daemon.log");
    const { pid } = launchDaemon(fake("daemon", "echo launched"), [], { logFile: log });
    assert.equal(typeof pid, "number");
    for (let i = 0; i < 100 && !(fs.existsSync(log) && fs.statSync(log).size > 0); i++) {
      await new Promise((r) => setTimeout(r, 40));
    }
    assert.equal(fs.readFileSync(log, "utf8"), "launched\n");
    assert.equal((fs.statSync(log).mode & 0o777).toString(8), "600");
  },
);

test("exec.ts has no code path to the inspection tools and no shell", () => {
  const source = fs.readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), "../lib/service/exec.ts"),
    "utf8",
  );
  for (const banned of [
    /netstat/i,
    /powershell/i,
    /\bps\b/,
    /\blsof\b/,
    /\bss\b/,
    /\bexec\(/,
    /execSync/,
    /shell:\s*true/,
  ]) {
    assert.doesNotMatch(source, banned);
  }
  const spawned = [...source.matchAll(/\bspawn(?:Sync)?\(\s*([^,]+),/g)].map((m) => m[1]?.trim());
  assert.deepEqual(spawned, ["executableFor(tool)", "program"]);
});
