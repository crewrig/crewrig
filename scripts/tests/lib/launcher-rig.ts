// launcher-rig.ts — the rig of the organization launcher tests (plan of issue #2101, v2 step 4).
//
// Every launcher test runs the template file templates/org-repo/crewrig UNMODIFIED, as a black box
// (spec 0314 R13). The rig gives each test:
//   - a temporary root under fs.realpathSync(os.tmpdir()), outside the checkout, holding a HOME that
//     is also USERPROFILE, with GIT_CEILING_DIRECTORIES set to the root and every GIT_* variable
//     scrubbed, so no test reads or writes the account's home or the checkout's repository;
//   - a local HTTP server that counts requests (no test reaches any other host);
//   - a copy of the template with a pin of the test's choosing;
//   - archives: a tiny one with a scripted entry point, one built from the manifest of the framework
//     release (the files `init` needs), and hostile ones through hostile-tar.ts.
//
// The one dependency on the launcher's cache layout is DIGEST_MARKER, the file that records the digest an
// entry was verified against; tests use it only to forge a "same version, other digest" entry.

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import type { AddressInfo, Socket } from "node:net";
import os from "node:os";
import path from "node:path";
import { after } from "node:test";
import { pathToFileURL } from "node:url";
import { writeFrameworkArchive } from "../../lib/framework-release/archive.ts";
import {
  MANIFEST_FILE,
  parseManifest,
  parseManifestEntries,
  resolveManifest,
  type ManifestEntry,
} from "../../lib/framework-release/manifest.ts";
import { stageJsYaml } from "../../lib/framework-release/vendor.ts";
import { buildTar, file, writeTgz } from "./hostile-tar.ts";

export const REPO = path.resolve(import.meta.dirname, "..", "..", "..");
export const TEMPLATE_DIR = path.join(REPO, "templates", "org-repo");
export const LAUNCHER_SOURCE = path.join(TEMPLATE_DIR, "crewrig");
export const ENTRY_POINT = path.join(REPO, "scripts", "crewrig-cli.ts");
export const NO_TYPELESS_WARNING = "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON";
/** `node` arguments that load the fast-clock preload (30 s becomes 150 ms, 300 s becomes 1.5 s). */
export const FAST_CLOCK_ARGS: readonly string[] = [
  NO_TYPELESS_WARNING,
  "--import",
  pathToFileURL(path.join(import.meta.dirname, "fast-clock.ts")).href,
];
/** The file in a cache entry that records the digest the entry was verified against. */
export const DIGEST_MARKER = ".crewrig-digest";

export function sha256(bytes: Buffer | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** The entries of manifest.txt, minus any `dist/` entry the build has not produced in this checkout. */
export function testManifestEntries(): string[] {
  return testManifestRecords().map((entry) => entry.archive);
}

/** The manifest records (archive path and source) of the checkout, without the absent dist/ entries. */
export function testManifestRecords(): ManifestEntry[] {
  return parseManifestEntries(fs.readFileSync(MANIFEST_FILE, "utf8")).filter(
    (entry) => !(entry.source.startsWith("dist/") && !fs.existsSync(path.join(REPO, entry.source))),
  );
}

// ---------------------------------------------------------------- temporary roots and environment

export interface Rig {
  /** The temporary root, a real path outside the checkout. */
  readonly root: string;
  /** HOME and USERPROFILE of every child process. */
  readonly home: string;
  /** `<home>/.crewrig/versions`, where the launcher caches versions. */
  readonly versions: string;
  /** A fresh empty directory under the root. */
  newDir(name: string): string;
  /** The scrubbed environment of a child process; an `undefined` value in `extra` removes the variable. */
  env(extra?: Record<string, string | undefined>): NodeJS.ProcessEnv;
  dispose(): void;
}

const SCRUBBED =
  /^(git_|crewrig_release_base_url$|node_options$|node_use_env_proxy$|(https?|all|no)_proxy$)/i;

function makeRig(): Rig {
  const root = fs.realpathSync(
    fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "crewrig-launcher-")),
  );
  const home = path.join(root, "home");
  fs.mkdirSync(home);
  let counter = 0;
  return {
    root,
    home,
    versions: path.join(home, ".crewrig", "versions"),
    newDir(name) {
      counter += 1;
      const dir = path.join(root, `${name}-${counter}`);
      fs.mkdirSync(dir);
      return dir;
    },
    env(extra = {}) {
      const env: NodeJS.ProcessEnv = {};
      for (const [key, value] of Object.entries(process.env)) {
        if (!SCRUBBED.test(key)) env[key] = value;
      }
      env.HOME = home;
      env.USERPROFILE = home;
      env.GIT_CEILING_DIRECTORIES = root;
      env.GIT_CONFIG_NOSYSTEM = "1";
      for (const [key, value] of Object.entries(extra)) {
        if (value === undefined) delete env[key];
        else env[key] = value;
      }
      return env;
    },
    dispose() {
      fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    },
  };
}

