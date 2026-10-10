// setup-steps-hooks-fixtures.ts — the rig shared by setup-steps-hooks.test.ts and
// setup-steps-usage.test.ts (not a test file itself): a temporary home and repository checkout
// (a copy of the real `hooks/`), a fake Spawner, the flow runner with `--answer` pre-answers, and
// the readers of the golden cells the three hook-file CLIs share with the unchanged shell.

import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach } from "node:test";

import type { Spawner } from "../lib/setup/context.ts";
import type { SetupDescriptor, StepFn, StepId, StepRegistry } from "../lib/setup/descriptor.ts";
import { runSetup } from "../lib/setup/flow.ts";
import { descriptor } from "./setup-flow-fixtures.ts";
import { normalize, type Roots } from "./lib/setup-golden-tree.ts";

export type HookCli = "claude" | "gemini" | "copilot";
export const HOOK_CLIS: readonly HookCli[] = ["claude", "gemini", "copilot"];

const REAL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const GOLDEN = path.join(REAL, "scripts", "tests", "fixtures", "setup-golden");

export const PYTHON = "/.local/share/pipx/venvs/mempalace/bin/python";

export interface Rig extends Roots {
  readonly root: string;
}

/** The temporary root of the running test (`useRig` creates and removes it; paths are physical). */
export const rig: { root: string; home: string; repo: string } = { root: "", home: "", repo: "" };

export function useRig(): void {
  beforeEach(() => {
    rig.root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "setup-steps-hooks-")));
    rig.home = path.join(rig.root, "home");
    rig.repo = path.join(rig.root, "repo");
    fs.mkdirSync(rig.home);
    fs.cpSync(path.join(REAL, "hooks"), path.join(rig.repo, "hooks"), { recursive: true });
  });
  afterEach(() => fs.rmSync(rig.root, { recursive: true, force: true }));
}

const FILES: Record<HookCli, { file: string; copy: string }> = {
  claude: { file: ".claude/settings.json", copy: ".claude/hooks/mempalace-transcript.sh" },
  gemini: { file: ".gemini/settings.json", copy: ".gemini/hooks/mempalace-transcript.sh" },
  copilot: {
    file: ".copilot/hooks/copilot-transcript-hooks.json",
    copy: ".copilot/hooks/mempalace-transcript.sh",
  },
};

/** The hooks file of `cli`, relative to the home (the shell's SETTINGS_TARGET / USER_HOOKS_JSON). */
export const unusedCopyOf = (cli: HookCli): string => FILES[cli].copy;

export const hooksFileOf = (cli: HookCli): string => FILES[cli].file;

export function hookDescriptor(cli: HookCli, steps: readonly StepId[]): SetupDescriptor {
  const base = descriptor(steps, cli);
  return {
    ...base,
    hooks: {
      channel: cli === "copilot" ? "user-json" : "settings",
      file: FILES[cli].file,
      src: `hooks/${cli}-transcript-hooks.json`,
      envPatch: cli === "claude",
      unusedCopy: FILES[cli].copy,
      leadingBlank: cli !== "copilot",
    },
    strategies: {
      ...base.strategies,
      usageCapture: cli === "copilot" ? "user-hooks-json" : "settings",
    },
  };
}

/** A spawner for which every child succeeds and `git` names the main checkout (`.git`). */
export const okSpawn: Spawner = (argv) => ({
  status: 0,
  stdout: argv.includes("rev-parse") ? ".git\n" : "",
  stderr: "",
});

export interface Result {
  readonly status: number;
  readonly out: string;
  readonly err: string;
}

export interface RunOptions {
  readonly steps: readonly StepId[];
  /** `--answer id=value` pre-answers. */
  readonly answers?: Readonly<Record<string, string>>;
  /** A terminal on standard input at its end: an unanswered question is CANCELLED (not an error). */
  readonly tty?: boolean;
  readonly spawn?: Spawner;
  /** Extra or replaced steps (probes, a failing neighbour). */
  readonly extra?: StepRegistry;
  readonly descriptor?: SetupDescriptor;
  /** `state.pythonBin` as the MCP step leaves it; none for a run without MemPalace. */
  readonly python?: boolean;
}

