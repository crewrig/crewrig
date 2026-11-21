// crewrig-launcher-archive.test.ts — extraction and publication of the organization launcher
// (spec 0314 R6, R9 and R10; spec 0288 R27): every refused archive form ends with code 14 and caches
// nothing, a defective descriptor never becomes a cache entry, and the accepted ways of writing a long
// path (the ustar prefix field, a PAX `path` record) are extracted.
//
// The archives are written by hand, block by block (scripts/tests/lib/hostile-tar.ts), and served with
// their real digest, so the digest check passes and only extraction decides. Each case is otherwise a
// valid archive: a control run proves that.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";
import {
  buildTar,
  dir,
  file,
  fixChecksum,
  paxPath,
  special,
  type Piece,
} from "./lib/hostile-tar.ts";
import {
  ENTRY_SOURCE,
  TINY_DESCRIPTOR,
  archiveOf,
  copyTemplate,
  parseEntryReport,
  pinOf,
  runLauncher,
  serveArchive,
  sha256,
  treeList,
  trackRigs,
  trackServers,
  versionEntries,
  type Archive,
  type Rig,
  type RunResult,
} from "./lib/launcher-rig.ts";

const rigs = trackRigs();
const servers = trackServers();
const VARIABLE = "CREWRIG_RELEASE_BASE_URL";
const VERSION = "1.0.0-next.1";
const MIB = 1024 * 1024;

const BASE: Piece[] = [
  file("crewrig.entry.json", TINY_DESCRIPTOR),
  file("scripts/entry.js", ENTRY_SOURCE),
];

interface Outcome {
  rig: Rig;
  run: RunResult;
  archive: Archive;
  requests: number;
  /** The listing of the rig root, beyond the home's own `.crewrig`, before the run. */
  outsideBefore: string[];
  outsideAfter: string[];
}

function outsideHome(rig: Rig): string[] {
  return treeList(rig.root).filter((line) => !line.startsWith("home/.crewrig"));
}

/** Serve `tar` (or the raw bytes of an archive) with its real digest and run the launcher once. */
async function attempt(content: Buffer | Archive, runs = 1): Promise<Outcome> {
  const rig = rigs.make();
  const server = await servers.start();
  const www = rig.newDir("www");
  const archive = Buffer.isBuffer(content) ? archiveOf(www, VERSION, content) : content;
  serveArchive(server, archive);
  const dirOfTemplate = copyTemplate(rig, pinOf(archive));
  const outsideBefore = outsideHome(rig);
  let run: RunResult | undefined;
  for (let i = 0; i < runs; i += 1) {
    run = await runLauncher(rig, dirOfTemplate, ["build"], { env: { [VARIABLE]: server.origin } });
  }
  if (run === undefined) throw new Error("no run");
  return {
    rig,
    run,
    archive,
    requests: server.requests.length,
    outsideBefore,
    outsideAfter: outsideHome(rig),
  };
}

function assertRefused(outcome: Outcome): void {
  assert.equal(outcome.run.code, 14, outcome.run.out);
  assert.deepEqual(
    versionEntries(outcome.rig),
    [],
    "the staging directory is discarded, nothing is cached",
  );
  assert.deepEqual(
    outcome.outsideAfter,
    outcome.outsideBefore,
    "nothing is written outside the staging directory",
  );
  assert.ok(!outcome.run.out.includes('"entry":"tiny"'), "nothing is executed");
}

function rawArchive(dirPath: string, bytes: Buffer): Archive {
  const target = path.join(dirPath, `raw-${sha256(bytes)}.tgz`);
  fs.writeFileSync(target, bytes);
  return { file: target, version: VERSION, sha256: sha256(bytes) };
}

describe("control", () => {
  test("the base archive of these cases is accepted, so a refusal below is the entry's doing", async () => {
    const outcome = await attempt(buildTar(BASE));

    assert.equal(outcome.run.code, 0, outcome.run.out);
    assert.equal(parseEntryReport(outcome.run.stdout).entry, "tiny");
    assert.deepEqual(versionEntries(outcome.rig), [VERSION]);
  });
});

