// usage-capture-cli.ts — the command line of scripts/usage-capture-optin.ts (spec 0256 requirement 33,
// as modified by delta-01; plan v2 step B3b.4): one subcommand per public function of
// scripts/lib/usage-capture-optin.sh, with the shell function's positional arguments in the same order and
// its standard output, standard error and status. `<subcommand> [--result <file>] [--] <argument>...`:
// the only flag is `--result`, valid right after the subcommand; the file receives `KEY=0|1` lines from
// the closed whitelist SR_TRANSCRIPT_WIRED (render) and SR_ALL_HOOKS_DISABLED (merge). Every subcommand
// loads its modules through `import()`, so the cheap readers pay for no module graph they do not use.
// A missing argument reads as empty, as in the shell without `set -u`. Layer 3.

import fs from "node:fs";

import type { JsonObject } from "../hook-config.ts";
import type { Cli } from "./context.ts";
import type { UcCtx, UcDeps } from "./usage-capture-fragment.ts";
import type { CaptureCli } from "./usage-capture-state.ts";

type Bit = "0" | "1";
type Results = Map<string, Bit>;
type Run = (
  ctx: UcCtx,
  a: readonly string[],
  res: Results,
  deps: UcDeps,
) => Promise<number> | number;

/** The names a `--result` file may carry; anything else is never written. */
const WHITELIST: ReadonlySet<string> = new Set(["SR_TRANSCRIPT_WIRED", "SR_ALL_HOOKS_DISABLED"]);

const arg = (a: readonly string[], i: number): string => a[i] ?? "";
const bit = (b: boolean): Bit => (b ? "1" : "0");
const unknownCli = async (ctx: UcCtx, cli: string): Promise<boolean> => {
  const s = await import("./usage-capture-state.ts");
  if (s.captureShape(cli) !== undefined) return false;
  ctx.io.err(s.unknownCliMessage(cli));
  return true;
};

/** jq prints the DEL character as an escape; `JSON.stringify` does not. */
const compact = (value: unknown): string => JSON.stringify(value).replaceAll("\x7f", "\\u007f");

/** `_uc_read`'s reader: the parsed configuration (`null` absent), or `undefined` after the shell's ERROR with status 2. */
async function readConfig(ctx: UcCtx, config: string): Promise<JsonObject | null | undefined> {
  const s = await import("./usage-capture-state.ts");
  try {
    return s.readCaptureConfig(config);
  } catch (error) {
    if (!(error instanceof s.NotAnObjectConfigError)) throw error;
    ctx.io.err(s.notAnObjectMessage(config));
    return undefined;
  }
}

/** The three readers share one frame: the CLI check (status 1), the read (status 2), then `show`. */
const reader =
  (
    show: (
      s: typeof import("./usage-capture-state.ts"),
      cli: CaptureCli,
      doc: JsonObject | null,
    ) => string[],
  ): Run =>
  async (ctx, a) => {
    const cli = arg(a, 0);
    if (await unknownCli(ctx, cli)) return 1;
    const doc = await readConfig(ctx, arg(a, 1));
    if (doc === undefined) return 2;
    for (const line of show(await import("./usage-capture-state.ts"), cli as CaptureCli, doc))
      ctx.io.out(line);
    return 0;
  };

/** The options every writer shares, with the checkout the argument names. */
const opts = (ctx: UcCtx, a: readonly string[]) => ({
  ctx,
  cli: arg(a, 0),
  settingsPath: arg(a, 1),
});

/** The keep step the apply is given: the same checkout and machine seams as the apply. */
const keepOf =
  (keep: typeof import("./usage-capture-keep.ts").usageCaptureKeep, deps: UcDeps) =>
  (o: { ctx: UcCtx; cli: string; settingsPath: string; repoDir?: string }): number =>
    keep({
      ctx: o.ctx,
      cli: o.cli as Cli,
      settingsPath: o.settingsPath,
      repoDir: o.repoDir ?? o.ctx.repoDir,
      deps,
    });

