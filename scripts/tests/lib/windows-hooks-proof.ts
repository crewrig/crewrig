// windows-hooks-proof.ts — the helpers of windows-extension-hooks.test.ts (spec 0258 R16, R20, R27).
// Each example hook runs with a fixed JSON payload on standard input from PowerShell and from
// `cmd.exe` (directly, off Windows), with `bash` absent from the child PATH. The interpreters are
// resolved from the PARENT environment before the child's PATH is narrowed; `System32\bash.exe`
// (WSL) sits on every runner PATH, so a tripwire `bash` placed first stands in for it and the proof
// asserts the tripwire was never called. Importable on any host.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import type { SpawnSyncOptionsWithStringEncoding } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { defaultIsFile } from "../../lib/worktree-claim/launch-windows.ts";
import { assertNoBash, childPath, lines, writeBins } from "./windows-packaging-driver.ts";
import type { Bins } from "./windows-packaging-driver.ts";
import { resolveInterpreters, setEnv, WIN } from "./windows-proof-support.ts";
import type { Interpreters, Run } from "./windows-proof-support.ts";

export const REPO = path.resolve(import.meta.dirname, "..", "..", "..");

/** The three example hooks, as repository paths of their TypeScript entries. */
export const HOOK_FILES = [
  "extensions/core/hello-world/hooks/prompt-logger.ts",
  "extensions/core/hello-world/hooks/shell-logger.ts",
  "extension-skeleton/hook/hooks/logger.ts",
] as const;

/** The fixed one-line payload; the hooks write it back followed by one line feed. */
export const PAYLOAD = '{"event":"windows-hooks-proof","tool":"shell","args":["ls","-la"]}';

/** How a hook is started: through PowerShell, through `cmd.exe`, or directly (off Windows). */
export type Leg = "pwsh" | "cmd" | "direct";

/** The four package layouts of spec 0258 R2; `undefined` means no `package.json`. */
export const LAYOUTS: readonly (readonly [string, string | undefined])[] = [
  ["type module", '{"type":"module"}'],
  ["type commonjs", '{"type":"commonjs"}'],
  ["typeless package", "{}"],
  ["no package.json", undefined],
];

export interface Sandbox {
  readonly interpreters: Interpreters;
  readonly bins: Bins;
  /** The hook's working directory and landing zone: it must stay empty. */
  readonly landing: string;
  readonly env: NodeJS.ProcessEnv;
  readonly root: string;
}

/** Build the child environment: the parent's, PATH narrowed to drop every bash but System32's. */
export function makeSandbox(root: string): Sandbox {
  const interpreters = resolveInterpreters({
    platform: process.platform,
    env: process.env,
    isFile: defaultIsFile,
  });
  const bins = writeBins(path.join(root, "bin"), false);
  const landing = path.join(root, "landing");
  fs.mkdirSync(landing, { recursive: true });
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const key of ["NODE_TEST_CONTEXT", "NODE_OPTIONS", "CI"]) delete env[key];
  const systemRoot = process.env["SystemRoot"] ?? process.env["windir"] ?? "C:\\Windows";
  setEnv(
    env,
    "PATH",
    childPath([bins.dir], process.env["PATH"] ?? process.env["Path"] ?? "", {
      platform: process.platform,
      systemRoot,
      isFile: defaultIsFile,
    }),
  );
  return { interpreters, bins, landing, env, root };
}

const head = (text: string): string => (text.length > 2000 ? `${text.slice(0, 2000)}...` : text);

