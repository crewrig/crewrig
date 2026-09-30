// hook-rewrite.test.ts — tests for scripts/lib/hook-rewrite.ts (spec 0243 R19,
// R21; the one-command-per-event rule R22, v1-F3 and the reuse R25 are in
// hook-rewrite-dedup.test.ts).

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import type { JsonObject } from "../lib/hook-config.ts";
import {
  checkout,
  claudeConfig,
  direct,
  legacy,
  run,
  stopCommands,
} from "./lib/hook-rewrite-fixtures.ts";

describe("legacy → direct (R19)", () => {
  test("grouped shape: only the command changes; selector, key order and every other entry are kept", () => {
    const dir = checkout("a");
    const input = claudeConfig(legacy(dir, "claude-code", "Stop"));
    const before = JSON.stringify(input);
    const result = run(input);
    assert.equal(JSON.stringify(input), before, "the input is not mutated");
    assert.deepEqual(stopCommands(result.config), [direct(dir, "claude-code", "Stop")]);
    assert.equal(result.rewrote, 1);
    assert.equal(result.changed, true);
    assert.equal(
      JSON.stringify(result.config).replace(
        direct(dir, "claude-code", "Stop").replaceAll('"', '\\"'),
        "@",
      ),
      JSON.stringify(input).replace(legacy(dir, "claude-code", "Stop").replaceAll('"', '\\"'), "@"),
      "the config is identical but for the command",
    );
  });

  test("the flat Copilot shape keeps the `command` key and its neighbours", () => {
    const dir = checkout("b");
    const input: JsonObject = {
      version: 1,
      hooks: {
        agentStop: [
          {
            type: "command",
            command: legacy(dir, "copilot-cli", "agentStop"),
            timeoutSec: 30,
            comment: "x",
          },
        ],
      },
    };
    const result = run(input, "copilot");
    const hooks = result.config["hooks"] as { agentStop: Record<string, unknown>[] };
    assert.deepEqual(Object.keys(hooks.agentStop[0] ?? {}), [
      "type",
      "command",
      "timeoutSec",
      "comment",
    ]);
    assert.equal(hooks.agentStop[0]?.["command"], direct(dir, "copilot-cli", "agentStop"));
    assert.equal(hooks.agentStop[0]?.["timeoutSec"], 30);
  });

  test("a Gemini handler keeps its name", () => {
    const dir = checkout("c");
    const input: JsonObject = {
      hooks: {
        AfterModel: [
          {
            hooks: [
              {
                type: "command",
                name: "usage-capture-agent-response",
                command: `bash ${dir}/usage-capture.sh gemini-cli AfterModel`,
              },
            ],
          },
        ],
      },
    };
    const result = run(input, "gemini");
    const group = (result.config["hooks"] as { AfterModel: { hooks: Record<string, string>[] }[] })
      .AfterModel[0];
    assert.equal(group?.hooks[0]?.["name"], "usage-capture-agent-response");
    assert.equal(group?.hooks[0]?.["command"], direct(dir, "gemini-cli", "AfterModel"));
  });

  test("an interpreter-only prefix of the legacy form is dropped: the direct form carries none (R16)", () => {
    const dir = checkout("d");
    const result = run(claudeConfig(`sh "${dir}/usage-capture.sh" claude-code Stop`));
    assert.deepEqual(stopCommands(result.config), [direct(dir, "claude-code", "Stop")]);
  });
});

describe("idempotence (R22)", () => {
  test("a second run over the result changes nothing", () => {
    const dir = checkout("e");
    const first = run(claudeConfig(legacy(dir, "claude-code", "Stop")));
    const second = run(first.config);
    assert.equal(second.changed, false);
    assert.equal(second.rewrote, 0);
    assert.deepEqual(second.config, first.config);
    assert.ok(
      second.lines.every((l) => l.kind === "left" && l.detail.includes("already the direct form")),
    );
  });
});

