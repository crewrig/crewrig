// Differential test of the Gemini settings merge (spec 0256 requirements 27 and 31): the pure
// `mergeGeminiSettings` against `gemini_settings_write` of scripts/lib/gemini-settings.sh over a
// fixture matrix: same file bytes, same warning lines on stdout, same return code.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";

import { mergeGeminiSettings, readAndMerge } from "../lib/setup/gemini-settings-merge.ts";
import { bashLibs } from "./lib/bash-libs.ts";
import { REPO, WINDOWS } from "./lib/worktree-fixtures.ts";

const HAS_JQ = spawnSync("jq", ["--version"]).status === 0;
const SKIP = WINDOWS || !HAS_JQ ? "SKIP: needs a POSIX shell and jq" : false;
const SEED_PATH = path.join(REPO, "config", "gemini", "settings.json");
const SEED: unknown = JSON.parse(fs.readFileSync(SEED_PATH, "utf8"));
const FAKE_REPO = "/fake/repo";
const roots: string[] = [];

after(() => {
  for (const root of roots) fs.rmSync(root, { recursive: true, force: true });
});

interface Case {
  readonly name: string;
  /** `undefined`: the file is absent. */
  readonly file: string | undefined;
  readonly py?: string;
  readonly org?: string;
}

const RESERVED_OP =
  '{"mcpServers":{"mempalace":{"command":"x","env":{"TOKEN":"s"}},"github":{"command":"gh"}}}';
const CASES: readonly Case[] = [
  { name: "absent", file: undefined },
  { name: "absent with python", file: undefined, py: "/opt/py/bin/python3" },
  { name: "empty file", file: "" },
  { name: "whitespace only", file: " \n\t\r\n" },
  { name: "comment only", file: "// nothing\n/* here */\n" },
  {
    name: "plain operator keys",
    file: '{"theme":"dark","ui":{"a":1},"general":{"previewFeatures":false}}',
  },
  {
    name: "operator false and null win",
    file: '{"privacy":{"usageStatisticsEnabled":null},"security":false}',
  },
  { name: "line and block comments", file: '{\n // c\n "theme": "x", /* b */ "n": [1,2]\n}\n' },
  { name: "comment markers inside strings", file: '{"u":"http://x/*y*/","hooks":{"c":"a // b"}}' },
  { name: "unclosed block comment", file: '{"a":1}\n/* never closed' },
  { name: "trailing comma is invalid", file: '{"a":1,}' },
  { name: "comment then invalid", file: '{"a":1,} // c' },
  { name: "joined tokens 1/**/2", file: '{"a":1/**/2}' },
  { name: "leading zero number", file: '{"a":01}' },
  { name: "bare top-level array", file: "[1,2]" },
  { name: "top-level number with comment", file: "5 // c" },
  { name: "BOM is rejected", file: '﻿{"a":1}' },
  { name: "not JSON at all", file: "model: x\n" },
  { name: "CRLF document", file: '{\r\n  "a": 1\r\n}\r\n' },
  { name: "integer-like and duplicate keys", file: '{"b":1,"2":2,"1":3,"b":4}' },
  { name: "context.fileName string", file: '{"context":{"fileName":"MINE.md"}}' },
  {
    name: "context.fileName list with overlap",
    file: '{"context":{"fileName":["MINE.md","AGENTS.md","MINE.md"]}}',
  },
  { name: "context.fileName mixed list", file: '{"context":{"fileName":["a",1]}}' },
  { name: "context.fileName number", file: '{"context":{"fileName":7,"other":true}}' },
  { name: "context not an object", file: '{"context":"x"}' },
  { name: "context null", file: '{"context":null}' },
  { name: "mcpServers not an object", file: '{"mcpServers":[1]}' },
  { name: "ancestor not an object", file: '{"security":"off","privacy":[1]}' },
  { name: "operator reserved and custom servers", file: RESERVED_OP },
  { name: "operator reserved, python set", file: RESERVED_OP, py: "/p/py" },
  {
    name: "operator sequentialthinking",
    file: '{"mcpServers":{"sequentialthinking":{"command":"x"},"a":{"command":"a"}}}',
  },
  {
    name: "hooks kept verbatim",
    file: '{"hooks":{"SessionStart":[{"hooks":[{"type":"command","command":"x"}]}]}}',
  },
  { name: "escapes and unicode", file: '{"k":"\\u007f\\u0001\\"\\\\\\/é😀","\\u00e9":1}' },
  { name: "idempotent plain JSON", file: '{"$schema":"https://x//y","a":[]}' },
  {
    name: "org servers, no collision",
    file: '{"mcpServers":{"a":{"command":"a"}}}',
    org: '{"b":{"command":"b"}}',
  },
  {
    name: "org collides with operator",
    file: '{"mcpServers":{"b":{"command":"old"},"a":{"command":"a"}}}',
    org: '{"b":{"command":"new","args":["x"]}}',
  },
  {
    name: "org reserved name",
    file: RESERVED_OP,
    py: "/p/py",
    org: '{"mempalace":{"command":"z"},"sequentialthinking":{"command":"q"},"ok":{"command":"o"}}',
  },
  { name: "org empty object", file: '{"a":1}', org: "{}" },
  { name: "org not an object", file: '{"a":1}', org: "[1]" },
  {
    name: "org keys sorted for warnings",
    file: '{"mcpServers":{"z":{},"a":{},"é":{}}}',
    org: '{"é":{"command":"e"},"z":{"command":"z"},"a":{"command":"a"}}',
  },
];

function normalise(text: string, target: string): string {
  const stamp = /\.bak\.\d{8}-\d{6}(?:\.\d{2})?/g;
  return text.split(target).join("<T>").replace(stamp, ".bak.<STAMP>");
}

