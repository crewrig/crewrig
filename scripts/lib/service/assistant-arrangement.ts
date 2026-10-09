// assistant-arrangement.ts — the per-assistant MemPalace arrangement and its
// report (spec 0252 requirements 15 and 22; plan v3 D1 rows status-report and
// owner-check). Ports `mcp_assistant_present`, `mcp_assistant_arrangement` and
// `mcp_report_assistant_arrangements` of scripts/lib/common.sh, with their
// text and return value kept.
//
// DEVIATION 31(b), stated rather than implied: the shell reads the four
// configuration files with `jq`; here there is no `jq`, so the strict JSON
// reader of mempalace-registration.ts (`classifyFile`) decides what parses.
// It is stricter than `jq -e .` on a few inputs (a byte order mark, comments,
// duplicate keys, depth over 64): such a file is `unknown` here where jq may
// have accepted it. The Gemini comment leniency of the registration check is
// not applied, because jq never had it. Everything `jq` accepts and reads as
// an entry maps to the same answer.

import { servicePlatform } from "./exec.ts";
import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { classifyFile, configPath } from "../mempalace-registration.ts";
import type { Classification, FileRead } from "../mempalace-registration.ts";

export type Cli = "claude" | "gemini" | "copilot" | "antigravity";
export type Arrangement = "http" | "stdio" | "none" | "unknown" | "absent";

const CLIS: readonly Cli[] = ["claude", "gemini", "copilot", "antigravity"];

/** The configuration path of an assistant (`mcp_assistant_config_path`). */
export function assistantConfigPath(cli: Cli, home: string): string {
  return configPath(cli, home);
}

const BINARY: Readonly<Record<Cli, string>> = {
  claude: "claude",
  gemini: "gemini",
  copilot: "copilot",
  antigravity: "agy",
};

function isFile(file: string): boolean {
  try {
    return statSync(file).isFile();
  } catch {
    return false;
  }
}

/** `command -v <binary>`: the binary is a regular file on PATH (`.exe`, `.cmd` and `.bat` too on Windows). */
export function assistantPresent(cli: Cli, env: NodeJS.ProcessEnv, home: string): boolean {
  void home;
  const name = BINARY[cli] as string | undefined;
  if (name === undefined) return false;
  const win = servicePlatform() === "win32";
  const exts = win ? ["", ".exe", ".cmd", ".bat"] : [""];
  for (const dir of (env["PATH"] ?? env["Path"] ?? "").split(path.delimiter)) {
    if (dir === "") continue;
    for (const ext of exts) {
      if (isFile(path.join(dir, `${name}${ext}`))) return true;
    }
  }
  return false;
}

function readConfig(file: string): FileRead {
  if (!isFile(file)) return { kind: "missing" };
  try {
    return { kind: "ok", bytes: readFileSync(file) };
  } catch {
    return { kind: "unreadable" };
  }
}

function arrangementOf(c: Classification, cli: Cli): Arrangement {
  switch (c.class) {
    case "absent":
      // No file: Claude's own CLI exists, so it is `none`; the other three are `absent`.
      return c.reason === "no-file" && cli !== "claude" ? "absent" : "none";
    case "stdio":
      return "stdio";
    case "ok":
    case "wrong-endpoint":
      return "http";
    case "unrecognised":
      return "unknown";
  }
}

/**
 * http / stdio / none / unknown / absent, as `mcp_assistant_arrangement`:
 * Claude absent from PATH is `absent`; a missing file is `none` for Claude and
 * `absent` for the other three; a file that does not parse is `unknown`.
 */
export function assistantArrangement(cli: Cli, env: NodeJS.ProcessEnv, home: string): Arrangement {
  if (!CLIS.includes(cli)) return "unknown";
  if (cli === "claude" && !assistantPresent("claude", env, home)) return "absent";
  return arrangementOf(classifyFile(readConfig(assistantConfigPath(cli, home)), ""), cli);
}

/** The registered URL when an http entry points at another endpoint than `expected`, else null. */
function wrongEndpoint(cli: Cli, expected: string, home: string): string | null {
  const c = classifyFile(readConfig(assistantConfigPath(cli, home)), expected);
  return c.class === "wrong-endpoint" ? c.registered : null;
}

/**
 * One line per assistant through `write`. With a non-empty `installedEndpoint`,
 * an `http` entry registered against another endpoint reads `WRONG ENDPOINT`
 * (spec 0246 R4). Returns false only when `mode` is `serving` or `healthy` and
 * an assistant is still on stdio (the half-converted lockout).
 */
export function reportArrangements(
  mode: string,
  installedEndpoint: string,
  env: NodeJS.ProcessEnv,
  home: string,
  write: (line: string) => void,
): boolean {
  let lockout = false;
  for (const cli of CLIS) {
    const name = cli.padEnd(12);
    switch (assistantArrangement(cli, env, home)) {
      case "http": {
        const registered =
          installedEndpoint === "" ? null : wrongEndpoint(cli, installedEndpoint, home);
        write(
          registered === null
            ? `  ${name} http (shared daemon)`
            : `  ${name} http (WRONG ENDPOINT: registered ${registered}, expected ${installedEndpoint})`,
        );
        break;
      }
      case "stdio":
        if (mode === "serving" || mode === "healthy") {
          write(`  ${name} stdio (LOCKED OUT by shared daemon)`);
          lockout = true;
        } else {
          write(`  ${name} stdio (previous arrangement)`);
        }
        break;
      case "none":
        write(`  ${name} no mempalace registration`);
        break;
      case "absent":
        write(`  ${name} CLI not installed`);
        break;
      default:
        write(`  ${name} *** UNRECOGNISED — run 'task mempalace:repair' ***`);
    }
  }
  return !lockout;
}
