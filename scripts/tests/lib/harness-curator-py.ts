// harness-curator-py.ts — shared helper of the curator replacement tests (spec 0265, row J2):
// in-process evaluation of curate.py / apply.py, a scratch environment that owns every path a
// child may write, and the guard proving no real HOME state was reached. POSIX only (the callers
// skip on win32). Sandboxes for plain script runs come from harness-curator-observe.ts instead.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { findTool, SCRIPTS_DIR } from "./harness-curator-observe.ts";
import { log, stub } from "./harness-curator-stubs.ts";
import type { StubFile } from "./harness-curator-stubs.ts";

export { SCRIPTS_DIR };

/** The 16-drawer sample fixture the curator ships. */
export const SAMPLE: string = fs.readFileSync(
  path.join(SCRIPTS_DIR, "..", "assets", "sample-frictions.json"),
  "utf8",
);

/** Why the suite skips on Windows; pass to `{ skip: SKIP_WIN32 }` (undefined elsewhere). */
export const SKIP_WIN32: string | undefined =
  process.platform === "win32"
    ? "harness-curator replacement tests are POSIX only (windows-harness-curator.test.ts covers win32)"
    : undefined;

/** Latin1-held bytes (what `observe` returns) decoded as UTF-8. */
export const utf8 = (latin1: string): string => Buffer.from(latin1, "latin1").toString("utf8");

export function python3(): string | undefined {
  return findTool("python3");
}

export interface Scratch {
  readonly root: string;
  readonly home: string;
  readonly palace: string;
  readonly bin: string;
  readonly state: string;
  /** Allow-list child env: HOME/TMPDIR/PATH point inside `root`; CI and NODE_TEST_CONTEXT absent. */
  readonly env: NodeJS.ProcessEnv;
  /** The argv log of the stubs written with `writeStub`. */
  readonly calls: string;
  cleanup(): void;
}

/** mkdtemp root `crewrig-hc-` with home/ palace/ bin/ state/; refuses a root outside os.tmpdir(). */
export function scratchEnv(extraEnv: Record<string, string> = {}): Scratch {
  const tmp = fs.realpathSync(os.tmpdir());
  const root = fs.realpathSync(fs.mkdtempSync(path.join(tmp, "crewrig-hc-")));
  if (!root.startsWith(tmp + path.sep)) throw new Error(`scratch root outside tmpdir: ${root}`);
  const [home, palace, bin, state] = ["home", "palace", "bin", "state"].map((d) => {
    fs.mkdirSync(path.join(root, d));
    return path.join(root, d);
  }) as [string, string, string, string];
  const callsFile = path.join(root, "calls.log");
  const env: NodeJS.ProcessEnv = {
    HOME: home,
    TMPDIR: state,
    PATH: bin,
    LC_ALL: "C",
    GIT_CONFIG_NOSYSTEM: "1",
    ...extraEnv,
  };
  delete env["CI"];
  delete env["NODE_TEST_CONTEXT"];
  return {
    root,
    home,
    palace,
    bin,
    state,
    env,
    get calls(): string {
      return fs.existsSync(callsFile) ? fs.readFileSync(callsFile, "utf8") : "";
    },
    cleanup(): void {
      fs.rmSync(root, { recursive: true, force: true });
    },
  };
}

/** Write a stub (the `{ROOT}`/`{CALLS}` placeholders resolved) into the scratch root. */
export function writeStub(s: Scratch, file: StubFile): void {
  const target = path.join(s.root, file.path);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const text = `#!/bin/sh\n${log(file.name)}${file.body}`
    .replaceAll("{ROOT}", s.root)
    .replaceAll("{CALLS}", path.join(s.root, "calls.log"));
  fs.writeFileSync(target, text, { mode: 0o755 });
}

/** A `gh` that logs every call, answers `auth status`, and FAILS `issue create` (exit 1). */
export function stubGh(s: Scratch): void {
  writeStub(
    s,
    stub(
      "gh",
      `case "$1 $2" in\n  "issue create") echo "stub gh: issue create refused" >&2; exit 1 ;;\nesac\nexit 0\n`,
    ),
  );
}

