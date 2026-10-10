// setup-sandbox.test.ts — unit tests of the setup sandbox and the real-home guard (spec 0256).

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";

import { realHomeGuard } from "./lib/real-home-guard.ts";
import { IMPL, createSetupSandbox } from "./lib/setup-sandbox.ts";

const temps: string[] = [];
after(() => temps.forEach((dir) => fs.rmSync(dir, { recursive: true, force: true })));

test("environment is hermetic: no inherited CREWRIG_/MEMPALACE_/TLS_/VALIDATION_ variable", () => {
  const poison = ["CREWRIG_X", "MEMPALACE_X", "TLS_X", "VALIDATION_X"];
  for (const key of poison) process.env[key] = "1";
  try {
    const sb = createSetupSandbox();
    const leaked = Object.keys(sb.env).filter((k) =>
      /^(CREWRIG|MEMPALACE|TLS|VALIDATION)_/.test(k),
    );
    assert.deepEqual(leaked, []);
    assert.equal(sb.env["LC_ALL"], "C");
    assert.equal(sb.env["PATH"], sb.bin);
  } finally {
    for (const key of poison) delete process.env[key];
  }
});

test("HOME equals USERPROFILE and lives inside the temporary root", () => {
  const sb = createSetupSandbox();
  assert.equal(sb.env["HOME"], sb.env["USERPROFILE"]);
  assert.equal(sb.env["HOME"], sb.home);
  assert.ok(sb.home.startsWith(sb.root + path.sep));
  assert.notEqual(sb.home, os.userInfo().homedir);
});

test("the repository fixture carries a real .git, identity files and real dependency copies", () => {
  const sb = createSetupSandbox();
  for (const name of ["js-yaml", "argparse"]) {
    const stat = fs.lstatSync(path.join(sb.repo, "node_modules", name));
    assert.ok(stat.isDirectory() && !stat.isSymbolicLink(), `${name} is a real directory`);
  }
  assert.ok(fs.existsSync(path.join(sb.repo, ".git/HEAD")));
  for (const rel of [
    "config/SOUL.md",
    "config/PROFILE.md",
    "package.json",
    "package-lock.json",
    "artifacts/core/rules/60-tools.md",
    "artifacts/core/system-context",
    "hooks",
  ]) {
    assert.ok(fs.existsSync(path.join(sb.repo, rel)), rel);
  }
});

test("omitNodeModules and omitIdentity drop exactly those files", () => {
  const sb = createSetupSandbox({ omitNodeModules: true, omitIdentity: true });
  assert.ok(!fs.existsSync(path.join(sb.repo, "node_modules/js-yaml")));
  assert.ok(!fs.existsSync(path.join(sb.repo, "node_modules/argparse")));
  assert.ok(!fs.existsSync(path.join(sb.repo, "config/SOUL.md")));
  assert.ok(!fs.existsSync(path.join(sb.repo, "config/PROFILE.md")));
  assert.ok(fs.existsSync(path.join(sb.repo, "config/SOUL.md.template")));
});

test("run returns status, stdout and stderr of a fake script, stdin and env reach it", () => {
  const sb = createSetupSandbox();
  const script = path.join(sb.repo, "scripts/fake-entry.sh");
  fs.writeFileSync(script, 'read a\necho "out:$a:$HOME:$EXTRA"\necho err >&2\nexit 3\n');
  const res = sb.run("fake-entry", [], { stdin: "hello\n", env: { EXTRA: "x" } });
  assert.equal(res.status, 3);
  assert.equal(res.stdout, `out:hello:${sb.home}:x\n`);
  assert.equal(res.stderr, "err\n");
  assert.throws(() => sb.run("fake-entry", [], { leg: "ts" }), /does not exist/);
  assert.ok(IMPL.includes("shell"));
});

test("real-home guard passes when nothing changed and reports a change", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "guard-home-"));
  temps.push(home);
  fs.mkdirSync(path.join(home, ".claude/rules"), { recursive: true });
  fs.writeFileSync(path.join(home, ".claude/rules/a.md"), "a");
  const guard = realHomeGuard(home);
  guard.assertUnchanged();
  fs.writeFileSync(path.join(home, ".claude/rules/a.md"), "b");
  fs.writeFileSync(path.join(home, ".claude.json"), '{"mcpServers":{"x":{}}}');
  fs.mkdirSync(path.join(home, ".crewrig"));
  fs.writeFileSync(path.join(home, ".crewrig/x.bak.2"), "");
  assert.throws(
    () => guard.assertUnchanged(),
    (e: unknown) => {
      const text = e instanceof Error ? e.message : "";
      return (
        text.includes("~ changed") && text.includes(".claude.json") && text.includes("x.bak.2")
      );
    },
  );
});

test("the real-home guard sees every location a setup writes, listing usage and server by name", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "guard-extra-"));
  temps.push(home);
  const put = (rel: string, text = "x"): void => {
    fs.mkdirSync(path.dirname(path.join(home, rel)), { recursive: true });
    fs.writeFileSync(path.join(home, rel), text);
  };
  put(".crewrig/usage/journal/live.log");
  fs.mkdirSync(path.join(home, ".mempalace/server/key1"), { recursive: true });
  const guard = realHomeGuard(home);
  guard.assertUnchanged();
  put(".crewrig/usage/journal/live.log", "churn");
  guard.assertUnchanged();
  const effects = [
    ".gemini/00_SOUL.md",
    ".gemini/config/mcp_config.json",
    ".gemini/agents/a.md",
    ".copilot/skills/s/SKILL.md",
    ".crewrig/hooks/h.sh",
    ".crewrig/service-lib/l.sh",
    ".crewrig/mcp-daemon-launcher.sh",
    ".crewrig/usage/new-entry",
    ".config/systemd/user/mempalace-chroma-server.service",
    "Library/LaunchAgents/io.crewrig.test.plist",
    ".mempalace/server/key2/token",
  ];
  for (const rel of effects) {
    put(rel);
    assert.throws(
      () => guard.assertUnchanged(),
      (e: unknown) =>
        e instanceof Error && e.message.includes(path.join(home, rel.split("/token")[0] ?? rel)),
      rel,
    );
    fs.rmSync(path.join(home, rel.startsWith(".mempalace") ? ".mempalace/server/key2" : rel), {
      recursive: true,
      force: true,
    });
    guard.assertUnchanged();
  }
  put("Library/LaunchAgents/com.other.plist");
  put(".config/systemd/user/unrelated.service");
  guard.assertUnchanged();
});
