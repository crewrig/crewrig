// setup-prompt-inventory-cases.ts — the scenarios that make the four SHELL setups ask every question
// of the R12 inventory (spec 0256 requirement 12, plan v2 step A8), and the map from a recorded
// stub-`fzf` header to its prompt id. A scenario is a GoldenCase run through `runSetupCase` (sandbox
// only). API: scenariosFor(cli), idOfHeader(header), cancelKey(cli, header), CLIS.
import fs from "node:fs";
import path from "node:path";

import { casesFor } from "./setup-golden-all.ts";
import { defaultAnswers } from "./setup-golden-common.ts";
import { CLIS } from "./setup-golden-types.ts";
import type { Cli, GoldenCase } from "./setup-golden-types.ts";
import type { SetupSandbox } from "./setup-sandbox.ts";

export { CLIS };

/** A recorded header (or, for the catalogue picker, the `--preview` command) -> its prompt id. */
const HEADER_IDS: readonly (readonly [string, string])[] = [
  ["config/teams", "catalogue.team"],
  ["config/expertise", "catalogue.expertise"],
  ["config/level", "catalogue.level"],
  ["Existing", "rules-action"],
  ["Validation backend?", "validation.backend"],
  ["Translate the spec/plan", "validation.translate"],
  ["Pedagogy level", "validation.pedagogy"],
  ["Generate illustrations", "validation.illustration"],
  ["Configure the framework's tools to trust", "tls-delegation"],
  ["MemPalace not found", "mempalace-install"],
  ["Sequential Thinking MCP server?", "install-seqthink"],
  ["SequentialThinking MCP server", "install-seqthink"],
  ["Remove legacy", "legacy-mcp-removal"],
  ["Install default settings.json?", "install-settings"],
  ["How to resolve?", "profile-method"],
  ["'community' ", "overlay.community"],
  ["'org' ", "overlay.org"],
  ["Enable automatic session recording", "transcripts"],
  ["Apply", "transcripts-confirm"],
  ["Capture token usage", "usage-capture"],
  ["Enable Antigravity CLI usage capture", "usage-capture"],
  ["Usage capture is registered", "usage-capture-keep"],
  ["Antigravity usage capture is installed", "usage-capture-keep"],
];

export function idOfHeader(header: string): string | undefined {
  return HEADER_IDS.find(([key]) => header.includes(key))?.[1];
}

/** The key of the default answer table that matches `header`, so a cancel overrides it in place. */
export function cancelKey(cli: Cli, header: string): string {
  const key = Object.keys(defaultAnswers(cli)).find((k) => header.includes(k));
  return key ?? HEADER_IDS.find(([k]) => header.includes(k))?.[0] ?? header;
}

interface Facts {
  readonly rule: string;
  /** Staging directory under `dist/<tier>/` (relative), holding `skills/`. */
  readonly stage: string;
  readonly agent?: (tier: string) => string;
  /** The local profile target, absent when the shell has no profile question. */
  readonly profile?: string;
}

const FACTS: Record<Cli, Facts> = {
  claude: {
    rule: ".claude/rules/00-soul.md",
    stage: ".claude",
    agent: (t) => `agents/${t}-agent.md`,
    profile: ".claude/rules/30-profile.md",
  },
  gemini: {
    rule: ".gemini/00_SOUL.md",
    stage: ".gemini",
    agent: (t) => `agents/${t}-agent.md`,
    profile: ".gemini/30_USER_PROFILE.md",
  },
  copilot: { rule: ".copilot/instructions/99-custom.instructions.md", stage: ".github" },
  antigravity: {
    rule: ".gemini/antigravity-cli/99_CUSTOM.md",
    stage: ".agents",
    agent: (t) => `agents/demo-${t}/AGENT.md`,
    profile: ".gemini/antigravity-cli/30_USER_PROFILE.md",
  },
};

const put = (file: string, text: string): void => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
};

/** No MemPalace anywhere: the seeded pipx venv and the python3 stub (which always claims the module) are gone. */
function noMempalace(sb: SetupSandbox): void {
  fs.rmSync(path.join(sb.home, ".local/share/pipx"), { recursive: true, force: true });
  fs.rmSync(path.join(sb.bin, "python3"), { force: true });
}

/** Stage the built tier directory, so its overlay question is asked. */
function stage(sb: SetupSandbox, f: Facts, tier: string): void {
  put(path.join(sb.repo, "dist", tier, f.stage, "skills", `demo-${tier}`, "SKILL.md"), "# s\n");
  if (f.agent !== undefined) put(path.join(sb.repo, "dist", tier, f.stage, f.agent(tier)), "# a\n");
}

export interface Scenario {
  readonly name: string;
  readonly c: GoldenCase;
}

/** The `usage-capture-installed-keep` golden cell of `cli`: a registered capture (the case owns the seed). */
function registeredCapture(cli: Cli): GoldenCase {
  const found = casesFor(cli).find((c) => c.id === "usage-capture-installed-keep");
  if (found === undefined)
    throw new Error(`no usage-capture-installed-keep golden cell for ${cli}`);
  return found;
}

/**
 * The scenarios of one setup. `full`: no context files, a custom-CA variable, MemPalace missing with
 * `pipx` on PATH, both tiers staged, transcripts answered yes (plus, per CLI, a legacy
 * `~/.claude/mcp.json` and a local profile that differs). `rules`: an existing context file.
 * `tier-*`: one tier staged. `usage-keep`: a registered capture.
 */
export function scenariosFor(cli: Cli): readonly Scenario[] {
  const f = FACTS[cli];
  const base = { cli } as const;
  const yes = { "Enable automatic session recording": "yes" };
  const full: GoldenCase = {
    ...base,
    id: "inventory-full",
    note: "Every question whose condition holds on a fresh home.",
    env: { CREWRIG_TLS_CA: "package.json" },
    stubs: { fzf: yes },
    seed: (sb) => {
      noMempalace(sb);
      stage(sb, f, "community");
      stage(sb, f, "org");
      // The shell compares the profile target with `diff -q`, so only a non-regular target (a
      // directory) differs without being a context file that the keep-or-refresh step handles.
      if (f.profile !== undefined) fs.mkdirSync(path.join(sb.home, f.profile), { recursive: true });
      if (cli === "claude") put(path.join(sb.home, ".claude/mcp.json"), "{}\n");
    },
  };
  const rules: GoldenCase = {
    ...base,
    id: "inventory-rules",
    note: "An existing context file: the keep-or-refresh question.",
    seed: (sb) => {
      noMempalace(sb);
      put(path.join(sb.home, f.rule), "# existing\n");
    },
  };
  const tier = (name: string): Scenario => ({
    name: `tier-${name}`,
    c: {
      ...base,
      id: `inventory-tier-${name}`,
      note: `Only ${name} staged.`,
      seed: (sb) => {
        noMempalace(sb);
        stage(sb, f, name);
      },
    },
  });
  const keep = registeredCapture(cli);
  return [
    { name: "full", c: full },
    { name: "rules", c: rules },
    tier("community"),
    tier("org"),
    {
      name: "usage-keep",
      c: { ...keep, id: "inventory-usage-keep", note: "A capture is registered." },
    },
  ];
}
