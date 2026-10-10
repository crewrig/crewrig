// setup-declarations.test.ts — the declaration printer the Bash suites read (spec 0256 requirement
// 9, plan v2 step B3b.5). It proves: the printed text is pinned by a golden per CLI (regenerate with
// UPDATE_SETUP_DECLARATIONS=1), an emptied descriptor makes the helper fail with nothing on stdout,
// the `step N` lines are the descriptor's steps, every key the retargeted suites will read exists
// (the table of setup-declarations-consumers.ts), and the facts no descriptor carries still match
// the step sources and, while the shell scripts exist, the order of the shell.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import type { Cli } from "../lib/setup/context.ts";
import { CLIS } from "../lib/setup/context.ts";
import { cancelClassOf, PROMPT_INVENTORY } from "../lib/setup/prompt-ids.ts";
import type { SetupDescriptor } from "../lib/setup/descriptor.ts";
import { asked } from "./setup-cli-copilot-antigravity-fixtures.ts";
import { CONSUMERS } from "./lib/setup-declarations-consumers.ts";
import { main, renderDeclaration, SETUP_DESCRIPTORS } from "./lib/print-setup-declarations.ts";
import { MCP_SUBSTEPS } from "./lib/setup-declarations-facts.ts";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const ENTRY = path.join(import.meta.dirname, "lib", "print-setup-declarations.ts");
const GOLDEN = (cli: Cli): string =>
  path.join(import.meta.dirname, "fixtures", "setup-declarations", `${cli}.txt.golden`);
const NODE = ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON"];

/** The real entry, as a Bash suite runs it. */
function run(cli: Cli, ...extra: string[]): string {
  return execFileSync(process.execPath, [...NODE, ENTRY, cli, ...extra], { encoding: "utf8" });
}

/** The same text in process (the entry is proved equal to it by the golden test). */
function decl(cli: Cli): string {
  return renderDeclaration(SETUP_DESCRIPTORS[cli] as SetupDescriptor, "lines");
}

interface Parsed {
  readonly steps: string[];
  readonly facts: Map<string, string>;
  readonly keys: string[];
}

function parse(text: string): Parsed {
  const steps: string[] = [];
  const facts = new Map<string, string>();
  const keys: string[] = [];
  for (const line of text.split("\n").filter((l) => l !== "")) {
    const step = /^step (\d+): (\S+)$/.exec(line);
    if (step !== null) {
      assert.equal(Number(step[1]), steps.length + 1, `step numbering at ${line}`);
      steps.push(step[2] as string);
      continue;
    }
    const at = line.indexOf("=");
    assert.ok(at > 0, `not a fact line: ${line}`);
    keys.push(line.slice(0, at));
    facts.set(line.slice(0, at), line.slice(at + 1));
  }
  return { steps, facts, keys };
}

const sink = (): { text: string; write(t: string): void } => ({
  text: "",
  write(t: string) {
    this.text += t;
  },
});

describe("the printed declaration is pinned", () => {
  for (const cli of CLIS) {
    it(`${cli}: equals its golden`, () => {
      const out = run(cli);
      assert.equal(out, decl(cli));
      if (process.env["UPDATE_SETUP_DECLARATIONS"] === "1") {
        fs.mkdirSync(path.dirname(GOLDEN(cli)), { recursive: true });
        fs.writeFileSync(GOLDEN(cli), out);
      }
      assert.equal(out, fs.readFileSync(GOLDEN(cli), "utf8"));
      assert.ok(out.split("\n").length > 100, "vacuity");
    });

    it(`${cli}: lines and json agree, keys are unique`, () => {
      const lines = parse(run(cli));
      assert.equal(new Set(lines.keys).size, lines.keys.length, "duplicate key");
      const json: unknown = JSON.parse(run(cli, "--format", "json"));
      const j = json as { cli: string; steps: string[]; facts: Record<string, string> };
      assert.equal(j.cli, cli);
      assert.deepEqual(j.steps, lines.steps);
      assert.deepEqual(new Map(Object.entries(j.facts)), lines.facts);
    });
  }
});

