// crewrig-launcher-pin.test.ts — the pin file and the base URL of the organization launcher
// (spec 0314 R1-R3, R7, R8 and R11, as amended by delta-01; spec 0288 R27).
//
// The launcher file templates/org-repo/crewrig runs unmodified, as a black box, against a local server
// that counts requests and a temporary HOME. A defective pin is code 11 with no request, whether or not
// the cache holds the pinned version; a defective CREWRIG_RELEASE_BASE_URL is code 11 only when a
// download is needed.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { before, describe, test } from "node:test";
import {
  assetPath,
  cloneCache,
  closedPort,
  copyTemplate,
  pinOf,
  primeCache,
  runLauncher,
  serveArchive,
  snapshot,
  tinyArchive,
  trackRigs,
  trackServers,
  type Archive,
  type PinInput,
  type Rig,
} from "./lib/launcher-rig.ts";

const rigs = trackRigs();
const servers = trackServers();
const VARIABLE = "CREWRIG_RELEASE_BASE_URL";

let archive: Archive;
let primed: string;

before(async () => {
  archive = tinyArchive(rigs.make().newDir("www"), "1.0.0-next.1");
  primed = await primeCache(rigs, archive);
});

/** A rig with either an empty cache or a complete entry for the pin of `archive`. */
function freshRig(cache: "empty" | "complete"): Rig {
  const rig = rigs.make();
  if (cache === "complete") cloneCache(primed, rig);
  return rig;
}

const CACHES = ["empty", "complete"] as const;

/** Values that are not base URLs, or not plain URLs at all (spec 0314 R19, rejected-input table). */
const REJECTED_URLS = [
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
];

describe("R3: a defective pin file is code 11, with one message and no request", () => {
  const defects: Array<[string, (valid: Record<string, unknown>) => PinInput]> = [
    ["the pin file is absent", () => null],
    ["the pin file is empty", () => ""],
    ["the pin file is not JSON", () => "{not json"],
    ["the pin file is an array", () => "[]"],
    ["the pin file is a string", () => '"1.0.0"'],
    ["the pin file is null", () => "null"],
    ["the pin file is a number", () => "42"],
    ["version is missing", ({ version: _v, ...rest }) => rest],
    ["sha256 is missing", ({ sha256: _s, ...rest }) => rest],
    ["version is a range", (valid) => ({ ...valid, version: "^1.0.0" })],
    ["version has build metadata", (valid) => ({ ...valid, version: "1.0.0+b" })],
    ["version has a leading zero", (valid) => ({ ...valid, version: "01.0.0" })],
    ["version is a path", (valid) => ({ ...valid, version: "../x" })],
    ["version has a leading v", (valid) => ({ ...valid, version: "v1.0.0" })],
    ["version has two parts", (valid) => ({ ...valid, version: "1.0" })],
    [
      "version has a numeric prerelease with a leading zero",
      (valid) => ({ ...valid, version: "1.0.0-01" }),
    ],
    ["version ends with a line feed", (valid) => ({ ...valid, version: "1.0.0\n" })],
    ["version is empty", (valid) => ({ ...valid, version: "" })],
    ["version is a number", (valid) => ({ ...valid, version: 1 })],
    ["sha256 is uppercase", (valid) => ({ ...valid, sha256: String(valid.sha256).toUpperCase() })],
    ["sha256 is 63 characters", (valid) => ({ ...valid, sha256: String(valid.sha256).slice(1) })],
    ["sha256 is 65 characters", (valid) => ({ ...valid, sha256: `${String(valid.sha256)}0` })],
    [
      "sha256 is not hexadecimal",
      (valid) => ({ ...valid, sha256: `g${String(valid.sha256).slice(1)}` }),
    ],
    [
      "sha256 ends with a line feed",
      (valid) => ({ ...valid, sha256: `${String(valid.sha256)}\n` }),
    ],
    ["sha256 is a number", (valid) => ({ ...valid, sha256: 7 })],
    ["base_url has a query string", (valid) => ({ ...valid, base_url: "https://h/r?x=1" })],
    ["base_url has a fragment", (valid) => ({ ...valid, base_url: "https://h/r#f" })],
    ["base_url is empty", (valid) => ({ ...valid, base_url: "" })],
    ["base_url is a number", (valid) => ({ ...valid, base_url: 3 })],
  ];

  for (const cache of CACHES) {
    for (const [name, pinFor] of defects) {
      test(`${name}, ${cache} cache`, async () => {
        const server = await servers.start();
        const rig = freshRig(cache);
        const dir = copyTemplate(rig, pinFor(pinOf(archive)));
        const before = snapshot(rig.home);

        const run = await runLauncher(rig, dir, ["build"], { env: { [VARIABLE]: server.origin } });

        assert.equal(run.code, 11, run.out);
        assert.match(run.out, /crewrig\.pin\.json/);
        assert.equal(run.out.trim().split("\n").length, 1, `one message: ${run.out}`);
        assert.deepEqual(server.requests, []);
        assert.deepEqual(snapshot(rig.home), before, "the cache and the home are untouched");
      });
    }
  }

  test("an unreadable pin file (a directory in its place) is code 11", async () => {
    const server = await servers.start();
    const rig = freshRig("complete");
    const dir = copyTemplate(rig, null);
    fs.mkdirSync(path.join(dir, "crewrig.pin.json"));

    const run = await runLauncher(rig, dir, [], { env: { [VARIABLE]: server.origin } });

    assert.equal(run.code, 11, run.out);
    assert.match(run.out, /crewrig\.pin\.json/);
    assert.deepEqual(server.requests, []);
  });

  test("a version range is named as the defect (scenario: a malformed pin file is refused)", async () => {
    const rig = freshRig("empty");
    const dir = copyTemplate(rig, pinOf(archive, { version: "^1.0.0" }));

    const run = await runLauncher(rig, dir, ["build"]);

    assert.equal(run.code, 11, run.out);
    assert.match(run.out, /crewrig\.pin\.json/);
    assert.match(run.out, /\^1\.0\.0/);
  });

  test("a malformed base_url member names crewrig.pin.json and base_url, even with a complete cache", async () => {
    const server = await servers.start();
    const rig = freshRig("complete");
    const dir = copyTemplate(rig, pinOf(archive, { base_url: "https://h/r?x=1" }));

    const run = await runLauncher(rig, dir, ["build"], { env: { [VARIABLE]: server.origin } });

    assert.equal(run.code, 11, run.out);
    assert.match(run.out, /crewrig\.pin\.json/);
    assert.match(run.out, /base_url/);
    assert.deepEqual(server.requests, []);
  });

  for (const cache of CACHES) {
    for (const value of REJECTED_URLS) {
      test(`the rejected base_url ${JSON.stringify(value)} is code 11 and never printed, ${cache} cache`, async () => {
        const server = await servers.start();
        const rig = freshRig(cache);
        const dir = copyTemplate(rig, pinOf(archive, { base_url: value }));

        const run = await runLauncher(rig, dir, ["build"], { env: { [VARIABLE]: server.origin } });

        assert.equal(run.code, 11, run.out);
        assert.match(run.out, /base_url/);
        assert.ok(!run.out.includes(value), `the value is echoed: ${run.out}`);
        assert.deepEqual(server.requests, []);
      });
    }
  }
});

