// cli-antigravity.ts — the descriptor of the Antigravity CLI setup (spec 0256 requirements 3 and 6,
// plan v2 step B3b.1, task T8b): PURE DATA, every wording copied verbatim from scripts/setup-
// antigravity-interactive.sh. The flow (flow.ts) and the step files read it; nothing here runs.
//
// What makes Antigravity differ: `prerequisites` (the `agy` guard) runs BEFORE `link-confirm`;
// `mcp-prepare` runs before `tls-offer` and `deps-install`; the MCP step runs before the catalogue
// picks; the tiers are followed by `migrate-superseded`; the hooks live in
// `~/.gemini/config/hooks.json`, the usage capture is a statusline, and `system-context-file`
// generates `~/.gemini/config/AGENTS.md` after `session-check` (it also removes the legacy
// `GEMINI.md`, so there is no `legacy-context-cleanup` here).

import type { RuleFile, SetupDescriptor } from "./descriptor.ts";

const AGY_HOME = ".gemini/antigravity-cli";

/** One context file; `src` is repository-relative, `dest` is relative to `homes.rulesDir`. */
function file(src: string, labelSrc: string, dest: string): RuleFile {
  return { src, dest, label: `${labelSrc} -> ${dest}` };
}

/** A catalogue selection: `src` is the catalogue directory and `{name}` the chosen entry. */
function selection(dir: string, short: string, dest: string): RuleFile {
  return { src: `config/${dir}`, dest, label: `${short}/{name}.md -> ${dest}` };
}

const store: RuleFile = {
  src: "artifacts/core/system-context",
  dest: ".crewrig/system-context",
  label: "artifacts/core/system-context -> ~/.crewrig/system-context",
};

export const antigravityDescriptor: SetupDescriptor = {
  cli: "antigravity",
  banner: "Antigravity CLI Configuration Setup",
  steps: [
    "banner",
    "prerequisites",
    "link-confirm",
    "ensure-home",
    "identity-check",
    "rules-existing",
    "rules-shared",
    "mcp-prepare",
    "tls-offer",
    "deps-install",
    "mcp",
    "rules-selection",
    "tiers",
    "migrate-superseded",
    "hooks-rewrite-installed",
    "session-recording",
    "usage-capture",
    "session-check",
    "system-context-file",
    "summary",
  ],
  homes: {
    cliHome: AGY_HOME,
    rulesDir: AGY_HOME,
    skillsDir: ".gemini/config/skills",
    agentsDir: ".gemini/config/agents",
    mcpConfig: ".gemini/config/mcp_config.json",
  },
  rules: {
    existingGlob: "[0-9][0-9]_*.md",
    texts: {
      existingFound: "Existing context files found in",
      actionHeader:
        "Existing context files detected — keep them (skip selection) or refresh from scratch?",
      keptMessage:
        "Keeping existing context files. Team / expertise / level / profile selection will be skipped.",
      removedMessage: "Existing context files removed. Full selection flow will run.",
    },
    sharedHeader: "Installing shared configuration...",
    // The shell's order: organization, 60, 65, store, 66 (when present), soul.
    shared: [
      file("config/ORGANIZATION.md", "ORGANIZATION.md", "20_ORGANIZATION.md"),
      file("artifacts/core/rules/60-tools.md", "artifacts/core/rules/60-tools.md", "60_TOOLS.md"),
      file("config/TOOLS.md", "TOOLS.md", "65_TOOLS.md"),
      store,
      { ...file("AGENTS.org.md", "AGENTS.org.md", "66_ORG_RULES.md"), optional: true },
      file("config/SOUL.md", "SOUL.md", "00_SOUL.md"),
    ],
    store,
    pickOrder: ["team", "expertise", "level"],
    selections: {
      team: selection("teams", "teams", "50_USER_TEAM.md"),
      expertise: selection("expertise", "expertise", "40_USER_EXPERTISE.md"),
      level: selection("level", "level", "10_USER_LEVEL.md"),
    },
    profile: {
      mode: "method",
      file: file("config/PROFILE.md", "PROFILE.md", "30_USER_PROFILE.md"),
    },
  },
  hooks: {
    channel: "agy-json",
    file: ".gemini/config/hooks.json",
    src: "hooks/antigravity-transcript-hooks.json",
    envPatch: false,
    unusedCopy: `${AGY_HOME}/hooks/mempalace-transcript.sh`,
    leadingBlank: false,
  },
  strategies: { mcp: "antigravityMcp", tiers: "antigravity", usageCapture: "statusline" },
  storeGuidance: false,
  summary: {
    listHeader: "Active context files:",
    listGlob: "[0-9][0-9]_*.md",
    mcpHeader: "MCP servers (from mcp_config.json):",
    mcpSource: "mcp_config.json",
    note: "Note: MemPalace MCP server is NOT installed in mcp_config.json.",
    restartLine: "Restart any running Antigravity CLI session to pick up the new configuration.",
    extraLines: [],
  },
};
