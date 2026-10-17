// differential-compare.ts — the comparison core of the shell-versus-TS differential: runs both
// legs of one case on a two-sandbox layout and compares output and left-behind state.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {
  cleanEnv,
  diffMaps,
  mirror,
  normaliser,
  treeMap,
  type Side,
} from "./differential-sandbox.ts";
import { assertInside, assertRoot, tmpEnv } from "./differential-guard.ts";
import { findShared, rewind, settle, takePre } from "./differential-shared.ts";
import {
  assertRemotesUnderScratch,
  FIXED_GIT_ENV,
  refsOf,
  type ScratchRemote,
} from "./scratch-remote.ts";

const TYPELESS_FLAG = "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON";

export interface SideCtx {
  readonly side: Side;
  readonly root: string;
  readonly scratch: ScratchRemote;
}

export interface DiffCase {
  /** Shell entry, repo-relative, e.g. `scripts/foo.sh`. */
  script: string;
  /** TS entry; default is `script` with `.sh` replaced by `.ts`. */
  tsScript?: string;
  /** Interpreter of the TS leg; default `["node"]`. */
  tsCommand?: string[];
  /** `{ROOT}` in args, env values and stdin is replaced by each side's root. */
  args?: string[];
  env?: Record<string, string>;
  stdin?: string;
  /** Working directory, relative to the sandbox root. */
  cwd?: string;
  /**
   * Default true. False = pure-checker mode: the script writes nothing under the sandbox, so
   * the per-call mirror and the tree/HOME digests are skipped; only stdout, stderr, status and
   * refs are compared.
   */
  compareState?: boolean;
}

export interface Leg {
  status: number | null;
  stdout: string;
  stderr: string;
}

export interface DiffResult {
  equal: boolean;
  diffs: string[];
  shell: Leg;
  ts: Leg;
}

export interface Layout {
  /** The per-run root made by `createRoot`; the only place the legs may touch. */
  root: string;
  a: string;
  b: string;
  scratch: Record<Side, ScratchRemote>;
  shellFile: string;
  tsFile: string;
  tsCommand: string[];
  exclude: string[];
  record?: string;
  stubGh?: boolean;
  compareState?: boolean;
}

function runLeg(cmd: string[], cwd: string, env: NodeJS.ProcessEnv, stdin: string): Leg {
  const res = spawnSync(cmd[0] ?? "", cmd.slice(1), {
    cwd,
    env,
    input: Buffer.from(stdin, "latin1"),
    maxBuffer: 1 << 28,
    timeout: 120_000,
  });
  return {
    status: res.status ?? (res.signal === null ? null : 128),
    stdout: res.stdout.toString("latin1"),
    stderr: res.stderr.toString("latin1"),
  };
}

