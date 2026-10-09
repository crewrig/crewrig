// extension-validate.test.ts — the per-CLI, hook and MCP validators (spec 0254 R9).
// Expected lines are the literal text of scripts/lib/extension-manifest.sh and extension-hooks.sh.

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { parseJson } from "../lib/extension/json-ordered.ts";
import { validateHooks } from "../lib/extension/validate-hooks.ts";
import {
  validateMcpNames,
  validateMcpShape,
  validateMcpTokens,
} from "../lib/extension/validate-mcp.ts";
import { validatePerCli } from "../lib/extension/validate-percli.ts";
import type { JsonValue } from "../lib/extension/types.ts";

const P = "m.json";
const H = `VALIDATION-ERROR: ${P} —`;

function manifest(text: string): Map<string, JsonValue> {
  const value = parseJson(text, P);
  assert.ok(value instanceof Map);
  return value;
}

describe("validatePerCli", () => {
  const allowed = ["gemini.settings", "claude.hooks"];
  test("clean and absent sections", () => {
    assert.deepEqual(
      validatePerCli(P, manifest('{"gemini":{"settings":1}}'), "a.json", allowed),
      [],
    );
    assert.deepEqual(
      validatePerCli(P, manifest('{"gemini":null,"claude":false}'), "a.json", allowed),
      [],
    );
  });
  test("sorted keys, one line per inadmissible key", () => {
    const m = manifest('{"claude":{"zeta":1,"alpha":2,"hooks":3},"gemini":{"x":1}}');
    assert.deepEqual(validatePerCli(P, m, "a.json", allowed), [
      `${H} inadmissible per-CLI key 'gemini.x' (not in a.json)`,
      `${H} inadmissible per-CLI key 'claude.alpha' (not in a.json)`,
      `${H} inadmissible per-CLI key 'claude.zeta' (not in a.json)`,
    ]);
  });
  test("a non-object section is skipped, an array lists its indices", () => {
    assert.deepEqual(
      validatePerCli(P, manifest('{"gemini":"s","claude":4}'), "a.json", allowed),
      [],
    );
    assert.deepEqual(validatePerCli(P, manifest('{"copilot":[1]}'), "a.json", allowed), [
      `${H} inadmissible per-CLI key 'copilot.0' (not in a.json)`,
    ]);
  });
});

describe("validateHooks", () => {
  test("absent or null section is valid", () => {
    assert.deepEqual(validateHooks(P, manifest("{}")), []);
    assert.deepEqual(validateHooks(P, manifest('{"hooks":null}')), []);
  });
  test("not an array", () => {
    assert.deepEqual(validateHooks(P, manifest('{"hooks":{}}')), [
      `${H} the generic 'hooks' section must be an array of hook entries`,
    ]);
  });
  test("clean entries", () => {
    const m = manifest(
      '{"hooks":[{"id":"a.b_c-1","event":"PreToolUse","command":"x","matcher":"shell"},{"id":"u","event":"UserPromptSubmit","command":"y"}]}',
    );
    assert.deepEqual(validateHooks(P, m), []);
  });
  test("missing fields and bad values", () => {
    const m = manifest(
      '{"hooks":[{},{"id":"bad id","event":"Nope","command":"c"},{"id":"ok","event":"PreToolUse","command":"c","matcher":"zsh"},{"id":"w","event":"UserPromptSubmit","command":"c","matcher":"shell"},"str",{"id":"e","event":"PreToolUse","command":"c","matcher":""}]}',
    );
    assert.deepEqual(validateHooks(P, m), [
      `${H} hooks[0] is missing required field 'id'`,
      `${H} hooks[0] (id '') is missing required field 'event'`,
      `${H} hooks[0] (id '') is missing required field 'command'`,
      `${H} hooks[1].id 'bad id' must match ^[A-Za-z0-9._-]+$`,
      `${H} hooks[1] (id 'bad id') declares event 'Nope', outside the admissible set {PreToolUse, UserPromptSubmit}`,
      `${H} hooks[2] (id 'ok') declares matcher 'zsh', outside the admissible set {shell}`,
      `${H} hooks[3] (id 'w') declares a matcher on event 'UserPromptSubmit', which accepts none`,
      `${H} hooks[4] is missing required field 'id'`,
      `${H} hooks[4] (id '') is missing required field 'event'`,
      `${H} hooks[4] (id '') is missing required field 'command'`,
      `${H} hooks[5] (id 'e') declares matcher '', outside the admissible set {shell}`,
    ]);
  });
});

