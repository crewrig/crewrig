// crewrig-setup.test.ts — `node crewrig setup --cli <name>` end to end (spec 0315 R2, R3, R6, R7, R12, R14).
//
// The template launcher runs unmodified against a local server serving an archive built from manifest.txt alone;
// `setup` therefore runs from the cached version root. Isolation (plan v3-F1): a PATH that holds only node, git and
// stub claude/agy, a temporary HOME, and `--answer` for every question, so no run reaches a MemPalace interpreter
// or the host's service manager. The organization directory is a git clone whose `git status` must not change.

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
import { namesHook } from "./lib/org-toolchain.ts";

const rigs = trackRigs();
const servers = trackServers();

const SKILL = "artifacts/org/skills/acme-skill/SKILL.md";
const AGENT = "artifacts/org/agents/acme-agent/AGENT.md";
const COMPONENTS = { [SKILL]: SKILL_MD("acme-skill"), [AGENT]: AGENT_MD("acme-agent") };

/**
 * The home as the user's tools see it: everything but the cached versions of the launcher and the timestamped
 * `.bak.*` copies that the per-CLI setups of spec 0256 take of a settings file before each run.
 */
function userHome(world: World): string[] {
  return snapshot(world.rig.home).filter(
    (line) => !line.startsWith(".crewrig/versions/") && !/\.bak\.\d/.test(line),
  );
}

/** Home paths (outside the version cache) that mention `needle`. */
function homeMatches(world: World, needle: string): string[] {
  return treeList(world.rig.home).filter(
    (entry) => !entry.startsWith(".crewrig/versions/") && entry.includes(needle),
  );
}

describe("R6, R12: each CLI installs the organization content, and a second run changes nothing", () => {
  for (const cli of CLI_NAMES) {
    test(`${cli}: exit 0, the organization skill is installed, the second run is identical`, async () => {
      const world = await newWorld(rigs, servers);
      const dir = world.makeOrg({ files: COMPONENTS, gitignore: IGNORE_TEXT });
      const orgBefore = snapshot(dir);

      const first = await world.setup(dir, cli);
      const afterFirst = userHome(world);
      const second = await world.setup(dir, cli);

      assert.equal(first.code, 0, first.out);
      assert.equal(second.code, 0, second.out);
      assert.ok(
        homeMatches(world, "acme-skill").some((entry) => entry.endsWith("SKILL.md")),
        `the organization skill is installed for ${cli}`,
      );
      assert.deepEqual(
        userHome(world),
        afterFirst,
        "a second run with the same answers changes nothing",
      );
      assert.deepEqual(snapshot(dir), orgBefore, "the organization directory is unchanged");
    });
  }

  test("the hooks that setup wires name the scripts of the running version root", async () => {
    const world = await newWorld(rigs, servers);
    const dir = world.makeOrg({ gitignore: IGNORE_TEXT });

    const run = await world.setup(dir, "claude");

    assert.equal(run.code, 0, run.out);
    const settings = fs.readFileSync(path.join(world.rig.home, ".claude", "settings.json"), "utf8");
    const hook = path.join(world.versionRoot(), "hooks", "usage-capture.ts");
    const version = path.basename(world.versionRoot());
    assert.ok(namesHook(settings, version, "usage-capture.ts"), `settings.json names ${hook}`);
    assert.ok(fs.existsSync(hook), "the wired script exists in the version root");
  });

  test("the teams, roles and levels come from the organization directory", async () => {
    const world = await newWorld(rigs, servers);
    const dir = world.makeOrg({ gitignore: IGNORE_TEXT });
    fs.writeFileSync(
      path.join(dir, "config", "teams", "ACME-TEAM.md"),
      "# ACME-TEAM\n\nThe acme team.\n",
    );

    const run = await world.run(dir, "setup", [
      "--cli",
      "claude",
      ...answerArgs({ "catalogue.team": "ACME-TEAM" }),
    ]);

    assert.equal(run.code, 0, run.out);
    const rule = fs.readFileSync(
      path.join(world.rig.home, ".claude", "rules", "50-team.md"),
      "utf8",
    );
    assert.match(rule, /The acme team\./);
  });

  test("setup reads the version root and installs the identity commands with init-team", async () => {
    const world = await newWorld(rigs, servers);
    const dir = world.makeOrg({ gitignore: IGNORE_TEXT });

    await world.setup(dir, "claude");

    for (const skill of ["init-team", "init-soul", "init-personal-profile"]) {
      assert.ok(
        fs.existsSync(path.join(world.rig.home, ".claude", "skills", skill, "SKILL.md")),
        `${skill} is installed`,
      );
    }
    assert.ok(
      fs.existsSync(
        path.join(
          world.rig.home,
          ".claude",
          "skills",
          "init-team",
          "scripts",
          "scaffold-config-file.ts",
        ),
      ),
    );
  });

  test("the version root is identical in paths, bytes and modes around the four CLIs", async () => {
    const world = await newWorld(rigs, servers);
    const dir = world.makeOrg({ files: COMPONENTS, gitignore: IGNORE_TEXT });
    await world.run(dir, "build");
    const root = world.versionRoot();
    const digest = treeDigest(root);

    for (const cli of CLI_NAMES) {
      const run = await world.setup(dir, cli);
      assert.equal(run.code, 0, `${cli}: ${run.out}`);
      assert.equal(treeDigest(root), digest, `after ${cli}`);
    }
  });
});

