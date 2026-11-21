// crewrig-launcher-forwarding.test.ts — what the organization launcher hands to the framework entry point
// (spec 0314 R5, R10 and R12; spec 0288 R27 and R2): the arguments verbatim and in order, the working
// directory, the environment and the standard streams inherited, the exit code of the entry point, a signal
// ending mapped to code 1, no command at all, and the same behaviour whatever module type a package.json of
// the organization repository declares.
//
// The entry point here is the scripted one of the tiny archive (scripts/tests/lib/launcher-rig.ts): it
// prints what it received, and ENTRY_MODE scripts its end.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { before, describe, test } from "node:test";
import {
  assetPath,
  cloneCache,
  closedPort,
  copyTemplate,
  parseEntryReport,
  pinOf,
  primeCache,
  runLauncher,
  runNode,
  serveArchive,
  tinyArchive,
  trackRigs,
  trackServers,
  type Archive,
  type Rig,
} from "./lib/launcher-rig.ts";

const rigs = trackRigs();
const servers = trackServers();
const VARIABLE = "CREWRIG_RELEASE_BASE_URL";
const VERSION = "1.0.0-next.1";

let archive: Archive;
let primed: string;

before(async () => {
  archive = tinyArchive(rigs.make().newDir("www"), VERSION);
  primed = await primeCache(rigs, archive);
});

function cachedRig(): Rig {
  const rig = rigs.make();
  cloneCache(primed, rig);
  return rig;
}

describe("R5: arguments are passed verbatim and in order", () => {
  const argLists: string[][] = [
    [],
    ["build"],
    ["build", "--some-arg", "value"],
    ["init", "--feedback-repo", "https://github.com/acme/cfg"],
    ["unknown-command", "--bogus"],
    ["--help"],
    ["-h"],
    ["--version"],
    ["--"],
    ["", "after-empty"],
    ["a b", "c  d", " "],
    ['say "hi"', "it's", "back\\slash"],
    ["é", "日本語", "emoji-✓"],
    ["two\nlines"],
    ["*", "$HOME", "`id`", "%PATH%", "a&b", "a|b", ">out"],
    ["--key=value", "-k", "v", "---"],
  ];

  test("on the first run (downloaded) and on a cached run alike, for every shape of argument", async () => {
    const rig = rigs.make();
    const server = await servers.start();
    serveArchive(server, archive);
    const dir = copyTemplate(rig, pinOf(archive));

    for (const args of argLists) {
      const run = await runLauncher(rig, dir, args, { env: { [VARIABLE]: server.origin } });

      assert.equal(run.code, 0, run.out);
      assert.deepEqual(parseEntryReport(run.stdout).args, args, JSON.stringify(args));
    }
    assert.deepEqual(
      server.requests,
      [`GET ${assetPath(VERSION)}`],
      "only the first run downloaded",
    );
  });

  test("the launcher interprets no command: init, setup and gibberish reach the entry point alike", async () => {
    const rig = cachedRig();
    const dir = copyTemplate(rig, pinOf(archive));

    for (const command of ["init", "setup", "build", "--no-such-flag", "x".repeat(300)]) {
      const run = await runLauncher(rig, dir, [command]);

      assert.equal(run.code, 0, run.out);
      assert.deepEqual(parseEntryReport(run.stdout).args, [command]);
    }
  });
});

describe("R5: the working directory, the environment, the runtime and the streams", () => {
  test("the entry point inherits the working directory, the environment and the runtime", async () => {
    const rig = cachedRig();
    const dir = copyTemplate(rig, pinOf(archive));
    const elsewhere = rig.newDir("elsewhere");

    const run = await runLauncher(rig, dir, ["build"], {
      cwd: elsewhere,
      env: { FORWARD_MARKER: "inherited-value" },
    });

    assert.equal(run.code, 0, run.out);
    const report = parseEntryReport(run.stdout);
    assert.equal(report.cwd, elsewhere);
    assert.equal(report.marker, "inherited-value");
    assert.equal(
      report.execPath,
      process.execPath,
      "run with process.execPath, not a node found on PATH",
    );
  });

  test("standard input is attached to the entry point and its output reaches the launcher's streams", async () => {
    const rig = cachedRig();
    const dir = copyTemplate(rig, pinOf(archive));

    const run = await runLauncher(rig, dir, ["build"], {
      env: { ENTRY_MODE: "stdin" },
      stdin: "typed by the user\n",
    });

    assert.equal(run.code, 0, run.out);
    assert.equal(run.stdout, "typed by the user\n");
  });

  test("the launcher runs from a relative path, and reads the pin beside itself", async () => {
    const rig = cachedRig();
    const dir = copyTemplate(rig, pinOf(archive));
    const elsewhere = rig.newDir("elsewhere");

    const run = await runNode(rig, path.relative(elsewhere, path.join(dir, "crewrig")), ["build"], {
      cwd: elsewhere,
    });

    assert.equal(run.code, 0, run.out);
    assert.equal(parseEntryReport(run.stdout).cwd, elsewhere);
  });
});

