// mempalace-callsite.ts — the MemPalace HTTP call site of the four setups (spec 0256 requirement
// 26 as replaced by delta-01, plan v2 step B2a.4).
//
// The shell ran `ensure_mempalace_http "$REPO_DIR" <cli> || _mempalace_rc=$?` then a `case` on the
// return code: 0 HTTP endpoint ready, 1 no usable serving daemon, 2 the daemon verified serving
// but the registration could not be completed. The arms differ per CLI:
//   - Claude ensures FIRST, writes nothing before, and only its rc 1 removes the user-scope entry
//     and registers the stdio http-wrapper entry; its rc 2 keeps an existing entry.
//   - Gemini, Copilot and Antigravity write the stdio entry BEFORE ensuring (test-mcp-daemon.sh
//     pins it), ensure only when that entry was written, and rc 1 / rc 2 write nothing further:
//     they print a warning and the entry stays.
// Every line is printed on stdout (no `>&2` in any arm). Return codes 1 and 2 are documented,
// non-exceptional outcomes: this module never throws on them, which is the TypeScript analogue of
// the `set -e` survival property of test-setup-mempalace-rc-guard.sh.
//
// `armFor` is the pure table; `runMempalaceStep` executes it through injected effects, so it spawns
// nothing itself. The ensure step is another module, injected as `ensure`.

import type { Cli, Io } from "./context.ts";

/** The return code of `ensure_mempalace_http`. */
export type EnsureRc = 0 | 1 | 2;

/** What the arm needs to know about the machine; only Claude's rc 1 and rc 2 read it. */
export interface ArmFacts {
  /** Claude rc 1: the stdio entry could be registered after the removal. */
  readonly stdioRegistered: boolean;
  /** Claude rc 2: `mcp_is_registered mempalace` found an entry. */
  readonly existingEntry: boolean;
}

export type ArmAction =
  /** Nothing is written or removed. */
  | "none"
  /** Claude rc 1: remove the user-scope entry, then register the stdio entry. */
  | "converge-stdio"
  /** Claude rc 2: look for an existing entry and keep it. */
  | "keep-existing";

export interface Arm {
  readonly lines: readonly string[];
  /** The `MEMPALACE_INSTALLED` flag of the summary after the arm. */
  readonly installed: boolean;
  readonly action: ArmAction;
}

const HTTP_READY = "  MemPalace reaches shared memory through the HTTP daemon.";

const STDIO_WARNING: readonly string[] = [
  "  WARNING: mempalace stays on the stdio arrangement — no shared",
  "           daemon could be established. Sessions will contend for",
  "           the palace writer lock until the daemon is up.",
];

const LOCKOUT_WARNING: readonly string[] = [
  "  LOCKOUT WARNING: the daemon is verified serving but registration",
  "           could not be completed, so the stdio entry just written",
  "           will be refused by the shared writer lock (MCP error",
  "           -32001) in every session.",
];

const CONVERGED =
  "  Converged mempalace to the stdio http-wrapper entry (no serving daemon available).";
const CONVERGE_FAILED = "  ERROR: could not register even the stdio fallback for mempalace.";
const KEPT = "  Existing mempalace registration kept (the daemon is verified serving).";
const NO_REGISTRATION =
  "  WARNING: no mempalace registration could be written although the daemon is verified serving.";

const DEFAULT_FACTS: ArmFacts = { stdioRegistered: true, existingEntry: true };

/**
 * The pure table of requirement 26. `facts` only matters for Claude rc 1 (did the stdio
 * registration succeed) and rc 2 (is there an entry to keep); the default is the success case.
 */
export function armFor(cli: Cli, rc: EnsureRc, facts: ArmFacts = DEFAULT_FACTS): Arm {
  if (cli === "claude") {
    if (rc === 0) return { lines: [], installed: true, action: "none" };
    if (rc === 1) {
      return facts.stdioRegistered
        ? { lines: [CONVERGED], installed: true, action: "converge-stdio" }
        : { lines: [CONVERGE_FAILED], installed: false, action: "converge-stdio" };
    }
    return facts.existingEntry
      ? { lines: [KEPT], installed: true, action: "keep-existing" }
      : { lines: [NO_REGISTRATION], installed: false, action: "keep-existing" };
  }
  // Gemini, Copilot, Antigravity: the stdio entry was written before, so MemPalace stays installed.
  if (rc === 0) return { lines: [HTTP_READY], installed: true, action: "none" };
  if (rc === 1) return { lines: STDIO_WARNING, installed: true, action: "none" };
  return { lines: LOCKOUT_WARNING, installed: true, action: "none" };
}

export interface MempalaceStepDeps {
  readonly ctx: { readonly io: Io };
  readonly cli: Cli;
  /** `ensure_mempalace_http`: resolves the return code; injected from the ensure-http module. */
  readonly ensure: () => Promise<EnsureRc>;
  /**
   * Writes the stdio entry and says whether it is there. Claude: called on rc 1 only, after the
   * removal. Others: called FIRST; a `false` skips the ensure (the shell's `MEMPALACE_INSTALLED`
   * / `INSTALL_MEMPALACE` guard) and leaves nothing printed.
   */
  readonly registerStdio: () => boolean | Promise<boolean>;
  /** Claude rc 1: `claude mcp remove --scope user mempalace`; a failure is ignored (`|| true`). */
  readonly removeUserScope: () => void | Promise<void>;
  /** Claude rc 2: `mcp_is_registered mempalace`. */
  readonly isRegistered: () => boolean | Promise<boolean>;
}

export interface MempalaceStepResult {
  readonly installed: boolean;
}

function isEnsureRc(value: unknown): value is EnsureRc {
  return value === 0 || value === 1 || value === 2;
}

function say(io: Io, lines: readonly string[]): void {
  for (const line of lines) io.out(line);
}

/** Run the call site for `cli`; never throws on return code 1 or 2. */
export async function runMempalaceStep(deps: MempalaceStepDeps): Promise<MempalaceStepResult> {
  const { ctx, cli } = deps;
  if (cli !== "claude") {
    if (!(await deps.registerStdio())) return { installed: false };
    const rc: unknown = await deps.ensure();
    // An unexpected code matches no `case` branch in the shell: nothing printed, entry stays.
    if (!isEnsureRc(rc)) return { installed: true };
    const arm = armFor(cli, rc);
    say(ctx.io, arm.lines);
    return { installed: arm.installed };
  }

  const rc: unknown = await deps.ensure();
  if (!isEnsureRc(rc)) return { installed: false };
  if (rc === 0) return { installed: armFor(cli, 0).installed };
  if (rc === 1) {
    try {
      await deps.removeUserScope();
    } catch {
      // `claude mcp remove ... >/dev/null 2>&1 || true`
    }
    const arm = armFor(cli, 1, {
      stdioRegistered: await deps.registerStdio(),
      existingEntry: false,
    });
    say(ctx.io, arm.lines);
    return { installed: arm.installed };
  }
  const arm = armFor(cli, 2, { stdioRegistered: false, existingEntry: await deps.isRegistered() });
  say(ctx.io, arm.lines);
  return { installed: arm.installed };
}
