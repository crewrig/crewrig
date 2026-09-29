// line-endings.test.ts — tests for scripts/lib/line-endings.ts (spec 0240 R9).

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";

import { readTextLf, toLf, writeTextLf } from "../lib/line-endings.ts";

const temps: string[] = [];
after(() => {
  for (const dir of temps) fs.rmSync(dir, { recursive: true, force: true });
});

function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "crewrig-eol-"));
  temps.push(dir);
  return dir;
}

describe("toLf", () => {
  test("converts CRLF and lone CR, leaves LF alone", () => {
    assert.equal(toLf("a\r\nb\rc\nd"), "a\nb\nc\nd");
  });
});

describe("readTextLf", () => {
  test("reads CRLF and LF files to the same string", () => {
    const dir = tempDir();
    fs.writeFileSync(path.join(dir, "crlf.txt"), "one\r\ntwo\r\n");
    fs.writeFileSync(path.join(dir, "lf.txt"), "one\ntwo\n");
    assert.equal(readTextLf(path.join(dir, "crlf.txt")), "one\ntwo\n");
    assert.equal(readTextLf(path.join(dir, "lf.txt")), "one\ntwo\n");
  });

  test("strips a leading byte-order mark", () => {
    const dir = tempDir();
    fs.writeFileSync(path.join(dir, "bom.txt"), "﻿text\r\n");
    assert.equal(readTextLf(path.join(dir, "bom.txt")), "text\n");
  });
});

describe("writeTextLf", () => {
  test("CRLF and LF input produce byte-identical files", () => {
    const dir = tempDir();
    const fromCrlf = path.join(dir, "from-crlf.txt");
    const fromLf = path.join(dir, "from-lf.txt");
    writeTextLf(fromCrlf, "line 1\r\nline 2\r\n");
    writeTextLf(fromLf, "line 1\nline 2\n");
    const a = fs.readFileSync(fromCrlf);
    assert.deepEqual(a, fs.readFileSync(fromLf));
    assert.equal(a.includes(0x0d), false);
  });

  test("leaves no temporary file behind", () => {
    const dir = tempDir();
    writeTextLf(path.join(dir, "out.txt"), "x\n");
    assert.deepEqual(fs.readdirSync(dir), ["out.txt"]);
  });
});
