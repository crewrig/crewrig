// doctor-machine.ts — fabricates a machine for the MemPalace doctor tests (spec 0263, PR E;
// ports the fixture builders of the retired test-mempalace-doctor.sh). POSIX only: the
// interpreters are `#!/bin/sh` shims and the console scripts are shebang text, so importers
// must skip on win32.
//
// STABLE API (importers: mempalace-doctor-divergence/report/launch/shell-wrappers tests):
//
//   Constants   REPO, POSIX, OLD_VERSION ("3.0.0"), PIN (read from scripts/lib/common.sh
//               through scripts/lib/mempalace-pin.ts: {min, maxExclusive}), GOOD_VERSION
//               (= PIN.min), SECOND_GOOD_VERSION (= `${PIN.min}.1`, inside the pin),
//               PYTHON_ABS (absolute python3, or CREWRIG_TEST_PYTHON resolved; throws if
//               none: a missing interpreter FAILS, never skips), COMPARATOR /
//               HAS_PACKAGING (what PYTHON_ABS answers for the doctor's verdict lines),
//               WRAPPER, PIN_MODULE, COMMON_SH, TLS_EXEC (paths in the repository).
//   Scratch     scratchDir(label): real-path mkdtemp dir (fs.realpathSync).
//               freePortSync(): an OS-assigned loopback port nothing listens on.
//   Builders    makeFakesite(dir, version, attr = version)      fake dist-info + package
//               makeInterpreter(file, siteDir)                  sh shim over PYTHON_ABS
//               makeAbsentInterpreter(file)                     shim resolving no mempalace
//               makeCheckout(dir)                               wrapper + common.sh + pin module
//               rewriteMaxPin(checkoutDir, value)               alternate ceiling in common.sh
//               makeConsoleScript(file, interpreter)            `#!<interpreter>` text only
//               makeToolbin(dir)                                symlinks of the externals the
//                                                               doctor needs (never jq/curl)
//               writeRegBash / writeRegDirect(file, py, wrapper), writeRegUnguarded(file, py)
//   Runners     runDoctor(home, pathDir, extra?)                PATH = pathDir:<real PATH>
//               runDoctorIsolated(home, pathDir, toolbin, extra?)  PATH = pathDir:toolbin
//               Both run `/bin/bash scripts/doctor-mempalace.sh` (the shim) with HOME and
//               USERPROFILE = home, MEMPALACE_MCP_PORT = a free port,
//               CREWRIG_TEST_SERVICE_BIN_DIR = an empty dir, PIPX_HOME / XDG_DATA_HOME /
//               MEMPALACE_* / CI / proxies / NODE_TEST_CONTEXT deleted; `extra` overrides the
//               env last (a value of undefined deletes the key). Return {rc, out} where out
//               is stdout + stderr.
//   Assertions  fieldLine(label, value)   `    ` + label padded to 24 + value
//               hasLine(out, line)        whole-line match
//               assertNoShellInterpreter(out)   the three shell-never-reported regexes
//               pipxCandidate(home)       platform default pipx python under `home`
//               probeDist(py)             `dist=` of `mempalace_pin.py --probe` under `py`

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readMempalacePin } from "../../lib/mempalace-pin.ts";

export const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
export const POSIX = process.platform !== "win32";
export const WRAPPER = path.join(REPO, "scripts", "lib", "mempalace-http-wrapper.py");
export const PIN_MODULE = path.join(REPO, "scripts", "lib", "mempalace_pin.py");
export const COMMON_SH = path.join(REPO, "scripts", "lib", "common.sh");
export const TLS_EXEC = path.join(REPO, "scripts", "lib", "tls-exec.sh");
const DOCTOR = path.join(REPO, "scripts", "doctor-mempalace.sh");

export const PIN = readMempalacePin(REPO);
export const OLD_VERSION = "3.0.0";
export const GOOD_VERSION = PIN.min;
export const SECOND_GOOD_VERSION = `${PIN.min}.1`;

function resolveOnPath(name: string): string | null {
  if (name.includes("/")) return fs.existsSync(name) ? path.resolve(name) : null;
  for (const dir of (process.env["PATH"] ?? "").split(path.delimiter)) {
    const candidate = path.join(dir, name);
    if (dir !== "" && fs.existsSync(candidate)) return candidate;
  }
  return null;
}

const wanted = process.env["CREWRIG_TEST_PYTHON"] ?? "python3";
const resolved = POSIX ? resolveOnPath(wanted) : null;
if (POSIX && resolved === null) throw new Error(`interpreter not found: ${wanted}`);
/** Absolute interpreter: a relative one would loop on a shim named `python3`. */
export const PYTHON_ABS: string = resolved ?? "";

