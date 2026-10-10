// install-write-mode.test.ts — unit tests of scripts/lib/install/write-mode.ts: a JSON file is
// published with the mode the shell's `> file` redirect leaves (umask for a new file, the file's
// own mode for an existing one, the link target's mode through a link).

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";

import { writeJsonKeepingMode } from "../lib/install/write-mode.ts";

const POSIX = process.platform === "win32" ? "POSIX modes only" : false;
const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((d) => fs.rmSync(d, { recursive: true, force: true })));

const box = (): string => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "write-mode-"));
  dirs.push(dir);
  return dir;
};
const modeOf = (file: string): string => (fs.statSync(file).mode & 0o777).toString(8);

function underUmask<T>(mask: number, run: () => T): T {
  const previous = process.umask(mask);
  try {
    return run();
  } finally {
    process.umask(previous);
  }
}

describe("writeJsonKeepingMode", { skip: POSIX }, () => {
  for (const [mask, expected] of [
    [0o022, "644"],
    [0o077, "600"],
  ] as const) {
    it(`a new file follows umask ${mask.toString(8).padStart(3, "0")}`, () => {
      const file = path.join(box(), "new.json");
      underUmask(mask, () => writeJsonKeepingMode(file, "{}\n"));
      assert.equal(modeOf(file), expected);
      assert.equal(fs.readFileSync(file, "utf8"), "{}\n");
    });
  }

  it("an existing 0640 file keeps 0640, whatever the umask", () => {
    const file = path.join(box(), "old.json");
    fs.writeFileSync(file, "old");
    fs.chmodSync(file, 0o640);
    underUmask(0o077, () => writeJsonKeepingMode(file, "new"));
    assert.equal(modeOf(file), "640");
    assert.equal(fs.readFileSync(file, "utf8"), "new");
  });

  it("a link keeps being a link and the target keeps its mode", () => {
    const dir = box();
    const target = path.join(dir, "real.json");
    const link = path.join(dir, "link.json");
    fs.writeFileSync(target, "old");
    fs.chmodSync(target, 0o640);
    fs.symlinkSync(target, link);
    writeJsonKeepingMode(link, "new");
    assert.ok(fs.lstatSync(link).isSymbolicLink());
    assert.equal(fs.readFileSync(target, "utf8"), "new");
    assert.equal(modeOf(target), "640");
  });

  it("leaves no temporary file behind", () => {
    const dir = box();
    writeJsonKeepingMode(path.join(dir, "a.json"), "{}");
    assert.deepEqual(fs.readdirSync(dir), ["a.json"]);
  });
});
