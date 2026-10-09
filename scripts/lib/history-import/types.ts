// types.ts — the shared shapes of the TypeScript port of the four history importers and of
// scripts/prune-transcripts.sh (spec 0253 R11-R18). Every module of this directory is free of
// any import of ticket #1330's MemPalace helpers (`scripts/lib/mempalace-python.ts`,
// `scripts/lib/mempalace-pin.ts`): the entries wire them in and hand the results down as the
// plain values and functions below, so the port can be written and tested before those modules
// are on the release branch.

/** One line to a stream (newline added). */
export interface Io {
  readonly out: (line: string) => void;
  readonly err: (line: string) => void;
}

/**
 * The yes/no prompt of the importers (spec 0253 R12): one line reader over standard input for the
 * whole run, so a line buffered for the second prompt survives the child between the two prompts.
 * `pause()` and `resume()` bracket every child process; `close()` ends the run.
 */
export interface Prompter {
  /** Print `question`, read one line; `yes`/`y` (trimmed, any case) is true, anything else, an empty line and end of input are false. */
  ask(question: string): Promise<boolean>;
  pause(): void;
  resume(): void;
  close(): void;
}

/** What an importer run needs from its surroundings; the entry builds it. */
export interface ImportEnv {
  readonly env: NodeJS.ProcessEnv;
  readonly home: string;
  readonly io: Io;
  readonly prompter: Prompter;
  /** The interpreter on which `mempalace.mcp_server` imports, or undefined: ticket #1330's `detectMempalacePython`, injected by the entry. */
  readonly detectInterpreter: () => string | undefined;
}
