// Tests for `hooks install|uninstall|status` of scripts/lib/ci-pre-push/hooks.ts (spec 0279 R15):
// only the local config of the checkout is written, never the global one or HOME.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { runHooksCommand } from "../lib/ci-pre-push/hooks.ts";
import { gitEnv, newRepo, writeRel } from "./lib/governance-git-fixture.ts";
import { git } from "./lib/governance-git-fixture.ts";

function crewrig(): string {
  const dir = newRepo();
  writeRel(dir, ".githooks/pre-push", "#!/usr/bin/env node\n");
  writeRel(dir, "taskfiles/ci.yml", "version: '3.39'\ntasks: {}\n");
  return dir;
}

const localValue = (dir: string): string => {
  try {
    return git(dir, ["config", "--local", "--get", "core.hooksPath"]);
  } catch {
    return "";
  }
};

const homeSnapshot = (): { home: string; listing: string[]; global: string } => {
  const env = gitEnv();
  const home = env["HOME"] ?? "";
  const gc = env["GIT_CONFIG_GLOBAL"] ?? "";
  return {
    home,
    listing: fs.readdirSync(home).sort(),
    global: fs.existsSync(gc) ? fs.readFileSync(gc, "utf8") : "<absent>",
  };
};

describe("ci-pre-push hooks install|uninstall|status", () => {
  const before = homeSnapshot();

  it("installs, is idempotent, reports status and uninstalls", () => {
    const dir = crewrig();
    const env = gitEnv();
    assert.match(runHooksCommand("status", dir, env).out, /not set/);
    const first = runHooksCommand("install", dir, env);
    assert.equal(first.code, 0, first.err);
    assert.match(first.out, /enabled: core\.hooksPath=\.githooks/);
    assert.equal(localValue(dir), ".githooks");
    const again = runHooksCommand("install", dir, env);
    assert.equal(again.code, 0);
    assert.match(again.out, /already enabled/);
    assert.match(runHooksCommand("status", dir, env).out, /core\.hooksPath=\.githooks/);
    const off = runHooksCommand("uninstall", dir, env);
    assert.equal(off.code, 0);
    assert.equal(localValue(dir), "");
    assert.match(runHooksCommand("uninstall", dir, env).out, /already disabled/);
  });

  it("refuses to replace a foreign value, unless FORCE=true", () => {
    const dir = crewrig();
    git(dir, ["config", "--local", "core.hooksPath", "/some/other/hooks"]);
    const env = gitEnv();
    const refused = runHooksCommand("install", dir, env);
    assert.equal(refused.code, 1);
    assert.match(refused.err, /already set to '\/some\/other\/hooks'.*FORCE=true/);
    assert.equal(localValue(dir), "/some/other/hooks");
    const unins = runHooksCommand("uninstall", dir, env);
    assert.equal(unins.code, 1);
    assert.equal(localValue(dir), "/some/other/hooks");
    const forced = runHooksCommand("install", dir, { ...env, FORCE: "true" });
    assert.equal(forced.code, 0, forced.err);
    assert.equal(localValue(dir), ".githooks");
  });

  it("refuses outside a CrewRig checkout and writes nothing", () => {
    const dir = newRepo();
    const r = runHooksCommand("install", dir, gitEnv());
    assert.equal(r.code, 1);
    assert.match(r.err, /is not a CrewRig checkout/);
    assert.equal(localValue(dir), "");
    assert.equal(fs.existsSync(path.join(dir, ".git", "hooks", "pre-push")), false);
  });

  it("refuses an unknown subcommand", () => {
    const r = runHooksCommand("bogus", crewrig(), gitEnv());
    assert.equal(r.code, 1);
    assert.match(r.err, /usage:/);
  });

  it("leaves the temporary HOME and the global git config unchanged", () => {
    const dir = crewrig();
    const env = gitEnv();
    runHooksCommand("install", dir, env);
    runHooksCommand("uninstall", dir, env);
    const after = homeSnapshot();
    assert.equal(after.home, before.home);
    assert.deepEqual(after.listing, before.listing);
    assert.equal(after.global, before.global);
  });
});