/** Rigs are removed after the test file; call this once at the top level of a test file. */
export function trackRigs(): { make(): Rig } {
  const rigs: Rig[] = [];
  after(() => {
    for (const rig of rigs) rig.dispose();
  });
  return {
    make() {
      const rig = makeRig();
      rigs.push(rig);
      return rig;
    },
  };
}

// ---------------------------------------------------------------------------- local HTTP server

export type Handler = (
  req: http.IncomingMessage,
  res: http.ServerResponse,
  server: TestServer,
) => void;

export interface TestServer {
  readonly port: number;
  /** `http://127.0.0.1:<port>` */
  readonly origin: string;
  /** Every request, in arrival order, as `<METHOD> <url>`. */
  readonly requests: string[];
  /** `performance.now()` at the arrival of each request, parallel to `requests`. */
  readonly arrivals: number[];
  /** Answer a path (exact string) or a pattern (matched against the path without its query). */
  route(match: string | RegExp, handler: Handler): void;
  close(): Promise<void>;
}

export async function startServer(): Promise<TestServer> {
  const routes: Array<{ match: string | RegExp; handler: Handler }> = [];
  const requests: string[] = [];
  const arrivals: number[] = [];
  const sockets = new Set<Socket>();
  let self: TestServer | undefined;
  const server = http.createServer((req, res) => {
    requests.push(`${req.method} ${req.url}`);
    arrivals.push(performance.now());
    const pathname = (req.url ?? "/").split("?")[0] ?? "/";
    const hit = routes.find((r) =>
      typeof r.match === "string" ? r.match === pathname : r.match.test(pathname),
    );
    if (hit === undefined || self === undefined) {
      res.writeHead(404);
      res.end();
      return;
    }
    hit.handler(req, res, self);
  });
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  self = {
    port,
    origin: `http://127.0.0.1:${port}`,
    requests,
    arrivals,
    route(match, handler) {
      routes.push({ match, handler });
    },
    close() {
      return new Promise<void>((resolve) => {
        server.close(() => resolve());
        for (const socket of sockets) socket.destroy();
      });
    },
  };
  return self;
}

/** Start servers and close them after the test file; call at the top level of a test file. */
export function trackServers(): { start(): Promise<TestServer> } {
  const servers: TestServer[] = [];
  after(async () => {
    for (const server of servers) await server.close();
  });
  return {
    async start() {
      const server = await startServer();
      servers.push(server);
      return server;
    },
  };
}

/** A port on 127.0.0.1 where nothing listens (a connection is refused at once). */
export async function closedPort(): Promise<number> {
  const server = await startServer();
  const { port } = server;
  await server.close();
  return port;
}

/** The path the launcher requests for a version (spec 0288 R6, spec 0314 R8). */
export function assetPath(version: string): string {
  return `/crewrig-v${version}/crewrig-${version}.tgz`;
}

export const serveBytes =
  (bytes: Buffer, headers: Record<string, string> = {}): Handler =>
  (_req, res) => {
    res.writeHead(200, { "content-type": "application/octet-stream", ...headers });
    res.end(bytes);
  };

export function serveArchive(
  server: TestServer,
  archive: Archive,
  headers?: Record<string, string>,
): void {
  server.route(assetPath(archive.version), serveBytes(fs.readFileSync(archive.file), headers));
}

export const redirectTo =
  (location: string, status = 302): Handler =>
  (_req, res) => {
    res.writeHead(status, { location });
    res.end();
  };

/** Headers and one byte of a longer body, then nothing: only the inactivity timer can end this. */
export const stall: Handler = (_req, res) => {
  res.writeHead(200, { "content-length": "100" });
  res.write("x");
};

/** One byte every `every` ms for as long as the client stays: only the total deadline can end this. */
export const drip =
  (every: number): Handler =>
  (_req, res) => {
    res.writeHead(200);
    const timer = setInterval(() => res.write("y"), every);
    res.on("close", () => clearInterval(timer));
  };

// ------------------------------------------------------------------------------------ archives

export interface Archive {
  /** The `.tgz` file. */
  file: string;
  version: string;
  sha256: string;
}

/**
 * The entry point of the tiny archive: it prints what it was given, and `ENTRY_MODE` scripts its end:
 * `exit:<n>`, `signal:<name>` or `stdin` (echo standard input). Plain CommonJS, so it runs from any
 * extraction directory.
 */
