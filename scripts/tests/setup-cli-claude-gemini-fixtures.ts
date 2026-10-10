// setup-cli-claude-gemini-fixtures.ts — the prompt table of the Claude and Gemini descriptor test
// (not a test file itself).

import type { PickKind } from "../lib/setup/descriptor.ts";

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
