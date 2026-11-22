// crewrig-template-lookup.test.ts — where `init-soul` and `init-personal-profile` find their template (spec 0315 R8,
// R14): the organization's own committed copy first, then read-only from the version root that `crewrig.pin.json`
// names, and otherwise one message that tells the user to run `node crewrig setup --cli <name>`, with nothing
// written. The skills are the ones `setup` installed from the pinned version; their scaffold script runs from the
// organization directory, with the temporary HOME of the rig.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";
import {
  NO_TYPELESS_WARNING,
  runNode,
  snapshot,
  trackRigs,
  trackServers,
  treeList,
  type RunResult,
} from "./lib/launcher-rig.ts";
import {
  CLI_NAMES,
  IGNORE_TEXT,
  archiveOfVersion,
  newWorld,
  porcelain,
  treeDigest,
  withUpstream,
  type World,
} from "./lib/org-rig.ts";

const rigs = trackRigs();
const servers = trackServers();

const SOUL = "config/SOUL.md.template";
const PROFILE = "config/PROFILE.md.template";
const MESSAGE = /node crewrig setup --cli <name>/;
const SOUL_ANSWERS = JSON.stringify({
  sections: {
    stance: "I help.",
    origin: "I was built.",
    understanding: "I listen.",
    lineage: "I learn.",
    error_handling: "I retry.",
  },
});
const PROFILE_ANSWERS = JSON.stringify({
  identity: { full_name: "Ada Test", email: "ada@example.invalid", language: "English" },
});

interface Report {
  readonly ok: boolean;
  readonly data: {
    readonly source?: string;
    readonly template?: string;
    readonly content?: string;
    readonly version?: string;
  } | null;
}

/** The scaffold script of the init-team skill that `setup` installed, run from `dir`. */
function scaffold(
  world: World,
  dir: string,
  args: readonly string[],
  stdin?: string,
): Promise<RunResult> {
  const script = path.join(
    world.rig.home,
    ".claude",
    "skills",
    "init-team",
    "scripts",
    "scaffold-config-file.ts",
  );
  return runNode(world.rig, script, [...args, "--root", dir, "--json"], {
    cwd: dir,
    nodeArgs: [NO_TYPELESS_WARNING],
    ...(stdin === undefined ? {} : { stdin }),
  });
}

const reportOf = (run: RunResult): Report => JSON.parse(run.stdout) as Report;

/** A world with the standard version cached by one `setup` of the given organization directory. */
async function installed(
  files: Record<string, string> = {},
): Promise<{ world: World; dir: string }> {
  const world = await newWorld(rigs, servers);
  const dir = world.makeOrg({ gitignore: IGNORE_TEXT, files });
  const run = await world.setup(dir, "claude");
  assert.equal(run.code, 0, run.out);
  return { world, dir };
}

describe("R8: the template lookup order", () => {
  test("a template committed in the organization directory wins, for the soul and the profile", async () => {
    const { world, dir } = await installed({
      [SOUL]: "# ORG SOUL TEMPLATE\n",
      [PROFILE]: "# ORG PROFILE TEMPLATE\n",
    });

    const soul = reportOf(await scaffold(world, dir, ["--kind", "soul", "--template"]));
    const profile = reportOf(await scaffold(world, dir, ["--kind", "profile", "--template"]));

    assert.equal(soul.data?.source, "organization");
    assert.equal(soul.data?.content, "# ORG SOUL TEMPLATE\n");
    assert.equal(profile.data?.source, "organization");
    assert.equal(profile.data?.content, "# ORG PROFILE TEMPLATE\n");
  });

  test("with none there, it reads the version root of the pinned version, read-only", async () => {
    const { world, dir } = await installed();
    const root = world.versionRoot();
    const digest = treeDigest(root);
    const org = snapshot(dir);
    const home = snapshot(world.rig.home).filter((line) => !line.startsWith(".crewrig/versions/"));

    const soul = reportOf(await scaffold(world, dir, ["--kind", "soul", "--template"]));
    const profile = reportOf(await scaffold(world, dir, ["--kind", "profile", "--template"]));

    assert.equal(soul.data?.source, "version");
    assert.equal(soul.data?.version, world.archive.version);
    assert.equal(path.resolve(soul.data?.template ?? ""), path.join(root, SOUL));
    assert.equal(soul.data?.content, fs.readFileSync(path.join(root, SOUL), "utf8"));
    assert.equal(profile.data?.content, fs.readFileSync(path.join(root, PROFILE), "utf8"));
    assert.equal(treeDigest(root), digest, "the version root is unchanged");
    assert.deepEqual(snapshot(dir), org, "nothing is written in the organization directory");
    assert.deepEqual(
      snapshot(world.rig.home).filter((line) => !line.startsWith(".crewrig/versions/")),
      home,
      "nothing is written under the home",
    );
  });

  test("two clones pinned to different versions each read the template of their own version", async () => {
    const other = archiveOfVersion("1.0.0-test.7", { replace: { [SOUL]: "# SOUL OF SEVEN\n" } });
    const world = await newWorld(rigs, servers);
    world.server.route(`/crewrig-v${other.version}/crewrig-${other.version}.tgz`, (_req, res) => {
      res.writeHead(200);
      res.end(fs.readFileSync(other.file));
    });
    const first = world.makeOrg({ gitignore: IGNORE_TEXT });
    const second = world.makeOrg({
      gitignore: IGNORE_TEXT,
      pin: { version: other.version, sha256: other.sha256 },
    });
    assert.equal((await world.setup(first, "claude")).code, 0);
    assert.equal((await world.setup(second, "claude")).code, 0);

    const one = reportOf(await scaffold(world, first, ["--kind", "soul", "--template"]));
    const two = reportOf(await scaffold(world, second, ["--kind", "soul", "--template"]));

    assert.equal(one.data?.version, world.archive.version);
    assert.notEqual(one.data?.content, "# SOUL OF SEVEN\n");
    assert.equal(two.data?.version, other.version);
    assert.equal(two.data?.content, "# SOUL OF SEVEN\n");
  });
});

