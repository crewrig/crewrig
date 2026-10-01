// playwright-mcp.ts — `task setup:playwright-mcp` (spec 0245): register the
// opt-in Playwright MCP server on every supported assistant, routed through
// the spec 0084 trust wrapper of the checkout the task runs from.
//
// The entry (scripts/setup-playwright-mcp.ts) wires the real dependencies; all
// logic lives here behind `main(argv, deps)`, so the tests drive it in-process
// with a temporary HOME and a fake `run`.
//
// For each assistant, in a fixed order, the stored `playwright` entry is read
// the way that assistant reads it and classified (playwright-mcp-shape.ts).
// Only an absent, legacy or relocated entry leads to a write:
//   - Gemini CLI, Copilot CLI, Antigravity CLI: a direct file write through
//     hook-config.ts — timestamped 0600 backup first, then an atomic,
//     symlink-replacing, 0600 write that changes `mcpServers.playwright` only;
//   - Claude Code: its own CLI (`claude mcp remove` / `add`, user scope), with
//     the replaced registration printed in full first and an `add-json`
//     restore when `add` fails; ~/.claude.json is never written directly.
//
// Standard library only (spec 0240 R16).

export * from "./playwright-mcp-contract.ts";

import fs from "node:fs";
import path from "node:path";

import {
  LossyJsonError,
  NotAJsonObjectError,
  backupFile,
  readJsonConfig,
  writeJsonConfig,
  type JsonObject,
} from "./hook-config.ts";
import { resolveReal } from "./paths.ts";
import { processClaude } from "./playwright-mcp-claude.ts";
import {
  CLI_BINARY,
  CLI_LABEL,
  MSG,
  configPath,
  type Context,
  type Outcome,
  type Read,
  type SetupDeps,
} from "./playwright-mcp-contract.ts";
import {
  CLIS,
  SERVER_NAME,
  classify,
  wrappedEntry,
  wrapperPath,
  type Classification,
  type Cli,
} from "./playwright-mcp-shape.ts";

/** `true` when an executable named `name` is on `pathVar` (stat walk, no spawn). */
export function onPath(name: string, pathVar: string | undefined): boolean {
  if (pathVar === undefined || pathVar === "") return false;
  const exts =
    process.platform === "win32"
      ? ["", ...(process.env.PATHEXT ?? ".EXE;.CMD;.BAT").split(";").filter((e) => e !== "")]
      : [""];
  for (const dir of pathVar.split(path.delimiter)) {
    if (dir === "") continue;
    for (const ext of exts) {
      try {
        const candidate = path.join(dir, name + ext);
        if (!fs.statSync(candidate).isFile()) continue;
        fs.accessSync(candidate, fs.constants.X_OK);
        return true;
      } catch {
        // not here
      }
    }
  }
  return false;
}

function samePath(a: string, b: string): boolean {
  try {
    return resolveReal(a) === resolveReal(b);
  } catch {
    return false;
  }
}

function isPlainObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function describeReadError(error: unknown): string {
  if (error instanceof LossyJsonError) return error.reason;
  if (error instanceof NotAJsonObjectError) return "not a JSON object";
  return (error as Error).message;
}

function readEntry(cli: Cli, file: string): Read {
  let config;
  try {
    config = readJsonConfig(file, { jsonc: cli === "gemini", lossless: cli !== "claude" });
  } catch (error) {
    return { ok: false, reason: describeReadError(error) };
  }
  if (config === null) return { ok: false, reason: "the file vanished while it was being read" };
  const servers = config.doc.mcpServers;
  if (servers !== undefined && !isPlainObject(servers)) {
    return { ok: false, reason: "`mcpServers` is not an object" };
  }
  const entry = servers === undefined ? undefined : (servers as JsonObject)[SERVER_NAME];
  return { ok: true, doc: config.doc, comments: config.comments, entry };
}

/** Gemini, Copilot, Antigravity: one direct, backed-up, atomic file write. */
function processFile(ctx: Context, cli: Cli, file: string): Outcome {
  const { deps, wrapper } = ctx;
  const label = CLI_LABEL[cli];
  const read = readEntry(cli, file);
  if (!read.ok) {
    deps.err(MSG.unreadable(label, file, read.reason));
    return "failed";
  }
  const verdict = classify(cli, read.entry, wrapper, samePath);
  if (verdict.kind === "wrapped-current") {
    deps.out(MSG.upToDate(label));
    return "already up to date";
  }
  if (verdict.kind === "custom") {
    deps.err(MSG.untouched(label, file));
    return "left untouched";
  }

  const backup = backupFile(file, { now: deps.now(), warn: deps.err });
  if (backup.status !== "made") {
    deps.err(MSG.backupFailed(label, file));
    return "failed";
  }
  const servers = isPlainObject(read.doc.mcpServers) ? read.doc.mcpServers : {};
  const doc = {
    ...read.doc,
    mcpServers: { ...servers, [SERVER_NAME]: wrappedEntry(cli, wrapper) },
  };
  try {
    writeJsonConfig(file, doc);
  } catch (error) {
    deps.err(MSG.writeFailed(label, file, (error as Error).message));
    return "failed";
  }
  if (cli === "gemini" && read.comments) {
    for (const line of MSG.geminiComments(file, backup.path)) deps.err(line);
  }
  return reportWrite(ctx, cli, file, verdict, backup.path);
}

function reportWrite(
  ctx: Context,
  cli: Cli,
  file: string,
  verdict: Classification,
  backup: string,
): Outcome {
  const label = CLI_LABEL[cli];
  switch (verdict.kind) {
    case "legacy":
      ctx.deps.out(MSG.convergedFile(label, file, backup));
      return "converged";
    case "relocated":
      ctx.deps.out(MSG.relocatedFile(label, file, verdict.oldPath, ctx.wrapper, backup));
      return "relocated";
    default:
      ctx.deps.out(MSG.registeredFile(label, file, backup));
      return "registered";
  }
}

async function processCli(ctx: Context, cli: Cli): Promise<Outcome> {
  const label = CLI_LABEL[cli];
  if (!onPath(CLI_BINARY[cli], ctx.deps.env.PATH)) {
    ctx.deps.out(MSG.skippedBinary(label, CLI_BINARY[cli]));
    return "skipped";
  }
  const file = configPath(cli, ctx.home);
  if (!fs.existsSync(file)) {
    ctx.deps.out(MSG.skippedConfig(label, file));
    return "skipped";
  }
  return cli === "claude" ? processClaude(ctx, file) : processFile(ctx, cli, file);
}

/**
 * Run the task. Exit `0` when no assistant failed, `1` when one did (after
 * every assistant was processed, R14), `2` on a usage error.
 */
export async function main(argv: readonly string[], deps: SetupDeps): Promise<number> {
  if (argv.length > 0) {
    deps.err(MSG.usage);
    return 2;
  }
  const home = deps.env.HOME ?? deps.env.USERPROFILE;
  if (home === undefined || home === "") {
    deps.err("  WARNING: neither HOME nor USERPROFILE is set; no assistant can be located.");
    return 2;
  }
  const ctx: Context = { deps, home, wrapper: wrapperPath(deps.repoRoot), samePath, readEntry };
  deps.out(MSG.header);
  const outcomes: [Cli, Outcome][] = [];
  for (const cli of CLIS) outcomes.push([cli, await processCli(ctx, cli)]);
  deps.out(MSG.reportHeader);
  for (const [cli, outcome] of outcomes) deps.out(MSG.reportLine(CLI_LABEL[cli], outcome));
  return outcomes.some(([, outcome]) => outcome === "failed") ? 1 : 0;
}