describe("R9: every refused form ends with code 14 and caches nothing", () => {
  const cases: Array<[string, Piece[]]> = [
    ["a path holding ..", [...BASE, file("../x", "x")]],
    ["a path climbing out through a subdirectory", [...BASE, file("a/../../x", "x")]],
    ["a path climbing to the home directory", [...BASE, file("../../../x", "x")]],
    ["a path climbing to the rig root", [...BASE, file("../../../../x", "x")]],
    ["a backslash path (..\\x)", [...BASE, file("..\\x", "x")]],
    ["a drive letter path (C:\\x)", [...BASE, file("C:\\x", "x")]],
    ["a drive-relative path (C:x)", [...BASE, file("C:x", "x")]],
    ["a UNC path with backslashes", [...BASE, file("\\\\server\\share\\x", "x")]],
    ["a UNC path with slashes", [...BASE, file("//server/share/x", "x")]],
    ["a name holding a colon", [...BASE, file("scripts/a:b", "x")]],
    [
      "a name holding a NUL byte (PAX path)",
      [...BASE, paxPath("scripts/a\0b"), file("pax-entry", "x")],
    ],
    ["an absolute path", [...BASE, file("/abs/x", "x")]],
    ["a symbolic link", [...BASE, special("scripts/link", "2", "/etc")]],
    ["a hard link", [...BASE, special("scripts/hard", "1", "scripts/entry.js")]],
    ["a character device", [...BASE, special("dev-c", "3")]],
    ["a block device", [...BASE, special("dev-b", "4")]],
    ["a FIFO", [...BASE, special("fifo", "6")]],
    ["a duplicate path", [...BASE, file("scripts/entry.js", "again")]],
    ["a directory after a file of the same name", [...BASE, dir("scripts/entry.js")]],
    ["a file after a directory of the same name", [...BASE, dir("d"), file("d", "x")]],
    ["an entry under an earlier file", [...BASE, file("a", "f"), file("a/b", "g")]],
    ["an entry under the entry point file", [...BASE, file("scripts/entry.js/x", "g")]],
    ["a global PAX header", [{ pax: [["comment", "x"]], type: "g" }, ...BASE]],
    ["a PAX header with another key", [...BASE, { pax: [["comment", "hi"]] }, file("c", "c")]],
    [
      "a PAX header with path and another key",
      [
        ...BASE,
        {
          pax: [
            ["path", "c"],
            ["mtime", "1"],
          ],
        },
        file("pax-entry", "c"),
      ],
    ],
    [
      "a PAX header larger than 8 KiB",
      [...BASE, paxPath("a".repeat(9000)), file("pax-entry", "x")],
    ],
    ["two PAX headers in a row", [...BASE, paxPath("a"), paxPath("b"), file("pax-entry", "x")]],
    ["a PAX header with no entry after it", [...BASE, paxPath("a")]],
    [
      "a GNU long-name header",
      [...BASE, file("././@LongLink", "scripts/entry.js\0", { type: "L" }), file("truncated", "x")],
    ],
    [
      "a GNU long link-name header",
      [...BASE, file("././@LongLink", "scripts/entry.js\0", { type: "K" }), file("truncated", "x")],
    ],
    ["more than 64 MiB in one file", [...BASE, file("big.bin", "", { zeros: 64 * MIB + 1 })]],
    [
      "more than 64 MiB across two files",
      [...BASE, file("a.bin", "", { zeros: 33 * MIB }), file("b.bin", "", { zeros: 33 * MIB })],
    ],
    [
      "a stream that inflates far beyond the limit",
      [...BASE, file("huge.bin", "", { zeros: 96 * MIB })],
    ],
  ];

  for (const [name, pieces] of cases) {
    test(`${name}`, async () => {
      assertRefused(await attempt(buildTar(pieces)));
    });
  }

  test("an archive that is not gzip", async () => {
    const rig = rigs.make();
    const outcome = await attempt(
      rawArchive(rig.newDir("www"), Buffer.from("not an archive at all")),
    );

    assertRefused(outcome);
  });

  test("a tar stream cut in the middle of a file", async () => {
    const tar = buildTar(BASE);

    assertRefused(await attempt(tar.subarray(0, 512 * 3 + 100)));
  });

  test("a header whose checksum is wrong", async () => {
    const tar = Buffer.from(buildTar(BASE));
    tar[0] = (tar[0] ?? 0) ^ 0x01;

    assertRefused(await attempt(tar));
  });

  test("a header that is not ustar", async () => {
    const tar = Buffer.from(buildTar(BASE));
    tar.write("gnutar", 257, "latin1");
    fixChecksum(tar, 0);

    assertRefused(await attempt(tar));
  });
});

