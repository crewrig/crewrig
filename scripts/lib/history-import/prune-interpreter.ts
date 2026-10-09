// prune-interpreter.ts — which interpreter runs prune_drawers.py (spec 0253 R18): the
// `MEMPALACE_PYTHON` override, else the pipx `mempalace` virtual environment when `pipx` is on
// PATH, else the system Python; plus the `command -v` check of the chosen candidate. Windows
// names are `Scripts\python.exe` and `python` (delta-01 R25 item 7); POSIX is unchanged.

import path from "node:path";

export interface PathIo {
  /** The path exists (file or directory). */
  readonly exists: (p: string) => boolean;
  /** The path is a file the caller may execute. */
  readonly isExecutableFile: (p: string) => boolean;
}

export interface InterpreterIo extends PathIo {
  /** `pipx environment --value PIPX_HOME` standard output, trimmed; undefined when pipx cannot answer. */
  readonly pipxHome: () => string | undefined;
}

function pathApi(platform: NodeJS.Platform): path.PlatformPath {
  return platform === "win32" ? path.win32 : path.posix;
}

function envValue(env: NodeJS.ProcessEnv, name: string, platform: NodeJS.Platform): string {
  if (platform !== "win32") return env[name] ?? "";
  const key = Object.keys(env).find((k) => k.toUpperCase() === name.toUpperCase());
  return key === undefined ? "" : (env[key] ?? "");
}

/** Every file name `name` may carry on disk: itself, plus each PATHEXT extension on Windows. */
function fileNames(name: string, env: NodeJS.ProcessEnv, platform: NodeJS.Platform): string[] {
  if (platform !== "win32") return [name];
  const exts = (envValue(env, "PATHEXT", platform) || ".COM;.EXE;.BAT;.CMD")
    .split(";")
    .filter((e) => e !== "");
  return [name, ...exts.map((e) => name + e)];
}

/** The first file named `name` on PATH that `test` accepts, or undefined. */
function onPath(
  name: string,
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
  test: (p: string) => boolean,
): string | undefined {
  const p = pathApi(platform);
  const delimiter = platform === "win32" ? ";" : ":";
  for (const dir of envValue(env, "PATH", platform).split(delimiter)) {
    if (dir === "") continue;
    for (const file of fileNames(name, env, platform)) {
      const candidate = p.join(dir, file);
      if (test(candidate)) return candidate;
    }
  }
  return undefined;
}

/** The interpreter to run, by the R18 order. */
export function resolveInterpreter(
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
  io: InterpreterIo,
): string {
  const override = env["MEMPALACE_PYTHON"];
  if (override !== undefined && override !== "") return override;
  const win = platform === "win32";
  if (onPath("pipx", env, platform, io.exists) !== undefined) {
    const home = io.pipxHome();
    if (home !== undefined && home !== "") {
      const p = pathApi(platform);
      const venv = p.join(home, "venvs", "mempalace");
      if (io.exists(venv))
        return win ? p.join(venv, "Scripts", "python.exe") : `${venv}/bin/python3`;
    }
  }
  return win ? "python" : "python3";
}

/** `command -v "$candidate"`: a path must be an executable file, a bare name is looked up on PATH. */
export function interpreterExists(
  candidate: string,
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
  io: PathIo,
): boolean {
  const hasSeparator =
    candidate.includes("/") || (platform === "win32" && candidate.includes("\\"));
  if (hasSeparator) {
    return fileNames(candidate, env, platform).some((f) => io.isExecutableFile(f));
  }
  return onPath(candidate, env, platform, io.isExecutableFile) !== undefined;
}
