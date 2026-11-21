// crewrig-launcher-cache.test.ts — the cache of the organization launcher (spec 0314 R7 and R9, with
// spec 0288 R7 and its delta-02): an offline run, the replacement of an entry that records another digest,
// the old entry kept when the download fails, two first runs that race, and the guarded delete.
//
// The launcher writes only beneath ~/.crewrig/versions/ and deletes only the aside copy of an entry that
// failed the pinned digest. Every case seeds ~/.crewrig/hooks/x and ~/.crewrig/validation.conf and asserts
// that they are unchanged byte for byte and that nothing else was created outside versions/.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { before, describe, test } from "node:test";
import { buildTar, file } from "./lib/hostile-tar.ts";
import {
  DIGEST_MARKER,
  archiveOf,
  assetPath,
  cloneCache,
  closedPort,
  copyTemplate,
  homeOutsideVersions,
  parseEntryReport,
  pinOf,
  primeCache,
  runLauncher,
  seedOtherCrewrigState,
  serveArchive,
  snapshot,
  tinyArchive,
  trackRigs,
  trackServers,
  versionEntries,
  type Archive,
  type Handler,
  type Rig,
  type RunResult,
  type TestServer,
} from "./lib/launcher-rig.ts";

const rigs = trackRigs();
const servers = trackServers();
const VARIABLE = "CREWRIG_RELEASE_BASE_URL";
const VERSION = "1.0.0-next.1";
const ZEROS = "0".repeat(64);

let archive: Archive;
let primed: string;

before(async () => {
  archive = tinyArchive(rigs.make().newDir("www"), VERSION);
  primed = await primeCache(rigs, archive);
});

/** A rig whose home already holds the other CrewRig state, and a complete entry when asked. */
function homeWith(complete: boolean): { rig: Rig; outside: string[] } {
  const rig = rigs.make();
  seedOtherCrewrigState(rig);
  if (complete) cloneCache(primed, rig);
  return { rig, outside: homeOutsideVersions(rig) };
}

/** The entry of the cache turned into "same version, another digest": it must never run. */
function forgeOldEntry(rig: Rig, digest = ZEROS): string {
  const entry = path.join(rig.versions, VERSION);
  fs.writeFileSync(path.join(entry, DIGEST_MARKER), `${digest}\n`);
  fs.writeFileSync(path.join(entry, "scripts", "entry.js"), "console.log('OLD ENTRY RAN')\n");
  fs.writeFileSync(path.join(entry, "stale.txt"), "stale\n");
  return entry;
}

function recordedDigest(entry: string): string {
  return fs.readFileSync(path.join(entry, DIGEST_MARKER), "utf8").trim();
}

function launch(
  rig: Rig,
  dir: string,
  baseUrl: string,
  options: { env?: Record<string, string | undefined> } = {},
): Promise<RunResult> {
  return runLauncher(rig, dir, ["build"], { env: { [VARIABLE]: baseUrl, ...options.env } });
}

describe("a cached run is offline (scenario: the cached version runs offline and forwards arguments)", () => {
  test("a complete entry runs with no request, whatever the base URL", async () => {
    const server = await servers.start();
    const { rig, outside } = homeWith(true);
    const port = await closedPort();
    const dir = copyTemplate(rig, pinOf(archive, { base_url: `${server.origin}/mirror` }));
    const before = snapshot(rig.versions);

    const withUnreachableVariable = await launch(rig, dir, `http://127.0.0.1:${port}`);
    const withReachableVariable = await launch(rig, dir, server.origin);
    const withPinMember = await runLauncher(rig, dir, ["build", "--some-arg", "value"]);

    for (const run of [withUnreachableVariable, withReachableVariable, withPinMember]) {
      assert.equal(run.code, 0, run.out);
    }
    assert.deepEqual(parseEntryReport(withPinMember.stdout).args, ["build", "--some-arg", "value"]);
    assert.deepEqual(server.requests, [], "no request of any kind");
    assert.deepEqual(snapshot(rig.versions), before, "the entry is not rewritten");
    assert.deepEqual(homeOutsideVersions(rig), outside);
  });
});

