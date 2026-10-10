// setup-cli-shape-fixtures.ts — the descriptor-shape checks shared by the four CLI descriptor tests
// (not a test file itself). The expected values are the observable behaviour of the shell setups
// that the golden cells store (scripts/tests/fixtures/setup-golden/<cli>/<cell>/stdout.golden for
// the printed lines, tree.json.golden for the files and the repository file each one comes from)
// and the declaration goldens (fixtures/setup-declarations/<cli>.txt.golden) for the step order and
// the facts the shell never printed. No expected value is read from a script text.

import assert from "node:assert/strict";
import path from "node:path";
import { it } from "node:test";

import type { Cli } from "../lib/setup/context.ts";
import type { PickKind, SetupDescriptor } from "../lib/setup/descriptor.ts";
import { identityInvocation } from "../lib/setup/prerequisites.ts";
import {
  declOf,
  printed,
  printedEverywhere,
  treeEverywhere,
  treeOf,
} from "./setup-golden-readers.ts";

// What each shell did that no printed line or file shows: the facts the old tests read from its
// text. `agents`: the CLI installs agents; `settings`/`mcpConfig`: the files it owns.
interface Literals {
  readonly link: boolean;
  readonly agents: boolean;
  readonly settings?: string;
  readonly mcpConfig?: string;
  readonly envPatch: boolean;
  readonly leadingBlank: boolean;
  readonly optional: readonly string[];
  readonly storeGuidance: boolean;
  /** The closing note when MemPalace is absent (only the Antigravity cell prints it). */
  readonly note?: string;
}
const LITERALS: Readonly<Record<Cli, Literals>> = {
  claude: {
    link: true,
    agents: true,
    settings: ".claude/settings.json",
    mcpConfig: ".claude.json",
    envPatch: true,
    leadingBlank: true,
    optional: [],
    storeGuidance: false,
    note: "Note: MemPalace MCP server was NOT installed during this run.",
  },
  gemini: {
    link: true,
    agents: true,
    settings: ".gemini/settings.json",
    envPatch: false,
    leadingBlank: true,
    optional: ["AGENTS.org.md"],
    storeGuidance: true,
    note: "Note: MemPalace MCP server is NOT installed in settings.json.",
  },
  copilot: {
    link: false,
    agents: false,
    mcpConfig: ".copilot/mcp-config.json",
    envPatch: false,
    leadingBlank: false,
    optional: ["AGENTS.org.md"],
    storeGuidance: true,
  },
  antigravity: {
    link: true,
    agents: true,
    mcpConfig: ".gemini/config/mcp_config.json",
    envPatch: false,
    leadingBlank: false,
    optional: ["AGENTS.org.md"],
    storeGuidance: false,
    note: "Note: MemPalace MCP server is NOT installed in mcp_config.json.",
  },
};

// The default run answers the catalogue with these entries (the golden harness's first choices).
const PICKED: Readonly<Record<PickKind, string>> = {
  team: "ATLAS",
  expertise: "BACKEND-JAVA",
  level: "CONFIRMED",
};
const TITLES: Readonly<Record<PickKind, string>> = {
  team: "Select your team:",
  expertise: "Select your expertise:",
  level: "Select your experience level:",
};
// The printed line that opens a step, for the steps every CLI prints one for.
const OPENERS = [
  ["rules-shared", "Installing shared "],
  ["rules-selection", "Select your "],
  ["deps-install", "Production dependencies:"],
  ["tiers", "Installing library "],
  ["summary", "  Setup complete"],
] as const;

const home = (p: string): string => `<HOME>/${p}`;