describe("R8: no template available is one message, and nothing is written", () => {
  const cases: [string, (world: World) => string | null][] = [
    [
      "a version that is not cached",
      () => JSON.stringify({ version: "9.9.9", sha256: "0".repeat(64) }),
    ],
    ["an invalid pin file", () => "{ not json\n"],
    [
      "a pin whose version is not a version",
      () => JSON.stringify({ version: "latest", sha256: "0".repeat(64) }),
    ],
    [
      "a pin whose version climbs out of the cache",
      () => JSON.stringify({ version: "../../escape", sha256: "0".repeat(64) }),
    ],
    ["an absent pin file", () => null],
  ];
  for (const [label, pin] of cases) {
    test(`${label}: exit 3 with the setup message, for the read and for the save`, async () => {
      const { world } = await installed();
      const dir = world.makeOrg({ gitignore: IGNORE_TEXT });
      const text = pin(world);
      if (text === null) fs.rmSync(path.join(dir, "crewrig.pin.json"));
      else fs.writeFileSync(path.join(dir, "crewrig.pin.json"), text);
      // a decoy where `../../escape` would resolve to: it must never be read.
      fs.mkdirSync(path.join(world.rig.home, "escape", "config"), { recursive: true });
      fs.writeFileSync(
        path.join(world.rig.home, "escape", "config", "SOUL.md.template"),
        "# DECOY\n",
      );
      const before = snapshot(dir);

      const read = await scaffold(world, dir, ["--kind", "soul", "--template"]);
      const save = await scaffold(world, dir, ["--kind", "soul", "--answers", "-"], SOUL_ANSWERS);
      const profile = await scaffold(
        world,
        dir,
        ["--kind", "profile", "--answers", "-"],
        PROFILE_ANSWERS,
      );

      for (const run of [read, save, profile]) {
        assert.equal(run.code, 3, run.out);
        assert.match(run.out, MESSAGE);
        assert.doesNotMatch(run.out, /DECOY/);
      }
      assert.deepEqual(snapshot(dir), before, "not even the personal file is written");
      assert.ok(!fs.existsSync(path.join(dir, "config", "SOUL.md")));
      assert.ok(!fs.existsSync(path.join(dir, "config", "PROFILE.md")));
    });
  }
});

describe("R8: the personal files are written in the clone and git ignores them after build", () => {
  test("init-soul and init-personal-profile write config/SOUL.md and config/PROFILE.md, and git status stays empty", async () => {
    const world = await newWorld(rigs, servers);
    const org = world.makeOrg({ gitignore: IGNORE_TEXT });
    const { clone } = withUpstream(world.rig, org);
    assert.equal((await world.run(clone, "build")).code, 0);
    assert.equal((await world.setup(clone, "claude")).code, 0);
    assert.equal(porcelain(world.rig, clone), "");

    const soul = await scaffold(world, clone, ["--kind", "soul", "--answers", "-"], SOUL_ANSWERS);
    const profile = await scaffold(
      world,
      clone,
      ["--kind", "profile", "--answers", "-"],
      PROFILE_ANSWERS,
    );

    assert.equal(soul.code, 0, soul.out);
    assert.equal(profile.code, 0, profile.out);
    assert.match(fs.readFileSync(path.join(clone, "config", "SOUL.md"), "utf8"), /I retry\./);
    assert.match(fs.readFileSync(path.join(clone, "config", "PROFILE.md"), "utf8"), /Ada Test/);
    assert.equal(porcelain(world.rig, clone), "", "neither personal file is listed by git status");
  });
});

describe("R8: setup installs init-team with both commands for every CLI", () => {
  for (const cli of CLI_NAMES) {
    test(`${cli}: init-team, init-soul and init-personal-profile are installed and describe the lookup`, async () => {
      const world = await newWorld(rigs, servers);
      const dir = world.makeOrg({ gitignore: IGNORE_TEXT });

      const run = await world.setup(dir, cli);

      assert.equal(run.code, 0, run.out);
      const entries = treeList(world.rig.home).filter(
        (entry) => !entry.startsWith(".crewrig/versions/"),
      );
      const has = (needle: string): string[] => entries.filter((entry) => entry.includes(needle));
      assert.ok(has("init-team/SKILL.md").length > 0, "init-team skill");
      assert.ok(has("init-team/scripts/scaffold-config-file.ts").length > 0, "its scaffold script");
      assert.ok(has("init-team/scripts/lint-config-file.ts").length > 0, "its lint script");
      for (const command of ["init-soul", "init-personal-profile"]) {
        const files = has(command).filter((entry) => /\.(md|toml)$/.test(entry));
        assert.ok(files.length > 0, `${command} is installed for ${cli}`);
        const text = fs.readFileSync(
          path.join(world.rig.home, ...(files[0] ?? "").split("/")),
          "utf8",
        );
        assert.match(
          text,
          /organization directory|crewrig setup --cli|~\/\.crewrig\/versions/,
          command,
        );
      }
    });
  }
});
