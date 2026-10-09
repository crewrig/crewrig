// extension-hooks.test.ts — the hook translator twins (spec 0254 R10): vocabulary, command
// resolution, resolved entries, gaps and the four native envelopes of `ext_hooks_render`.

import assert from "node:assert/strict";
import path from "node:path";
import { describe, test } from "node:test";

import { renderHookFile } from "../lib/extension/hooks-emit.ts";
import { hookGaps, resolveCommand, resolvedEntries } from "../lib/extension/hooks-resolve.ts";
import {
  EXT_HOOKS_KNOWN_EVENTS,
  knownEvents,
  matcherAccepting,
  matcherTool,
  targetEvent,
} from "../lib/extension/hooks-vocab.ts";
import { readTargetTable } from "../lib/extension/descriptors.ts";
import { parseJson } from "../lib/extension/json-ordered.ts";
import { writeJsonCompact } from "../lib/extension/json-write.ts";
import { TARGETS } from "../lib/extension/types.ts";
import type { JsonValue, Target, TargetTable } from "../lib/extension/types.ts";

const table: TargetTable = readTargetTable(path.resolve(import.meta.dirname, "../lib"));

function manifest(text: string): Map<string, JsonValue> {
  const value = parseJson(text, "m.json");
  assert.ok(value instanceof Map);
  return value;
}

const M = manifest(
  JSON.stringify({
    name: "ext",
    hooks: [
      { id: "g", event: "PreToolUse", matcher: "shell", command: "${extensionRoot}/hooks/g.sh" },
      {
        id: "all",
        event: "PreToolUse",
        command: "${extensionRoot}/hooks/all.sh --root ${extensionRoot}",
      },
      { id: "p", event: "UserPromptSubmit", command: "echo hi" },
    ],
  }),
);

describe("vocabulary", () => {
  test("closed sets and mappings", () => {
    assert.deepEqual(knownEvents(), ["PreToolUse", "UserPromptSubmit"]);
    assert.deepEqual([...EXT_HOOKS_KNOWN_EVENTS], knownEvents());
    assert.equal(matcherAccepting("PreToolUse"), true);
    assert.equal(matcherAccepting("UserPromptSubmit"), false);
    assert.equal(targetEvent("PreToolUse", "gemini"), "BeforeTool");
    assert.equal(targetEvent("UserPromptSubmit", "gemini"), "BeforeAgent");
    assert.equal(targetEvent("PreToolUse", "copilot"), "preToolUse");
    assert.equal(targetEvent("UserPromptSubmit", "copilot"), "userPromptSubmitted");
    assert.equal(targetEvent("UserPromptSubmit", "antigravity"), "");
    assert.equal(targetEvent("toString", "claude"), "");
    assert.equal(matcherTool("shell", "claude", table), "Bash");
    assert.equal(matcherTool("zsh", "claude", table), "");
  });
});

describe("resolveCommand", () => {
  test("replaces every token with the target form", () => {
    assert.equal(
      resolveCommand("${extensionRoot}/a ${extensionRoot}/b", "claude", table),
      "${CLAUDE_PLUGIN_ROOT}/a ${CLAUDE_PLUGIN_ROOT}/b",
    );
  });
  test("antigravity removes the token with one slash, then any bare token", () => {
    assert.equal(resolveCommand("${extensionRoot}/hooks/h.sh", "antigravity", table), "hooks/h.sh");
    assert.equal(
      resolveCommand("cd ${extensionRoot}; ${extensionRoot}//x", "antigravity", table),
      "cd ; /x",
    );
    assert.equal(resolveCommand("plain", "antigravity", table), "plain");
  });
  test("replacement patterns in a root token are inert", () => {
    const t: TargetTable = { ...table, gemini: { ...table.gemini, rootToken: "$&$1$$" } };
    assert.equal(resolveCommand("${extensionRoot}/x", "gemini", t), "$&$1$$/x");
  });
});

