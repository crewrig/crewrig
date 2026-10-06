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
import { realTmp, REPO } from "./worktree-fixtures.ts";

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
  options: { entry?: boolean } = {},
): TranscriptCheckout {
  const co = makeCheckout(name);
  const ts = path.join(co.repo, "hooks", "mempalace-transcript.ts");
  if (options.entry !== false) fs.writeFileSync(ts, "// entry\n");
  fs.writeFileSync(path.join(co.repo, "hooks", "mempalace-transcript.sh"), "#!/bin/bash\n");
  return { ...co, ts };
}

/** The direct form the tools write for `cli` (R20, POSIX). */
export const directCmd = (co: TranscriptCheckout, cli: WiredCli): string =>
  `node "${co.ts}" ${CLI_ID[cli]}`;
export const agyDirect = (co: TranscriptCheckout, event: string): string =>
  `node "${co.ts}" antigravity-cli ${event}`;

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