export const ENTRY_SOURCE = `const mode = process.env.ENTRY_MODE ?? "";
if (mode.startsWith("exit:")) process.exit(Number(mode.slice(5)));
if (mode.startsWith("signal:")) {
  process.kill(process.pid, mode.slice(7));
  setTimeout(() => process.exit(0), 5000);
} else if (mode === "stdin") {
  process.stdin.on("data", (chunk) => process.stdout.write(chunk));
} else {
  console.log(
    JSON.stringify({
      entry: "tiny",
      args: process.argv.slice(2),
      cwd: process.cwd(),
      execPath: process.execPath,
      marker: process.env.FORWARD_MARKER ?? null,
    }),
  );
}
`;

/** What the tiny entry point prints in its default mode. */
export interface EntryReport {
  entry: string;
  args: string[];
  cwd: string;
  execPath: string;
  marker: string | null;
}

export function parseEntryReport(stdout: string): EntryReport {
  return JSON.parse(stdout) as EntryReport;
}

export const TINY_DESCRIPTOR = `${JSON.stringify({ entry: "scripts/entry.js", note: "ignored" })}\n`;

/** A valid archive with a descriptor and a scripted entry point; `extra` adds entries after them. */
export function tinyArchive(
  dir: string,
  version: string,
  options: { entrySource?: string; extra?: Parameters<typeof buildTar>[0] } = {},
): Archive {
  const tar = buildTar([
    file("crewrig.entry.json", TINY_DESCRIPTOR),
    file("scripts/entry.js", options.entrySource ?? ENTRY_SOURCE),
    ...(options.extra ?? []),
  ]);
  const target = path.join(dir, `crewrig-${version}-${sha256(String(Math.random()))}.tgz`);
  return { file: target, version, sha256: writeTgz(target, tar) };
}

/** The archive of any tar stream (hostile ones included). */
export function archiveOf(dir: string, version: string, tar: Buffer): Archive {
  const target = path.join(dir, `crewrig-${version}-${sha256(tar)}.tgz`);
  return { file: target, version, sha256: writeTgz(target, tar) };
}

let cachedArchiveDir: string | undefined;
let cachedArchive: Archive | undefined;

/**
 * The archive of the files of manifest.txt (`testManifestEntries()`), built once per process with the
 * producer of the release. Its version label is free: the launcher never reads a version from it.
 */
export function manifestArchive(version = "1.0.0-test.1"): Archive {
  if (cachedArchive !== undefined && cachedArchive.version === version) return cachedArchive;
  const dir = fs.realpathSync(
    fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "crewrig-archive-")),
  );
  cachedArchiveDir = dir;
  process.once("exit", () => {
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const target = path.join(dir, `crewrig-${version}.tgz`);
  stageJsYaml(REPO);
  const files = resolveManifest(REPO, testManifestRecords());
  cachedArchive = { file: target, version, sha256: writeFrameworkArchive(files, target) };
  return cachedArchive;
}

/** Where `manifestArchive` keeps its file (for tests that build variants beside it). */
export function cachedArchiveDirectory(): string {
  manifestArchive();
  if (cachedArchiveDir === undefined) throw new Error("manifest archive directory is unset");
  return cachedArchiveDir;
}

// ------------------------------------------------------------------------------ template copy

export type PinInput = Record<string, unknown> | string | null;

/** The pin of an archive, in the form the template holds it. */
export function pinOf(
  archive: Archive,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return { version: archive.version, sha256: archive.sha256, ...extra };
}

/**
 * A copy of templates/org-repo in a fresh directory: the launcher byte for byte with its executable
 * mode, the README, and the pin the test chooses (`null` leaves the pin file out; a string is written
 * as is, so a malformed pin can be tested). `extraFiles` adds files beside them.
 */
export function copyTemplate(
  rig: Rig,
  pin: PinInput,
  extraFiles: Record<string, string> = {},
): string {
  const dir = rig.newDir("org");
  fs.copyFileSync(LAUNCHER_SOURCE, path.join(dir, "crewrig"));
  fs.chmodSync(path.join(dir, "crewrig"), 0o755);
  fs.copyFileSync(path.join(TEMPLATE_DIR, "README.md"), path.join(dir, "README.md"));
  if (pin !== null) {
    const text = typeof pin === "string" ? pin : `${JSON.stringify(pin, null, 2)}\n`;
    fs.writeFileSync(path.join(dir, "crewrig.pin.json"), text);
  }
  for (const [name, content] of Object.entries(extraFiles)) {
    fs.writeFileSync(path.join(dir, name), content);
  }
  return dir;
}

// ----------------------------------------------------------------------------- running a child

export interface RunOptions {
  /** Defaults to the directory of the template copy for `runLauncher`. */
  cwd?: string;
  env?: Record<string, string | undefined>;
  /** Options placed before the script: `--import ...`, `--disable-warning=...`. */
  nodeArgs?: readonly string[];
  stdin?: string;
  /** Test-side guard that kills a hung child (default 60 s). */
  timeoutMs?: number;
}

export interface RunResult {
  code: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  /** stdout then stderr. */
  out: string;
  /** Wall-clock milliseconds from spawn to exit. */
  ms: number;
}

/** Run `node <script> <args>` with the rig's environment; never rejects on a non-zero exit. */
export function runNode(
  rig: Rig,
  script: string,
  args: readonly string[],
  options: RunOptions = {},
): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const started = performance.now();
    const child = spawn(process.execPath, [...(options.nodeArgs ?? []), script, ...args], {
      cwd: options.cwd ?? path.dirname(script),
      env: rig.env(options.env),
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => (stdout += chunk));
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => (stderr += chunk));
    const guard = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`child still running after ${options.timeoutMs ?? 60_000} ms: ${script}`));
    }, options.timeoutMs ?? 60_000);
    child.on("error", (error) => {
      clearTimeout(guard);
      reject(error);
    });
    child.on("close", (code, signal) => {
      clearTimeout(guard);
      resolve({
        code,
        signal,
        stdout,
        stderr,
        out: stdout + stderr,
        ms: performance.now() - started,
      });
    });
    child.stdin.on("error", () => {});
    child.stdin.end(options.stdin ?? "");
  });
}

