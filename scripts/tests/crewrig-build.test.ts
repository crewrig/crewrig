// crewrig-build.test.ts — `node crewrig build` end to end (spec 0315 R5, R7, R12, R14; delta-01).
//
// Every case runs the template launcher unmodified against a local server that serves an archive built from
// manifest.txt alone, so `build` runs from the cached version root under a temporary HOME (org-rig.ts). Each
// assertion is one a broken command fails: a build that writes outside `dist/` and the `.gitignore`, that
// replaces `dist/` on a failed compile, or that rewrites an ignore file it should only extend.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";
import { homeOutsideVersions, snapshot, trackRigs, trackServers } from "./lib/launcher-rig.ts";
import {
  AGENT_MD,
  IGNORE_TEXT,
  SKILL_MD,
  newWorld,
  treeDigest,
  type World,
} from "./lib/org-rig.ts";

const rigs = trackRigs();
const servers = trackServers();

const SKILL = "artifacts/org/skills/acme-skill/SKILL.md";
const AGENT = "artifacts/org/agents/acme-agent/AGENT.md";
const COMPONENTS = { [SKILL]: SKILL_MD("acme-skill"), [AGENT]: AGENT_MD("acme-agent") };

/** The organization directory as the author left it, with `dist/` and `.gitignore` left out. */
function sources(dir: string): string[] {
  return snapshot(dir).filter(
    (line) => !line.startsWith("dist/") && line !== "dist/" && !line.startsWith(".gitignore"),
  );
}

async function buildWith(world: World, gitignore: string | undefined): Promise<string | undefined> {
  const dir = world.makeOrg(gitignore === undefined ? {} : { gitignore });
  const run = await world.run(dir, "build");
  assert.equal(run.code, 0, run.out);
  const file = path.join(dir, ".gitignore");
  return fs.existsSync(file) ? fs.readFileSync(file, "utf8") : undefined;
}

