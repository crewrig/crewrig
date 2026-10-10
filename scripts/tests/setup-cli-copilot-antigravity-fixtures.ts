// setup-cli-copilot-antigravity-fixtures.ts — the descriptor table and the prompt derivation of the
// Copilot and Antigravity descriptor tests (not a test file itself).

import { antigravityDescriptor } from "../lib/setup/cli-antigravity.ts";
import { copilotDescriptor } from "../lib/setup/cli-copilot.ts";
import type { Cli } from "../lib/setup/context.ts";
import type { SetupDescriptor } from "../lib/setup/descriptor.ts";

export const CASES: readonly (readonly [Cli, SetupDescriptor])[] = [
  ["copilot", copilotDescriptor],
  ["antigravity", antigravityDescriptor],
];

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
