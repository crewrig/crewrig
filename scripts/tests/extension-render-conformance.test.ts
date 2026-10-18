// extension-render-conformance.test.ts — the FILE SET each builder produces for the reference
// extension (hello-world) against hand-written lists, plus the declared MCP server names and the
// absence of a render-time absolute path. Replaces scripts/tests/test-extension-render-conformance.sh
// groups G1-G5 (spec 0265, row J2; specs 0173 R15, 0180 R18). The sandbox holds the tracked files
// only; the real `dist/` of the extension is never touched (a stub is written in the sandbox).
// G6-G8 are in extension-render-conformance-checks.test.ts.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";

import {
  EXAMPLE_HOOKS,
  EXPECTED_ANTIGRAVITY,
  EXPECTED_CLAUDE,
  EXPECTED_COPILOT,
  EXPECTED_GEMINI_GENERATED,
  EXT_NAME,
  geminiGeneratedMembers,
  hookFileSetsMatch,
  listFiles,
  sandboxFor,
} from "./lib/extension-render-conformance.ts";
import { createTemplate, runEntry } from "./lib/extension-sandbox.ts";

let root = "";
let home = "";
let renderStatus: number | null = null;
let renderOutput = "";

before(() => {
  root = sandboxFor(createTemplate());
  // A distinctive scratch HOME, so an empty HOME cannot make the G5 needle vacuous.
  home = fs.mkdtempSync(path.join(os.tmpdir(), "conformance-home-"));
  const res = runEntry(root, "build-extension.ts", ["--target", "all", EXT_NAME], { HOME: home });
  renderStatus = res.status;
  renderOutput = res.combined;
});
after(() => fs.rmSync(home, { recursive: true, force: true }));

const claudeOut = (): string =>
  path.join(root, "extensions", "core", EXT_NAME, "dist-claude-plugin", EXT_NAME);
const copilotOut = (): string => path.join(root, "dist-copilot-plugin", EXT_NAME);
const antigravityOut = (): string => path.join(root, "dist-antigravity-plugin", EXT_NAME);
const geminiOut = (): string => path.join(root, "build", "extensions", EXT_NAME);

test("G1 — render --target all exits 0 for hello-world", () => {
  assert.equal(renderStatus, 0, renderOutput);
});

describe("G2 — produced file sets match the expected lists exactly", () => {
  for (const [label, dir, expected] of [
    ["Claude plugin", claudeOut, EXPECTED_CLAUDE],
    ["Copilot plugin", copilotOut, EXPECTED_COPILOT],
    ["Antigravity plugin", antigravityOut, EXPECTED_ANTIGRAVITY],
  ] as const) {
    test(`G2 ${label} — file set equals the list, both directions, .ts handler spelling`, () => {
      assert.ok(fs.existsSync(dir()), `output root ${dir()} was not produced`);
      const actual = listFiles(dir());
      const verdict = hookFileSetsMatch(actual, expected, EXAMPLE_HOOKS);
      assert.equal(
        verdict,
        "match",
        `${verdict}: expected\n${[...expected].sort().join("\n")}\nactual\n${actual.join("\n")}`,
      );
    });
  }
});

test("G3 — Gemini in-place generated members equal the expected list (never the source copy)", () => {
  assert.ok(fs.existsSync(geminiOut()), `build/extensions/${EXT_NAME} was not produced`);
  const classFile = path.join(root, "scripts", "lib", "extension-generated-class.json");
  assert.deepEqual(
    geminiGeneratedMembers(geminiOut(), classFile),
    [...EXPECTED_GEMINI_GENERATED].sort((a, b) => (a < b ? -1 : 1)),
  );
});

/** [label, MCP file of the target]; resolved lazily, the sandbox is created in `before`. */
const mcpFiles = (): readonly (readonly [string, string])[] => [
  ["Claude", path.join(claudeOut(), ".mcp.json")],
  ["Copilot", path.join(copilotOut(), ".mcp.json")],
  ["Antigravity", path.join(antigravityOut(), "mcp_config.json")],
  ["Gemini", path.join(geminiOut(), "gemini-extension.json")],
];
const labels = ["Claude", "Copilot", "Antigravity", "Gemini"] as const;

describe("G4 — rendered output carries every declared MCP server name", () => {
  for (const [i, label] of labels.entries()) {
    test(`G4 ${label} — every key of extension.json mcpServers is present`, () => {
      const file = (mcpFiles()[i] as readonly [string, string])[1];
      assert.ok(fs.existsSync(file), `${file} was not produced`);
      const manifest = JSON.parse(
        fs.readFileSync(path.join(root, "extensions", "core", EXT_NAME, "extension.json"), "utf8"),
      ) as { mcpServers?: Record<string, unknown> };
      const declared = Object.keys(manifest.mcpServers ?? {});
      assert.ok(declared.length > 0, "hello-world declares no MCP server: the check is vacuous");
      const rendered = JSON.parse(fs.readFileSync(file, "utf8")) as {
        mcpServers?: Record<string, unknown>;
      };
      for (const name of declared)
        assert.ok(Object.hasOwn(rendered.mcpServers ?? {}, name), `${file} lacks server ${name}`);
    });
  }
});

describe("G5 — no render-time absolute path in any rendered MCP output", () => {
  for (const [i, label] of labels.entries()) {
    test(`G5 ${label} — none of root, HOME, build/extensions/, dist-*-plugin appears`, () => {
      const file = (mcpFiles()[i] as readonly [string, string])[1];
      assert.ok(fs.existsSync(file), `${file} was not produced`);
      const content = fs.readFileSync(file, "utf8").split("\\").join("/");
      const slash = (p: string): string => p.split("\\").join("/");
      const needles = [
        root,
        slash(root),
        home,
        slash(home),
        os.homedir(),
        "build/extensions/",
        "dist-claude-plugin",
        "dist-copilot-plugin",
        "dist-antigravity",
      ];
      for (const needle of needles) {
        assert.ok(needle !== "", "empty needle would be vacuous");
        assert.ok(!content.includes(needle), `${file} carries the path fragment '${needle}'`);
      }
    });
  }
});
