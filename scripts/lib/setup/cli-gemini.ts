// cli-gemini.ts — the descriptor of the Gemini CLI setup (spec 0256 requirements 3 and 6, plan v2
// step B3b.1). Pure data: the order of the run, the homes, the rule files and the strategy keys of
// scripts/setup-gemini-interactive.sh, which the step files in this directory read. Every string is
// copied from that script (the labels are the third argument of its `install_file` calls); the
// differential test compares the bytes later. Paths follow the contract in descriptor.ts: homes
// relative to the user home, `src` relative to the repository, `dest` relative to `homes.rulesDir`
// (the store's, to the user home).
//
// Differences from Claude Code: no tool check (`prerequisites` is absent), the rule files live in
// `~/.gemini` itself as `NN_*.md`, the MCP servers are written into `settings.json` (so there is no
// `homes.mcpConfig`), the catalogue selection runs after the MCP step, the superseded `GEMINI.md`
// is cleaned up after the session check, and the summary prints the store access guidance.

import type { SetupDescriptor } from "./descriptor.ts";

export const geminiDescriptor: SetupDescriptor = {
  cli: "gemini",
  banner: "Gemini CLI Configuration Setup",
  steps: [
    "banner",
    "link-confirm",
    "ensure-home",
    "identity-check",
    "rules-existing",
    "rules-shared",
    "tls-offer",
    "deps-install",
    "mcp",
    "rules-selection",
    "tiers",
    "hooks-rewrite-installed",
    "session-recording",
    "usage-capture",
    "session-check",
    "legacy-context-cleanup",
    "summary",
  ],
  homes: {
    cliHome: ".gemini",
    rulesDir: ".gemini",
    skillsDir: ".gemini/skills",
    agentsDir: ".gemini/agents",
    settings: ".gemini/settings.json",
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
    shared: [
      {
        src: "config/ORGANIZATION.md",
        dest: "20_ORGANIZATION.md",
        label: "ORGANIZATION.md -> 20_ORGANIZATION.md",
      },
      {
        src: "artifacts/core/rules/60-tools.md",
        dest: "60_TOOLS.md",
        label: "artifacts/core/rules/60-tools.md -> 60_TOOLS.md",
      },
      {
        src: "config/TOOLS.md",
        dest: "65_TOOLS.md",
        label: "TOOLS.md -> 65_TOOLS.md",
      },
      {
        src: "artifacts/core/system-context",
        dest: ".crewrig/system-context",
        label: "artifacts/core/system-context -> ~/.crewrig/system-context",
      },
      {
        src: "AGENTS.org.md",
        dest: "66_ORG_RULES.md",
        label: "AGENTS.org.md -> 66_ORG_RULES.md",
        optional: true,
      },
      {
        src: "config/SOUL.md",
        dest: "00_SOUL.md",
        label: "SOUL.md -> 00_SOUL.md",
      },
    ],
    store: {
      src: "artifacts/core/system-context",
      dest: ".crewrig/system-context",
      label: "artifacts/core/system-context -> ~/.crewrig/system-context",
    },
    pickOrder: ["team", "expertise", "level"],
    selections: {
      team: {
        src: "config/teams",
        dest: "50_USER_TEAM.md",
        label: "teams/{name}.md -> 50_USER_TEAM.md",
      },
      expertise: {
        src: "config/expertise",
        dest: "40_USER_EXPERTISE.md",
        label: "expertise/{name}.md -> 40_USER_EXPERTISE.md",
      },
      level: {
        src: "config/level",
        dest: "10_USER_LEVEL.md",
        label: "level/{name}.md -> 10_USER_LEVEL.md",
      },
    },
    profile: {
      mode: "method",
      file: {
        src: "config/PROFILE.md",
        dest: "30_USER_PROFILE.md",
        label: "PROFILE.md -> 30_USER_PROFILE.md",
      },
    },
  },
  hooks: {
    channel: "settings",
    file: ".gemini/settings.json",
    src: "hooks/gemini-transcript-hooks.json",
    envPatch: false,
    unusedCopy: ".gemini/hooks/mempalace-transcript.sh",
    leadingBlank: true,
  },
  strategies: { mcp: "geminiMcp", tiers: "standard", usageCapture: "settings" },
  storeGuidance: true,
  summary: {
    listHeader: "Active context files:",
    listGlob: "[0-9][0-9]_*.md",
    mcpHeader: "MCP servers (from settings.json):",
    mcpSource: "settings.json",
    note: "Note: MemPalace MCP server is NOT installed in settings.json.",
    restartLine: "Restart any running Gemini CLI session to pick up the new configuration.",
    extraLines: [],
  },
};
