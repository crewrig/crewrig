// crewrig-update.test.ts — `node crewrig update --cli <name>` end to end (spec 0315 R3, R9, R12, R14).
//
// The organization's upstream is a local bare git repository, its clone is the user's directory, and the
// archives are served by a local HTTP server (no other network). `update` fast-forwards the clone, runs the
// launcher with `setup`, and exits 0 or 1 only: a launcher code from 10 to 14 is reported, never returned.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";
import {
  assetPath,
  serveBytes,
  snapshot,
  trackRigs,
  trackServers,
  type Archive,
} from "./lib/launcher-rig.ts";
import {
  IGNORE_TEXT,
  SKILL_MD,
  archiveOfVersion,
  answerArgs,
  gitIn,
  newWorld,
  porcelain,
  runEntryOf,
  treeDigest,
  withUpstream,
  type Upstream,
  type World,
} from "./lib/org-rig.ts";
import { daemonFilesUnder, namesHook } from "./lib/org-toolchain.ts";
import { isOtherCachedVersionPath } from "../lib/setup/org-roots.ts";
import { classifyPaths } from "../lib/setup/usage-capture-rank.ts";
import { hookCommand, shellPath } from "../lib/session-check-config.ts";

const rigs = trackRigs();
const servers = trackServers();

const SKILL = "artifacts/org/skills/acme-skill/SKILL.md";
/** Session recording on, so that the settings carry hooks that name the version root. */
const RECORDING = { transcripts: "yes", "transcripts-confirm": "yes" };
/** The hooks of the settings that setup rewrites from the running version root at every run. */
const RECORDED_HOOKS = ["mempalace-transcript.ts", "worktree-git-guard.ts"];
const FIRST = archiveOfVersion("1.0.0-test.1");
const SECOND = archiveOfVersion("1.0.0-test.2");

interface Clone {
  readonly world: World;
  readonly up: Upstream;
  readonly clone: string;
}

/** A user's clone of the organization repository on which `setup --cli claude` has already run. */
async function cloneWithSetup(): Promise<Clone> {
  const world = await newWorld(rigs, servers, FIRST);
  const org = world.makeOrg({ gitignore: IGNORE_TEXT, files: { [SKILL]: SKILL_MD("acme-skill") } });
  const up = withUpstream(world.rig, org);
  const run = await world.run(up.clone, "setup", ["--cli", "claude", ...answerArgs(RECORDING)]);
  assert.equal(run.code, 0, run.out);
  assert.equal(porcelain(world.rig, up.clone), "", "the clone is clean after setup");
  return { world, up, clone: up.clone };
}

/** Author-side commit: write `files` in the author's clone, publish. */
function authorCommit(up: Upstream, files: Record<string, string>, message: string): void {
  for (const [rel, content] of Object.entries(files)) {
    fs.writeFileSync(path.join(up.author, rel), content);
  }
  up.publish(message);
}

const pinText = (archive: Archive, sha = archive.sha256): string =>
  `${JSON.stringify({ version: archive.version, sha256: sha }, null, 2)}\n`;

const claudeSettings = (world: World): string =>
  fs.readFileSync(path.join(world.rig.home, ".claude", "settings.json"), "utf8");

/** Every exit code of these tests, checked once at the end against spec 0315 R3. */
const seenCodes: number[] = [];

async function update(
  world: World,
  dir: string,
  extra: readonly string[] = [],
): ReturnType<World["run"]> {
  const run = await world.run(dir, "update", [
    "--cli",
    "claude",
    ...answerArgs(RECORDING),
    ...extra,
  ]);
  seenCodes.push(run.code ?? -1);
  return run;
}

