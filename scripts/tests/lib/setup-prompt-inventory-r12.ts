// setup-prompt-inventory-r12.ts — the R12 table of spec 0256 as data (plan v2 step A8): per prompt id the
// options (the first is the default), the setups that ask it, the cancel class and the condition. The
// shell is the oracle, and the inventory test asserts the observed list of each row against this table.
import { CLIS } from "./setup-golden-types.ts";
import type { Cli } from "./setup-golden-types.ts";

export type Cancel = "abort" | "decline" | "default";

export interface Row {
  readonly id: string;
  /** The option names in order (the first is the default), or `@catalogue:<dir>` for the catalogue. */
  readonly options: readonly string[];
  readonly clis: readonly Cli[];
  readonly cancel: Cancel | Partial<Record<Cli, Cancel>>;
  readonly when: string;
}
const ALL = CLIS;
const row = (
  id: string,
  options: string[],
  clis: readonly Cli[],
  cancel: Row["cancel"],
  when: string,
): Row => ({
  id,
  options,
  clis,
  cancel,
  when,
});

export const R12: readonly Row[] = [
  row("rules-action", ["keep", "refresh"], ALL, "abort", "context files already installed"),
  row(
    "validation.backend",
    ["internal", "plannotator"],
    ALL,
    "default",
    "no VALIDATION_* variable is set",
  ),
  row("validation.translate", ["off", "on"], ALL, "default", "no VALIDATION_* variable is set"),
  row(
    "validation.pedagogy",
    ["contextual", "simple", "professor"],
    ALL,
    "default",
    "no VALIDATION_* variable is set",
  ),
  row("validation.illustration", ["off", "on"], ALL, "default", "no VALIDATION_* variable is set"),
  row(
    "tls-delegation",
    ["no", "yes"],
    ALL,
    "decline",
    "a custom-CA variable is set and TLS_DELEGATION is unset",
  ),
  row("mempalace-install", ["no", "yes"], ALL, "decline", "MemPalace not found and pipx on PATH"),
  row("install-seqthink", ["yes", "no"], ["claude", "antigravity"], "abort", "always"),
  row("legacy-mcp-removal", ["no", "yes"], ["claude"], "abort", "~/.claude/mcp.json exists"),
  row("install-settings", ["yes", "no"], ["claude"], "abort", "~/.claude/settings.json is absent"),
  row(
    "catalogue.team",
    ["@catalogue:config/teams"],
    ALL,
    "decline",
    "rules not kept and the catalogue is not empty",
  ),
  row(
    "catalogue.expertise",
    ["@catalogue:config/expertise"],
    ALL,
    "decline",
    "rules not kept and the catalogue is not empty",
  ),
  row(
    "catalogue.level",
    ["@catalogue:config/level"],
    ALL,
    "decline",
    "rules not kept and the catalogue is not empty",
  ),
  // Deviation from R12 ("all four", spec delta-02): the Copilot shell installs its profile unconditionally
  // (setup-copilot-interactive.sh:145), so it never asks.
  row(
    "profile-method",
    ["keep-local", "overwrite"],
    ["claude", "gemini", "antigravity"],
    "abort",
    "the local profile target differs (a non-regular target: a file there is a context file that the keep-or-refresh step removes first)",
  ),
  row("overlay.community", ["no", "yes"], ALL, "abort", "dist/community is built"),
  row("overlay.org", ["no", "yes"], ALL, "abort", "dist/org is built"),
  row(
    "transcripts",
    ["no", "yes"],
    ALL,
    { antigravity: "abort", claude: "decline", gemini: "decline", copilot: "decline" },
    "always",
  ),
  row(
    "transcripts-confirm",
    ["yes", "no"],
    ALL,
    { antigravity: "abort", claude: "decline", gemini: "decline", copilot: "decline" },
    "transcripts answered yes",
  ),
  row(
    "usage-capture",
    ["no", "yes"],
    ALL,
    { antigravity: "abort", claude: "decline", gemini: "decline", copilot: "decline" },
    "no capture registered",
  ),
  row(
    "usage-capture-keep",
    ["keep", "remove"],
    ALL,
    { antigravity: "abort", claude: "decline", gemini: "decline", copilot: "decline" },
    "a capture registered",
  ),
];
