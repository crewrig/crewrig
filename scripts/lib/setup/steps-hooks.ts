// steps-hooks.ts — the `hooks-rewrite-installed` and `session-recording` steps of the three CLIs
// that keep their hooks in a JSON file: Claude Code and Gemini CLI (`settings.json`) and Copilot CLI
// (`~/.copilot/hooks/copilot-transcript-hooks.json`) — spec 0256 requirements 29-31, plan v2 step
// B3b.1. Shell: scripts/setup-claude-interactive.sh 440-525, gemini 396-471, copilot 386-463. The
// steps dispatch on `descriptor.hooks.channel`; `agy-json` is Antigravity CLI's: the body is steps-agy.ts's
// (`agyHooksRewriteInstalled`, `agySessionRecording`), to which these entries delegate.
//
// Nothing here aborts the run except the shell's own `exit 1` on a manifest that cannot be rendered;
// a failed rewrite or merge prints the shell's message and the run continues (the shell's `|| true`).

import path from "node:path";

import type { WiredCli } from "../hook-descriptor.ts";
import type { StepEnv, StepFn, StepRegistry } from "./descriptor.ts";
import { SetupExit } from "./exit.ts";
import { rewriteInstalledHooks } from "./hooks-rewrite.ts";
import { agyHooksRewriteInstalled, agySessionRecording } from "./steps-agy.ts";
import {
  claudeEnvPatch,
  mergeSessionRecordingHooks,
  renderSessionRecordingManifest,
} from "./session-recording.ts";
import { warnIfLinkedWorktree } from "./worktree-warning.ts";

/** The CLI as one of the three hook-file CLIs, or `undefined` for Antigravity CLI. */
export function wiredCli(cli: string): WiredCli | undefined {
  return cli === "claude" || cli === "gemini" || cli === "copilot" ? cli : undefined;
}

/** The file the hook steps read and write: the settings target of the MCP step, else `hooks.file`. */
export function hooksFile(env: StepEnv): string {
  const { descriptor, state, ctx } = env;
  if (descriptor.hooks.channel === "settings" && state.settingsTarget !== undefined) {
    return state.settingsTarget;
  }
  return path.join(ctx.home, descriptor.hooks.file);
}

interface Texts {
  /** Lines of the disclosure between its header and the `Recording depends` lines. */
  readonly disclosure: (file: string, src: string, repo: string, python: string) => string[];
  readonly confirmHeader: string;
  readonly merged: (file: string) => string;
  readonly canceled: readonly string[];
  readonly disabled: readonly string[];
}

const EARLIER =
  "  Any session-recording hooks an earlier run registered in settings.json are left in place; installed guard and transcript commands were rewritten above where their consent was established.";

const TEXTS: Readonly<Record<WiredCli, Texts>> = {
  claude: {
    disclosure: (file, src, repo, python) => [
      `  1. Backup ${file} to ${file}.bak.<timestamp>`,
      `  2. Merge hooks from ${src} into ${file}, each command running`,
      `     node "${repo}/hooks/mempalace-transcript.ts" claude-code (in-repo absolute`,
      "     path; Node.js >= 24 is needed when the hook fires)",
      `  3. Set env.MEMPALACE_TRANSCRIPT_ENABLED="1" in ${file}`,
      ...(python === "" ? [] : [`  4. Set env.MEMPALACE_PYTHON="${python}" in ${file}`]),
    ],
    confirmHeader: "Apply these changes to settings.json?",
    merged: () => "  Transcript hooks merged into settings.json",
    canceled: ["  Transcript activation canceled by user."],
    disabled: ["  Session recording disabled (can enable later by re-running this script)."],
  },
  gemini: {
    disclosure: (file, src, repo) => [
      `  1. Backup ${file} to ${file}.bak.<timestamp>`,
      `  2. Merge hooks from ${src} into ${file}, each command running`,
      `     node "${repo}/hooks/mempalace-transcript.ts" gemini-cli (in-repo absolute`,
      "     path, no environment prefix; Node.js >= 24 is needed when the hook fires)",
    ],
    confirmHeader: "Apply these changes to settings.json?",
    merged: () => "  Transcript hooks merged into settings.json",
    canceled: ["  Transcript activation canceled by user.", EARLIER],
    disabled: [
      "  Session recording disabled (can enable later by re-running this script).",
      EARLIER,
    ],
  },
  copilot: {
    disclosure: (file, _src, repo) => [
      `  1. Merge user-level hooks into ${file} (fires for ALL projects),`,
      "     backing it up first when it exists; your own entries and keys are kept",
      `  2. Wire each transcript command as node "${repo}/hooks/mempalace-transcript.ts"`,
      "     copilot-cli (in-repo absolute path, no environment prefix; Node.js >= 24",
      "     is needed when the hook fires)",
    ],
    confirmHeader: "Apply?",
    merged: (file) => `  User-level transcript hooks deployed to ${file}`,
    canceled: ["  Transcript activation canceled."],
    disabled: ["  Session recording disabled (re-run this script to enable)."],
  },
};

