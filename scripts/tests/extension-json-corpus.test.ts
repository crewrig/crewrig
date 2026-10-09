// extension-json-corpus.test.ts — the JSON writer against the real `jq` (spec 0254 R12, R22).
//
// Linux and macOS only: it spawns `jq` on purpose, and skips with a message where `jq` is
// absent or on Windows. It retires with the last `jq`-based suite. Every JSON file the
// builders read is written back through the reader and the writer and compared with
// `jq . <file>` byte for byte; the awkward shapes of the corpus are generated here, so
// no fixture file is needed. Differences are allowed only for numbers (deviation 28(d)).

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";

import { parseJson } from "../lib/extension/json-ordered.ts";
import { writeJsonText } from "../lib/extension/json-write.ts";

const REPO = path.resolve(import.meta.dirname, "..", "..");
const jqProbe =
  process.platform === "win32" ? null : spawnSync("jq", ["--version"], { encoding: "utf8" });
const skip =
  jqProbe === null || jqProbe.status !== 0 ? "jq is not available on this machine" : false;

const work = fs.mkdtempSync(path.join(os.tmpdir(), "ext-json-corpus-"));
after(() => fs.rmSync(work, { recursive: true, force: true }));

function jq(file: string): string {
  const run = spawnSync("jq", [".", file], { encoding: "utf8" });
  assert.equal(run.status, 0, run.stderr);
  return run.stdout;
}

function ours(file: string): string {
  return writeJsonText(parseJson(fs.readFileSync(file, "utf8"), file));
}

function jsonFilesUnder(dir: string): string[] {
  const out: string[] = [];
  const walk = (current: string): void => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name === ".git") continue;
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(".json")) out.push(full);
    }
  };
  if (fs.existsSync(dir)) walk(dir);
  return out;
}

describe("every JSON file the builders read", { skip }, () => {
  const files = [
    ...jsonFilesUnder(path.join(REPO, "extensions")),
    ...jsonFilesUnder(path.join(REPO, "extension-skeleton")),
    ...fs
      .readdirSync(path.join(REPO, "scripts", "lib"))
      .filter((name) => name.startsWith("extension-") && name.endsWith(".json"))
      .map((name) => path.join(REPO, "scripts", "lib", name)),
  ];
  test("the corpus is not empty", () =>
    assert.ok(files.length >= 5, `found ${files.length} files`));
  for (const file of files) {
    test(path.relative(REPO, file), () => assert.equal(ours(file), jq(file)));
  }
});

describe("the awkward shapes", { skip }, () => {
  const shapes: Record<string, string> = {
    "integer-like keys": '{"b":1,"2":2,"1":3,"10":4}',
    "duplicate keys": '{"a":1,"b":2,"a":3}',
    escapes: '{"s":"\\"\\\\\\/\\b\\f\\n\\r\\t"}',
    "controls and DEL": '{"s":"\\u0001\\u001f\\u007f"}',
    "non-ASCII": '{"s":"é\\u2028😀 \\ud83d\\ude00"}',
    "empty containers": '{"a":[],"b":{},"c":[[],{}]}',
    numbers: "[0,1,-1,1.5,-0.25,100,12345678901234,3.14159]",
    nesting: '[[[[[[[[[[{"a":[1,[2,[3]]]}]]]]]]]]]]',
    "byte-order mark": '﻿{"a":1}',
    CRLF: '{\r\n"a": 1,\r\n"b": [\r\n2\r\n]\r\n}\r\n',
    "scalar document": '"text"',
  };
  for (const [label, text] of Object.entries(shapes)) {
    test(label, () => {
      const file = path.join(work, `${label.replace(/\W+/g, "-")}.json`);
      fs.writeFileSync(file, text);
      assert.equal(ours(file), jq(file));
    });
  }
});
