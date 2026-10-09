// prompt.ts — the yes/no prompter of the history importers (spec 0253 R12 and delta-01).
//
// ONE `readline` interface over the input serves the whole run. Every line read is queued the
// moment it arrives, so a line that reaches the interface before `ask` is called (piped input,
// a line buffered for the second prompt while the first child runs) is never lost. `pause()`
// and `resume()` bracket each child process and keep the buffered lines; `close()` ends the run.

import readline from "node:readline";

import type { Prompter } from "./types.ts";

/** Build the prompter over `input`/`output`; the question is printed as one line, then one line is read. */
export function createPrompter(
  input: NodeJS.ReadableStream,
  output: NodeJS.WritableStream,
): Prompter {
  const rl = readline.createInterface({ input, terminal: false });
  const queue: string[] = [];
  let ended = false;
  let waiter: (() => void) | undefined;

  const wake = (): void => {
    const w = waiter;
    waiter = undefined;
    w?.();
  };
  rl.on("line", (line) => {
    queue.push(line);
    wake();
  });
  rl.on("close", () => {
    ended = true;
    wake();
  });

  const nextLine = async (): Promise<string | undefined> => {
    while (queue.length === 0 && !ended) {
      await new Promise<void>((resolve) => {
        waiter = resolve;
      });
    }
    return queue.shift();
  };

  return {
    async ask(question: string): Promise<boolean> {
      output.write(`${question}\n`);
      const answer = await nextLine();
      if (answer === undefined) return false;
      const normalised = answer.trim().toLowerCase();
      return normalised === "yes" || normalised === "y";
    },
    pause(): void {
      rl.pause();
    },
    resume(): void {
      rl.resume();
    },
    close(): void {
      rl.close();
    },
  };
}
