// crewrig-module-type.test.ts — the framework archive works under every module type of the directories above it
// (spec 0315 R11, R14; spec 0243 delta-05 R40). The archive root carries a package.json `{"name":"crewrig","type":"module"}`
// (delta-03 R11); the four commands, the four hook scripts, session-check-hooks.ts and node-floor-guard.js run from
// the extracted archive under an ancestor package.json declaring "commonjs", declaring "module", declaring no type,
// or absent.
//
// Two layouts, so that a broken form fails (the matrix must be able to fail):
//   - the real archive: every cell works, with no module-type error or warning;
//   - the same archive whose root package.json declares "commonjs" (its `name` kept, so that the commands reach the
//     module loading; a version root without a `name` is refused by build, crewrig-build.test.ts): the root is the
//     nearest scope of every file of the archive, so every item that reaches an ECMAScript file must fail under
//     every ancestor, and every other item still works. A form that only passes because the root scopes it as a
//     module is detected by the second layout; a form that does not work under the root is detected by the first.
//     (A root with no `type` is not a negative control: Node then detects the module syntax and every cell works.)
// The hook observers (archive-hooks.ts) check what only a loaded module graph produces, because the entries catch a
// failed import() and exit 0 with empty streams.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { before, describe, test } from "node:test";
import {
  copyTemplate,
  pinOf,
  serveArchive,
  trackRigs,
  trackServers,
  type Archive,
} from "./lib/launcher-rig.ts";
import {
  ANCESTORS,
  HOOK_ITEMS,
  MODULE_TYPE_NOISE,
  makeCell,
  type Ancestor,
  type Cell,
} from "./lib/archive-hooks.ts";
import {
  IGNORE_TEXT,
  SKILL_MD,
  answerArgs,
  archiveOfVersion,
  makeWorld,
  runEntryOf,
  withUpstream,
  type World,
} from "./lib/org-rig.ts";
import { namesHook } from "./lib/org-toolchain.ts";

const rigs = trackRigs();
const servers = trackServers();

const SKILL = "artifacts/org/skills/acme-skill/SKILL.md";

const LAYOUTS: { name: string; archive: Archive; rooted: boolean }[] = [
  { name: "the real archive", archive: archiveOfVersion("1.0.0-test.1"), rooted: true },
  {
    name: "the archive whose root package.json declares commonjs",
    archive: archiveOfVersion("1.0.0-cjs", {
      replace: { "package.json": '{"name": "crewrig", "type": "commonjs"}\n' },
    }),
    rooted: false,
  },
];

/** A world that serves `archive`, and a cell of it under each ancestor type. */
async function worldFor(archive: Archive): Promise<{ world: World; cells: Map<Ancestor, Cell> }> {
  const rig = rigs.make();
  const server = await servers.start();
  serveArchive(server, archive);
  const world = makeWorld(rig, server, archive);
  const cells = new Map(ANCESTORS.map((ancestor) => [ancestor, makeCell(rig, archive, ancestor)]));
  return { world, cells };
}

interface Command {
  readonly name: string;
  /** Run the command from the cell's version directory; returns the exit code and the output. */
  run(world: World, cell: Cell, archive: Archive): Promise<{ code: number | null; out: string }>;
}

const FEEDBACK = "https://github.com/acme/crewrig-config";

const COMMANDS: readonly Command[] = [
  {
    name: "init",
    async run(world, cell, archive) {
      const dir = copyTemplate(world.rig, pinOf(archive));
      const run = await runEntryOf(world, cell.root, dir, ["init", "--feedback-repo", FEEDBACK]);
      return {
        code:
          run.code === 0 && fs.existsSync(path.join(dir, "crewrig.config.toml"))
            ? 0
            : (run.code ?? 1),
        out: run.out,
      };
    },
  },
  {
    name: "build",
    async run(world, cell) {
      const dir = world.makeOrg();
      const run = await runEntryOf(world, cell.root, dir, ["build"]);
      return { code: run.code, out: run.out };
    },
  },
  {
    name: "setup --cli claude",
    async run(world, cell) {
      const dir = world.makeOrg({ gitignore: IGNORE_TEXT });
      const run = await runEntryOf(world, cell.root, dir, [
        "setup",
        "--cli",
        "claude",
        ...answerArgs({}),
      ]);
      const wrote = fs.existsSync(path.join(world.rig.home, ".claude", "settings.json"));
      return { code: run.code === 0 && !wrote ? 1 : run.code, out: run.out };
    },
  },
  {
    name: "update --cli claude",
    async run(world, cell) {
      const { clone } = withUpstream(world.rig, world.makeOrg({ gitignore: IGNORE_TEXT }));
      const run = await runEntryOf(world, cell.root, clone, [
        "update",
        "--cli",
        "claude",
        ...answerArgs({}),
      ]);
      return { code: run.code, out: run.out };
    },
  },
];

/** The cell with a fresh HOME, so that the runs of two items never see each other's files. */
const fresh = (world: World, cell: Cell): Cell => ({
  ...cell,
  home: world.rig.newDir("hook-home"),
});