/** Run `steps` of `cli` through the flow, an `mcp` seed step first when the list names it. */
export async function runHooks(cli: HookCli, options: RunOptions): Promise<Result> {
  const stdin = new PassThrough();
  if (options.tty === true) Object.assign(stdin, { isTTY: true });
  stdin.end();
  const out: string[] = [];
  const err: string[] = [];
  const seed: StepFn = async ({ state, descriptor: d, ctx }) => {
    state.settingsTarget = path.join(ctx.home, d.hooks.file);
    if (options.python === true) state.pythonBin = path.join(ctx.home, PYTHON);
  };
  const argv = Object.entries(options.answers ?? {}).flatMap(([id, v]) => [
    "--answer",
    `${id}=${v}`,
  ]);
  const status = await runSetup(options.descriptor ?? hookDescriptor(cli, options.steps), {
    argv,
    stdin,
    stdout: { write: (t) => out.push(t) },
    stderr: { write: (t) => err.push(t) },
    env: { HOME: rig.home },
    platform: process.platform,
    home: rig.home,
    repoDir: rig.repo,
    spawn: options.spawn ?? okSpawn,
    steps: { mcp: seed, ...options.extra },
  });
  return { status, out: scrub(out.join("")), err: scrub(err.join("")) };
}

const roots = (): Roots => ({ root: rig.root, repo: rig.repo, home: rig.home });

/** The golden placeholders (`<HOME>`, `<REPO>`, `.bak.<STAMP>`) and the prompter's own lines removed. */
export function scrub(text: string): string {
  return normalize(text, roots())
    .split("\n")
    .filter((line) => !/^\[answer\] |^  \d\) (no|yes|keep|remove)$|\?( \(opt-in\))?$/.test(line))
    .filter(
      (line) =>
        !/^(Enable automatic|Capture token usage|Usage capture is registered for)/.test(line),
    )
    .join("\n");
}

export const readGolden = (cli: HookCli, cell: string, file = "stdout.golden"): string =>
  fs.readFileSync(path.join(GOLDEN, cli, cell, file), "utf8");

/** Entries of the golden tree whose path starts with `placeholderPath` (`<HOME>/...`): their hashes. */
export function goldenShas(cli: HookCli, cell: string, placeholderPath: string): string[] {
  const doc: unknown = JSON.parse(readGolden(cli, cell, "tree.json.golden"));
  const tree = (doc as { tree: Array<{ path: string; sha256?: string }> }).tree;
  return tree
    .filter((entry) => entry.path === placeholderPath)
    .flatMap((entry) => (entry.sha256 === undefined ? [] : [entry.sha256]));
}

const sha = (text: string): string => createHash("sha256").update(text).digest("hex");

/** The golden's hash of a file of the run: sha256 of its placeholdered, LF-normalised content. */
export const hashOf = (file: string): string =>
  sha(normalize(fs.readFileSync(file, "utf8"), roots()));

/** The hashes of the `.bak.<stamp>` copies of `file`, sorted. */
export function backupShas(file: string): string[] {
  const dir = path.dirname(file);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((name) => name.startsWith(`${path.basename(file)}.bak.`))
    .map((name) => hashOf(path.join(dir, name)))
    .sort();
}

export function put(rel: string, text: string): string {
  const file = path.join(rig.home, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text, { mode: 0o600 });
  return file;
}

/** The Claude Code settings file the shell has installed by the time the hook steps run. */
export const seedClaudeSettings = (): string =>
  put(
    ".claude/settings.json",
    fs.readFileSync(path.join(REAL, "config/claude/settings.json.template"), "utf8"),
  );