const hasPackaging =
  POSIX &&
  spawnSync(PYTHON_ABS, ["-c", "import packaging.version"], { stdio: "ignore" }).status === 0;
export const HAS_PACKAGING = hasPackaging ? "yes" : "no";
export const COMPARATOR = hasPackaging ? "packaging" : "stdlib-whitelist";

export function scratchDir(label: string): string {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), `doctor-${label}-`)));
}

export function freePortSync(): number {
  const code =
    "const s=require('node:net').createServer();" +
    "s.listen(0,'127.0.0.1',()=>{console.log(s.address().port);s.close();});";
  const r = spawnSync(process.execPath, ["-e", code], { encoding: "utf8" });
  const port = Number(r.stdout.trim());
  if (!Number.isInteger(port) || port <= 0) throw new Error(`no free port: ${r.stderr}`);
  return port;
}

function writeExecutable(file: string, text: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
  fs.chmodSync(file, 0o755);
}

/** Fake `mempalace-<version>.dist-info` and a package whose `__version__` is `attr`. */
export function makeFakesite(dir: string, version: string, attr: string = version): void {
  const dist = path.join(dir, `mempalace-${version}.dist-info`);
  fs.mkdirSync(path.join(dir, "mempalace"), { recursive: true });
  fs.mkdirSync(dist, { recursive: true });
  fs.writeFileSync(path.join(dir, "mempalace", "__init__.py"), `__version__ = "${attr}"\n`);
  fs.writeFileSync(path.join(dir, "mempalace", "mcp_server.py"), "def main():\n    return None\n");
  fs.writeFileSync(
    path.join(dist, "METADATA"),
    `Metadata-Version: 2.1\nName: mempalace\nVersion: ${version}\n`,
  );
}

/** An "interpreter": a shim that execs PYTHON_ABS with PYTHONPATH on one fake site. */
export function makeInterpreter(file: string, site: string): void {
  writeExecutable(
    file,
    `#!/bin/sh\nexec env PYTHONPATH="${site}" PYTHONDONTWRITEBYTECODE=1 "${PYTHON_ABS}" "$@"\n`,
  );
}

/** An interpreter that genuinely resolves no mempalace distribution (`-S`, no PYTHONPATH). */
export function makeAbsentInterpreter(file: string): void {
  writeExecutable(
    file,
    `#!/bin/sh\nexec env -u PYTHONPATH PYTHONDONTWRITEBYTECODE=1 "${PYTHON_ABS}" -S "$@"\n`,
  );
}

/** A fake checkout carrying the wrapper, common.sh and the pin module. */
export function makeCheckout(dir: string): void {
  const lib = path.join(dir, "scripts", "lib");
  fs.mkdirSync(lib, { recursive: true });
  fs.copyFileSync(WRAPPER, path.join(lib, "mempalace-http-wrapper.py"));
  fs.copyFileSync(COMMON_SH, path.join(lib, "common.sh"));
  fs.copyFileSync(PIN_MODULE, path.join(lib, "mempalace_pin.py"));
}

/** Make the checkout declare a different pin ceiling (edits the copied common.sh). */
export function rewriteMaxPin(checkout: string, value: string): void {
  const file = path.join(checkout, "scripts", "lib", "common.sh");
  const text = fs.readFileSync(file, "utf8");
  const next = text.replace(
    /^MEMPALACE_MAX_VERSION_EXCLUSIVE=.*$/m,
    `MEMPALACE_MAX_VERSION_EXCLUSIVE="${value}"`,
  );
  assert.notEqual(next, text, "the copied common.sh declares no ceiling to rewrite");
  fs.writeFileSync(file, next);
}

/** A console script whose SHEBANG names the interpreter: the only part the doctor reads. */
export function makeConsoleScript(file: string, interpreter: string): void {
  writeExecutable(file, `#!${interpreter}\n# fake console script, never executed by the doctor\n`);
}

