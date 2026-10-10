// setup-golden-answers.ts — the answer translation of the TypeScript leg of the golden matrix
// (spec 0256 requirement 7, plan v2 step C4). A golden case describes its decisions for the SHELL
// leg as an fzf table (header substring -> option, or CANCEL) plus piped stdin; the TypeScript
// setup has no fzf and reads `--answer <id>=<value>` instead. `translateAnswers` turns the first
// into the second so both legs take the same decisions:
//
//   - the headers come from the observed prompt inventory (the shell's own header text), the ids,
//     options and cancel classes from `PROMPT_INVENTORY`;
//   - an id is answered by the FIRST table key contained in its header (the stub's own rule), else
//     by its first option (the stub's unscripted default);
//   - CANCEL: a catalogue question gets the empty value (the decline path), a `decline`-class
//     question its declining option, a `default`-class one its first option. An `abort`-class
//     cancel (exit 130) has no argv or stdin form on a non-terminal, so it is left unanswered and
//     the cell must be tagged `shellOnly`;
//   - `link-confirm` is the one-key question the piped stdin answers: it never gets an `--answer`.
//
// The answer set is a superset (every question the CLI can ask); the harness drops the ids the run
// reports as not asked (`unusedIds`) and runs again, so the stderr compared is the setup's own.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { cancelClassOf, PROMPT_INVENTORY } from "../../lib/setup/prompt-ids.ts";
import type { PromptRow } from "../../lib/setup/prompt-ids.ts";
import { CANCEL } from "./setup-stubs.ts";
import type { Cli, GoldenCase } from "./setup-golden-types.ts";

const INVENTORY_GOLDEN = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../fixtures/setup-golden/prompt-inventory.json.golden",
);

/** The questions the piped stdin answers instead of `--answer` (the one-key question, with or without stdin). */
const STDIN_IDS: readonly string[] = ["link-confirm"];

/** The option a `decline`-class cancel stands for, when it is not the plain `no`. */
const DECLINE_OPTION: Readonly<Record<string, string>> = { "usage-capture-keep": "keep" };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

let headerCache: ReadonlyMap<string, string | Readonly<Record<string, string>>> | undefined;

/** The shell header of every question id, from the observed inventory golden. */
function headers(): ReadonlyMap<string, string | Readonly<Record<string, string>>> {
  if (headerCache !== undefined) return headerCache;
  const parsed: unknown = JSON.parse(fs.readFileSync(INVENTORY_GOLDEN, "utf8"));
  if (!Array.isArray(parsed)) throw new Error(`${INVENTORY_GOLDEN}: expected a JSON array`);
  const out = new Map<string, string | Readonly<Record<string, string>>>();
  for (const entry of parsed as readonly unknown[]) {
    if (!isRecord(entry)) continue;
    const id = entry["id"];
    const header = entry["header"];
    if (typeof id !== "string") continue;
    if (typeof header === "string") out.set(id, header);
    else if (isRecord(header)) {
      const perCli: Record<string, string> = {};
      for (const [cli, text] of Object.entries(header)) {
        if (typeof text === "string") perCli[cli] = text;
      }
      out.set(id, perCli);
    }
  }
  headerCache = out;
  return out;
}

/** The header text of `id` as `cli`'s shell prints it (placeholders `<HOME>` and `<REPO>` kept). */
function headerOf(id: string, cli: Cli): string {
  const header = headers().get(id);
  if (header === undefined) throw new Error(`setup-golden-answers: no header recorded for '${id}'`);
  const text = typeof header === "string" ? header : header[cli];
  if (text === undefined) throw new Error(`setup-golden-answers: no '${cli}' header for '${id}'`);
  return text;
}

/** The value of `--answer` for a cancelled question of `row`, or `undefined` when none exists. */
function cancelValue(row: PromptRow, cli: Cli): string | undefined {
  if (row.catalogue !== undefined) return "";
  switch (cancelClassOf(row.id, cli)) {
    case "decline":
      return DECLINE_OPTION[row.id] ?? (row.options.includes("no") ? "no" : row.options[0]);
    case "default":
      return row.options[0];
    default:
      return undefined;
  }
}

/** The decision of the fzf table for one question: its answer, the cancel marker or none. */
function tableAnswer(table: Readonly<Record<string, string>>, header: string): string | undefined {
  for (const [key, answer] of Object.entries(table)) {
    if (key !== "" && header.includes(key)) return answer;
  }
  return undefined;
}

/**
 * The `--answer id=value` arguments (flat: `--answer`, `id=value`, ...) that give the TypeScript
 * leg of `c` the decisions the shell leg takes from the case's fzf table and stdin.
 */
export function translateAnswers(c: GoldenCase): readonly string[] {
  const table = c.stubs?.fzf ?? {};
  const args: string[] = [];
  for (const row of PROMPT_INVENTORY) {
    if (!row.clis.includes(c.cli)) continue;
    if (STDIN_IDS.includes(row.id)) continue;
    const picked = tableAnswer(table, headerOf(row.id, c.cli));
    const value = picked === CANCEL ? cancelValue(row, c.cli) : (picked ?? row.options[0]);
    if (value !== undefined) args.push("--answer", `${row.id}=${value}`);
  }
  return args;
}

const UNUSED = /^Warning: --answer given for a question that was not asked: (.+)$/m;

/** The ids a run reports as answered but never asked (from its stderr), or an empty list. */
export function unusedIds(stderr: string): readonly string[] {
  const found = UNUSED.exec(stderr);
  return found?.[1] === undefined ? [] : found[1].split(",").map((id) => id.trim());
}

/** `args` (from `translateAnswers`) without the pairs naming one of `ids`. */
export function withoutIds(args: readonly string[], ids: readonly string[]): readonly string[] {
  const out: string[] = [];
  for (let i = 0; i + 1 < args.length; i += 2) {
    const pair = args[i + 1] ?? "";
    if (!ids.includes(pair.slice(0, pair.indexOf("=")))) out.push(args[i] ?? "", pair);
  }
  return out;
}
