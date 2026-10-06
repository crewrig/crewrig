// hook-wiring.ts — the wiring tool the Bash setups reach through `node`
// (spec 0243 R19, R23, R25, R26; spec 0248 R27-R32).
//
//   node scripts/hook-wiring.ts [--hook <id>] render <cli>
//       Print the CLI's capture fragment (hooks/<cli>-usage-capture-hooks.json)
//       with every command built by hook-command.ts: no token survives.
//   node scripts/hook-wiring.ts [--hook <id>] rewrite <cli> --config <path>
//       Rewrite the registered commands of a CLI configuration to the
//       direct form, one command per event; report each command by name.
//   node scripts/hook-wiring.ts statusline install|rewrite
//         --settings <path> --marker <path>
//       The Antigravity CLI status line (scripts/lib/hook-statusline.ts).
//   node scripts/hook-wiring.ts guard render <cli> --manifest <path>
//   node scripts/hook-wiring.ts guard rewrite <cli> --config <path>
//   node scripts/hook-wiring.ts guard antigravity-rewrite --hooks <path>
//       The worktree git guard (hook id `worktree-git-guard`, row C2). The
//       first two are `--hook worktree-git-guard render|rewrite`.
//   node scripts/hook-wiring.ts transcript <action> ...
//       The MemPalace transcript hook (row C3, spec 0247): render, rewrite,
//       antigravity-merge, antigravity-rewrite, classify — see
//       scripts/lib/hook-transcript-cli.ts for the contract.
//
// `--hook <id>` selects a hook of scripts/lib/hook-registry.ts; the default,
// `usage-capture`, keeps every C1 caller unchanged. <cli> is claude, gemini or
// copilot (also antigravity for `guard render`). `--repo <dir>` and
// `--platform <p>` exist for tests only; the checkout root defaults to the one
// this file sits in. Configuration content is read from files and never taken
// from `argv` (R23). Exit: 0 done (also "nothing to do"), 1 refused or failed,
// 2 usage.
//
// guard render contract (what the Bash setups code against; v1-F1, v1-F2, v1-F4):
//   - stdout is ONE line: the manifest, compact JSON, only the guard's command
//     rendered (the guard is found by recognition; on antigravity by the
//     named-hook key `crewrig-worktree-git-guard`); every other byte is as read.
//     The rendered command is final: a caller that post-processes the other
//     handlers (Gemini and Copilot prepend an env prefix or rebuild `.command`)
//     MUST pass the guard's `.command` through untouched.
//   - a refusal (the module's, or a missing hooks/worktree-git-guard.ts) exits 0,
//     prints `  ERROR: <diagnostic>` on stderr, and the guard's handlers, and
//     any group, event or hook name they emptied, are ABSENT from stdout. A
//     caller detects a refusal by that absence (`jq` finds no guard handler) or
//     by the stderr line; it then carries an installed guard through unchanged.
//   - a missing or non-object manifest exits 1 with nothing on stdout.
// guard rewrite / antigravity-rewrite: every registered guard command is
// rewritten to the R29 form in place (C1 target-exists rule), reported by name
// and count; backup-first at 0600; idempotent (a second run writes nothing,
// makes no backup); a non-object configuration exits 1 byte-identical.
//
// Standard library only (spec 0240 R16).

import fs from "node:fs";
import path from "node:path";

import { hookCommandLine, physicalPath, type Cli } from "./lib/hook-command.ts";
import {
  backupFile,
  NotAJsonObjectError,
  readJsonObject,
  writeJsonConfig,
  type JsonObject,
} from "./lib/hook-config.ts";
import { WORKTREE_GIT_GUARD, type WiredCli } from "./lib/hook-descriptor.ts";
import { guardRenderFile } from "./lib/hook-guard-manifest.ts";
import { rewriteAntigravityGuardFile } from "./lib/hook-antigravity-write.ts";
import { parseHandler } from "./lib/hook-recognition.ts";
import { DEFAULT_HOOK, hookIds, lookupHook, type RegisteredHook } from "./lib/hook-registry.ts";
import { rewriteConfig } from "./lib/hook-rewrite.ts";
import { transcriptCommand } from "./lib/hook-transcript-cli.ts";
import {
  installStatusline,
  rewriteStatusline,
  type StatuslineTarget,
} from "./lib/hook-statusline.ts";
import { repoRootFrom } from "./lib/paths.ts";

const CLIS: readonly WiredCli[] = ["claude", "gemini", "copilot"];
const GUARD_CLIS: readonly Cli[] = [...CLIS, "antigravity"];

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

function readFragment(repo: string, hook: RegisteredHook, cli: WiredCli): JsonObject {
  const file = path.join(repo, "hooks", hook.manifestFile(cli));
  const fragment = readJsonObject(file);
  if (fragment === null) throw new Error(`capture fragment not found at ${file}.`);
  return fragment;
}

