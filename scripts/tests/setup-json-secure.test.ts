// setup-json-secure.test.ts — json-secure.ts (scripts/lib/setup/json-secure.ts) against temporary directories only.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it, mock } from "node:test";

import { parseJson } from "../lib/extension/json-ordered.ts";
import { ExtError } from "../lib/extension/types.ts";
import type { JsonValue } from "../lib/extension/types.ts";
import { SetupExit } from "../lib/setup/exit.ts";
import {
  readJsonObjectOrFail,
  readJsonOrFail,
  writeJsonConfigSecure,
} from "../lib/setup/json-secure.ts";

const posix = process.platform !== "win32";
const NOW = (): Date => new Date(2026, 9, 10, 8, 5, 9);
const STAMP = "20261010-080509";
const hasJq = spawnSync("jq", ["--version"]).status === 0;
let dir: string;
let file: string;
let out: string[];
let err: string[];

beforeEach(() => {
  dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "setup-json-secure-")));
  file = path.join(dir, "config.json");
  out = [];
  err = [];
});
afterEach(() => {
  mock.restoreAll();
  fs.rmSync(dir, { recursive: true, force: true });
});

const ctx = (platform: NodeJS.Platform = process.platform) => ({
  io: { out: (l: string) => out.push(l), err: (l: string) => err.push(l) },
  platform,
});
const leftovers = (): string[] => fs.readdirSync(dir).filter((n) => n.includes(".tmp-"));
const doc = (text: string): JsonValue => parseJson(text, "test");

describe("writeJsonConfigSecure: value", () => {
  it("writes a new file in the jq form with a final line feed and no backup", () => {
    const bak = writeJsonConfigSecure({
      ctx: ctx(),
      file,
      value: doc('{"a":[1,{"b":null}],"c":{}}'),
    });
    assert.equal(bak, "");
    assert.equal(
      fs.readFileSync(file, "utf8"),
      '{\n  "a": [\n    1,\n    {\n      "b": null\n    }\n  ],\n  "c": {}\n}\n',
    );
    assert.deepEqual(out, []);
    assert.deepEqual(leftovers(), []);
  });

  it("backs the existing file up first, byte for byte, and prints the line", () => {
    fs.writeFileSync(file, '{"old":true}');
    const bak = writeJsonConfigSecure({ ctx: ctx(), file, value: doc('{"new":1}'), now: NOW });
    assert.equal(bak, `${file}.bak.${STAMP}`);
    assert.equal(fs.readFileSync(bak, "utf8"), '{"old":true}');
    assert.equal(fs.readFileSync(file, "utf8"), '{\n  "new": 1\n}\n');
    assert.deepEqual(out, [`  Backed up: config.json -> config.json.bak.${STAMP}`]);
  });

  it("does not back up when told not to", () => {
    fs.writeFileSync(file, "{}");
    assert.equal(writeJsonConfigSecure({ ctx: ctx(), file, value: doc("{}"), backup: false }), "");
    assert.deepEqual(fs.readdirSync(dir), ["config.json"]);
  });

  it("keeps the key order, integer-like keys included, and writes LF only", () => {
    writeJsonConfigSecure({
      ctx: ctx(),
      file,
      value: doc('{"b":1,"2":2,"1":"x\\ny","a":"\\u007f"}'),
    });
    const text = fs.readFileSync(file, "utf8");
    assert.equal(text, '{\n  "b": 1,\n  "2": 2,\n  "1": "x\\ny",\n  "a": "\\u007f"\n}\n');
    assert.ok(!text.includes("\r"));
  });

  it("writes a number as JavaScript writes it (deviation (j))", () => {
    writeJsonConfigSecure({ ctx: ctx(), file, value: doc('{"t":30.0,"e":1E+3,"z":-0}') });
    assert.equal(fs.readFileSync(file, "utf8"), '{\n  "t": 30,\n  "e": 1000,\n  "z": -0\n}\n');
  });

  it("rejects both a value and a patch, and neither", () => {
    assert.throws(() => writeJsonConfigSecure({ ctx: ctx(), file }), TypeError);
    assert.throws(
      () => writeJsonConfigSecure({ ctx: ctx(), file, value: null, patch: (d) => d }),
      TypeError,
    );
  });
});

