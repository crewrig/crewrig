// program-install.ts — materialise the installed programs outside the
// repository (spec 0252 requirement 10 with delta-01; plan v2 D9, v3 D9).
//
// Writes, under ~/.crewrig/ (or where the two path overrides point):
//   - the launcher program at the record path with `.sh` replaced by `.ts`,
//   - the endpoint record at the legacy record path (launcher-record.ts),
//   - the trust wrapper at MEMPALACE_TLS_EXEC_PATH with `.sh` replaced by `.ts`,
//   - a `service-lib/` beside each program holding exactly the bundle files that
//     program imports, copied verbatim (launcher/bundle.ts).
// Every file is staged under a random sibling name and renamed into place.
// Uninstall follows the definitions: the launcher and its record go with the MCP
// definition, the wrapper with the ChromaDB definition, and the bundle files of a
// `service-lib/` go only when no remaining definition's program imports them.

import { servicePlatform } from "./exec.ts";
import { createHash, randomBytes } from "node:crypto";
import {
  chmodSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  rmdirSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { LAUNCHER_BUNDLE, SERVICE_LIB_FILES, TRUST_WRAPPER_BUNDLE } from "./launcher/bundle.ts";
import { flatName, rewriteEntryImports } from "./launcher/bundle.ts";
import { programPathFor, renderRecord } from "./launcher-record.ts";
import type { DaemonKind, EnvLike } from "./names.ts";

export const REPO_LIB_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const LAUNCHER_ENTRY = "service/launcher/mcp-daemon-launcher.ts";
export const WRAPPER_ENTRY = "service/launcher/trust-wrapper.ts";
const RESIDUAL_RE = /__[A-Z][A-Z0-9_]*__/;

export interface InstalledPaths {
  /** The endpoint record, at the legacy launcher path. */
  readonly record: string;
  readonly launcher: string;
  readonly wrapper: string;
}

/** Where the programs go: `MEMPALACE_MCP_LAUNCHER_PATH` / `MEMPALACE_TLS_EXEC_PATH` or `~/.crewrig/`. */
export function installedPaths(home: string, env: EnvLike = process.env): InstalledPaths {
  const pick = (name: string, fallback: string): string => {
    const value = env[name];
    return value !== undefined && value !== "" ? value : path.join(home, ".crewrig", fallback);
  };
  const record = pick("MEMPALACE_MCP_LAUNCHER_PATH", "mcp-daemon-launcher.sh");
  return {
    record,
    launcher: programPathFor(record),
    wrapper: programPathFor(pick("MEMPALACE_TLS_EXEC_PATH", "tls-exec.sh")),
  };
}

export interface LauncherConstants {
  readonly repoDir: string;
  readonly host: string;
  readonly port: string;
  readonly chromaHost: string;
  readonly chromaPort: string;
  readonly python: string;
  readonly palacePath: string;
}

export interface ProgramOptions {
  readonly paths: InstalledPaths;
  /** Where the sources are read; the repository's `scripts/lib` by default. */
  readonly libDir?: string;
}

/** SHA-256 of the launcher entry source, the trust wrapper source, then the bundle files. */
export function launcherSourceSha(libDir: string = REPO_LIB_DIR): string {
  const hash = createHash("sha256");
  for (const file of [LAUNCHER_ENTRY, WRAPPER_ENTRY, ...SERVICE_LIB_FILES]) {
    hash.update(readFileSync(path.join(libDir, file)));
  }
  return hash.digest("hex");
}

/** Write `data` to `target` through a random temp sibling and a rename. */
export function writeStaged(target: string, data: string | Buffer, mode: number): void {
  mkdirSync(path.dirname(target), { recursive: true });
  const staging = `${target}.${randomBytes(8).toString("hex")}.tmp`;
  try {
    writeFileSync(staging, data, { flag: "wx", mode });
    if (servicePlatform() !== "win32") chmodSync(staging, mode);
    renameSync(staging, target);
  } catch (error) {
    rmSync(staging, { force: true });
    throw error;
  }
}

function copyBundle(files: readonly string[], program: string, libDir: string): void {
  const dest = path.join(path.dirname(program), "service-lib");
  for (const file of files) {
    writeStaged(path.join(dest, flatName(file)), readFileSync(path.join(libDir, file)), 0o644);
  }
}

function render(entry: string, libDir: string, values: Record<string, string>): string {
  let text = rewriteEntryImports(readFileSync(path.join(libDir, entry), "utf8"));
  for (const [key, value] of Object.entries(values)) {
    text = text.replaceAll(`"${key}"`, () => JSON.stringify(value));
  }
  const residual = RESIDUAL_RE.exec(text);
  if (residual !== null) {
    throw new RangeError(
      `${entry} still contains the placeholder ${residual[0]} after substitution`,
    );
  }
  return text;
}

/** Install the MCP launcher program, its bundle files and its endpoint record. */
export function installLauncherProgram(opts: ProgramOptions & LauncherConstants): string {
  const libDir = opts.libDir ?? REPO_LIB_DIR;
  const sha = launcherSourceSha(libDir);
  const text = render(LAUNCHER_ENTRY, libDir, {
    __CREWRIG_REPO_DIR__: opts.repoDir,
    __MCP_HOST__: opts.host,
    __MCP_PORT__: opts.port,
    __CHROMA_HOST__: opts.chromaHost,
    __CHROMA_PORT__: opts.chromaPort,
    __MEMPALACE_PYTHON__: opts.python,
    __MEMPALACE_PALACE_PATH__: opts.palacePath,
    __LAUNCHER_SOURCE_SHA__: sha,
  });
  const record = renderRecord({
    host: opts.host,
    port: opts.port,
    sourceSha: sha,
    program: opts.paths.launcher,
  });
  copyBundle(LAUNCHER_BUNDLE, opts.paths.launcher, libDir);
  writeStaged(opts.paths.launcher, text, 0o755);
  writeStaged(opts.paths.record, record, 0o755);
  return sha;
}

/** Install the trust wrapper and its bundle files. */
export function installTrustWrapperProgram(opts: ProgramOptions): void {
  const libDir = opts.libDir ?? REPO_LIB_DIR;
  const text = render(WRAPPER_ENTRY, libDir, {});
  copyBundle(TRUST_WRAPPER_BUNDLE, opts.paths.wrapper, libDir);
  writeStaged(opts.paths.wrapper, text, 0o755);
}

const BUNDLE_OF: Record<DaemonKind, readonly string[]> = {
  mcp: LAUNCHER_BUNDLE,
  chroma: TRUST_WRAPPER_BUNDLE,
};

function programOf(kind: DaemonKind, paths: InstalledPaths): string {
  return kind === "mcp" ? paths.launcher : paths.wrapper;
}

/**
 * Uninstall one daemon's files. `stillInstalled` lists the definitions that
 * remain installed once this one is gone (the caller reads them from the
 * service manager). The program of `kind` and, for the MCP daemon, its record
 * are removed; each bundle file of the affected `service-lib/` goes unless a
 * remaining definition's program, in the same directory, imports it; an empty
 * `service-lib/` is removed. Returns the paths removed.
 */
export function uninstallPrograms(
  kind: DaemonKind,
  paths: InstalledPaths,
  stillInstalled: readonly DaemonKind[],
): readonly string[] {
  const removed: string[] = [];
  const drop = (file: string): void => {
    try {
      rmSync(file);
      removed.push(file);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  };
  drop(programOf(kind, paths));
  if (kind === "mcp") drop(paths.record);

  const libDir = path.join(path.dirname(programOf(kind, paths)), "service-lib");
  const keep = new Set<string>();
  for (const other of stillInstalled) {
    if (other === kind) continue;
    if (path.join(path.dirname(programOf(other, paths)), "service-lib") !== libDir) continue;
    for (const file of BUNDLE_OF[other]) keep.add(flatName(file));
  }
  for (const file of BUNDLE_OF[kind]) {
    if (!keep.has(flatName(file))) drop(path.join(libDir, flatName(file)));
  }
  try {
    if (readdirSync(libDir).length === 0) {
      rmdirSync(libDir);
      removed.push(libDir);
    }
  } catch {
    // absent or not empty: another file lives there and stays
  }
  return removed;
}