const COMMANDS: Readonly<Record<string, Run>> = {
  abs: async (ctx, a) => {
    const { usageCaptureAbs } = await import("./usage-capture-fragment.ts");
    const ext = arg(a, 1) === "" ? "ts" : arg(a, 1);
    if (ext !== "ts" && ext !== "sh") {
      ctx.io.err(`  ERROR: capture script not found at ${arg(a, 0)}/hooks/usage-capture.${ext}.`);
      return 1;
    }
    const abs = usageCaptureAbs(ctx, arg(a, 0), ext);
    if (abs !== null) ctx.io.out(abs);
    return abs === null ? 1 : 0;
  },
  fragment: async (ctx, a, _res, deps) => {
    const { usageCaptureFragment } = await import("./usage-capture-fragment.ts");
    const fragment = usageCaptureFragment(ctx, arg(a, 0), arg(a, 1), deps);
    if (fragment !== null) ctx.io.out(compact(fragment));
    return fragment === null ? 1 : 0;
  },
  rewrite: async (ctx, a, _res, deps) => {
    const { usageCaptureRewrite } = await import("./usage-capture.ts");
    return usageCaptureRewrite({ ...opts(ctx, a), repoDir: arg(a, 2), deps });
  },
  footprint: reader((s, cli, doc) => [compact(s.captureFootprint(cli, doc))]),
  paths: reader((s, cli, doc) => s.capturePaths(cli, doc)),
  state: reader((s, cli, doc) => [s.captureState(cli, doc)]),
  reinject: async (ctx, a) => {
    const { usageCaptureReinject } = await import("./usage-capture-write.ts");
    let footprint: unknown = null;
    try {
      footprint = JSON.parse(arg(a, 2));
    } catch {
      footprint = null;
    }
    return usageCaptureReinject({ ...opts(ctx, a), footprint });
  },
  disclose: async (ctx, a, _res, deps) => {
    const { usageCaptureDisclose } = await import("./usage-capture.ts");
    return usageCaptureDisclose({ ...opts(ctx, a), repoDir: arg(a, 2), deps });
  },
  enable: async (ctx, a, _res, deps) => {
    const { usageCaptureEnable } = await import("./usage-capture-write.ts");
    return usageCaptureEnable({ ...opts(ctx, a), repoDir: arg(a, 2), deps });
  },
  keep: async (ctx, a, _res, deps) => {
    const { usageCaptureKeep } = await import("./usage-capture-keep.ts");
    return usageCaptureKeep({
      ctx,
      cli: arg(a, 0) as Cli,
      settingsPath: arg(a, 1),
      repoDir: arg(a, 2),
      deps,
    });
  },
  remove: async (ctx, a) => {
    const { usageCaptureRemove } = await import("./usage-capture-write.ts");
    return usageCaptureRemove(opts(ctx, a));
  },
  apply: async (ctx, a, _res, deps) => {
    const { usageCaptureApply } = await import("./usage-capture.ts");
    const { usageCaptureKeep } = await import("./usage-capture-keep.ts");
    return usageCaptureApply({
      ...opts(ctx, a),
      repoDir: arg(a, 2),
      state: arg(a, 3),
      answer: arg(a, 4),
      deps,
      keep: keepOf(usageCaptureKeep, deps),
    });
  },
  "render-session-recording-manifest": async (ctx, a, res, deps) => {
    const [cli, repo, src, out] = [arg(a, 0), arg(a, 1), arg(a, 2), arg(a, 3)];
    res.set("SR_TRANSCRIPT_WIRED", "0");
    if (await unknownCli(ctx, cli)) return 1;
    const { renderSessionRecordingManifest } = await import("./session-recording.ts");
    const { serialiseJson } = await import("../hook-config.ts");
    const refused =
      "  Worktree git guard and session recording not wired this run; installed commands are left as they are.";
    let fellBack = false;
    const io = {
      ...ctx.io,
      err: (line: string) => {
        fellBack ||= line === refused;
        ctx.io.err(line);
      },
    };
    const done = renderSessionRecordingManifest({
      ctx: { ...ctx, io },
      cli: cli as "claude",
      manifestSrc: src,
      repoDir: repo,
      ...(deps.spawn === undefined ? {} : { spawn: deps.spawn }),
    });
    // The success path writes the tool's one line of compact JSON, the fallback jq's indented text.
    const text =
      done === null ? "" : fellBack ? serialiseJson(done.manifest) : `${compact(done.manifest)}\n`;
    fs.writeFileSync(out, text);
    if (done === null) return 1;
    res.set("SR_TRANSCRIPT_WIRED", bit(done.transcriptWired));
    return 0;
  },
  "merge-session-recording-hooks": async (ctx, a, res) => {
    const [cli, config, patchedFile, envText] = [arg(a, 0), arg(a, 1), arg(a, 2), arg(a, 3)];
    res.set("SR_ALL_HOOKS_DISABLED", "0");
    if (await unknownCli(ctx, cli)) return 1;
    const { mergeSessionRecordingHooks } = await import("./session-recording.ts");
    const parse = (text: string): unknown => {
      try {
        return JSON.parse(text);
      } catch {
        return null;
      }
    };
    let patched: unknown = null;
    try {
      patched = JSON.parse(fs.readFileSync(patchedFile, "utf8"));
    } catch {
      patched = null;
    }
    // An unparsable patch must be refused, not defaulted: an array is never an object.
    const parsed = envText === "" ? {} : (parse(envText) ?? []);
    const result = mergeSessionRecordingHooks({
      ctx,
      cli: cli as "claude",
      config,
      patched,
      envPatch: parsed as Record<string, unknown>,
      patchedLabel: patchedFile,
    });
    res.set("SR_ALL_HOOKS_DISABLED", bit(result.allHooksDisabled));
    return result.ok ? 0 : 1;
  },
};

