// skill-scripts-gitlab-ci-cli.ts — black-box runner for the bundled gitlab-ci scripts (spec 0301
// R10). The skill directory is copied OUTSIDE the repository (without evals/, like the built skill)
// and each script runs as `node <entry> ...args` with a scrubbed environment and no network.
// `glab` is replaced through GLAB_BIN by a single-Node-process stub written at test time (no
// committed shebang file) that replays a fixture of fixtures/skill-scripts-gitlab-ci/glab/.

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
  "gitlab-ci",
);
export const GLAB_FIXTURES = path.resolve(
  import.meta.dirname,
  "..",
  "fixtures",
  "skill-scripts",
  "gitlab-ci-0301",
  "glab",
);

export type ScriptName =
  | "lint-gitlab-ci"
  | "check-rules"
  | "check-pinned-images"
  | "check-secrets-exposure";

export interface Run {
  status: number | null;
  stdout: string;
  stderr: string;
}
export interface Envelope {
  ok: boolean;
  data: Record<string, unknown> | null;
  findings: { rule: string; message: string; severity?: string }[];
}

export function tempDir(prefix: string): string {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
}

/** Copy of the skill as built: scripts/ and references/, no evals/. */
export function copySkill(root: string): string {
  const dir = path.join(root, "gitlab-ci");
  fs.cpSync(SKILL_DIR, dir, {
    recursive: true,
    filter: (src) => path.basename(src) !== "evals",
  });
  return dir;
}

export function run(
  skillDir: string,
  script: ScriptName,
  args: readonly string[],
  opts: { cwd: string; env?: Record<string, string>; timeoutMs?: number },
): Run {
  const res = spawnSync(
    process.execPath,
    [path.join(skillDir, "scripts", `${script}.ts`), ...args],
    {
      cwd: opts.cwd,
      env: {
        HOME: os.tmpdir(),
        PATH: path.dirname(process.execPath),
        LC_ALL: "C",
        ...opts.env,
      },
      encoding: "utf8",
      timeout: opts.timeoutMs ?? 60_000,
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
// glab stub of the gitlab-ci tests: logs argv, then replays a fixture or hangs.
const fs = require("node:fs");
const path = require("node:path");
const log = process.env.STUB_LOG;
if (log) fs.appendFileSync(log, JSON.stringify(process.argv.slice(2)) + "\\n");
if (process.env.STUB_HANG) {
  // Two processes in one process group: the stub and a child it starts, so a kill that reaches
  // only the stub leaves the child behind (R6: no process outlives the script).
  const child = require("node:child_process").spawn(
    process.execPath,
    ["-e", "setInterval(() => {}, 1000)"],
    { stdio: "ignore" },
  );
  fs.writeFileSync(process.env.STUB_HANG + ".child", String(child.pid));
  fs.writeFileSync(process.env.STUB_HANG, String(process.pid));
  setInterval(() => {}, 1000);
} else {
  const dir = process.env.STUB_FIXTURE;
  const read = (n) => fs.readFileSync(path.join(dir, n), "utf8");
  process.stdout.write(read("stdout"));
  process.stderr.write(read("stderr"));
  process.exitCode = Number(read("status").trim());
}
`;

export interface Glab {
  bin: string;
  log: string;
  /** Environment that makes the stub replay `fixture` (a directory name of GLAB_FIXTURES). */
  replay(fixture: string): Record<string, string>;
  /** Environment that makes the stub hang and write its pid to `pidFile`. */
  hang(pidFile: string): Record<string, string>;
  calls(): string[][];
  reset(): void;
}

export function glabStub(root: string): Glab {
  const bin = path.join(root, "stub-bin", "glab-stub");
  fs.mkdirSync(path.dirname(bin), { recursive: true });
  fs.writeFileSync(bin, STUB, { mode: 0o755 });
  const log = path.join(root, "stub-bin", "calls.log");
  return {
    bin,
    log,
    replay: (fixture) => ({
      GLAB_BIN: bin,
      STUB_LOG: log,
      STUB_FIXTURE: path.join(GLAB_FIXTURES, fixture),
    }),
    hang: (pidFile) => ({ GLAB_BIN: bin, STUB_LOG: log, STUB_HANG: pidFile }),
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