describe("writeJsonConfigSecure: mode and atomicity", () => {
  it("creates the file 0600 and narrows an existing wide file to 0600", { skip: !posix }, () => {
    writeJsonConfigSecure({ ctx: ctx(), file, value: doc("{}") });
    assert.equal(fs.statSync(file).mode & 0o777, 0o600);
    fs.writeFileSync(file, "{}");
    fs.chmodSync(file, 0o644);
    writeJsonConfigSecure({ ctx: ctx(), file, value: doc("{}") });
    assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  });

  it("opens the temporary file with mode 0600 off win32", { skip: !posix }, () => {
    const spy = mock.method(fs, "openSync");
    writeJsonConfigSecure({ ctx: ctx("linux"), file, value: doc("{}") });
    const call = spy.mock.calls.find((c) => String(c.arguments[0]).includes(".tmp-"));
    assert.equal(call?.arguments[2], 0o600);
  });

  it("sets no mode on win32: no mode at the open and no chmod", () => {
    const open = mock.method(fs, "openSync");
    const chmod = mock.method(fs, "chmodSync");
    writeJsonConfigSecure({ ctx: ctx("win32"), file, value: doc("{}"), backup: false });
    const call = open.mock.calls.find((c) => String(c.arguments[0]).includes(".tmp-"));
    assert.equal(call?.arguments[2], undefined);
    assert.equal(chmod.mock.callCount(), 0);
    assert.equal(fs.readFileSync(file, "utf8"), "{}\n");
  });

  it("leaves no temporary file and the old content when the rename fails", () => {
    fs.writeFileSync(file, '{"keep":1}');
    mock.method(fs, "renameSync", () => {
      throw new Error("EXDEV: boom");
    });
    assert.throws(
      () => writeJsonConfigSecure({ ctx: ctx(), file, value: doc("{}"), backup: false }),
      (e: unknown) => e instanceof SetupExit && e.status === 1,
    );
    assert.equal(fs.readFileSync(file, "utf8"), '{"keep":1}');
    assert.deepEqual(leftovers(), []);
    assert.match(err[0] ?? "", /^Error: cannot write .*config\.json: EXDEV: boom$/);
  });

  it(
    "replaces a symbolic link at the destination instead of writing through it",
    { skip: !posix },
    () => {
      const victim = path.join(dir, "victim.json");
      fs.writeFileSync(victim, "keep");
      fs.symlinkSync(victim, file);
      writeJsonConfigSecure({ ctx: ctx(), file, value: doc("{}"), backup: false });
      assert.equal(fs.readFileSync(victim, "utf8"), "keep");
      assert.ok(!fs.lstatSync(file).isSymbolicLink());
    },
  );
});

describe("writeJsonConfigSecure: patch and source", () => {
  it("patches the file itself, keeping the position of an assigned key", () => {
    fs.writeFileSync(file, '{"a":1,"mcpServers":{"x":1},"z":2}');
    writeJsonConfigSecure({
      ctx: ctx(),
      file,
      backup: false,
      patch: (d) => {
        const m = d as Map<string, JsonValue>;
        m.set("mcpServers", new Map([["y", 2]]));
        m.set("added", true);
        return m;
      },
    });
    assert.equal(
      fs.readFileSync(file, "utf8"),
      '{\n  "a": 1,\n  "mcpServers": {\n    "y": 2\n  },\n  "z": 2,\n  "added": true\n}\n',
    );
  });

  it("writes a patched copy of another file onto an absent destination (write_json_config_secure_from)", () => {
    const src = path.join(dir, "src.json");
    fs.writeFileSync(src, '{"a":1}');
    writeJsonConfigSecure({
      ctx: ctx(),
      file,
      from: src,
      patch: (d) => new Map([...(d as Map<string, JsonValue>), ["b", 2]]),
    });
    assert.equal(fs.readFileSync(file, "utf8"), '{\n  "a": 1,\n  "b": 2\n}\n');
    assert.equal(fs.readFileSync(src, "utf8"), '{"a":1}');
  });

  it("takes a document as the source, and no patch means a copy", () => {
    writeJsonConfigSecure({ ctx: ctx(), file, from: doc('{"k":[]}') });
    assert.equal(fs.readFileSync(file, "utf8"), '{\n  "k": []\n}\n');
  });

  it("reports a refusing patch as one Error line, status 1, the target intact", () => {
    fs.writeFileSync(file, '{"a":1}');
    assert.throws(
      () =>
        writeJsonConfigSecure({
          ctx: ctx(),
          file,
          backup: false,
          patch: () => {
            throw new ExtError("mcpServers is not an object");
          },
        }),
      (e: unknown) => e instanceof SetupExit && e.status === 1,
    );
    assert.deepEqual(err, ["Error: mcpServers is not an object"]);
    assert.equal(fs.readFileSync(file, "utf8"), '{"a":1}');
  });
});

