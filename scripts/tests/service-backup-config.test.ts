// service-backup-config.test.ts — `backupConfig` of scripts/lib/service/assistant-config.ts
// against the shell's `backup_file` (scripts/lib/common.sh): the copy carries the bearer
// token, so it is created exclusively and at 0600 from the first byte, never through a
// symlink planted at the backup name (spec 0252 requirement 27, review i1-F38). POSIX only.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import { backupConfig } from "../lib/service/assistant-config.ts";

const skip = process.platform === "win32";
const NOW = new Date(2026, 9, 10, 12, 0, 0);
const STAMP = "20261010-120000";
let dir: string;
let cfg: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "backup-config-"));
  cfg = path.join(dir, "settings.json");
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));
const mode = (f: string): number => fs.statSync(f).mode & 0o777;

test("an absent config gives no backup", { skip }, () => {
  assert.equal(backupConfig(cfg, NOW), null);
});

test("the backup is a 0600 copy even of a 0644 source", { skip }, () => {
  fs.writeFileSync(cfg, '{"token":"SECRET"}\n', { mode: 0o644 });
  fs.chmodSync(cfg, 0o644);
  const bak = backupConfig(cfg, NOW);
  assert.equal(bak, `${cfg}.bak.${STAMP}`);
  assert.equal(fs.readFileSync(bak ?? "", "utf8"), '{"token":"SECRET"}\n');
  assert.equal(mode(bak ?? ""), 0o600);
});

test("same-second collisions take .01, .02", { skip }, () => {
  fs.writeFileSync(cfg, "{}\n");
  assert.equal(backupConfig(cfg, NOW), `${cfg}.bak.${STAMP}`);
  assert.equal(backupConfig(cfg, NOW), `${cfg}.bak.${STAMP}.01`);
  assert.equal(backupConfig(cfg, NOW), `${cfg}.bak.${STAMP}.02`);
});

test(
  "a dangling symlink at the backup name is occupied: the token copy never goes through it",
  { skip },
  () => {
    fs.writeFileSync(cfg, '{"token":"SECRET"}\n');
    const victim = path.join(dir, "victim.txt");
    fs.symlinkSync(victim, `${cfg}.bak.${STAMP}`);
    const bak = backupConfig(cfg, NOW);
    assert.equal(bak, `${cfg}.bak.${STAMP}.01`);
    assert.equal(fs.existsSync(victim), false, "nothing written through the planted link");
    assert.equal(mode(bak ?? ""), 0o600);
  },
);

test("99 occupied names: no backup and nothing overwritten", { skip }, () => {
  fs.writeFileSync(cfg, "{}\n");
  fs.writeFileSync(`${cfg}.bak.${STAMP}`, "first");
  for (let n = 1; n < 100; n++) {
    fs.writeFileSync(`${cfg}.bak.${STAMP}.${String(n).padStart(2, "0")}`, `old${n}`);
  }
  assert.equal(backupConfig(cfg, NOW), null);
  assert.equal(fs.readFileSync(`${cfg}.bak.${STAMP}`, "utf8"), "first");
});

test("a symlinked config is copied as the link, not its content", { skip }, () => {
  const real = path.join(dir, "real.json");
  fs.writeFileSync(real, '{"token":"SECRET"}\n');
  fs.symlinkSync(real, cfg);
  const bak = backupConfig(cfg, NOW);
  assert.ok(bak !== null && fs.lstatSync(bak).isSymbolicLink());
  assert.equal(fs.readlinkSync(bak ?? ""), real);
});

test("earlier backups are narrowed to 0600", { skip }, () => {
  fs.writeFileSync(cfg, "{}\n");
  const old = `${cfg}.bak.19990101-000000`;
  fs.writeFileSync(old, "old");
  fs.chmodSync(old, 0o644);
  backupConfig(cfg, NOW);
  assert.equal(mode(old), 0o600);
});
