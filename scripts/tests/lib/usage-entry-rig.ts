// usage-entry-rig.ts — the differential runner of setup-lib-usage-entry.test.ts: the entry
// scripts/usage-capture-optin.ts run in a throwaway HOME against the Bash function of
// scripts/lib/usage-capture-optin.sh over two copies of one configuration.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { bashLibs } from "./bash-libs.ts";
import { mode, rig, stamp, type Cli } from "./usage-capture-rig.ts";
import { cleanEnv, realTmp, REPO } from "./worktree-fixtures.ts";

export const ENTRY = path.join(REPO, "scripts", "usage-capture-optin.ts");

export function node(args: readonly string[], env: NodeJS.ProcessEnv = cleanEnv()) {
  const home = realTmp("uc-entry-home-");
  const res = spawnSync(process.execPath, [ENTRY, ...args], {
    encoding: "utf8",
    cwd: home,
    env: { ...env, HOME: home, USERPROFILE: home },
  });
  return { status: res.status, stdout: res.stdout, stderr: res.stderr, home };
}

/** What both legs produce, with paths and backup stamps normalised. */
export interface Leg {
  readonly rc: number | null;
  readonly out: string;
  readonly err: string;
  readonly file: string | null;
  readonly mode: number | null;
  readonly result: string | null;
}

/** One differential case: the shell `body` (CLI, CFG, CO, FP, OUT, RES in its environment) against the entry's `args`. */
export function same(
  cli: Cli,
  initial: unknown,
  body: string,
  args: (f: { cfg: string; co: string; out: string; res: string }) => string[],
  extra: Record<string, string> = {},
): Leg {
  const r = rig(initial);
  const dir = realTmp("uc-legs-");
  const files = (leg: string, cfg: string) => ({
    cfg,
    co: r.co,
    out: path.join(dir, `${leg}-out.json`),
    res: path.join(dir, `${leg}-res.txt`),
  });
  const b = files("b", r.cfgB);
  const t = files("t", r.cfgT);
  const sh = bashLibs(`${body}\nrc=$?\n${RES_LINES}\nexit $rc`, {
    ...cleanEnv(),
    CLI: cli,
    CFG: b.cfg,
    CO: b.co,
    OUT: b.out,
    RES: b.res,
    ...extra,
  });
  const ts = node(args(t));
  const norm = (text: string, f: typeof b): string =>
    stamp(text.split(f.cfg).join("<F>").split(f.out).join("<O>")).trimEnd();
  const read = (p: string): string | null => (fs.existsSync(p) ? fs.readFileSync(p, "utf8") : null);
  const leg = (rc: number | null, o: string, e: string, f: typeof b): Leg => ({
    rc,
    out: norm(o, f),
    err: norm(e, f),
    file: read(f.cfg),
    mode: fs.existsSync(f.cfg) ? mode(f.cfg) : null,
    result: read(f.res),
  });
  const a = leg(sh.status, sh.stdout, sh.stderr, b);
  const c = leg(ts.status, ts.stdout, ts.stderr, t);
  assert.deepEqual(c, a);
  assert.equal(read(t.out), read(b.out), "out file bytes");
  return c;
}
/** After a call in the shell: the variables the shim's `--result` file stands for. */
const RES_LINES =
  'if [ -n "${WANT_RES:-}" ]; then printf "%s=%s\\n" "$WANT_RES" "${!WANT_RES:-0}" > "$RES"; fi';
