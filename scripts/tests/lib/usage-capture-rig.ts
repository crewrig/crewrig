// usage-capture-rig.ts — fixtures of setup-usage-capture.test.ts: a checkout copied from this repository,
// configurations of each CLI's shape, and the differential runner that executes the Bash function of
// scripts/lib/usage-capture-optin.sh and its TypeScript twin over two copies of one configuration and
// compares exit status, both streams (paths and backup stamps normalised), file bytes and file mode.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import type { SpawnResult, Spawner } from "../../lib/setup/context.ts";
import type { UcCtx } from "../../lib/setup/usage-capture.ts";
import { bashLibs } from "./bash-libs.ts";
import { cleanEnv, realTmp, REPO, SKIP_POSIX, which } from "./worktree-fixtures.ts";

export const SKIP = SKIP_POSIX || (which("jq") === null ? "SKIP: jq is needed" : false);
export const OK: SpawnResult = { status: 0, stdout: "", stderr: "" };
export const floorOk: Spawner = () => OK;
export const CLIS = ["claude", "gemini", "copilot"] as const;
export type Cli = (typeof CLIS)[number];
export const EVENT = { claude: "Stop", gemini: "AfterModel", copilot: "agentStop" } as const;
export const ID = { claude: "claude-code", gemini: "gemini-cli", copilot: "copilot-cli" } as const;

/** A checkout holding the capture scripts and the three fragments, copied from this repository. */
export function checkout(): string {
  const co = realTmp("uc-co-");
  fs.mkdirSync(path.join(co, "hooks"));
  for (const name of fs.readdirSync(path.join(REPO, "hooks"))) {
    if (name.startsWith("usage-capture.") || name.endsWith("-usage-capture-hooks.json")) {
      fs.copyFileSync(path.join(REPO, "hooks", name), path.join(co, "hooks", name));
    }
  }
  return co;
}

export interface Run {
  readonly ctx: UcCtx;
  readonly out: string[];
  readonly err: string[];
}
export function runCtx(repo: string): Run {
  const out: string[] = [];
  const err: string[] = [];
  const io = {
    out: (l: string) => void out.push(l),
    err: (l: string) => void err.push(l),
    errRaw: (t: string) => void err.push(t.replace(/\n$/, "")),
  };
  return {
    ctx: { io, env: process.env, platform: process.platform, home: repo, repoDir: repo },
    out,
    err,
  };
}

export const handler = (cli: Cli, command: string, extra = {}) => ({
  type: "command",
  command,
  ...extra,
});
export const cap = (co: string, cli: Cli, ext = "ts"): string =>
  ext === "ts"
    ? `node "${co}/hooks/usage-capture.ts" ${ID[cli]} ${EVENT[cli]}`
    : `bash "${co}/hooks/usage-capture.sh" ${ID[cli]} ${EVENT[cli]}`;
/** A configuration of `cli`'s shape holding `commands` on its event, beside an operator hook and a key. */
export function configOf(cli: Cli, commands: string[]): Record<string, unknown> {
  const all = ["/opt/op/notify.sh --loud", ...commands].map((c) => handler(cli, c, { timeout: 3 }));
  const hooks = cli === "copilot" ? all : [{ matcher: "*", hooks: all }];
  return { model: "opus", hooks: { [EVENT[cli]]: hooks } };
}
export const pretty = (v: unknown): string => `${JSON.stringify(v, null, 2)}\n`;

export const lines = (t: string): string[] => (t === "" ? [] : t.split("\n"));
export const mode = (f: string): number => fs.statSync(f).mode & 0o777;
export const stamp = (t: string): string => t.replace(/\.bak\.\d{8}-\d{6}(\.\d\d)?/g, ".bak.<T>");

export interface Rig {
  readonly co: string;
  readonly cfgB: string;
  readonly cfgT: string;
}
export function rig(initial: unknown | string | undefined, co = checkout()): Rig {
  const dir = path.join(realTmp("uc-cfg-"), "cli");
  const rigged = {
    co,
    cfgB: path.join(dir, "b", "settings.json"),
    cfgT: path.join(dir, "t", "settings.json"),
  };
  for (const f of [rigged.cfgB, rigged.cfgT]) {
    if (initial === undefined) continue;
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, typeof initial === "string" ? initial : pretty(initial), { mode: 0o644 });
  }
  return rigged;
}

/** Run the Bash `body` (variables CLI, CFG, CO, FP) and the TypeScript leg; assert they agree. */
export function differential(
  cli: Cli,
  r: Rig,
  body: string,
  ts: (run: Run, cfg: string, repo: string) => number,
  extra: Record<string, string> = {},
): { rc: number; out: string[]; err: string[]; file: string | null } {
  const sh = bashLibs(`${body}\nexit $?`, {
    ...cleanEnv(),
    CLI: cli,
    CFG: r.cfgB,
    CO: r.co,
    ...extra,
  });
  const run = runCtx(r.co);
  const rc = ts(run, r.cfgT, r.co);
  const norm = (t: string, f: string): string[] => lines(stamp(t.split(f).join("<F>")).trimEnd());
  assert.equal(rc, sh.status, "exit status");
  assert.deepEqual(norm(run.out.join("\n"), r.cfgT), norm(sh.stdout, r.cfgB), "stdout");
  assert.deepEqual(norm(run.err.join("\n"), r.cfgT), norm(sh.stderr, r.cfgB), "stderr");
  const there = fs.existsSync(r.cfgT);
  assert.equal(there, fs.existsSync(r.cfgB), "file presence");
  if (there) {
    assert.equal(fs.readFileSync(r.cfgT, "utf8"), fs.readFileSync(r.cfgB, "utf8"), "file bytes");
    assert.equal(mode(r.cfgT), mode(r.cfgB), "file mode");
  }
  return { rc, out: run.out, err: run.err, file: there ? fs.readFileSync(r.cfgT, "utf8") : null };
}