describe("only where the target exists (R21)", () => {
  test("a legacy command of a checkout without the .ts is left, with the reason", () => {
    const dir = checkout("old", { ts: false });
    const input = claudeConfig(legacy(dir, "claude-code", "Stop"));
    const result = run(input);
    assert.equal(result.changed, false);
    assert.deepEqual(result.config, input);
    assert.equal(result.left, 1);
    assert.ok(
      result.lines[0]?.detail.includes("no .ts next to the registered .sh"),
      result.lines[0]?.detail,
    );
  });

  test("another checkout that has the .ts is rewritten to ITS .ts", () => {
    const other = checkout("other");
    const result = run(claudeConfig(legacy(other, "claude-code", "Stop")));
    assert.deepEqual(stopCommands(result.config), [direct(other, "claude-code", "Stop")]);
  });

  test("a vanished path and an expandable path are left", () => {
    const input = claudeConfig(
      'bash "/nonexistent-crewrig/hooks/usage-capture.sh" claude-code Stop',
    );
    assert.equal(run(input).changed, false);
    const tokenised = claudeConfig(
      'bash "$CLAUDE_PROJECT_DIR/hooks/usage-capture.sh" claude-code Stop',
    );
    const result = run(tokenised);
    assert.equal(result.changed, false);
    assert.ok(result.lines[0]?.detail.includes("cannot be resolved"), result.lines[0]?.detail);
  });

  test(
    "an unsafe checkout path is left with the refusal",
    { skip: process.platform === "win32" },
    () => {
      // A backslash survives in a POSIX path and would collapse inside the quotes (v1-F1).
      const dir = checkout("a\\b");
      const result = run(claudeConfig(legacy(dir, "claude-code", "Stop")));
      assert.equal(result.changed, false);
      assert.ok(result.lines[0]?.detail.includes("'\\'"), result.lines[0]?.detail);
    },
  );
});

describe("an environment prefix the direct form cannot carry (security review finding 3, spec 0243 delta-01)", () => {
  const prefixed = (dir: string, prefix: string): string =>
    `${prefix}${legacy(dir, "claude-code", "Stop")}`;

  test("CREWRIG_USAGE_ROOT=… bash …/usage-capture.sh stays byte-identical and is reported by name", () => {
    const dir = checkout("envroot");
    const command = prefixed(dir, "CREWRIG_USAGE_ROOT=/Volumes/enc/usage ");
    const input = claudeConfig(command);
    const result = run(input);
    assert.equal(result.changed, false);
    assert.equal(result.rewrote, 0);
    assert.equal(result.left, 1);
    assert.deepEqual(stopCommands(result.config), [command]);
    assert.equal(JSON.stringify(result.config), JSON.stringify(input));
    const detail = result.lines[0]?.detail ?? "";
    assert.equal(result.lines[0]?.kind, "left");
    assert.ok(detail.includes("environment prefix (CREWRIG_USAGE_ROOT=...)"), detail);
    assert.ok(detail.includes("cannot carry"), detail);
  });

  test("the report names every variable and never echoes a value", () => {
    const dir = checkout("envmany");
    const result = run(claudeConfig(prefixed(dir, "A_TOKEN=hunter2 CREWRIG_USAGE_ROOT=/x ")));
    const detail = result.lines[0]?.detail ?? "";
    assert.ok(detail.includes("A_TOKEN=..., CREWRIG_USAGE_ROOT=..."), detail);
    assert.ok(!detail.includes("hunter2") && !detail.includes("/x"), detail);
  });

  test("a prefixed command stays recognised: a plain twin is rewritten, the prefixed duplicate is deduplicated", () => {
    const dir = checkout("envdedup");
    const result = run(
      claudeConfig(legacy(dir, "claude-code", "Stop"), prefixed(dir, "CREWRIG_USAGE_ROOT=/x ")),
    );
    assert.deepEqual(stopCommands(result.config), [direct(dir, "claude-code", "Stop")]);
    assert.equal(result.rewrote, 1);
    assert.equal(result.dropped, 1);
  });

  test("an already-direct command with a prefix keeps its own reason", () => {
    const dir = checkout("envdirect");
    const result = run(claudeConfig(`CREWRIG_USAGE_ROOT=/x ${direct(dir, "claude-code", "Stop")}`));
    assert.equal(result.changed, false);
    assert.ok(result.lines[0]?.detail.includes("already the direct form"), result.lines[0]?.detail);
  });
});

describe("look-alikes are never touched (R20)", () => {
  test("operator hooks that merely name a script called usage-capture", () => {
    const dir = checkout("f");
    const input = claudeConfig(
      'node "/opt/tools/usage-capture.ts" other-tool Stop',
      `bash /opt/prep.sh && bash ${dir}/usage-capture.sh claude-code Stop`,
      `bash "${dir}/usage-capture.sh" claude-code Stop extra`,
    );
    const result = run(input);
    assert.equal(result.changed, false);
    assert.deepEqual(result.config, input);
    assert.deepEqual(result.lines, []);
  });
});
