// prompt.ts — the one prompter of the setup graph (spec 0256 requirements 11 and 13-15).
//
// A question is answered, in order, by a pre-answer (`--answer id=value`, echoed, never asked), or
// by a line of the shared queue: the option's number or its name, case-insensitive. The terminal
// state changes only a blank line (first option on a terminal, an error otherwise), the retries
// (three on a terminal, none otherwise) and the end of input (the cancel class on a terminal, the
// fail-closed error otherwise). Nothing here calls `process.exit` or reads the process streams.

import type { Io } from "../extension/types.ts";
import { NoAnswerError, SetupCancelled, SetupExit } from "./exit.ts";
import type { LineQueue } from "./prompt-queue.ts";

/** What a cancelled question does (requirement 15): continue as a decline, take the first option, or exit 130. */
export type CancelClass = "decline" | "default" | "abort";

/** The pre-answers of the run; `take` returns the value given for `id`, if any. */
export interface Answers {
  take(id: string): string | undefined;
}

export interface Question {
  readonly id: string;
  readonly header: string;
  readonly options: readonly string[];
  readonly cancel: CancelClass;
  /** A typed line for which this returns true is returned verbatim, before option matching, and is never an invalid answer (the catalogue `?N` preview). */
  readonly passthrough?: (line: string) => boolean;
}

export interface PromptSession {
  /** The chosen option (or the pre-answer value); `undefined` only for a cancelled `decline` question. */
  choose(question: Question): Promise<string | undefined>;
  /** A two-way question; `options` lists the first (default) option first. */
  confirm(
    id: string,
    header: string,
    options?: readonly string[],
    cancel?: CancelClass,
  ): Promise<string | undefined>;
  close(): void;
}

export interface SessionDeps {
  readonly queue: LineQueue;
  readonly answers: Answers;
  readonly io: Io;
  readonly isTty: boolean;
}

/** Invalid answers a terminal accepts before the run stops (the third one is the last). */
export const MAX_ATTEMPTS = 3;

export const answerEcho = (id: string, value: string): string => `[answer] ${id}=${value}`;
export const invalidAnswerMessage = (id: string, options: readonly string[]): string =>
  `Error: invalid answer for '${id}': expected one of: ${options.join(", ")}`;
export const noAnswerMessage = (id: string): string =>
  `Error: no answer for '${id}' (standard input is not a terminal); pass --answer ${id}=<value>`;
export const cancelledMessage = (header: string): string => `Setup cancelled at: ${header}`;

/** The option an answer line names (its 1-based number or its name, any case), or `undefined`. */
function resolve(line: string, options: readonly string[]): string | undefined {
  const text = line.trim();
  if (/^[0-9]+$/.test(text)) return options[Number(text) - 1];
  const lower = text.toLowerCase();
  return options.find((option) => option.toLowerCase() === lower);
}

export function createSession(deps: SessionDeps): PromptSession {
  const { queue, answers, io, isTty } = deps;

  const cancelled = (q: Question): string | undefined => {
    if (q.cancel === "abort") {
      io.err(cancelledMessage(q.header));
      throw new SetupCancelled(q.header);
    }
    return q.cancel === "default" ? q.options[0] : undefined;
  };

  const choose = async (q: Question): Promise<string | undefined> => {
    const given = answers.take(q.id);
    if (given !== undefined) {
      io.out(answerEcho(q.id, given));
      return given;
    }
    io.out(q.header);
    q.options.forEach((option, i) => io.out(`  ${i + 1}) ${option}`));
    for (let attempt = 1; ; attempt += 1) {
      const line = await queue.next();
      if (line === undefined) {
        if (!isTty) {
          io.err(noAnswerMessage(q.id));
          throw new NoAnswerError(q.id, noAnswerMessage(q.id));
        }
        return cancelled(q);
      }
      if (q.passthrough?.(line) === true) return line;
      if (isTty && line.trim() === "") return q.options[0];
      const chosen = resolve(line, q.options);
      if (chosen !== undefined) return chosen;
      io.err(invalidAnswerMessage(q.id, q.options));
      if (!isTty || attempt >= MAX_ATTEMPTS) {
        throw new SetupExit(2, invalidAnswerMessage(q.id, q.options));
      }
    }
  };

  return {
    choose,
    confirm: (id, header, options = ["no", "yes"], cancel = "decline") =>
      choose({ id, header, options, cancel }),
    close: () => queue.close(),
  };
}
