// crewrig-setup-clone.test.ts — `setup` on a git clone of the organization repository (spec 0315 R5-R7, R12, R14):
// the clone's `git status` does not change, the `.gitignore` is only read and warned about, reserved organization
// hooks are announced and not installed, and the temporary compile directory never outlives the run.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";
import {
  homeOutsideVersions,
  snapshot,
  trackRigs,
  trackServers,
  treeList,
} from "./lib/launcher-rig.ts";
import {
  AGENT_MD,
  CLI_NAMES,
  IGNORE_TEXT,
  SKILL_MD,
  answerArgs,
  newWorld,
  porcelain,
  treeDigest,
  withUpstream,
  type CliName,
  type World,
} from "./lib/org-rig.ts";

const rigs = trackRigs();
const servers = trackServers();

const SKILL = "artifacts/org/skills/acme-skill/SKILL.md";
const AGENT = "artifacts/org/agents/acme-agent/AGENT.md";
const COMPONENTS = { [SKILL]: SKILL_MD("acme-skill"), [AGENT]: AGENT_MD("acme-agent") };

/** Home paths (outside the version cache) that mention `needle`. */
function homeMatches(world: World, needle: string): string[] {
  return treeList(world.rig.home).filter(
    (entry) => !entry.startsWith(".crewrig/versions/") && entry.includes(needle),
  );
}

describe("R6, R12: the clone is left exactly as it was", () => {
  test("git status is empty before and after, and the .gitignore is byte-identical", async () => {
    const world = await newWorld(rigs, servers);
    const { clone } = withUpstream(
      world.rig,
      world.makeOrg({ files: COMPONENTS, gitignore: IGNORE_TEXT }),
    );
    const ignore = fs.readFileSync(path.join(clone, ".gitignore"));
    assert.equal(porcelain(world.rig, clone), "");

    for (const cli of CLI_NAMES) {
      const run = await world.setup(clone, cli);
      assert.equal(run.code, 0, `${cli}: ${run.out}`);
    }

    assert.equal(porcelain(world.rig, clone), "");
    assert.deepEqual(fs.readFileSync(path.join(clone, ".gitignore")), ignore);
    assert.ok(
      !fs.existsSync(path.join(clone, "dist")),
      "setup builds into no directory of the clone",
    );
    assert.ok(!fs.existsSync(path.join(clone, "config", "SOUL.md")));
    assert.ok(!fs.existsSync(path.join(clone, "config", "PROFILE.md")));
  });

  test("setup writes no template, in the clone or in the home", async () => {
    const world = await newWorld(rigs, servers);
    const dir = world.makeOrg({ gitignore: IGNORE_TEXT });

    await world.setup(dir, "claude");

    const outside = [...treeList(dir), ...treeList(world.rig.home)].filter(
      (entry) => !entry.startsWith(".crewrig/versions/") && /\.template$/.test(entry),
    );
    // config/*.template of the organization directory came from the fixture: only ORGANIZATION/TOOLS are absent.
    assert.deepEqual(outside, []);
  });
});

describe("R7: setup warns about missing ignore lines and goes on", () => {
  const warning = (out: string): string[] =>
    out.split("\n").filter((line) => /warning: \.gitignore lacks/.test(line));

  for (const [label, gitignore, missing] of [
    ["an absent .gitignore", undefined, ["config/SOUL.md", "config/PROFILE.md"]],
    ["one lacking config/PROFILE.md", "config/SOUL.md\ndist/\n", ["config/PROFILE.md"]],
    ["one lacking config/SOUL.md", "config/PROFILE.md\n", ["config/SOUL.md"]],
  ] as const) {
    test(`${label}: one warning naming ${missing.join(" and ")}, exit 0, file untouched`, async () => {
      const world = await newWorld(rigs, servers);
      const dir = world.makeOrg(gitignore === undefined ? {} : { gitignore });
      const file = path.join(dir, ".gitignore");
      const before = fs.existsSync(file) ? fs.readFileSync(file) : undefined;

      const run = await world.setup(dir, "claude");

      assert.equal(run.code, 0, run.out);
      const lines = warning(run.out);
      assert.equal(lines.length, 1, run.out);
      for (const name of missing) assert.ok(lines[0]?.includes(name), lines[0]);
      assert.match(lines[0] ?? "", /build/);
      assert.deepEqual(fs.existsSync(file) ? fs.readFileSync(file) : undefined, before);
    });
  }

  test("a complete .gitignore, with the slash-prefixed form, prints no warning", async () => {
    const world = await newWorld(rigs, servers);
    const dir = world.makeOrg({ gitignore: "/config/SOUL.md\nconfig/PROFILE.md  \n" });

    const run = await world.setup(dir, "claude");

    assert.equal(run.code, 0, run.out);
    assert.deepEqual(warning(run.out), []);
  });
});

describe("R5, R6: organization hooks are reserved, not installed", () => {
  test("setup prints the notice, wires the framework hooks, and installs nothing from the directory", async () => {
    const world = await newWorld(rigs, servers);
    const dir = world.makeOrg({
      gitignore: IGNORE_TEXT,
      files: { "artifacts/community/hooks/guard.sh": "#!/bin/sh\n" },
    });

    const run = await world.setup(dir, "claude");

    assert.equal(run.code, 0, run.out);
    assert.equal(
      (run.out.match(/organization hooks[^\n]*not installed by this version/g) ?? []).length,
      1,
    );
    const settings = fs.readFileSync(path.join(world.rig.home, ".claude", "settings.json"), "utf8");
    assert.ok(settings.includes("usage-capture.ts"), "the framework hooks are wired");
    assert.ok(!settings.includes("guard.sh"));
    assert.deepEqual(homeMatches(world, "guard.sh"), []);
  });
});

describe("R6: the temporary compile directory is always removed", () => {
  for (const [label, files, code] of [
    ["success", COMPONENTS, 0],
    [
      "a compile failure",
      { [SKILL]: SKILL_MD("acme-skill").replace("name: acme-skill", "name: ../evil") },
      1,
    ],
  ] as const) {
    test(`${label}: no crewrig temporary directory remains, nothing in the clone changed`, async () => {
      const world = await newWorld(rigs, servers);
      const dir = world.makeOrg({ files, gitignore: IGNORE_TEXT });
      const tmp = path.join(world.rig.root, "tmp");
      fs.mkdirSync(tmp);
      const before = snapshot(dir);

      const run = await world.setup(dir, "claude", [], {
        env: { TMPDIR: tmp, TMP: tmp, TEMP: tmp },
      });

      assert.equal(run.code, code, run.out);
      assert.deepEqual(fs.readdirSync(tmp), []);
      assert.deepEqual(snapshot(dir), before);
      if (code === 1)
        assert.deepEqual(homeOutsideVersions(world.rig), [".crewrig/"], "nothing installed");
    });
  }
});
