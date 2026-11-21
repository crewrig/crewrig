// crewrig-init-e2e.test.ts — the template, the launcher and `init` together (spec 0314 R12, R13 and R19;
// spec 0288 R27): a fresh copy of templates/org-repo with its pin rewritten to a locally built archive,
// served by a local server, runs `node crewrig init --feedback-repo <url>` and exits 0 with exactly the
// scaffold of R15. The launcher file is the template's own, run unmodified. No test downloads a release.
//
// The archive is built from manifest.txt alone (`testManifestEntries()`), so the files the entry point
// loads, and the catalogs it copies, come out of the archive and not out of the checkout.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { before, describe, test } from "node:test";
import { CANONICAL_REPO, TEMPLATE_FILES, assertScaffold, withOrigin } from "./lib/init-scaffold.ts";
import {
  LAUNCHER_SOURCE,
  REPO,
  TEMPLATE_DIR,
  assetPath,
  closedPort,
  copyTemplate,
  homeOutsideVersions,
  manifestArchive,
  pinOf,
  runLauncher,
  serveArchive,
  snapshot,
  trackRigs,
  trackServers,
  treeList,
  versionEntries,
  type Archive,
  type Rig,
  type TestServer,
} from "./lib/launcher-rig.ts";

const rigs = trackRigs();
const servers = trackServers();
const VARIABLE = "CREWRIG_RELEASE_BASE_URL";
const FEEDBACK = "https://github.com/acme/crewrig-config";

let archive: Archive;

before(() => {
  archive = manifestArchive();
});

async function world(): Promise<{ rig: Rig; server: TestServer; dir: string }> {
  const rig = rigs.make();
  const server = await servers.start();
  serveArchive(server, archive);
  return { rig, server, dir: copyTemplate(rig, pinOf(archive)) };
}

