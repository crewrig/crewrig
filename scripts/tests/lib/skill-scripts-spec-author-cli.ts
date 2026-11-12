// skill-scripts-spec-author-cli.ts — black-box runner for the bundled spec-author script (spec 0294 R10).
// The script runs as `node <entry> ...args` inside a throwaway repository whose two repository
// tools are fakes steered by files; nothing touches a forge or the network.

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
  "spec-author",
);

export interface Run {
  status: number | null;
  stdout: string;
  stderr: string;
}

export interface Envelope {
  ok: boolean;
  data: Record<string, unknown> | null;
  findings: { rule: string; message: string }[];
}

export function tempDir(prefix: string): string {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
}

/** Run scaffold-spec.ts of `skillDir` (default: the repository copy) from `cwd`. */
export function run(args: readonly string[], opts: { cwd: string; skillDir?: string }): Run {
  const entry = path.join(opts.skillDir ?? SKILL_DIR, "scripts", "scaffold-spec.ts");
  const res = spawnSync(process.execPath, [entry, ...args], {
    cwd: opts.cwd,
    env: {
      HOME: os.tmpdir(),
      PATH: `${path.dirname(process.execPath)}:/usr/bin:/bin`,
      LC_ALL: "C",
      GIT_CONFIG_NOSYSTEM: "1",
    },
    encoding: "utf8",
    timeout: 30_000,
  });
  return { status: res.status, stdout: res.stdout, stderr: res.stderr };
}

export function parseEnvelope(r: Run): Envelope {
  const lines = r.stdout.split("\n").filter((l) => l !== "");
  if (lines.length !== 1) throw new Error(`expected exactly one stdout line, got: ${r.stdout}`);
  return JSON.parse(lines[0] as string) as Envelope;
}

export interface FakeRepo {
  dir: string;
  /** Set what the fake ticket-pickup exits with (default 0). */
  pickup(exit: number): void;
  /** Set what the fake reservation tool prints and exits with (default `0500`, 0). */
  reserve(id: string, exit?: number): void;
  /** The commands the fakes received, one `<tool> <args>` line each. */
  calls(): string[];
}

/** A git repository with fake `scripts/ticket-pickup.ts` and `scripts/reserve-spec-id.ts`. */
export function fakeRepo(root: string, name: string, opts: { tools?: boolean } = {}): FakeRepo {
  const dir = path.join(root, name);
  fs.mkdirSync(path.join(dir, "scripts"), { recursive: true });
  fs.mkdirSync(path.join(dir, "specs"), { recursive: true });
  spawnSync("git", ["init", "-q", "-b", "main"], { cwd: dir });
  const log = path.join(dir, ".calls");
  if (opts.tools !== false) {
    fs.writeFileSync(
      path.join(dir, "scripts", "ticket-pickup.ts"),
      `const fs = process.getBuiltinModule("node:fs");
fs.appendFileSync(${JSON.stringify(log)}, "ticket-pickup " + process.argv.slice(2).join(" ") + "\\n");
let code = 0;
try { code = Number(fs.readFileSync(".pickup-exit", "utf8")); } catch {}
if (code !== 0) process.stderr.write("ticket-pickup #1: the ticket belongs to someone else\\n");
process.exit(code);
`,
    );
    fs.writeFileSync(
      path.join(dir, "scripts", "reserve-spec-id.ts"),
      `const fs = process.getBuiltinModule("node:fs");
fs.appendFileSync(${JSON.stringify(log)}, "reserve-spec-id " + process.argv.slice(2).join(" ") + "\\n");
let id = "0500", code = 0;
try { [id, code] = fs.readFileSync(".reserve", "utf8").trim().split(" ").map((v, i) => (i === 1 ? Number(v) : v)) as [string, number]; } catch {}
if (code === 1) { process.stderr.write("reserve-spec-id: failure\\n"); process.exit(1); }
console.log(id);
if (code === 3) console.log("unsecured-id: true");
process.exit(code);
`,
    );
  }
  return {
    dir,
    pickup: (exit) => fs.writeFileSync(path.join(dir, ".pickup-exit"), String(exit)),
    reserve: (id, exit = 0) => fs.writeFileSync(path.join(dir, ".reserve"), `${id} ${exit}`),
    calls: () => {
      try {
        return fs
          .readFileSync(log, "utf8")
          .split("\n")
          .filter((l) => l !== "");
      } catch {
        return [];
      }
    },
  };
}
