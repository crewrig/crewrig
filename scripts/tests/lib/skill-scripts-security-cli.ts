// skill-scripts-security-cli.ts — black-box runner for the bundled security scripts (spec 0303 R13).
// The skill directory is copied OUTSIDE the repository (without evals/, like the built skill) and
// each script runs as `node <entry> ...args` with a scrubbed environment and no network. `npm` and
// `pip-audit` are replaced by single-Node-process stubs written at test time (no committed shebang
// file) that replay a real capture of fixtures/skill-scripts/security-0303/captures/.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const SKILL_DIR = path.resolve(
  import.meta.dirname,
  "..",
  "..",
  "..",
  "artifacts",
  "core",
  "skills",
  "security",
);
export const CAPTURES = path.resolve(
  import.meta.dirname,
  "..",
  "fixtures",
  "skill-scripts",
  "security-0303",
  "captures",
);

export type ScriptName = "security-finding" | "dep-audit" | "check-secrets-exposure";

export interface Run {
  status: number | null;
  stdout: string;
  stderr: string;
}
export interface Envelope {
  ok: boolean;
  data: Record<string, unknown> | null;
  findings: {
    rule: string;
    message: string;
    severity?: string;
    cause?: string;
    ecosystem?: string;
    finding?: number;
    line?: number;
  }[];
}

export function tempDir(prefix: string): string {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
}

/** Copy of the skill as built: scripts/ and references/, no evals/. */
export function copySkill(root: string, name = "security", from = SKILL_DIR): string {
  const dir = path.join(root, name);
  fs.cpSync(from, dir, { recursive: true, filter: (src) => path.basename(src) !== "evals" });
  return dir;
}

export function run(
  skillDir: string,
  script: ScriptName,
  args: readonly string[],
  opts: { cwd: string; env?: Record<string, string>; timeoutMs?: number; input?: string },
): Run {
  const res = spawnSync(
    process.execPath,
    [path.join(skillDir, "scripts", `${script}.ts`), ...args],
    {
      cwd: opts.cwd,
      env: { HOME: os.tmpdir(), PATH: path.dirname(process.execPath), LC_ALL: "C", ...opts.env },
      encoding: "utf8",
      timeout: opts.timeoutMs ?? 60_000,
      ...(opts.input === undefined ? {} : { input: opts.input }),
    },
  );
  return { status: res.status, stdout: res.stdout, stderr: res.stderr };
}

export function envelope(r: Run): Envelope {
  const lines = r.stdout.split("\n").filter((l) => l !== "");
  if (lines.length !== 1) throw new Error(`expected exactly one stdout line, got: ${r.stdout}`);
  return JSON.parse(lines[0] as string) as Envelope;
}

const STUB = `#!${process.execPath}
// npm / pip-audit stub of the security tests: logs argv, then replays a capture, or hangs.
const fs = require("node:fs");
const path = require("node:path");
const tool = path.basename(process.argv[1]);
const key = tool === "npm" ? "STUB_NPM" : "STUB_PIP";
const log = process.env.STUB_LOG;
if (log) fs.appendFileSync(log, JSON.stringify([tool, ...process.argv.slice(2)]) + "\\n");
if (process.env[key + "_HANG"]) {
  // Two processes in one process group: the stub and a child it starts, so a kill that reaches
  // only the stub leaves the child behind (R10: no process outlives the script).
  const hang = process.env[key + "_HANG"];
  const child = require("node:child_process").spawn(
    process.execPath,
    ["-e", "setInterval(() => {}, 1000)"],
    { stdio: "ignore" },
  );
  fs.writeFileSync(hang + ".child", String(child.pid));
  fs.writeFileSync(hang, String(process.pid));
  setInterval(() => {}, 1000);
} else {
  const dir = process.env[key];
  const read = (n) => fs.readFileSync(path.join(dir, n), "utf8");
  process.stdout.write(read("stdout"));
  process.stderr.write(read("stderr"));
  process.exitCode = Number(read("status").trim());
}
`;

export interface Tools {
  /** A directory to use as the whole PATH: holds the stubs of npm and pip-audit. */
  bin: string;
  log: string;
  /** Environment replaying captures: `npm` and/or `pip` name a case directory of CAPTURES. */
  replay(cases: { npm?: string; pip?: string }): Record<string, string>;
  /** Environment that makes the named tool hang and write its pid to `pidFile`. */
  hang(tool: "npm" | "pip", pidFile: string): Record<string, string>;
  calls(): string[][];
  reset(): void;
  /** A PATH that holds neither tool. */
  empty: string;
}

export function toolStubs(root: string): Tools {
  const bin = path.join(root, "stub-bin");
  const empty = path.join(root, "empty-bin");
  fs.mkdirSync(bin, { recursive: true });
  fs.mkdirSync(empty, { recursive: true });
  for (const tool of ["npm", "pip-audit"]) fs.writeFileSync(path.join(bin, tool), STUB, { mode: 0o755 });
  const log = path.join(root, "stub-calls.log");
  const base = { PATH: bin, STUB_LOG: log };
  /** A capture name, or an absolute directory of a derived fixture written by the test. */
  const at = (tool: string, name: string): string =>
    path.isAbsolute(name) ? name : path.join(CAPTURES, tool, name);
  return {
    bin,
    log,
    empty,
    replay: (cases) => ({
      ...base,
      ...(cases.npm === undefined ? {} : { STUB_NPM: at("npm", cases.npm) }),
      ...(cases.pip === undefined ? {} : { STUB_PIP: at("pip", cases.pip) }),
    }),
    hang: (tool, pidFile) => ({ ...base, [tool === "npm" ? "STUB_NPM_HANG" : "STUB_PIP_HANG"]: pidFile }),
    calls: () =>
      fs.existsSync(log)
        ? fs
            .readFileSync(log, "utf8")
            .split("\n")
            .filter((l) => l !== "")
            .map((l) => JSON.parse(l) as string[])
        : [],
    reset: () => fs.rmSync(log, { force: true }),
  };
}

/** True when no process has this pid any more. */
export function gone(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return false;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "ESRCH";
  }
}

/** True when a file of mode 000 is really unreadable here (false as root). */
export function canMakeUnreadable(dir: string): boolean {
  const probe = path.join(dir, ".unreadable-probe");
  fs.writeFileSync(probe, "x");
  fs.chmodSync(probe, 0o000);
  try {
    fs.readFileSync(probe);
    return false;
  } catch {
    return true;
  } finally {
    fs.chmodSync(probe, 0o644);
    fs.rmSync(probe, { force: true });
  }
}