describe("R9: a clean pull and a pin that moves to a second archive", () => {
  test("fast-forwards, fetches the new version, rewires the hooks to it, and exits 0", async () => {
    const { world, up, clone } = await cloneWithSetup();
    const first = world.versionRoot("1.0.0-test.1");
    const firstDigest = treeDigest(first);
    for (const name of RECORDED_HOOKS)
      assert.ok(namesHook(claudeSettings(world), FIRST.version, name), name);
    world.server.route(assetPath(SECOND.version), serveBytes(fs.readFileSync(SECOND.file)));
    authorCommit(
      up,
      { "crewrig.pin.json": pinText(SECOND), ".gitignore": `${IGNORE_TEXT}node_modules\n` },
      "move the pin and ignore node_modules",
    );
    assert.equal(porcelain(world.rig, clone), "", "the clone is clean before the pull");

    const run = await update(world, clone);

    assert.equal(run.code, 0, run.out);
    const second = world.versionRoot("1.0.0-test.2");
    assert.ok(fs.existsSync(path.join(second, "crewrig.entry.json")), "the new version is cached");
    const settings = claudeSettings(world);
    for (const name of RECORDED_HOOKS) {
      assert.ok(namesHook(settings, SECOND.version, name), `${name} names the new version`);
      assert.ok(
        !namesHook(settings, FIRST.version, name),
        `${name} no longer names the old version`,
      );
    }
    assert.equal(treeDigest(first), firstDigest, "the old cached version is not altered");
    assert.equal(fs.readFileSync(path.join(clone, "crewrig.pin.json"), "utf8"), pinText(SECOND));
    assert.equal(
      fs.readFileSync(path.join(clone, ".gitignore"), "utf8"),
      `${IGNORE_TEXT}node_modules\n`,
    );
    assert.equal(porcelain(world.rig, clone), "", "the clone is clean after update");
    assert.equal(
      gitIn(world.rig, clone, ["rev-parse", "HEAD"]),
      gitIn(world.rig, up.author, ["rev-parse", "HEAD"]),
    );
  });

  // With the default answer `keep`, the usage-capture handler registered at the old version root is judged
  // vanished (another cached version, usage-capture-keep.ts), so it is re-pointed at the running version. Spec 0315
  // R6 requires every hook that setup writes to name the running version root.
  test("the usage-capture hook also names the new version after update", async () => {
    const { world, up, clone } = await cloneWithSetup();
    world.server.route(assetPath(SECOND.version), serveBytes(fs.readFileSync(SECOND.file)));
    authorCommit(up, { "crewrig.pin.json": pinText(SECOND) }, "move the pin");

    const run = await update(world, clone);

    assert.equal(run.code, 0, run.out);
    const settings = claudeSettings(world);
    assert.ok(namesHook(settings, SECOND.version, "usage-capture.ts"));
    assert.ok(!namesHook(settings, FIRST.version, "usage-capture.ts"));
  });

  test("a live user-owned usage-capture entry outside the cache is kept by update", async () => {
    const { world, up, clone } = await cloneWithSetup();
    const custom = path.join(world.rig.home, "custom-hooks", "usage-capture.ts");
    fs.mkdirSync(path.dirname(custom), { recursive: true });
    fs.writeFileSync(custom, "// the user's own capture script\n");
    const file = path.join(world.rig.home, ".claude", "settings.json");
    const config = JSON.parse(fs.readFileSync(file, "utf8")) as {
      hooks: Record<string, { hooks: { command: string }[] }[]>;
    };
    const stop = config.hooks["Stop"]?.[0]?.hooks;
    assert.ok(stop !== undefined, "a Stop group exists");
    // The command as setup writes it on win32: the path with forward slashes, inside double quotes.
    const customCommand = custom.replaceAll("\\", "/");
    stop.push({ command: `node "${customCommand}" claude-code Stop` } as { command: string });
    fs.writeFileSync(file, JSON.stringify(config));
    authorCommit(up, { "crewrig.pin.json": pinText(SECOND) }, "move the pin");
    world.server.route(assetPath(SECOND.version), serveBytes(fs.readFileSync(SECOND.file)));

    const run = await update(world, clone);

    assert.equal(run.code, 0, run.out);
    const settings = claudeSettings(world);
    assert.ok(settings.includes(customCommand), "the user's own entry is kept");
    assert.ok(!namesHook(settings, FIRST.version, "usage-capture.ts"));
  });

  test("an upstream commit that only changes the .gitignore does not block the pull", async () => {
    const { world, up, clone } = await cloneWithSetup();
    authorCommit(up, { ".gitignore": `${IGNORE_TEXT}coverage/\n` }, "ignore coverage");

    const run = await update(world, clone);

    assert.equal(run.code, 0, run.out);
    assert.equal(
      fs.readFileSync(path.join(clone, ".gitignore"), "utf8"),
      `${IGNORE_TEXT}coverage/\n`,
    );
  });

  test("with nothing new to pull, setup still runs and exits 0", async () => {
    const { world, clone } = await cloneWithSetup();
    fs.rmSync(path.join(world.rig.home, ".claude", "settings.json"));

    const run = await update(world, clone);

    assert.equal(run.code, 0, run.out);
    assert.ok(
      fs.existsSync(path.join(world.rig.home, ".claude", "settings.json")),
      "the setup step ran: it wrote settings.json again",
    );
  });

  test("update forwards --answer to setup", async () => {
    const { world, up, clone } = await cloneWithSetup();
    fs.writeFileSync(
      path.join(up.author, "config", "teams", "ACME-TEAM.md"),
      "# ACME-TEAM\n\nacme-only\n",
    );
    up.publish("add a team");

    const run = await world.run(clone, "update", [
      "--cli",
      "claude",
      ...answerArgs({ "catalogue.team": "ACME-TEAM" }),
    ]);

    assert.equal(run.code, 0, run.out);
    const rule = fs.readFileSync(
      path.join(world.rig.home, ".claude", "rules", "50-team.md"),
      "utf8",
    );
    assert.match(rule, /acme-only/);
  });
});

