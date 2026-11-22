// crewrig-env-isolation.test.ts — the environment of the three commands, end to end with the launcher (spec 0315 R12;
// delta-01 R12, R14; plan v3-F1, v3-F2): the stripped variables have no effect on `build` and `setup`, a generic
// REPO_DIR is never a source of framework data, `update` forwards the launcher's variable and nothing else of the
// stripped classes to the run it starts, an unreadable CREWRIG_TLS_CA does not fail `setup`, and every run stays off
// the host's service manager.
//
// Isolation (v3-F1, corrected): what keeps `setup` from the daemon is NOT `--answer mempalace-install=no`, which only
// declines the pipx offer. It is the PATH that holds only node, git and stub claude/agy (no interpreter of MemPalace
// is detected) and the temporary HOME. Every run below asserts that no daemon file reached the home and that the
// host's service manager lists the same CrewRig and MemPalace entries before and after.

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";
import { ALLOWLIST, LAUNCHER_VARIABLE, STRIPPED_NAMES } from "./lib/env-classes.ts";
import { snapshot, trackRigs, trackServers, treeList, type RunResult } from "./lib/launcher-rig.ts";
import {
  IGNORE_TEXT,
  SKILL_MD,
  answerArgs,
  daemonFilesUnder,
  hostServices,
  newWorld,
  runEntryOf,
  withUpstream,
  type World,
} from "./lib/org-rig.ts";

const rigs = trackRigs();
const servers = trackServers();
const SKILL = "artifacts/org/skills/acme-skill/SKILL.md";
const FILES = { [SKILL]: SKILL_MD("acme-skill") };

/** Every stripped name set to a value that would do harm if it took effect, all inside the world's root. */
function hostile(world: World): Record<string, string> {
  const root = world.rig.root;
  const bin = path.join(root, "service-bin");
  fs.mkdirSync(bin, { recursive: true });
  const marker = path.join(root, "service-ran");
  for (const tool of ["launchctl", "systemctl", "schtasks", "schtasks.exe"]) {
    fs.writeFileSync(path.join(bin, tool), `#!/bin/sh\necho ran >> ${JSON.stringify(marker)}\n`, {
      mode: 0o755,
    });
  }
  const env: Record<string, string> = Object.fromEntries(
    STRIPPED_NAMES.map((name) => [name, path.join(root, `value-of-${name}`)]),
  );
  env["CREWRIG_USAGE_ROOT"] = path.join(root, "usage-root");
  env["CREWRIG_TEST_SERVICE_BIN_DIR"] = bin;
  env["CREWRIG_TEST_SERVICE_PLATFORM"] = process.platform === "darwin" ? "linux" : "darwin";
  env["CREWRIG_TLS_CA"] = path.join(root, "nonexistent.pem");
  env["MEMPALACE_MCP_EVICT_CMD"] =
    `${JSON.stringify(process.execPath)} -e "require('fs').writeFileSync(${JSON.stringify(path.join(root, "evicted"))}, 'x')"`;
  env["MEMPALACE_MCP_EXPECTED_PID"] = "1";
  env["MEMPALACE_MCP_LISTENER_PID"] = "2";
  env["MCP_DAEMON_REPLACE_DEADLINE"] = "1";
  env["MEMPALACE_MCP_LABEL"] = "com.example.hostile";
  env["MEMPALACE_MCP_UNIT"] = "hostile-unit";
  return env;
}

/** Output with the paths and times that differ between two worlds replaced, for comparing two runs. */
function normal(world: World, text: string): string {
  return text
    .split(world.rig.root)
    .join("<ROOT>")
    .replace(/crewrig-compile-[A-Za-z0-9]+/g, "crewrig-compile-X")
    .replace(/\d{8}-\d{6}(\.\d+)?/g, "<STAMP>")
    .replace(/crewrig-launcher-[A-Za-z0-9]+/g, "crewrig-launcher-X");
}

/** The user-visible home of a world as `path<TAB>digest` lines, normalised, without the version cache. */
function homeState(world: World): string[] {
  const home = world.rig.home;
  return treeList(home)
    .filter((entry) => !entry.startsWith(".crewrig/versions/") && !/\.bak\./.test(entry))
    .map((entry) => {
      if (entry.endsWith("/") || entry.endsWith("@")) return entry;
      const text = normal(world, fs.readFileSync(path.join(home, entry), "utf8"));
      return `${entry}\t${createHash("sha256").update(text).digest("hex")}`;
    });
}

function assertOffHost(world: World, before: string[]): void {
  assert.deepEqual(
    daemonFilesUnder(treeList(world.rig.home)),
    [],
    "no daemon, unit or task file in the home",
  );
  assert.deepEqual(hostServices(), before, "the host's service manager is unchanged");
  assert.ok(
    !fs.existsSync(path.join(world.rig.root, "service-ran")),
    "no service manager tool ran",
  );
}