describe("an entry that records another digest (spec 0314 R7)", () => {
  test("is not run, is replaced after a verified download, and is the only thing deleted", async () => {
    const server = await servers.start();
    serveArchive(server, archive);
    const { rig, outside } = homeWith(true);
    const entry = forgeOldEntry(rig);
    const dir = copyTemplate(rig, pinOf(archive));

    const run = await launch(rig, dir, server.origin);

    assert.equal(run.code, 0, run.out);
    assert.equal(parseEntryReport(run.stdout).entry, "tiny", "the new entry ran");
    assert.ok(!run.out.includes("OLD ENTRY RAN"));
    assert.deepEqual(server.requests, [`GET ${assetPath(VERSION)}`]);
    assert.equal(recordedDigest(entry), archive.sha256);
    assert.ok(!fs.existsSync(path.join(entry, "stale.txt")), "the old files are gone");
    assert.deepEqual(versionEntries(rig), [VERSION], "no staging and no aside directory is left");
    assert.deepEqual(homeOutsideVersions(rig), outside);
  });

  test("an entry with no digest record is not complete and is replaced", async () => {
    const server = await servers.start();
    serveArchive(server, archive);
    const { rig, outside } = homeWith(true);
    const entry = forgeOldEntry(rig);
    fs.rmSync(path.join(entry, DIGEST_MARKER));
    const dir = copyTemplate(rig, pinOf(archive));

    const run = await launch(rig, dir, server.origin);

    assert.equal(run.code, 0, run.out);
    assert.ok(!run.out.includes("OLD ENTRY RAN"));
    assert.equal(recordedDigest(entry), archive.sha256);
    assert.deepEqual(versionEntries(rig), [VERSION]);
    assert.deepEqual(homeOutsideVersions(rig), outside);
  });

  test("stays untouched when the download fails (scenario: had the download failed)", async () => {
    const { rig, outside } = homeWith(true);
    forgeOldEntry(rig);
    const port = await closedPort();
    const dir = copyTemplate(rig, pinOf(archive));
    const before = snapshot(rig.versions);

    const run = await launch(rig, dir, `http://127.0.0.1:${port}`);

    assert.equal(run.code, 12, run.out);
    assert.ok(!run.out.includes("OLD ENTRY RAN"), "the old entry is never run");
    assert.deepEqual(snapshot(rig.versions), before);
    assert.deepEqual(homeOutsideVersions(rig), outside);
  });

  test("stays in place, with code 14, when the verified archive has a defective descriptor", async () => {
    const server = await servers.start();
    const broken = archiveOf(
      rigs.make().newDir("www"),
      VERSION,
      buildTar([file("scripts/entry.js", "x")]),
    );
    serveArchive(server, broken);
    const { rig, outside } = homeWith(true);
    const dir = copyTemplate(rig, pinOf(broken));
    const before = snapshot(rig.versions);

    const run = await launch(rig, dir, server.origin);

    assert.equal(run.code, 14, run.out);
    assert.deepEqual(
      snapshot(rig.versions),
      before,
      "the old entry and the directory are as they were",
    );
    assert.deepEqual(homeOutsideVersions(rig), outside);
  });

  test("another version already cached is never deleted", async () => {
    const server = await servers.start();
    const second = tinyArchive(rigs.make().newDir("www"), "1.0.1", {
      entrySource: "console.log('v2')\n",
    });
    serveArchive(server, second);
    const { rig, outside } = homeWith(true);
    const first = snapshot(path.join(rig.versions, VERSION));
    const dir = copyTemplate(rig, pinOf(second));

    const run = await launch(rig, dir, server.origin);

    assert.equal(run.code, 0, run.out);
    assert.deepEqual(versionEntries(rig), [VERSION, "1.0.1"]);
    assert.deepEqual(snapshot(path.join(rig.versions, VERSION)), first);
    assert.deepEqual(homeOutsideVersions(rig), outside);
  });
});

/** A server that holds every answer until the test releases it. */
function gated(server: TestServer): {
  pending: Array<() => void>;
  waitFor(count: number): Promise<void>;
} {
  const pending: Array<() => void> = [];
  const waiters: Array<() => void> = [];
  const handler: Handler = (_req, res) => {
    pending.push(() => {
      res.writeHead(200);
      res.end(fs.readFileSync(archive.file));
    });
    for (const waiter of waiters.splice(0)) waiter();
  };
  server.route(assetPath(VERSION), handler);
  return {
    pending,
    async waitFor(count) {
      while (pending.length < count) await new Promise<void>((resolve) => waiters.push(resolve));
    },
  };
}

