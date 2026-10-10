// setup-stubs.test.ts — the setup stubs answer and record as scripted (spec
// 0256, plan v2 step A3). Every stub runs from a temporary bin directory with
// a temporary HOME; no real setup script and no real home are touched.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { spawnSync } from "node:child_process";

import { CANCEL, PLACEHOLDER_BEARER, installStubs } from "./lib/setup-stubs.ts";
import type { StubOptions } from "./lib/setup-stubs.ts";

function sandbox(options: StubOptions = {}) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "setup-stubs-")));
  const home = path.join(root, "home");
  fs.mkdirSync(home);
  const handle = installStubs(path.join(root, "bin"), options);
  const run = (cmd: string, args: string[], input = "", cwd = root) => {
    const r = spawnSync(path.join(handle.binDir, cmd), args, {
      input,
      cwd,
      encoding: "utf8",
      env: { PATH: `${handle.binDir}:/usr/bin:/bin`, HOME: home },
    });
    return { status: r.status, stdout: r.stdout, stderr: r.stderr };
  };
  return { root, handle, run };
}

test("fzf answers by header, ignores --height/--preview, records the options", () => {
  const { handle, run } = sandbox({ fzf: { "Install Sequential": "no" } });
  const r = run(
    "fzf",
    ["--height", "10%", "--preview", "x", "--header", "Install Sequential Thinking MCP server?"],
    "yes\nno\n",
  );
  assert.equal(r.status, 0);
  assert.equal(r.stdout, "no\n");
  const [rec] = handle.fzfRecords();
  assert.equal(rec?.header, "Install Sequential Thinking MCP server?");
  assert.deepEqual(rec?.options, ["yes", "no"]);
  assert.equal(rec?.unscripted, false);
});

test("fzf unknown header prints the first line and records it unscripted", () => {
  const { handle, run } = sandbox({ fzf: { known: "b" } });
  const r = run("fzf", ["--header=Something else"], "a\nb\n");
  assert.equal(r.stdout, "a\n");
  assert.equal(handle.fzfRecords()[0]?.unscripted, true);
});

test("fzf scripted cancel exits 130; a picker answer names an entry", () => {
  const { handle, run } = sandbox({ fzf: { Apply: CANCEL, Pick: "skill-b" } });
  assert.equal(run("fzf", ["--header", "Apply these?"], "yes\nno\n").status, 130);
  assert.equal(handle.fzfRecords()[0]?.cancelled, true);
  assert.equal(
    run("fzf", ["--header", "Pick components"], "skill-a\nskill-b\n").stdout,
    "skill-b\n",
  );
});

test("claude mcp list, add and remove keep state and record every call", () => {
  const { handle, run } = sandbox({ claudeServers: { seed: "npx seed" } });
  assert.match(run("claude", ["mcp", "list"]).stdout, /^seed: npx seed - ✓ Connected$/m);
  assert.equal(
    run("claude", ["mcp", "add", "--scope", "user", "mempalace", "--", "python3", "-m", "x"])
      .status,
    0,
  );
  assert.deepEqual(handle.claudeServers(), { seed: "npx seed", mempalace: "python3 -m x" });
  assert.match(run("claude", ["mcp", "list"]).stdout, /^mempalace: python3 -m x - ✓ Connected$/m);
  assert.equal(run("claude", ["mcp", "add", "--scope", "user", "mempalace", "--", "y"]).status, 1);
  assert.equal(run("claude", ["mcp", "remove", "--scope", "user", "mempalace"]).status, 0);
  assert.equal(run("claude", ["mcp", "remove", "--scope", "user", "mempalace"]).status, 1);
  assert.deepEqual(Object.keys(handle.claudeServers()), ["seed"]);
  assert.equal(handle.records("claude").length, 6);
});

test("agy, gh, copilot, systemctl, launchctl, pipx exist and record", () => {
  const { handle, run } = sandbox();
  for (const cmd of ["agy", "gh", "copilot", "systemctl", "launchctl", "pipx"]) {
    assert.equal(run(cmd, ["copilot", "--help"]).status, 0);
    assert.deepEqual(handle.records(cmd)[0]?.argv, ["copilot", "--help"]);
  }
});

test("npm ci copies the fixture packages as node_modules markers, and can fail", () => {
  const fx = sandbox();
  const pkgs = path.join(fx.root, "fixture");
  fs.mkdirSync(path.join(pkgs, "js-yaml"), { recursive: true });
  fs.writeFileSync(path.join(pkgs, "js-yaml", "package.json"), "{}");
  const ok = sandbox({ npmFixture: pkgs });
  assert.equal(ok.run("npm", ["ci", "--omit=dev"]).status, 0);
  assert.ok(fs.existsSync(path.join(ok.root, "node_modules", "js-yaml", "package.json")));
  assert.deepEqual(ok.handle.records("npm")[0]?.argv, ["ci", "--omit=dev"]);
  const bad = sandbox({ npmFail: "npm ERR! boom" });
  const r = bad.run("npm", ["ci"]);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /npm ERR! boom/);
  assert.equal(fs.existsSync(path.join(bad.root, "node_modules")), false);
});

test("python3 reports the scripted version, a missing module, a range verdict", () => {
  const code = "from importlib.metadata import version; print(version('mempalace'))";
  assert.equal(
    sandbox({ mempalaceVersion: "3.6.1" }).run("python3", ["-c", code]).stdout,
    "3.6.1\n",
  );
  assert.equal(sandbox({ mempalaceMissing: true }).run("python3", ["-c", code]).status, 1);
  const script = 'mn = Version("3.6.0")\nmx = Version("4.0.0")\n';
  assert.equal(sandbox({ mempalaceVersion: "3.6.1" }).run("python3", ["-"], script).status, 0);
  assert.equal(sandbox({ mempalaceVersion: "4.1.0" }).run("python3", ["-"], script).status, 1);
  assert.equal(sandbox({ noPackaging: true }).run("python3", ["-"], script).status, 1);
});

test("the curl probe stub answers 0 / 1 / 2 as scripted, reading the bearer from stdin", () => {
  const probe = (mode: 0 | 1 | 2, token: string) => {
    const s = sandbox({ probe: mode });
    const r = s.run(
      "curl",
      ["-K", "-", "-s", "-o", "/dev/null", "-w", "%{http_code}", "http://127.0.0.1:1/mcp"],
      `header = "Authorization: Bearer ${token}"\n`,
    );
    assert.equal(s.handle.records("curl")[0]?.["bearer"], token);
    return r.stdout.startsWith("2");
  };
  assert.equal(probe(0, "tok123"), true);
  assert.equal(probe(0, PLACEHOLDER_BEARER), false);
  assert.equal(probe(1, "tok123"), false);
  assert.equal(probe(2, "tok123"), false);
  assert.equal(probe(2, PLACEHOLDER_BEARER), true);
});
