// args.ts — command-line parsing of the claim tool (spec 0248 R14).
//
// The surface and every `Error:` diagnostic are the shell tool's. A value-taking
// option in final position is refused explicitly: a caller reading exit 1 with
// no diagnostic cannot tell "you forgot an argument" from "the repository is
// broken", and the exit contract tells callers to branch on the diagnostic.

import { validateStaleAfter } from "./staleness.ts";
import { ClaimFailure } from "./types.ts";
import type { ClaimOptions } from "./types.ts";

const STALE_DEFAULT_MINUTES = "30";
const SUBCOMMANDS = ["run", "take", "release", "takeover", "status", "history"] as const;

/** What the command line asks for: the usage block, or a subcommand to run. */
export type Parsed =
  | { readonly kind: "usage"; readonly exitCode: number }
  | { readonly kind: "command"; readonly opts: ClaimOptions };

function isSubcommand(value: string): value is ClaimOptions["subcommand"] {
  return (SUBCOMMANDS as readonly string[]).includes(value);
}

/** Parse `argv` (without the interpreter and script). Throws `ClaimFailure` on a bad command line. */
export function parseArgs(argv: readonly string[]): Parsed {
  const first = argv[0];
  if (first === undefined) return { kind: "usage", exitCode: 1 };
  if (first === "-h" || first === "--help") return { kind: "usage", exitCode: 0 };
  if (!isSubcommand(first)) {
    throw new ClaimFailure(`unknown subcommand '${first}'. Expected one of:
       run, take, release, takeover, status, history. Run with --help.`);
  }
  const subcommand = first;

  let agent = "";
  let ticket = "";
  let operation = "";
  let staleAfterRaw = STALE_DEFAULT_MINUTES;
  let command: string[] = [];

  const rest = argv.slice(1);
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i] ?? "";
    if (
      arg === "--agent" ||
      arg === "--ticket" ||
      arg === "--operation" ||
      arg === "--stale-after"
    ) {
      const value = rest[i + 1];
      if (value === undefined) {
        throw new ClaimFailure(`'${arg}' requires a value: worktree-claim.sh ${subcommand} … ${arg} <value>. Run
       with --help for the usage block.`);
      }
      i++;
      if (arg === "--agent") agent = value;
      else if (arg === "--ticket") ticket = value;
      else if (arg === "--operation") operation = value;
      else staleAfterRaw = value;
    } else if (arg === "-h" || arg === "--help") {
      return { kind: "usage", exitCode: 0 };
    } else if (arg === "--") {
      command = rest.slice(i + 1);
      break;
    } else {
      throw new ClaimFailure(`unknown argument '${arg}'. Run with --help for the usage block.`);
    }
  }

  // Validated before any arithmetic and for every subcommand, as the shell tool did.
  const staleAfter = validateStaleAfter(staleAfterRaw);

  if (subcommand !== "status" && subcommand !== "history" && agent === "") {
    throw new ClaimFailure(`--agent <name> is required for '${subcommand}': a claim with no named
       holder answers neither requirement 6 (who holds it) nor requirement 7
       (who held it), which are the whole point of recording one.`);
  }
  if (subcommand === "run" && command.length === 0) {
    throw new ClaimFailure(
      "'run' needs a command: worktree-claim.sh run --agent <name> -- <command…>",
    );
  }

  return { kind: "command", opts: { subcommand, agent, ticket, operation, staleAfter, command } };
}
