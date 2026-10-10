// catalogue.ts — the team / expertise / level picker of the setup graph (spec 0256 requirements 11
// and 17), the replacement of `pick_catalogue_entry` in scripts/lib/common.sh and of its
// `fzf --preview "head -20 <dir>/{}.md"`.
//
// The entries are the `*.md` files of the catalogue directory (dot files excluded, as the shell
// glob does), named without the suffix and sorted ORDINALLY (UTF-16 code units, never by locale).
// The user may answer `?N` to print the first 20 lines of entry N (1-based, as numbered by the
// prompt) and is then asked again.
//
// Session contract (what `createSession` of ./prompt.ts must satisfy): `choose(question)` of
// `PromptSession` already fits, with ONE extension, the optional `passthrough` predicate of the
// question: a line typed by the user for which `passthrough(line)` is true SHALL be returned
// verbatim, before it is matched against the options and without counting as an invalid answer
// (a pre-answer from `--answer` is returned verbatim too, as today). `undefined` is returned only
// for a cancelled `decline` question. Without that extension everything but `?N` works.

import fs from "node:fs";
import path from "node:path";

import type { Io } from "../extension/types.ts";
import { SetupExit } from "./exit.ts";
import { invalidAnswerMessage } from "./prompt.ts";
import type { Question } from "./prompt.ts";

/** A catalogue question: a plain question plus the lines the picker handles itself (`?N`). */
export interface CatalogueQuestion extends Question {
  readonly cancel: "decline";
  readonly passthrough?: (line: string) => boolean;
}

/** The part of `PromptSession` the picker needs. */
export interface CatalogueSession {
  choose(question: CatalogueQuestion): Promise<string | undefined>;
}

export interface CatalogueRequest {
  /** The prompt id: `catalogue.team`, `catalogue.expertise` or `catalogue.level`. */
  readonly id: string;
  /** The catalogue directory (absolute). */
  readonly dir: string;
  /** The category as the shell printed it: `team`, `expertise` or `level`. */
  readonly label: string;
  readonly io: Io;
  /** The question header; defaults to a line naming the category and the `?N` preview. */
  readonly header?: string;
}

const PREVIEW_LINES = 20;
const PREVIEW_ASK = /^\?\s*([0-9]+)$/;

/** The basenames (without `.md`) of the `*.md` entries of `dir`, ordinally sorted; empty when `dir` is missing. */
export function catalogueEntries(dir: string): string[] {
  let names: string[];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return [];
  }
  return names
    .filter((name) => name.endsWith(".md") && !name.startsWith(".") && name.length > 3)
    .map((name) => name.slice(0, -3))
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

/** The first 20 lines of a file, as `head -20` prints them; `undefined` when it cannot be read. */
export function previewOf(file: string): string[] | undefined {
  let text: string;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    return undefined;
  }
  const lines = text.split("\n");
  if (lines[lines.length - 1] === "") lines.pop();
  return lines.slice(0, PREVIEW_LINES);
}

/**
 * Ask which entry of the catalogue to install. Returns the chosen basename, or `undefined` for an
 * empty catalogue (nothing is asked) and for a declined pick: the shell printed an explanation on
 * stderr and returned status 0 with an empty result in both cases, and so does this.
 */
export async function pickCatalogueEntry(
  session: CatalogueSession,
  request: CatalogueRequest,
): Promise<string | undefined> {
  const { id, dir, label, io } = request;
  const options = catalogueEntries(dir);
  if (options.length === 0) {
    io.err(`No ${label} catalogue entries found under ${dir} — skipping ${label} selection.`);
    return undefined;
  }
  const header = request.header ?? `Select your ${label} (type ?N to preview entry N)`;
  for (;;) {
    const answer = await session.choose({
      id,
      header,
      options,
      cancel: "decline",
      passthrough: (line) => PREVIEW_ASK.test(line.trim()),
    });
    const ask = answer === undefined ? null : PREVIEW_ASK.exec(answer.trim());
    if (ask !== null) {
      const n = Number(ask[1]);
      const entry = options[n - 1];
      const lines = entry === undefined ? undefined : previewOf(path.join(dir, `${entry}.md`));
      if (lines === undefined) io.err(`  No entry ${n} (choose 1-${options.length}).`);
      else for (const line of lines) io.out(line);
      continue;
    }
    if (answer === undefined || answer === "") {
      io.err(`No ${label} selected — skipping ${label} selection.`);
      return undefined;
    }
    if (!options.includes(answer)) {
      io.err(invalidAnswerMessage(id, options));
      throw new SetupExit(2, invalidAnswerMessage(id, options));
    }
    return answer;
  }
}
