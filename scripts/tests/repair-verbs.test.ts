// repair-verbs.test.ts — black-box oracle of `repair-mempalace-http` (spec 0165;
// spec 0252 requirement 18), run as `node scripts/repair-mempalace-http.ts` and
// through its `bash` shim, against an isolated HOME and PATH stubs for the four
// assistants. Covers each verb, the unknown verb, the exit statuses, the mode
// rules of the restore, and that no process is ever spawned: `jq`, `curl`,
// `lsof` and `ss` stubs on PATH record any call, and the assistants' own stubs
// record their argument lists (the token is never on one). The
// CREWRIG_TEST_MOCK_DAEMON seam is set as the shell oracles set it: the repair
// never reaches the daemon, so it changes nothing. POSIX only (bash stubs).

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";

const REPO = path.resolve(import.meta.dirname, "..", "..");
const posix = process.platform !== "win32";
const root = fs.mkdtempSync(path.join(os.tmpdir(), "crewrig-repair-verbs-"));
after(() => fs.rmSync(root, { recursive: true, force: true }));

const RESIDUE = '{"mcpServers":{"mempalace":{"nonsense":true}}}\n';
const USABLE = '{"mcpServers":{"mempalace":{"command":"bash","args":["newer"]}}}\n';
const TOKEN = "SECRET-TOKEN-1234";
const TOKEN_CFG = `{"mcpServers":{"mempalace":{"type":"http","url":"http://127.0.0.1:1/mcp","headers":{"Authorization":"Bearer ${TOKEN}"}}}}\n`;

type Entry = (args: string[]) => [string, string[]];
const ENTRIES: Array<[string, Entry]> = [
  ["TypeScript entry", (a) => [process.execPath, ["scripts/repair-mempalace-http.ts", ...a]]],
  ["bash shim", (a) => ["bash", ["scripts/repair-mempalace-http.sh", ...a]]],
];

interface Box {
  home: string;
  calls: string;
  gemini: string;
}

/** An isolated HOME with the four assistants stubbed on PATH and the forbidden tools recorded. */
function makeBox(name: string, present = ["claude", "gemini", "copilot", "agy"]): Box {
  const home = path.join(root, name);
  const bin = path.join(home, "bin");
  const calls = path.join(home, "calls.log");
  fs.mkdirSync(bin, { recursive: true });
  fs.mkdirSync(path.join(home, ".gemini"), { recursive: true });
  fs.writeFileSync(calls, "");
  // node by symlink, not its directory: that directory may hold a real assistant CLI.
  fs.symlinkSync(process.execPath, path.join(bin, "node"));
  for (const tool of [...present, "jq", "curl", "lsof", "ss"]) {
    fs.writeFileSync(
      path.join(bin, tool),
      `#!/bin/sh\nprintf '%s %s\\n' "${tool}" "$*" >> "${calls}"\nexit 0\n`,
      { mode: 0o755 },
    );
  }
  return { home, calls, gemini: path.join(home, ".gemini", "settings.json") };
}

function run(
  entry: Entry,
  box: Box,
  args: string[] = [],
): { status: number | null; out: string; err: string } {
  const [cmd, argv] = entry(args);
  const env: NodeJS.ProcessEnv = {
    HOME: box.home,
    USERPROFILE: box.home,
    PATH: `${path.join(box.home, "bin")}${path.delimiter}/usr/bin${path.delimiter}/bin`,
    CREWRIG_TEST_MOCK_DAEMON: "1",
  };
  const r = spawnSync(cmd, argv, { cwd: REPO, env, encoding: "utf8", timeout: 30_000 });
  return { status: r.status, out: r.stdout, err: r.stderr };
}

const mode = (file: string): string => (fs.lstatSync(file).mode & 0o777).toString(8);