describe("invalid input (deviation (j))", () => {
  it("names the file in one Error line and exits 1, leaving the target and no temporary file", () => {
    fs.writeFileSync(file, '{"a":');
    assert.throws(
      () => writeJsonConfigSecure({ ctx: ctx(), file, backup: false, patch: (d) => d }),
      (e: unknown) => e instanceof SetupExit && e.status === 1,
    );
    assert.equal(err.length, 1);
    assert.match(
      err[0] ?? "",
      new RegExp(`^Error: ${file.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&")} is not valid JSON`),
    );
    assert.equal(fs.readFileSync(file, "utf8"), '{"a":');
    assert.deepEqual(leftovers(), []);
  });

  it("readJsonObjectOrFail: absent, invalid and non-object files", () => {
    for (const [text, tail] of [
      [undefined, "cannot be read"],
      ["nope", "is not valid JSON"],
      ["[1]", "is not a JSON object"],
    ] as const) {
      err.length = 0;
      if (text !== undefined) fs.writeFileSync(file, text);
      assert.throws(
        () => readJsonObjectOrFail(ctx(), file),
        (e: unknown) => e instanceof SetupExit && e.status === 1,
      );
      assert.equal(err.length, 1);
      assert.ok(
        (err[0] ?? "").startsWith(`Error: ${file}`) && (err[0] ?? "").includes(tail),
        err[0],
      );
    }
  });

  it("readJsonOrFail accepts a BOM and CRLF", () => {
    fs.writeFileSync(file, '\uFEFF{\r\n"a": 1\r\n}\r\n');
    assert.deepEqual([...(readJsonOrFail(ctx(), file) as Map<string, JsonValue>)], [["a", 1]]);
  });
});

describe("parity with jq", { skip: !hasJq }, () => {
  it("writes what jq . prints for a document of integers, strings and nesting", () => {
    const text =
      '{"mcpServers":{"mempalace":{"command":"bash","args":["a b","\\"q\\"","é/\\u0001\\\\"],"env":{}},"z":[[],[1,[2]],{}]},"n":null,"t":true,"f":1.5,"2":"x","1":"y"}';
    const expected = spawnSync("jq", ["."], { input: text, encoding: "utf8" }).stdout;
    writeJsonConfigSecure({ ctx: ctx(), file, value: doc(text) });
    assert.equal(fs.readFileSync(file, "utf8"), expected);
  });

  it("matches a jq patch of the file", () => {
    const text = '{"a":1,"mcpServers":{"x":{"command":"c"}}}';
    const expected = spawnSync(
      "jq",
      ['.mcpServers = ((.mcpServers // {}) + {"y":{"command":"d"}})'],
      {
        input: text,
        encoding: "utf8",
      },
    ).stdout;
    fs.writeFileSync(file, text);
    writeJsonConfigSecure({
      ctx: ctx(),
      file,
      backup: false,
      patch: (d) => {
        const m = d as Map<string, JsonValue>;
        const s = new Map(m.get("mcpServers") as Map<string, JsonValue>);
        s.set("y", new Map([["command", "d"]]));
        return new Map([...m, ["mcpServers", s]]);
      },
    });
    assert.equal(fs.readFileSync(file, "utf8"), expected);
  });
});
