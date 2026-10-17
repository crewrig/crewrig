// mempalace-pin-rig.ts — shared rig of the mempalace-pin-*.test.ts suites
// (spec 0263, PR E). Drives scripts/lib/mempalace_pin.py through its CLI and through the
// committed Python drivers under scripts/tests/fixtures/mempalace-pin/ (stored with a
// `.golden` suffix so the Python ratchet does not count them, materialised as `.py`
// into one scratch root). No pin literal is authored here: both bounds are read from
// scripts/lib/common.sh with an independent two-line regex, never through the TypeScript
// reader, so the guard test keeps its independence from it.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
export const LIB_DIR = path.join(REPO, "scripts", "lib");
export const PIN_MODULE = path.join(LIB_DIR, "mempalace_pin.py");
export const COMMON_SH = path.join(LIB_DIR, "common.sh");
export const PYTHON_BIN = process.env.CREWRIG_TEST_PYTHON ?? "python3";
const FIXTURES = path.join(REPO, "scripts", "tests", "fixtures", "mempalace-pin");

export interface Pin {
  readonly min: string;
  readonly max: string;
}

/** Reads both bounds of the pin from a common.sh, independently of the TS reader. */
export function readPin(commonSh: string = COMMON_SH): Pin {
  const text = fs.readFileSync(commonSh, "utf8");
  const min = /^MEMPALACE_MIN_VERSION="([^"]*)"$/m.exec(text)?.[1];
  const max = /^MEMPALACE_MAX_VERSION_EXCLUSIVE="([^"]*)"$/m.exec(text)?.[1];
  if (min === undefined || max === undefined || min === "" || max === "")
    throw new Error(`could not read the pin from ${commonSh}`);
  return { min, max };
}

export interface Rig {
  readonly root: string;
  readonly shield: string;
  readonly provider: string;
  readonly home: string;
  driver(name: string): string;
  cleanup(): void;
}

/** Materialises the `.golden` fixtures as `.py` files under one scratch root. */
export function makeRig(): Rig {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "mempalace-pin-")));
  const materialise = (rel: string): void => {
    const dest = path.join(root, rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(path.join(FIXTURES, `${rel}.golden`), dest);
  };
  for (const stub of ["shield", "provider"]) {
    materialise(`${stub}/packaging/version.py`);
    fs.writeFileSync(path.join(root, stub, "packaging", "__init__.py"), "");
  }
  for (const name of ["verdict_rows.py", "corpus_driver.py", "import_safety.py"]) materialise(name);
  const home = path.join(root, "home");
  fs.mkdirSync(home);
  return {
    root,
    shield: path.join(root, "shield"),
    provider: path.join(root, "provider"),
    home,
    driver: (name) => path.join(root, name),
    cleanup: () => fs.rmSync(root, { recursive: true, force: true }),
  };
}

export interface Result {
  readonly rc: number;
  /** stdout and stderr merged in that order. */
  readonly out: string;
}

function scratchEnv(home: string, pythonpath: string | undefined): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const key of ["PYTHONPATH", "PYTHONHOME", "PYTHONSTARTUP"]) delete env[key];
  env.HOME = home;
  env.USERPROFILE = home;
  env.PYTHONDONTWRITEBYTECODE = "1";
  if (pythonpath !== undefined) env.PYTHONPATH = pythonpath;
  return env;
}

export function runPython(
  rig: Rig,
  python: string,
  args: readonly string[],
  pythonpath?: string,
): Result {
  const res = spawnSync(python, [...args], {
    env: scratchEnv(rig.home, pythonpath),
    encoding: "utf8",
    timeout: 60_000,
  });
  return { rc: res.status ?? -1, out: `${res.stdout}${res.stderr}`.trimEnd() };
}

export interface CheckOptions {
  readonly pythonpath?: string;
  readonly python?: string;
  readonly commonSh?: string;
}

/** `mempalace_pin.py --common-sh <path> --check <version>`. */
export function checkVersion(rig: Rig, version: string, options: CheckOptions = {}): Result {
  return runPython(
    rig,
    options.python ?? PYTHON_BIN,
    [PIN_MODULE, "--common-sh", options.commonSh ?? COMMON_SH, "--check", version],
    options.pythonpath,
  );
}

/** `mempalace_pin.py --common-sh <path> --print-pin`. */
export function printPin(rig: Rig, commonSh: string): Result {
  return runPython(rig, PYTHON_BIN, [PIN_MODULE, "--common-sh", commonSh, "--print-pin"]);
}

/** Runs one committed driver; `args` are the driver's own argv after the script. */
export function runDriver(
  rig: Rig,
  name: string,
  args: readonly string[],
  options: { readonly pythonpath?: string; readonly python?: string } = {},
): Result {
  return runPython(
    rig,
    options.python ?? PYTHON_BIN,
    [rig.driver(name), ...args],
    options.pythonpath,
  );
}

function canImportPackaging(rig: Rig, python: string): boolean {
  return runPython(rig, python, ["-c", "import packaging.version"]).rc === 0;
}

/**
 * An interpreter that can import the REAL `packaging`: the primary interpreter first,
 * then the one the framework's own detector returns (POSIX only). Undefined when none.
 */
export function findPackagingPython(rig: Rig): string | undefined {
  if (canImportPackaging(rig, PYTHON_BIN)) return PYTHON_BIN;
  if (process.platform === "win32") return undefined;
  const res = spawnSync("bash", ["-c", `. "${COMMON_SH}"; detect_mempalace_python`], {
    env: scratchEnv(rig.home, undefined),
    encoding: "utf8",
    timeout: 60_000,
  });
  const detected = res.stdout.trim();
  return detected !== "" && canImportPackaging(rig, detected) ? detected : undefined;
}

export const PACKAGING_HINT =
  "no interpreter here can import the real `packaging`, so the primary comparator was never exercised against the real library " +
  "(install it: python3 -m pip install packaging, or make CREWRIG_TEST_PYTHON an interpreter that carries it)";
