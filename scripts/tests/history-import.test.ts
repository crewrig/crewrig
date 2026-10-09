// history-import.test.ts — unit tests of the platform-neutral helpers of the history-import port
// (spec 0253 R11-R15, PR C): the `du -h` scale, the Node-only counting primitives, the single-
// readline prompter and the Antigravity staging directory. No bash, no POSIX tool: runs on every OS.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { after, before, describe, test } from "node:test";

import { stageHistoryFile } from "../lib/history-import/antigravity-staging.ts";
import {
  countNonEmptyLines,
  countSubdirs,
  listFiles,
  totalBytes,
} from "../lib/history-import/count.ts";
import { createPrompter } from "../lib/history-import/prompt.ts";
import { humanSize } from "../lib/history-import/size.ts";

let root = "";
before(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "history-import-test-"));
});
after(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

const write = (rel: string, content: string): string => {
  const file = path.join(root, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
  return file;
};

describe("humanSize", () => {
  const table: ReadonlyArray<readonly [number, string]> = [
    [0, "0B"],
    [1, "1B"],
    [512, "512B"],
    [1023, "1023B"],
    [1024, "1.0K"],
    [1025, "1.1K"],
    [4096, "4.0K"],
    [10 * 1024, "10K"],
    [10 * 1024 + 1, "11K"],
    [12 * 1024, "12K"],
    [1536 * 1024, "1.5M"],
    [1024 * 1024 - 1, "1.0M"],
    [1024 * 1024, "1.0M"],
    [3 * 1024 ** 3, "3.0G"],
  ];
  for (const [bytes, expected] of table) {
    test(`${bytes} bytes is ${expected}`, () => {
      assert.equal(humanSize(bytes), expected);
    });
  }
});

describe("counting", () => {
  test("countNonEmptyLines handles LF, CRLF, a lone CR and a missing final newline", () => {
    assert.equal(countNonEmptyLines(write("c/lf.txt", "a\n\nb\n")), 2);
    assert.equal(countNonEmptyLines(write("c/crlf.txt", "a\r\n\r\nb\r\n")), 2);
    assert.equal(countNonEmptyLines(write("c/cr.txt", "a\n\r\nb\n\r")), 2);
    assert.equal(countNonEmptyLines(write("c/nonl.txt", "a\nb")), 2);
    assert.equal(countNonEmptyLines(write("c/empty.txt", "")), 0);
    assert.equal(countNonEmptyLines(path.join(root, "c/absent.txt")), 0);
  });

  test("listFiles is recursive, sorted, regular files only", () => {
    const dir = path.join(root, "l");
    write("l/b/session-2.json", "{}");
    write("l/a/session-1.json", "{}");
    write("l/a/logs.json", "[]");
    fs.mkdirSync(path.join(dir, "d.json"), { recursive: true });
    const found = listFiles(dir, (n) => n.endsWith(".json"));
    assert.deepEqual(found, [
      path.join(dir, "a/logs.json"),
      path.join(dir, "a/session-1.json"),
      path.join(dir, "b/session-2.json"),
    ]);
    assert.deepEqual(
      listFiles(path.join(root, "nope"), () => true),
      [],
    );
  });

  test("listFiles neither follows nor counts symbolic links", (t) => {
    const dir = path.join(root, "sym");
    write("sym/real/x.jsonl", "{}");
    fs.mkdirSync(path.join(dir, "other"), { recursive: true });
    try {
      fs.symlinkSync(path.join(dir, "real"), path.join(dir, "other/dirlink"), "dir");
      fs.symlinkSync(path.join(dir, "real/x.jsonl"), path.join(dir, "other/y.jsonl"), "file");
    } catch {
      t.skip("symbolic links are unavailable here");
      return;
    }
    assert.deepEqual(
      listFiles(dir, (n) => n.endsWith(".jsonl")),
      [path.join(dir, "real/x.jsonl")],
    );
  });

  test("countSubdirs counts direct subdirectories only", () => {
    write("s/p1/a/deep.txt", "x");
    write("s/p2/b.txt", "x");
    write("s/file.txt", "x");
    assert.equal(countSubdirs(path.join(root, "s")), 2);
    assert.equal(countSubdirs(path.join(root, "absent")), 0);
  });

  test("totalBytes sums apparent sizes and skips vanished files", () => {
    const a = write("t/a", "12345");
    const b = write("t/b", "123");
    assert.equal(totalBytes([a, b, path.join(root, "t/gone")]), 8);
    assert.equal(totalBytes([]), 0);
  });
});

describe("createPrompter", () => {
  const tick = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

  test("piped yes/y reaches both prompts across a pause and resume", async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    let written = "";
    output.on("data", (chunk: Buffer) => {
      written += chunk.toString();
    });
    const prompter = createPrompter(input, output);
    input.write("yes\ny\n");
    await tick();
    assert.equal(await prompter.ask("first?"), true);
    prompter.pause();
    await tick();
    prompter.resume();
    assert.equal(await prompter.ask("second?"), true);
    await tick();
    assert.equal(written, "first?\nsecond?\n");
    prompter.close();
  });

  test("a line arriving while paused is kept for the next ask", async () => {
    const input = new PassThrough();
    const prompter = createPrompter(input, new PassThrough());
    input.write("no\n");
    assert.equal(await prompter.ask("first?"), false);
    prompter.pause();
    input.write("yes\n");
    await tick();
    prompter.resume();
    assert.equal(await prompter.ask("second?"), true);
    prompter.close();
  });

  test("an answer typed after the question is awaited", async () => {
    const input = new PassThrough();
    const prompter = createPrompter(input, new PassThrough());
    const pending = prompter.ask("go?");
    await tick();
    input.write("YES\n");
    assert.equal(await pending, true);
    prompter.close();
  });

  test("no, an empty line, an unknown word and end of input are false; 'Y ' is true", async () => {
    const input = new PassThrough();
    const prompter = createPrompter(input, new PassThrough());
    input.write("no\n\nmaybe\nY \n");
    input.end();
    assert.equal(await prompter.ask("1"), false);
    assert.equal(await prompter.ask("2"), false);
    assert.equal(await prompter.ask("3"), false);
    assert.equal(await prompter.ask("4"), true);
    assert.equal(await prompter.ask("5"), false);
    assert.equal(await prompter.ask("6"), false);
    prompter.close();
  });

  test("end of input with nothing sent answers false without hanging", async () => {
    const input = new PassThrough();
    const prompter = createPrompter(input, new PassThrough());
    input.end();
    assert.equal(await prompter.ask("q?"), false);
    prompter.close();
  });
});

describe("stageHistoryFile", () => {
  test("places history.jsonl in a fresh directory, as a hard link when possible", () => {
    const source = write("g/history.jsonl", '{"a":1}\n');
    const staged = stageHistoryFile(source);
    try {
      const copy = path.join(staged.dir, "history.jsonl");
      assert.equal(fs.readFileSync(copy, "utf8"), '{"a":1}\n');
      assert.notEqual(staged.dir, path.dirname(source));
      assert.equal(fs.lstatSync(copy).isSymbolicLink(), false);
      assert.match(path.basename(staged.dir), /^tmp\.[A-Za-z0-9]+$/);
      if (fs.statSync(copy).nlink > 1) assert.equal(fs.statSync(copy).ino, fs.statSync(source).ino);
    } finally {
      staged.dispose();
    }
    assert.equal(fs.existsSync(staged.dir), false);
    staged.dispose();
    assert.equal(fs.existsSync(source), true);
  });

  test("a missing source throws and leaves no directory behind", () => {
    const before = fs.readdirSync(os.tmpdir()).filter((n) => n.startsWith("tmp.")).length;
    assert.throws(() => stageHistoryFile(path.join(root, "g/absent.jsonl")));
    const afterCount = fs.readdirSync(os.tmpdir()).filter((n) => n.startsWith("tmp.")).length;
    assert.equal(afterCount, before);
  });
});
