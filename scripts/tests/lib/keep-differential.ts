// keep-differential.ts — the harness of setup-usage-capture-keep.test.ts: one configuration run through
// `usage_capture_keep` (scripts/lib/usage-capture-optin.sh, sourced by bash-libs.ts) and through
// usageCaptureKeep on two copies, and the outcomes (status, both streams, file bytes, mode, backups).

import fs from "node:fs";
import path from "node:path";

import type { Env } from "../../lib/extension/types.ts";
import { createSpawner } from "../../lib/setup/spawner.ts";
import { usageCaptureKeep } from "../../lib/setup/usage-capture-keep.ts";
import { bashLibs } from "./bash-libs.ts";
import { read, realTmp, REPO } from "./worktree-fixtures.ts";

export type Cli = "claude" | "gemini" | "copilot";
export const CLIS: readonly Cli[] = ["claude", "gemini", "copilot"];
export const ID = { claude: "claude-code", gemini: "gemini-cli", copilot: "copilot-cli" } as const;
export const EVENTS = {
  claude: ["Stop", "SessionEnd"],
  gemini: ["AfterModel"],
  copilot: ["agentStop", "sessionEnd"],
};

export interface Paths {
  readonly root: string;
  /** A checkout that exists: `.ts` and `.sh`, both live. */
  readonly live: string;
  /** A checkout whose `.sh` exists but whose `.ts` does not. */
  readonly shOnly: string;
  /** Absolute and missing. */
  readonly gone: string;
  readonly gone2: string;
  /** An existing `.sh` under a path with a space. */
  readonly spaced: string;
}

export const direct = (c: Cli, ev: string, p: string, pre = "") =>
  `${pre}node "${p}/hooks/usage-capture.ts" ${ID[c]} ${ev}`;
export const viaSh = (c: Cli, ev: string, p: string, pre = "") =>
  `${pre}bash "${p}/hooks/usage-capture.sh" ${ID[c]} ${ev}`;
export const handler = (command: string) => ({ type: "command", command });
export const OPERATOR = { type: "command", command: "echo é 😀 <&>", timeout: 1.5 };

/** One configuration: `per[event]` lists the handlers, in the shape of the CLI. */
export function config(
  c: Cli,
  per: Record<string, unknown[]>,
  extra: Record<string, unknown> = {},
) {
  const hooks = Object.fromEntries(
    Object.entries(per).map(([ev, hs]) => [
      ev,
      c === "copilot" ? hs : [{ ...(c === "claude" ? { matcher: "" } : {}), hooks: hs }],
    ]),
  );
  return { ...(c === "copilot" ? { version: 1 } : {}), model: "m", ...extra, hooks };
}

export function touch(file: string): string {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, "");
  return file;
}

export function makePaths(): Paths {
  const root = realTmp("crewrig-keep-");
  const checkout = (name: string, exts: string[]) => {
    for (const e of exts) touch(path.join(root, name, "hooks", `usage-capture.${e}`));
    return path.join(root, name);
  };
  const repo = checkout("repo", ["ts", "sh"]);
  for (const c of CLIS)
    fs.copyFileSync(
      path.join(REPO, "hooks", `${c}-usage-capture-hooks.json`),
      path.join(repo, "hooks", `${c}-usage-capture-hooks.json`),
    );
  return {
    root,
    live: checkout("live", ["ts", "sh"]),
    shOnly: checkout("shonly", ["sh"]),
    gone: path.join(root, "gone"),
    gone2: path.join(root, "gone2"),
    spaced: checkout("My Projects/crewrig", ["sh"]),
  };
}

export interface Outcome {
  status: number | null;
  out: string;
  err: string;
  file: string | null;
  mode: number | null;
  backups: string[];
}

export function observe(
  dir: string,
  root: string,
  status: number | null,
  out: string,
  err: string,
): Outcome {
  const file = path.join(dir, "settings.json");
  const exists = fs.existsSync(file);
  const norm = (s: string) =>
    s
      .replaceAll(`${dir}/`, "<D>/")
      .replaceAll(root, "<R>")
      .replace(/\.bak\.\d{8}-\d{6}(\.\d\d)?/g, ".bak.<T>");
  const backups = fs
    .readdirSync(dir)
    .filter((n) => n.includes(".bak."))
    .map((n) => fs.readFileSync(path.join(dir, n), "utf8"));
  return {
    status,
    out: norm(out),
    err: norm(err),
    file: exists ? read(file) : null,
    mode: exists ? fs.statSync(file).mode & 0o777 : null,
    backups,
  };
}

export interface Case {
  cli: string;
  input: unknown;
  platform?: NodeJS.Platform;
}

export function compare(c: Case, p: Paths): { sh: Outcome; ts: Outcome } {
  const repo = path.join(p.root, "repo");
  const dirs = { sh: path.join(p.root, "sh"), ts: path.join(p.root, "ts") };
  for (const d of Object.values(dirs)) {
    fs.mkdirSync(d, { recursive: true });
    if (c.input !== null)
      fs.writeFileSync(
        path.join(d, "settings.json"),
        typeof c.input === "string" ? c.input : `${JSON.stringify(c.input, null, 2)}\n`,
        { mode: 0o644 },
      );
  }
  const quote = (s: string) => `'${s.replaceAll("'", "'\\''")}'`;
  const uname = c.platform === "win32" ? "uname() { echo MINGW64_NT-10.0; }\n" : "";
  const res = bashLibs(
    `${uname}rc=0\nusage_capture_keep ${c.cli} ${quote(path.join(dirs.sh, "settings.json"))} ${quote(repo)} || rc=$?\nexit $rc`,
  );
  const out: string[] = [];
  const err: string[] = [];
  const io = {
    out: (l: string) => void out.push(l),
    err: (l: string) => void err.push(l),
    errRaw: (t: string) => void err.push(t.replace(/\n$/, "")),
  };
  const env: Env = process.env;
  const ctx = { io, env, platform: c.platform ?? process.platform, home: p.root, repoDir: repo };
  // A POSIX host runs the Windows leg: the child processes still start the POSIX way.
  const spawn = createSpawner({ env, platform: process.platform, repoDir: repo });
  const status = usageCaptureKeep({
    ctx,
    deps: { spawn },
    cli: c.cli as Cli,
    settingsPath: path.join(dirs.ts, "settings.json"),
    repoDir: repo,
  });
  const lines = (xs: string[]) => xs.map((l) => `${l}\n`).join("");
  return {
    sh: observe(dirs.sh, p.root, res.status, res.stdout, res.stderr),
    ts: observe(dirs.ts, p.root, status, lines(out), lines(err)),
  };
}
