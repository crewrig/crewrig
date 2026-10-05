// types.ts — shared contracts of the worktree-claim modules (spec 0248 R1, R3,
// R14-R16). Types and the one failure class only: no behaviour lives here.
//
// Module map (one concern per file, each under 300 lines):
//   git.ts          the only subprocess the claim code spawns (R24)
//   clock.ts        UTC second-precision timestamps, injectable
//   repo.ts         toplevel, common directory, claim root, ticket (R16)
//   claim-state.ts  `readClaimState`, the single definition of claim state that
//                   `status` prints from and the guard decides from (R3)
//   store.ts        the claim directory (R17, R18)
//   ledger.ts       the append-only sibling ledger (R17, R18)
//   gate.ts         the clean-tree gate (R19)
//   staleness.ts    `--stale-after` and `since_epoch` arithmetic (R20)
//   status.ts / take.ts / takeover.ts   the subcommands
//   args.ts / usage.ts / main.ts        parsing, help block and dispatch
//   run.ts          `run` (stream L): `runCommand(ctx, opts, io)`, see `Io`

/** Environment as read from `process.env`: every value is `string | undefined`. */
export type Env = Readonly<Record<string, string | undefined>>;

/** Everything a subcommand needs to know about the repository and the ticket. */
export interface ClaimContext {
  /** The tree the tool inspects: `CREWRIG_REPO_DIR`, else the current directory. */
  readonly repoDir: string;
  /** Physical (symlink-resolved) toplevel of the working tree. */
  readonly toplevel: string;
  /** Physical absolute git common directory. */
  readonly common: string;
  /** `<common>/crewrig/worktree-claims`. */
  readonly claimRoot: string;
  /** Validated ticket id: a single path component. */
  readonly ticket: string;
  /** `<claimRoot>/<ticket>`: a directory exists there iff the ticket is claimed. */
  readonly claimDir: string;
  /** `<claimRoot>/<ticket>.log`: the append-only sibling ledger. */
  readonly ledger: string;
  /** The acting agent; the empty string for the read-only subcommands. */
  readonly agent: string;
  readonly platform: NodeJS.Platform;
}

/** The last ledger line of an unclaimed ticket, as `status` prints it (R3). */
export interface LastLedgerEntry {
  readonly action: string;
  readonly holder: string;
  readonly at: string;
}

/**
 * The claim state of one ticket. `claimed` means the claim directory exists,
 * whoever holds it; `undetermined` is never to be read as `claimed` (R8).
 */
export type ClaimState =
  | {
      readonly state: "claimed";
      readonly holder: string;
      readonly since: string;
      readonly operation: string;
    }
  | { readonly state: "unclaimed"; readonly last?: LastLedgerEntry }
  | { readonly state: "undetermined"; readonly reason: string };

/** The parsed command line of the claim tool (R14). */
export interface ClaimOptions {
  readonly subcommand: "run" | "take" | "release" | "takeover" | "status" | "history";
  readonly agent: string;
  /** `--ticket`, or the empty string when none was given. */
  readonly ticket: string;
  readonly operation: string;
  /** `--stale-after` validated, leading zeros stripped: all digits, at most 9. */
  readonly staleAfter: string;
  /** Everything after `--`: the command `run` wraps. Empty for the others. */
  readonly command: readonly string[];
}

/**
 * Where a subcommand writes. `out` and `err` append the line feed themselves;
 * `raw` writes bytes as they are (the ledger of `history`). Subcommands return
 * the exit code instead of exiting, so every stream drains before the process
 * ends.
 */
export interface Io {
  out(line: string): void;
  err(line: string): void;
  raw(data: string | Uint8Array): void;
}

/**
 * The contract of `run.ts` (stream L): `export function runCommand` with this
 * signature, called by `main.ts` for the `run` subcommand after the context is
 * resolved (`ctx.agent` is set, `opts.command` is non-empty). It returns the
 * exit code of `run`, writes only through `io`, and throws `ClaimFailure` for an
 * `Error:` refusal. The gate, claim and ledger helpers it needs are `treeDirt`
 * and `refuseDirty` (gate.ts), `tryCreateClaim`, `writeClaimState`,
 * `releaseClaimDir`, `reportHolder`, `claimExists` and `claimField` (store.ts)
 * and `ledgerAppend` (ledger.ts).
 */
export type RunCommand = (ctx: ClaimContext, opts: ClaimOptions, io: Io) => Promise<number>;

/**
 * A refusal or failure that ends the invocation with an `Error:` line on
 * standard error (the shell tool's `fail`). `message` has no `Error:` prefix.
 */
export class ClaimFailure extends Error {
  readonly exitCode: number;
  constructor(message: string, exitCode = 1) {
    super(message);
    this.name = "ClaimFailure";
    this.exitCode = exitCode;
  }
}
