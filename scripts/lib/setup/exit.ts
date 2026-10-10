// exit.ts — how a module of the setup graph ends the run early (spec 0256 requirements 13-15).
// A module prints its own diagnostic through `ctx.io`, then throws one of these; the flow turns it
// into `process.exitCode`. Nothing in the graph calls `process.exit`.

/** End the run with `status`; the diagnostic has already been printed by whoever throws it. */
export class SetupExit extends Error {
  readonly status: number;
  constructor(status: number, message = `setup exits with status ${status}`) {
    super(message);
    this.name = "SetupExit";
    this.status = status;
  }
}

/** A malformed or unknown `--answer`: status 2, before any file is modified (requirement 13). */
export class UsageError extends SetupExit {
  constructor(message: string) {
    super(2, message);
    this.name = "UsageError";
  }
}

/** No answer available and no terminal: status 2, naming the question (requirement 14). */
export class NoAnswerError extends SetupExit {
  readonly id: string;
  constructor(id: string, message: string) {
    super(2, message);
    this.name = "NoAnswerError";
    this.id = id;
  }
}

/** A cancelled `abort`-class question: status 130 (requirement 15). */
export class SetupCancelled extends SetupExit {
  readonly header: string;
  constructor(header: string) {
    super(130, `Setup cancelled at: ${header}`);
    this.name = "SetupCancelled";
    this.header = header;
  }
}
