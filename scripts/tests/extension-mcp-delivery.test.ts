// extension-mcp-delivery.test.ts — `ext_mcp_delivery` and `ext_mcp_native` twins (spec 0254 R11).

import assert from "node:assert/strict";
import path from "node:path";
import { describe, test } from "node:test";

import { readTargetTable } from "../lib/extension/descriptors.ts";
import { parseJson } from "../lib/extension/json-ordered.ts";
import { writeJsonCompact } from "../lib/extension/json-write.ts";
import { mcpDelivery, mcpNative } from "../lib/extension/mcp-delivery.ts";
import type { JsonValue, Target, TargetTable } from "../lib/extension/types.ts";

const table: TargetTable = readTargetTable(path.resolve(import.meta.dirname, "../lib"));

function native(target: Target, text: string): string {
  const m = parseJson(text, "m.json");
  assert.ok(m instanceof Map);
  return writeJsonCompact(mcpNative(target, m as Map<string, JsonValue>, table));
}

const M =
  '{"mcpServers":{"a":{"command":"${extensionRoot}/run","args":["${extensionRoot}","x${extensionRoot}y${extensionRoot}"],"env":{"K":"${extensionRoot}"},"cwd":"${extensionRoot}"}}}';

describe("mcpDelivery", () => {
  test("reads the descriptor column", () => {
    for (const t of ["gemini", "claude", "copilot", "antigravity"] as const) {
      assert.equal(mcpDelivery(t, table), true);
    }
    const off: TargetTable = { ...table, claude: { ...table.claude, mcpDelivery: false } };
    assert.equal(mcpDelivery("claude", off), false);
  });
});

describe("mcpNative", () => {
  test("rewrites every string leaf with the target's root token", () => {
    assert.equal(
      native("claude", M),
      '{"a":{"command":"${CLAUDE_PLUGIN_ROOT}/run","args":["${CLAUDE_PLUGIN_ROOT}","x${CLAUDE_PLUGIN_ROOT}y${CLAUDE_PLUGIN_ROOT}"],"env":{"K":"${CLAUDE_PLUGIN_ROOT}"},"cwd":"${CLAUDE_PLUGIN_ROOT}"}}',
    );
    assert.match(native("gemini", M), /^\{"a":\{"command":"\$\{extensionPath\}\/run"/);
  });
  test("antigravity leaves the token unresolved", () => {
    assert.match(native("antigravity", M), /"command":"\$\{extensionRoot\}\/run"/);
  });
  test("keys are untouched and replacement text is inert", () => {
    const m = parseJson(
      '{"mcpServers":{"${extensionRoot}":{"command":"${extensionRoot}"}}}',
      "m.json",
    );
    assert.ok(m instanceof Map);
    const inert: TargetTable = { ...table, claude: { ...table.claude, rootToken: "$&-$1" } };
    assert.equal(
      writeJsonCompact(mcpNative("claude", m as Map<string, JsonValue>, inert)),
      '{"${extensionRoot}":{"command":"$&-$1"}}',
    );
  });
  test("absent, null and false sections give the empty map", () => {
    for (const text of ["{}", '{"mcpServers":null}', '{"mcpServers":false}']) {
      assert.equal(native("claude", text), "{}");
    }
  });
});
