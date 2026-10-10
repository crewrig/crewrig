// setup-backup.test.ts — backupFile (scripts/lib/setup/backup.ts) against temporary directories only.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";

import { backupFile } from "../lib/setup/backup.ts";

const posix = process.platform !== "win32";
const NOW = (): Date => new Date(2026, 9, 10, 8, 5, 9); // 2026-10-10 08:05:09 local
const STAMP = "20261010-080509";
let dir: string;
let out: string[];
let err: string[];

beforeEach(() => {
  dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "setup-backup-")));
  out = [];
  err = [];
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

const ctx = () => ({ io: { out: (l: string) => out.push(l), err: (l: string) => err.push(l) } });

function target(text = '{"a":1}\n', mode = 0o644): string {
  const file = path.join(dir, "mcp-config.json");
  fs.writeFileSync(file, text);
  fs.chmodSync(file, mode);
  return file;
}

describe("backupFile", () => {
  it("copies to <file>.bak.<stamp>, prints the line and returns the path", () => {
    const file = target();
    const bak = backupFile(ctx(), file, { now: NOW });
    assert.equal(bak, `${file}.bak.${STAMP}`);
    assert.equal(fs.readFileSync(bak, "utf8"), '{"a":1}\n');
    assert.deepEqual(out, [`  Backed up: mcp-config.json -> mcp-config.json.bak.${STAMP}`]);
    assert.deepEqual(err, []);
  });

  it("makes the copy 0600 whatever the source mode", { skip: !posix }, () => {
    const bak = backupFile(ctx(), target("secret\n", 0o644), { now: NOW });
    assert.equal(fs.statSync(bak).mode & 0o777, 0o600);
  });

  it("does nothing, silently, when the file is absent", () => {
    assert.equal(backupFile(ctx(), path.join(dir, "missing.json"), { now: NOW }), "");
    assert.equal(backupFile(ctx(), path.join(dir, "no", "such", "dir.json"), { now: NOW }), "");
    assert.deepEqual(out, []);
    assert.deepEqual(err, []);
    assert.deepEqual(fs.readdirSync(dir), []);
  });

  it("does nothing for a directory", () => {
    const sub = path.join(dir, "sub");
    fs.mkdirSync(sub);
    assert.equal(backupFile(ctx(), sub, { now: NOW }), "");
    assert.deepEqual(out, []);
  });

  it("adds a .NN suffix when two backups happen in the same second", () => {
    const file = target();
    const first = backupFile(ctx(), file, { now: NOW });
    fs.writeFileSync(file, "changed\n");
    const second = backupFile(ctx(), file, { now: NOW });
    const third = backupFile(ctx(), file, { now: NOW });
    assert.equal(first, `${file}.bak.${STAMP}`);
    assert.equal(second, `${file}.bak.${STAMP}.01`);
    assert.equal(third, `${file}.bak.${STAMP}.02`);
    assert.equal(fs.readFileSync(first, "utf8"), '{"a":1}\n');
    assert.equal(fs.readFileSync(second, "utf8"), "changed\n");
    assert.equal(out[1], `  Backed up: mcp-config.json -> mcp-config.json.bak.${STAMP}.01`);
  });

  it("warns and returns an empty path after 99 same-second collisions", () => {
    const file = target();
    fs.writeFileSync(`${file}.bak.${STAMP}`, "x");
    for (let n = 1; n <= 99; n++)
      fs.writeFileSync(`${file}.bak.${STAMP}.${String(n).padStart(2, "0")}`, "x");
    assert.equal(backupFile(ctx(), file, { now: NOW }), "");
    assert.deepEqual(out, []);
    assert.deepEqual(err, [
      "  WARNING: could not find a free backup name for mcp-config.json after 99 same-second collisions — skipping this backup.",
    ]);
  });

  it("narrows earlier backups the user owns to 0600", { skip: !posix }, () => {
    const file = target();
    const old = `${file}.bak.19990101-000000`;
    fs.writeFileSync(old, "old");
    fs.chmodSync(old, 0o644);
    const unrelated = path.join(dir, "other.json.bak.1");
    fs.writeFileSync(unrelated, "o");
    fs.chmodSync(unrelated, 0o644);
    backupFile(ctx(), file, { now: NOW });
    assert.equal(fs.statSync(old).mode & 0o777, 0o600);
    assert.equal(fs.statSync(unrelated).mode & 0o777, 0o644);
  });

  it("narrows earlier backups even when the file itself is absent", { skip: !posix }, () => {
    const file = path.join(dir, "gone.json");
    const old = `${file}.bak.19990101-000000`;
    fs.writeFileSync(old, "old");
    fs.chmodSync(old, 0o644);
    assert.equal(backupFile(ctx(), file, { now: NOW }), "");
    assert.equal(fs.statSync(old).mode & 0o777, 0o600);
  });

  it("copies a link as a link and never chmods its target", { skip: !posix }, () => {
    const real = path.join(dir, "real.json");
    fs.writeFileSync(real, "r\n");
    fs.chmodSync(real, 0o644);
    const link = path.join(dir, "link.json");
    fs.symlinkSync(real, link);
    const bak = backupFile(ctx(), link, { now: NOW });
    assert.equal(bak, `${link}.bak.${STAMP}`);
    assert.equal(fs.lstatSync(bak).isSymbolicLink(), true);
    assert.equal(fs.readlinkSync(bak), real);
    assert.equal(fs.statSync(real).mode & 0o777, 0o644);
  });

  it("reports a failed backup of a dangling link, as the shell does", { skip: !posix }, () => {
    const link = path.join(dir, "dangling.json");
    fs.symlinkSync(path.join(dir, "nowhere"), link);
    assert.equal(backupFile(ctx(), link, { now: NOW }), "");
    assert.deepEqual(out, []);
    assert.deepEqual(err, [
      `  WARNING: Failed to back up dangling.json (could not create dangling.json.bak.${STAMP})`,
    ]);
  });

  it("uses the real clock by default (stamp shape)", () => {
    const bak = backupFile(ctx(), target());
    assert.match(path.basename(bak), /^mcp-config\.json\.bak\.\d{8}-\d{6}$/);
  });
});
