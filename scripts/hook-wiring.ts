// hook-wiring.ts — the wiring tool the Bash setups reach through `node`
// (spec 0243 R19, R23, R25, R26).
//
//   node scripts/hook-wiring.ts render <cli>
//       Print the CLI's capture fragment (hooks/<cli>-usage-capture-hooks.json)
//       with every command built by hook-command.ts: no token survives.
//   node scripts/hook-wiring.ts rewrite <cli> --config <path>
//       Rewrite the registered capture commands of a CLI configuration to the
//       direct form, one command per event; report each command by name.
//   node scripts/hook-wiring.ts statusline install|rewrite
//         --settings <path> --marker <path>
//       The Antigravity CLI status line (scripts/lib/hook-statusline.ts).
//
// <cli> is claude, gemini or copilot. `--repo <dir>` and `--platform <p>`
// exist for tests only; the checkout root defaults to the one this file sits
// in. Configuration content is read from files and never taken from `argv`
// (R23). Exit: 0 done (also "nothing to do"), 1 refused or failed, 2 usage.
//
// Standard library only (spec 0240 R16).

import fs from "node:fs";
import path from "node:path";

import { hookCommandLine, physicalPath } from "./lib/hook-command.ts";
import {
  backupFile,
  NotAJsonObjectError,
  readJsonObject,
  writeJsonConfig,
  type JsonObject,
} from "./lib/hook-config.ts";
import { USAGE_CAPTURE, type HookDescriptor, type WiredCli } from "./lib/hook-descriptor.ts";
import { parseHandler } from "./lib/hook-recognition.ts";
import { rewriteConfig } from "./lib/hook-rewrite.ts";
import {
  installStatusline,
  rewriteStatusline,
  type StatuslineTarget,
} from "./lib/hook-statusline.ts";
import { repoRootFrom } from "./lib/paths.ts";

const CLIS: readonly WiredCli[] = ["claude", "gemini", "copilot"];
const DESCRIPTOR: HookDescriptor = USAGE_CAPTURE;

const out = (line: string): void => {
  process.stdout.write(`${line}\n`);
};
const err = (line: string): void => {
  process.stderr.write(`${line}\n`);
};

interface Parsed {
  readonly positional: string[];
  readonly options: Map<string, string>;
}

function parseArgs(argv: readonly string[]): Parsed {
  const positional: string[] = [];
  const options = new Map<string, string>();
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] ?? "";
    if (arg.startsWith("--")) options.set(arg.slice(2), argv[++i] ?? "");
    else positional.push(arg);
  }
  return { positional, options };
}

function asCli(value: string | undefined): WiredCli | null {
  return CLIS.find((c) => c === value) ?? null;
}