/** Run `node <dir>/crewrig <args>`: the launcher of a template copy. */
export function runLauncher(
  rig: Rig,
  dir: string,
  args: readonly string[] = [],
  options: RunOptions = {},
): Promise<RunResult> {
  return runNode(rig, path.join(dir, "crewrig"), args, { cwd: dir, ...options });
}

// ----------------------------------------------------------------------------- tree inspection

/** Every path under `root` in byte order, directories with a trailing `/`, links with a trailing `@`. */
export function treeList(root: string): string[] {
  const out: string[] = [];
  const walk = (rel: string): void => {
    const names = fs
      .readdirSync(path.join(root, rel))
      .sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)));
    for (const name of names) {
      const child = rel === "" ? name : `${rel}/${name}`;
      const stat = fs.lstatSync(path.join(root, child));
      if (stat.isSymbolicLink()) out.push(`${child}@`);
      else if (stat.isDirectory()) {
        out.push(`${child}/`);
        walk(child);
      } else out.push(child);
    }
  };
  walk("");
  return out;
}

/** The listing of `root` with the SHA-256 of every file: equal snapshots mean nothing changed. */
export function snapshot(root: string): string[] {
  return treeList(root).map((entry) => {
    if (entry.endsWith("/") || entry.endsWith("@")) return entry;
    return `${entry}\t${sha256(fs.readFileSync(path.join(root, entry)))}`;
  });
}

/** Files that stand for the rest of `~/.crewrig/`, which the launcher must never touch (0288 R7). */
export function seedOtherCrewrigState(rig: Rig): void {
  fs.mkdirSync(path.join(rig.home, ".crewrig", "hooks"), { recursive: true });
  fs.writeFileSync(path.join(rig.home, ".crewrig", "hooks", "x"), "hook\n");
  fs.writeFileSync(path.join(rig.home, ".crewrig", "validation.conf"), "validation\n");
}

/** The snapshot of the home without `.crewrig/versions`. */
export function homeOutsideVersions(rig: Rig): string[] {
  return snapshot(rig.home).filter(
    (line) => line !== ".crewrig/versions/" && !line.startsWith(".crewrig/versions/"),
  );
}

/** The entries of `versions/` (cache entries, staging and aside directories alike). */
export function versionEntries(rig: Rig): string[] {
  try {
    return fs.readdirSync(rig.versions).sort();
  } catch {
    return [];
  }
}

// -------------------------------------------------------------------------------- primed caches

/**
 * Run the launcher once against a throwaway server that serves `archive`, so that the returned
 * `~/.crewrig` directory holds a complete entry the launcher itself wrote. Clone it with `cloneCache`.
 */
export async function primeCache(rigs: { make(): Rig }, archive: Archive): Promise<string> {
  const rig = rigs.make();
  const server = await startServer();
  try {
    serveArchive(server, archive);
    const dir = copyTemplate(rig, pinOf(archive));
    const run = await runLauncher(rig, dir, ["prime"], {
      env: { CREWRIG_RELEASE_BASE_URL: server.origin },
    });
    if (run.code !== 0) throw new Error(`priming the cache failed (${run.code}): ${run.out}`);
  } finally {
    await server.close();
  }
  return path.join(rig.home, ".crewrig");
}

/** Copy a primed `~/.crewrig` into the home of `rig`. */
export function cloneCache(primed: string, rig: Rig): void {
  fs.cpSync(primed, path.join(rig.home, ".crewrig"), { recursive: true });
}
