// transcript-fixtures.ts — throwaway checkouts, installed configurations and
// runners for the MemPalace transcript wiring suites (spec 0247 R20-R29,
// delta-01; plan step 23).
//
// A checkout is C2's (guard-wiring-fixtures.ts: the real transcript manifests
// and a guard entry) plus stub `hooks/mempalace-transcript.{ts,sh}`, which is
// all `hook-wiring.ts --repo` and the Bash setup libraries need. The physical
// path of the `.ts` is what the tools write (R21).

import fs from "node:fs";
import path from "node:path";

import { classifyTranscript, type TranscriptClass } from "../../lib/transcript-recognition.ts";
import {
  handler,
  handlers,
  makeCheckout,
  type Checkout,
  type Json,
} from "./guard-wiring-fixtures.ts";
import { cleanEnv, makePathDir, read, realTmp, REPO, which } from "./worktree-fixtures.ts";

export type WiredCli = "claude" | "gemini" | "copilot";
export const WIRED: readonly WiredCli[] = ["claude", "gemini", "copilot"];
export const CLI_ID: Readonly<Record<WiredCli, string>> = {
  claude: "claude-code",
  gemini: "gemini-cli",
  copilot: "copilot-cli",
};
/** The event each wired CLI's test configurations put the transcript command on. */
export const EVENT: Readonly<Record<WiredCli, string>> = {
  claude: "Stop",
  gemini: "AfterModel",
  copilot: "agentStop",
};
/** Where an earlier setup installed its copy of the shell hook, under the home directory. */
export const HOME_DIR: Readonly<Record<WiredCli, string>> = {
  claude: ".claude",
  gemini: ".gemini",
  copilot: ".copilot",
};
export const AGY_HOOK = "crewrig-mempalace-transcript";
export const AGY_GUARD = "crewrig-worktree-git-guard";
export const q = JSON.stringify;

export interface TranscriptCheckout extends Checkout {
  /** The physical path of `hooks/mempalace-transcript.ts`, as the tools write it. */
  readonly ts: string;
}

/** A checkout with the transcript entry (unless `entry: false`) and its shim. */
export function makeTranscriptCheckout(
  name = "co",
  options: { entry?: boolean; capture?: boolean } = {},
): TranscriptCheckout {
  const co = makeCheckout(name);
  const hooks = path.join(co.repo, "hooks");
  const ts = path.join(hooks, "mempalace-transcript.ts");
  if (options.entry !== false) fs.writeFileSync(ts, "// entry\n");
  fs.writeFileSync(path.join(hooks, "mempalace-transcript.sh"), "#!/bin/bash\n");
  if (options.capture === true) {
    // What the usage-capture opt-in needs from a checkout (spec 0211, 0243).
    for (const cli of WIRED) {
      const fragment = `${cli}-usage-capture-hooks.json`;
      fs.copyFileSync(path.join(REPO, "hooks", fragment), path.join(hooks, fragment));
    }
    fs.writeFileSync(path.join(hooks, "usage-capture.ts"), "// entry\n");
    fs.writeFileSync(path.join(hooks, "usage-capture.sh"), "#!/bin/bash\n");
  }
  return { ...co, ts };
}

/** The script path as the tools write it: forward slashes on Windows (hookCommandLine). */
const written = (co: TranscriptCheckout): string => co.ts.replaceAll("\\", "/");

/** The direct form the tools write for `cli` (R20). */
export const directCmd = (co: TranscriptCheckout, cli: WiredCli): string =>
  `node "${written(co)}" ${CLI_ID[cli]}`;
export const agyDirect = (co: TranscriptCheckout, event: string): string =>
  `node "${written(co)}" antigravity-cli ${event}`;

/** The legacy forms setup has written, one per class (R24), on `home`'s installed copy. */
export function legacyForms(home: string, dir: string): Record<string, string> {
  const copy = path.join(home, dir, "hooks", "mempalace-transcript.sh");
  return {
    "legacy-enabled": `MEMPALACE_TRANSCRIPT_ENABLED=1 MEMPALACE_PYTHON=/usr/bin/python3 bash ${copy}`,
    "legacy-unmarked": `bash "${copy}"`,
    "legacy-unmarked (=0)": `MEMPALACE_TRANSCRIPT_ENABLED=0 bash "${copy}"`,
    "foreign-prefix": `MEMPALACE_TRANSCRIPT_ENABLED=1 MEMPALACE_MCP_PORT=41999 bash "${copy}"`,
  };
}

/** Antigravity CLI commands on its installed copy under `home`, legacy event `Stop`. */
export function agyCommands(home: string) {
  const copy = path.join(home, ".gemini", "antigravity-cli", "hooks", "mempalace-transcript.sh");
  return {
    enabled: `MEMPALACE_TRANSCRIPT_ENABLED=1 bash "${copy}" Stop`,
    unmarked: `bash "${copy}" Stop`,
    disabled: `MEMPALACE_TRANSCRIPT_ENABLED=0 bash "${copy}" Stop`,
    foreign: `MEMPALACE_MCP_PORT=41999 bash "${copy}" Stop`,
    /** Delta-01: a script called mempalace-transcript.* with other arguments, never a transcript command. */
    otherArgs: "bash /x/mempalace-transcript.sh --foo bar",
    otherArgsStop: 'bash "/x/hooks/mempalace-transcript.sh" Stop extra',
  };
}

