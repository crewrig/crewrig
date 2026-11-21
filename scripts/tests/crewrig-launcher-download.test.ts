// crewrig-launcher-download.test.ts — the download of the organization launcher (spec 0314 R8, as
// amended by delta-01; spec 0288 R27): the first run, a digest mismatch, redirects, the size cap, a
// stalled and a never-ending server, an unreachable host, and what a message may print.
//
// The launcher file runs unmodified against local servers. The 30 s inactivity limit and the 300 s total
// deadline are exercised under the fast-clock preload (150 ms and 1.5 s); the ceiling of 15 s still tells
// 1.5 s from 30 s and 300 s, and the floor of 1.2 s rules out an early end before the scaled deadline.

import assert from "node:assert/strict";
import fs from "node:fs";
import zlib from "node:zlib";
import { before, describe, test } from "node:test";
import {
  FAST_CLOCK_ARGS,
  assetPath,
  closedPort,
  copyTemplate,
  drip,
  parseEntryReport,
  pinOf,
  redirectTo,
  runLauncher,
  serveArchive,
  sha256,
  snapshot,
  stall,
  tinyArchive,
  trackRigs,
  trackServers,
  versionEntries,
  type Archive,
  type Rig,
  type RunResult,
  type TestServer,
} from "./lib/launcher-rig.ts";

const rigs = trackRigs();
const servers = trackServers();
const VARIABLE = "CREWRIG_RELEASE_BASE_URL";
const VERSION = "1.0.0-next.1";

let archive: Archive;

before(() => {
  archive = tinyArchive(rigs.make().newDir("www"), VERSION);
});

interface World {
  rig: Rig;
  server: TestServer;
  dir: string;
}

/** A rig, a server and a template copy pinned to `pinned` (the served archive by default). */
async function world(pinned: Archive = archive): Promise<World> {
  const rig = rigs.make();
  const server = await servers.start();
  return { rig, server, dir: copyTemplate(rig, pinOf(pinned)) };
}

function run(
  w: World,
  args: string[] = ["build"],
  nodeArgs: readonly string[] = [],
): Promise<RunResult> {
  return runLauncher(w.rig, w.dir, args, { nodeArgs, env: { [VARIABLE]: w.server.origin } });
}

/** A failed download leaves no entry, no staging directory and nothing that a later run would execute. */
function assertNothingCached(rig: Rig, out: string): void {
  assert.deepEqual(versionEntries(rig), []);
  assert.ok(!out.includes('"entry":"tiny"'), "the entry point ran");
}

const FINAL = assetPath(VERSION);

describe("the first run", () => {
  test("downloads, verifies, caches and runs, then serves the next run from the cache", async () => {
    const w = await world();
    serveArchive(w.server, archive);

    const first = await run(w, ["build", "--some-arg", "value"]);
    const second = await run(w, ["again"]);

    assert.equal(first.code, 0, first.out);
    assert.deepEqual(parseEntryReport(first.stdout).args, ["build", "--some-arg", "value"]);
    assert.deepEqual(w.server.requests, [`GET ${FINAL}`], "one request, then none");
    assert.deepEqual(versionEntries(w.rig), [VERSION]);
    assert.equal(second.code, 0, second.out);
    assert.deepEqual(parseEntryReport(second.stdout).args, ["again"]);
  });

  test("a mirror that adds Content-Encoding to the .tgz changes nothing: the body is hashed as received", async () => {
    const w = await world();
    serveArchive(w.server, archive, { "content-encoding": "gzip" });

    const result = await run(w);

    assert.equal(result.code, 0, result.out);
  });

  test("the digest covers the wire bytes, never a decoded body", async () => {
    const w = await world();
    const wire = zlib.gzipSync(fs.readFileSync(archive.file));
    w.server.route(FINAL, (_req, res) => {
      res.writeHead(200, { "content-encoding": "gzip" });
      res.end(wire);
    });

    const result = await run(w);

    assert.equal(result.code, 13, result.out);
    assert.ok(result.out.includes(sha256(wire)), "the digest of the wire bytes is printed");
    assertNothingCached(w.rig, result.out);
  });
});

describe("a digest mismatch (scenario: a digest mismatch is refused)", () => {
  test("prints D1, D2 and the URL, exits 13, caches and executes nothing", async () => {
    const other = tinyArchive(rigs.make().newDir("www"), VERSION, {
      entrySource: "console.log('other')\n",
    });
    const w = await world(other);
    serveArchive(w.server, archive);

    const result = await run(w, ["any-command"]);

    assert.equal(result.code, 13, result.out);
    assert.ok(result.out.includes(other.sha256), "the pinned digest D1");
    assert.ok(result.out.includes(archive.sha256), "the digest D2 of the download");
    assert.ok(result.out.includes(`${w.server.origin}${FINAL}`), "the URL");
    assert.deepEqual(
      snapshot(w.rig.home).filter((line) => !line.endsWith("/")),
      [],
      "no file is left",
    );
    assertNothingCached(w.rig, result.out);
  });

  test("one flipped byte in the body is refused", async () => {
    const w = await world();
    const bytes = Buffer.from(fs.readFileSync(archive.file));
    bytes[bytes.length - 12] = (bytes[bytes.length - 12] ?? 0) ^ 0xff;
    w.server.route(FINAL, (_req, res) => {
      res.writeHead(200);
      res.end(bytes);
    });

    const result = await run(w);

    assert.equal(result.code, 13, result.out);
    assertNothingCached(w.rig, result.out);
  });
});

