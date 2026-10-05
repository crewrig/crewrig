// worktree-fixtures.ts — shared fixtures for the black-box suites of the
// worktree git guard and the worktree-claim tool (spec 0248, plan step 19).
//
// A fixture is a self-contained repository under the OS temp directory with a
// seed commit, a `.gitignore` holding `.worktrees/`, a tracked `sub/`
// directory and a linked worktree at `<main>/.worktrees/<ticket>` (the layout
// of the Bash oracle, scripts/tests/test-worktree-claim.sh). Nothing here
// reads or writes the repository the suite ships in. Every path is physical
// (symlinks resolved): on macOS `os.tmpdir()` sits under a symlink, and the
// tool prints physical paths (spec 0248 R16, R23).
//
// The entries run the way a CLI runs them: `node <entry> <args>`, no Node.js
// flag, the payload on standard input, the streams captured.
//
// Standard library only.

import { spawnSync, type SpawnSyncOptions } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
export const GUARD_TS = path.join(REPO, "hooks", "worktree-git-guard.ts");
export const GUARD_SH = path.join(REPO, "hooks", "worktree-git-guard.sh");
export const CLAIM_TS = path.join(REPO, "scripts", "worktree-claim.ts");
export const CLAIM_SH = path.join(REPO, "scripts", "worktree-claim.sh");
export const FLOOR_GUARD = path.join(REPO, "scripts", "lib", "node-floor-guard.js");
export const WINDOWS = process.platform === "win32";
/** The reason string of a leg that needs a POSIX host; node:test prints it as a SKIP line. */
export const SKIP_POSIX = WINDOWS ? "SKIP: POSIX-only leg (needs a POSIX shell or signals)" : false;
/** The reason string of a leg that needs Windows. */
export const SKIP_WINDOWS = WINDOWS ? false : "SKIP: Windows-only leg (runs on windows-latest)";

export interface Result {
  readonly status: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly stdout: string;
  readonly stderr: string;
}

/** The parent's environment minus everything that would change how an entry runs. */
export function cleanEnv(extra: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const key of [
    "NODE_OPTIONS",
    "NODE_TEST_CONTEXT",
    "CREWRIG_REPO_DIR",
    "GIT_DIR",
    "GIT_WORK_TREE",
    "GIT_INDEX_FILE",
    "GIT_COMMON_DIR",
    "GIT_CEILING_DIRECTORIES",
  ]) {
    delete env[key];
  }
  for (const [key, value] of Object.entries(extra)) {
    if (value === undefined) delete env[key];
    else env[key] = value;
  }
  return env;
}

export interface RunOptions {
  readonly cwd?: string;
  readonly env?: NodeJS.ProcessEnv;
  /** Standard input; `null` closes it (`ignore`). Default: an empty pipe. */
  readonly input?: string | null;
  /** Node.js flags placed before the entry (a spy preload, never for entry-form tests). */
  readonly nodeArgs?: readonly string[];
  readonly timeoutMs?: number;
}

function toResult(res: ReturnType<typeof spawnSync>): Result {
  return {
    status: res.status,
    signal: res.signal,
    stdout: String(res.stdout ?? ""),
    stderr: String(res.stderr ?? ""),
  };
}

/** Run `node <entry> <args>` the way a hook or a user does. */
export function runNode(entry: string, args: readonly string[], options: RunOptions = {}): Result {
  const extra: SpawnSyncOptions = {};
  if (options.input === null) extra.stdio = ["ignore", "pipe", "pipe"];
  return toResult(
    spawnSync(process.execPath, [...(options.nodeArgs ?? []), entry, ...args], {
      encoding: "utf8",
      cwd: options.cwd,
      env: options.env ?? cleanEnv(),
      input: options.input === null ? undefined : (options.input ?? ""),
      timeout: options.timeoutMs ?? 60_000,
      ...extra,
    }),
  );
}

/** Run the claim tool: `node scripts/worktree-claim.ts <args>`. */
export function runClaim(args: readonly string[], options: RunOptions = {}): Result {
  return runNode(CLAIM_TS, args, options);
}

/** Run the guard entry with a payload on standard input. */
export function runGuard(
  payload: string | null,
  options: RunOptions & { readonly args?: readonly string[]; readonly entry?: string } = {},
): Result {
  return runNode(options.entry ?? GUARD_TS, options.args ?? [], {
    ...options,
    input: payload,
  });
}