/** Run both legs of one case on the given layout and compare output and state. */
export function compareLegs(l: Layout, c: DiffCase, mirrorFirst = false): DiffResult {
  assertRoot(l.root);
  assertInside(l.root, l.a);
  assertInside(l.root, l.b);
  const roots: Record<Side, string> = { shell: l.a, ts: l.b };
  const state = (c.compareState ?? l.compareState) !== false;
  if (mirrorFirst && state) mirror(l.a, l.b, [...l.exclude, l.tsFile]);
  const forSide = (s: string, side: Side): string => {
    const out = s.replaceAll("{ROOT}", roots[side]);
    return side === "ts" ? out.replaceAll(l.a, l.b) : out;
  };
  let diffsShared: string[] = [];
  const legs = {} as Record<Side, Leg>;
  // Wrapper mode: repositories the suite names (argv, env) are shared by both legs; isolate them.
  const shared = mirrorFirst
    ? findShared(
        [...(c.args ?? []), ...Object.values(process.env).filter((v): v is string => !!v)],
        l.root,
        [l.a, l.b, l.scratch.shell.root, l.scratch.ts.root].map((p) => fs.realpathSync(p)),
      )
    : [];
  const snapDir = shared.length ? fs.mkdtempSync(path.join(l.root, "tmp", "shared-snap-")) : "";
  let shellRefs: string[] = [];
  if (shared.length) takePre(shared, snapDir);
  for (const side of ["shell", "ts"] as const) {
    if (side === "ts" && shared.length) shellRefs = rewind(shared, snapDir);
    const sc = l.scratch[side];
    const env = cleanEnv(sc.home, {
      ...FIXED_GIT_ENV,
      ...tmpEnv(l.root),
    });
    env.PATH = `${sc.bin}${path.delimiter}${env.PATH ?? ""}`;
    // Wrapper mode: the suite's own CI marker is part of the case (cleanEnv drops the ambient one).
    if (mirrorFirst && process.env.CI) env.CI = process.env.CI;
    for (const [k, v] of Object.entries(c.env ?? {})) env[k] = forSide(v, side);
    const cmd = side === "shell" ? ["bash", l.shellFile] : [...l.tsCommand, l.tsFile];
    // The TS leg must not carry the MODULE_TYPELESS_PACKAGE_JSON warning on stderr.
    if (side === "ts" && cmd[0] === "node") cmd.splice(1, 0, TYPELESS_FLAG);
    const file = path.join(roots[side], cmd[cmd.length - 1] ?? "");
    const full = [...cmd.slice(0, -1), file, ...(c.args ?? []).map((x) => forSide(x, side))];
    legs[side] = runLeg(
      full,
      path.join(roots[side], c.cwd ?? "."),
      env,
      forSide(c.stdin ?? "", side),
    );
  }
  if (shared.length) diffsShared = settle(shared, shellRefs);
  if (snapDir) assertInside(l.root, snapDir);
  if (snapDir) fs.rmSync(snapDir, { recursive: true, force: true });
  const norm = {
    shell: normaliser([
      [l.a, "<ROOT>"],
      [l.scratch.shell.root, "<SCRATCH>"],
    ]),
    ts: normaliser([
      [l.b, "<ROOT>"],
      [l.scratch.ts.root, "<SCRATCH>"],
    ]),
  };
  const diffs: string[] = [...diffsShared];
  const out = (side: Side): Leg => ({
    status: legs[side].status,
    stdout: norm[side](legs[side].stdout),
    stderr: norm[side](legs[side].stderr),
  });
  const [s, t] = [out("shell"), out("ts")];
  if (s.stdout !== t.stdout)
    diffs.push(
      `stdout differs:\n shell=${JSON.stringify(s.stdout)}\n ts=${JSON.stringify(t.stdout)}`,
    );
  if (s.stderr !== t.stderr)
    diffs.push(
      `stderr differs:\n shell=${JSON.stringify(s.stderr)}\n ts=${JSON.stringify(t.stderr)}`,
    );
  if (s.status !== t.status) diffs.push(`status differs: shell=${s.status} ts=${t.status}`);
  const tree = (root: string, side: Side, ex: string[]) => treeMap(root, norm[side], ex);
  if (state) {
    const treeDiff = diffMaps(tree(l.a, "shell", l.exclude), tree(l.b, "ts", l.exclude));
    if (treeDiff) diffs.push(`tree state differs:\n${treeDiff}`);
    const homeDiff = diffMaps(
      tree(l.scratch.shell.home, "shell", []),
      tree(l.scratch.ts.home, "ts", []),
    );
    if (homeDiff) diffs.push(`HOME state differs:\n${homeDiff}`);
  }
  const refs = (side: Side): string[] => {
    const root = roots[side];
    const bare = l.scratch[side].bare;
    assertRemotesUnderScratch(root, l.scratch[side].root);
    return [refsOf(root), refsOf(bare)].map(norm[side]);
  };
  const [rs, rt] = [refs("shell"), refs("ts")];
  if (rs[0] !== rt[0]) diffs.push(`sandbox refs differ:\n shell=${rs[0]}\n ts=${rt[0]}`);
  if (rs[1] !== rt[1]) diffs.push(`scratch remote refs differ:\n shell=${rs[1]}\n ts=${rt[1]}`);
  const result = { equal: diffs.length === 0, diffs, shell: s, ts: t };
  if (l.record)
    fs.appendFileSync(
      l.record,
      `${JSON.stringify({ script: c.script, args: c.args ?? [], ...result })}\n`,
    );
  return { ...result, shell: legs.shell, ts: legs.ts };
}
