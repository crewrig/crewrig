// print-manage-declarations.test.ts — pins the table the declarations helper prints (spec 0255, plan step 22e).
//
// A renamed or dropped key is red here, never a silent empty read in a Bash case; the helper prints
// a non-empty block for every CLI, in the sentinel form, with the tiers of COMPONENT_OVERLAY_TIERS.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";

import { COMPONENT_OVERLAY_TIERS } from "../lib/component-roots.ts";
import { manageDeclarationFacts } from "./lib/print-manage-declarations.ts";

const helper = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "lib",
  "print-manage-declarations.ts",
);

const COMMON = [
  "script",
  "home",
  "default-mode",
  "link-prompt",
  "types-line",
  "unknown-type-label",
  "unknown-type-lists-types",
  "tiers",
  "mcp-handler",
];
const alias = (...s: string[]): string[] => s.map((x) => `alias.${x}`);
const place = (t: string, ...more: string[]): string[] => [`action.${t}`, `compiled.${t}`, ...more];
const staged = (t: string, cli: string): string[] =>
  [...place(t), `refresh-cli.${t}`, `dest.${t}`, `staging-root.${t}`, `staging.${t}`].filter(
    (k) => cli !== "" || k !== "",
  );
const authored = (t: string, dest = true): string[] => [
  ...place(t),
  ...(dest ? [`dest.${t}`] : []),
  `artifact.${t}`,
];

const EXPECTED: Record<string, string[]> = {
  claude: [
    ...COMMON,
    ...alias("claude-skill", "policy", "mcp-server"),
    ...staged("claude-skills", "claude"),
    ...authored("policies"),
    ...authored("mcp-servers", false),
  ],
  gemini: [
    ...COMMON,
    "mcp-target",
    ...alias("command", "skill", "hook", "agent", "policy", "mcp-server", "theme"),
    ...authored("commands"),
    ...staged("skills", "gemini"),
    ...authored("hooks"),
    ...staged("agents", "gemini"),
    ...authored("policies"),
    ...authored("mcp-servers", false),
    "mcp-key.mcp-servers",
    ...authored("themes", false),
    "mcp-key.themes",
  ],
  copilot: [
    ...COMMON,
    "refused",
    "mcp-target",
    ...alias("skill", "agent", "command", "mcp-server"),
    ...staged("skills", "copilot"),
    ...staged("commands", "copilot"),
    ...authored("mcp-servers", false),
    "mcp-key.mcp-servers",
  ],
  antigravity: [
    ...COMMON,
    "customization-root",
    "mcp-target",
    ...alias("antigravity-skill", "policy", "mcp-server"),
    ...staged("antigravity-skills", "antigravity"),
    "migrates-superseded.antigravity-skills",
    ...authored("policies"),
    ...authored("mcp-servers", false),
    "mcp-key.mcp-servers",
  ],
};

function parse(lines: string[]): Map<string, Map<string, string>> {
  const out = new Map<string, Map<string, string>>();
  for (const line of lines) {
    const parts = line.split("\t");
    assert.equal(parts.length, 3, `not <cli>\\t<key>\\t<value>: ${JSON.stringify(line)}`);
    const [cli, key, value] = parts as [string, string, string];
    assert.notEqual(value, "", `empty value: ${line}`);
    const facts = out.get(cli) ?? new Map<string, string>();
    assert.ok(!facts.has(key), `duplicate key ${cli} ${key}`);
    facts.set(key, value);
    out.set(cli, facts);
  }
  return out;
}

describe("print-manage-declarations", () => {
  const table = parse(manageDeclarationFacts());

  test("the complete <cli> and <key> table", () => {
    assert.deepEqual([...table.keys()].sort(), Object.keys(EXPECTED).sort());
    for (const [cli, keys] of Object.entries(EXPECTED))
      assert.deepEqual([...(table.get(cli)?.keys() ?? [])].sort(), [...keys].sort(), cli);
  });

  test("every CLI prints a non-empty block", () => {
    for (const cli of Object.keys(EXPECTED)) assert.ok((table.get(cli)?.size ?? 0) > 10, cli);
  });

  test("the tiers are the exported COMPONENT_OVERLAY_TIERS", () => {
    for (const facts of table.values())
      assert.equal(facts.get("tiers"), COMPONENT_OVERLAY_TIERS.join(" "));
  });

  test("destinations and roots are in sentinel form", () => {
    for (const facts of table.values()) {
      for (const [key, value] of facts) {
        if (/^(dest\.|home$|customization-root$|mcp-target$)/.test(key))
          assert.ok(value.startsWith("<HOME>/"), `${key}=${value}`);
        if (key.startsWith("staging."))
          assert.ok(value.startsWith("<REPO>/dist/<TIER>/."), `${key}=${value}`);
        if (key.startsWith("artifact."))
          assert.ok(value.startsWith("<REPO>/artifacts/<TIER>/"), `${key}=${value}`);
        assert.ok(!value.includes(process.env["HOME"] ?? "\0"), `${key} leaks the real HOME`);
      }
    }
    assert.equal(
      table.get("antigravity")?.get("dest.antigravity-skills"),
      "<HOME>/.gemini/config/skills",
    );
    assert.equal(table.get("antigravity")?.get("customization-root"), "<HOME>/.gemini/config");
    assert.equal(
      table.get("antigravity")?.get("dest.policies"),
      "<HOME>/.gemini/antigravity-cli/rules",
    );
    assert.equal(
      table.get("antigravity")?.get("mcp-target"),
      "<HOME>/.gemini/antigravity-cli/settings.json",
    );
    assert.equal(
      table.get("antigravity")?.get("staging.antigravity-skills"),
      "<REPO>/dist/<TIER>/.agents/skills",
    );
    assert.equal(table.get("claude")?.get("staging-root.claude-skills"), ".claude/skills");
    assert.equal(table.get("gemini")?.get("staging-root.agents"), ".gemini/agents");
    assert.equal(table.get("copilot")?.get("alias.agent"), "agents");
  });

  test("run as a node entry, the helper prints the same lines to stdout", () => {
    const r = spawnSync(
      process.execPath,
      ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", helper],
      { encoding: "utf8", env: { PATH: process.env["PATH"] ?? "" } },
    );
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout, `${manageDeclarationFacts().join("\n")}\n`);
  });
});