describe("validateMcpShape", () => {
  test("absent, null and clean", () => {
    assert.deepEqual(validateMcpShape(P, manifest("{}")), []);
    assert.deepEqual(validateMcpShape(P, manifest('{"mcpServers":null}')), []);
    const ok =
      '{"mcpServers":{"a":{"command":"c","args":[],"cwd":"/","timeout":1},"b":{"transport":"http","url":"u","headers":{}}}}';
    assert.deepEqual(validateMcpShape(P, manifest(ok)), []);
  });
  test("not an object", () => {
    assert.deepEqual(validateMcpShape(P, manifest('{"mcpServers":[]}')), [
      `${H} the generic 'mcpServers' section must be an object keyed by server name`,
    ]);
  });
  test("transport, missing fields and inadmissible keys, in sorted name order", () => {
    const m = manifest(
      '{"mcpServers":{"z":{"transport":"ws"},"a":{"trust":true},"m":{"transport":"sse","command":"c"},"n":null,"s":"str"}}',
    );
    assert.deepEqual(validateMcpShape(P, m), [
      `${H} mcpServers.a (transport stdio) is missing a non-empty 'command'`,
      `${H} mcpServers.a (transport stdio) declares inadmissible key 'trust' (admissible: transport, command, args, env, cwd, timeout)`,
      `${H} mcpServers.m (transport sse) is missing a non-empty 'url'`,
      `${H} mcpServers.m (transport sse) declares inadmissible key 'command' (admissible: transport, url, headers, timeout)`,
      `${H} mcpServers.n (transport stdio) is missing a non-empty 'command'`,
      `${H} mcpServers.s declares transport '', outside the admissible set {stdio, http, sse}`,
      `${H} mcpServers.z declares transport 'ws', outside the admissible set {stdio, http, sse}`,
    ]);
  });
  test("an empty command is missing", () => {
    assert.deepEqual(validateMcpShape(P, manifest('{"mcpServers":{"a":{"command":""}}}')), [
      `${H} mcpServers.a (transport stdio) is missing a non-empty 'command'`,
    ]);
  });
});

describe("validateMcpNames", () => {
  const m = manifest('{"name":"ext","mcpServers":{"mempalace":{},"mine":{}}}');
  test("fails closed on an empty or malformed set", () => {
    const line = `${H} the framework-reserved MCP name set is empty or malformed; refusing to validate mcpServers.* against it (fail-closed)`;
    assert.deepEqual(validateMcpNames(P, m, []), [line]);
    assert.deepEqual(validateMcpNames(P, m, "mempalace"), [line]);
    assert.deepEqual(validateMcpNames(P, manifest("{}"), undefined), [line]);
  });
  test("names a reserved server and the extension", () => {
    assert.deepEqual(validateMcpNames(P, m, ["mempalace", "sequentialthinking"]), [
      `${H} extension 'ext' declares MCP server 'mempalace', a framework-reserved name; choose a name outside the reserved set`,
    ]);
    assert.deepEqual(validateMcpNames(P, manifest('{"mcpServers":{"x":{}}}'), ["x"]), [
      `${H} extension '?' declares MCP server 'x', a framework-reserved name; choose a name outside the reserved set`,
    ]);
    assert.deepEqual(validateMcpNames(P, manifest("{}"), ["x"]), []);
  });
});

describe("validateMcpTokens", () => {
  test("command, args and cwd admit only the neutral root token", () => {
    const m = manifest(
      '{"mcpServers":{"a":{"command":"${extensionRoot}/bin","args":["${extensionPath}","${HOME}/x ${extensionRoot}"],"cwd":"${/}"}}}',
    );
    const tail =
      "inside command/args/cwd; the only admissible path token there is ${extensionRoot}";
    assert.deepEqual(validateMcpTokens(P, m), [
      `${H} mcpServers.a declares '\${extensionPath}' ${tail}`,
      `${H} mcpServers.a declares '\${HOME}' ${tail}`,
      `${H} mcpServers.a declares '\${/}' ${tail}`,
    ]);
  });
  test("env and headers refuse only the five known path tokens", () => {
    const m = manifest(
      '{"mcpServers":{"a":{"command":"c","env":{"K":"${API_KEY}","R":"${extensionRoot}","P":"${CLAUDE_PLUGIN_ROOT}"}},"b":{"transport":"http","url":"u","headers":{"X":"${/} ${COPILOT_PLUGIN_ROOT}","Y":"${extensionPath}"}}}}',
    );
    const tail = "inside an env/headers value; a path token has no path to resolve against there";
    assert.deepEqual(validateMcpTokens(P, m), [
      `${H} mcpServers.a declares path token '\${extensionRoot}' ${tail}`,
      `${H} mcpServers.a declares path token '\${CLAUDE_PLUGIN_ROOT}' ${tail}`,
      `${H} mcpServers.b declares path token '\${/}' ${tail}`,
      `${H} mcpServers.b declares path token '\${COPILOT_PLUGIN_ROOT}' ${tail}`,
      `${H} mcpServers.b declares path token '\${extensionPath}' ${tail}`,
    ]);
  });
  test("tokens split across lines are not matched; absent section is clean", () => {
    assert.deepEqual(
      validateMcpTokens(P, manifest('{"mcpServers":{"a":{"command":"${a\\nb}"}}}')),
      [],
    );
    assert.deepEqual(validateMcpTokens(P, manifest("{}")), []);
  });
  test("a non-array args silences the whole command check, as the jq failure does", () => {
    assert.deepEqual(
      validateMcpTokens(P, manifest('{"mcpServers":{"a":{"command":"${x}","args":"s"}}}')),
      [],
    );
  });
});