/** The platforms `--platform` accepts: the seam for the Windows decisions the suites simulate on POSIX. */
const PLATFORMS: readonly NodeJS.Platform[] = ["win32", "linux", "darwin"];

export const USAGE =
  `Usage: usage-capture-optin.ts <subcommand> [--result <file>] [--] <argument>...\n` +
  `  subcommands: ${Object.keys(COMMANDS).join(", ")}\n` +
  `  leading option: --platform <win32|linux|darwin>`;

/** Run one command line (`argv` without the node and script names): the status the entry exits with. */
export async function usageCaptureCli(args0: readonly string[], base: UcCtx): Promise<number> {
  let argv = args0;
  let ctx = base;
  let deps: UcDeps = {};
  if (argv[0] === "--platform") {
    const platform = PLATFORMS.find((p) => p === argv[1]);
    if (platform === undefined) return (ctx.io.err(USAGE), 2);
    ctx = { ...ctx, platform };
    // The override decides the platform-dependent forms only: the processes still start the way
    // the host starts them (a `win32` override on a POSIX host must still find `node`).
    const { createSpawner } = await import("./spawner.ts");
    deps = { spawn: createSpawner(base) };
    argv = argv.slice(2);
  }
  const [name, ...rest] = argv;
  const run = name === undefined || !Object.hasOwn(COMMANDS, name) ? undefined : COMMANDS[name];
  if (run === undefined) {
    ctx.io.err(USAGE);
    return 2;
  }
  let args = rest;
  let resultFile: string | null = null;
  if (args[0] === "--result") {
    if (args.length < 2) return (ctx.io.err(USAGE), 2);
    resultFile = args[1] ?? null;
    args = args.slice(2);
  }
  if (args[0] === "--") args = args.slice(1);
  else if (args[0]?.startsWith("--")) return (ctx.io.err(`Error: unknown option ${args[0]}`), 2);
  const results: Results = new Map();
  const status = await run(ctx, args, results, deps);
  if (resultFile !== null && results.size > 0) {
    const lines = [...results].filter(([key]) => WHITELIST.has(key)).map(([k, v]) => `${k}=${v}\n`);
    fs.writeFileSync(resultFile, lines.join(""));
  }
  return status;
}
