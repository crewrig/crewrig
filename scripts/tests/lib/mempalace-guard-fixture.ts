// mempalace-guard-fixture.ts — shared fixture for the launch-time MemPalace
// version-guard tests (spec 0108 R1-R6, spec 0263 row E): per-test fixture trees
// holding COPIES of the real wrapper, mempalace_pin.py and common.sh, plus stub
// `chromadb` and `mempalace` packages and a fake dist-info on PYTHONPATH, so a
// full launch is drivable with no venv, no network and no MemPalace installed.
//
// One fresh tree per test: Python's .pyc invalidation keys on (mtime-seconds,
// size), so two same-size rewrites inside one second would serve a stale module.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
export const LIB_DIR = path.join(REPO, "scripts", "lib");
export const WRAPPER = path.join(LIB_DIR, "mempalace-http-wrapper.py");
export const PIN_MODULE = path.join(LIB_DIR, "mempalace_pin.py");
export const COMMON_SH = path.join(LIB_DIR, "common.sh");
export const SENTINEL = "MEMPALACE_STUB_IS_SERVING";
export const BELOW_FLOOR = "3.3.5";
export const PYTHON_BIN =
  process.env.CREWRIG_TEST_PYTHON ?? (process.platform === "win32" ? "python" : "python3");

export interface Pin {
  min: string;
  max: string;
}

/** Reads both bounds from common.sh with an independent regex (not the TS reader). */
export function readPin(commonSh: string): Pin {
  const text = fs.readFileSync(commonSh, "utf8");
  const min = /^MEMPALACE_MIN_VERSION="([^"]*)"$/m.exec(text)?.[1];
  const max = /^MEMPALACE_MAX_VERSION_EXCLUSIVE="([^"]*)"$/m.exec(text)?.[1];
  assert.ok(min && max, `could not read the pin from ${commonSh}`);
  return { min, max };
}

export const PIN = readPin(COMMON_SH);
export const EXPECTED_RANGE = `>=${PIN.min},<${PIN.max}`;
export const EXPECTED_REMEDY = `pipx install --force 'mempalace>=${PIN.min},<${PIN.max}'`;

const scratch: string[] = [];
export function cleanupScratch(): void {
  for (const dir of scratch) fs.rmSync(dir, { recursive: true, force: true });
}

const SCRATCH_ROOT = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "mp-guard-")));
scratch.push(SCRATCH_ROOT);
let counter = 0;

/** Absolute path of the interpreter, resolved on the real PATH. */
export function pythonAbsolute(): string {
  if (path.isAbsolute(PYTHON_BIN)) return PYTHON_BIN;
  const exts = process.platform === "win32" ? [".exe", ""] : [""];
  for (const dir of (process.env.PATH ?? "").split(path.delimiter)) {
    for (const ext of exts) {
      const candidate = path.join(dir, PYTHON_BIN + ext);
      if (dir && fs.existsSync(candidate)) return candidate;
    }
  }
  return PYTHON_BIN;
}

export function interpreterAvailable(): boolean {
  return spawnSync(PYTHON_BIN, ["-c", "pass"], { stdio: "ignore" }).status === 0;
}

/** `packaging.version` importable under this interpreter decides the comparator. */
export function expectedComparator(): string {
  const probe = spawnSync(PYTHON_BIN, ["-c", "import packaging.version"], { stdio: "ignore" });
  return probe.status === 0 ? "packaging" : "stdlib-whitelist";
}

const CHROMADB_STUB = `"""Minimal chromadb stand-in: enough surface for the wrapper's patch + probe."""


class Settings:
    def __init__(self, **kwargs):
        self.kwargs = kwargs


class _Client:
    def heartbeat(self):
        return 1


def HttpClient(host=None, port=None, settings=None, **kwargs):
    return _Client()


def PersistentClient(path=None, settings=None, **kwargs):
    return _Client()
`;

// Mirrors upstream's own shape: the real channel is captured and stdout is
// swapped to stderr at IMPORT time and restored only inside main().
const MCP_SERVER_STUB = `import sys

_REAL_STDOUT = sys.stdout
sys.stdout = sys.stderr


def main():
    sys.stdout = _REAL_STDOUT
    print("${SENTINEL}")
`;

const MCP_SERVER_PROBE = `import sys

_REAL_STDOUT = sys.stdout
sys.stdout = sys.stderr


def main():
    sys.stdout = _REAL_STDOUT
    try:
        import crewrig_syspath_probe  # noqa: F401
    except ImportError:
        print("${SENTINEL}")
    else:
        print("LIB_DIR_STILL_ON_SYS_PATH")
`;

export interface FixtureOptions {
  name: string;
  /** dist-info version, or null for no dist-info at all. */
  dist: string | null;
  /** mempalace.__version__, or null for an empty package. */
  attr: string | null;
  /** Make `packaging.version` raise ImportError, first on PYTHONPATH. */
  shield?: boolean;
  /** Plant a module importable only from the wrapper's own directory. */
  probe?: boolean;
}