function viaShell(c: Case): { bytes: string; stdout: string; rc: number; target: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "crewrig-gs-"));
  roots.push(dir);
  const target = path.join(dir, "settings.json");
  if (c.file !== undefined) fs.writeFileSync(target, c.file);
  const src = path.join(REPO, "scripts", "lib", "gemini-settings.sh");
  const res = bashLibs(
    [
      `source ${JSON.stringify(src)}`,
      `gemini_settings_write ${JSON.stringify(target)} ${JSON.stringify(SEED_PATH)} ${FAKE_REPO} "$PY" "$ORG" `,
      'echo "__RC__$?"',
    ].join("\n"),
    { ...process.env, PY: c.py ?? "", ORG: c.org ?? "" },
  );
  const rcMatch = /__RC__(\d+)\s*$/.exec(res.stdout);
  const stdout = res.stdout.replace(/__RC__\d+\s*$/, "");
  return { bytes: fs.readFileSync(target, "utf8"), stdout, rc: Number(rcMatch?.[1] ?? 99), target };
}

describe("differential against gemini_settings_write", { skip: SKIP }, () => {
  for (const c of CASES) {
    test(c.name, () => {
      const shell = viaShell(c);
      const result = mergeGeminiSettings({
        current: c.file,
        seed: SEED,
        repoDir: FAKE_REPO,
        python: c.py,
        orgNative: c.org,
        target: shell.target,
        backupRef: `${shell.target}.bak.<STAMP>`,
      });
      assert.equal(shell.rc, 0);
      assert.ok(result.ok);
      assert.equal(result.text, shell.bytes);
      const lines = normalise(shell.stdout, shell.target)
        .split("\n")
        .filter((line) => line !== "" && !line.startsWith("  Backed up"));
      assert.deepEqual(
        result.warnings.map((line) => normalise(line, shell.target)),
        lines,
      );
    });
  }
});

describe("the differential is not vacuous", () => {
  test("repair, replacement and org warnings are all produced", () => {
    const warn = (current: string, org?: string): string => {
      const result = mergeGeminiSettings({
        current,
        seed: SEED,
        repoDir: FAKE_REPO,
        orgNative: org,
        target: "/t",
      });
      return result.ok ? result.warnings.join("\n") : "";
    };
    assert.match(warn("{,}"), /not a JSON object/);
    assert.match(warn('{"context":{"fileName":7}}'), /'context.fileName' in \/t is not/);
    assert.match(warn('{"mcpServers":{"mempalace":{}}}'), /was removed \(you declined it\)/);
    assert.match(warn('{"mcpServers":{"b":{}}}', '{"b":{}}'), /org declaration wins/);
  });
});

describe("the commented-settings decision", () => {
  test("a commented file merges, warns, and is written as plain JSON the strict reader accepts", () => {
    const result = mergeGeminiSettings({
      current: '{\n // keep me out\n "theme": "dark"\n}\n',
      seed: SEED,
      repoDir: FAKE_REPO,
      target: "/h/settings.json",
      backupRef: "/h/settings.json.bak.1",
    });
    assert.ok(result.ok);
    assert.equal(result.comments, true);
    assert.match(result.warnings.join("\n"), /holds comments; they are not kept/);
    const strict = JSON.parse(result.text) as { theme?: string };
    assert.equal(strict.theme, "dark");
    assert.ok(!result.text.includes("keep me out"));
  });
});

describe("failures and the file wrapper", () => {
  test("a seed that is not an object fails with code 1 and names the backup", () => {
    const result = mergeGeminiSettings({
      current: "{}",
      seed: "nope",
      repoDir: FAKE_REPO,
      target: "/h/s.json",
      seedPath: "/r/config/gemini/settings.json",
      backupRef: "/h/s.json.bak.1",
    });
    assert.deepEqual(result, {
      ok: false,
      code: 1,
      message:
        "  ERROR: the framework MCP entries could not be built from /r/config/gemini/settings.json; /h/s.json was left unchanged.\n" +
        "         The prior file is preserved in the timestamped backup: /h/s.json.bak.1",
    });
  });

  test("readAndMerge reads an absent file as absent and an unreadable one as code 1", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "crewrig-gs-rm-"));
    roots.push(dir);
    const absent = readAndMerge(path.join(dir, "settings.json"), {
      seed: SEED,
      repoDir: FAKE_REPO,
    });
    assert.ok(absent.ok);
    assert.equal(absent.state, "absent");
    const asDir = readAndMerge(dir, { seed: SEED, repoDir: FAKE_REPO });
    assert.ok(!asDir.ok);
    assert.equal(asDir.code, 1);
    assert.match(asDir.message, /the existing file could not be read/);
  });

  test("a custom wrapper names the stdio command of both reserved entries", () => {
    const result = mergeGeminiSettings({
      current: undefined,
      seed: SEED,
      repoDir: FAKE_REPO,
      python: "py",
      target: "/h/s.json",
      wrap: (words) => ["node", "/h/.crewrig/tls-exec.ts", ...words],
    });
    assert.ok(result.ok);
    const servers = (
      JSON.parse(result.text) as { mcpServers: Record<string, { command: string; args: string[] }> }
    ).mcpServers;
    assert.equal(servers.mempalace?.command, "node");
    assert.deepEqual(servers.mempalace?.args.slice(0, 2), ["/h/.crewrig/tls-exec.ts", "py"]);
    assert.equal(servers.sequentialthinking?.command, "node");
    assert.deepEqual(servers.sequentialthinking?.args.slice(0, 2), [
      "/h/.crewrig/tls-exec.ts",
      "npx",
    ]);
  });
});
