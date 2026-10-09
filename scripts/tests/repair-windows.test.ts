// repair-windows.test.ts — the platform-neutral oracle of `repair-mempalace-http`
// (spec 0252 requirement 24, parent requirement 17: every migrated script ships a
// Windows leg that actually runs). It runs on EVERY platform, `windows-latest`
// included, through `node scripts/repair-mempalace-http.ts` only: no bash, no
// shim, no `chmod`-dependent assertion. Gemini is made present by an empty file on
// an otherwise empty PATH (`gemini` and `gemini.cmd`, which is what a Windows
// lookup accepts), HOME and USERPROFILE point at a temp dir, and the config files
// are compared byte for byte (UTF-8, `\n`, no byte order mark, no `\r`). The POSIX
// stubs, modes, symlink and no-spawn legs stay in repair-verbs.test.ts.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";

const REPO = path.resolve(import.meta.dirname, "..", "..");
const root = fs.mkdtempSync(path.join(os.tmpdir(), "crewrig-repair-windows-"));
after(() => fs.rmSync(root, { recursive: true, force: true }));

const RESIDUE = '{"mcpServers":{"mempalace":{"nonsense":true}}}\n';
const USABLE = '{"mcpServers":{"mempalace":{"command":"bash","args":["newer","é-日本"]}}}\n';
const STDIO = '{"mcpServers":{"mempalace":{"command":"bash"}}}\n';

interface Box {
  home: string;
  gemini: string;
}

/** A temp HOME with `gemini` present on a PATH holding nothing else, and no config yet. */
function makeBox(name: string, present = true): Box {
  const home = path.join(root, name);
  const bin = path.join(home, "bin");
  fs.mkdirSync(bin, { recursive: true });
  fs.mkdirSync(path.join(home, ".gemini"), { recursive: true });
  if (present)
    for (const file of ["gemini", "gemini.cmd"]) fs.writeFileSync(path.join(bin, file), "");
  return { home, gemini: path.join(home, ".gemini", "settings.json") };
}

function run(box: Box, args: string[] = []): { status: number | null; out: string; err: string } {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const key of Object.keys(env)) if (key.toUpperCase() === "PATH") delete env[key];
  env["PATH"] = path.join(box.home, "bin");
  env["HOME"] = box.home;
  env["USERPROFILE"] = box.home;
  env["CREWRIG_TEST_MOCK_DAEMON"] = "1";
  const r = spawnSync(process.execPath, ["scripts/repair-mempalace-http.ts", ...args], {
    cwd: REPO,
    env,
    encoding: "utf8",
    timeout: 30_000,
    windowsHide: true,
  });
  return { status: r.status, out: r.stdout, err: r.stderr };
}

/** The file's bytes, never decoded: what a verb promises is bytes. */
const bytes = (file: string): Buffer => fs.readFileSync(file);
const utf8 = (text: string): Buffer => Buffer.from(text, "utf8");
const bak = (box: Box, stampText: string): string => `${box.gemini}.bak.${stampText}`;