describe("redirects (R8; delta-01 s5-F8)", () => {
  for (const status of [301, 302, 303, 307, 308]) {
    test(`a ${status} to another local port is followed and only the final body is hashed`, async () => {
      const w = await world();
      const target = await servers.start();
      serveArchive(target, archive);
      w.server.route(FINAL, (_req, res) => {
        res.writeHead(status, { location: `${target.origin}${FINAL}` });
        res.end("garbage that must not be hashed");
      });

      const result = await run(w);

      assert.equal(result.code, 0, result.out);
      assert.deepEqual(w.server.requests, [`GET ${FINAL}`]);
      assert.deepEqual(target.requests, [`GET ${FINAL}`]);
    });
  }

  /** A chain of `n` redirects ending in the archive, on one server. */
  function chain(server: TestServer, hops: number): void {
    server.route(FINAL, redirectTo(`${server.origin}/hop/1`));
    server.route(/^\/hop\/\d+$/, (req, res) => {
      const n = Number((req.url ?? "").split("/").pop());
      if (n < hops) redirectTo(`${server.origin}/hop/${n + 1}`)(req, res, server);
      else {
        res.writeHead(200);
        res.end(fs.readFileSync(archive.file));
      }
    });
  }

  test("five redirects are followed", async () => {
    const w = await world();
    chain(w.server, 5);

    const result = await run(w);

    assert.equal(result.code, 0, result.out);
    assert.equal(w.server.requests.length, 6);
  });

  test("a sixth redirect is a download failure, code 12", async () => {
    const w = await world();
    chain(w.server, 6);

    const result = await run(w);

    assert.equal(result.code, 12, result.out);
    assert.equal(w.server.requests.length, 6, "the sixth redirect is not followed");
    assertNothingCached(w.rig, result.out);
  });

  test("a server that redirects forever ends with code 12 after 5 redirects", async () => {
    const w = await world();
    w.server.route(/^\//, redirectTo(`${w.server.origin}${FINAL}`));

    const result = await run(w);

    assert.equal(result.code, 12, result.out);
    assert.equal(w.server.requests.length, 6);
    assertNothingCached(w.rig, result.out);
  });

  const refused: Array<[string, string | undefined]> = [
    [
      "a relative reference (scenario: a relative redirect is a download failure)",
      "/elsewhere/crewrig.tgz",
    ],
    ["a protocol-relative reference", "//127.0.0.1:1/elsewhere/crewrig.tgz"],
    ["a relative path without a slash", "elsewhere/crewrig.tgz"],
    ["a scheme other than http and https", "ftp://127.0.0.1/crewrig.tgz"],
    ["a target holding userinfo", "http://user:secret@127.0.0.1:1/crewrig.tgz"],
    ["a target with a space", "http://127.0.0.1:1/a b"],
    ["an empty Location", ""],
    ["no Location", undefined],
  ];
  for (const [name, location] of refused) {
    test(`${name} is code 12 and is not followed`, async () => {
      const w = await world();
      w.server.route(FINAL, (_req, res) => {
        res.writeHead(302, location === undefined ? {} : { location });
        res.end();
      });

      const result = await run(w);

      assert.equal(result.code, 12, result.out);
      assert.deepEqual(w.server.requests, [`GET ${FINAL}`], "no redirect is followed");
      assert.ok(!result.out.includes("secret"), result.out);
      assertNothingCached(w.rig, result.out);
    });
  }

  test("a 300 is not a redirect of the list: the final status is a failure and its Location is not followed", async () => {
    const w = await world();
    const target = await servers.start();
    serveArchive(target, archive);
    w.server.route(FINAL, redirectTo(`${target.origin}${FINAL}`, 300));

    const result = await run(w);

    assert.equal(result.code, 12, result.out);
    assert.deepEqual(target.requests, []);
  });

  test("a query string of a redirect target never reaches a message (digest mismatch)", async () => {
    const other = tinyArchive(rigs.make().newDir("www"), VERSION, {
      entrySource: "console.log('other')\n",
    });
    const w = await world(other);
    const target = await servers.start();
    serveArchive(target, archive);
    w.server.route(
      FINAL,
      redirectTo(`${target.origin}${FINAL}?X-Amz-Signature=secret123#fragsecret`),
    );
    target.route(FINAL, (req, res) => {
      assert.match(
        req.url ?? "",
        /X-Amz-Signature=secret123/,
        "the signed query is sent to the target",
      );
      res.writeHead(200);
      res.end(fs.readFileSync(archive.file));
    });

    const result = await run(w);

    assert.equal(result.code, 13, result.out);
    assert.ok(
      result.out.includes(`${target.origin}${FINAL}`),
      "the final URL is printed: scheme, host and path",
    );
    assert.ok(!/secret123|fragsecret|X-Amz/.test(result.out), result.out);
  });

  test("a query string of a redirect target never reaches a message (failure after the redirect)", async () => {
    const w = await world();
    const target = await servers.start();
    w.server.route(FINAL, redirectTo(`${target.origin}/signed/crewrig.tgz?token=secret456`));

    const result = await run(w);

    assert.equal(result.code, 12, result.out);
    assert.ok(!/secret456|token=/.test(result.out), result.out);
    assert.ok(result.out.includes(`${target.origin}/signed/crewrig.tgz`));
  });
});

describe("download failures are code 12", () => {
  for (const status of [403, 404, 500, 503]) {
    test(`a final status of ${status} prints the URL and the failure`, async () => {
      const w = await world();
      w.server.route(FINAL, (_req, res) => {
        res.writeHead(status);
        res.end("no");
      });

      const result = await run(w, ["setup"]);

      assert.equal(result.code, 12, result.out);
      assert.ok(result.out.includes(`${w.server.origin}${FINAL}`), result.out);
      assert.ok(result.out.includes(String(status)), result.out);
      assertNothingCached(w.rig, result.out);
    });
  }

  test("an unreachable host with an empty cache prints the URL and leaves nothing (scenario)", async () => {
    const rig = rigs.make();
    const dir = copyTemplate(rig, pinOf(archive));
    const port = await closedPort();

    const result = await runLauncher(rig, dir, ["setup"], {
      env: { [VARIABLE]: `http://127.0.0.1:${port}` },
    });

    assert.equal(result.code, 12, result.out);
    assert.ok(result.out.includes(`127.0.0.1:${port}${FINAL}`), result.out);
    assertNothingCached(rig, result.out);
  });

  test("a body over 16 MiB is code 12", async () => {
    const w = await world();
    w.server.route(FINAL, (_req, res) => {
      res.writeHead(200);
      res.end(Buffer.alloc(17 * 1024 * 1024, 1));
    });

    const result = await run(w);

    assert.equal(result.code, 12, result.out);
    assertNothingCached(w.rig, result.out);
  });

  test("the download is abandoned when the cap is crossed, even if the body never ends", async () => {
    const w = await world();
    const closed = new Promise<void>((resolve) => {
      w.server.route(FINAL, (_req, res) => {
        res.writeHead(200);
        const chunk = Buffer.alloc(1024 * 1024, 2);
        const timer = setInterval(() => res.write(chunk), 5);
        res.on("close", () => {
          clearInterval(timer);
          resolve();
        });
      });
    });

    const result = await run(w);
    await closed;

    assert.equal(result.code, 12, result.out);
    assert.ok(result.ms < 15_000, `${result.ms} ms`);
    assertNothingCached(w.rig, result.out);
  });

  test("a body cut short by the server is code 12", async () => {
    const w = await world();
    w.server.route(FINAL, (_req, res) => {
      res.writeHead(200, { "content-length": "100000" });
      res.write("abcdefghij");
      setTimeout(() => res.destroy(), 50);
    });

    const result = await run(w);

    assert.equal(result.code, 12, result.out);
    assertNothingCached(w.rig, result.out);
  });
});

describe("the inactivity limit and the total deadline, under the fast clock", () => {
  test("a stalled server ends with code 12 within the ceiling (30 s scaled to 150 ms)", async () => {
    const w = await world();
    w.server.route(FINAL, stall);

    const result = await run(w, ["build"], FAST_CLOCK_ARGS);

    assert.equal(result.code, 12, result.out);
    assert.ok(result.ms < 15_000, `${result.ms} ms`);
    assert.deepEqual(w.server.requests, [`GET ${FINAL}`]);
    assertNothingCached(w.rig, result.out);
  });

  test("a server that keeps sending ends at the total deadline, not before (300 s scaled to 1.5 s)", async () => {
    const w = await world();
    w.server.route(FINAL, drip(50));

    const result = await run(w, ["build"], FAST_CLOCK_ARGS);
    const elapsed = performance.now() - (w.server.arrivals[0] ?? 0);

    assert.equal(result.code, 12, result.out);
    assert.ok(
      elapsed >= 1200,
      `ended after ${Math.round(elapsed)} ms: the inactivity timer must not fire while bytes arrive`,
    );
    assert.ok(
      elapsed < 15_000,
      `ended after ${Math.round(elapsed)} ms: the deadline is 300 s, scaled`,
    );
    assertNothingCached(w.rig, result.out);
  });
});