/** The text of every file of the user's home, outside the cached versions, whose first line is a line marker (0316 R3). */
function markedFiles(world: World): string[] {
  return treeList(world.rig.home)
    .filter((entry) => !entry.endsWith("/") && !entry.endsWith("@"))
    .filter((entry) => !entry.startsWith(".crewrig/versions/"))
    .map((entry) => fs.readFileSync(path.join(world.rig.home, entry), "utf8"))
    .filter((text) => text.startsWith("<!-- crewrig-provenance: "));
}

describe("R6, delta-03 R6: a two-root setup stamps the rules with the organization's configuration", () => {
  const TOOLS: Record<CliName, string> = {
    claude: ".claude/rules/60-tools.md",
    gemini: ".gemini/60_TOOLS.md",
    copilot: ".copilot/instructions/60-tools.instructions.md",
    antigravity: ".gemini/antigravity-cli/60_TOOLS.md",
  };
  const REPO = "https://github.com/crewrig/crewrig";

  for (const cli of CLI_NAMES) {
    test(`${cli}: the rules-shared step succeeds, every marker is package="crewrig" with the configured repository, and no placeholder is left`, async () => {
      const world = await newWorld(rigs, servers);
      const dir = world.makeOrg({ gitignore: IGNORE_TEXT });
      const orgBefore = snapshot(dir);

      const result = await world.setup(dir, cli);

      assert.equal(result.code, 0, result.out);
      const tools = fs.readFileSync(path.join(world.rig.home, TOOLS[cli]), "utf8").split("\n")[0];
      assert.equal(
        tools,
        `<!-- crewrig-provenance: package="crewrig" version="1.0.0" canonical="${REPO}" feedback="${REPO}" -->`,
      );
      const marked = markedFiles(world);
      assert.ok(marked.length > 0, "the rules carry markers");
      for (const text of marked) {
        assert.doesNotMatch(text, /\$\{/);
        assert.doesNotMatch(text, /crewrig-provenance: package="(?!crewrig")/);
      }
      assert.deepEqual(snapshot(dir), orgBefore, "the organization directory is unchanged");
    });
  }
});

describe("R6: refusals write nothing", () => {
  test("a missing config/ORGANIZATION.md exits 1 naming it, and nothing is installed", async () => {
    const world = await newWorld(rigs, servers);
    const dir = world.makeOrg({ withoutOrganizationFile: true, gitignore: IGNORE_TEXT });
    const before = snapshot(dir);

    const run = await world.setup(dir, "claude");

    assert.equal(run.code, 1, run.out);
    assert.match(run.out, /config[\\/]ORGANIZATION\.md/);
    assert.deepEqual(homeOutsideVersions(world.rig), [".crewrig/"], "nothing is installed");
    assert.deepEqual(snapshot(dir), before);
  });

  test("a missing config/TOOLS.md exits 1 naming it, before anything is installed", async () => {
    const world = await newWorld(rigs, servers);
    const dir = world.makeOrg({ gitignore: IGNORE_TEXT });
    fs.rmSync(path.join(dir, "config", "TOOLS.md"));

    const run = await world.setup(dir, "gemini");

    assert.equal(run.code, 1, run.out);
    assert.match(run.out, /config[\\/]TOOLS\.md/);
    assert.deepEqual(homeOutsideVersions(world.rig), [".crewrig/"]);
  });

  test("--link, no --cli, an unknown option and a bad --cli value exit 2 and write nothing", async () => {
    const world = await newWorld(rigs, servers);
    const dir = world.makeOrg({ files: COMPONENTS, gitignore: IGNORE_TEXT });
    await world.run(dir, "build");
    const org = snapshot(dir);
    const cases: [string[], RegExp][] = [
      [["--link", "--cli", "claude"], /--link/],
      [[], /claude, gemini, copilot, antigravity/],
      [["--cli", "claude", "--frobnicate"], /unknown option/],
      [["--cli", "emacs"], /claude, gemini, copilot, antigravity/],
      [["--cli", "claude", "--cli", "gemini"], /--cli/],
      [["--cli", "claude", "--answer", "noequals"], /--answer/],
    ];

    for (const [args, message] of cases) {
      const run = await world.run(dir, "setup", args);

      assert.equal(run.code, 2, `${args.join(" ")}: ${run.out}`);
      assert.match(run.out, message, args.join(" "));
    }

    assert.deepEqual(homeOutsideVersions(world.rig), [".crewrig/"], "nothing is installed");
    assert.deepEqual(snapshot(dir), org);
  });

  test("a directory that is not an organization directory exits 1 naming crewrig.config.toml", async () => {
    const world = await newWorld(rigs, servers);
    const dir = world.makeOrg();
    const other = world.rig.newDir("other");

    const run = await world.setup(dir, "claude", ["--org-dir", other]);

    assert.equal(run.code, 1, run.out);
    assert.match(run.out, /crewrig\.config\.toml/);
    assert.deepEqual(homeOutsideVersions(world.rig), [".crewrig/"]);
    assert.deepEqual(fs.readdirSync(other), []);
  });
});