describe("R5: build on an empty organization and on one with components", () => {
  test("an empty organization exits 0, says so, and holds the three ignore lines", async () => {
    const world = await newWorld(rigs, servers);
    const dir = world.makeOrg();
    const before = sources(dir);

    const run = await world.run(dir, "build");

    assert.equal(run.code, 0, run.out);
    assert.match(run.out, /organization defines no component/);
    assert.equal(fs.readFileSync(path.join(dir, ".gitignore"), "utf8"), IGNORE_TEXT);
    assert.deepEqual(sources(dir), before, "nothing but dist/ and .gitignore is written");
  });

  test("a skill and an agent are compiled for the four CLIs, and only dist/ and .gitignore are written", async () => {
    const world = await newWorld(rigs, servers);
    const dir = world.makeOrg({ files: COMPONENTS });
    const before = sources(dir);

    const run = await world.run(dir, "build");

    assert.equal(run.code, 0, run.out);
    assert.doesNotMatch(run.out, /defines no component/);
    for (const [root, skill, agent] of [
      [".claude", "skills/acme-skill/SKILL.md", "agents/acme-agent.md"],
      [".gemini", "skills/acme-skill/SKILL.md", "agents/acme-agent.md"],
      [".github", "skills/acme-skill/SKILL.md", "agents/acme-agent.md"],
      [".agents", "skills/acme-skill/SKILL.md", "agents/acme-agent.md"],
    ]) {
      for (const rel of [skill, agent]) {
        const file = path.join(dir, "dist", "org", root as string, rel as string);
        assert.ok(fs.existsSync(file), `${file} exists`);
      }
    }
    const skill = fs.readFileSync(
      path.join(dir, "dist", "org", ".claude", "skills", "acme-skill", "SKILL.md"),
      "utf8",
    );
    assert.match(skill, /# acme-skill/);
    assert.deepEqual(sources(dir), before);
    assert.deepEqual(homeOutsideVersions(world.rig), [".crewrig/"], "nothing under the home");
  });

  test("the version root is not modified, and two runs on unchanged sources leave identical dist/", async () => {
    const world = await newWorld(rigs, servers);
    const dir = world.makeOrg({ files: COMPONENTS });
    await world.run(dir, "build");
    const root = world.versionRoot();
    const rootDigest = treeDigest(root);
    const first = snapshot(path.join(dir, "dist"));

    const run = await world.run(dir, "build");

    assert.equal(run.code, 0, run.out);
    assert.deepEqual(snapshot(path.join(dir, "dist")), first);
    assert.equal(treeDigest(root), rootDigest, "the version root is byte, path and mode identical");
  });

  test("the notice about organization hooks is printed once, the file is not compiled, the code is 0", async () => {
    const world = await newWorld(rigs, servers);
    const dir = world.makeOrg({
      files: { ...COMPONENTS, "artifacts/community/hooks/guard.sh": "#!/bin/sh\n" },
    });

    const run = await world.run(dir, "build");

    assert.equal(run.code, 0, run.out);
    const notices = run.out.match(/organization hooks[^\n]*not installed by this version/g) ?? [];
    assert.equal(notices.length, 1, run.out);
    assert.deepEqual(
      snapshot(path.join(dir, "dist")).filter((line) => line.includes("guard")),
      [],
    );
  });

  test("a hooks directory holding only .gitkeep prints no notice", async () => {
    const world = await newWorld(rigs, servers);
    const dir = world.makeOrg({ files: COMPONENTS });

    const run = await world.run(dir, "build");

    assert.doesNotMatch(run.out, /organization hooks/);
  });
});

describe("R5, R7: a defective component", () => {
  const defective = SKILL_MD("acme-skill").replace("name: acme-skill", "name: ../evil");

  test("exits 1 naming the source file, keeps the previous dist/ unchanged, keeps the ignore lines", async () => {
    const world = await newWorld(rigs, servers);
    const dir = world.makeOrg({ files: COMPONENTS });
    assert.equal((await world.run(dir, "build")).code, 0);
    const previous = snapshot(path.join(dir, "dist"));
    const ignore = fs.readFileSync(path.join(dir, ".gitignore"), "utf8");
    fs.writeFileSync(path.join(dir, SKILL), defective);

    const run = await world.run(dir, "build");

    assert.equal(run.code, 1, run.out);
    assert.ok(run.out.includes(path.join("acme-skill")), run.out);
    assert.match(run.out, /SKILL\.md/);
    assert.deepEqual(snapshot(path.join(dir, "dist")), previous, "the previous dist/ is untouched");
    assert.equal(fs.readFileSync(path.join(dir, ".gitignore"), "utf8"), ignore);
  });

  test("with no .gitignore the three lines are still written, and no dist/ is created", async () => {
    const world = await newWorld(rigs, servers);
    const dir = world.makeOrg({ files: { [SKILL]: defective } });

    const run = await world.run(dir, "build");

    assert.equal(run.code, 1, run.out);
    assert.equal(fs.readFileSync(path.join(dir, ".gitignore"), "utf8"), IGNORE_TEXT);
    assert.ok(!fs.existsSync(path.join(dir, "dist")), "no dist/ after a failed first build");
  });

  test("a failed build leaves no temporary compile directory behind", async () => {
    const world = await newWorld(rigs, servers);
    const dir = world.makeOrg({ files: { [SKILL]: defective } });
    const tmp = path.join(world.rig.root, "tmp");
    fs.mkdirSync(tmp);
    const env = { TMPDIR: tmp, TMP: tmp, TEMP: tmp };

    const failed = await world.run(dir, "build", [], { env });
    fs.writeFileSync(path.join(dir, SKILL), SKILL_MD("acme-skill"));
    const fine = await world.run(dir, "build", [], { env });

    assert.equal(failed.code, 1, failed.out);
    assert.equal(fine.code, 0, fine.out);
    assert.deepEqual(
      fs.readdirSync(tmp),
      [],
      "the staging directories are removed in both outcomes",
    );
  });
});

describe("R5: two components claiming one installed name", () => {
  test("exit 1, name both source files, and write no dist/", async () => {
    const world = await newWorld(rigs, servers);
    const dir = world.makeOrg({
      files: {
        "artifacts/org/skills/acme-a/SKILL.md": SKILL_MD("acme-same"),
        "artifacts/org/skills/acme-b/SKILL.md": SKILL_MD("acme-same"),
      },
    });

    const run = await world.run(dir, "build");

    assert.equal(run.code, 1, run.out);
    assert.ok(run.out.includes(path.join("acme-a", "SKILL.md")), run.out);
    assert.ok(run.out.includes(path.join("acme-b", "SKILL.md")), run.out);
    assert.ok(run.out.includes("FAILED"), run.out);
    assert.equal(fs.existsSync(path.join(dir, "dist")), false, "no dist/ is written");
  });
});

describe("R7: the .gitignore of the organization directory", () => {
  test("an absent file is created with the three lines", async () => {
    const world = await newWorld(rigs, servers);

    assert.equal(await buildWith(world, undefined), IGNORE_TEXT);
  });

  test("a file with one unrelated line and no final line feed keeps it and gains the lines on their own lines", async () => {
    const world = await newWorld(rigs, servers);

    assert.equal(await buildWith(world, "node_modules"), `node_modules\n${IGNORE_TEXT}`);
  });

  test("a file ending with a line feed gains the lines at its end, existing bytes kept", async () => {
    const world = await newWorld(rigs, servers);

    assert.equal(
      await buildWith(world, "# mine\r\nnode_modules/\n\n"),
      `# mine\r\nnode_modules/\n\n${IGNORE_TEXT}`,
    );
  });

  test("a partial file gains only the missing lines, never a duplicate, never reordered", async () => {
    const world = await newWorld(rigs, servers);

    assert.equal(
      await buildWith(world, "dist/\nnode_modules\nconfig/PROFILE.md\n"),
      "dist/\nnode_modules\nconfig/PROFILE.md\nconfig/SOUL.md\n",
    );
  });

  test("the slash-prefixed form and trailing spaces count as present: a complete file is byte-identical", async () => {
    const world = await newWorld(rigs, servers);
    const complete = "/config/SOUL.md  \nconfig/PROFILE.md\n/dist/\nnode_modules";

    assert.equal(await buildWith(world, complete), complete);
  });

  test("a second build changes nothing (the scenario of a .gitignore holding only node_modules)", async () => {
    const world = await newWorld(rigs, servers);
    const dir = world.makeOrg({ gitignore: "node_modules\n" });
    await world.run(dir, "build");
    const after = fs.readFileSync(path.join(dir, ".gitignore"), "utf8");

    const run = await world.run(dir, "build");

    assert.equal(run.code, 0, run.out);
    assert.equal(fs.readFileSync(path.join(dir, ".gitignore"), "utf8"), after);
    assert.equal(after, `node_modules\n${IGNORE_TEXT}`);
  });

  test("build creates neither config/SOUL.md nor config/PROFILE.md", async () => {
    const world = await newWorld(rigs, servers);
    const dir = world.makeOrg({ files: COMPONENTS });

    await world.run(dir, "build");

    assert.ok(!fs.existsSync(path.join(dir, "config", "SOUL.md")));
    assert.ok(!fs.existsSync(path.join(dir, "config", "PROFILE.md")));
  });
});

describe("R4: the organization directory is checked first", () => {
  test("a directory without crewrig.config.toml exits 1 naming the file and writes nothing", async () => {
    const world = await newWorld(rigs, servers);
    const dir = world.makeOrg();
    fs.rmSync(path.join(dir, "crewrig.config.toml"));
    const before = snapshot(dir);

    const run = await world.run(dir, "build");

    assert.equal(run.code, 1, run.out);
    assert.match(run.out, /crewrig\.config\.toml/);
    assert.deepEqual(snapshot(dir), before);
  });

  test("--org-dir names another directory, and the working directory is left alone", async () => {
    const world = await newWorld(rigs, servers);
    const dir = world.makeOrg({ files: COMPONENTS });
    const elsewhere = world.rig.newDir("elsewhere");

    const run = await world.run(dir, "build", ["--org-dir", dir], { cwd: elsewhere });

    assert.equal(run.code, 0, run.out);
    assert.ok(fs.existsSync(path.join(dir, "dist", "org", ".claude", "skills", "acme-skill")));
    assert.deepEqual(fs.readdirSync(elsewhere), []);
  });

  test("an unknown option, or --cli, is a usage error (2) that writes nothing", async () => {
    const world = await newWorld(rigs, servers);
    const dir = world.makeOrg();
    const before = snapshot(dir);

    for (const args of [["--frobnicate"], ["--cli", "claude"], ["--org-dir"]]) {
      const run = await world.run(dir, "build", args);

      assert.equal(run.code, 2, `${args.join(" ")}: ${run.out}`);
    }
    assert.deepEqual(snapshot(dir), before);
  });
});
