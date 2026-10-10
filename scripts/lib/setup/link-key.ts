// link-key.ts — the `--link` warning and the one-key question of the setup scripts (spec 0256
// requirement 16, delta-01). Twins `setup-{claude,gemini,antigravity}-interactive.sh` lines
// 28-45: the WARNING block on standard output, `read -p "Continue with symlink mode? [y/N] "
// -n 1 -r`, `echo ""`, and the abort line on standard output with exit 1. Not the texts of
// `linkWarningLines` / `CONTINUE_PROMPT` in manage/confirm.ts, which are the manage scripts'.
// The Copilot setup has no `--link` question. This module takes the stream the line queue will
// read next: it returns the unread remainder for the queue to serve first.

import { confirmKeyWithRemainder, type PromptStdin } from "../manage/confirm.ts";
import type { Cli, Io } from "./context.ts";
import { SetupExit } from "./exit.ts";

export const LINK_WARNING_LINES: readonly string[] = [
  "WARNING: You are using symlink mode for system context files.",
  "Symlinked files will change when you switch branches in this repository.",
  "A malicious branch could alter your agent's behavior, permissions, and",
  "tool access without your knowledge.",
  "",
  "Only use this mode if you TRUST ALL branches in this repository.",
  "For production use, prefer copy mode (the default).",
  "",
];

export const LINK_PROMPT = "Continue with symlink mode? [y/N] ";
export const LINK_ABORT_LINE = "Aborted. Run without --link for secure copy mode.";

/** The part of the `--answer` store this module needs. */
export interface LinkAnswers {
  take(id: string): string | undefined;
}

export interface LinkKeyOptions {
  readonly cli: Cli;
  readonly io: Io;
  readonly stdin: PromptStdin;
  readonly answers: LinkAnswers;
}

/** The Copilot setup prints no warning and asks nothing; the other three do. */
export function linkQuestionAsked(cli: Cli): boolean {
  return cli !== "copilot";
}

function abort(io: Io): never {
  io.out(LINK_ABORT_LINE);
  throw new SetupExit(1);
}

/**
 * Print the warning and ask the key. `y` or `Y` returns `{ proceed: true, remainder }`; any other
 * key or end of input prints the abort line and throws `SetupExit(1)`. A `link-confirm` pre-answer
 * stands for the key (`yes` proceeds, anything else aborts) and reads nothing.
 */
export async function askLinkConfirm(
  options: LinkKeyOptions,
): Promise<{ proceed: true; remainder: string }> {
  const { cli, io, stdin, answers } = options;
  if (!linkQuestionAsked(cli)) return { proceed: true, remainder: "" };
  for (const line of LINK_WARNING_LINES) io.out(line);
  const preset = answers.take("link-confirm");
  if (preset !== undefined) {
    io.out(`[answer] link-confirm=${preset}`);
    if (preset !== "yes") abort(io);
    io.out("");
    return { proceed: true, remainder: "" };
  }
  const { key, remainder } = await confirmKeyWithRemainder(stdin, io, LINK_PROMPT);
  io.out("");
  if (key !== "y" && key !== "Y") abort(io);
  io.out("");
  return { proceed: true, remainder };
}
