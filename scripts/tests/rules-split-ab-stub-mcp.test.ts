// Tests of the stub MCP server over JSON-RPC on stdio and of its call log (spec 0308 R10).

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";

import { parseCallLog } from "../lib/rules-split-ab/transcript.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const stub = path.resolve(here, "..", "lib", "rules-split-ab", "stub-mcp.ts");

interface Rpc {
  id: number;
  result: {
    capabilities: { tools?: object };
    tools: Array<{ name: string }>;
    content: Array<{ text: string }>;
    isError?: boolean;
  };
  error: { code: number };
}

function drive(surface: string, scenario: number, requests: object[]) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ab-stub-"));
  const log = path.join(dir, "calls.jsonl");
  const input = requests.map((r) => JSON.stringify(r)).join("\n") + "\n";
  const r = spawnSync(
    process.execPath,
    ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", stub, "--surface", surface],
    {
      input,
      encoding: "utf8",
      env: { ...process.env, AB_CALL_LOG: log, AB_SCENARIO: String(scenario) },
      timeout: 20000,
    },
  );
  const responses = r.stdout
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as Rpc);
  return { r, responses, log, text: fs.existsSync(log) ? fs.readFileSync(log, "utf8") : null };
}
const init = {
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "t", version: "0" },
  },
};
const list = { jsonrpc: "2.0", id: 2, method: "tools/list" };
const call = (id: number, name: string, args: object) => ({
  jsonrpc: "2.0",
  id,
  method: "tools/call",
  params: { name, arguments: args },
});

describe("stub MCP server", () => {
  test("initialize answers with server info and tools capability; notifications get no response", () => {
    const { responses } = drive("mempalace", 1, [
      init,
      { jsonrpc: "2.0", method: "notifications/initialized" },
      list,
    ]);
    assert.equal(responses.length, 2);
    assert.ok(responses[0].result.capabilities.tools);
    assert.equal(responses[0].id, 1);
  });

  test("tools/list exposes the surface's tools only", () => {
    const names = (s: string) =>
      drive(s, 1, [init, list]).responses[1].result.tools.map((t: { name: string }) => t.name);
    assert.ok(names("mempalace").includes("mempalace_search"));
    assert.ok(names("mempalace").includes("mempalace_update_drawer"));
    assert.ok(names("mempalace").includes("mempalace_add_drawer"));
    assert.ok(names("mempalace").includes("mempalace_diary_write"));
    assert.ok(names("obsidian").includes("obsidian_create_note"));
    assert.ok(!names("obsidian").includes("mempalace_search"));
    assert.deepEqual(names("sequentialthinking"), ["sequentialthinking"]);
  });

  test("an empty call log exists after start: valid with zero calls", () => {
    const { text } = drive("mempalace", 1, [init]);
    assert.equal(text, "");
    assert.deepEqual(parseCallLog(text), []);
  });

  test("scenario 1 returns the open [TASK:ongoing] drawer for the handoff search", () => {
    const { responses } = drive("mempalace", 1, [
      init,
      call(2, "mempalace_search", {
        wing: "ab-scratch",
        room: "task-handoff",
        query: "[TASK:ongoing]",
      }),
    ]);
    const text = responses[1].result.content[0].text;
    assert.match(text, /\[TASK:ongoing\]/);
    assert.match(text, /drw-42/);
  });

  test("other scenarios return no drawer", () => {
    const { responses } = drive("mempalace", 3, [
      init,
      call(2, "mempalace_search", {
        wing: "ab-scratch",
        room: "task-handoff",
        query: "[TASK:ongoing]",
      }),
    ]);
    assert.doesNotMatch(responses[1].result.content[0].text, /TASK:ongoing/);
  });

  test("every call is appended to the log with seq, ts, surface, tool and args", () => {
    const { text } = drive("mempalace", 1, [
      init,
      call(2, "mempalace_search", { query: "q" }),
      call(3, "mempalace_update_drawer", { drawer_id: "drw-42", content: "[TASK:checkpoint] x" }),
    ]);
    const log = parseCallLog(text);
    assert.ok(log);
    assert.equal(log.length, 2);
    assert.deepEqual(
      log.map((e) => e.seq),
      [0, 1],
    );
    assert.equal(log[1]?.tool, "mempalace_update_drawer");
    assert.equal(log[1]?.surface, "mempalace");
    assert.equal((log[1]?.args as { content: string }).content, "[TASK:checkpoint] x");
    assert.ok(log[0]?.ts);
  });

  test("an unknown tool is an error result and is still logged", () => {
    const { responses, text } = drive("mempalace", 1, [init, call(2, "nope", {})]);
    assert.equal(responses[1].result.isError, true);
    assert.equal(parseCallLog(text)?.length, 1);
  });

  test("an unknown method answers a JSON-RPC error", () => {
    const { responses } = drive("mempalace", 1, [
      init,
      { jsonrpc: "2.0", id: 9, method: "bogus/method" },
    ]);
    assert.equal(responses[1].error.code, -32601);
  });

  test("the sequentialthinking stub answers and logs", () => {
    const { responses, text } = drive("sequentialthinking", 6, [
      init,
      call(2, "sequentialthinking", {
        thought: "t",
        nextThoughtNeeded: false,
        thoughtNumber: 1,
        totalThoughts: 1,
      }),
    ]);
    assert.ok(responses[1].result.content[0].text.length > 0);
    assert.equal(parseCallLog(text)?.[0]?.surface, "sequentialthinking");
  });

  test("the process exits cleanly at end of input", () => {
    assert.equal(drive("obsidian", 5, [init]).r.status, 0);
  });
});

describe("stub MCP server, scenario 5 vault (delta-02)", () => {
  test("obsidian_list_vaults returns the scratch vault in scenario 5", () => {
    const { responses } = drive("obsidian", 5, [init, call(2, "obsidian_list_vaults", {})]);
    assert.deepEqual(JSON.parse(responses[1].result.content[0].text), [
      { id: "scratch", name: "scratch-vault" },
    ]);
  });
  test("create and edit are recorded with their arguments and succeed", () => {
    const { responses, text } = drive("obsidian", 5, [
      init,
      call(2, "obsidian_create_note", { vault: "scratch", path: "d.md", content: "x" }),
      call(3, "obsidian_edit_note", { vault: "scratch", path: "d.md" }),
    ]);
    assert.match(responses[1].result.content[0].text, /success/);
    const log = parseCallLog(text);
    assert.deepEqual(
      log?.map((e) => e.tool),
      ["obsidian_create_note", "obsidian_edit_note"],
    );
  });
});
