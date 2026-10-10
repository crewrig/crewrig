// setup-backup-failure.test.ts — backupFile when the copy itself fails (scripts/lib/setup/backup.ts):
// the shell's `( umask 077; cp -P ... ) && [ -e "$bak" ]` fails, so it warns on standard error, prints
// no `Backed up:` line and leaves LAST_BACKUP_PATH empty.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it, mock } from "node:test";

import { backupFile } from "../lib/setup/backup.ts";

const NOW = (): Date => new Date(2026, 9, 10, 8, 5, 9);
const STAMP = "20261010-080509";
let dir: string;
let out: string[];
let err: string[];

beforeEach(() => {
  dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "setup-backup-fail-")));
  out = [];
  err = [];
});
afterEach(() => {
  mock.restoreAll();
  fs.rmSync(dir, { recursive: true, force: true });
});

const ctx = () => ({ io: { out: (l: string) => out.push(l), err: (l: string) => err.push(l) } });

describe("backupFile: a copy that fails after writing part of the file", () => {
  it("warns as the shell does, prints no `Backed up:` line and returns the empty path", () => {
    const file = path.join(dir, "mcp-config.json");
    fs.writeFileSync(file, '{"a":1}\n');
    const real = fs.writeFileSync;
    // A partial file lands on disk, then the device fills up: what `cp` does on ENOSPC.
    mock.method(fs, "writeFileSync", ((p: fs.PathOrFileDescriptor, data: unknown, o: unknown) => {
      if (typeof p === "string" && p.includes(".bak.")) {
        real(p, "{", o as fs.WriteFileOptions);
        throw Object.assign(new Error("ENOSPC: no space left on device"), { code: "ENOSPC" });
      }
      return real(p, data as string, o as fs.WriteFileOptions);
    }) as typeof fs.writeFileSync);
    const bak = backupFile(ctx(), file, { now: NOW });
    assert.equal(bak, "");
    assert.deepEqual(out, []);
    assert.deepEqual(err, [
      `  WARNING: Failed to back up mcp-config.json (could not create mcp-config.json.bak.${STAMP})`,
    ]);
    // The shell never removes what `cp` left behind; neither does the port.
    assert.equal(fs.readFileSync(`${file}.bak.${STAMP}`, "utf8"), "{");
  });
});