export function buildFixture(o: FixtureOptions): string {
  counter += 1;
  const root = path.join(SCRATCH_ROOT, `${String(counter)}-${o.name}`);
  const site = path.join(root, "site");
  fs.mkdirSync(path.join(root, "lib"), { recursive: true });
  fs.mkdirSync(path.join(site, "mempalace"), { recursive: true });
  fs.mkdirSync(path.join(site, "chromadb"), { recursive: true });
  fs.copyFileSync(WRAPPER, path.join(root, "lib", "mempalace-http-wrapper.py"));
  fs.copyFileSync(PIN_MODULE, path.join(root, "lib", "mempalace_pin.py"));
  fs.copyFileSync(COMMON_SH, path.join(root, "lib", "common.sh"));
  fs.writeFileSync(path.join(site, "chromadb", "__init__.py"), CHROMADB_STUB);
  const init = o.attr === null ? "" : `__version__ = "${o.attr}"\n`;
  fs.writeFileSync(path.join(site, "mempalace", "__init__.py"), init);
  fs.writeFileSync(
    path.join(site, "mempalace", "mcp_server.py"),
    o.probe ? MCP_SERVER_PROBE : MCP_SERVER_STUB,
  );
  if (o.probe) {
    fs.writeFileSync(
      path.join(root, "lib", "crewrig_syspath_probe.py"),
      'MARKER = "crewrig-syspath-probe"\n',
    );
  }
  if (o.dist !== null) {
    const info = path.join(site, `mempalace-${o.dist}.dist-info`);
    fs.mkdirSync(info);
    fs.writeFileSync(
      path.join(info, "METADATA"),
      `Metadata-Version: 2.1\nName: mempalace\nVersion: ${o.dist}\n`,
    );
  }
  if (o.shield) {
    const dir = path.join(root, "shield", "packaging");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "__init__.py"), "");
    fs.writeFileSync(
      path.join(dir, "version.py"),
      'raise ImportError("shielded by mempalace-runtime-guard tests")\n',
    );
  }
  return root;
}

export interface GuardRun {
  rc: number;
  stdout: string;
  stderr: string;
  executable: string;
}

export interface RunOptions {
  flags?: string[];
  /** Replaces the whole child env (HOME etc. are still scratch). */
  env?: NodeJS.ProcessEnv;
  python?: string;
}

/** Runs the fixture's wrapper; `executable` is this launch's own `sys.executable`. */
export function runGuard(root: string, o: RunOptions = {}): GuardRun {
  const flags = o.flags ?? [];
  const python = o.python ?? PYTHON_BIN;
  const exe = spawnSync(python, [...flags, "-c", "import sys; print(sys.executable)"], {
    encoding: "utf8",
  });
  const shield = path.join(root, "shield");
  const pythonpath = [fs.existsSync(shield) ? shield : "", path.join(root, "site")]
    .filter(Boolean)
    .join(path.delimiter);
  const home = path.join(root, "home");
  fs.mkdirSync(home, { recursive: true });
  const base: NodeJS.ProcessEnv = o.env ?? { ...process.env };
  const env: NodeJS.ProcessEnv = {
    ...base,
    HOME: home,
    USERPROFILE: home,
    PYTHONPATH: pythonpath,
    PYTHONDONTWRITEBYTECODE: "1",
  };
  const r = spawnSync(python, [...flags, path.join(root, "lib", "mempalace-http-wrapper.py")], {
    encoding: "utf8",
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  return { rc: r.status ?? -1, stdout: r.stdout, stderr: r.stderr, executable: exe.stdout.trim() };
}

/** One R3 diagnostic line exactly as `_refuse` formats it (`"  {0:<26}{1}"`). */
export function fieldLine(label: string, value: string): string {
  return `  ${label.padEnd(26)}${value}`;
}

export function hasLine(stderr: string, line: string): boolean {
  return stderr.split("\n").includes(line);
}

/** Every refusal carries R3's four fields, the comparator and R4's sentence, as whole lines. */
export function assertRefusalFields(
  run: GuardRun,
  version: string,
  source: string,
  comparator: string,
): void {
  const { stdout, stderr } = run;
  assert.equal(stdout, "", "stdout must stay empty on a refusal");
  const want = (label: string, value: string): void =>
    assert.ok(
      hasLine(stderr, fieldLine(label, value)),
      `missing '${label}' = '${value}' in:\n${stderr}`,
    );
  want("MemPalace version found:", `${version}  (source: ${source})`);
  want("Supported range:", EXPECTED_RANGE);
  want("Resolved interpreter:", run.executable);
  want("To bring into range:", EXPECTED_REMEDY);
  want("Comparator:", comparator);
  assert.ok(stderr.includes("must be restarted"), "R4 restart sentence missing");
  assert.ok(!stderr.includes("Traceback (most recent call last)"), "traceback leaked");
}