describe("delta-01 R14: a test seam or a stripped variable has no effect on build and setup", () => {
  test("with every stripped variable set, build and setup give the output, the files and the exit code of a run with none", async () => {
    const hostBefore = hostServices();
    const clean = await newWorld(rigs, servers);
    const dirty = await newWorld(rigs, servers);
    const cleanOrg = clean.makeOrg({ files: FILES, gitignore: IGNORE_TEXT });
    const dirtyOrg = dirty.makeOrg({ files: FILES, gitignore: IGNORE_TEXT });
    const env = hostile(dirty);

    const results: [string, RunResult, RunResult][] = [];
    for (const command of ["build", "setup"] as const) {
      const args = command === "setup" ? ["--cli", "claude", ...answerArgs({})] : [];
      results.push([
        command,
        await clean.run(cleanOrg, command, args),
        await dirty.run(dirtyOrg, command, args, { env }),
      ]);
    }

    for (const [command, a, b] of results) {
      assert.equal(a.code, 0, `${command}: ${a.out}`);
      assert.equal(b.code, a.code, `${command}: ${b.out}`);
      assert.equal(normal(dirty, b.out), normal(clean, a.out), `${command}: the output differs`);
    }
    assert.deepEqual(homeState(dirty), homeState(clean), "the files setup wrote differ");
    assert.deepEqual(
      snapshot(path.join(dirtyOrg, "dist")).map((line) => normal(dirty, line)),
      snapshot(path.join(cleanOrg, "dist")).map((line) => normal(clean, line)),
      "dist/ differs",
    );
    assert.ok(!fs.existsSync(path.join(dirty.rig.root, "evicted")), "the evict command ran");
    assert.ok(
      !fs.existsSync(env["CREWRIG_USAGE_ROOT"] ?? ""),
      "a usage directory was created under CREWRIG_USAGE_ROOT",
    );
    assertOffHost(dirty, hostBefore);
  });

  test("CREWRIG_TLS_CA pointing at a file that does not exist does not fail setup and is not mentioned", async () => {
    const world = await newWorld(rigs, servers);
    const dir = world.makeOrg({ gitignore: IGNORE_TEXT });

    const run = await world.setup(dir, "claude", [], {
      env: { CREWRIG_TLS_CA: "/nonexistent.pem" },
    });

    assert.equal(run.code, 0, run.out);
    assert.doesNotMatch(run.out, /nonexistent\.pem/);
  });

  test("setup with the six allowlisted values set exits 0 and, with no MemPalace interpreter, stays off the host", async () => {
    const hostBefore = hostServices();
    const world = await newWorld(rigs, servers);
    const dir = world.makeOrg({ gitignore: IGNORE_TEXT });
    const palace = path.join(world.rig.root, "palace");

    const run = await world.setup(dir, "claude", [], {
      env: {
        MEMPALACE_MCP_HOST: "127.0.0.2",
        MEMPALACE_MCP_PORT: "8765",
        MEMPALACE_CHROMA_HOST: "127.0.0.3",
        MEMPALACE_CHROMA_PORT: "8011",
        MEMPALACE_PALACE_PATH: palace,
        MEMPALACE_PYTHON: path.join(palace, "stub-python"),
      },
    });

    assert.equal(run.code, 0, run.out);
    assert.match(run.out, /MemPalace not found/, "no MemPalace interpreter was detected");
    assertOffHost(world, hostBefore);
  });
});