/** Run `script` as the hook command line does (`node <script>`), the payload on standard input. */
export function runHook(sb: Sandbox, leg: Leg, script: string, input = `${PAYLOAD}\n`): Run {
  const argv = [process.execPath, script];
  const ps = `& ${argv.map((a) => `'${a.replaceAll("'", "''")}'`).join(" ")}; exit $LASTEXITCODE`;
  const cmd = `"${argv.map((a) => `"${a}"`).join(" ")}"`;
  const base = {
    encoding: "utf8",
    env: sb.env,
    cwd: sb.landing,
    input,
    windowsHide: true,
    timeout: 60_000,
  } as const;
  const spawned: [string, string[], SpawnSyncOptionsWithStringEncoding] =
    leg === "direct" || !WIN
      ? [process.execPath, [script], base]
      : leg === "cmd"
        ? [
            sb.interpreters.cmd,
            ["/d", "/s", "/c", cmd],
            { ...base, windowsVerbatimArguments: true },
          ]
        : [sb.interpreters.pwsh, ["-NoProfile", "-NonInteractive", "-Command", ps], base];
  const started = process.hrtime.bigint();
  const res = spawnSync(spawned[0], spawned[1], spawned[2]);
  const ms = Number((process.hrtime.bigint() - started) / 1_000_000n);
  const out = res.stdout ?? "";
  const err = res.stderr ?? "";
  const detail = [
    `  command: ${JSON.stringify([spawned[0], ...spawned[1]])}`,
    `  spawn error: ${res.error?.message ?? "none"}`,
    `  status: ${res.status}, signal: ${res.signal}`,
    `  stdout: ${JSON.stringify(head(out))}`,
    `  stderr: ${JSON.stringify(head(err))}`,
  ].join("\n");
  return { entry: path.basename(script), status: res.status, out, err, ms, detail };
}

/**
 * What is wrong with a run: standard output is the payload and one line feed, standard error is
 * empty, exit status 0. A console layer may rewrite the line ending a pipe carries, so output is
 * compared with CRLF folded to LF everywhere but the `direct` leg, which stays byte-exact.
 */
export function runProblems(run: Run, leg: Leg, expected = `${PAYLOAD}\n`): string[] {
  const problems: string[] = [];
  const out = leg === "direct" ? run.out : lines(run.out);
  if (out !== expected) problems.push(`stdout is not the payload and one line feed`);
  if (run.err !== "") problems.push("stderr is not empty");
  if (run.status !== 0) problems.push(`exit status ${run.status}, not 0`);
  return problems;
}

/** Every file under the landing zone is a problem: the hooks write nothing, and none may hold a CR. */
export function landingProblems(dir: string): string[] {
  const problems: string[] = [];
  const walk = (current: string): void => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else
        problems.push(
          fs.readFileSync(full).includes(13)
            ? `${full} was written and holds a carriage return`
            : `${full} was written`,
        );
    }
  };
  walk(dir);
  return problems;
}

/** Run one case and record its problems, each with the command, stdout and stderr, in `failures`. */
export function prove(
  sb: Sandbox,
  leg: Leg,
  label: string,
  script: string,
  failures: string[],
): void {
  const run = runHook(sb, leg, script);
  const problems = [...runProblems(run, leg), ...landingProblems(sb.landing)];
  if (problems.length > 0)
    failures.push(`${label} [${leg}]: ${problems.join("; ")}\n${run.detail}`);
}

/** Every hook, started from `leg`. */
export function proveHooks(sb: Sandbox, leg: Leg, failures: string[]): void {
  for (const hook of HOOK_FILES) prove(sb, leg, hook, path.join(REPO, hook), failures);
}

/** Every hook copied under each package layout of spec 0258 R2, started from `leg`. */
export function proveLayouts(sb: Sandbox, leg: Leg, failures: string[]): void {
  for (const hook of HOOK_FILES) {
    for (const [layout, packageJson] of LAYOUTS) {
      const dir = fs.mkdtempSync(path.join(sb.root, "layout-"));
      if (packageJson !== undefined) fs.writeFileSync(path.join(dir, "package.json"), packageJson);
      const copy = path.join(dir, "hook.ts");
      fs.copyFileSync(path.join(REPO, hook), copy);
      prove(sb, leg, `${hook} copied under ${layout}`, copy, failures);
    }
  }
}

/** The failures as one assertion message naming each, or nothing when there are none. */
export function assertNone(failures: readonly string[]): void {
  const list = failures.map((f, i) => `${i + 1}. ${f}`).join("\n");
  assert.equal(failures.length, 0, `${failures.length} failure(s)\n${list}`);
}

/** The tripwire `bash` was never reached. */
export const assertBashAbsent = (sb: Sandbox): void => assertNoBash(sb.bins);