describe("R6 and R9: a defective descriptor never becomes a cache entry", () => {
  const descriptors: Array<[string, Piece[]]> = [
    ["is missing", [file("scripts/entry.js", ENTRY_SOURCE)]],
    ["is not JSON", [file("crewrig.entry.json", "{nope"), file("scripts/entry.js", ENTRY_SOURCE)]],
    ["is an array", [file("crewrig.entry.json", "[]"), file("scripts/entry.js", ENTRY_SOURCE)]],
    [
      "has no entry member",
      [file("crewrig.entry.json", "{}"), file("scripts/entry.js", ENTRY_SOURCE)],
    ],
    [
      "has an entry that is not a string",
      [file("crewrig.entry.json", '{"entry":7}'), file("scripts/entry.js", ENTRY_SOURCE)],
    ],
    [
      "names a file the archive lacks",
      [file("crewrig.entry.json", '{"entry":"scripts/missing.js"}')],
    ],
    [
      "names a directory",
      [file("crewrig.entry.json", '{"entry":"scripts"}'), file("scripts/entry.js", ENTRY_SOURCE)],
    ],
    [
      "names a path with ..",
      [
        file("crewrig.entry.json", '{"entry":"scripts/../scripts/entry.js"}'),
        file("scripts/entry.js", ENTRY_SOURCE),
      ],
    ],
    [
      "names an absolute path",
      [
        file("crewrig.entry.json", '{"entry":"/scripts/entry.js"}'),
        file("scripts/entry.js", ENTRY_SOURCE),
      ],
    ],
    [
      "names a path with a backslash",
      [
        file("crewrig.entry.json", '{"entry":"scripts\\\\entry.js"}'),
        file("scripts/entry.js", ENTRY_SOURCE),
      ],
    ],
    [
      "names an empty path",
      [file("crewrig.entry.json", '{"entry":""}'), file("scripts/entry.js", ENTRY_SOURCE)],
    ],
    [
      "is in a subdirectory instead of the root",
      [file("sub/crewrig.entry.json", TINY_DESCRIPTOR), file("scripts/entry.js", ENTRY_SOURCE)],
    ],
  ];

  for (const [name, pieces] of descriptors) {
    test(`a descriptor that ${name}: code 14, no entry, and the next run is not served a broken one`, async () => {
      const outcome = await attempt(buildTar(pieces), 2);

      assertRefused(outcome);
      assert.equal(
        outcome.requests,
        2,
        "the second run downloads again, there is nothing cached to run",
      );
    });
  }

  test("members of the descriptor other than entry are ignored", async () => {
    const descriptor = JSON.stringify({ entry: "scripts/entry.js", future: [1], note: { a: 1 } });
    const outcome = await attempt(
      buildTar([file("crewrig.entry.json", descriptor), file("scripts/entry.js", ENTRY_SOURCE)]),
    );

    assert.equal(outcome.run.code, 0, outcome.run.out);
  });
});

describe("R9: the accepted ways of writing a path", () => {
  function descriptorFor(entry: string): Piece {
    return file("crewrig.entry.json", JSON.stringify({ entry }));
  }

  test("a path of more than 100 bytes split across the ustar prefix field, with no PAX record", async () => {
    const long = "p".repeat(120);
    const entry = `scripts/${long}/entry.js`;
    const outcome = await attempt(
      buildTar([
        descriptorFor(entry),
        file("entry.js", ENTRY_SOURCE, { prefix: `scripts/${long}` }),
      ]),
    );

    assert.equal(outcome.run.code, 0, outcome.run.out);
    assert.equal(parseEntryReport(outcome.run.stdout).entry, "tiny");
    assert.equal(
      fs.readFileSync(
        path.join(outcome.rig.versions, VERSION, "scripts", long, "entry.js"),
        "utf8",
      ),
      ENTRY_SOURCE,
    );
  });

  for (const [label, entry] of [
    ["long", `scripts/${"q".repeat(150)}/entry.js`],
    ["non-ASCII (é)", "scripts/é.js"],
    ["non-ASCII (CJK)", "scripts/日本語/entry.js"],
  ] as const) {
    test(`a ${label} path that travels in a PAX path record`, async () => {
      const outcome = await attempt(
        buildTar([descriptorFor(entry), paxPath(entry), file("pax-placeholder", ENTRY_SOURCE)]),
      );

      assert.equal(outcome.run.code, 0, outcome.run.out);
      assert.equal(parseEntryReport(outcome.run.stdout).entry, "tiny");
      assert.equal(
        fs.readFileSync(path.join(outcome.rig.versions, VERSION, ...entry.split("/")), "utf8"),
        ENTRY_SOURCE,
      );
      assert.ok(!fs.existsSync(path.join(outcome.rig.versions, VERSION, "pax-placeholder")));
    });
  }

  test("directories, with or without a trailing slash, and files under implicit parents", async () => {
    const outcome = await attempt(
      buildTar([
        ...BASE,
        dir("docs/"),
        dir("empty"),
        file("docs/guide.md", "guide\n"),
        file("deep/er/still/file.txt", "deep\n"),
      ]),
    );

    assert.equal(outcome.run.code, 0, outcome.run.out);
    const entry = path.join(outcome.rig.versions, VERSION);
    assert.equal(fs.readFileSync(path.join(entry, "docs", "guide.md"), "utf8"), "guide\n");
    assert.equal(
      fs.readFileSync(path.join(entry, "deep", "er", "still", "file.txt"), "utf8"),
      "deep\n",
    );
    assert.ok(fs.statSync(path.join(entry, "empty")).isDirectory());
  });

  test("exactly 64 MiB of file data is within the limit", async () => {
    const outcome = await attempt(
      buildTar([
        ...BASE,
        file("fits.bin", "", { zeros: 64 * MIB - ENTRY_SOURCE.length - TINY_DESCRIPTOR.length }),
      ]),
    );

    assert.equal(outcome.run.code, 0, outcome.run.out);
  });
});
