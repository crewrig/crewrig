// setup-golden-questions.ts — WHICH questions a setup run asked, in what order and with what
// answer: the evidence that tagged deviations (f) and (a)/(b) would otherwise remove (finding
// review/1335 i1-F17). The `ts` leg drops every `[answer] <id>=<value>` stdout line (tag f) and
// the `fzf` records of the tree (tags a/b), so those two removals together left nothing that said
// which questions the TypeScript run asked. This module keeps the evidence, compared by SEQUENCE:
//
//   shell side   the `fzf` records of the shell leg (or of the stored `tree.json.golden`): each
//                record's header is mapped to its question id through the OBSERVED inventory
//                (fixtures/setup-golden/prompt-inventory.json.golden, the shell's own header text),
//                with the answer the stub gave (a cancelled record: the value the harness
//                translation gives a cancel, see `cancelledValue`);
//   ts side      the `[answer] <id>=<value>` echo lines of the TypeScript stdout, in order.
//
// The two lists must be equal; nothing is removed from either: `link-confirm` is the one question
// the shell reads from piped stdin (never an fzf record) and the harness never pre-answers it, so
// it appears on neither side, and Copilot asks neither `link-confirm` nor `profile-method` (the
// prompt inventory), so neither can appear on either side of a Copilot cell. An unmapped fzf
// header is kept as `?<header>`: it can match nothing, so the cell fails instead of passing.
// API: askedByShell(cli, fzfRecords), askedByTs(stdout), fzfOfTree(treeJson), QUESTIONS_FILE.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { cancelClassOf, PROMPT_INVENTORY } from "../../lib/setup/prompt-ids.ts";
import type { Cli } from "./setup-golden-types.ts";

/** The name of the comparison this module adds to the four golden files in reports. */
export const QUESTIONS_FILE = "questions";

/** The part of an `fzf` record the sequence needs (the shell stub's record, stored or live). */
export interface AskedRecord {
  readonly header: string;
  readonly answer: string;
  readonly cancelled: boolean;
}

const INVENTORY_GOLDEN = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../fixtures/setup-golden/prompt-inventory.json.golden",
);

/** What the harness translation answers for a cancelled `decline`-class `usage-capture-keep`. */
const DECLINE_OPTION: Readonly<Record<string, string>> = { "usage-capture-keep": "keep" };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

let idByHeader: ReadonlyMap<string, ReadonlyMap<string, string>> | undefined;

/** cli -> shell header -> question id, from the observed inventory golden. */
function headerIds(): ReadonlyMap<string, ReadonlyMap<string, string>> {
  if (idByHeader !== undefined) return idByHeader;
  const parsed: unknown = JSON.parse(fs.readFileSync(INVENTORY_GOLDEN, "utf8"));
  if (!Array.isArray(parsed)) throw new Error(`${INVENTORY_GOLDEN}: expected a JSON array`);
  const out = new Map<string, Map<string, string>>();
  for (const entry of parsed as readonly unknown[]) {
    if (!isRecord(entry) || typeof entry["id"] !== "string") continue;
    const header = entry["header"];
    const clis = Array.isArray(entry["clis"]) ? entry["clis"].map(String) : [];
    for (const cli of clis) {
      const text = typeof header === "string" ? header : isRecord(header) ? header[cli] : undefined;
      if (typeof text !== "string") continue;
      const perCli = out.get(cli) ?? new Map<string, string>();
      perCli.set(text, entry["id"]);
      out.set(cli, perCli);
    }
  }
  idByHeader = out;
  return out;
}

/**
 * The value the TypeScript leg is given for a question the shell run cancelled (the same rule as
 * the answer translation of setup-golden-answers.ts: a catalogue gets the empty value, `decline`
 * its declining option, `default` its first option). An `abort` cancel has no answer form, so the
 * marker below can match nothing: such a cell is shell-only.
 */
function cancelledValue(id: string, cli: Cli): string {
  const row = PROMPT_INVENTORY.find((r) => r.id === id);
  if (row === undefined) return "<cancelled>";
  if (row.catalogue !== undefined) return "";
  const kind = cancelClassOf(id, cli);
  if (kind === "decline")
    return DECLINE_OPTION[id] ?? (row.options.includes("no") ? "no" : (row.options[0] ?? ""));
  return kind === "default" ? (row.options[0] ?? "") : "<cancelled>";
}

/** The `<id>=<value>` list the shell leg's fzf records stand for, in the order they were asked. */
export function askedByShell(cli: Cli, records: readonly AskedRecord[]): readonly string[] {
  const ids = headerIds().get(cli);
  return records.map((r) => {
    const id = ids?.get(r.header) ?? `?${r.header}`;
    return `${id}=${r.cancelled ? cancelledValue(id, cli) : r.answer}`;
  });
}

const ECHO = /^\[answer\] ([^=\n]+)=(.*)$/;

/** The `<id>=<value>` list of the `[answer]` echo lines of a TypeScript stdout, in order. */
export function askedByTs(stdout: string): readonly string[] {
  return stdout.split("\n").flatMap((line) => {
    const found = ECHO.exec(line);
    return found === null ? [] : [`${found[1]}=${found[2]}`];
  });
}

/** The `fzf` records of a stored `tree.json.golden` text (the fixtures already hold them). */
export function fzfOfTree(treeJson: string): readonly AskedRecord[] {
  const parsed: unknown = JSON.parse(treeJson);
  const rows: unknown = isRecord(parsed) ? parsed["fzf"] : undefined;
  if (!Array.isArray(rows)) throw new Error("tree.json: no fzf array");
  return rows.flatMap((row: unknown) =>
    isRecord(row)
      ? [
          {
            header: String(row["header"]),
            answer: String(row["answer"]),
            cancelled: row["cancelled"] === true,
          },
        ]
      : [],
  );
}
