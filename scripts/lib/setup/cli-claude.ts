// cli-claude.ts — the descriptor of the Claude Code setup (spec 0256 requirements 3 and 6, plan v2
// step B3b.1). Pure data: the order of the run, the homes, the rule files and the strategy keys of
// scripts/setup-claude-interactive.sh, which the step files in this directory read. Every string is
// copied from that script (the labels are the third argument of its `install_file` calls); the
// differential test compares the bytes later. Paths follow the contract in descriptor.ts: homes
// relative to the user home, `src` relative to the repository, `dest` relative to `homes.rulesDir`
// (the store's, to the user home).
//
// The shell order differs from the other CLIs on two points: the `claude` CLI check runs AFTER the
// link question (`prerequisites` follows `ensure-home`), and the catalogue selection runs AFTER the
// MCP registration (`rules-selection` follows `mcp`). There is no `66` org-rules file: Claude Code
// resolves `@AGENTS.org.md` natively.

import type { SetupDescriptor } from "./descriptor.ts";

export const claudeDescriptor: SetupDescriptor = {
  cli: "claude",
  banner: "Claude Code Configuration Setup",
  steps: [
    "banner",
    "link-confirm",
    "ensure-home",
    "prerequisites",
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
    "summary",
  ],
  homes: {
    cliHome: ".claude",
    rulesDir: ".claude/rules",
    skillsDir: ".claude/skills",
    agentsDir: ".claude/agents",
    settings: ".claude/settings.json",
    mcpConfig: ".claude.json",
  },
  rules: {
    existingGlob: "*.md",
    texts: {
      existingFound: "Existing rule files found in",
      actionHeader: "Existing rules detected — keep them (skip selection) or refresh from scratch?",
      keptMessage:
        "Keeping existing rules. Team / expertise / level / profile selection will be skipped.",
      removedMessage: "Existing rules removed. Full selection flow will run.",
    },
    sharedHeader: "Installing shared configuration...",
    shared: [
      {
        src: "config/ORGANIZATION.md",
        dest: "20-organization.md",
        label: "ORGANIZATION.md -> rules/20-organization.md",
      },
      {
        src: "artifacts/core/rules/60-tools.md",
        dest: "60-tools.md",
        label: "artifacts/core/rules/60-tools.md -> rules/60-tools.md",
      },
      {
        src: "config/TOOLS.md",
        dest: "65-org-tools.md",
        label: "TOOLS.md -> rules/65-org-tools.md",
      },
      {
        src: "artifacts/core/system-context",
        dest: ".crewrig/system-context",
        label: "artifacts/core/system-context -> ~/.crewrig/system-context",
      },
      {
        src: "config/SOUL.md",
        dest: "00-soul.md",
        label: "SOUL.md -> rules/00-soul.md",
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
        dest: "50-team.md",
        label: "teams/{name}.md -> rules/50-team.md",
      },
      expertise: {
        src: "config/expertise",
        dest: "40-expertise.md",
        label: "expertise/{name}.md -> rules/40-expertise.md",
      },
      level: {
        src: "config/level",
        dest: "10-level.md",
        label: "level/{name}.md -> rules/10-level.md",
      },
    },
    profile: {
      mode: "method",
      file: {
        src: "config/PROFILE.md",
        dest: "30-profile.md",
        label: "PROFILE.md -> rules/30-profile.md",
      },
    },
  },
  hooks: {
    channel: "settings",
    file: ".claude/settings.json",
    src: "hooks/claude-transcript-hooks.json",
    envPatch: true,
    unusedCopy: ".claude/hooks/mempalace-transcript.sh",
    leadingBlank: true,
  },
  strategies: { mcp: "claudeMcp", tiers: "standard", usageCapture: "settings" },
  storeGuidance: false,
  summary: {
    listHeader: "Active rule files:",
    listGlob: "*.md",
    mcpHeader: "MCP servers (from 'claude mcp list'):",
    mcpSource: "claude-mcp-list",
    note: "Note: MemPalace MCP server was NOT installed during this run.",
    restartLine: "Restart any running Claude Code session to pick up the new MCP servers.",
    extraLines: [],
  },
};