/** The guard, a usage-capture command and an operator hook, beside the transcript (scenario 16). */
export const NEIGHBOURS = (co: Checkout, cli: WiredCli): string[] => [
  `node "${co.guard}"`,
  `node "/repo/hooks/usage-capture.ts" ${CLI_ID[cli]} ${EVENT[cli]}`,
  "/opt/operator/notify.sh --loud",
];

/**
 * A configuration of `cli`'s shape holding `commands` on its test event (after
 * the neighbours, when given) and one unrelated top-level key.
 */
export function configOf(
  cli: WiredCli,
  commands: readonly string[],
  extra: { env?: Json; neighbours?: readonly string[] } = {},
): Json {
  const all = [...(extra.neighbours ?? []), ...commands];
  const env = extra.env === undefined ? {} : { env: extra.env };
  switch (cli) {
    case "claude":
      return {
        model: "opus",
        ...env,
        hooks: {
          [EVENT.claude]: [{ matcher: "", hooks: all.map((c) => handler(c, { timeout: 30 })) }],
        },
      };
    case "gemini":
      return {
        ui: { theme: "dark" },
        hooks: {
          [EVENT.gemini]: [{ hooks: all.map((c, i) => handler(c, { name: `h${i}` })) }],
        },
      };
    case "copilot":
      return {
        version: 1,
        hooks: { [EVENT.copilot]: all.map((c) => handler(c)) },
      };
  }
}

/** Write `config` (pretty, mode 0644) next to the checkout; returns the path. */
export function writeConfig(co: Checkout, name: string, config: Json): string {
  const file = path.join(path.dirname(co.repo), name);
  fs.writeFileSync(file, `${JSON.stringify(config, null, 2)}\n`, {
    mode: 0o644,
  });
  return file;
}

/** Every handler command, per event key path, in document order. */
export const commands = (config: unknown): string[] =>
  handlers(config).map((h) => h["command"] as string);

/** The transcript commands (any class) of a configuration. */
export const transcriptCommands = (config: unknown): string[] =>
  commands(config).filter((c) => classifyTranscript(c) !== "no");

/** The class of every transcript command of one event's array. */
export function eventClasses(entries: unknown): TranscriptClass[] {
  return commands(entries)
    .map((c) => classifyTranscript(c))
    .filter((c) => c !== "no");
}

/** A home directory holding the installed copies an earlier setup made. */
export function homeWithCopies(): string {
  const home = realTmp("crewrig-transcript-home-");
  for (const dir of [".claude", ".gemini", ".copilot", ".gemini/antigravity-cli"]) {
    fs.mkdirSync(path.join(home, dir, "hooks"), { recursive: true });
    fs.writeFileSync(path.join(home, dir, "hooks", "mempalace-transcript.sh"), "#!/bin/bash\n");
  }
  return home;
}

export const MANIFEST = (cli: WiredCli | "antigravity"): string =>
  path.join(REPO, "hooks", `${cli}-transcript-hooks.json`);

/**
 * The Bash of a setup's `yes` to the session-recording question: render, then
 * merge, with Claude Code's env patch only when the transcript is wired.
 * Prints `rc=<status> wired=<SR_TRANSCRIPT_WIRED> disabled=<SR_ALL_HOOKS_DISABLED>`.
 */
export const yesScript = (cli: WiredCli, co: TranscriptCheckout, file: string): string =>
  `render_session_recording_manifest ${cli} ${q(co.repo)} ${q(co.manifest(cli))} rendered.json \\
     && { patch='{}'; [ "$SR_TRANSCRIPT_WIRED" = 1 ] && patch='{"MEMPALACE_TRANSCRIPT_ENABLED": "1"}'
          merge_session_recording_hooks ${cli} ${q(file)} rendered.json "$patch"; }
   echo "rc=$? wired=\${SR_TRANSCRIPT_WIRED:-} disabled=\${SR_ALL_HOOKS_DISABLED:-}"`;

export const eventsOf = (config: Json): Record<string, unknown> =>
  (config["hooks"] ?? {}) as Record<string, unknown>;

/** The events of `cli`'s manifest that carry a transcript command. */
export function manifestEvents(co: TranscriptCheckout, cli: WiredCli): string[] {
  const manifest = JSON.parse(read(co.manifest(cli))) as Json;
  return Object.entries(eventsOf(manifest))
    .filter(([, entries]) => transcriptCommands(entries).length > 0)
    .map(([event]) => event);
}

/** An environment whose `tools` append their argument list to `log`, then run the real binary. */
export function argvRecorder(tools: readonly string[], log: string): NodeJS.ProcessEnv {
  const scripts: Record<string, string> = {};
  for (const tool of tools) {
    const real = which(tool);
    if (real === null) throw new Error(`${tool} is needed by this test`);
    scripts[tool] = `printf '%s\\n' "$*" >> ${q(log)}\nexec ${q(real)} "$@"`;
  }
  return cleanEnv({ PATH: `${makePathDir({ scripts })}:${process.env["PATH"] ?? ""}` });
}

/** A PATH with what the setup libraries need besides Node.js, and no `node`. */
export function withoutNode(): NodeJS.ProcessEnv {
  const links: Record<string, string> = {};
  for (const tool of ["dirname", "grep", "cat", "jq", "mktemp", "sed", "tr", "uname"]) {
    const found = which(tool);
    if (found !== null) links[tool] = found;
  }
  return cleanEnv({ PATH: makePathDir({ links }) });
}