describe("R1 and R2: where the pin is read, and what it may hold", () => {
  test("the launcher reads the pin beside itself and searches nowhere else", async () => {
    const server = await servers.start();
    const rig = freshRig("complete");
    const dir = copyTemplate(rig, null);
    const elsewhere = rig.newDir("elsewhere");
    for (const where of [elsewhere, path.dirname(dir)]) {
      fs.writeFileSync(path.join(where, "crewrig.pin.json"), JSON.stringify(pinOf(archive)));
    }

    const run = await runLauncher(rig, dir, ["build"], {
      cwd: elsewhere,
      env: { [VARIABLE]: server.origin },
    });

    assert.equal(run.code, 11, run.out);
    assert.deepEqual(server.requests, []);
  });

  test("the pin beside the launcher applies whatever the working directory holds", async () => {
    const server = await servers.start();
    const rig = freshRig("complete");
    const dir = copyTemplate(rig, pinOf(archive));
    const elsewhere = rig.newDir("elsewhere");
    fs.writeFileSync(path.join(elsewhere, "crewrig.pin.json"), "{not json");

    const run = await runLauncher(rig, dir, ["build"], {
      cwd: elsewhere,
      env: { [VARIABLE]: server.origin },
    });

    assert.equal(run.code, 0, run.out);
    assert.deepEqual(server.requests, []);
  });

  test("members the launcher does not know are ignored", async () => {
    const rig = freshRig("complete");
    const dir = copyTemplate(rig, pinOf(archive, { signature: "abc", future: { nested: [1, 2] } }));

    const run = await runLauncher(rig, dir, ["build"]);

    assert.equal(run.code, 0, run.out);
  });

  const accepted = [
    "1.0.0",
    "0.0.1",
    "10.20.30",
    "1.2.3-rc.1",
    "1.0.0-0",
    "1.0.0-x-y.7.z-92",
    "1.0.0-next.1",
  ];
  for (const version of accepted) {
    test(`the exact version ${version} passes the pin check and reaches the download`, async () => {
      const rig = freshRig("empty");
      const dir = copyTemplate(rig, { version, sha256: "0".repeat(64) });
      const port = await closedPort();

      const run = await runLauncher(rig, dir, [], {
        env: { [VARIABLE]: `http://127.0.0.1:${port}` },
      });

      assert.equal(run.code, 12, run.out);
    });
  }

  test("a base_url with a path and a trailing slash is a base URL", async () => {
    const rig = freshRig("empty");
    const port = await closedPort();
    const dir = copyTemplate(
      rig,
      pinOf(archive, { base_url: `http://127.0.0.1:${port}/some/path/` }),
    );

    const run = await runLauncher(rig, dir, []);

    assert.equal(run.code, 12, run.out);
    assert.match(run.out, new RegExp(`127\\.0\\.0\\.1:${port}/some/path/crewrig-v`));
  });
});