describe("resolvedEntries and hookGaps", () => {
  test("claude keeps every entry; the match-all form is the empty string", () => {
    assert.deepEqual(resolvedEntries("claude", M, table), [
      {
        event: "PreToolUse",
        hasMatcher: true,
        matcher: "Bash",
        command: "${CLAUDE_PLUGIN_ROOT}/hooks/g.sh",
      },
      {
        event: "PreToolUse",
        hasMatcher: true,
        matcher: "",
        command: "${CLAUDE_PLUGIN_ROOT}/hooks/all.sh --root ${CLAUDE_PLUGIN_ROOT}",
      },
      { event: "UserPromptSubmit", hasMatcher: false, matcher: null, command: "echo hi" },
    ]);
  });
  test("antigravity drops the event without counterpart and records the gap", () => {
    assert.deepEqual(
      resolvedEntries("antigravity", M, table).map((e) => [e.event, e.matcher, e.command]),
      [
        ["PreToolUse", "run_command", "hooks/g.sh"],
        ["PreToolUse", ".*", "hooks/all.sh --root "],
      ],
    );
    assert.deepEqual(hookGaps("antigravity", M, table), {
      warnings: [
        "Warning: hook 'p' declares event 'UserPromptSubmit', which has no counterpart on target 'antigravity'",
      ],
      gaps: [
        {
          subject: "hooks",
          target: "antigravity",
          hook: "p",
          event: "UserPromptSubmit",
          part: "event",
          reason: "neutral event has no counterpart on this target",
        },
      ],
    });
  });
  test("a matcher class without counterpart is a matcher gap and an omitted entry", () => {
    const t: TargetTable = { ...table, copilot: { ...table.copilot, shellTool: "" } };
    assert.deepEqual(
      resolvedEntries("copilot", M, t).map((e) => e.event),
      ["preToolUse", "userPromptSubmitted"],
    );
    const gaps = hookGaps("copilot", M, t);
    assert.deepEqual(gaps.warnings, [
      "Warning: hook 'g' (event 'PreToolUse') declares matcher 'shell', which has no counterpart on target 'copilot'",
    ]);
    assert.deepEqual(gaps.gaps, [
      {
        subject: "hooks",
        target: "copilot",
        hook: "g",
        event: "PreToolUse",
        part: "matcher",
        reason: "neutral matcher class has no counterpart on this target",
      },
    ]);
  });
  test("no hooks array, nothing to do", () => {
    for (const text of ["{}", '{"hooks":null}', '{"hooks":{}}']) {
      assert.deepEqual(resolvedEntries("claude", manifest(text), table), []);
      assert.deepEqual(hookGaps("claude", manifest(text), table), { warnings: [], gaps: [] });
      assert.equal(renderHookFile("claude", manifest(text), table), null);
    }
  });
});

function render(
  target: Target,
  m: Map<string, JsonValue> = M,
): { file: string; json: string } | null {
  const r = renderHookFile(target, m, table);
  return r === null ? null : { file: r.file, json: writeJsonCompact(r.value) };
}

describe("renderHookFile", () => {
  test("claude: grouped by event, matcher omitted when the event has none", () => {
    assert.deepEqual(render("claude"), {
      file: "hooks/hooks.json",
      json:
        '{"hooks":{"PreToolUse":[{"hooks":[{"type":"command","command":"${CLAUDE_PLUGIN_ROOT}/hooks/g.sh"}],"matcher":"Bash"},' +
        '{"hooks":[{"type":"command","command":"${CLAUDE_PLUGIN_ROOT}/hooks/all.sh --root ${CLAUDE_PLUGIN_ROOT}"}],"matcher":""}],' +
        '"UserPromptSubmit":[{"hooks":[{"type":"command","command":"echo hi"}]}]}}',
    });
  });
  test("gemini: native events and tool names", () => {
    const r = render("gemini");
    assert.equal(r?.file, "hooks/hooks.json");
    assert.equal(
      r?.json,
      '{"hooks":{"BeforeTool":[{"hooks":[{"type":"command","command":"${extensionPath}/hooks/g.sh"}],"matcher":"run_shell_command"},' +
        '{"hooks":[{"type":"command","command":"${extensionPath}/hooks/all.sh --root ${extensionPath}"}],"matcher":".*"}],' +
        '"BeforeAgent":[{"hooks":[{"type":"command","command":"echo hi"}]}]}}',
    );
  });
  test("antigravity: named-hook map keyed by the extension name", () => {
    assert.deepEqual(render("antigravity"), {
      file: "hooks.json",
      json:
        '{"ext-hooks":{"PreToolUse":[{"matcher":"run_command","hooks":[{"type":"command","command":"hooks/g.sh"}]},' +
        '{"matcher":".*","hooks":[{"type":"command","command":"hooks/all.sh --root "}]}]}}',
    });
  });
  test("copilot: flat handlers under a versioned envelope", () => {
    assert.deepEqual(render("copilot"), {
      file: "hooks.json",
      json:
        '{"version":1,"disableAllHooks":false,"hooks":{"preToolUse":[{"type":"command","matcher":"bash","command":"${COPILOT_PLUGIN_ROOT}/hooks/g.sh"},' +
        '{"type":"command","matcher":".*","command":"${COPILOT_PLUGIN_ROOT}/hooks/all.sh --root ${COPILOT_PLUGIN_ROOT}"}],' +
        '"userPromptSubmitted":[{"type":"command","command":"echo hi"}]}}',
    });
  });
  test("a pure-gap declaration writes nothing", () => {
    const only = manifest(
      '{"name":"e","hooks":[{"id":"p","event":"UserPromptSubmit","command":"x"}]}',
    );
    assert.equal(render("antigravity", only), null);
    for (const t of TARGETS.filter((x) => x !== "antigravity"))
      assert.notEqual(render(t, only), null);
  });
});