describe("R9: the pull fails, nothing else runs", () => {
  async function assertStopped(
    world: World,
    clone: string,
    before: string[],
    head: string,
  ): Promise<void> {
    assert.deepEqual(
      snapshot(world.rig.home).filter((line) => !line.startsWith(".crewrig/versions/")),
      before,
      "no setup ran",
    );
    assert.equal(gitIn(world.rig, clone, ["rev-parse", "HEAD"]), head, "no merge, reset or rebase");
    assert.equal(gitIn(world.rig, clone, ["stash", "list"]), "", "nothing stashed");
    assert.ok(!fs.existsSync(path.join(clone, ".git", "MERGE_HEAD")));
  }

  const homeBefore = (world: World): string[] =>
    snapshot(world.rig.home).filter((line) => !line.startsWith(".crewrig/versions/"));

  test("a diverged branch exits 1 naming the pull, saying setup alone still installs the pin", async () => {
    const { world, up, clone } = await cloneWithSetup();
    fs.writeFileSync(path.join(clone, "local.txt"), "mine\n");
    gitIn(world.rig, clone, ["add", "local.txt"]);
    gitIn(world.rig, clone, ["commit", "-q", "-m", "local"]);
    authorCommit(up, { "upstream.txt": "theirs\n" }, "upstream");
    const before = homeBefore(world);
    const head = gitIn(world.rig, clone, ["rev-parse", "HEAD"]);

    const run = await update(world, clone);

    assert.equal(run.code, 1, run.out);
    assert.match(run.out, /git pull --ff-only failed/);
    assert.match(run.out, /setup alone still installs the version already pinned/);
    await assertStopped(world, clone, before, head);
  });

  test("a branch without an upstream exits 1 naming it, changing nothing", async () => {
    const { world, clone } = await cloneWithSetup();
    gitIn(world.rig, clone, ["checkout", "-q", "-b", "lonely"]);
    const before = homeBefore(world);
    const head = gitIn(world.rig, clone, ["rev-parse", "HEAD"]);

    const run = await update(world, clone);

    assert.equal(run.code, 1, run.out);
    assert.match(run.out, /no upstream/);
    await assertStopped(world, clone, before, head);
  });

  test("an unreachable remote exits 1 and runs no setup", async () => {
    const { world, clone } = await cloneWithSetup();
    gitIn(world.rig, clone, ["remote", "set-url", "origin", path.join(world.rig.root, "gone.git")]);
    const before = homeBefore(world);
    const head = gitIn(world.rig, clone, ["rev-parse", "HEAD"]);

    const run = await update(world, clone);

    assert.equal(run.code, 1, run.out);
    assert.match(run.out, /git pull --ff-only failed/);
    await assertStopped(world, clone, before, head);
  });

  test("a directory that is not a git work tree exits 1", async () => {
    const world = await newWorld(rigs, servers, FIRST);
    const dir = world.makeOrg({ gitignore: IGNORE_TEXT });

    const run = await update(world, dir);

    assert.equal(run.code, 1, run.out);
    assert.match(run.out, /not a git work tree/);
    assert.deepEqual(homeBefore(world), [".crewrig/"]);
  });

  test("a clone without its crewrig launcher file exits 1 naming it, changing nothing", async () => {
    const { world, clone } = await cloneWithSetup();
    fs.rmSync(path.join(clone, "crewrig"));
    const before = homeBefore(world);
    const head = gitIn(world.rig, clone, ["rev-parse", "HEAD"]);

    const run = await runEntryOf(world, world.versionRoot(), clone, [
      "update",
      "--cli",
      "claude",
      ...answerArgs({}),
    ]);
    seenCodes.push(run.code ?? -1);

    assert.equal(run.code, 1, run.out);
    assert.match(run.out, /crewrig is missing|crewrig.*missing/);
    await assertStopped(world, clone, before, head);
  });
});