describe("R7 and R8: CREWRIG_RELEASE_BASE_URL", () => {
  for (const value of REJECTED_URLS) {
    test(`the rejected variable ${JSON.stringify(value)} is code 11 naming the variable, empty cache`, async () => {
      const rig = freshRig("empty");
      const dir = copyTemplate(rig, pinOf(archive));
      const server = await servers.start();

      const run = await runLauncher(rig, dir, ["build"], { env: { [VARIABLE]: value } });

      assert.equal(run.code, 11, run.out);
      assert.match(run.out, new RegExp(VARIABLE));
      assert.ok(!run.out.includes(value), `the value is echoed: ${run.out}`);
      assert.deepEqual(server.requests, []);
      assert.deepEqual(snapshot(rig.home), [], "nothing is written under the home");
    });

    test(`the rejected variable ${JSON.stringify(value)} does not stop a run served from a complete cache`, async () => {
      const rig = freshRig("complete");
      const dir = copyTemplate(rig, pinOf(archive));

      const run = await runLauncher(rig, dir, ["build"], { env: { [VARIABLE]: value } });

      assert.equal(run.code, 0, run.out);
    });
  }

  test("a credential in the variable is refused and never printed (empty cache)", async () => {
    const server = await servers.start();
    const rig = freshRig("empty");
    const dir = copyTemplate(rig, pinOf(archive));

    const run = await runLauncher(rig, dir, ["build"], {
      env: { [VARIABLE]: "https://user:secret@mirror.example/r" },
    });

    assert.equal(run.code, 11, run.out);
    assert.match(run.out, new RegExp(VARIABLE));
    assert.ok(!run.out.includes("user") && !run.out.includes("secret"), run.out);
    assert.deepEqual(server.requests, []);
  });

  test("a credential in the variable is not read when the cache is complete", async () => {
    const rig = freshRig("complete");
    const dir = copyTemplate(rig, pinOf(archive));

    const run = await runLauncher(rig, dir, ["build"], {
      env: { [VARIABLE]: "https://user:secret@mirror.example/r" },
    });

    assert.equal(run.code, 0, run.out);
    assert.ok(!run.out.includes("secret"), run.out);
  });

  test("the variable beats the base_url member, and its trailing slash is ignored", async () => {
    const [chosen, mirror] = [await servers.start(), await servers.start()];
    serveArchive(chosen, archive);
    serveArchive(mirror, archive);
    const rig = freshRig("empty");
    const dir = copyTemplate(rig, pinOf(archive, { base_url: `${mirror.origin}/releases` }));

    const run = await runLauncher(rig, dir, ["build"], {
      env: { [VARIABLE]: `${chosen.origin}/` },
    });

    assert.equal(run.code, 0, run.out);
    assert.deepEqual(chosen.requests, [`GET ${assetPath(archive.version)}`]);
    assert.deepEqual(mirror.requests, []);
  });

  test("a variable with a path is joined to the asset path with one slash", async () => {
    const server = await servers.start();
    server.route(`/mirror${assetPath(archive.version)}`, (_req, res) => {
      res.writeHead(200);
      res.end(fs.readFileSync(archive.file));
    });
    const rig = freshRig("empty");
    const dir = copyTemplate(rig, pinOf(archive));

    const run = await runLauncher(rig, dir, ["build"], {
      env: { [VARIABLE]: `${server.origin}/mirror/` },
    });

    assert.equal(run.code, 0, run.out);
    assert.deepEqual(server.requests, [`GET /mirror${assetPath(archive.version)}`]);
  });

  for (const [label, env] of [
    ["an empty", ""],
    ["an unset", undefined],
  ] as const) {
    test(`${label} variable lets the base_url member apply`, async () => {
      const [unused, mirror] = [await servers.start(), await servers.start()];
      mirror.route(`/pin${assetPath(archive.version)}`, (_req, res) => {
        res.writeHead(200);
        res.end(fs.readFileSync(archive.file));
      });
      const rig = freshRig("empty");
      const dir = copyTemplate(rig, pinOf(archive, { base_url: `${mirror.origin}/pin/` }));

      const run = await runLauncher(rig, dir, ["build"], { env: { [VARIABLE]: env } });

      assert.equal(run.code, 0, run.out);
      assert.deepEqual(mirror.requests, [`GET /pin${assetPath(archive.version)}`]);
      assert.deepEqual(unused.requests, []);
    });
  }

  test("a credential in the base_url member is refused and never printed", async () => {
    const rig = freshRig("empty");
    const dir = copyTemplate(
      rig,
      pinOf(archive, { base_url: "https://user:secret@mirror.example/r" }),
    );

    const run = await runLauncher(rig, dir, ["build"]);

    assert.equal(run.code, 11, run.out);
    assert.ok(!run.out.includes("user") && !run.out.includes("secret"), run.out);
  });
});
