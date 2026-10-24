// setup-org-mcp-wiring.test.ts — the shipped org manifest (spec 0263,
// ported from test-setup-org-mcp.sh group 1 tail; the gemini fold order of group 7 is pinned by
// setup-gemini-settings.test.ts, the shell text it read being gone, spec 0266). Group 6 (the declared sub-step order
// per CLI) is NOT re-asserted: setup-retarget-others.test.ts "org fold per CLI" pins all four pairs.
// Runs on every platform: a JSON read, a text read.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";

import { parseJson } from "../lib/extension/json-ordered.ts";
import type { JsonValue } from "../lib/extension/types.ts";
import { MCP_RESERVED_NAMES, orgMcpToNative } from "../lib/org-mcp.ts";
import { REPO } from "./lib/worktree-fixtures.ts";

const SHIPPED = path.join(REPO, "mcp-servers.org.json");

function strings(value: unknown, into: string[] = []): string[] {
  if (typeof value === "string") into.push(value);
  else if (Array.isArray(value)) for (const v of value) strings(v, into);
  else if (value !== null && typeof value === "object") {
    for (const v of Object.values(value)) strings(v, into);
  }
  return into;
}

// The manifest is org-owned (`excluded` in the layer model): upstream ships it empty, an adopting
// organisation populates it. Emptiness is therefore not asserted of every deployment — a pristine
// template reads to {}, a customised one must stay well-formed (spec 0091, issue #1499).
const CLIS = ["claude", "gemini", "copilot", "antigravity"];

function declaredServers(): Map<string, JsonValue> {
  const doc = parseJson(fs.readFileSync(SHIPPED, "utf8"), "mcp-servers.org.json");
  const servers: JsonValue | undefined = doc instanceof Map ? doc.get("mcpServers") : undefined;
  if (servers === undefined) return new Map<string, JsonValue>();
  assert.ok(servers instanceof Map, ".mcpServers must be an object");
  return servers;
}

describe("the shipped mcp-servers.org.json is a well-formed org channel (R9)", () => {
  test("the file exists (spec 0091 back-fill); empty template or valid org declarations", () => {
    assert.ok(fs.existsSync(SHIPPED), "shipped mcp-servers.org.json missing");
    const servers = declaredServers();
    const names = [...servers.keys()];
    // Pristine upstream template: nothing declared. A customised file: every entry must translate
    // for all four CLIs and none may shadow a framework-reserved server.
    assert.deepEqual(
      names.filter((n) => MCP_RESERVED_NAMES.includes(n)),
      [],
      "an org declaration must not reuse a framework-reserved name",
    );
    if (names.length === 0) return;
    for (const cli of CLIS) {
      assert.deepEqual([...orgMcpToNative(cli, servers).keys()].sort(), [...names].sort(), cli);
    }
  });
  test("no string anywhere in it looks like a literal bearer credential", () => {
    const all = strings(JSON.parse(fs.readFileSync(SHIPPED, "utf8")));
    assert.ok(all.length > 0, "vacuity guard: the walk saw no string");
    const leaks = all.filter((s) => /Bearer [A-Za-z0-9]{12,}/.test(s));
    assert.deepEqual(leaks, []);
  });
});