describe("R3, R9: a launcher refusal inside update never surfaces as a launcher code", () => {
  test("a defective pin: exit 1, the message names crewrig.pin.json and the launcher's code 11", async () => {
    const { world, up, clone } = await cloneWithSetup();
    authorCommit(up, { "crewrig.pin.json": "{ not json\n" }, "break the pin");

    const run = await update(world, clone);

    assert.equal(run.code, 1, run.out);
    assert.match(run.out, /launcher ended with its own code 11/);
    assert.match(run.out, /crewrig\.pin\.json/);
  });

  test("a digest the archive does not match: exit 1, the message names code 13", async () => {
    const { world, up, clone } = await cloneWithSetup();
    const THIRD = "1.0.0-test.3";
    world.server.route(assetPath(THIRD), serveBytes(fs.readFileSync(SECOND.file)));
    authorCommit(
      up,
      { "crewrig.pin.json": pinText({ ...SECOND, version: THIRD }, "0".repeat(64)) },
      "pin a digest that does not match",
    );

    const run = await update(world, clone);

    assert.equal(run.code, 1, run.out);
    assert.match(run.out, /launcher ended with its own code 13/);
    assert.match(run.out, /digest/);
    assert.ok(!fs.existsSync(world.versionRoot(THIRD)), "nothing from the bad archive is cached");
  });

  test("a download that fails: exit 1, the message names code 12", async () => {
    const { world, up, clone } = await cloneWithSetup();
    authorCommit(
      up,
      { "crewrig.pin.json": pinText({ ...SECOND, version: "1.0.0-test.4" }) },
      "pin a version that nobody serves",
    );

    const run = await update(world, clone);

    assert.equal(run.code, 1, run.out);
    assert.match(run.out, /launcher ended with its own code 12/);
  });

  test("update never modifies crewrig.pin.json or crewrig.config.toml", async () => {
    const { world, up, clone } = await cloneWithSetup();
    const config = fs.readFileSync(path.join(clone, "crewrig.config.toml"));
    authorCommit(up, { "crewrig.pin.json": "{ not json\n" }, "break the pin");

    await update(world, clone);

    assert.equal(fs.readFileSync(path.join(clone, "crewrig.pin.json"), "utf8"), "{ not json\n");
    assert.deepEqual(fs.readFileSync(path.join(clone, "crewrig.config.toml")), config);
  });

  test("across every case above, no update run ended with a code from 10 to 14", () => {
    assert.ok(seenCodes.length >= 10, `${seenCodes.length} runs were recorded`);
    for (const code of seenCodes) assert.ok(code === 0 || code === 1, `exit code ${code}`);
  });
});