function writeJson(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value)}\n`);
}

/** `bash tls-exec.sh <py> <wrapper>`: the interpreter sits INSIDE args. */
export function writeRegBash(file: string, py: string, wrapper: string): void {
  const entry = { type: "stdio", command: "bash", args: [TLS_EXEC, py, wrapper] };
  writeJson(file, { mcpServers: { mempalace: entry } });
}

/** `<py> <wrapper>`: the interpreter is `.command`, the wrapper is args[0]. */
export function writeRegDirect(file: string, py: string, wrapper: string): void {
  writeJson(file, { mcpServers: { mempalace: { command: py, args: [wrapper] } } });
}

/** An argv that routes through no wrapper at all. */
export function writeRegUnguarded(file: string, py: string): void {
  const entry = { command: py, args: ["-m", "mempalace.mcp_server"] };
  writeJson(file, { mcpServers: { mempalace: entry } });
}

const TOOLS = ["bash", "sh", "env", "grep", "sed", "head", "cut", "sort", "tr", "wc", "cat"];
TOOLS.push("rm", "mktemp", "dirname", "basename", "readlink", "find", "uname", "node", "python3");

/** Symlink the externals the doctor needs (never jq or curl); existing entries are kept. */
export function makeToolbin(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
  const names = [...TOOLS, path.basename(wanted)];
  for (const tool of names) {
    const target = tool === "node" ? process.execPath : resolveOnPath(tool);
    const link = path.join(dir, tool);
    if (target !== null && !fs.existsSync(link)) fs.symlinkSync(target, link);
  }
}

export interface DoctorRun {
  readonly rc: number;
  readonly out: string;
}

function childEnv(
  home: string,
  emptyBin: string,
  searchPath: string,
  extra: Record<string, string | undefined>,
) {
  const env: Record<string, string | undefined> = { ...process.env };
  for (const key of Object.keys(env)) {
    if (/^(MEMPALACE_|CI$|GITHUB_|GITLAB_|NODE_TEST_CONTEXT$)/.test(key)) delete env[key];
    if (/^(https?|all|no)_proxy$/i.test(key)) delete env[key];
  }
  delete env["PIPX_HOME"];
  delete env["XDG_DATA_HOME"];
  Object.assign(env, {
    HOME: home,
    USERPROFILE: home,
    PATH: searchPath,
    MEMPALACE_MCP_PORT: String(freePortSync()),
    CREWRIG_TEST_SERVICE_BIN_DIR: emptyBin,
  });
  for (const [key, value] of Object.entries(extra)) {
    if (value === undefined) delete env[key];
    else env[key] = value;
  }
  return env;
}

function run(home: string, searchPath: string, extra: Record<string, string | undefined> = {}) {
  // Empty service-binary dir, outside HOME so the HOME manifest of the mutation test is stable.
  const emptyBin = fs.mkdtempSync(path.join(path.dirname(home), "service-bin-"));
  const env = childEnv(home, emptyBin, searchPath, extra);
  const r = spawnSync("/bin/bash", [DOCTOR], { env: env as NodeJS.ProcessEnv, encoding: "utf8" });
  return { rc: r.status ?? -1, out: `${r.stdout}${r.stderr}` };
}

/** PATH is PREPENDED: the fixture's console scripts win, the real tools still resolve. */
export function runDoctor(
  home: string,
  pathDir: string,
  extra?: Record<string, string | undefined>,
) {
  return run(home, `${pathDir}${path.delimiter}${process.env["PATH"] ?? ""}`, extra);
}

/** PATH is REPLACED by the fixture and the tool symlinks: nothing else can answer. */
export function runDoctorIsolated(
  home: string,
  pathDir: string,
  toolbin: string,
  extra?: Record<string, string | undefined>,
) {
  return run(home, `${pathDir}${path.delimiter}${toolbin}`, extra);
}

/** One per-source report line as the doctor's `field()` formats it (`%-24s` after 4 spaces). */
export function fieldLine(label: string, value: string): string {
  return `    ${label.padEnd(24)}${value}`;
}

export function hasLine(out: string, line: string): boolean {
  return out.split("\n").includes(line);
}

/** A shell is never reported as an interpreter, in section 2 or as a section-3 candidate. */
export function assertNoShellInterpreter(out: string): void {
  assert.doesNotMatch(out, /^ +shebang interpreter: +(\/usr)?\/bin\/(ba|da|z)?sh$/m);
  assert.doesNotMatch(out, /^ +[0-9]+\. (\/usr)?\/bin\/(ba|da|z)?sh {2}\(/m);
  assert.doesNotMatch(out, /command not found|syntax error/);
}

/** Candidate 1 of the detector on a scratch home with no PIPX_HOME and no legacy dir. */
export function pipxCandidate(home: string): string {
  const base =
    process.platform === "darwin"
      ? path.join(home, "Library", "Application Support", "pipx")
      : path.join(home, ".local", "share", "pipx");
  return path.join(base, "venvs", "mempalace", "bin", "python");
}

/** `dist=` as `mempalace_pin.py --probe` answers under the interpreter `py`. */
export function probeDist(py: string): string {
  const r = spawnSync(py, [PIN_MODULE, "--probe"], { encoding: "utf8" });
  const line = r.stdout.split("\n").find((l) => l.startsWith("dist="));
  return line === undefined ? "" : line.slice("dist=".length);
}
