// setup-cli-copilot-antigravity-fixtures.ts — the shell-marker table and the prompt derivation of the
// Copilot and Antigravity descriptor tests (not a test file itself).

import fs from "node:fs";
import path from "node:path";

import { antigravityDescriptor } from "../lib/setup/cli-antigravity.ts";
import { copilotDescriptor } from "../lib/setup/cli-copilot.ts";
import type { Cli } from "../lib/setup/context.ts";
import type { SetupDescriptor, StepId } from "../lib/setup/descriptor.ts";

export const CASES: readonly (readonly [Cli, SetupDescriptor])[] = [
  ["copilot", copilotDescriptor],
  ["antigravity", antigravityDescriptor],
];

export const SCRIPTS = path.resolve(import.meta.dirname, "..");

export const shellOf = (cli: Cli): string =>
  fs.readFileSync(path.join(SCRIPTS, `setup-${cli}-interactive.sh`), "utf8");

/** The unique marker of each step in the shell, in the order the descriptor must list them. */
export const MARKERS: Readonly<Record<string, readonly (readonly [StepId, RegExp])[]>> = {
  copilot: [
    ["banner", /echo "  GitHub Copilot CLI Setup"/],
    ["prerequisites", /Warning: GitHub Copilot CLI not detected/],
    ["identity-check", /check_finalized "\$REPO_DIR\/config\/SOUL\.md"/],
    ["copilot-workspace-files", /WORKSPACE_SETTINGS="/],
    ["rules-existing", /INSTR_ACTION=/],
    ["rules-shared", /Installing shared layered context to/],
    ["rules-selection", /echo "Select your experience level:"/],
    ["tls-offer", /^offer_tls_delegation/m],
    ["deps-install", /^install_production_dependencies/m],
    ["mcp", /echo "Configuring ~\/\.copilot\/mcp-config\.json\.\.\."/],
    ["tiers", /echo "Installing library skills to/],
    ["hooks-rewrite-installed", /^guard_rewrite_installed copilot/m],
    ["session-recording", /ENABLE_TRANSCRIPTS=/],
    ["usage-capture", /usage_capture_state copilot/],
    ["session-check", /session-check-hooks\.ts" register copilot/],
    ["summary", /echo "  Setup complete"/],
  ],
  antigravity: [
    ["banner", /echo "  Antigravity CLI Configuration Setup"/],
    ["prerequisites", /'agy' binary not found/],
    ["link-confirm", /Continue with symlink mode\?/],
    ["ensure-home", /^mkdir -p "\$AGY_HOME"/m],
    ["identity-check", /check_finalized "\$REPO_DIR\/config\/SOUL\.md"/],
    ["rules-existing", /RULES_ACTION=/],
    ["rules-shared", /echo "Installing shared configuration\.\.\."/],
    ["mcp-prepare", /echo "Configuring \$AGY_MCP_CONFIG\.\.\."/],
    ["tls-offer", /^offer_tls_delegation/m],
    ["deps-install", /^install_production_dependencies/m],
    ["mcp", /^backup_file "\$AGY_MCP_CONFIG"/m],
    ["rules-selection", /echo "Select your team:"/],
    ["tiers", /echo "Installing library components to/],
    ["migrate-superseded", /Migrating components left at the superseded placement/],
    ["hooks-rewrite-installed", /^guard_rewrite_installed antigravity/m],
    ["session-recording", /ENABLE_TRANSCRIPTS=/],
    ["usage-capture", /^AGY_SETTINGS="/m],
    ["session-check", /session-check-hooks\.ts" register antigravity/],
    ["system-context-file", /echo "Generating \$GEMINI_MD_TARGET\.\.\."/],
    ["summary", /echo "  Setup complete"/],
  ],
};

const MCP_PROMPTS = {
  claudeMcp: ["mempalace-install", "install-seqthink", "legacy-mcp-removal", "install-settings"],
  geminiMcp: ["mempalace-install"],
  copilotMcp: ["mempalace-install"],
  antigravityMcp: ["mempalace-install", "install-seqthink"],
} as const;

/** Every prompt id a descriptor's steps can ask. */
export function asked(d: SetupDescriptor): Set<string> {
  const ids = new Set<string>();
  for (const step of d.steps) {
    if (step === "link-confirm") ids.add("link-confirm");
    if (step === "rules-existing") ids.add("rules-action");
    if (step === "rules-shared")
      for (const k of ["backend", "translate", "pedagogy", "illustration"])
        ids.add(`validation.${k}`);
    if (step === "rules-selection") {
      for (const kind of d.rules.pickOrder) ids.add(`catalogue.${kind}`);
      if (d.rules.profile.mode === "method") ids.add("profile-method");
    }
    if (step === "tls-offer") ids.add("tls-delegation");
    if (step === "mcp") for (const id of MCP_PROMPTS[d.strategies.mcp]) ids.add(id);
    if (step === "tiers") ["overlay.community", "overlay.org"].forEach((id) => ids.add(id));
    if (step === "session-recording")
      ["transcripts", "transcripts-confirm"].forEach((id) => ids.add(id));
    if (step === "usage-capture")
      ["usage-capture", "usage-capture-keep"].forEach((id) => ids.add(id));
  }
  return ids;
}
