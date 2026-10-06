// hook-descriptor.ts — what a hook row registers so the shared wiring
// mechanism (hook-recognition, hook-rewrite, hook-wiring) can recognise,
// render and rewrite its commands without knowing the hook (spec 0243 R25).
//
// The shape is fixed here so the later rows C2 (`worktree-git-guard`) and C3
// (`mempalace-transcript`) register a descriptor and change no mechanism.

/** The CLIs whose hooks live in a JSON configuration file setup rewrites. */
export type WiredCli = "claude" | "gemini" | "copilot";

export interface HookDescriptor {
  /** Stable id, e.g. `usage-capture`. */
  readonly id: string;
  /** Script basename: `hooks/<basename>.sh` (legacy) becomes `hooks/<basename>.ts`. */
  readonly basename: string;
  /** Per-CLI identifier passed as the first positional argument. */
  readonly cliIds: Readonly<Record<WiredCli, string>>;
  /** Positional arguments the command carries after the script path. */
  readonly args: (cli: WiredCli, event: string) => readonly string[];
  /**
   * Regular-expression source (JavaScript flavour, applied to the text after
   * the script path, anchored at both ends by the caller) that recognises the
   * arguments. Default: whitespace, one of `cliIds`, whitespace, an event
   * name of letters, optional trailing whitespace.
   */
  readonly argsPattern?: string;
  /**
   * The one legacy form an unquoted token cannot express: origin/main wrote
   * the Gemini command unquoted, so a checkout path with a space gave
   * `bash /My Projects/.../hooks/<basename>.sh <cliId> <event>`. Recognised
   * only when the whole path names an existing file.
   */
  readonly legacySpaced?: { readonly cliId: string; readonly event: string };
  /**
   * Spec 0243 delta-03 R34: only for descriptors whose Windows command lines
   * the module produces in the guarded form (`GUARDED_PREFIX` of
   * hook-command.ts) — the Antigravity CLI statusline, and the Antigravity CLI
   * hooks-surface descriptors of rows C2/C3. Never on `USAGE_CAPTURE`, whose
   * signature keeps rejecting the prefix in both twins (R20).
   */
  readonly guardedPrefix?: true;
  /**
   * Spec 0247 R28 (descriptor fields, delta-01): the arguments may also be
   * absent — the argument-less legacy command — on top of `argsPattern`.
   */
  readonly bareArgs?: true;
  /**
   * Spec 0247 R24: the names of a `NAME=value` prefix the framework itself
   * wrote and drops when it rewrites the command to the direct form; a prefix
   * with any other name is the operator's (`foreign-prefix`).
   */
  readonly ownedEnvNames?: readonly string[];
  /**
   * Spec 0247 R25: a rewrite targets the `.ts` of the checkout that runs
   * setup, whatever path the command names, instead of the `.ts` next to the
   * registered `.sh` (C1's target-exists rule).
   */
  readonly retarget?: "running-checkout";
  /**
   * Spec 0247 R28 (delta-01): the recognised script path ends in
   * `/<basename>.sh` or `/<basename>.ts` in any directory, without the
   * `/hooks/` segment the signature requires otherwise.
   */
  readonly anyScriptDir?: true;
}

export const USAGE_CAPTURE: HookDescriptor = {
  id: "usage-capture",
  basename: "usage-capture",
  cliIds: { claude: "claude-code", gemini: "gemini-cli", copilot: "copilot-cli" },
  args: (cli, event) => [USAGE_CAPTURE.cliIds[cli], event],
  legacySpaced: { cliId: "gemini-cli", event: "AfterModel" },
};

/**
 * The Antigravity CLI status-line shim, recognised by the same mechanism: its
 * `statusLine.command` is a bare script path (legacy) or `node <path>`
 * (direct), with no arguments. The per-CLI ids are placeholders — the shim is
 * wired on one surface of one CLI and its arguments pattern accepts none.
 */
export const ANTIGRAVITY_STATUSLINE: HookDescriptor = {
  id: "antigravity-statusline",
  basename: "antigravity-statusline-shim",
  cliIds: { claude: "antigravity", gemini: "antigravity", copilot: "antigravity" },
  args: () => [],
  argsPattern: "\\s*",
  guardedPrefix: true,
};

/**
 * The worktree git guard (spec 0248 R27): a PreToolUse-class hook that takes no
 * argument — it reads its payload from standard input — and is wired on all
 * four CLIs. The per-CLI ids are never passed (`args` is empty and the
 * arguments pattern accepts none). `guardedPrefix` is set because the guard's
 * Antigravity CLI command line takes the guarded form on Windows (spec 0243
 * delta-03 R34); the bare `node` forms of the other CLIs are unaffected.
 */
export const WORKTREE_GIT_GUARD: HookDescriptor = {
  id: "worktree-git-guard",
  basename: "worktree-git-guard",
  cliIds: { claude: "claude-code", gemini: "gemini-cli", copilot: "copilot-cli" },
  args: () => [],
  argsPattern: "\\s*",
  guardedPrefix: true,
};

/**
 * The MemPalace transcript hook (spec 0247 R20-R28). It is wired on all four
 * CLIs with its CLI identifier — `antigravity-cli <event>` on Antigravity CLI,
 * whose arguments hook-transcript-manifest.ts passes per event key — and its
 * installed commands also take the legacy forms setup has ever written: no
 * argument, or one event word (R24 forms (i)-(iv)).
 */
export const MEMPALACE_TRANSCRIPT: HookDescriptor = {
  id: "mempalace-transcript",
  basename: "mempalace-transcript",
  cliIds: { claude: "claude-code", gemini: "gemini-cli", copilot: "copilot-cli" },
  args: (cli) => [MEMPALACE_TRANSCRIPT.cliIds[cli]],
  argsPattern:
    "(?:\\s+[A-Za-z]+|\\s+(?:claude-code|gemini-cli|copilot-cli)|\\s+antigravity-cli\\s+[A-Za-z]+)\\s*",
  bareArgs: true,
  ownedEnvNames: ["MEMPALACE_TRANSCRIPT_ENABLED", "MEMPALACE_PYTHON"],
  retarget: "running-checkout",
  anyScriptDir: true,
  guardedPrefix: true,
};