for (const [label, entry] of ENTRIES) {
  describe(`repair-mempalace-http — ${label}`, { skip: !posix && "POSIX stubs" }, () => {
    test("report-only: exits 1 and names the assistant, path, backup state and actions", () => {
      const box = makeBox(`report-${label.length}`);
      fs.writeFileSync(box.gemini, RESIDUE);
      const r = run(entry, box);
      assert.equal(r.status, 1);
      assert.match(r.out, /MemPalace switch residue repair \(spec 0165\)/);
      assert.match(r.out, /^ {2}gemini$/m);
      assert.ok(r.out.includes(`config:  ${box.gemini}`));
      assert.match(r.out, /backup: {2}no/);
      assert.match(r.out, /actions: --reset-none/);
      assert.match(r.out, /Run with --restore-backup or --reset-none to repair\./);
      fs.writeFileSync(`${box.gemini}.bak.20260101-000000`, USABLE);
      const again = run(entry, box);
      assert.match(again.out, /backup: {2}yes \(most recent parses as JSON\)/);
      assert.match(again.out, /actions: --restore-backup \| --reset-none/);
      fs.writeFileSync(`${box.gemini}.bak.20260102-000000`, "not json");
      fs.rmSync(`${box.gemini}.bak.20260101-000000`);
      assert.match(run(entry, box).out, /backup: {2}yes, but none parses as JSON/);
    });

    test("a config-less or recognisable assistant is not residue (exit 0)", () => {
      const box = makeBox(`clean-${label.length}`);
      const r = run(entry, box);
      assert.equal(r.status, 0);
      assert.match(r.out, /No residue found/);
      fs.writeFileSync(box.gemini, '{"mcpServers":{"mempalace":{"command":"bash"}}}\n');
      assert.equal(run(entry, box).status, 0);
    });

    test("no supported assistant on PATH: nothing to repair, exit 0", () => {
      const box = makeBox(`none-${label.length}`, []);
      const r = run(entry, box);
      assert.equal(r.status, 0);
      assert.match(r.out, /No supported assistant found on this machine/);
    });

    test("--restore-backup: the newest usable backup wins, its mode is kept, exit 0", () => {
      const box = makeBox(`restore-${label.length}`);
      fs.writeFileSync(box.gemini, RESIDUE, { mode: 0o600 });
      fs.writeFileSync(`${box.gemini}.bak.20260101-000000`, "not json");
      fs.writeFileSync(`${box.gemini}.bak.20260102-000000`, USABLE.replace("newer", "older"), {
        mode: 0o644,
      });
      fs.writeFileSync(`${box.gemini}.bak.20260103-000000`, USABLE, { mode: 0o644 });
      fs.chmodSync(`${box.gemini}.bak.20260103-000000`, 0o644);
      const r = run(entry, box, ["--restore-backup"]);
      assert.equal(r.status, 0);
      assert.equal(fs.readFileSync(box.gemini, "utf8"), USABLE);
      assert.equal(mode(box.gemini), "644");
      assert.match(r.out, /gemini: restored from .*\.bak\.20260103-000000/);
      assert.match(r.out, /Post-repair verification:/);
      assert.match(r.out, /No residue remains/);
      assert.equal(run(entry, box).status, 0);
    });

    test("--restore-backup: a token-bearing backup is 0600 and a symlinked config is replaced, not followed", () => {
      const box = makeBox(`token-${label.length}`);
      const victim = path.join(box.home, "victim.json");
      fs.writeFileSync(victim, RESIDUE, { mode: 0o600 });
      fs.symlinkSync(victim, box.gemini);
      fs.writeFileSync(`${box.gemini}.bak.20260104-000000`, TOKEN_CFG, { mode: 0o644 });
      fs.chmodSync(`${box.gemini}.bak.20260104-000000`, 0o644);
      const r = run(entry, box, ["--restore-backup"]);
      assert.equal(r.status, 0);
      assert.ok(!fs.lstatSync(box.gemini).isSymbolicLink());
      assert.equal(mode(box.gemini), "600");
      assert.equal(fs.readFileSync(victim, "utf8"), RESIDUE);
      assert.ok(!r.out.includes(TOKEN) && !r.err.includes(TOKEN));
    });

    test("--restore-backup: no usable backup is reported and exits non-zero", () => {
      const box = makeBox(`nobackup-${label.length}`);
      fs.writeFileSync(box.gemini, RESIDUE);
      const r = run(entry, box, ["--restore-backup"]);
      assert.equal(r.status, 1);
      assert.match(r.out, /gemini: NO USABLE BACKUP/);
      assert.match(r.out, /Residue remains for: gemini/);
    });

    test("--reset-none: removes the registration, exit 0, second run clean", () => {
      const box = makeBox(`reset-${label.length}`);
      fs.writeFileSync(
        box.gemini,
        '{"keep":1,"mcpServers":{"mempalace":{"nonsense":true},"other":{"command":"x"}}}\n',
      );
      const r = run(entry, box, ["--reset-none"]);
      assert.equal(r.status, 0);
      const doc = JSON.parse(fs.readFileSync(box.gemini, "utf8")) as Record<string, unknown>;
      assert.deepEqual(doc, { keep: 1, mcpServers: { other: { command: "x" } } });
      assert.match(r.out, /gemini: mempalace registration removed \(arrangement: none\)/);
      assert.match(r.out, /gemini: none \(no mempalace registration\)/);
      assert.equal(run(entry, box).status, 0);
    });

    test("--reset-none: a config that does not parse is refused and left untouched", () => {
      const box = makeBox(`refuse-${label.length}`);
      fs.writeFileSync(box.gemini, "not json");
      const r = run(entry, box, ["--reset-none"]);
      assert.equal(r.status, 1);
      assert.match(r.out, /CONFIG DOES NOT PARSE — run --restore-backup first/);
      assert.equal(fs.readFileSync(box.gemini, "utf8"), "not json");
    });

    test("a recognisable arrangement is never modified by either verb", () => {
      const box = makeBox(`stable-${label.length}`);
      const body = '{"mcpServers":{"mempalace":{"type":"http","url":"http://127.0.0.1:1/mcp"}}}\n';
      fs.writeFileSync(box.gemini, body);
      run(entry, box, ["--restore-backup"]);
      run(entry, box, ["--reset-none"]);
      assert.equal(fs.readFileSync(box.gemini, "utf8"), body);
    });

    test("usage: -h exits 0 on stdout; an unknown verb and the exclusive pair exit 2 on stderr", () => {
      const box = makeBox(`usage-${label.length}`);
      const help = run(entry, box, ["--help"]);
      assert.equal(help.status, 0);
      assert.match(
        help.out,
        /^Usage: bash scripts\/repair-mempalace-http\.sh \[--restore-backup \| --reset-none\]/,
      );
      const bogus = run(entry, box, ["--bogus"]);
      assert.equal(bogus.status, 2);
      assert.match(bogus.err, /^ERROR: unknown option: --bogus\nUsage: /);
      assert.equal(bogus.out, "");
      const both = run(entry, box, ["--restore-backup", "--reset-none"]);
      assert.equal(both.status, 2);
      assert.match(both.err, /--restore-backup and --reset-none are mutually exclusive\./);
    });

    test("no process is spawned: the token is on no argument list and jq, curl, lsof, ss never run", () => {
      const box = makeBox(`spawn-${label.length}`);
      fs.writeFileSync(box.gemini, RESIDUE);
      fs.writeFileSync(`${box.gemini}.bak.20260104-000000`, TOKEN_CFG);
      for (const args of [[], ["--restore-backup"], ["--reset-none"]]) run(entry, box, args);
      assert.equal(fs.readFileSync(box.calls, "utf8"), "");
    });
  });
}

describe("repair sources", () => {
  test("neither module imports child_process or calls a spawn or exec function", () => {
    for (const file of [
      "lib/service/repair.ts",
      "lib/service/repair-backup.ts",
      "repair-mempalace-http.ts",
    ]) {
      const text = fs.readFileSync(path.join(REPO, "scripts", file), "utf8");
      assert.doesNotMatch(text, /child_process/, file);
      assert.doesNotMatch(text, /\b(spawn|exec)(Sync|File)?\(/, file);
    }
  });
});
