// setup-prompt-inventory-conditions.ts — the "asked when" condition of each R12 row as scenario cells
// (spec 0256 requirement 12, plan v2 step A8): per prompt id, the scenarios of
// `setup-prompt-inventory-cases.ts` where the shell MUST ask it (its condition holds) and where it
// MUST NOT (its condition is false). A row with no false-condition scenario is not listed in `NOT`.
// API: ASKED[id], NOT[id] -> scenario names; every cell is checked for the setups of the row only.

/** Scenario names: `full`, `rules`, `tier-community`, `tier-org`, `usage-keep`. */
export const ASKED: Readonly<Record<string, readonly string[]>> = {
  "rules-action": ["rules"],
  "tls-delegation": ["full"],
  "mempalace-install": ["full", "rules"],
  "install-seqthink": ["full"],
  "legacy-mcp-removal": ["full"],
  "profile-method": ["full"],
  "catalogue.team": ["full"],
  "catalogue.expertise": ["full"],
  "catalogue.level": ["full"],
  "overlay.community": ["full", "tier-community"],
  "overlay.org": ["full", "tier-org"],
  transcripts: ["full", "rules", "tier-community", "tier-org"],
  "transcripts-confirm": ["full"],
  "usage-capture": ["full"],
  "usage-capture-keep": ["usage-keep"],
};

export const NOT: Readonly<Record<string, readonly string[]>> = {
  "rules-action": ["full", "tier-community", "tier-org"],
  "tls-delegation": ["rules", "tier-community", "tier-org"],
  "legacy-mcp-removal": ["rules", "tier-community", "tier-org"],
  "profile-method": ["rules", "tier-community", "tier-org"],
  "catalogue.team": ["rules"],
  "catalogue.expertise": ["rules"],
  "catalogue.level": ["rules"],
  "overlay.community": ["rules", "tier-org"],
  "overlay.org": ["rules", "tier-community"],
  "transcripts-confirm": ["rules", "tier-community", "tier-org"],
  "usage-capture": ["usage-keep"],
  "usage-capture-keep": ["full", "rules", "tier-community", "tier-org"],
};
