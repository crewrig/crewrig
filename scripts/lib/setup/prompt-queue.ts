// prompt-queue.ts — the one line queue every question of a setup run reads from (spec 0256
// requirement 11, the pattern of scripts/lib/history-import/prompt.ts, written again here).
//
// ONE reader over the stream serves lines on demand. A line that arrives before `next()` is
// called is kept; the optional `remainder` (text the one-key question already took off the pipe)
// is served first, as if it were the head of the stream. A leading U+FEFF of the first line and a
// trailing carriage return of every line are stripped (PowerShell 5.1 pipes, requirement 15).

import { StringDecoder } from "node:string_decoder";

export interface LineQueue {
  /** The next line, or `undefined` once the input has ended and every line was served. */
  next(): Promise<string | undefined>;
  /** Stop reading: every waiting and later `next()` resolves `undefined` once the lines are served. */
  close(): void;
}

export interface LineQueueOptions {
  /** Text already read from the stream, served before anything the stream delivers. */
  readonly remainder?: string;
}

/** Build the queue over `stream`; the stream is read from now on, whether or not `next()` is called. */
export function createLineQueue(
  stream: NodeJS.ReadableStream,
  options: LineQueueOptions = {},
): LineQueue {
  const decoder = new StringDecoder("utf8");
  const lines: string[] = [];
  let pending = options.remainder ?? "";
  let first = true;
  let ended = false;
  let waiter: (() => void) | undefined;

  const wake = (): void => {
    const w = waiter;
    waiter = undefined;
    w?.();
  };
  const emit = (line: string): void => {
    let text = line.endsWith("\r") ? line.slice(0, -1) : line;
    if (first) {
      first = false;
      if (text.startsWith("﻿")) text = text.slice(1);
    }
    lines.push(text);
  };
  const split = (): void => {
    let at = pending.indexOf("\n");
    while (at !== -1) {
      emit(pending.slice(0, at));
      pending = pending.slice(at + 1);
      at = pending.indexOf("\n");
    }
  };
  const finish = (): void => {
    if (ended) return;
    ended = true;
    pending += decoder.end();
    split();
    if (pending.length > 0) emit(pending);
    pending = "";
    stream.removeListener("data", onData);
    stream.removeListener("end", finish);
    stream.removeListener("close", finish);
    stream.removeListener("error", finish);
    wake();
  };
  const onData = (chunk: unknown): void => {
    pending += typeof chunk === "string" ? chunk : decoder.write(chunk as Buffer);
    split();
    wake();
  };

  split();
  // A stream that already ended (or was destroyed) before this queue attached never emits `end`
  // again: the one-key question can leave its stream that way. Treat it as the end of input.
  const state = stream as { readableEnded?: unknown; destroyed?: unknown };
  if (state.readableEnded === true || state.destroyed === true) {
    finish();
  } else {
    stream.on("data", onData);
    stream.on("end", finish);
    stream.on("close", finish);
    stream.on("error", finish);
  }
  // The one-key question pauses the stream it read from; reading resumes with the queue.
  if (typeof stream.resume === "function") stream.resume();

  return {
    async next(): Promise<string | undefined> {
      while (lines.length === 0 && !ended) {
        await new Promise<void>((resolve) => {
          waiter = resolve;
        });
      }
      return lines.shift();
    },
    close(): void {
      finish();
    },
  };
}