describe("the vacuity guard", () => {
  const claude = SETUP_DESCRIPTORS["claude"];
  assert.ok(claude !== undefined);
  const emptied = {
    steps: { ...claude, steps: [] },
    banner: { ...claude, banner: "" },
    shared: { ...claude, rules: { ...claude.rules, shared: [] } },
    homes: { ...claude, homes: { ...claude.homes, rulesDir: "" } },
    hooks: { ...claude, hooks: { ...claude.hooks, file: "" } },
  };
  for (const [name, descriptor] of Object.entries(emptied)) {
    it(`an emptied ${name} fails with nothing on stdout`, () => {
      const out = sink();
      const err = sink();
      assert.equal(main(["claude"], out, err, { claude: descriptor }), 1);
      assert.equal(out.text, "");
      assert.match(err.text, /descriptor is empty/);
      assert.throws(() => renderDeclaration(descriptor, "lines"), /descriptor is empty/);
    });
  }

  it("usage errors exit 2 with nothing on stdout", () => {
    for (const argv of [
      [],
      ["nope"],
      ["claude", "gemini"],
      ["claude", "--format", "xml"],
      ["--x"],
    ]) {
      const out = sink();
      assert.equal(main(argv, out, sink()), 2, argv.join(" "));
      assert.equal(out.text, "");
    }
    const child = spawnSync(process.execPath, [...NODE, ENTRY, "nope"], { encoding: "utf8" });
    assert.equal(child.status, 2);
    assert.equal(child.stdout, "");
  });
});

describe("what the declaration says", () => {
  for (const cli of CLIS) {
    const d = SETUP_DESCRIPTORS[cli] as SetupDescriptor;
    it(`${cli}: the step lines equal descriptor.steps, in order`, () => {
      assert.deepEqual(parse(decl(cli)).steps, [...d.steps]);
    });

    it(`${cli}: the prompts are the descriptor tests' map and the inventory's`, () => {
      const p = parse(decl(cli));
      const ids = [...p.facts.keys()]
        .filter((k) => k.startsWith("prompt.") && k.endsWith(".step"))
        .map((k) => k.slice(7, -5));
      assert.deepEqual([...ids].sort(), [...asked(d)].sort());
      const inventory = PROMPT_INVENTORY.filter((r) => r.clis.includes(cli)).map((r) => r.id);
      assert.deepEqual([...ids].sort(), inventory.sort());
      for (const id of ids) {
        assert.equal(p.facts.get(`prompt.${id}.cancel`), cancelClassOf(id, cli));
        assert.ok(p.facts.has(`prompt.${id}.options`), id);
      }
    });

    it(`${cli}: the contracts of order the suites assert`, () => {
      const { steps } = parse(decl(cli));
      const at = (id: string): number => steps.indexOf(id);
      assert.ok(at("tls-offer") < at("deps-install") && at("deps-install") < at("tiers"));
      assert.ok(at("hooks-rewrite-installed") < at("session-recording"));
      assert.ok(at("session-recording") < at("usage-capture"));
      assert.ok(at("mcp") < at("usage-capture"), "the settings write precedes the usage capture");
      assert.ok(at("usage-capture") < at("session-check") && at("session-check") < at("summary"));
      const mcp = (MCP_SUBSTEPS[d.strategies.mcp] as readonly string[]).slice();
      assert.ok(mcp.includes("ensure-mempalace-http"), "ensure_mempalace_http is declared");
      assert.equal(parse(decl(cli)).facts.get("substeps.mcp"), mcp.join(","));
    });
  }
});

describe("every key a retargeted suite reads exists", () => {
  assert.ok(CONSUMERS.length >= 25, "vacuity");
  for (const consumer of CONSUMERS) {
    it(consumer.suite, () => {
      const clis = consumer.clis ?? CLIS;
      for (const cli of clis) {
        const p = parse(decl(cli));
        for (const key of consumer.keys) {
          if (key.startsWith("step:"))
            assert.ok(p.steps.includes(key.slice(5)), `${cli}: no ${key}`);
          else assert.ok(p.facts.has(key), `${cli}: no key ${key}`);
        }
      }
    });
  }
});