// ---------------------------------------------------------------------------
// The fixture repository
// ---------------------------------------------------------------------------

export interface Fixture {
  readonly root: string;
  /** The main checkout. */
  readonly main: string;
  /** The linked worktree `<main>/.worktrees/<ticket>`. */
  readonly wt: string;
  /** A tracked subdirectory of the worktree. */
  readonly sub: string;
  readonly ticket: string;
  /** The git common directory (`<main>/.git`), physical. */
  readonly common: string;
  readonly claimRoot: string;
  readonly claimDir: string;
  readonly ledger: string;
  /** A symlink to `<root>/real`, or `null` where symlinks are not permitted. */
  readonly link: string | null;
  git(args: readonly string[], cwd?: string): string;
  cleanup(): void;
}

const temps: string[] = [];

/** Remove every fixture still on disk; call from an `after` hook. */
export function cleanupAll(): void {
  for (const dir of temps.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
}

export function realTmp(prefix: string): string {
  const dir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  temps.push(dir);
  return dir;
}

function git(args: readonly string[], cwd: string): string {
  const res = spawnSync("git", [...args], { cwd, encoding: "utf8", env: cleanEnv() });
  if (res.status !== 0) throw new Error(`git ${args.join(" ")} failed in ${cwd}: ${res.stderr}`);
  return res.stdout;
}

/** A fixture repository with a linked worktree under `.worktrees/<ticket>`. */
export function makeFixture(options: { ticket?: string } = {}): Fixture {
  const ticket = options.ticket ?? "736";
  const root = realTmp("crewrig-worktree-");
  const real = path.join(root, "real");
  const main = path.join(real, "repo");
  fs.mkdirSync(main, { recursive: true });
  git(["init", "-q"], main);
  git(["config", "user.email", "test@example.com"], main);
  git(["config", "user.name", "Test"], main);
  git(["config", "commit.gpgsign", "false"], main);
  git(["symbolic-ref", "HEAD", "refs/heads/main"], main);
  fs.writeFileSync(path.join(main, ".gitignore"), ".worktrees/\n");
  fs.writeFileSync(path.join(main, "tracked.txt"), "seed\n");
  fs.mkdirSync(path.join(main, "sub"));
  fs.writeFileSync(path.join(main, "sub", "x.txt"), "x\n");
  git(["add", "-A"], main);
  git(["commit", "-q", "-m", "fixture seed"], main);
  git(["worktree", "add", "-q", "-b", `wt-${ticket}`, path.join(main, ".worktrees", ticket)], main);

  let link: string | null = null;
  try {
    link = path.join(root, "link");
    fs.symlinkSync(real, link, "dir");
  } catch {
    link = null;
  }

  const wt = path.join(main, ".worktrees", ticket);
  const common = fs.realpathSync.native(path.join(main, ".git"));
  const claimRoot = path.join(common, "crewrig", "worktree-claims");
  return {
    root,
    main,
    wt,
    sub: path.join(wt, "sub"),
    ticket,
    common,
    claimRoot,
    claimDir: path.join(claimRoot, ticket),
    ledger: path.join(claimRoot, `${ticket}.log`),
    link,
    git: (args, cwd) => git(args, cwd ?? main),
    cleanup: () => fs.rmSync(root, { recursive: true, force: true }),
  };
}

/** A claim written the way the tool writes it: four one-line files in `<claimRoot>/<ticket>/`. */
export function writeClaim(
  fx: Pick<Fixture, "claimRoot" | "claimDir" | "ticket">,
  fields: { holder: string; since?: string; sinceEpoch?: string; operation?: string },
): void {
  fs.mkdirSync(fx.claimDir, { recursive: true });
  fs.writeFileSync(path.join(fx.claimDir, "holder"), `${fields.holder}\n`);
  fs.writeFileSync(path.join(fx.claimDir, "since"), `${fields.since ?? "2020-01-01T00:00:00Z"}\n`);
  fs.writeFileSync(
    path.join(fx.claimDir, "since_epoch"),
    `${fields.sinceEpoch ?? String(Math.floor(Date.now() / 1000))}\n`,
  );
  fs.writeFileSync(path.join(fx.claimDir, "operation"), `${fields.operation ?? ""}\n`);
}

export const read = (file: string): string => fs.readFileSync(file, "utf8");
export const nowEpoch = (): number => Math.floor(Date.now() / 1000);

// ---------------------------------------------------------------------------
// A throwaway PATH (POSIX): symlinks and wrapper scripts
// ---------------------------------------------------------------------------

/**
 * A directory to use as the whole `PATH`: `links` maps a command name to the
 * file it should resolve to (symlinked), `scripts` maps a name to the text of
 * a `#!/bin/sh` wrapper. A command in neither does not exist for the child.
 */
export function makePathDir(spec: {
  links?: Record<string, string>;
  scripts?: Record<string, string>;
}): string {
  const dir = realTmp("crewrig-path-");
  for (const [name, target] of Object.entries(spec.links ?? {})) {
    fs.symlinkSync(target, path.join(dir, name));
  }
  for (const [name, text] of Object.entries(spec.scripts ?? {})) {
    const file = path.join(dir, name);
    fs.writeFileSync(file, `#!/bin/sh\n${text}\n`);
    fs.chmodSync(file, 0o755);
  }
  return dir;
}

/** The absolute path of a command on the current PATH, or `null`. */
export function which(name: string): string | null {
  const dirs = (process.env["PATH"] ?? "").split(path.delimiter);
  for (const dir of dirs) {
    const file = path.join(dir, name);
    try {
      fs.accessSync(file, fs.constants.X_OK);
      if (fs.statSync(file).isFile()) return fs.realpathSync.native(file);
    } catch {
      // not here
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Placeholders (golden data, spec 0248 R18 and plan step 20)
// ---------------------------------------------------------------------------

export interface PlaceholderContext {
  readonly main: string;
  readonly wt: string;
  readonly common: string;
  /** Extra directories to name, e.g. a working directory outside every repository. */
  readonly extra?: Record<string, string>;
}

const ISO = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z/g;

/**
 * Replace what varies between runs: the physical fixture paths, every ISO
 * timestamp and the `held-for-seconds` count. Longest path first, so the
 * worktree is named before the main checkout it sits in.
 */
export function placeholder(text: string, ctx: PlaceholderContext): string {
  const named: Array<[string, string]> = [
    [ctx.wt, "<WORKTREE>"],
    [ctx.common, "<COMMON>"],
    [ctx.main, "<MAIN>"],
    ...Object.entries(ctx.extra ?? {}).map(([name, dir]): [string, string] => [dir, `<${name}>`]),
  ];
  named.sort((a, b) => b[0].length - a[0].length);
  let out = text;
  for (const [dir, token] of named) out = out.split(dir).join(token);
  return out
    .replace(ISO, "<ISO>")
    .replace(/held-for-seconds: \d+/g, "held-for-seconds: <N>")
    .replace(/worktree-claim\.(?:sh|ts)/g, "<TOOL>")
    .replace(/(?:bash scripts\/<TOOL>|node scripts\/<TOOL>)/g, "<INVOKE>");
}

/** A `since_epoch` value within two hours of now is a clock reading, not data. */
function epochPlaceholder(content: string): string {
  const match = /^(\d{10})\n$/.exec(content);
  if (match === null) return content;
  return Math.abs(Number(match[1]) - nowEpoch()) < 7200 ? "<EPOCH>\n" : content;
}

/** Every file under the claim root (claim directories and ledgers), placeholdered, by relative path. */
export function snapshotClaimRoot(claimRoot: string, ctx: PlaceholderContext): Record<string, string> {
  const files: Record<string, string> = {};
  const walk = (dir: string): void => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        // An empty directory is itself state: `[ -d ]` reads it as claimed.
        if (fs.readdirSync(full).length === 0) {
          files[`${path.relative(claimRoot, full).split(path.sep).join("/")}/`] = "";
        }
      } else {
        const rel = path.relative(claimRoot, full).split(path.sep).join("/");
        files[rel] = placeholder(epochPlaceholder(read(full)), ctx);
      }
    }
  };
  walk(claimRoot);
  return Object.fromEntries(Object.entries(files).sort(([a], [b]) => a.localeCompare(b)));
}
