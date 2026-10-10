// descriptors.ts — the four manage-*-component.sh declarations as data (spec 0255 R6, plan step 9).
//
// Every value is TODAY's value of the manage-{claude,copilot,antigravity,workspace}-component.sh
// it twins, pinned against that script's text by scripts/tests/manage-descriptors.test.ts. Paths
// are relative to HOME; root arguments are those of `component_set_{staging,artifact}_roots`.

import { INITIAL_MCP_CONFIG, INITIAL_SETTINGS } from "./mcp-json.ts";
import type { CliDescriptor, TypeDescriptor } from "./types.ts";

function staged(name: string, rootArg: string, dest: string, refreshCli: string): TypeDescriptor {
  return { name, root: "staging", rootArg, dest, action: "place", refreshCli };
}

function authored(name: string, dest: string): TypeDescriptor {
  return { name, root: "artifact", rootArg: name, dest, action: "place", refreshCli: "" };
}

function mcp(name: string, mcpKey?: string): TypeDescriptor {
  const t: TypeDescriptor = {
    name,
    root: "artifact",
    rootArg: name,
    dest: null,
    action: "mcp",
    refreshCli: "",
  };
  return mcpKey === undefined ? t : { ...t, mcpKey };
}

export const CLAUDE: CliDescriptor = {
  cli: "claude",
  script: "manage-claude-component.sh",
  home: ".claude",
  defaultMode: "install",
  typesLine: "claude-skills, policies, mcp-servers",
  aliases: { "claude-skill": "claude-skills", policy: "policies", "mcp-server": "mcp-servers" },
  types: [
    staged("claude-skills", ".claude/skills", ".claude/skills", "claude"),
    authored("policies", ".claude/rules"),
    mcp("mcp-servers"),
  ],
  refused: [],
  linkWarning: [
    "         For claude-skills the link target is the regenerable staging",
    "         tree dist/<tier>/, which a rebuild replaces wholesale: an edit",
    "         to the authoring source under artifacts/ takes effect only",
    "         after 'bash scripts/build-components.sh' has run.",
  ],
  linkPrompt: true,
  unknownType: { label: "type", listsTypes: true },
  mcp: { kind: "spawn" },
};

export const COPILOT: CliDescriptor = {
  cli: "copilot",
  script: "manage-copilot-component.sh",
  home: ".copilot",
  defaultMode: "install",
  typesLine: "skills, commands, mcp-servers",
  aliases: { skill: "skills", agent: "agents", command: "commands", "mcp-server": "mcp-servers" },
  // Commands compile as skills for Copilot: one landing zone and one staging root for both.
  types: [
    staged("skills", ".github/skills", ".copilot/skills", "copilot"),
    staged("commands", ".github/skills", ".copilot/skills", "copilot"),
    mcp("mcp-servers", "mcpServers"),
  ],
  refused: ["agents"],
  linkWarning: [
    "         For skills the link target is the regenerable staging tree",
    "         dist/<tier>/, which a rebuild replaces wholesale: an edit to",
    "         the authoring source under artifacts/ takes effect only after",
    "         'bash scripts/build-components.sh' has run.",
  ],
  linkPrompt: true,
  unknownType: { label: "type", listsTypes: true },
  mcp: { kind: "json", file: ".copilot/mcp-config.json", initial: INITIAL_MCP_CONFIG },
};

export const ANTIGRAVITY: CliDescriptor = {
  cli: "antigravity",
  script: "manage-antigravity-component.sh",
  // ANTIGRAVITY_HOME serves policies (rules/) and the MCP settings; spec 0123 moved only skills.
  home: ".gemini/antigravity-cli",
  customizationRoot: ".gemini/config",
  defaultMode: "install",
  typesLine: "antigravity-skills, policies, mcp-servers",
  aliases: {
    "antigravity-skill": "antigravity-skills",
    policy: "policies",
    "mcp-server": "mcp-servers",
  },
  types: [
    {
      ...staged("antigravity-skills", ".agents/skills", ".gemini/config/skills", "antigravity"),
      migratesSuperseded: true,
    },
    authored("policies", ".gemini/antigravity-cli/rules"),
    mcp("mcp-servers", "mcpServers"),
  ],
  refused: [],
  linkWarning: [
    "         For antigravity-skills the link target is the regenerable",
    "         staging tree dist/<tier>/, which a rebuild replaces wholesale:",
    "         an edit to the authoring source under artifacts/ takes effect",
    "         only after 'bash scripts/build-components.sh' has run.",
  ],
  linkPrompt: true,
  unknownType: { label: "type", listsTypes: true },
  mcp: { kind: "json", file: ".gemini/antigravity-cli/settings.json", initial: INITIAL_MCP_CONFIG },
};

/** The Gemini CLI command: manage-workspace-component.sh. It prints the warning and never prompts. */
export const GEMINI: CliDescriptor = {
  cli: "gemini",
  script: "manage-workspace-component.sh",
  home: ".gemini",
  defaultMode: "install",
  typesLine: "commands, skills, hooks, agents, policies, mcp-servers, themes",
  aliases: {
    command: "commands",
    skill: "skills",
    hook: "hooks",
    agent: "agents",
    policy: "policies",
    "mcp-server": "mcp-servers",
    theme: "themes",
  },
  types: [
    authored("commands", ".gemini/commands"),
    staged("skills", ".gemini/skills", ".gemini/skills", "gemini"),
    authored("hooks", ".gemini/hooks"),
    staged("agents", ".gemini/agents", ".gemini/agents", "gemini"),
    authored("policies", ".gemini/policies"),
    mcp("mcp-servers", "mcpServers"),
    mcp("themes", "themes"),
  ],
  refused: [],
  linkWarning: [
    "         For skills and agents the link target is the regenerable",
    "         staging tree dist/<tier>/, which a rebuild replaces wholesale:",
    "         an edit to the authoring source under artifacts/ takes effect",
    "         only after 'bash scripts/build-components.sh' has run.",
  ],
  linkPrompt: false,
  unknownType: { label: "component type", listsTypes: false },
  mcp: { kind: "json", file: ".gemini/settings.json", initial: INITIAL_SETTINGS },
};

/** Every command, in the order the tier-resolution cases list them. */
export const MANAGE_DESCRIPTORS: readonly CliDescriptor[] = [CLAUDE, GEMINI, COPILOT, ANTIGRAVITY];
