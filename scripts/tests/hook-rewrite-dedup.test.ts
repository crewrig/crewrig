// hook-rewrite-dedup.test.ts — one command per event by the live-path rule
// (spec 0243 R22, v1-F3) and reuse by another descriptor (R25).

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import type { JsonObject } from "../lib/hook-config.ts";
import type { HookDescriptor } from "../lib/hook-descriptor.ts";
import {
  checkout,
  claudeConfig,
  direct,
  legacy,
  run,
  stopCommands,
} from "./lib/hook-rewrite-fixtures.ts";

describe("one command per event by the live-path rule (R22, v1-F3)", () => {
  test("a legacy and a direct twin at the same path end as one direct command", () => {
    const dir = checkout("g");
    const result = run(
      claudeConfig(legacy(dir, "claude-code", "Stop"), direct(dir, "claude-code", "Stop")),
    );
    assert.deepEqual(stopCommands(result.config), [direct(dir, "claude-code", "Stop")]);
    assert.equal(result.dropped, 1);
    assert.equal(result.changed, true);
  });

  test("the first live one survives; a vanished first is dropped in favour of a live second", () => {
    const dir = checkout("h");
    const gone = "/nonexistent-crewrig/hooks";
    const result = run(
      claudeConfig(direct(gone, "claude-code", "Stop"), legacy(dir, "claude-code", "Stop")),
    );
    assert.deepEqual(stopCommands(result.config), [direct(dir, "claude-code", "Stop")]);
  });

  test("with only unresolvable and vanished ones, the unresolvable one is kept", () => {
    const result = run(
      claudeConfig(
        direct("/nonexistent-crewrig/hooks", "claude-code", "Stop"),
        'node "$CLAUDE_PROJECT_DIR/hooks/usage-capture.ts" claude-code Stop',
      ),
    );
    assert.deepEqual(stopCommands(result.config), [
      'node "$CLAUDE_PROJECT_DIR/hooks/usage-capture.ts" claude-code Stop',
    ]);
  });

  test("a group that only held a dropped duplicate is pruned; other groups survive", () => {
    const dir = checkout("i");
    const input: JsonObject = {
      hooks: {
        Stop: [
          {
            matcher: "",
            hooks: [{ type: "command", command: direct(dir, "claude-code", "Stop") }],
          },
          {
            matcher: "x",
            hooks: [{ type: "command", command: legacy(dir, "claude-code", "Stop") }],
          },
          { matcher: "y", hooks: [{ type: "command", command: "/opt/operator/a.sh" }] },
        ],
      },
    };
    const groups = (run(input).config["hooks"] as { Stop: { matcher: string }[] }).Stop;
    assert.deepEqual(
      groups.map((g) => g.matcher),
      ["", "y"],
    );
  });

  test("the flat shape collapses too", () => {
    const dir = checkout("j");
    const input: JsonObject = {
      hooks: {
        agentStop: [
          { type: "command", command: legacy(dir, "copilot-cli", "agentStop") },
          { type: "command", command: "/opt/operator/n.sh" },
          { type: "command", command: direct(dir, "copilot-cli", "agentStop") },
        ],
      },
    };
    const list = (run(input, "copilot").config["hooks"] as { agentStop: { command: string }[] })
      .agentStop;
    assert.deepEqual(
      list.map((h) => h.command),
      [direct(dir, "copilot-cli", "agentStop"), "/opt/operator/n.sh"],
    );
  });

  test("dedupEvents restricts the collapse to the named events", () => {
    const dir = checkout("k");
    const input = claudeConfig(
      direct(dir, "claude-code", "Stop"),
      direct(dir, "claude-code", "Stop"),
    );
    assert.equal(
      stopCommands(run(input, "claude", { dedupEvents: ["SessionEnd"] }).config).length,
      2,
    );
    assert.equal(stopCommands(run(input, "claude", { dedupEvents: ["Stop"] }).config).length, 1);
  });
});

describe("another descriptor changes no mechanism (R25)", () => {
  const FIXTURE: HookDescriptor = {
    id: "worktree-guard-fixture",
    basename: "fixture-guard",
    cliIds: { claude: "c", gemini: "g", copilot: "p" },
    args: (_cli, event) => [event],
    argsPattern: "\\s+[A-Za-z]+\\s*",
  };

  test("a different basename and argument shape are rewritten, capture commands are not", () => {
    const dir = checkout("m", { basename: "fixture-guard" });
    const capture = legacy(dir, "claude-code", "Stop", "fixture-guard").replace(" claude-code", "");
    const input = claudeConfig(capture, `bash "${dir}/usage-capture.sh" claude-code Stop`);
    const result = run(input, "claude", { descriptor: FIXTURE });
    assert.deepEqual(stopCommands(result.config), [
      `node "${dir}/fixture-guard.ts" Stop`,
      `bash "${dir}/usage-capture.sh" claude-code Stop`,
    ]);
    assert.equal(result.rewrote, 1);
  });
});

describe("robustness", () => {
  test("a config without hooks, or with non-array events, is returned unchanged", () => {
    for (const input of [
      {},
      { hooks: 3 },
      { hooks: { Stop: "nope" } },
      { hooks: { Stop: [null, 1, { hooks: "x" }] } },
    ] as JsonObject[]) {
      const result = run(input);
      assert.equal(result.changed, false);
      assert.deepEqual(result.config, input);
    }
  });
});
