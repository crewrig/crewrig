// extension-render-conformance-checks.test.ts — reserved-name refusal (G6), emitted hook command
// resolvability (G7) and the match-all default of an omitted matcher (G8), through the real
// `node scripts/build-extension.ts`. Replaces scripts/tests/test-extension-render-conformance.sh
// groups G6-G8 (spec 0265, row J2; specs 0179 R8, 0179 v2-F1, 0180 R18).
//
// G7 is an INTENTIONAL strengthening: the Bash extractor matched only `*.sh`, the example hooks
// are `.ts` since spec 0258, so it never found a path and only the "a command exists" assertion
// was live. Here the quoted path (`.ts` or `.sh`) of each command is resolved and must exist.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { before, describe, test } from "node:test";

import { EXT_NAME, sandboxFor } from "./lib/extension-render-conformance.ts";
import {
  cloneTemplate,
  createTemplate,
  fixtureManifest,
  mutate,
  render,
  writeManifest,
} from "./lib/extension-sandbox.ts";

let template = "";
before(() => {
  template = createTemplate();
});

function readJson(file: string): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>;
}

describe("G6 — a framework-reserved MCP server name is refused", () => {
  const run = (() => {
    let cached: { root: string; status: number | null; combined: string } | undefined;
    return () => {
      if (cached !== undefined) return cached;
      const root = sandboxFor(template);
      mutate(
        path.join(root, "extensions", "core", EXT_NAME, "extension.json"),
        '"mcpServers": {',
        '"mcpServers": {\n    "mempalace": {"command": "evil"},',
      );
      const res = render(root, "all", EXT_NAME);
      cached = { root, status: res.status, combined: res.combined };
      return cached;
    };
  })();

  test("G6 (a) — rc != 0, the output names hello-world and mempalace", () => {
    const res = run();
    assert.notEqual(res.status, 0, res.combined);
    assert.ok(res.combined.includes(EXT_NAME), res.combined);
    assert.ok(res.combined.includes("mempalace"), res.combined);
  });

  test("G6 (b) — no target output carries a server under the reserved name (has, not truthiness)", () => {
    const { root } = run();
    for (const file of [
      path.join(root, "extensions", "core", EXT_NAME, "dist-claude-plugin", EXT_NAME, ".mcp.json"),
      path.join(root, "dist-copilot-plugin", EXT_NAME, ".mcp.json"),
      path.join(root, "dist-antigravity-plugin", EXT_NAME, "mcp_config.json"),
      path.join(root, "build", "extensions", EXT_NAME, "gemini-extension.json"),
    ]) {
      if (!fs.existsSync(file)) continue; // an absent file is fine
      const servers = (readJson(file)["mcpServers"] ?? {}) as object;
      assert.equal(Object.hasOwn(servers, "mempalace"), false, `${file} carries mempalace`);
    }
  });
});

describe("G7 — every emitted hook command resolves to an existing file", () => {
  let root = "";
  before(() => {
    root = sandboxFor(template);
    const res = render(root, "all", EXT_NAME);
    assert.equal(res.status, 0, res.combined);
  });

  /** Every `command` string anywhere in a parsed hooks file. */
  function commandsOf(value: unknown, out: string[] = []): string[] {
    if (Array.isArray(value)) for (const v of value) commandsOf(v, out);
    else if (value !== null && typeof value === "object")
      for (const [k, v] of Object.entries(value)) {
        if (k === "command" && typeof v === "string") out.push(v);
        else commandsOf(v, out);
      }
    return out;
  }

  /** The first quoted path ending `.ts` or `.sh` (a guarded win32 prefix sits outside the quotes). */
  function pathIn(command: string): string | undefined {
    return (
      /"([^"]+\.(?:ts|sh))"/.exec(command)?.[1] ?? /(\S+\.(?:ts|sh))(?:\s|$)/.exec(command)?.[1]
    );
  }

  const cases = [
    [
      "Claude",
      () => path.join(root, "extensions", "core", EXT_NAME, "dist-claude-plugin", EXT_NAME),
      "hooks/hooks.json",
      "${CLAUDE_PLUGIN_ROOT}",
    ],
    [
      "Copilot",
      () => path.join(root, "dist-copilot-plugin", EXT_NAME),
      "hooks.json",
      "${COPILOT_PLUGIN_ROOT}",
    ],
    ["Antigravity", () => path.join(root, "dist-antigravity-plugin", EXT_NAME), "hooks.json", ""],
    [
      "Gemini",
      () => path.join(root, "build", "extensions", EXT_NAME),
      "hooks/hooks.json",
      "${extensionPath}",
    ],
  ] as const;

  for (const [label, dir, hookFile, token] of cases) {
    test(`G7 ${label} — resolvability: each command names a path that exists in the rendered tree`, () => {
      const base = dir();
      const file = path.join(base, hookFile);
      assert.ok(fs.existsSync(file), `${file} was not produced`);
      const commands = commandsOf(readJson(file));
      assert.ok(commands.length > 0, `no command found in ${file}`);
      for (const command of commands) {
        const resolved = token === "" ? command : command.split(token).join(base);
        const rel = pathIn(resolved);
        assert.ok(rel !== undefined, `no .ts/.sh path in emitted command '${command}'`);
        const target = path.isAbsolute(rel) ? rel : path.join(base, rel);
        assert.ok(fs.existsSync(target), `command '${command}' resolves to missing '${target}'`);
      }
    });
  }
});

describe("G8 — an omitted matcher renders as each target's own match-all form", () => {
  let root = "";
  before(() => {
    root = cloneTemplate(template);
    writeManifest(
      root,
      "matchall",
      fixtureManifest("matchall", {
        hooks: [{ id: "everything", event: "PreToolUse", command: "echo hi" }],
      }),
    );
    const res = render(root, "all", "matchall");
    assert.equal(res.status, 0, res.combined);
  });

  const hooks = (...parts: string[]): Record<string, unknown> =>
    readJson(path.join(root, ...parts));
  const at = (value: unknown, ...keys: (string | number)[]): unknown =>
    keys.reduce<unknown>((v, k) => (v as Record<string | number, unknown>)[k], value);

  test("G8 Claude — matcher is exactly the empty string", () => {
    const json = hooks(
      "extensions",
      "core",
      "matchall",
      "dist-claude-plugin",
      "matchall",
      "hooks",
      "hooks.json",
    );
    assert.equal(at(json, "hooks", "PreToolUse", 0, "matcher"), "");
  });
  test("G8 Gemini — matcher is the literal .*", () => {
    const json = hooks("build", "extensions", "matchall", "hooks", "hooks.json");
    assert.equal(at(json, "hooks", "BeforeTool", 0, "matcher"), ".*");
  });
  test("G8 Copilot — matcher is the literal .*", () => {
    const json = hooks("dist-copilot-plugin", "matchall", "hooks.json");
    assert.equal(at(json, "hooks", "preToolUse", 0, "matcher"), ".*");
  });
  test("G8 Antigravity — key matchall-hooks, matcher is the literal .*", () => {
    const json = hooks("dist-antigravity-plugin", "matchall", "hooks.json");
    assert.equal(at(json, "matchall-hooks", "PreToolUse", 0, "matcher"), ".*");
  });
});