describe("R12 and R13: the template directory", () => {
  test("holds exactly the launcher, the pin and the README", () => {
    assert.deepEqual(treeList(TEMPLATE_DIR).sort(), ["README.md", "crewrig", "crewrig.pin.json"]);
  });

  test("the launcher is the single source: no other tracked file is named crewrig", () => {
    const listed = spawnSync("git", ["ls-files", "-z"], { cwd: REPO, encoding: "utf8" });
    const named = listed.stdout.split("\0").filter((file) => file.split("/").pop() === "crewrig");

    assert.deepEqual(named, ["templates/org-repo/crewrig"]);
  });

  test("the launcher is executable in git (100755), read from the index and not from the file system", () => {
    const env: NodeJS.ProcessEnv = { ...process.env };
    for (const key of Object.keys(env)) if (/^git_/i.test(key)) delete env[key];
    const staged = spawnSync("git", ["ls-files", "-s", "--", "templates/org-repo/crewrig"], {
      cwd: REPO,
      env,
      encoding: "utf8",
    });

    assert.equal(staged.status, 0, staged.stderr);
    assert.match(staged.stdout.trim(), /^100755 [0-9a-f]+ 0\ttemplates\/org-repo\/crewrig$/);
  });

  test("the launcher starts with the node shebang and parses", () => {
    const text = fs.readFileSync(LAUNCHER_SOURCE, "utf8");
    const checked = spawnSync(process.execPath, ["--check", LAUNCHER_SOURCE], { encoding: "utf8" });

    assert.equal(text.split("\n")[0], "#!/usr/bin/env node");
    assert.equal(checked.status, 0, checked.stderr);
  });

  test("the pin is well-formed: an exact version, a lowercase SHA-256, an optional base URL", async () => {
    const pin: unknown = JSON.parse(
      fs.readFileSync(path.join(TEMPLATE_DIR, "crewrig.pin.json"), "utf8"),
    );

    assert.ok(typeof pin === "object" && pin !== null && !Array.isArray(pin));
    const { version, sha256, base_url: baseUrl } = pin as Record<string, unknown>;
    assert.match(String(version), /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(-[0-9A-Za-z.-]+)?$/);
    assert.match(String(sha256), /^[0-9a-f]{64}$/);
    if (baseUrl !== undefined) assert.match(String(baseUrl), /^https?:\/\/[^\s?#"\\@]+$/);
  });

  test("the launcher itself accepts the shipped pin: with an empty cache it goes on to the download", async () => {
    const rig = rigs.make();
    const dir = rig.newDir("shipped");
    for (const name of TEMPLATE_FILES)
      fs.copyFileSync(path.join(TEMPLATE_DIR, name), path.join(dir, name));
    const port = await closedPort();

    const run = await runLauncher(rig, dir, ["init"], {
      env: { [VARIABLE]: `http://127.0.0.1:${port}` },
    });

    assert.equal(run.code, 12, `a pin defect would be 11: ${run.out}`);
  });

  test("the README states the contract of R12", () => {
    const readme = fs.readFileSync(path.join(TEMPLATE_DIR, "README.md"), "utf8");

    for (const phrase of [
      "Node.js 24",
      "node crewrig init",
      "crewrig.pin.json",
      "sha256",
      "base_url",
      "CREWRIG_RELEASE_BASE_URL",
    ]) {
      assert.ok(readme.includes(phrase), `the README mentions ${phrase}`);
    }
  });
});

describe("R13 and R19: the template, the launcher and init, end to end", () => {
  test("init scaffolds the organization config repository (scenario)", async () => {
    const { rig, server, dir } = await world();
    const outsideBefore = treeList(rig.root).filter(
      (line) => !line.startsWith("org-") && !line.startsWith("home"),
    );

    const run = await runLauncher(rig, dir, ["init", "--feedback-repo", FEEDBACK], {
      env: { [VARIABLE]: server.origin },
    });

    assert.equal(run.code, 0, run.out);
    assertScaffold(dir, FEEDBACK);
    assert.deepEqual(server.requests, [`GET ${assetPath(archive.version)}`]);
    assert.deepEqual(versionEntries(rig), [archive.version], "the version is cached, nothing else");
    assert.deepEqual(
      homeOutsideVersions(rig),
      [".crewrig/"],
      "nothing is written under the home beyond versions/",
    );
    assert.deepEqual(
      treeList(rig.root).filter((line) => !line.startsWith("org-") && !line.startsWith("home")),
      outsideBefore,
      "nothing is written outside the working directory and ~/.crewrig/versions/",
    );
  });

  test("a second init runs from the cache with no request, and is refused with the entry point's code 1", async () => {
    const { rig, server, dir } = await world();
    const env = { [VARIABLE]: server.origin };
    await runLauncher(rig, dir, ["init", "--feedback-repo", FEEDBACK], { env });
    const before = snapshot(dir);

    const run = await runLauncher(rig, dir, ["init", "--feedback-repo", FEEDBACK], { env });

    assert.equal(run.code, 1, run.out);
    assert.match(run.out, /crewrig\.config\.toml/);
    assert.equal(server.requests.length, 1);
    assert.deepEqual(snapshot(dir), before);
  });

  test("no command and an unknown command are the entry point's own error, code 2, after a verified version", async () => {
    const { rig, server, dir } = await world();
    const env = { [VARIABLE]: server.origin };

    const none = await runLauncher(rig, dir, [], { env });
    const unknown = await runLauncher(rig, dir, ["no-such-command", "--x"], { env });

    assert.equal(none.code, 2, none.out);
    assert.equal(unknown.code, 2, unknown.out);
    assert.match(unknown.out, /no-such-command/);
    assert.equal(server.requests.length, 1, "the version was downloaded once, then cached");
  });

  test("init takes feedback_repo from the origin remote (scenario)", async () => {
    const { rig, server, dir } = await world();
    withOrigin(rig, dir, FEEDBACK);

    const run = await runLauncher(rig, dir, ["init"], { env: { [VARIABLE]: server.origin } });

    assert.equal(run.code, 0, run.out);
    assertScaffold(dir, FEEDBACK);
  });

  test("init converts a GitHub scp-style origin (scenario)", async () => {
    const { rig, server, dir } = await world();
    withOrigin(rig, dir, "git@github.com:acme/cfg.git");

    const run = await runLauncher(rig, dir, ["init"], { env: { [VARIABLE]: server.origin } });

    assert.equal(run.code, 0, run.out);
    assertScaffold(dir, "https://github.com/acme/cfg");
  });

  test("init refuses the upstream origin with code 2 and writes nothing (scenario)", async () => {
    const { rig, server, dir } = await world();
    withOrigin(rig, dir, `${CANONICAL_REPO}.git/`);
    const before = snapshot(dir);

    const run = await runLauncher(rig, dir, ["init"], { env: { [VARIABLE]: server.origin } });

    assert.equal(run.code, 2, run.out);
    assert.match(run.out, /--feedback-repo/);
    assert.deepEqual(snapshot(dir), before);
  });

  test("an invalid option reaches the entry point as it is: code 2, nothing written", async () => {
    const { rig, server, dir } = await world();
    const before = snapshot(dir);

    const run = await runLauncher(rig, dir, ["init", "--bogus"], {
      env: { [VARIABLE]: server.origin },
    });

    assert.equal(run.code, 2, run.out);
    assert.deepEqual(snapshot(dir), before);
  });

  test("init in a directory that is not the template's is refused with code 1", async () => {
    const { rig, server, dir } = await world();
    fs.writeFileSync(path.join(dir, "notes.txt"), "mine");
    const before = snapshot(dir);

    const run = await runLauncher(rig, dir, ["init", "--feedback-repo", FEEDBACK], {
      env: { [VARIABLE]: server.origin },
    });

    assert.equal(run.code, 1, run.out);
    assert.match(run.out, /notes\.txt/);
    assert.deepEqual(snapshot(dir), before);
  });
});

describe("R19: every rejected value, through the launcher", () => {
  const rejected = [
    "ftp://h",
    "https://",
    "https://u:p@h/x",
    "https://h/a b",
    'https://h/"',
    "https://h/a\\b",
    "https://h/r?x=1",
    "https://h/r#f",
    "https://h/a\nb",
    "not a url",
    "https://github.com",
    "https://github.com/acme",
    "https://github.com/acme/cfg/sub",
    "http://github.com/acme/cfg",
  ];

  test("each exits 2 with nothing written, and never prints the value", async () => {
    const { rig, server, dir } = await world();
    const env = { [VARIABLE]: server.origin };
    await runLauncher(rig, dir, ["no-such-command"], { env });
    const before = snapshot(dir);

    for (const value of rejected) {
      const run = await runLauncher(rig, dir, ["init", "--feedback-repo", value], { env });

      assert.equal(run.code, 2, `${JSON.stringify(value)}: ${run.out}`);
      assert.ok(!run.out.split("https://<host>/<owner>/<repo>").join("").includes(value), run.out);
      assert.deepEqual(snapshot(dir), before);
    }
  });
});