describe("the facts no descriptor carries are pinned to their sources", () => {
  const read = (rel: string): string => fs.readFileSync(path.join(ROOT, rel), "utf8");

  it("the prompt headers are in the step sources", () => {
    const sources = ["steps-hooks.ts", "steps-agy.ts", "steps-usage.ts"]
      .map((f) => read(`scripts/lib/setup/${f}`))
      .join("\n");
    for (const cli of CLIS) {
      const facts = parse(decl(cli)).facts;
      for (const id of [
        "transcripts",
        "transcripts-confirm",
        "usage-capture",
        "usage-capture-keep",
      ]) {
        const header = facts.get(`prompt.${id}.header`) as string;
        // The parametric usage headers are template literals: compare the invariant part.
        const needle = header.replace(/Claude Code|Gemini CLI|Copilot CLI/, "${label}");
        assert.ok(
          sources.includes(header) || sources.includes(needle),
          `${cli}: header of ${id} is in no step source: ${header}`,
        );
      }
    }
  });

  it("the generated-context targets are in steps-agy.ts and the carriers name the wrapper", () => {
    const agy = read("scripts/lib/setup/steps-agy.ts");
    assert.ok(
      agy.includes('".gemini", "config", "AGENTS.md"') && agy.includes('".gemini", "GEMINI.md"'),
    );
    assert.ok(agy.includes("<!-- crewrig-section:"));
    for (const cli of ["gemini", "copilot"] as const) {
      const carrier = parse(decl(cli)).facts.get("mcp.wrapper-carrier") as string;
      assert.ok(read(carrier).includes("mempalace-http-wrapper.py"), `${cli}: ${carrier}`);
    }
  });

  // While a setup is still the shell script, the sub-step order is the shell's (plan-r3 rows 1, 6, 8).
  const ANCHORS: Readonly<Record<Cli, readonly (readonly [string, RegExp])[]>> = {
    claude: [
      ["sequential-thinking", /Install Sequential Thinking MCP server\?/],
      ["ensure-mempalace-http", /ensure_mempalace_http "\$REPO_DIR" claude/],
      ["register-stdio-fallback", /mcp_register_user mempalace/],
    ],
    gemini: [
      ["gemini-settings-write", /gemini_settings_write "\$SETTINGS_TARGET"/],
      ["ensure-mempalace-http", /ensure_mempalace_http "\$REPO_DIR" gemini/],
    ],
    copilot: [
      ["backup-capture-operator-servers", /^PREEXISTING_MCP=/],
      ["write-mcp-config", /write_json_config_secure_from "\$MCP_CONFIG_TARGET"/],
      ["org-mcp-fold", /apply_org_mcp_servers/],
      ["ensure-mempalace-http", /ensure_mempalace_http "\$REPO_DIR" copilot/],
    ],
    antigravity: [
      ["backup-capture-operator-servers", /^PREEXISTING_MCP=/],
      ["sequential-thinking", /Include SequentialThinking MCP server/],
      ["write-mcp-config", /write_json_config_secure_from "\$AGY_MCP_CONFIG"/],
      ["org-mcp-fold", /apply_org_mcp_servers/],
      ["ensure-mempalace-http", /ensure_mempalace_http "\$REPO_DIR" antigravity/],
    ],
  };
  for (const cli of CLIS) {
    it(`${cli}: the sub-steps of mcp are in the order of the shell`, (t) => {
      const file = path.join(ROOT, "scripts", `setup-${cli}-interactive.sh`);
      const text = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
      if (!/^#!.*\b(ba)?sh\b/.test(text)) return t.skip("the setup is no longer a shell script");
      const code = text
        .split("\n")
        .map((l, i) => [i, l] as const)
        .filter(([, l]) => !/^\s*#/.test(l));
      const lineOf = (re: RegExp): number => {
        const hit = code.find(([, l]) => re.test(l));
        assert.ok(hit !== undefined, `${cli}: no shell line for ${re}`);
        return hit[0];
      };
      const declared = MCP_SUBSTEPS[(SETUP_DESCRIPTORS[cli] as SetupDescriptor).strategies.mcp];
      let last = -1;
      let previous = "";
      for (const [name, re] of ANCHORS[cli]) {
        assert.ok(declared.includes(name), `${cli}: ${name} not declared`);
        assert.ok(declared.indexOf(name) > (declared.indexOf(previous) ?? -1), `${name} order`);
        const line = lineOf(re);
        assert.ok(line > last, `${cli}: ${name} is not after ${previous} in the shell`);
        last = line;
        previous = name;
      }
    });
  }
});