describe("the win32 forms of the hook paths (spec 0315 R6, spec 0256 delta-03 (t))", () => {
  // A Windows runner's temporary directory is spelled with an 8.3 short name in the environment and with the long
  // name on disk; the simulated physical form below stands for fs.realpathSync.native.
  const SHORT = "C:\\runner\\RUNNER~1\\rig\\home";
  const LONG = "C:/runner/runneradmin/rig/home";
  const physical = (dir: string): string => dir.replaceAll("RUNNER~1", "runneradmin");
  const repoDir = `${SHORT}\\.crewrig\\versions\\1.0.0-test.2`;

  test("a capture handler of another cached version is recognised whatever the spelling", () => {
    const other = `${LONG}/.crewrig/versions/1.0.0-test.1/hooks/usage-capture.ts`;
    assert.equal(isOtherCachedVersionPath(other, SHORT, repoDir, path.win32, physical), true);
    const upper = other.replace("/.crewrig/versions/", "/.CREWRIG/VERSIONS/").toUpperCase();
    assert.equal(isOtherCachedVersionPath(upper, SHORT, repoDir, path.win32, physical), true);
  });

  test("the running version, a checkout and another user's home are not other cached versions", () => {
    const running = `${LONG}/.crewrig/versions/1.0.0-test.2/hooks/usage-capture.ts`;
    const checkout = `${LONG}/work/crewrig/hooks/usage-capture.ts`;
    const otherUser = "C:/profiles/someone/.crewrig/versions/1.0.0-test.1/hooks/usage-capture.ts";
    assert.equal(isOtherCachedVersionPath(running, SHORT, repoDir, path.win32, physical), false);
    assert.equal(isOtherCachedVersionPath(checkout, SHORT, repoDir, path.win32, physical), false);
    assert.equal(isOtherCachedVersionPath(otherUser, SHORT, repoDir, path.win32, physical), false);
  });

  test("the classifier judges a forward-slash drive path live on win32, and skips it on the POSIX rule", () => {
    const hook = `${LONG}/.crewrig/versions/1.0.0-test.1/hooks/usage-capture.ts`;
    const isFile = (p: string): boolean => p === hook;
    const win = classifyPaths([hook], isFile, path.win32.isAbsolute);
    assert.deepEqual(win.live, [hook]);
    assert.equal(win.target, hook);
    const posix = classifyPaths([hook], isFile);
    assert.deepEqual(posix.live, []);
    assert.deepEqual(posix.vanished, []);
  });

  test("a hook command carries the win32 path with forward slashes, which the shell word accepts", () => {
    const node = shellPath("win32", "C:\\hostedtoolcache\\windows\\node\\24.22.3\\x64\\node.exe");
    const check = shellPath(
      "win32",
      `${SHORT}\\.crewrig\\hooks\\session-check\\mempalace-session-check.ts`,
    );
    assert.equal(node, "C:/hostedtoolcache/windows/node/24.22.3/x64/node.exe");
    assert.doesNotThrow(() => hookCommand(node, check, "claude"));
    assert.throws(
      () => hookCommand(node.replaceAll("/", "\\"), check, "claude"),
      /cannot be wired/,
    );
    assert.equal(shellPath("linux", "/usr/bin/node"), "/usr/bin/node");
  });

  test("namesHook matches a hook written with forward slashes, a JSON-escaped backslash or a long name", () => {
    const written = `node "${LONG}/.crewrig/versions/1.0.0-test.2/hooks/usage-capture.ts" claude-code Stop`;
    const escaped = JSON.stringify({ command: written.replaceAll("/", "\\") }).slice(1, -1);
    for (const text of [written, escaped]) {
      assert.ok(namesHook(text, "1.0.0-test.2", "usage-capture.ts"));
      assert.ok(!namesHook(text, "1.0.0-test.1", "usage-capture.ts"));
      assert.ok(!namesHook(text, "1.0.0-test.2", "mempalace-transcript.ts"));
    }
  });

  test("the trust wrapper's bundle is no daemon; the launcher's bundle is", () => {
    const trust = [".crewrig/service-lib/launcher-child.ts", ".crewrig/service-lib/tls-env.ts"];
    assert.deepEqual(daemonFilesUnder(trust), []);
    const launcher = [...trust, ".crewrig/service-lib/launcher-wait.ts"];
    assert.deepEqual(daemonFilesUnder(launcher), [".crewrig/service-lib/launcher-wait.ts"]);
  });
});