describe("repair-mempalace-http — every platform", () => {
  test("an unknown verb exits 2 with the error and the usage text on stderr, nothing on stdout", () => {
    const r = run(makeBox("usage"), ["--bogus"]);
    assert.equal(r.status, 2);
    assert.equal(r.out, "");
    assert.match(r.err, /^ERROR: unknown option: --bogus\n/);
    assert.ok(
      r.err.includes(
        "Usage: bash scripts/repair-mempalace-http.sh [--restore-backup | --reset-none]\n",
      ),
    );
    assert.ok(
      r.err.includes("  --reset-none      Remove the mempalace registration from each affected\n"),
    );
    assert.ok(r.err.includes("(that is setup's job) and never places the bearer token in argv.\n"));
  });

  test("the exclusive pair exits 2; --help exits 0 on stdout", () => {
    const box = makeBox("exclusive");
    const both = run(box, ["--restore-backup", "--reset-none"]);
    assert.equal(both.status, 2);
    assert.match(both.err, /--restore-backup and --reset-none are mutually exclusive\./);
    const help = run(box, ["--help"]);
    assert.equal(help.status, 0);
    assert.match(help.out, /^Usage: bash scripts\/repair-mempalace-http\.sh /);
  });

  test("no supported assistant on PATH: nothing to repair, exit 0", () => {
    const box = makeBox("absent", false);
    fs.writeFileSync(box.gemini, "not json");
    const r = run(box);
    assert.equal(r.status, 0);
    assert.match(r.out, /No supported assistant found on this machine/);
  });

  test("no assistant over a broken arrangement exits 0, and a clean config is left byte for byte", () => {
    const box = makeBox("clean");
    const noConfig = run(box);
    assert.equal(noConfig.status, 0);
    assert.match(noConfig.out, /No residue found/);
    fs.writeFileSync(box.gemini, STDIO);
    for (const args of [[], ["--restore-backup"], ["--reset-none"]]) {
      assert.equal(run(box, args).status, 0, args.join(" "));
      assert.deepEqual(bytes(box.gemini), utf8(STDIO));
    }
  });

  test("a config that does not parse is residue: exit 1, the report names path, backup state and actions", () => {
    const box = makeBox("residue");
    fs.writeFileSync(box.gemini, "not json");
    const r = run(box);
    assert.equal(r.status, 1);
    assert.match(r.out, /MemPalace switch residue repair \(spec 0165\)/);
    assert.match(r.out, /^ {2}gemini$/m);
    assert.ok(r.out.includes(`config:  ${box.home}/.gemini/settings.json`));
    assert.match(r.out, /backup: {2}no/);
    assert.match(r.out, /note: {4}config does not parse/);
    assert.match(r.out, /actions: restore the \.bak file by hand, then re-run setup/);
    assert.match(r.out, /Run with --restore-backup or --reset-none to repair\./);
    assert.deepEqual(bytes(box.gemini), utf8("not json"));
    fs.writeFileSync(bak(box, "20260101-000000"), USABLE);
    const again = run(box);
    assert.match(again.out, /backup: {2}yes \(most recent parses as JSON\)/);
    assert.match(again.out, /actions: --restore-backup\n/);
  });

  test("--restore-backup restores the most recent usable backup byte for byte and exits 0", () => {
    const box = makeBox("restore");
    fs.writeFileSync(box.gemini, "not json");
    fs.writeFileSync(bak(box, "20260102-000000"), USABLE.replace("newer", "older"));
    fs.writeFileSync(bak(box, "20260103-000000"), USABLE);
    fs.writeFileSync(bak(box, "20260104-000000"), "not json either");
    const r = run(box, ["--restore-backup"]);
    assert.equal(r.status, 0);
    assert.match(r.out, /gemini: restored from .*\.bak\.20260103-000000/);
    assert.match(r.out, /Post-repair verification:/);
    assert.match(r.out, /No residue remains/);
    assert.deepEqual(bytes(box.gemini), utf8(USABLE));
    JSON.parse(bytes(box.gemini).toString("utf8"));
    assert.ok(!bytes(box.gemini).includes("\r"));
    assert.equal(run(box).status, 0);
    // the backups themselves are untouched, and no staged `.tmp-` file is left behind
    assert.deepEqual(bytes(bak(box, "20260103-000000")), utf8(USABLE));
    assert.deepEqual(
      fs.readdirSync(path.dirname(box.gemini)).filter((n) => n.includes(".tmp-")),
      [],
    );
  });

  test("--restore-backup with no usable backup exits 1 and leaves the config as it was", () => {
    const box = makeBox("nobackup");
    fs.writeFileSync(box.gemini, "not json");
    fs.writeFileSync(bak(box, "20260101-000000"), "also not json");
    const r = run(box, ["--restore-backup"]);
    assert.equal(r.status, 1);
    assert.match(r.out, /gemini: NO USABLE BACKUP/);
    assert.match(r.out, /Residue remains for: gemini/);
    assert.deepEqual(bytes(box.gemini), utf8("not json"));
  });

  test("--reset-none writes the none arrangement: the promised bytes, UTF-8 and `\\n`", () => {
    const box = makeBox("reset");
    // parseable yet unrecognisable: the entry matches neither the http nor the stdio shape
    fs.writeFileSync(box.gemini, RESIDUE);
    const r = run(box, ["--reset-none"]);
    assert.equal(r.status, 0);
    assert.match(r.out, /gemini: mempalace registration removed \(arrangement: none\)/);
    assert.match(r.out, /gemini: none \(no mempalace registration\)/);
    assert.deepEqual(bytes(box.gemini), utf8('{\n  "mcpServers": {}\n}\n'));
    assert.equal(run(box).status, 0);
  });

  test("--reset-none keeps every other key and server, re-serialised as 2-space JSON with a final `\\n`", () => {
    const box = makeBox("reset-keep");
    fs.writeFileSync(
      box.gemini,
      '{"name":"é-日本","keep":[1,2],"mcpServers":{"mempalace":{"nonsense":true},"other":{"command":"x"}}}\r\n',
    );
    assert.equal(run(box, ["--reset-none"]).status, 0);
    const expected =
      '{\n  "name": "é-日本",\n  "keep": [\n    1,\n    2\n  ],\n  "mcpServers": {\n    "other": {\n      "command": "x"\n    }\n  }\n}\n';
    assert.deepEqual(bytes(box.gemini), utf8(expected));
    assert.ok(!bytes(box.gemini).includes("\r"));
    assert.notDeepEqual([...bytes(box.gemini).subarray(0, 3)], [0xef, 0xbb, 0xbf]);
  });

  test("--reset-none refuses a config that does not parse and leaves it byte for byte", () => {
    const box = makeBox("refuse");
    fs.writeFileSync(box.gemini, "not json");
    const r = run(box, ["--reset-none"]);
    assert.equal(r.status, 1);
    assert.match(r.out, /CONFIG DOES NOT PARSE — run --restore-backup first/);
    assert.deepEqual(bytes(box.gemini), utf8("not json"));
  });
});