interface FragmentHandler {
  command?: unknown;
  [key: string]: unknown;
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** Every handler object of a fragment, whatever its shape. */
function fragmentHandlers(node: unknown, found: FragmentHandler[] = []): FragmentHandler[] {
  if (Array.isArray(node)) {
    for (const item of node) fragmentHandlers(item, found);
  } else if (isRecord(node)) {
    if (node["type"] === "command" && typeof node["command"] === "string") found.push(node);
    for (const value of Object.values(node)) fragmentHandlers(value, found);
  }
  return found;
}

function readFragment(repo: string, cli: WiredCli): JsonObject {
  const file = path.join(repo, "hooks", `${cli}-${DESCRIPTOR.id}-hooks.json`);
  const fragment = readJsonObject(file);
  if (fragment === null) throw new Error(`capture fragment not found at ${file}.`);
  return fragment;
}

/** Fragment with each command replaced by the module-built direct command line. */
function render(repo: string, cli: WiredCli, platform: NodeJS.Platform): number {
  const fragment = readFragment(repo, cli);
  const script = path.join(repo, "hooks", `${DESCRIPTOR.basename}.ts`);
  if (!fs.existsSync(script)) {
    err(`  ERROR: capture script not found at ${script}.`);
    return 1;
  }
  const physical = physicalPath(script);
  for (const handler of fragmentHandlers(fragment)) {
    const parse = parseHandler(handler, DESCRIPTOR);
    if (parse === null) {
      err(
        `  ERROR: the ${cli} capture fragment holds a command that does not match the capture signature.`,
      );
      return 1;
    }
    const args = parse.post.split(/\s+/).filter((word) => word !== "");
    const built = hookCommandLine({ cli, surface: "hooks", platform, scriptPath: physical, args });
    if (!built.ok) {
      err(`  ERROR: ${built.refusal}`);
      return 1;
    }
    handler.command = built.command;
  }
  out(JSON.stringify(fragment));
  return 0;
}

function rewrite(repo: string, cli: WiredCli, config: string, platform: NodeJS.Platform): number {
  let current: JsonObject | null;
  try {
    current = readJsonObject(config);
  } catch (error) {
    if (error instanceof NotAJsonObjectError) {
      err(`  ERROR: ${config} is not a JSON object; usage capture left as it is.`);
      return 1;
    }
    throw error;
  }
  if (current === null) {
    out(`  No usage-capture entry in ${config}; nothing to rewrite.`);
    return 0;
  }
  const fragmentEvents = Object.keys(
    (readFragment(repo, cli)["hooks"] as JsonObject | undefined) ?? {},
  );
  const result = rewriteConfig(current, {
    descriptor: DESCRIPTOR,
    cli,
    platform,
    dedupEvents: fragmentEvents,
  });
  for (const line of result.lines) {
    out(`  Usage capture: ${line.kind} ${line.path} on ${line.event} (${line.detail})`);
  }
  if (!result.changed) {
    out(
      `  Usage capture: ${result.left} command(s) left as they are in ${config}; nothing written.`,
    );
    return 0;
  }
  const backup = backupFile(config);
  if (backup.status === "failed") {
    err(`  ERROR: could not back up ${config}; leaving it untouched (backup-first, R23).`);
    return 1;
  }
  if (backup.status === "made") {
    out(`  Backed up: ${path.basename(config)} -> ${path.basename(backup.path)}`);
  }
  writeJsonConfig(config, result.config);
  out(
    `  Usage capture: rewrote ${result.rewrote}, left ${result.left}, dropped ${result.dropped} duplicate(s) in ${config}`,
  );
  return 0;
}

function statusline(
  action: string,
  options: Map<string, string>,
  repo: string,
  platform: NodeJS.Platform,
): number {
  const settings = options.get("settings");
  const marker = options.get("marker");
  if (!settings || !marker) {
    err("usage: hook-wiring.ts statusline install|rewrite --settings <path> --marker <path>");
    return 2;
  }
  const target: StatuslineTarget = { settings, marker, repo, platform };
  if (action === "install") return installStatusline(target, out);
  if (action === "rewrite") return rewriteStatusline(target, out);
  err(`unknown statusline action '${action}'`);
  return 2;
}

function main(argv: readonly string[]): number {
  const { positional, options } = parseArgs(argv);
  const [command, subject] = positional;
  const repo = options.get("repo") ?? repoRootFrom(import.meta.url);
  const platform = (options.get("platform") ?? process.platform) as NodeJS.Platform;
  try {
    if (command === "statusline") return statusline(subject ?? "", options, repo, platform);
    const cli = asCli(subject);
    if (cli === null) {
      err(`usage: hook-wiring.ts render|rewrite <${CLIS.join("|")}> [--config <path>]`);
      return 2;
    }
    if (command === "render") return render(repo, cli, platform);
    const config = options.get("config");
    if (command === "rewrite" && config) return rewrite(repo, cli, config, platform);
    err("usage: hook-wiring.ts rewrite <cli> --config <path>");
    return 2;
  } catch (error) {
    err(`  ERROR: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
}

process.exitCode = main(process.argv.slice(2));