describe("two first runs that race (R9; scenario: two first runs race)", () => {
  test("both succeed when their downloads finish together", async () => {
    const server = await servers.start();
    const gate = gated(server);
    const { rig, outside } = homeWith(false);
    const dir = copyTemplate(rig, pinOf(archive));

    const first = launch(rig, dir, server.origin);
    const second = launch(rig, dir, server.origin);
    await gate.waitFor(2);
    for (const release of gate.pending) release();
    const runs = [await first, await second];

    for (const run of runs) {
      assert.equal(run.code, 0, run.out);
      assert.equal(parseEntryReport(run.stdout).entry, "tiny");
    }
    assert.deepEqual(versionEntries(rig), [VERSION], "one entry, no staging or aside directory");
    assert.equal(recordedDigest(path.join(rig.versions, VERSION)), archive.sha256);
    assert.deepEqual(homeOutsideVersions(rig), outside);
  });

  test("the slower run finds the entry present, discards its staging directory and runs the existing entry", async () => {
    const server = await servers.start();
    const gate = gated(server);
    const { rig, outside } = homeWith(false);
    const dir = copyTemplate(rig, pinOf(archive));

    const first = launch(rig, dir, server.origin);
    const second = launch(rig, dir, server.origin);
    await gate.waitFor(2);
    const runs = [first, second];
    gate.pending[0]?.();
    const winnerIndex = await Promise.race([first.then(() => 0), second.then(() => 1)]);
    const winner = await runs[winnerIndex];
    const entryAfterWinner = snapshot(path.join(rig.versions, VERSION));
    gate.pending[1]?.();
    const loser = await runs[1 - winnerIndex];

    assert.equal(winner.code, 0, winner.out);
    assert.equal(loser.code, 0, loser.out);
    assert.equal(parseEntryReport(loser.stdout).entry, "tiny");
    assert.equal(
      server.requests.length,
      2,
      "both downloaded: the loser was already past the cache check",
    );
    assert.deepEqual(
      snapshot(path.join(rig.versions, VERSION)),
      entryAfterWinner,
      "the existing entry is kept",
    );
    assert.deepEqual(versionEntries(rig), [VERSION], "the staging directory is discarded");
    assert.deepEqual(homeOutsideVersions(rig), outside);
  });
});

describe("the guarded delete (plan v2-F2, v3 named edits)", () => {
  test("an entry that is a link to a directory outside versions/ is never deleted through the link", async () => {
    const server = await servers.start();
    serveArchive(server, archive);
    const { rig, outside } = homeWith(false);
    const target = rig.newDir("outside");
    fs.mkdirSync(path.join(target, "keep"));
    fs.writeFileSync(path.join(target, "keep", "file.txt"), "keep me\n");
    fs.writeFileSync(path.join(target, DIGEST_MARKER), `${ZEROS}\n`);
    fs.mkdirSync(rig.versions, { recursive: true });
    fs.symlinkSync(target, path.join(rig.versions, VERSION), "junction");
    const targetBefore = snapshot(target);
    const dir = copyTemplate(rig, pinOf(archive));

    const run = await launch(rig, dir, server.origin);

    assert.equal(run.code, 0, run.out);
    assert.equal(parseEntryReport(run.stdout).entry, "tiny", "the new entry runs");
    assert.match(run.stderr, /warning/i, "the refused delete is reported");
    assert.deepEqual(snapshot(target), targetBefore, "the directory behind the link survives");
    assert.ok(
      versionEntries(rig).some((name) => name.startsWith(".old-")),
      "the aside link is kept, never deleted",
    );
    assert.equal(recordedDigest(path.join(rig.versions, VERSION)), archive.sha256);
    assert.deepEqual(homeOutsideVersions(rig), outside);
  });

  test("a home that is a link (a junction on Windows) does not stop the delete of the aside copy", async () => {
    const server = await servers.start();
    serveArchive(server, archive);
    const rig = rigs.make();
    const realHome = rig.newDir("realhome");
    const homeLink = path.join(rig.root, "homelink");
    fs.symlinkSync(realHome, homeLink, "junction");
    fs.cpSync(primed, path.join(realHome, ".crewrig"), { recursive: true });
    const entry = path.join(realHome, ".crewrig", "versions", VERSION);
    fs.writeFileSync(path.join(entry, DIGEST_MARKER), `${ZEROS}\n`);
    fs.writeFileSync(path.join(entry, "stale.txt"), "stale\n");
    const dir = copyTemplate(rig, pinOf(archive));

    const run = await launch(rig, dir, server.origin, {
      env: { HOME: homeLink, USERPROFILE: homeLink },
    });

    assert.equal(run.code, 0, run.out);
    assert.equal(
      run.stderr,
      "",
      "no warning: the aside copy lies inside the real versions directory",
    );
    assert.deepEqual(fs.readdirSync(path.join(realHome, ".crewrig", "versions")), [VERSION]);
    assert.equal(recordedDigest(entry), archive.sha256);
    assert.ok(!fs.existsSync(path.join(entry, "stale.txt")));
  });
});
