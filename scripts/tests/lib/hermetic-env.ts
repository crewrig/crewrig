// hermetic-env.ts — the shared hermetic harness for the spec 0253 oracle and
// port tests (PLAN v3, "Hermetic harness" v1-F1). It builds the child
// environment of a script that could otherwise reach a real MemPalace or a
// real Python: a temp HOME, no PIPX_HOME / XDG_DATA_HOME, and a PATH made of
// ONE temp `bin` directory holding the run's stubs plus symlinks to the real
// executables of a fixed coreutil set. The directory of `process.execPath` is
// deliberately NOT on PATH (a Homebrew `bin` also holds `pipx`).
//
// Executables are located by scanning the real PATH with fs, never with
// `command -v`, which prints a bare word when `find`/`grep` is a shell
// function or alias. MEMPALACE_PYTHON is a POISON executable (it appends
// `POISON-HIT` to a marker file and exits 99) unless the caller overrides it.
// POSIX only: createHermeticEnv throws on win32, the module stays importable.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/** The union of the tools the import, prune and sync scripts need (PLAN v3). */
const TOOLS: readonly string[] = (
  "bash dirname find wc tr xargs du tail awk head basename uname grep sed cut cat " +
  "mktemp ln cp rm mkdir chmod readlink date id sleep env"
).split(" ");

export interface HermeticEnv {
  readonly root: string;
  readonly home: string;
  readonly bin: string;
  readonly env: NodeJS.ProcessEnv;
  readonly poisonFile: string;
  dispose(): void;
}

export interface RunResult {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

/** First executable regular file named `name` on `dirs`, as an absolute path. */
function lookup(name: string, dirs: readonly string[]): string | undefined {
  for (const dir of dirs) {
    if (!path.isAbsolute(dir)) continue;
    const candidate = path.join(dir, name);
    try {
      if (!fs.statSync(candidate).isFile()) continue;
      fs.accessSync(candidate, fs.constants.X_OK);
      return candidate;
    } catch {
      // not here, keep scanning
    }
  }
  return undefined;
}

function link(target: string, bin: string, name: string): void {
  fs.symlinkSync(target, path.join(bin, name));
}

/** Create the harness. `poisonPython` (default true) sets MEMPALACE_PYTHON to the poison executable. */
export function createHermeticEnv(options: { poisonPython?: boolean } = {}): HermeticEnv {
  if (process.platform === "win32") {
    throw new Error("hermetic-env: POSIX only; the Windows tests use their own PowerShell harness");
  }
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "crewrig-hermetic-")));
  const home = path.join(root, "home");
  const bin = path.join(root, "bin");
  fs.mkdirSync(home);
  fs.mkdirSync(bin);

  const dirs = [...(process.env["PATH"] ?? "").split(path.delimiter), "/usr/bin", "/bin"];
  for (const tool of TOOLS) {
    const found = lookup(tool, dirs);
    if (found !== undefined) link(found, bin, tool);
    else if (tool === "bash") {
      fs.rmSync(root, { recursive: true, force: true });
      throw new Error("hermetic-env: no executable bash found on PATH, /usr/bin or /bin");
    }
  }
  link(process.execPath, bin, "node");

  const poisonFile = path.join(root, "poison-hit");
  const env: NodeJS.ProcessEnv = { HOME: home, USERPROFILE: home, PATH: bin };
  if (options.poisonPython !== false) {
    const poison = path.join(root, "poison", "python");
    fs.mkdirSync(path.dirname(poison));
    fs.writeFileSync(poison, `#!/bin/sh\necho POISON-HIT >> '${poisonFile}'\nexit 99\n`, {
      mode: 0o755,
    });
    env["MEMPALACE_PYTHON"] = poison;
  }
  return {
    root,
    home,
    bin,
    env,
    poisonFile,
    dispose: () => fs.rmSync(root, { recursive: true, force: true }),
  };
}

/** Write an executable `#!/bin/sh` stub named `name` into `h.bin`; returns its path. */
export function writeStub(h: HermeticEnv, name: string, body: string): string {
  if (name === "" || name !== path.basename(name)) {
    throw new Error(
      `hermetic-env: stub name must be a bare file name, got ${JSON.stringify(name)}`,
    );
  }
  const file = path.join(h.bin, name);
  fs.rmSync(file, { force: true }); // replace a harness symlink instead of writing through it
  fs.writeFileSync(file, `#!/bin/sh\n${body}`, { mode: 0o755 });
  return file;
}

/** Run `script` with the harness `bash` (absolute path), `args`, and `h.env` overlaid with `options.env`. */
export function runBash(
  h: HermeticEnv,
  script: string,
  args: readonly string[],
  options: {
    input?: string;
    env?: Readonly<Record<string, string | undefined>>;
    cwd?: string;
  } = {},
): RunResult {
  const env: NodeJS.ProcessEnv = { ...h.env };
  for (const [key, value] of Object.entries(options.env ?? {})) {
    if (value === undefined) delete env[key];
    else env[key] = value;
  }
  const res = spawnSync(path.join(h.bin, "bash"), [script, ...args], {
    encoding: "utf8",
    env,
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    ...(options.input === undefined ? {} : { input: options.input }),
  });
  return { status: res.status, stdout: res.stdout, stderr: res.stderr };
}

/** True when the poison executable ran (its marker file exists). */
export function poisonHit(h: HermeticEnv): boolean {
  return fs.existsSync(h.poisonFile);
}