/** Registers the descriptor-shape tests of one CLI inside the caller's `describe`. */
export function shapeTests(cli: Cli, d: SetupDescriptor): void {
  const out = printed(cli, "default-answers");
  const everywhere = printedEverywhere(cli);
  const tree = treeOf(cli, "default-answers");
  const treeAll = treeEverywhere(cli);
  const decl = declOf(cli);
  const lit = LITERALS[cli];
  const { rules } = d;
  const rulesPath = (dest: string): string => home(`${d.homes.rulesDir}/${dest}`);

  it("the banner and the link question", () => {
    assert.equal(d.cli, cli);
    assert.ok(out.includes(`\n  ${d.banner}\n`), "banner not printed by the default run");
    assert.equal(decl.facts.get("banner"), d.banner);
    assert.equal(d.steps.includes("link-confirm"), lit.link);
    assert.equal(d.steps.includes("ensure-home"), lit.link);
  });

  it("the step order is the declaration golden's, and the printed sections follow it", () => {
    assert.deepEqual([...d.steps], [...decl.steps]);
    assert.equal(new Set(d.steps).size, d.steps.length);
    const at = (id: string): number => d.steps.indexOf(id as (typeof d.steps)[number]);
    // The deviations of the order from the other CLIs.
    assert.equal(at("prerequisites") !== -1, cli !== "gemini");
    if (cli === "claude") assert.ok(at("prerequisites") > at("link-confirm"));
    if (cli === "antigravity") assert.ok(at("prerequisites") < at("link-confirm"));
    if (cli === "copilot") assert.ok(at("rules-selection") < at("tls-offer"));
    else assert.ok(at("rules-selection") > at("mcp"));
    const printedOrder = OPENERS.map(([id, text]) => {
      const index = out.indexOf(text);
      assert.notEqual(index, -1, `no printed line opens ${id}`);
      return [index, id] as const;
    })
      .sort((a, b) => a[0] - b[0])
      .map(([, id]) => id);
    const declared = OPENERS.map(([id]) => id).sort((a, b) => at(a) - at(b));
    assert.deepEqual(printedOrder, declared);
  });

  it("the homes", () => {
    const { homes } = d;
    for (const kind of ["team", "expertise", "level"])
      assert.ok(tree.has(home(`${homes.cliHome}/.selected_${kind}`)), `${kind} marker`);
    assert.ok(tree.has(rulesPath(rules.profile.file.dest)), "rules dir");
    assert.ok(out.includes(` to ${home(homes.skillsDir)}`), "skills dir");
    assert.equal(homes.agentsDir !== undefined, lit.agents);
    if (homes.agentsDir !== undefined)
      assert.ok(
        [...treeAll].some((p) => p.startsWith(home(`${homes.agentsDir}/`))),
        "agents dir",
      );
    assert.equal(homes.settings, lit.settings);
    assert.equal(homes.mcpConfig, lit.mcpConfig);
    for (const file of [homes.settings, homes.mcpConfig])
      if (file !== undefined) assert.ok(treeAll.has(home(file)), file);
    assert.equal(decl.facts.get("hooks.file"), home(d.hooks.file));
    assert.ok(treeAll.has(home(d.hooks.file)), "hooks file");
  });

  it("the rule files: where each lands, where it comes from, what is printed, in what order", () => {
    const placed = [...rules.shared.filter((r) => r.src !== rules.store.src), rules.profile.file];
    assert.ok(placed.length >= 5);
    for (const r of placed) {
      if (r.optional === true) continue;
      assert.equal(tree.get(rulesPath(r.dest)), `repo:${r.src}`, r.dest);
    }
    for (const r of rules.shared) {
      const line = r.src === rules.store.src ? `  Copied dir: ${r.label}` : `  Copied: ${r.label}`;
      if (r.optional !== true) assert.ok(out.includes(`${line}\n`), `printed: ${r.label}`);
    }
    assert.ok(out.includes(`  Copied: ${rules.profile.file.label}\n`), "profile label");
    assert.ok(tree.has(home(rules.store.dest)), "store dir");
    assert.ok(tree.get(home(`${rules.store.dest}/mcp-tools-reference.md`))?.startsWith("repo:"));
    const positions = rules.shared
      .filter((r) => r.optional !== true)
      .map((r) => out.indexOf(`${r.label}\n`));
    assert.ok(!positions.includes(-1));
    assert.deepEqual(
      [...positions].sort((a, b) => a - b),
      positions,
      "install order",
    );
    assert.deepEqual(
      rules.shared.filter((r) => r.optional === true).map((r) => r.src),
      lit.optional,
    );
    assert.equal(rules.profile.mode, cli === "copilot" ? "direct" : "method");
  });

  it("the selections: pick order, files, labels and markers", () => {
    const titles = rules.pickOrder.map((k) => out.indexOf(TITLES[k]));
    assert.ok(!titles.includes(-1));
    assert.deepEqual(
      [...titles].sort((a, b) => a - b),
      titles,
      "pick order",
    );
    assert.deepEqual([...rules.pickOrder], decl.facts.get("rules.pick-order")?.split(","));
    for (const kind of rules.pickOrder) {
      const sel = rules.selections[kind];
      const name = PICKED[kind];
      assert.equal(tree.get(rulesPath(sel.dest)), `repo:${sel.src}/${name}.md`, kind);
      assert.ok(out.includes(`  Copied: ${sel.label.replace("{name}", name)}\n`), `label ${kind}`);
      assert.ok(tree.has(home(`${d.homes.cliHome}/.selected_${kind}`)), `marker ${kind}`);
    }
  });

  it("the existing-files texts, glob and shared header", () => {
    const { texts } = rules;
    const dir = home(d.homes.rulesDir);
    assert.ok(everywhere.includes(`${texts["existingFound"]} ${dir}:\n`), "existing found");
    assert.ok(everywhere.includes(`${texts["keptMessage"]}\n`), "kept message");
    assert.ok(everywhere.includes(`${texts["removedMessage"]}\n`), "removed message");
    assert.equal(texts["actionHeader"], decl.facts.get("prompt.rules-action.header"));
    assert.equal(rules.existingGlob, decl.facts.get("rules.glob"));
    assert.ok(out.includes(`${rules.sharedHeader.replace("{dir}", dir)}\n`), "shared header");
    assert.equal(rules.mkdirInExisting === true, cli === "copilot");
  });

  it("the identity invocations come from the cli of the context", () => {
    const refused = printed(cli, "missing-identity");
    const soul = identityInvocation(cli, "/init-soul");
    const profile = identityInvocation(cli, "/init-personal-profile");
    assert.ok(refused.includes(`  - config/SOUL.md is missing — run: ${soul}\n`), soul);
    assert.ok(refused.includes(`  - config/PROFILE.md is missing — run: ${profile}\n`), profile);
    assert.equal(decl.facts.get("init.soul"), soul);
    assert.equal(decl.facts.get("init.profile"), profile);
  });

  it("the hooks data", () => {
    assert.equal(d.hooks.src, `hooks/${cli}-transcript-hooks.json`);
    assert.equal(decl.facts.get("hooks.src"), `<REPO>/${d.hooks.src}`);
    assert.equal(decl.facts.get("hooks.unused-copy"), home(d.hooks.unusedCopy));
    assert.equal(d.hooks.envPatch, lit.envPatch);
    assert.equal(d.hooks.leadingBlank, lit.leadingBlank);
    assert.equal(
      d.hooks.channel,
      { claude: "settings", gemini: "settings", copilot: "user-json", antigravity: "agy-json" }[
        cli
      ],
    );
  });

  it("the summary spec", () => {
    const s = d.summary;
    assert.equal(s.note, lit.note);
    if (cli === "antigravity") assert.ok(everywhere.includes(`${s.note}\n`), "note");
    for (const line of [s.listHeader, s.mcpHeader, s.restartLine])
      if (line !== undefined) assert.ok(everywhere.includes(`${line}\n`), line);
    const listed = (out.split(`${s.listHeader}\n`)[1] ?? "").split("\n\n")[0]?.split("\n") ?? [];
    const glob = new RegExp(`^${s.listGlob.replaceAll("*", ".*")}$`);
    assert.ok(listed.length >= 8, "the listing");
    for (const file of listed.map((l) => l.trim())) {
      assert.ok(file.startsWith(home(`${d.homes.rulesDir}/`)), file);
      assert.match(path.basename(file), glob);
    }
    assert.equal(s.listGlob, decl.facts.get("summary.list-glob"));
    assert.equal(s.mcpSource, decl.facts.get("summary.mcp-source"));
    for (const line of s.extraLines) assert.ok(line === "" || out.includes(`${line}\n`), line);
    assert.equal(d.storeGuidance, lit.storeGuidance);
    assert.equal(out.includes("System-context store access (spec 0068):"), lit.storeGuidance);
  });
}
