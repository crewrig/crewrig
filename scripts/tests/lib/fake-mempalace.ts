// fake-mempalace.ts — a FAKE `mempalace` Python package for the history-import tests (spec 0253
// R27, the `windows-history-import` job). Node cannot spawn a `.cmd` stub without a shell, so the
// tests run the runner's REAL Python with this package on PYTHONPATH instead. The package answers
// `python -m mempalace mine ...` (logs argv and cwd) and offers `mcp_server.tool_list_drawers` /
// `tool_delete_drawer` (the two calls prune_drawers.py makes). Nothing here uses a shell.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

export interface FakeMempalace {
  /** The directory to put on PYTHONPATH. */
  readonly dir: string;
  /** The JSON-lines file the fake appends to (`MEMPALACE_FAKE_LOG`). */
  readonly logFile: string;
}

const MAIN_PY = `import json
import os
import sys

with open(os.environ["MEMPALACE_FAKE_LOG"], "a", encoding="utf-8") as log:
    log.write(json.dumps({"argv": sys.argv[1:], "cwd": os.getcwd()}) + "\\n")
sys.exit(int(os.environ.get("MEMPALACE_FAKE_EXIT", "0")))
`;

const MCP_SERVER_PY = `import json
import os


def tool_list_drawers(wing, limit, offset):
    path = os.environ.get("MEMPALACE_FAKE_DRAWERS", "")
    drawers = []
    if path:
        with open(path, "r", encoding="utf-8") as handle:
            text = handle.read().strip()
        drawers = json.loads(text) if text else []
    page = drawers[offset:offset + limit]
    return {"drawers": page, "count": len(page), "offset": offset, "limit": limit}


def tool_delete_drawer(drawer_id):
    with open(os.environ["MEMPALACE_FAKE_LOG"], "a", encoding="utf-8") as log:
        log.write(json.dumps({"deleted": drawer_id}) + "\\n")
    return {"success": True}
`;

/** Write the fake package under `root` and return where it lives. */
export function createFakeMempalace(root: string): FakeMempalace {
  const dir = path.join(root, "fake-python-path");
  const pkg = path.join(dir, "mempalace");
  fs.mkdirSync(pkg, { recursive: true });
  fs.writeFileSync(path.join(pkg, "__init__.py"), "");
  fs.writeFileSync(path.join(pkg, "__main__.py"), MAIN_PY);
  fs.writeFileSync(path.join(pkg, "mcp_server.py"), MCP_SERVER_PY);
  return { dir, logFile: path.join(root, "fake-mempalace.log") };
}

const isWindows = process.platform === "win32";

function pathKey(): string | undefined {
  return Object.keys(process.env).find((k) =>
    isWindows ? k.toLowerCase() === "path" : k === "PATH",
  );
}

function isFile(p: string): boolean {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

/** Every file name `name` can carry in a PATH directory: itself, plus each PATHEXT extension on Windows. */
function fileNames(name: string): string[] {
  if (!isWindows) return [name];
  const exts = (process.env["PATHEXT"] || ".COM;.EXE;.BAT;.CMD").split(";").filter((e) => e !== "");
  return ["", ...exts].map((e) => name + e);
}

/** The first directory entry of the real PATH where `name` is a file. */
function firstOnPath(name: string, dirs: readonly string[]): string | undefined {
  for (const dir of dirs) {
    for (const file of fileNames(name)) {
      const candidate = path.join(dir, file);
      if (isFile(candidate)) return candidate;
    }
  }
  return undefined;
}

/** A real, working Python on the PATH (`python3` then `python`; Windows: `python`), or undefined. */
export function findPython(): string | undefined {
  const key = pathKey();
  const dirs = (key === undefined ? "" : (process.env[key] ?? ""))
    .split(path.delimiter)
    .filter((d) => d !== "");
  // The test PATH is ONLY this directory: one holding a `mempalace` script or `pipx` would
  // let the probe find a real installation instead of the fake.
  const clean = dirs.filter(
    (d) => firstOnPath("mempalace", [d]) === undefined && firstOnPath("pipx", [d]) === undefined,
  );
  for (const name of isWindows ? ["python"] : ["python3", "python"]) {
    for (const dir of clean) {
      const found = firstOnPath(name, [dir]);
      if (found === undefined) continue;
      const probe = spawnSync(found, ["-c", "import sys"], { stdio: "ignore", windowsHide: true });
      if (probe.status === 0) return found;
    }
  }
  return undefined;
}

export interface FakeEnvOptions {
  /** A temporary directory used as HOME and for the platform's per-user directories. */
  readonly home: string;
  readonly fake: FakeMempalace;
  /** The directory that is the whole PATH; defaults to the one holding the found Python. */
  readonly pathDir?: string;
  /** Exit status of the fake `mine` (`MEMPALACE_FAKE_EXIT`). */
  readonly exit?: number;
  /** JSON file holding the drawers the fake lists (`MEMPALACE_FAKE_DRAWERS`). */
  readonly drawers?: string;
  readonly extra?: Readonly<Record<string, string>>;
}

/** The explicit child environment: nothing is inherited, no pipx and no `mempalace` anywhere. */
export function fakeEnv(opts: FakeEnvOptions): NodeJS.ProcessEnv {
  const python = findPython();
  const pathDir = opts.pathDir ?? (python === undefined ? "" : path.dirname(python));
  const env: NodeJS.ProcessEnv = {
    HOME: opts.home,
    USERPROFILE: opts.home,
    LOCALAPPDATA: path.join(opts.home, "AppData", "Local"),
    APPDATA: path.join(opts.home, "AppData", "Roaming"),
    XDG_CONFIG_HOME: path.join(opts.home, ".config"),
    XDG_DATA_HOME: path.join(opts.home, ".local", "share"),
    XDG_CACHE_HOME: path.join(opts.home, ".cache"),
    PATH: pathDir,
    PYTHONPATH: opts.fake.dir,
    PYTHONIOENCODING: "utf-8",
    MEMPALACE_FAKE_LOG: opts.fake.logFile,
    MEMPALACE_FAKE_EXIT: String(opts.exit ?? 0),
    MEMPALACE_FAKE_DRAWERS: opts.drawers ?? "",
    ...opts.extra,
  };
  if (isWindows) {
    // Python and node need these to start; none of them puts an interpreter on the PATH.
    for (const name of ["SystemRoot", "windir", "TEMP", "TMP"]) {
      const value = process.env[name];
      if (value !== undefined) env[name] = value;
    }
  }
  return env;
}
