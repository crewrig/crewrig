// repo.ts — repository context of the claim tool (spec 0248 R16, R23).
//
// Resolves the toplevel and the git common directory physically, places the
// claim root, applies the `.worktrees/` guard per subcommand and validates the
// ticket id. Every path test takes the platform as a parameter, so the Windows
// separators are proven on any host.

import path from "node:path";
import { resolveReal } from "../paths.ts";
import { runGit, stripTrailingNewlines } from "./git.ts";
import type { ClaimContext } from "./types.ts";

type Subcommand = "run" | "take" | "release" | "takeover" | "status" | "history";

const MUTATING: readonly Subcommand[] = ["run", "take", "release", "takeover"];

export type ContextResult =
  | { readonly ok: true; readonly ctx: ClaimContext }
  | { readonly ok: false; readonly message: string };

/** The platform's path module, so `win32` rules run on a POSIX host in tests. */
export function pathFor(platform: NodeJS.Platform): path.PlatformPath {
  return platform === "win32" ? path.win32 : path.posix;
}

/** True iff the path sits under a `.worktrees/` component; `\` counts on win32. */
export function isWorktreePath(target: string, platform: NodeJS.Platform): boolean {
  const normalised = platform === "win32" ? target.replaceAll("\\", "/") : target;
  return normalised.includes("/.worktrees/");
}

/** The final path component, as the shell took it; `\` also separates on win32. */
export function lastComponent(target: string, platform: NodeJS.Platform): string {
  const normalised = platform === "win32" ? target.replaceAll("\\", "/") : target;
  return normalised.slice(normalised.lastIndexOf("/") + 1);
}

/**
 * A ticket id is a single path component: not empty, no `/`, not `.` or `..`,
 * and on win32 neither `\`, a separator there that would resolve outside the
 * claim root, nor `:`, which would open an NTFS alternate data stream through
 * `<ticket>.log`.
 */
export function isValidTicket(ticket: string, platform: NodeJS.Platform): boolean {
  if (ticket === "" || ticket === "." || ticket === ".." || ticket.includes("/")) return false;
  return !(platform === "win32" && (ticket.includes("\\") || ticket.includes(":")));
}

export function invalidTicketMessage(ticket: string): string {
  return `invalid --ticket '${ticket}': a ticket id is a single path component.`;
}

/**
 * Resolve the context for one invocation, in the order the shell tool checked
 * it: repository, common directory, `.worktrees/` guard, ticket. `ticket` is
 * the `--ticket` value or the empty string. Never throws: a failure carries the
 * shell tool's diagnostic text, without the `Error:` prefix.
 */
export function resolveContext(input: {
  readonly repoDir: string;
  readonly subcommand: Subcommand;
  readonly ticket: string;
  readonly agent: string;
  readonly platform: NodeJS.Platform;
}): ContextResult {
  const { repoDir, subcommand, agent, platform } = input;
  const fail = (message: string): ContextResult => ({ ok: false, message });

  const top = runGit(["rev-parse", "--show-toplevel"], repoDir);
  if (!top.ok) {
    return fail(`'${repoDir}' is not inside a git working tree, so there is no worktree to
       claim. Run this from a ticket worktree, or set CREWRIG_REPO_DIR.`);
  }
  let toplevel: string;
  try {
    toplevel = resolveReal(stripTrailingNewlines(top.stdout));
  } catch {
    return fail(`cannot resolve the toplevel '${stripTrailingNewlines(top.stdout)}' physically.`);
  }

  const commonRaw = runGit(["rev-parse", "--git-common-dir"], repoDir);
  if (!commonRaw.ok) return fail(`cannot resolve the git common directory from '${repoDir}'.`);
  let common: string;
  try {
    common = resolveReal(path.resolve(repoDir, stripTrailingNewlines(commonRaw.stdout)));
  } catch {
    return fail(`cannot resolve the git common directory from '${repoDir}'.`);
  }

  const onWorktree = isWorktreePath(toplevel, platform);
  if (MUTATING.includes(subcommand) && !onWorktree) {
    return fail(`'${subcommand}' acts on a SHARED ticket worktree, and the toplevel here is
       '${toplevel}', which is not under a '.worktrees/' directory. Run it from
       '.worktrees/<ticket-id>/'. (The read-only 'status' and 'history'
       subcommands carry no such guard and answer from anywhere.)`);
  }

  let ticket = input.ticket;
  if (ticket === "") {
    if (!onWorktree) {
      // Deliberately not the repository directory's own basename: guessing
      // would answer an investigation with the wrong ticket's ledger.
      return fail(`no --ticket given and none derivable: the toplevel '${toplevel}' is not
       under a '.worktrees/' directory, so its basename is the repository's own
       name and not a ticket id. Pass --ticket <id>.`);
    }
    ticket = lastComponent(toplevel, platform);
  }
  if (!isValidTicket(ticket, platform)) return fail(invalidTicketMessage(ticket));

  const p = pathFor(platform);
  const claimRoot = p.join(common, "crewrig", "worktree-claims");
  return {
    ok: true,
    ctx: {
      repoDir,
      toplevel,
      common,
      claimRoot,
      ticket,
      claimDir: p.join(claimRoot, ticket),
      ledger: p.join(claimRoot, `${ticket}.log`),
      agent,
      platform,
    },
  };
}