/** Fragment with each command replaced by the module-built direct command line. */
function render(
  repo: string,
  hook: RegisteredHook,
  cli: WiredCli,
  platform: NodeJS.Platform,
): number {
  const fragment = readFragment(repo, hook, cli);
  const script = path.join(repo, "hooks", `${hook.descriptor.basename}.ts`);
  if (!fs.existsSync(script)) {
    err(`  ERROR: capture script not found at ${script}.`);
    return 1;
  }
  const physical = physicalPath(script);
  for (const handler of fragmentHandlers(fragment)) {
    const parse = parseHandler(handler, hook.descriptor);
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

function rewrite(
  repo: string,
  hook: RegisteredHook,
  cli: WiredCli,
  config: string,
  platform: NodeJS.Platform,
): number {
  const { descriptor, label } = hook;
  let current: JsonObject | null;
  try {
    current = readJsonObject(config);
  } catch (error) {
    if (error instanceof NotAJsonObjectError) {
      err(`  ERROR: ${config} is not a JSON object; ${label.toLowerCase()} left as it is.`);
      return 1;
    }
    throw error;
  }
  if (current === null) {
    out(`  No ${descriptor.id} entry in ${config}; nothing to rewrite.`);
    return 0;
  }
  // The guard shares its manifest with other hooks: duplicates collapse on every event.
  const dedupEvents =
    descriptor.id === WORKTREE_GIT_GUARD.id
      ? undefined
      : Object.keys((readFragment(repo, hook, cli)["hooks"] as JsonObject | undefined) ?? {});
  const result = rewriteConfig(current, { descriptor, cli, platform, dedupEvents });
  for (const line of result.lines) {
    out(`  ${label}: ${line.kind} ${line.path} on ${line.event} (${line.detail})`);
  }
  if (!result.changed) {
    out(`  ${label}: ${result.left} command(s) left as they are in ${config}; nothing written.`);
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
    `  ${label}: rewrote ${result.rewrote}, left ${result.left}, dropped ${result.dropped} duplicate(s) in ${config}`,
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

/** The worktree git guard (row C2): `guard render|rewrite|antigravity-rewrite`. */
function guard(
  action: string,
  cliArg: string | undefined,
  options: Map<string, string>,
  repo: string,
  platform: NodeJS.Platform,
): number {
  const hook = lookupHook(WORKTREE_GIT_GUARD.id);
  if (hook === null) throw new Error("the worktree git guard is not registered.");
  if (action === "antigravity-rewrite") {
    const hooks = options.get("hooks");
    if (!hooks) {
      err("usage: hook-wiring.ts guard antigravity-rewrite --hooks <path>");
      return 2;
    }
    return rewriteAntigravityGuardFile(hooks, { platform }, out, err);
  }
  const cli = GUARD_CLIS.find((c) => c === cliArg);
  const config = options.get("config");
  if (action === "render" && cli !== undefined) {
    const manifest = options.get("manifest") ?? path.join(repo, "hooks", hook.manifestFile(cli));
    return guardRenderFile({ repo, cli, manifest, platform }, out, err);
  }
  if (action === "rewrite" && cli !== undefined && cli !== "antigravity" && config) {
    return rewrite(repo, hook, cli, config, platform);
  }
  err(
    `usage: hook-wiring.ts guard render <${GUARD_CLIS.join("|")}> --manifest <path>\n` +
      `       hook-wiring.ts guard rewrite <${CLIS.join("|")}> --config <path>\n` +
      "       hook-wiring.ts guard antigravity-rewrite --hooks <path>",
  );
  return 2;
}

function main(argv: readonly string[]): number {
  const { positional, options } = parseArgs(argv);
  const [command, subject] = positional;
  const repo = options.get("repo") ?? repoRootFrom(import.meta.url);
  const platform = (options.get("platform") ?? process.platform) as NodeJS.Platform;
  const hook = lookupHook(options.get("hook") ?? DEFAULT_HOOK);
  if (hook === null) {
    err(`unknown hook '${options.get("hook") ?? ""}' (known: ${hookIds().join(", ")})`);
    return 2;
  }
  try {
    if (command === "statusline") return statusline(subject ?? "", options, repo, platform);
    if (command === "guard") return guard(subject ?? "", positional[2], options, repo, platform);
    if (command === "transcript")
      return transcriptCommand(positional.slice(1), options, { repo, platform, out, err });
    if (hook.descriptor.id === WORKTREE_GIT_GUARD.id && command !== undefined) {
      return guard(command, subject, options, repo, platform);
    }
    const cli = asCli(subject);
    if (cli === null) {
      err(`usage: hook-wiring.ts render|rewrite <${CLIS.join("|")}> [--config <path>]`);
      return 2;
    }
    if (command === "render") return render(repo, hook, cli, platform);
    const config = options.get("config");
    if (command === "rewrite" && config) return rewrite(repo, hook, cli, config, platform);
    err("usage: hook-wiring.ts rewrite <cli> --config <path>");
    return 2;
  } catch (error) {
    err(`  ERROR: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
}

process.exitCode = main(process.argv.slice(2));
