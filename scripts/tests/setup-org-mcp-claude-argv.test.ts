// setup-org-mcp-claude-argv.test.ts — the `claude mcp add` argv of org-mcp-fold.ts (scripts/lib/setup/org-mcp-fold.ts).

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { describe, it } from "node:test";

import { parseJson } from "../lib/extension/json-ordered.ts";
import { ExtError } from "../lib/extension/types.ts";
import type { JsonValue } from "../lib/extension/types.ts";
import { orgMcpClaudeArgv, orgMcpClaudeArgvs } from "../lib/setup/org-mcp-fold.ts";

const hasJq = spawnSync("jq", ["--version"]).status === 0;
const map = (text: string): Map<string, JsonValue> =>
  parseJson(text, "t") as Map<string, JsonValue>;

describe("orgMcpClaudeArgv", () => {
  it("stdio: --scope user, -e pairs in order, name, --, command, args", () => {
    const entry = map('{"command":"npx","args":["-y","pkg","a b"],"env":{"K":"v","T":"x=y"}}');
    assert.deepEqual(orgMcpClaudeArgv("srv", entry), [
      "--scope",
      "user",
      "-e",
      "K=v",
      "-e",
      "T=x=y",
      "srv",
      "--",
      "npx",
      "-y",
      "pkg",
      "a b",
    ]);
  });

  it("stdio without env and args, and a null entry", () => {
    assert.deepEqual(orgMcpClaudeArgv("s", map('{"command":"c"}')), [
      "--scope",
      "user",
      "s",
      "--",
      "c",
    ]);
    assert.deepEqual(orgMcpClaudeArgv("s", null), ["--scope", "user", "s", "--", "null"]);
  });

  it("http and sse: --transport, name, url, --header pairs", () => {
    assert.deepEqual(
      orgMcpClaudeArgv(
        "r",
        map(
          '{"transport":"http","url":"https://x/mcp","headers":{"Authorization":"Bearer t","X":"1"}}',
        ),
      ),
      [
        "--scope",
        "user",
        "--transport",
        "http",
        "r",
        "https://x/mcp",
        "--header",
        "Authorization: Bearer t",
        "--header",
        "X: 1",
      ],
    );
    assert.deepEqual(orgMcpClaudeArgv("r", map('{"transport":"sse","url":"u"}')), [
      "--scope",
      "user",
      "--transport",
      "sse",
      "r",
      "u",
    ]);
  });

  it("refuses an entry or member of the wrong type (a jq error in the shell)", () => {
    assert.throws(() => orgMcpClaudeArgv("s", "x"), ExtError);
    assert.throws(() => orgMcpClaudeArgv("s", map('{"command":"c","env":{"K":1}}')), ExtError);
    assert.throws(() => orgMcpClaudeArgv("s", map('{"command":"c","args":"x"}')), ExtError);
  });

  it("matches the jq program of org_mcp_to_claude_argv", { skip: !hasJq }, () => {
    const program = `(.transport // "stdio") as $t
      | if $t == "stdio" then
          ([ "--scope", "user" ]
           + ((.env // {}) | to_entries | map([ "-e", (.key + "=" + .value) ]) | add // [])
           + [ $name, "--", .command ]
           + (.args // []))
        else
          ([ "--scope", "user", "--transport", $t, $name, .url ]
           + ((.headers // {}) | to_entries | map([ "--header", (.key + ": " + .value) ]) | add // []))
        end
      | .[]`;
    for (const text of [
      '{"command":"c","args":["a","1"],"env":{"A":"b","C":"d"}}',
      '{"command":"c"}',
      '{"transport":"http","url":"u","headers":{"H":"v"}}',
      '{"transport":"sse","url":"u"}',
    ]) {
      const r = spawnSync("jq", ["-r", "--arg", "name", "n", program], {
        input: text,
        encoding: "utf8",
      });
      assert.deepEqual(orgMcpClaudeArgv("n", map(text)), r.stdout.split("\n").slice(0, -1), text);
    }
  });
});

describe("orgMcpClaudeArgvs", () => {
  it("lists every server in key order, reserved ones flagged without an argv", () => {
    const list = orgMcpClaudeArgvs(
      map('{"b":{"command":"x"},"mempalace":{"command":"y"},"a":{"url":"u","transport":"http"}}'),
    );
    assert.deepEqual(
      list.map((s) => [s.name, s.reserved]),
      [
        ["a", false],
        ["b", false],
        ["mempalace", true],
      ],
    );
    assert.deepEqual(list[2]?.argv, []);
    assert.deepEqual(list[1]?.argv, ["--scope", "user", "b", "--", "x"]);
  });

  it("is empty for an empty manifest", () => assert.deepEqual(orgMcpClaudeArgvs(new Map()), []));
});