describe("delta-01 R12, v3-F2: a generic REPO_DIR is never a source of framework data", () => {
  async function decoy(world: World): Promise<string> {
    const dir = world.rig.newDir("decoy");
    fs.mkdirSync(path.join(dir, "config"), { recursive: true });
    fs.writeFileSync(path.join(dir, "config", "ORGANIZATION.md"), "# DECOY ORGANIZATION\n");
    fs.writeFileSync(path.join(dir, "config", "TOOLS.md"), "# DECOY TOOLS\n");
    fs.mkdirSync(path.join(dir, "artifacts", "org", "skills", "decoy-skill"), { recursive: true });
    fs.writeFileSync(
      path.join(dir, "artifacts", "org", "skills", "decoy-skill", "SKILL.md"),
      SKILL_MD("decoy-skill"),
    );
    fs.mkdirSync(path.join(dir, "artifacts", "core", "skills", "decoy-core"), { recursive: true });
    fs.writeFileSync(
      path.join(dir, "artifacts", "core", "skills", "decoy-core", "SKILL.md"),
      SKILL_MD("decoy-core"),
    );
    fs.writeFileSync(
      path.join(dir, "crewrig.config.toml"),
      'canonical_repo = "https://github.com/decoy/decoy"\nfeedback_repo = "https://github.com/decoy/decoy"\n',
    );
    return dir;
  }

  test("build gives the same dist/ with REPO_DIR naming a decoy tree as without it", async () => {
    const clean = await newWorld(rigs, servers);
    const dirty = await newWorld(rigs, servers);
    const cleanOrg = clean.makeOrg({ files: FILES });
    const dirtyOrg = dirty.makeOrg({ files: FILES });

    const a = await clean.run(cleanOrg, "build");
    const b = await dirty.run(dirtyOrg, "build", [], { env: { REPO_DIR: await decoy(dirty) } });

    assert.equal(a.code, 0, a.out);
    assert.equal(b.code, 0, b.out);
    const built = snapshot(path.join(dirtyOrg, "dist")).map((line) => normal(dirty, line));
    assert.deepEqual(
      built,
      snapshot(path.join(cleanOrg, "dist")).map((line) => normal(clean, line)),
    );
    assert.ok(!built.some((line) => line.includes("decoy")), "the decoy tree was read");
    assert.equal(normal(dirty, b.out), normal(clean, a.out));
  });

  test("setup installs the organization's own files with REPO_DIR naming a decoy tree", async () => {
    const world = await newWorld(rigs, servers);
    const dir = world.makeOrg({ files: FILES, gitignore: IGNORE_TEXT });

    const run = await world.setup(dir, "claude", [], { env: { REPO_DIR: await decoy(world) } });

    assert.equal(run.code, 0, run.out);
    const rule = fs.readFileSync(
      path.join(world.rig.home, ".claude", "rules", "20-organization.md"),
      "utf8",
    );
    assert.doesNotMatch(rule, /DECOY/);
    assert.ok(
      !treeList(world.rig.home).some((entry) => entry.includes("decoy")),
      "a decoy component was installed",
    );
  });
});

describe("delta-01 R14: update forwards the launcher's variable and nothing else of the stripped classes", () => {
  test("the run that update starts sees CREWRIG_RELEASE_BASE_URL and the six, and none of the stripped names", async () => {
    const world = await newWorld(rigs, servers);
    const other = world.makeOrg();
    assert.equal((await world.run(other, "build")).code, 0, "caches the version root");
    const org = world.makeOrg({ gitignore: IGNORE_TEXT });
    const recorded = path.join(world.rig.root, "launcher-env.json");
    // A launcher that only records what it was given: update must run the file of the organization directory.
    fs.writeFileSync(
      path.join(org, "crewrig"),
      `const fs = process.getBuiltinModule("node:fs");\nfs.writeFileSync(process.env.STUB_ENV_OUT, JSON.stringify({ env: process.env, argv: process.argv.slice(2), cwd: process.cwd() }));\n`,
    );
    const { clone } = withUpstream(world.rig, org);
    const six = Object.fromEntries(ALLOWLIST.map((name) => [name, `six-${name}`]));

    const run = await runEntryOf(
      world,
      world.versionRoot(),
      clone,
      ["update", "--cli", "claude", "--answer", "validation.backend=internal"],
      {
        env: {
          ...hostile(world),
          ...six,
          STUB_ENV_OUT: recorded,
          NODE_EXTRA_CA_CERTS: "/corp.pem",
        },
      },
    );

    assert.equal(run.code, 0, run.out);
    const seen = JSON.parse(fs.readFileSync(recorded, "utf8")) as {
      env: Record<string, string>;
      argv: string[];
      cwd: string;
    };
    assert.equal(seen.env[LAUNCHER_VARIABLE], world.server.origin);
    for (const [name, value] of Object.entries(six)) assert.equal(seen.env[name], value, name);
    for (const name of STRIPPED_NAMES)
      assert.equal(seen.env[name], undefined, `${name} reached the launcher`);
    assert.equal(
      seen.env["NODE_EXTRA_CA_CERTS"],
      "/corp.pem",
      "the standard trust variables are unaffected",
    );
    assert.deepEqual(seen.argv, [
      "setup",
      "--cli",
      "claude",
      "--answer",
      "validation.backend=internal",
    ]);
    assert.equal(fs.realpathSync(seen.cwd), fs.realpathSync(clone));
  });
});

describe("v3-F1: the isolation of the tests is the PATH and the HOME, and it holds for every CLI", () => {
  for (const cli of ["claude", "gemini", "copilot", "antigravity"] as const) {
    test(`${cli}: setup leaves no daemon file in the home and the host's service manager unchanged`, async () => {
      const hostBefore = hostServices();
      const world = await newWorld(rigs, servers);
      const dir = world.makeOrg({ gitignore: IGNORE_TEXT });

      const run = await world.setup(dir, cli);

      assert.equal(run.code, 0, run.out);
      assertOffHost(world, hostBefore);
    });
  }
});
