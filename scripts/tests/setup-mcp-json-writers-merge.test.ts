// setup-mcp-json-writers-merge.test.ts — the tolerant capture and the merge rules of the MCP
// writers (spec 0256 requirement 27, merge_preexisting_mcp_servers of scripts/lib/common.sh).

import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import type { JsonValue } from "../lib/extension/types.ts";
import {
  backupAndCapture,
  mergePreexistingMcpServers,
  readMcpServers,
  writeAntigravityMcpConfig,
} from "../lib/setup/mcp-json-writers.ts";
import { box, seed, writeJson } from "./lib/mcp-writers-box.ts";

test("antigravity: nothing selected writes an empty mcpServers; a declined reserved name is reported removed", () => {
  const b = box();
  try {
    seed(b.target, { mcpServers: { sequentialthinking: { command: "x" } } });
    const captured = backupAndCapture(b.ctx, b.target);
    b.out.length = 0;
    writeAntigravityMcpConfig({
      ctx: b.ctx,
      entries: { mempalace: undefined, sequentialThinking: undefined },
      writeJson,
      target: b.target,
      captured,
    });
    assert.equal(fs.readFileSync(b.target, "utf8"), '{\n  "mcpServers": {}\n}\n');
    assert.equal(
      b.out[0],
      "  WARNING: 'sequentialthinking' is a framework-managed MCP server — your prior 'sequentialthinking' entry was removed (you declined it).",
    );
    assert.equal(b.out.length, 2);
  } finally {
    fs.rmSync(b.root, { recursive: true, force: true });
  }
});

test("capture is tolerant: absent, invalid, no mcpServers and a non-object all give {}", () => {
  const b = box();
  try {
    assert.deepEqual([...(readMcpServers(b.target) as Map<string, JsonValue>)], []);
    fs.writeFileSync(b.target, "{not json");
    assert.deepEqual([...(readMcpServers(b.target) as Map<string, JsonValue>)], []);
    seed(b.target, { other: 1 });
    assert.deepEqual([...(readMcpServers(b.target) as Map<string, JsonValue>)], []);
    seed(b.target, { mcpServers: null });
    assert.deepEqual([...(readMcpServers(b.target) as Map<string, JsonValue>)], []);
    fs.writeFileSync(b.target, '{"mcpServers":{"2":{"a":1},"b":{},"1":{}}}');
    assert.deepEqual(
      [...(readMcpServers(b.target) as Map<string, JsonValue>).keys()],
      ["2", "b", "1"],
    );
  } finally {
    fs.rmSync(b.root, { recursive: true, force: true });
  }
});

test("merge: the operator wins over a same-named framework entry, in place, and keeps integer-like key order", () => {
  const b = box();
  try {
    const config = new Map<string, JsonValue>([
      [
        "mcpServers",
        new Map<string, JsonValue>([
          ["github", "framework"],
          ["mempalace", new Map()],
        ]),
      ],
    ]);
    const pre = new Map<string, JsonValue>([
      ["2", "two"],
      ["github", "operator"],
      ["1", "one"],
      ["mempalace", "mine"],
    ]);
    const merged = mergePreexistingMcpServers(b.ctx, { servers: pre, backup: "" }, config);
    const servers = merged.get("mcpServers") as Map<string, JsonValue>;
    assert.deepEqual([...servers.keys()], ["github", "mempalace", "2", "1"]);
    assert.equal(servers.get("github"), "operator");
    assert.deepEqual(servers.get("mempalace"), new Map());
    assert.match(b.out[1] ?? "", /backup: \(none\)$/);
    mergePreexistingMcpServers(b.ctx, { servers: "text", backup: "/b" }, config);
    assert.equal(
      b.out.at(-1),
      "  WARNING: pre-existing MCP config could not be parsed — pre-existing declarations are NOT preserved in place; recover them from: /b",
    );
  } finally {
    fs.rmSync(b.root, { recursive: true, force: true });
  }
});
