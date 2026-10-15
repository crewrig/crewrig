// prompt.ts — the built-in multi-select prompt used when standard input is a terminal (spec 0258 R24).
// It replaces `fzf --multi`: the offered components are numbered and the user answers with
// numbers or names separated by commas or spaces; an empty answer selects nothing.

import readline from "node:readline";

import { OFFERED_COMPONENTS } from "./args.ts";

/** Pure: map an answer to the chosen components, in offered order; unknown words make `null`. */
export function parseAnswer(answer: string): string[] | null {
  const words = answer.split(/[\s,]+/).filter((word) => word !== "");
  const chosen = new Set<string>();
  for (const word of words) {
    const byNumber = /^[0-9]+$/.test(word) ? OFFERED_COMPONENTS[Number(word) - 1] : undefined;
    const name = byNumber ?? (OFFERED_COMPONENTS.includes(word) ? word : undefined);
    if (name === undefined) return null;
    chosen.add(name);
  }
  return OFFERED_COMPONENTS.filter((name) => chosen.has(name));
}

function ask(rl: readline.Interface, question: string): Promise<string | null> {
  return new Promise((resolve) => {
    rl.question(question, (answer) => resolve(answer));
    rl.once("close", () => resolve(null));
  });
}

/** Ask until the answer parses; a closed input counts as no component. */
export async function promptComponents(
  name: string,
  input: NodeJS.ReadableStream,
  output: NodeJS.WritableStream,
): Promise<string[]> {
  const rl = readline.createInterface({ input, output, terminal: false });
  try {
    output.write(`Components for ${name}:\n`);
    OFFERED_COMPONENTS.forEach((component, index) => {
      output.write(`  ${index + 1}) ${component}\n`);
    });
    for (;;) {
      const answer = await ask(rl, "Numbers or names, separated by commas (empty for none): ");
      if (answer === null) return [];
      const chosen = parseAnswer(answer);
      if (chosen !== null) return chosen;
      output.write("Unrecognised answer; use the numbers or names listed above.\n");
    }
  } finally {
    rl.close();
  }
}