for (const layout of LAYOUTS) {
  describe(`R11: ${layout.name}`, () => {
    let built: { world: World; cells: Map<Ancestor, Cell> };
    before(async () => {
      built = await worldFor(layout.archive);
    });

    for (const command of COMMANDS) {
      for (const ancestor of ANCESTORS) {
        const mustFail = !layout.rooted;
        const verdict = mustFail
          ? "fails (the root scopes the ECMAScript files as commonjs)"
          : "works";
        test(`${command.name} under a ${ancestor} ancestor ${verdict}`, async () => {
          const { world, cells } = built;

          const result = await command.run(world, cells.get(ancestor) as Cell, layout.archive);

          if (mustFail) {
            assert.notEqual(result.code, 0, `the matrix cannot fail: ${result.out}`);
            return;
          }
          assert.equal(result.code, 0, result.out);
          if (layout.rooted) assert.doesNotMatch(result.out, MODULE_TYPE_NOISE);
        });
      }
    }

    for (const item of HOOK_ITEMS) {
      for (const ancestor of ANCESTORS) {
        const mustFail = !layout.rooted && item.reachesEsm;
        test(`${item.name} under a ${ancestor} ancestor ${mustFail ? "fails to do its work" : "does its work"}`, async () => {
          const observation = item.observe(fresh(built.world, built.cells.get(ancestor) as Cell));

          if (mustFail) assert.ok(!observation.good, `the matrix cannot fail: ${item.name}`);
          else {
            assert.ok(observation.good, observation.why);
            if (layout.rooted)
              assert.ok(!observation.noisy, "a module-type message reached a stream");
          }
        });
      }
    }
  });
}

/** The `package` value of every provenance marker under `dir`: the YAML field and the comment form of the line marker. */
function packagesIn(dir: string): string[] {
  const found: string[] = [];
  for (const entry of fs.readdirSync(dir, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const text = fs.readFileSync(path.join(entry.parentPath, entry.name), "utf8");
    for (const match of text.matchAll(/\bpackage(?:: "|=")([^"]*)"/g)) found.push(match[1] ?? "");
  }
  return found;
}

describe("R11, delta-03 R6: build stamps every marker with the framework's name under every ancestor", () => {
  let built: { world: World; cells: Map<Ancestor, Cell> };
  before(async () => {
    built = await worldFor(LAYOUTS[0]?.archive as Archive);
  });

  for (const ancestor of ANCESTORS) {
    test(`build under a ${ancestor} ancestor writes package="crewrig" in every marker, the organization's own skill included`, async () => {
      const { world, cells } = built;
      const dir = world.makeOrg({ files: { [SKILL]: SKILL_MD("acme-skill") } });

      const run = await runEntryOf(world, (cells.get(ancestor) as Cell).root, dir, ["build"]);

      assert.equal(run.code, 0, run.out);
      assert.doesNotMatch(run.out, MODULE_TYPE_NOISE);
      const packages = packagesIn(path.join(dir, "dist"));
      assert.ok(packages.length > 0, "the organization's skill carries a marker");
      assert.deepEqual([...new Set(packages)], ["crewrig"]);
    });
  }
});

describe("R11: the launcher's version directory under a hostile package.json in the home", () => {
  for (const ancestor of ["commonjs", "module", "typeless"] as const) {
    test(`with a ${ancestor} package.json in ~, ~/.crewrig and ~/.crewrig/versions, build and a hook behave as without`, async () => {
      const archive = LAYOUTS[0]?.archive as Archive;
      const rig = rigs.make();
      const server = await servers.start();
      serveArchive(server, archive);
      const world = makeWorld(rig, server, archive);
      const versions = path.join(rig.home, ".crewrig", "versions");
      fs.mkdirSync(versions, { recursive: true });
      const text = ancestor === "typeless" ? '{"name":"hostile"}\n' : `{"type":"${ancestor}"}\n`;
      for (const dir of [rig.home, path.join(rig.home, ".crewrig"), versions]) {
        fs.writeFileSync(path.join(dir, "package.json"), text);
      }
      const dir = world.makeOrg({ gitignore: IGNORE_TEXT });

      const build = await world.run(dir, "build");
      const setup = await world.setup(dir, "claude");

      assert.equal(build.code, 0, build.out);
      assert.equal(setup.code, 0, setup.out);
      assert.doesNotMatch(build.out + setup.out, MODULE_TYPE_NOISE);
      const hook = path.join(world.versionRoot(), "hooks", "usage-capture.ts");
      assert.ok(fs.existsSync(hook));
      const wired = fs.readFileSync(path.join(rig.home, ".claude", "settings.json"), "utf8");
      assert.ok(
        namesHook(wired, path.basename(world.versionRoot()), "usage-capture.ts"),
        "the wired hook names the cached version",
      );
      const cell: Cell = {
        rig,
        root: world.versionRoot(),
        ancestor,
        home: rig.newDir("hook-home"),
      };
      for (const item of HOOK_ITEMS.slice(0, 4)) {
        const observation = item.observe(cell);
        assert.ok(observation.good && !observation.noisy, `${item.name}: ${observation.why}`);
      }
    });
  }
});