/** Run a Python snippet with `OUT` printed; `mod` is loaded by importlib from SCRIPTS_DIR as `m`. */
export function pyEval(
  script: "curate.py" | "apply.py",
  snippet: string,
  env: NodeJS.ProcessEnv = {},
): string {
  const py = python3();
  if (py === undefined) throw new Error("harness-curator: python3 not found");
  const code = [
    "import importlib.util, sys",
    `spec = importlib.util.spec_from_file_location('hc_mod', ${JSON.stringify(path.join(SCRIPTS_DIR, script))})`,
    "m = importlib.util.module_from_spec(spec)",
    "sys.modules['hc_mod'] = m",
    "spec.loader.exec_module(m)",
    snippet,
    "print(str(OUT))",
  ].join("\n");
  const childEnv: NodeJS.ProcessEnv = { LC_ALL: "C", PATH: "", ...env };
  delete childEnv["CI"];
  delete childEnv["NODE_TEST_CONTEXT"];
  const res = spawnSync(py, ["-I", "-c", code], {
    env: childEnv,
    encoding: "utf8",
    timeout: 60_000,
  });
  if (res.status !== 0) throw new Error(`pyEval failed (${res.status}): ${res.stderr}`);
  return res.stdout.replace(/\n$/, "");
}

export interface RealState {
  readonly [p: string]: { exists: boolean; size: number; mtimeMs: number };
}

const statOf = (p: string): { exists: boolean; size: number; mtimeMs: number } => {
  try {
    const st = fs.statSync(p);
    return { exists: true, size: st.size, mtimeMs: st.mtimeMs };
  } catch {
    return { exists: false, size: 0, mtimeMs: 0 };
  }
};

/** Read-only stat of the real ~/.mempalace and the crewrig LaunchAgents (real HOME via os.homedir()). */
export function snapshotRealState(): RealState {
  const home = os.homedir();
  const out: Record<string, { exists: boolean; size: number; mtimeMs: number }> = {};
  const paths = [path.join(home, ".mempalace"), path.join(home, ".crewrig")];
  const agents = path.join(home, "Library", "LaunchAgents");
  try {
    for (const n of fs.readdirSync(agents))
      if (/crewrig/i.test(n)) paths.push(path.join(agents, n));
  } catch {
    // absent directory: a defined state
  }
  for (const p of paths) out[p] = statOf(p);
  return out;
}

const FORBIDDEN_CALL =
  /^(?:launchctl <(?:load|bootstrap|bootout|unload)>|systemctl .*<(?:enable|start|disable)>|crontab <->|schtasks .*<\/create>)/im;

/**
 * Throws when the child env has no HOME or a HOME outside os.tmpdir(), when the stub call log shows
 * a scheduler mutation, or when the real state recorded by `before` has changed.
 */
export function assertNoRealState(env: NodeJS.ProcessEnv, calls = "", before?: RealState): void {
  const home = env["HOME"];
  if (home === undefined || home === "") throw new Error("assertNoRealState: HOME unset");
  const tmp = fs.realpathSync(os.tmpdir());
  if (!path.resolve(home).startsWith(tmp + path.sep))
    throw new Error(`assertNoRealState: HOME outside tmpdir: ${home}`);
  const hit = FORBIDDEN_CALL.exec(calls);
  if (hit !== null) throw new Error(`assertNoRealState: scheduler mutation logged: ${hit[0]}`);
  if (before !== undefined) {
    const now = snapshotRealState();
    for (const [p, was] of Object.entries(before)) {
      const is = now[p] ?? statOf(p);
      if (is.exists !== was.exists || is.size !== was.size || is.mtimeMs !== was.mtimeMs)
        throw new Error(`assertNoRealState: real state changed: ${p}`);
    }
    for (const p of Object.keys(now))
      if (!(p in before)) throw new Error(`assertNoRealState: real state appeared: ${p}`);
  }
}
