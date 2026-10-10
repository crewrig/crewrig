// prompt-ids.ts — the closed inventory of the setup questions (spec 0256 requirement 12, as
// corrected by delta-02). Frozen data: a stable id per question, its options (the first is the
// default), the setups that ask it and, per setup, the cancel class of requirement 15. The source
// of truth for the askers and the cancel classes is what the shell does, recorded by the oracle in
// `scripts/tests/fixtures/setup-golden/prompt-inventory.json.golden`; the pin test compares both.

import { CLIS } from "./context.ts";
import type { Cli } from "./context.ts";

/**
 * What a cancelled question does: `decline` continues as a decline or a skip, `default` takes the
 * first option, `abort` exits 130, `none` is the one-key `link-confirm` (exit 1 as the shell does).
 */
export type CancelClass = "decline" | "default" | "abort" | "none";

export interface PromptRow {
  readonly id: string;
  /** The option names, first = default. Empty for a catalogue question (see `catalogue`). */
  readonly options: readonly string[];
  /** A catalogue question: the repository-relative directory whose entries are the options. */
  readonly catalogue?: string;
  /** The setups that ask the question. */
  readonly clis: readonly Cli[];
  /** The cancel class per asking setup (it may differ by setup). */
  readonly cancel: Readonly<Partial<Record<Cli, CancelClass>>>;
}

const YES_NO = ["no", "yes"] as const;

function row(
  id: string,
  options: readonly string[],
  clis: readonly Cli[],
  cancel: CancelClass | Readonly<Partial<Record<Cli, CancelClass>>>,
  catalogue?: string,
): PromptRow {
  const perCli: Partial<Record<Cli, CancelClass>> = {};
  for (const cli of clis) perCli[cli] = typeof cancel === "string" ? cancel : cancel[cli];
  const base = { id, options: Object.freeze([...options]), clis: Object.freeze([...clis]) };
  return Object.freeze({
    ...base,
    ...(catalogue === undefined ? {} : { catalogue }),
    cancel: Object.freeze(perCli),
  });
}

/** Antigravity aborts where the three other setups decline (the recording and usage questions). */
const AG_ABORT = {
  claude: "decline",
  gemini: "decline",
  copilot: "decline",
  antigravity: "abort",
} as const;
const CG = ["claude", "gemini", "antigravity"] as const;

export const PROMPT_INVENTORY: readonly PromptRow[] = Object.freeze([
  row("link-confirm", YES_NO, CG, "none"),
  row("rules-action", ["keep", "refresh"], CLIS, "abort"),
  row("validation.backend", ["internal", "plannotator"], CLIS, "default"),
  row("validation.translate", ["off", "on"], CLIS, "default"),
  row("validation.pedagogy", ["contextual", "simple", "professor"], CLIS, "default"),
  row("validation.illustration", ["off", "on"], CLIS, "default"),
  row("tls-delegation", YES_NO, CLIS, "decline"),
  row("mempalace-install", YES_NO, CLIS, "decline"),
  row("install-seqthink", ["yes", "no"], ["claude", "antigravity"], "abort"),
  row("legacy-mcp-removal", YES_NO, ["claude"], "abort"),
  row("install-settings", ["yes", "no"], ["claude"], "abort"),
  row("catalogue.team", [], CLIS, "decline", "config/teams"),
  row("catalogue.expertise", [], CLIS, "decline", "config/expertise"),
  row("catalogue.level", [], CLIS, "decline", "config/level"),
  row("profile-method", ["keep-local", "overwrite"], CG, "abort"),
  row("overlay.community", YES_NO, CLIS, "abort"),
  row("overlay.org", YES_NO, CLIS, "abort"),
  row("transcripts", YES_NO, CLIS, AG_ABORT),
  row("transcripts-confirm", ["yes", "no"], CLIS, AG_ABORT),
  row("usage-capture", YES_NO, CLIS, AG_ABORT),
  row("usage-capture-keep", ["keep", "remove"], CLIS, AG_ABORT),
]);

const BY_ID: ReadonlyMap<string, PromptRow> = new Map(PROMPT_INVENTORY.map((r) => [r.id, r]));

export function isPromptId(id: unknown): id is string {
  return typeof id === "string" && BY_ID.has(id);
}

/** The row of `id`; throws on an id outside the inventory (callers check `isPromptId` first). */
export function rowOf(id: string): PromptRow {
  const found = BY_ID.get(id);
  if (found === undefined) throw new Error(`unknown prompt id: ${id}`);
  return found;
}

/** The cancel class of `id` for `cli`, or `undefined` when that setup does not ask the question. */
export function cancelClassOf(id: string, cli: Cli): CancelClass | undefined {
  return rowOf(id).cancel[cli];
}
