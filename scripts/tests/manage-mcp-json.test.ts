// manage-mcp-json.test.ts — tests of scripts/lib/manage/mcp-json.ts, the twin of the jq
// merge of manage-{copilot,antigravity,workspace}-component.sh (spec 0255 R8).

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";

import { ExtError } from "../lib/extension/types.ts";
import type { Io } from "../lib/extension/types.ts";
import { INITIAL_MCP_CONFIG, INITIAL_SETTINGS, mergeJsonEntry } from "../lib/manage/mcp-json.ts";

let work: string;
let n = 0;
const lines: string[] = [];
const io: Io = { out: (l) => lines.push(l), err: () => {}, errRaw: () => {} };

before(() => {
  work = fs.mkdtempSync(path.join(os.tmpdir(), "manage-mcp-json-"));
});
after(() => {
  fs.rmSync(work, { recursive: true, force: true });
});

function fixture(declaration: string, config?: string) {
  const dir = path.join(work, `case-${n++}`);
  fs.mkdirSync(dir, { recursive: true });
  const declFile = path.join(dir, "playwright.json");
  fs.writeFileSync(declFile, declaration);
  const configFile = path.join(dir, "home", ".copilot", "mcp-config.json");
  if (config !== undefined) {
    fs.mkdirSync(path.dirname(configFile), { recursive: true });
    fs.writeFileSync(configFile, config);
  }
  lines.length = 0;
  return { declFile, configFile };
}

describe("mergeJsonEntry", () => {
  test("creates the config with the empty mcpServers object, then merges and prints Merged", () => {
    const { declFile, configFile } = fixture('{"command":"npx","args":["-y","x"]}');
    mergeJsonEntry({ declFile, configFile, key: "mcpServers", initial: INITIAL_MCP_CONFIG }, io);
    assert.equal(
      fs.readFileSync(configFile, "utf8"),
      '{\n  "mcpServers": {\n    "playwright": {\n      "command": "npx",\n      "args": [\n        "-y",\n        "x"\n      ]\n    }\n  }\n}\n',
    );
    assert.equal(fs.readFileSync(`${configFile}.bak`, "utf8"), INITIAL_MCP_CONFIG);
    assert.deepEqual(lines, ["  Merged: playwright into mcpServers"]);
  });

  test("a missing settings.json starts from {} and gains the key last", () => {
    const { declFile, configFile } = fixture('{"command":"c"}');
    mergeJsonEntry({ declFile, configFile, key: "mcpServers", initial: INITIAL_SETTINGS }, io);
    assert.equal(fs.readFileSync(`${configFile}.bak`, "utf8"), "{}\n");
    assert.equal(
      fs.readFileSync(configFile, "utf8"),
      '{\n  "mcpServers": {\n    "playwright": {\n      "command": "c"\n    }\n  }\n}\n',
    );
  });

  test("keeps the key order, replaces an entry in place and appends a new one; .bak is the old file", () => {
    const old = '{"theme":"dark","mcpServers":{"b":1,"playwright":{"old":true},"a":2},"z":[]}';
    const { declFile, configFile } = fixture('{"command":"c"}', old);
    mergeJsonEntry({ declFile, configFile, key: "mcpServers", initial: INITIAL_SETTINGS }, io);
    assert.equal(fs.readFileSync(`${configFile}.bak`, "utf8"), old);
    const out = fs.readFileSync(configFile, "utf8");
    assert.deepEqual(
      [...out.matchAll(/^ {2,4}"([^"]+)":/gm)].map((m) => m[1]),
      ["theme", "mcpServers", "b", "playwright", "a", "z"],
    );
    assert.match(out, /"playwright": \{\n {6}"command": "c"\n {4}\}/);
  });

  test("a key that is absent, null or false reads as {}; the workspace themes key works too", () => {
    for (const config of ['{"themes":null}', '{"themes":false}', '{"other":1}', "null"]) {
      const { declFile, configFile } = fixture('{"name":"x"}', config);
      mergeJsonEntry({ declFile, configFile, key: "themes", initial: INITIAL_SETTINGS }, io);
      assert.match(fs.readFileSync(configFile, "utf8"), /"themes": \{\n {4}"playwright": \{/);
      assert.equal(lines.at(-1), "  Merged: playwright into themes");
    }
  });

  test("integer-like keys keep their position (no JSON.parse reordering)", () => {
    const { declFile, configFile } = fixture(
      '{"command":"c"}',
      '{"mcpServers":{"b":1,"2":2,"1":3}}',
    );
    mergeJsonEntry({ declFile, configFile, key: "mcpServers", initial: INITIAL_SETTINGS }, io);
    assert.match(
      fs.readFileSync(configFile, "utf8"),
      /"b": 1,\n {4}"2": 2,\n {4}"1": 3,\n {4}"playwright"/,
    );
  });

  test("a declaration that is not JSON fails with the file name and leaves the config untouched", () => {
    const { declFile, configFile } = fixture("{not json", '{"mcpServers":{}}');
    assert.throws(
      () =>
        mergeJsonEntry({ declFile, configFile, key: "mcpServers", initial: INITIAL_SETTINGS }, io),
      (error: unknown) =>
        error instanceof ExtError && error.message.startsWith(`${declFile} is not valid JSON`),
    );
    assert.equal(fs.readFileSync(configFile, "utf8"), '{"mcpServers":{}}');
    assert.deepEqual(lines, []);
  });

  test("a config that is not JSON, or whose key is not an object, fails and is left untouched", () => {
    for (const config of ["{oops", "[1]", '{"mcpServers":[1]}']) {
      const { declFile, configFile } = fixture('{"command":"c"}', config);
      assert.throws(
        () =>
          mergeJsonEntry(
            { declFile, configFile, key: "mcpServers", initial: INITIAL_SETTINGS },
            io,
          ),
        ExtError,
      );
      assert.equal(fs.readFileSync(configFile, "utf8"), config);
    }
  });
});
