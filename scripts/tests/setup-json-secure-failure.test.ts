// setup-json-secure-failure.test.ts — the failure arms of writeJsonConfigSecure (json-secure.ts):
// a temporary file that cannot be created, and the typed "renamed but not restricted" exit.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it, mock } from "node:test";

import { parseJson } from "../lib/extension/json-ordered.ts";
import { SetupExit } from "../lib/setup/exit.ts";
import { ModeRestrictError, writeJsonConfigSecure } from "../lib/setup/json-secure.ts";

const posix = process.platform !== "win32";
const root = posix && typeof process.getuid === "function" && process.getuid() === 0;
let dir: string;
let file: string;
let err: string[];

beforeEach(() => {
  dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "setup-json-secure-fail-")));
  file = path.join(dir, "config.json");
  err = [];
});
afterEach(() => {
  mock.restoreAll();
  fs.chmodSync(dir, 0o700);
  fs.rmSync(dir, { recursive: true, force: true });
});

const ctx = () => ({
  io: { out: () => undefined, err: (l: string) => err.push(l) },
  platform: process.platform,
});
const doc = parseJson("{}", "t");

describe("writeJsonConfigSecure: temporary file errors", () => {
  it(
    "a read-only directory ends as `Error: cannot write <file>: <reason>` and SetupExit(1)",
    { skip: !posix || root },
    () => {
      fs.chmodSync(dir, 0o500);
      assert.throws(
        () => writeJsonConfigSecure({ ctx: ctx(), file, value: doc, backup: false }),
        (e: unknown) => e instanceof SetupExit && e.status === 1,
      );
      assert.equal(err.length, 1);
      assert.match(err[0] ?? "", /^Error: cannot write .*config\.json: EACCES/);
    },
  );

  it("still retries an EEXIST name", { skip: !posix }, () => {
    const real = fs.openSync;
    let calls = 0;
    mock.method(fs, "openSync", ((p: fs.PathLike, flags: string, mode?: number) => {
      if (++calls === 1) throw Object.assign(new Error("EEXIST: exists"), { code: "EEXIST" });
      return real(p, flags, mode);
    }) as typeof fs.openSync);
    writeJsonConfigSecure({ ctx: ctx(), file, value: doc, backup: false });
    assert.equal(fs.readFileSync(file, "utf8"), "{}\n");
    assert.equal(calls, 2);
  });
});

describe("writeJsonConfigSecure: the mode cannot be narrowed", () => {
  it(
    "throws the typed ModeRestrictError after the rename, whatever the message says",
    { skip: !posix },
    () => {
      const real = fs.chmodSync;
      mock.method(fs, "chmodSync", ((p: fs.PathLike, m: fs.Mode) => {
        if (p === file) throw Object.assign(new Error("EPERM"), { code: "EPERM" });
        return real(p, m);
      }) as typeof fs.chmodSync);
      assert.throws(
        () => writeJsonConfigSecure({ ctx: ctx(), file, value: doc, backup: false }),
        (e: unknown) => e instanceof ModeRestrictError && e instanceof SetupExit && e.status === 1,
      );
      assert.equal(fs.readFileSync(file, "utf8"), "{}\n", "the document is already in place");
    },
  );
});
