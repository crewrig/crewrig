// setup-cli-claude-gemini-fixtures.ts — the shell reader, the step markers and the prompt table of
// the Claude and Gemini descriptor test (not a test file itself).

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import type { Cli } from "../lib/setup/context.ts";
import type { PickKind, SetupDescriptor, StepId } from "../lib/setup/descriptor.ts";

const REPO = path.resolve(import.meta.dirname, "..", "..");

export function shellOf(cli: Cli): string {
  return fs.readFileSync(path.join(REPO, "scripts", `setup-${cli}-interactive.sh`), "utf8");
}

/** The first match of `pattern` in the shell: a missing marker is a failure, never a pass. */
export function at(shell: string, pattern: RegExp, what: string): number {
  const found = shell.search(pattern);
  assert.notEqual(found, -1, `marker not found in the shell: ${what}`);
  return found;
}

export function has(shell: string, text: string): boolean {
  return shell.includes(text);
}

export const escape = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** One marker per step id: where the shell runs it (the order is the order of the positions). */
export function markers(cli: Cli, d: SetupDescriptor): Record<StepId, RegExp | undefined> {
  const none = undefined;
  return {
    banner: new RegExp(escape(`echo "  ${d.banner}"`)),
    "link-confirm": /Continue with symlink mode\?/,
    "ensure-home": /^mkdir -p "\$(CLAUDE_RULES|GEMINI_HOME)"$/m,
    prerequisites: cli === "claude" ? /command -v claude >\/dev\/null/ : none,
    "identity-check": /check_finalized "\$REPO_DIR\/config\/SOUL\.md"/,
    "rules-existing": /^SKIP_RULES_CONFIG=0$/m,
    "rules-shared": /^echo "Installing shared configuration\.\.\."$/m,
    "tls-offer": /^offer_tls_delegation$/m,
    "deps-install": /^install_production_dependencies "\$REPO_DIR"/m,
    mcp:
      cli === "claude" ? /Configuring MCP servers via/ : /Configuring ~\/\.gemini\/settings\.json/,
    "rules-selection": /^echo "Select your team:"$/m,
    tiers: /^echo "Installing library components to/m,
    "hooks-rewrite-installed": new RegExp(`^guard_rewrite_installed ${cli} `, "m"),
    "session-recording": /Enable automatic session recording to MemPalace/,
    "usage-capture": new RegExp(`UC_STATE="\\$\\(usage_capture_state ${cli} `),
    "session-check": /session-check-hooks\.ts" register/,
    "legacy-context-cleanup": cli === "gemini" ? /^LEGACY_GEMINI_MD=/m : none,
    summary: /^echo "  Setup complete"$/m,
    "copilot-workspace-files": none,
    "mcp-prepare": none,
    "migrate-superseded": none,
    "system-context-file": none,
  };
}

// The prompts each step can ask, per CLI (the questions of the shell blocks of the step table).
export const ASKS: Readonly<Record<string, readonly string[]>> = {
  "link-confirm": ["link-confirm"],
  "rules-existing": ["rules-action"],
  "rules-shared": [
    "validation.backend",
    "validation.translate",
    "validation.pedagogy",
    "validation.illustration",
  ],
  "tls-offer": ["tls-delegation"],
  "rules-selection": ["catalogue.team", "catalogue.expertise", "catalogue.level", "profile-method"],
  tiers: ["overlay.community", "overlay.org"],
  "session-recording": ["transcripts", "transcripts-confirm"],
  "usage-capture": ["usage-capture", "usage-capture-keep"],
};
export const ASKS_MCP: Readonly<Record<string, readonly string[]>> = {
  claude: ["install-seqthink", "mempalace-install", "legacy-mcp-removal", "install-settings"],
  gemini: ["mempalace-install"],
};

export function dirOf(kind: PickKind): string {
  return kind === "team" ? "teams" : kind;
}
