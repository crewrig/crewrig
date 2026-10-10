// cli-copilot.ts — the descriptor of the Copilot CLI setup (spec 0256 requirements 3 and 6, plan v2
// step B3b.1, task T8b): PURE DATA, every wording copied verbatim from scripts/setup-copilot-
// interactive.sh. The flow (flow.ts) and the step files read it; nothing here runs.
//
// What makes Copilot differ from the three other setups (delta-02):
// - no `link-confirm` question and no `ensure-home` step: `rules-existing` creates the instructions
//   directory itself (`rules.mkdirInExisting`, shell line 116); `--link` is still parsed by the flow;
// - the profile is a plain install inside `rules-shared` (`profile.mode: 'direct'`, no
//   `profile-method` question) and the catalogue picks run level, expertise, team;
// - skills only (no `agentsDir`): Copilot looks for agents under `.github/agents/` of a workspace;
// - the hooks live in a flat user-level JSON file, `~/.copilot/hooks/copilot-transcript-hooks.json`.
// `copilot-workspace-files` (shell 87-107) is a step id that no step file registers yet.

import type { RuleFile, SetupDescriptor } from "./descriptor.ts";

const INSTRUCTIONS = ".copilot/instructions";

/** One instruction file; `src` is repository-relative, `dest` is relative to `homes.rulesDir`. */
function file(src: string, labelSrc: string, dest: string): RuleFile {
  return { src, dest, label: `${labelSrc} -> instructions/${dest}` };
}

/** A catalogue selection: `src` is the catalogue directory and `{name}` the chosen entry. */
function selection(dir: string, short: string, dest: string): RuleFile {
  return { src: `config/${dir}`, dest, label: `${short}/{name}.md -> instructions/${dest}` };
}

const profile = file("config/PROFILE.md", "PROFILE.md", "30-profile.instructions.md");

const store: RuleFile = {
  src: "artifacts/core/system-context",
  dest: ".crewrig/system-context",
  label: "artifacts/core/system-context -> ~/.crewrig/system-context",
};

export const copilotDescriptor: SetupDescriptor = {
  cli: "copilot",
  banner: "GitHub Copilot CLI Setup",
  steps: [
    "banner",
    "prerequisites",
    "identity-check",
    "copilot-workspace-files",
    "rules-existing",
    "rules-shared",
    "rules-selection",
    "tls-offer",
    "deps-install",
    "mcp",
    "tiers",
    "hooks-rewrite-installed",
    "session-recording",
    "usage-capture",
    "session-check",
    "summary",
  ],
  homes: {
    cliHome: ".copilot",
    rulesDir: INSTRUCTIONS,
    skillsDir: ".copilot/skills",
    mcpConfig: ".copilot/mcp-config.json",
  },
  rules: {
    existingGlob: "*.instructions.md",
    texts: {
      existingFound: "Existing instruction files found in",
      actionHeader:
        "Existing instructions detected — keep them (skip selection) or refresh from scratch?",
      keptMessage:
        "Keeping existing instructions. Team / expertise / level selection will be skipped.",
      removedMessage: "Existing instructions removed. Full selection flow will run.",
    },
    sharedHeader: "Installing shared layered context to {dir} ...",
    // The shell's order: soul, organization, profile, 60, 65, store, 66 (when present).
    shared: [
      file("config/SOUL.md", "SOUL.md", "00-soul.instructions.md"),
      file("config/ORGANIZATION.md", "ORGANIZATION.md", "20-organization.instructions.md"),
      profile,
      file(
        "artifacts/core/rules/60-tools.md",
        "artifacts/core/rules/60-tools.md",
        "60-tools.instructions.md",
      ),
      file("config/TOOLS.md", "TOOLS.md", "65-org-tools.instructions.md"),
      store,
      {
        ...file("AGENTS.org.md", "AGENTS.org.md", "66-org-rules.instructions.md"),
        optional: true,
      },
    ],
    store,
    pickOrder: ["level", "expertise", "team"],
    selections: {
      team: selection("teams", "teams", "50-team.instructions.md"),
      expertise: selection("expertise", "expertise", "40-expertise.instructions.md"),
      level: selection("level", "level", "10-level.instructions.md"),
    },
    profile: { mode: "direct", file: profile },
    mkdirInExisting: true,
  },
  hooks: {
    channel: "user-json",
    file: ".copilot/hooks/copilot-transcript-hooks.json",
    src: "hooks/copilot-transcript-hooks.json",
    envPatch: false,
    unusedCopy: ".copilot/hooks/mempalace-transcript.sh",
    leadingBlank: false,
  },
  strategies: { mcp: "copilotMcp", tiers: "standard", usageCapture: "user-hooks-json" },
  storeGuidance: true,
  summary: {
    listHeader: "Active user-level instruction files:",
    listGlob: "*.instructions.md",
    mcpHeader: "MCP servers (from mcp-config.json):",
    mcpSource: "mcp-config.json",
    // No MemPalace note and no restart line: the Copilot shell prints neither.
    extraLines: [
      "Copilot looks for skills under .github/skills/ and agents under .github/agents/.",
      "Run 'bash scripts/build-components.sh --target copilot' to (re)generate them.",
      "",
      "Transcript hooks are installed at two levels:",
      "  - User-level (~/.copilot/hooks/copilot-transcript-hooks.json): fires for ALL projects.",
      "  - Workspace-level (.github/copilot/settings.json): fires for this repo only.",
      "",
      "Note: GitHub Copilot CLI does NOT export a $COPILOT_PROJECT_DIR — hooks",
      "read the workspace path from the stdin JSON payload (or fall back to $PWD).",
    ],
  },
};
