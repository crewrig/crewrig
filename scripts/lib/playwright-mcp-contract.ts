// playwright-mcp-contract.ts — the public contract of `task setup:playwright-mcp`
// (spec 0245): dependency shapes, outcomes, labels and every message the task
// prints. Shared by scripts/lib/playwright-mcp.ts and its Claude Code adapter
// (scripts/lib/playwright-mcp-claude.ts), and re-exported by the former.
//
// Standard library only (spec 0240 R16).

import path from "node:path";

import type { JsonObject } from "./hook-config.ts";
import type { Cli, SamePath } from "./playwright-mcp-shape.ts";

export interface RunResult {
  readonly status: number;
  readonly stdout: string;
  readonly stderr: string;
}

/** Run one command (argv[0] looked up on PATH); never rejects on a non-zero exit. */
export type Run = (argv: readonly string[]) => Promise<RunResult>;

export interface SetupDeps {
  readonly run: Run;
  /** `HOME` (or `USERPROFILE`) and `PATH` are read from it. */
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly now: () => Date;
  /** The checkout the task runs from; the wrapper is `<repoRoot>/scripts/lib/tls-exec.sh`. */
  readonly repoRoot: string;
  /** Notices and the report (stdout). */
  readonly out: (line: string) => void;
  /** Warnings (stderr). */
  readonly err: (line: string) => void;
}

/** One report outcome per assistant (spec 0245 R15). */
export type Outcome =
  | "registered"
  | "converged"
  | "relocated"
  | "already up to date"
  | "left untouched"
  | "skipped"
  | "failed";

export const CLI_LABEL: Readonly<Record<Cli, string>> = {
  claude: "Claude Code",
  gemini: "Gemini CLI",
  copilot: "GitHub Copilot CLI",
  antigravity: "Antigravity CLI",
};

export const CLI_BINARY: Readonly<Record<Cli, string>> = {
  claude: "claude",
  gemini: "gemini",
  copilot: "copilot",
  antigravity: "agy",
};

/** The configuration file of `cli` (`mcp_assistant_config_path` in scripts/lib/common.sh). */
export function configPath(cli: Cli, home: string): string {
  switch (cli) {
    case "claude":
      return path.join(home, ".claude.json");
    case "gemini":
      return path.join(home, ".gemini", "settings.json");
    case "copilot":
      return path.join(home, ".copilot", "mcp-config.json");
    case "antigravity":
      return path.join(home, ".gemini", "config", "mcp_config.json");
  }
}

const OPT_IN = "remove the entry, then re-run `task setup:playwright-mcp`";

/** Every message the task prints; the tests assert on these exact strings. */
export const MSG = {
  usage: "usage: task setup:playwright-mcp (the task takes no arguments)",
  header: "Registering the Playwright MCP server through the trust wrapper (spec 0245)...",
  skippedBinary: (label: string, binary: string) =>
    `  ${label}: skipped — \`${binary}\` is not on PATH.`,
  skippedConfig: (label: string, file: string) =>
    `  ${label}: skipped — ${file} does not exist (not created).`,
  registeredFile: (label: string, file: string, backup: string) =>
    `  ${label}: registered \`playwright\` in ${file} through the trust wrapper. Backup: ${backup}`,
  registeredClaude: (label: string) =>
    `  ${label}: registered \`playwright\` (user scope) through the trust wrapper.`,
  convergedFile: (label: string, file: string, backup: string) =>
    `  ${label}: converged the legacy \`playwright\` registration in ${file} to the trust-wrapped form. Backup: ${backup}`,
  relocatedFile: (label: string, file: string, oldPath: string, newPath: string, backup: string) =>
    `  ${label}: relocated the \`playwright\` trust wrapper in ${file} from ${oldPath} to ${newPath}. Backup: ${backup}`,
  convergingClaude: (label: string, prior: string) =>
    `  ${label}: converging the legacy \`playwright\` registration (user scope) to the trust-wrapped form. Replaced registration: ${prior}`,
  relocatingClaude: (label: string, oldPath: string, newPath: string, prior: string) =>
    `  ${label}: relocating the \`playwright\` trust wrapper (user scope) from ${oldPath} to ${newPath}. Replaced registration: ${prior}`,
  upToDate: (label: string) => `  ${label}: \`playwright\` is already up to date.`,
  untouched: (label: string, location: string) =>
    `  WARNING: ${label}: the \`playwright\` entry in ${location} was left untouched because it does not match the shape this task writes. To opt in to the trust-wrapped form, ${OPT_IN}.`,
  unreadable: (label: string, file: string, reason: string) =>
    `  WARNING: ${label}: ${file} cannot be read as ${label} reads it (${reason}); it was left unchanged.`,
  backupFailed: (label: string, file: string) =>
    `  WARNING: ${label}: ${file} could not be backed up; it was left unchanged.`,
  writeFailed: (label: string, file: string, reason: string) =>
    `  WARNING: ${label}: writing ${file} failed (${reason}); the file was left in its prior state.`,
  geminiComments: (file: string, backup: string) => [
    `  WARNING: ${file} holds comments; they are not kept in the rewritten file.`,
    `           They are preserved in the timestamped backup: ${backup}`,
  ],
  claudeCommandFailed: (label: string, command: string, detail: string) =>
    `  WARNING: ${label}: \`${command}\` failed${detail === "" ? "" : `: ${detail}`}.`,
  claudeRestored: (label: string) =>
    `  WARNING: ${label}: the replaced \`playwright\` registration was restored with \`claude mcp add-json\`.`,
  claudeRestoreFailed: (label: string, prior: string) =>
    `  WARNING: ${label}: restoring the replaced \`playwright\` registration failed; re-add it by hand: claude mcp add-json --scope user playwright '${prior}'`,
  claudeVerifyFailed: (label: string, file: string) =>
    `  WARNING: ${label}: after the change, the \`playwright\` entry in ${file} is not the trust-wrapped form.`,
  reportHeader: "Playwright MCP registration report:",
  reportLine: (label: string, outcome: Outcome) => `  ${label}: ${outcome}`,
} as const;

/** The result of reading one assistant's stored `playwright` entry. */
export type Read =
  | {
      readonly ok: true;
      readonly doc: JsonObject;
      readonly comments: boolean;
      readonly entry: unknown;
    }
  | { readonly ok: false; readonly reason: string };

/** What a per-assistant step needs from the run. */
export interface Context {
  readonly deps: SetupDeps;
  readonly home: string;
  readonly wrapper: string;
  readonly samePath: SamePath;
  readonly readEntry: (cli: Cli, file: string) => Read;
}
