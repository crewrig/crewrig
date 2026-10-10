// confirm.ts — the link-mode warning and the one-key prompt (spec 0255 R12, plan step 9).
//
// Twins the `WARNING:` block and `read -p "Continue? [y/N] " -n 1 -r` of the claude,
// copilot and antigravity manage scripts; the workspace script prints the same block and
// asks nothing. `read -p` shows its prompt only when stdin is a terminal, and reads one
// character: a terminal key (raw mode, restored on every exit path), the first byte of a
// pipe, or nothing at end of input (which answers no). `echo ""` then ends the line.

import type { Io } from "../extension/types.ts";

export type LinkWarningCli = "claude" | "copilot" | "antigravity" | "workspace";

/** The four lines that differ between the scripts: which components link into `dist/<tier>/`. */
const BODY: Readonly<Record<LinkWarningCli, readonly string[]>> = {
  claude: [
    "For claude-skills the link target is the regenerable staging",
    "tree dist/<tier>/, which a rebuild replaces wholesale: an edit",
    "to the authoring source under artifacts/ takes effect only",
    "after 'bash scripts/build-components.sh' has run.",
  ],
  copilot: [
    "For skills the link target is the regenerable staging tree",
    "dist/<tier>/, which a rebuild replaces wholesale: an edit to",
    "the authoring source under artifacts/ takes effect only after",
    "'bash scripts/build-components.sh' has run.",
  ],
  antigravity: [
    "For antigravity-skills the link target is the regenerable",
    "staging tree dist/<tier>/, which a rebuild replaces wholesale:",
    "an edit to the authoring source under artifacts/ takes effect",
    "only after 'bash scripts/build-components.sh' has run.",
  ],
  workspace: [
    "For skills and agents the link target is the regenerable",
    "staging tree dist/<tier>/, which a rebuild replaces wholesale:",
    "an edit to the authoring source under artifacts/ takes effect",
    "only after 'bash scripts/build-components.sh' has run.",
  ],
};

/** The `WARNING:` block of one script, line by line, as its `echo`s print it on standard output. */
export function linkWarningLines(cli: LinkWarningCli): readonly string[] {
  return [
    "WARNING: Symlink mode — the installed component is a link into this",
    "         repository, so a branch switch changes it in place.",
    ...BODY[cli].map((line) => `         ${line}`),
    "Only use if you trust all branches in this repository.",
  ];
}

export const CONTINUE_PROMPT = "Continue? [y/N] ";

/** The part of `process.stdin` the prompt uses; a test hands over a stand-in. */
export interface PromptStdin {
  readonly isTTY?: boolean;
  readonly isRaw?: boolean;
  setRawMode?(mode: boolean): unknown;
  on(event: string, listener: (...args: unknown[]) => void): unknown;
  removeListener(event: string, listener: (...args: unknown[]) => void): unknown;
  resume(): unknown;
  pause(): unknown;
}

/** The first character of a chunk, or `""` for an empty one or one of an unknown type. */
function firstChar(chunk: unknown): string {
  if (typeof chunk === "string") return chunk.slice(0, 1);
  if (chunk instanceof Uint8Array && chunk.length > 0) return String.fromCharCode(chunk[0] ?? 0);
  return "";
}

/** Wait for the first chunk of stdin; end, close or an error before it answers `""`. */
function readKey(stdin: PromptStdin): Promise<string> {
  return new Promise((resolve) => {
    const onData = (chunk: unknown): void => finish(firstChar(chunk));
    const onEnd = (): void => finish("");
    const events = ["end", "close", "error"];
    function finish(key: string): void {
      stdin.removeListener("data", onData);
      for (const event of events) stdin.removeListener(event, onEnd);
      resolve(key);
    }
    stdin.on("data", onData);
    for (const event of events) stdin.on(event, onEnd);
    stdin.resume();
  });
}

/**
 * Print the prompt (terminal only), read one key and end the line. True for `y` or `Y`;
 * anything else, including end of input, is false. The raw mode a terminal needs is set
 * before the read and put back whatever happens.
 */
export async function confirmContinue(stdin: PromptStdin, io: Io): Promise<boolean> {
  const tty = stdin.isTTY === true && typeof stdin.setRawMode === "function";
  const wasRaw = stdin.isRaw === true;
  if (stdin.isTTY === true) io.errRaw(CONTINUE_PROMPT);
  let key: string;
  try {
    if (tty) stdin.setRawMode?.(true);
    key = await readKey(stdin);
  } finally {
    if (tty) stdin.setRawMode?.(wasRaw);
    stdin.pause();
  }
  // In raw mode the terminal no longer echoes the key; bash's `read -n 1` leaves it on.
  if (tty && key !== "") io.errRaw(key);
  io.out("");
  return key === "y" || key === "Y";
}

/** What `confirmKeyWithRemainder` hands back: the key typed and the unread rest of the stream. */
export interface KeyWithRemainder {
  readonly key: string;
  readonly remainder: string;
}

/**
 * Read the first key and, off a terminal, the rest of its line, which the stream rule discards:
 * a key that is not itself an LF drops everything up to and including the next LF (a CRLF ends
 * on its LF), wherever the chunk boundaries fall; a blank key drops nothing. What follows the
 * dropped part, in the chunk that holds it, is the remainder. End of input before the key gives
 * `""`; end of input inside the dropped part gives an empty remainder. The stream is paused,
 * never destroyed, so the data after the remainder waits for the reader that resumes it.
 */
function readKeyAndRest(stdin: PromptStdin): Promise<KeyWithRemainder> {
  return new Promise((resolve) => {
    const decoder = new TextDecoder();
    let key: string | null = null;
    const events = ["end", "close", "error"];
    const onEnd = (): void => finish("");
    const onData = (chunk: unknown): void => {
      let rest =
        typeof chunk === "string"
          ? chunk
          : chunk instanceof Uint8Array
            ? decoder.decode(chunk, { stream: true })
            : "";
      if (key === null) {
        if (rest === "") return;
        key = String.fromCodePoint(rest.codePointAt(0) ?? 0);
        rest = rest.slice(key.length);
        if (key === "\n") return finish(rest);
      }
      const lf = rest.indexOf("\n");
      if (lf >= 0) finish(rest.slice(lf + 1));
    };
    function finish(remainder: string): void {
      stdin.removeListener("data", onData);
      for (const event of events) stdin.removeListener(event, onEnd);
      stdin.pause();
      resolve({ key: key ?? "", remainder });
    }
    stdin.on("data", onData);
    for (const event of events) stdin.on(event, onEnd);
    stdin.resume();
  });
}

/**
 * `read -p <prompt> -n 1 -r` with the rest of the stream handed back (spec 0256 requirement 16).
 * The prompt goes to stderr, on a terminal only. On a terminal the question returns on the first
 * keypress (raw mode put back on every exit path, the key echoed as `confirmContinue` does) and
 * the remainder is `""`; off a terminal see `readKeyAndRest`. The caller prints the line end.
 */
export async function confirmKeyWithRemainder(
  stdin: PromptStdin,
  io: Io,
  prompt: string,
): Promise<KeyWithRemainder> {
  if (stdin.isTTY !== true) return readKeyAndRest(stdin);
  io.errRaw(prompt);
  const wasRaw = stdin.isRaw === true;
  let key: string;
  try {
    stdin.setRawMode?.(true);
    key = await readKey(stdin);
  } finally {
    stdin.setRawMode?.(wasRaw);
    stdin.pause();
  }
  if (key !== "") io.errRaw(key);
  return { key, remainder: "" };
}
