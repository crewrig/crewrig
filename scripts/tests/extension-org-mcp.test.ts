// extension-org-mcp.test.ts — `org_mcp_to_native` and `MCP_RESERVED_NAMES` twins (spec 0254 R3).
//
// Added beside the unchanged Bash suite scripts/tests/test-setup-org-mcp.sh, which keeps its
// assertions. Expected shapes are taken from the jq program of scripts/lib/common.sh:263-310.

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { parseJson } from "../lib/extension/json-ordered.ts";
import { writeJsonCompact } from "../lib/extension/json-write.ts";
import { ExtError } from "../lib/extension/types.ts";
import { MCP_RESERVED_NAMES, orgMcpToNative } from "../lib/org-mcp.ts";

const native = (cli: string, neutral: string): string =>
  writeJsonCompact(orgMcpToNative(cli, parseJson(neutral, "n.json")));

const STDIO = '{"a":{"command":"c","args":["x"],"env":{"K":"V"},"cwd":"/w","timeout":5}}';
const HTTP = '{"r":{"transport":"http","url":"https://h/","headers":{"A":"B"},"timeout":7}}';
const SSE = '{"r":{"transport":"sse","url":"https://h/s"}}';

describe("stdio", () => {
  test("members in the jq order, copilot adds type last", () => {
    const body = '{"a":{"command":"c","args":["x"],"env":{"K":"V"},"cwd":"/w","timeout":5';
    for (const cli of ["gemini", "claude", "antigravity"])
      assert.equal(native(cli, STDIO), `${body}}}`);
    assert.equal(native("copilot", STDIO), `${body},"type":"stdio"}}`);
  });

  test("an absent transport is stdio; a missing command is null; falsy members are dropped", () => {
    assert.equal(native("gemini", '{"a":{"args":false,"env":null}}'), '{"a":{"command":null}}');
    assert.equal(
      native("gemini", '{"a":{"command":"c","args":[],"timeout":0}}'),
      '{"a":{"command":"c","args":[],"timeout":0}}',
    );
    assert.equal(
      native("gemini", '{"a":{"transport":null,"command":"c"}}'),
      '{"a":{"command":"c"}}',
    );
  });
});

describe("remote", () => {
  test("claude and copilot: type then url, headers, timeout", () => {
    for (const cli of ["claude", "copilot"]) {
      assert.equal(
        native(cli, HTTP),
        '{"r":{"type":"http","url":"https://h/","headers":{"A":"B"},"timeout":7}}',
      );
      assert.equal(native(cli, SSE), '{"r":{"type":"sse","url":"https://h/s"}}');
    }
  });

  test("antigravity: serverUrl, no type", () => {
    assert.equal(
      native("antigravity", HTTP),
      '{"r":{"serverUrl":"https://h/","headers":{"A":"B"},"timeout":7}}',
    );
  });

  test("gemini: httpUrl for http, url otherwise, no type", () => {
    assert.equal(
      native("gemini", HTTP),
      '{"r":{"httpUrl":"https://h/","headers":{"A":"B"},"timeout":7}}',
    );
    assert.equal(native("gemini", SSE), '{"r":{"url":"https://h/s"}}');
  });

  test("a missing url is null", () => {
    assert.equal(
      native("claude", '{"r":{"transport":"http"}}'),
      '{"r":{"type":"http","url":null}}',
    );
  });
});

describe("shape of the input", () => {
  test("a value that is not an object reads as the empty object", () => {
    for (const text of ["[]", '"x"', "null", "3"]) assert.equal(native("gemini", text), "{}");
  });

  test("an unknown CLI takes the claude shapes", () => {
    assert.equal(native("other", HTTP), native("claude", HTTP));
  });

  test("a null server is an empty stdio server, as in the shell", () => {
    assert.equal(native("gemini", '{"a":null}'), '{"a":{"command":null}}');
    assert.equal(native("copilot", '{"a":null}'), '{"a":{"command":null,"type":"stdio"}}');
  });

  test("a server that is neither an object nor null is refused", () => {
    assert.throws(() => native("gemini", '{"a":"x"}'), ExtError);
  });

  test("the order of the servers is the order written", () => {
    assert.equal(
      native("gemini", '{"z":{"command":"1"},"10":{"command":"2"}}'),
      '{"z":{"command":"1"},"10":{"command":"2"}}',
    );
  });
});

test("the reserved names are the framework's two", () => {
  assert.deepEqual([...MCP_RESERVED_NAMES], ["mempalace", "sequentialthinking"]);
});