describe("R5 and R10: the exit code", () => {
  for (const code of [0, 1, 2, 3, 7, 42, 255, 10, 11, 12, 13, 14]) {
    test(`the launcher exits with the entry point's own code ${code}`, async () => {
      const rig = cachedRig();
      const dir = copyTemplate(rig, pinOf(archive));

      const run = await runLauncher(rig, dir, ["build"], { env: { ENTRY_MODE: `exit:${code}` } });

      assert.equal(run.code, code, run.out);
      assert.equal(run.signal, null);
    });
  }

  for (const signal of ["SIGTERM", "SIGKILL"]) {
    test(`an entry point that ends on ${signal} makes the launcher exit with code 1`, async () => {
      const rig = cachedRig();
      const dir = copyTemplate(rig, pinOf(archive));

      const run = await runLauncher(rig, dir, ["build"], {
        env: { ENTRY_MODE: `signal:${signal}` },
      });

      assert.equal(run.signal, null, "the launcher itself exits normally");
      assert.equal(run.code, 1, run.out);
    });
  }

  test("an invocation with no command is forwarded as well, and the entry point's code is the launcher's", async () => {
    const rig = cachedRig();
    const dir = copyTemplate(rig, pinOf(archive));

    const bare = await runLauncher(rig, dir, []);
    const failing = await runLauncher(rig, dir, [], { env: { ENTRY_MODE: "exit:2" } });

    assert.equal(bare.code, 0, bare.out);
    assert.deepEqual(parseEntryReport(bare.stdout).args, []);
    assert.equal(failing.code, 2);
  });
});

describe("R12: identical behaviour whatever module type package.json declares", () => {
  const variants: Array<[string, string | undefined]> = [
    ["no package.json", undefined],
    ['"type": "module"', '{ "type": "module" }\n'],
    ['"type": "commonjs"', '{ "type": "commonjs" }\n'],
    ["a package.json with no type", '{ "name": "org-config" }\n'],
  ];

  interface Behaviour {
    download: { code: number | null; stderr: string; args: string[] };
    cached: { code: number | null; stderr: string; args: string[] };
    pinDefect: { code: number | null; out: string };
    unreachable: { code: number | null; out: string };
  }

  async function behaviour(packageJson: string | undefined, port: number): Promise<Behaviour> {
    const rig = rigs.make();
    const server = await servers.start();
    serveArchive(server, archive);
    const files: Record<string, string> =
      packageJson === undefined ? {} : { "package.json": packageJson };
    const dir = copyTemplate(rig, pinOf(archive), files);
    const env = { [VARIABLE]: server.origin };
    const args = ["build", "--some-arg", "value"];

    const download = await runLauncher(rig, dir, args, { env });
    const cached = await runLauncher(rig, dir, args, { env });
    const defect = copyTemplate(rig, pinOf(archive, { version: "^1.0.0" }), files);
    const pinDefect = await runLauncher(rig, defect, args, { env });
    const fresh = rigs.make();
    const bare = copyTemplate(fresh, pinOf(archive), files);
    const unreachable = await runLauncher(fresh, bare, args, {
      env: { [VARIABLE]: `http://127.0.0.1:${port}` },
    });

    const strip = (text: string): string =>
      text.split(dir).join("<dir>").split(defect).join("<dir>");
    return {
      download: {
        code: download.code,
        stderr: download.stderr,
        args: parseEntryReport(download.stdout).args,
      },
      cached: {
        code: cached.code,
        stderr: cached.stderr,
        args: parseEntryReport(cached.stdout).args,
      },
      pinDefect: { code: pinDefect.code, out: strip(pinDefect.out) },
      unreachable: { code: unreachable.code, out: unreachable.out },
    };
  }

  test("download, cached run, pin defect and download failure behave the same for every variant", async () => {
    const port = await closedPort();
    const results = new Map<string, Behaviour>();
    for (const [name, packageJson] of variants)
      results.set(name, await behaviour(packageJson, port));
    const [reference, ...others] = [...results.values()];

    assert.ok(reference !== undefined);
    assert.equal(reference.download.code, 0);
    assert.equal(reference.download.stderr, "", "no warning on stderr");
    assert.equal(reference.cached.code, 0);
    assert.equal(reference.pinDefect.code, 11);
    assert.equal(reference.unreachable.code, 12);
    for (const other of others) assert.deepEqual(other, reference);
  });

  test("a package.json that declares a type is not read by the launcher for anything else", async () => {
    const rig = cachedRig();
    const dir = copyTemplate(rig, pinOf(archive), {
      "package.json": '{ "type": "module", "main": "nope.js" }\n',
    });
    fs.writeFileSync(path.join(dir, "nope.js"), "throw new Error('read')\n");

    const run = await runLauncher(rig, dir, ["build"]);

    assert.equal(run.code, 0, run.out);
    assert.equal(run.stderr, "");
  });
});