/** `guard_rewrite_installed`, `transcript_rewrite_installed`, `report_unused_transcript_copy` (statuses ignored). */
const hooksRewriteInstalled: StepFn = async (env) => {
  const { descriptor, ctx, spawn } = env;
  const cli = wiredCli(descriptor.cli);
  if (descriptor.hooks.channel === "agy-json" || cli === undefined)
    return agyHooksRewriteInstalled(env);
  if (descriptor.hooks.leadingBlank) ctx.io.out("");
  const { unusedCopy } = descriptor.hooks;
  rewriteInstalledHooks({
    ctx,
    cli,
    settingsPath: hooksFile(env),
    spawn,
    ...(unusedCopy === "" ? {} : { unusedCopy: path.join(ctx.home, unusedCopy) }),
  });
};

/** The opt-in: question, disclosure, confirmation, render, merge, and the shell's report lines. */
const sessionRecording: StepFn = async (env) => {
  const { descriptor, ctx, state, session, spawn } = env;
  const cli = wiredCli(descriptor.cli);
  if (descriptor.hooks.channel === "agy-json" || cli === undefined) return agySessionRecording(env);
  const { out, err } = ctx.io;
  const text = TEXTS[cli];
  const file = hooksFile(env);
  const repo = ctx.repoDir;
  const src = path.join(repo, descriptor.hooks.src);
  const python = state.pythonBin ?? "";
  if (descriptor.hooks.leadingBlank) out("");
  // `|| true` at the shell site: a cancelled question reads as a decline (cancel class `decline`).
  const enable = await session.choose({
    id: "transcripts",
    header: "Enable automatic session recording to MemPalace? (opt-in)",
    options: ["no", "yes"],
    cancel: "decline",
  });
  if (enable !== "yes") {
    for (const line of text.disabled) out(line);
    return;
  }
  out("");
  out("Activating transcript hooks will:");
  for (const line of text.disclosure(file, src, repo, python)) out(line);
  out(`  Recording depends on this checkout staying at ${repo};`);
  out("  re-running this setup from a checkout repairs it.");
  out("");
  const confirm = await session.choose({
    id: "transcripts-confirm",
    header: text.confirmHeader,
    options: ["yes", "no"],
    cancel: "decline",
  });
  if (confirm !== "yes") {
    for (const line of text.canceled) out(line);
    return;
  }
  const rendered = renderSessionRecordingManifest({ ctx, cli, manifestSrc: src, spawn });
  if (rendered === null) {
    err(`  ERROR: could not render ${src}.`);
    throw new SetupExit(1);
  }
  state.srTranscriptWired = rendered.transcriptWired;
  // The consent the next declined run reads (spec 0247 R23): only Claude Code, only when wired.
  const envPatch = descriptor.hooks.envPatch
    ? claudeEnvPatch(rendered.transcriptWired, python)
    : undefined;
  const merge = mergeSessionRecordingHooks({
    ctx,
    cli,
    config: file,
    patched: rendered.manifest,
    ...(envPatch === undefined ? {} : { envPatch: envPatch.patch }),
  });
  if (!merge.ok) {
    err("  Transcript activation FAILED — setup continues without it.");
    return;
  }
  state.srAllHooksDisabled = merge.allHooksDisabled;
  out(text.merged(file));
  if (merge.allHooksDisabled) {
    out(`  Session recording is NOT active: "disableAllHooks" is true in ${file}.`);
  } else if (rendered.transcriptWired) {
    out(
      `  Session recording wired to ${repo}/hooks/mempalace-transcript.ts (in-repo absolute path)`,
    );
    warnIfLinkedWorktree(ctx, spawn, "session recording");
    if (envPatch !== undefined) out(`  env patched: ${envPatch.text}`);
  } else {
    out(
      "  Session recording NOT activated this run; installed transcript commands are left as they are.",
    );
  }
  if (rendered.guardWired) {
    out(
      `  Worktree git guard wired to ${repo}/hooks/worktree-git-guard.ts (in-repo absolute path)`,
    );
    warnIfLinkedWorktree(ctx, spawn, "worktree git guard");
  }
};

export const hooksSteps: StepRegistry = {
  "hooks-rewrite-installed": hooksRewriteInstalled,
  "session-recording": sessionRecording,
};
