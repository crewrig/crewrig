// probe-windows-hook-parsing.ts — measures how each CLI's hook command line is
// parsed on Windows (spec 0237, issue #1322).
//
// Standalone on purpose: Node.js built-ins only and no repository import, so a
// single `scp` of this file to a Windows host is the whole kit. The runbook is
// docs/runbooks/windows-hook-parsing-probe.md.
//
// Usage (each subcommand accepts --root <dir>; setup also accepts --home <dir>):
//   node probe.ts setup                      create the layout beside kit/
//   node probe.ts install <cli> [--only I,Q3] snapshot + write the probe hooks
//   node probe.ts record <cli> <case> [...]  (run BY the hooks) write one record
//   node probe.ts collect <cli>              print the records, one group each
//   node probe.ts restore <cli>              restore the config, verify SHA-256
//   node probe.ts verify-clean               prove nothing is left installed
//
// Layout (<root> defaults to the parent of the directory holding this file):
//   <root>/kit/probe.ts                     the probe as copied to the host
//   <root>/sp ace/probe.ts                  copy for the spaced-path case (Q0)
//   <root>/proj/                            session cwd, `git init`-ed
//   <root>/proj/.crewrig-probe/probe.ts     copy for the project-dir cases
//   <root>/out/<cli>/<case>-<ms>-<pid>.json one record per hook firing
//   <root>/state.json                       home + per-CLI snapshots
//   <root>/.crewrig-probe-root              root marker
//
// Root resolution (plan review v1-F2): every copy walks up from its own
// directory to the first ancestor holding `.crewrig-probe-root`, so a record
// always lands in <root>/out/<cli>/ whichever copy ran. No environment
// variable under test is ever read to find the output directory.
//
// `record` exits 0 with empty stdout, so no CLI reads its output as a hook
// decision. Exit codes: 0 success, 1 check failed, 2 usage error.

import { spawnSync, type SpawnSyncOptionsWithStringEncoding } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const CLIS = ["claude", "gemini", "copilot", "antigravity"] as const;
export type Cli = (typeof CLIS)[number];

export const MARKER = ".crewrig-probe-root";
export const BACKUP_SUFFIX = ".crewrig-probe.bak";
const PROBE_TAG = "crewrig-probe";

/** The CLI's own project-directory variable, written literally into the cases. */
export const PROJECT_VAR: Record<Cli, string> = {
  claude: "CLAUDE_PROJECT_DIR",
  gemini: "GEMINI_PROJECT_DIR",
  copilot: "COPILOT_PROJECT_DIR",
  antigravity: "ANTIGRAVITY_PROJECT_DIR",
};

/** User-level hook surface per CLI, relative to the home directory (row 8). */
export const CONFIG_FILE: Record<Cli, string[]> = {
  claude: [".claude", "settings.json"],
  gemini: [".gemini", "settings.json"],
  copilot: [".copilot", "hooks", "copilot-transcript-hooks.json"],
  antigravity: [".gemini", "config", "hooks.json"],
};

export interface ProbeCase {
  id: string;
  /** Copilot entry key holding the command line (default `command`). */
  key?: "command" | "bash" | "powershell";
  command: string;
}

export interface Snapshot {
  file: string;
  existed: boolean;
  sha256: string | null;
  createdDirs: string[];
  installed: boolean;
  /** Case ids installed by `install --only`; null means the full table. */
  only: string[] | null;
}

export interface State {
  home: string;
  clis: Partial<Record<Cli, Snapshot>>;
}

export class UsageError extends Error {}

function fwd(p: string): string {
  return p.replaceAll("\\", "/");
}

function back(p: string): string {
  return p.replaceAll("/", "\\");
}

/**
 * The case table (plan v1, amended by review findings v1-F1, v1-F5, v1-F6):
 * one token per entry, so a token the interpreter cannot parse only loses its
 * own entry.
 */
export function casesFor(cli: Cli, root: string): ProbeCase[] {
  const r = fwd(root);
  const kit = `${r}/kit/probe.ts`;
  const v = PROJECT_VAR[cli];
  const rec = (id: string, ...tokens: string[]): string =>
    [`node ${kit} record ${cli} ${id}`, ...tokens].join(" ");
  const proj = `${r}/proj/.crewrig-probe/probe.ts`;
  const committed: Record<Cli, string> = {
    claude: `node "$${v}/.crewrig-probe/probe.ts" record claude M`,
    gemini: `node \${${v}}/.crewrig-probe/probe.ts record gemini M`,
    copilot: `node "\${${v}:-$PWD}/.crewrig-probe/probe.ts" record copilot M`,
    antigravity: "node .crewrig-probe/probe.ts record antigravity M",
  };
  const deployed: Record<Cli, string> = {
    claude: `node "${proj}" record claude D`,
    gemini: `MEMPALACE_TRANSCRIPT_ENABLED=1 node ${proj} record gemini D`,
    copilot: `node "${proj}" record copilot D`,
    antigravity: `node ${proj} record antigravity D Stop`,
  };
  const cases: ProbeCase[] = [
    { id: "I", command: rec("I") },
    { id: "Q0", command: `node "${r}/sp ace/probe.ts" record ${cli} Q0` },
    { id: "Q1", command: rec("Q1", '"a b"') },
    { id: "Q2", command: rec("Q2", "'c d'") },
    { id: "Q3", command: rec("Q3", '"e\\"f"') },
    { id: "Q4", command: rec("Q4", "a^b") },
    { id: "E1", command: rec("E1", `"$${v}"`) },
    { id: "E2", command: rec("E2", `"\${${v}}"`) },
    { id: "E3", command: rec("E3", `"%${v}%"`) },
    { id: "E4", command: rec("E4", `"$env:${v}"`) },
    { id: "E5", command: rec("E5", `"\${${v}:-$PWD}"`) },
    { id: "M", command: committed[cli] },
    { id: "D", command: deployed[cli] },
    { id: "P", command: `node ${back(root)}\\kit\\probe.ts record ${cli} P` },
    { id: "P2a", command: rec("P2a", "C:\\a\\b") },
    { id: "P2b", command: rec("P2b", ".\\r\\x") },
    { id: "P2c", command: rec("P2c", "\\\\srv\\s") },
    { id: "P2d", command: rec("P2d", "C:/a/b") },
    { id: "P2e", command: rec("P2e", "./r/x") },
    { id: "P3a", command: rec("P3a", "/c/crewrig-probe/x") },
    { id: "P3b", command: rec("P3b", "/x/y:/z") },
  ];
  if (cli === "copilot") {
    cases.push({ id: "I-bash", key: "bash", command: rec("I-bash") });
    cases.push({ id: "I-ps", key: "powershell", command: rec("I-ps") });
  }
  return cases;
}

type Json = Record<string, unknown>;

function asObject(value: unknown): Json {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Json)
    : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/** Merge the probe entries into an existing (or empty) config object. */
export function mergeHooks(cli: Cli, existing: Json, cases: ProbeCase[]): Json {
  const out: Json = { ...existing };
  if (cli === "antigravity") {
    out[PROBE_TAG] = {
      Stop: cases.map((c) => ({ type: "command", command: c.command, timeout: 10 })),
    };
    return out;
  }
  if (cli === "copilot") {
    out.version = 1;
    const hooks = asObject(out.hooks);
    hooks.userPromptSubmitted = [
      ...asArray(hooks.userPromptSubmitted),
      ...cases.map((c) => ({ type: "command", [c.key ?? "command"]: c.command })),
    ];
    out.hooks = hooks;
    return out;
  }
  const hooks = asObject(out.hooks);
  if (cli === "claude") {
    hooks.UserPromptSubmit = [
      ...asArray(hooks.UserPromptSubmit),
      {
        matcher: "",
        hooks: cases.map((c) => ({ type: "command", command: c.command })),
      },
    ];
  } else {
    hooks.BeforeAgent = [
      ...asArray(hooks.BeforeAgent),
      {
        hooks: cases.map((c) => ({
          type: "command",
          name: `${PROBE_TAG}-${c.id}`,
          command: c.command,
        })),
      },
    ];
  }
  out.hooks = hooks;
  return out;
}

const KEEP_ENV =
  /PROJECT_DIR|^PWD$|^SHELL$|^COMSPEC$|^MSYSTEM$|^PSModulePath$|^PATHEXT$|^(CLAUDE|GEMINI|COPILOT|ANTIGRAVITY|AGY)_/i;
const SECRET_ENV = /KEY|TOKEN|SECRET|PASS|CRED|AUTH|COOKIE/i;

/** Every key is kept; a value only for diagnostic keys, never for secret-like ones. */
export function redactEnv(env: NodeJS.ProcessEnv): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of Object.keys(env).sort()) {
    if (SECRET_ENV.test(key)) out[key] = "<redacted>";
    else if (KEEP_ENV.test(key)) out[key] = env[key] ?? "";
    else out[key] = "<omitted>";
  }
  return out;
}

const STDIN_VALUES = ["cwd", "workspacePaths", "hook_event_name", "hookEventName"];

export function summariseStdin(raw: string): Json {
  if (raw.trim() === "") return { empty: true };
  try {
    const parsed = asObject(JSON.parse(raw));
    const values: Json = {};
    for (const key of STDIN_VALUES) if (key in parsed) values[key] = parsed[key];
    return { keys: Object.keys(parsed).sort(), values };
  } catch {
    return { unparsed: true, length: raw.length };
  }
}

/** Walk up from `dir` to the first ancestor holding the root marker. */
export function findRoot(dir: string): string | null {
  let current = path.resolve(dir);
  for (;;) {
    if (fs.existsSync(path.join(current, MARKER))) return current;
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

function sha256(file: string): string {
  return createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function statePath(root: string): string {
  return path.join(root, "state.json");
}

export function readState(root: string): State {
  return JSON.parse(fs.readFileSync(statePath(root), "utf8")) as State;
}

function writeState(root: string, state: State): void {
  fs.writeFileSync(statePath(root), `${JSON.stringify(state, null, 2)}\n`);
}

function configPath(state: State, cli: Cli): string {
  return path.join(state.home, ...CONFIG_FILE[cli]);
}

interface Io {
  out: (line: string) => void;
  err: (line: string) => void;
}

const stdio: Io = {
  out: (line) => process.stdout.write(`${line}\n`),
  err: (line) => process.stderr.write(`${line}\n`),
};

function parseCli(raw: string | undefined): Cli {
  const cli = CLIS.find((c) => c === raw);
  if (cli === undefined) throw new UsageError(`unknown cli '${raw ?? ""}' (${CLIS.join(", ")})`);
  return cli;
}

export function setup(root: string, home: string, self: string, io: Io): number {
  for (const dir of ["kit", "sp ace", "proj", path.join("proj", ".crewrig-probe"), "out"]) {
    fs.mkdirSync(path.join(root, dir), { recursive: true });
  }
  const kitCopy = path.join(root, "kit", "probe.ts");
  if (path.resolve(self) !== path.resolve(kitCopy)) fs.copyFileSync(self, kitCopy);
  fs.copyFileSync(self, path.join(root, "sp ace", "probe.ts"));
  fs.copyFileSync(self, path.join(root, "proj", ".crewrig-probe", "probe.ts"));
  fs.writeFileSync(path.join(root, MARKER), "");
  const git = spawnSync("git", ["init", "--quiet", path.join(root, "proj")], { encoding: "utf8" });
  if (!fs.existsSync(statePath(root))) writeState(root, { home, clis: {} });
  io.out(`setup: root=${root} home=${readState(root).home} git-init=${git.status === 0}`);
  return 0;
}

/** The cases `install` writes: the full table, or the `--only` subset. */
export function selectCases(cli: Cli, root: string, only: string[] | null): ProbeCase[] {
  const all = casesFor(cli, root);
  if (only === null) return all;
  const unknown = only.filter((id) => !all.some((c) => c.id === id));
  if (unknown.length > 0) throw new UsageError(`unknown case(s) for ${cli}: ${unknown.join(", ")}`);
  return all.filter((c) => only.includes(c.id));
}

export function install(root: string, cli: Cli, io: Io, only: string[] | null = null): number {
  const cases = selectCases(cli, root, only);
  const state = readState(root);
  if (state.clis[cli]?.installed === true) {
    io.err(`install: ${cli} is already installed; run 'restore ${cli}' first`);
    return 1;
  }
  const file = configPath(state, cli);
  const existed = fs.existsSync(file);
  const createdDirs: string[] = [];
  let dir = path.dirname(file);
  while (!fs.existsSync(dir)) {
    createdDirs.unshift(dir);
    dir = path.dirname(dir);
  }
  const snapshot: Snapshot = {
    file,
    existed,
    sha256: existed ? sha256(file) : null,
    createdDirs,
    installed: true,
    only,
  };
  const previous = state.clis[cli];
  if (previous !== undefined && previous.sha256 !== snapshot.sha256) {
    io.err(`install: ${cli} config changed since the first snapshot; refusing`);
    return 1;
  }
  for (const d of createdDirs) fs.mkdirSync(d);
  let existing: Json = {};
  if (existed) {
    fs.copyFileSync(file, `${file}${BACKUP_SUFFIX}`);
    existing = asObject(JSON.parse(fs.readFileSync(file, "utf8")));
  }
  state.clis[cli] = snapshot;
  writeState(root, state);
  const merged = mergeHooks(cli, existing, cases);
  const text = `${JSON.stringify(merged, null, 2)}\n`;
  fs.writeFileSync(file, text);
  io.out(`install: ${cli} -> ${file} (existed=${existed})`);
  io.out(text.trimEnd());
  return 0;
}

export function restore(root: string, cli: Cli, io: Io): number {
  const state = readState(root);
  const snap = state.clis[cli];
  if (snap === undefined) {
    io.err(`restore: no snapshot for ${cli}`);
    return 1;
  }
  const backup = `${snap.file}${BACKUP_SUFFIX}`;
  if (snap.existed) {
    if (!fs.existsSync(backup)) {
      io.err(`restore: ${cli} backup ${backup} is missing`);
      return 1;
    }
    fs.copyFileSync(backup, snap.file);
    const now = sha256(snap.file);
    if (now !== snap.sha256) {
      io.err(`restore: ${cli} MISMATCH ${now} != ${snap.sha256}; backup kept at ${backup}`);
      return 1;
    }
    fs.rmSync(backup);
    io.out(`restore: ${cli} ${snap.file} sha256=${now} matches snapshot`);
  } else {
    fs.rmSync(snap.file, { force: true });
    for (const d of [...snap.createdDirs].reverse()) {
      if (fs.existsSync(d) && fs.readdirSync(d).length === 0) fs.rmdirSync(d);
    }
    if (fs.existsSync(snap.file)) {
      io.err(`restore: ${cli} ${snap.file} still present`);
      return 1;
    }
    io.out(`restore: ${cli} ${snap.file} absent, as before install`);
  }
  snap.installed = false;
  writeState(root, state);
  return 0;
}

export function verifyClean(root: string, io: Io): number {
  const state = readState(root);
  const problems: string[] = [];
  for (const cli of CLIS) {
    const file = configPath(state, cli);
    const snap = state.clis[cli];
    if (fs.existsSync(`${file}${BACKUP_SUFFIX}`))
      problems.push(`${cli}: backup left at ${file}${BACKUP_SUFFIX}`);
    if (snap?.installed === true) problems.push(`${cli}: still marked installed`);
    const present = fs.existsSync(file);
    if (snap !== undefined) {
      if (present !== snap.existed) problems.push(`${cli}: ${file} existence changed`);
      if (present && snap.sha256 !== null && sha256(file) !== snap.sha256) {
        problems.push(`${cli}: ${file} differs from the pre-install snapshot`);
      }
      for (const d of snap.createdDirs) {
        if (fs.existsSync(d)) problems.push(`${cli}: created directory ${d} still present`);
      }
    }
    if (present && fs.readFileSync(file, "utf8").includes(PROBE_TAG)) {
      problems.push(`${cli}: ${file} still mentions ${PROBE_TAG}`);
    }
  }
  for (const p of problems) io.err(`verify-clean: ${p}`);
  if (problems.length > 0) return 1;
  io.out("clean");
  return 0;
}

interface ProcessRow {
  ProcessId: number;
  ParentProcessId: number;
  Name: string | null;
  ExecutablePath: string | null;
  CommandLine: string | null;
}

/** `wmic /format:list` renders through an XSL sheet, so values arrive XML-escaped. */
function unescapeXml(value: string): string {
  return value
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&amp;", "&");
}

/** Parse `wmic process get … /format:list` output: `Key=Value` lines, blank-line separated. */
export function parseWmicList(text: string): ProcessRow[] {
  const rows: ProcessRow[] = [];
  for (const block of text.replaceAll("\r", "").split(/\n{2,}/)) {
    const fields = new Map<string, string>();
    for (const line of block.split("\n")) {
      const eq = line.indexOf("=");
      if (eq > 0) fields.set(line.slice(0, eq), unescapeXml(line.slice(eq + 1)));
    }
    const pid = Number(fields.get("ProcessId"));
    if (!fields.has("ProcessId") || !Number.isInteger(pid)) continue;
    const text_ = (key: string): string | null => {
      const value = fields.get(key);
      return value === undefined || value === "" ? null : value;
    };
    rows.push({
      ProcessId: pid,
      ParentProcessId: Number(fields.get("ParentProcessId")),
      Name: text_("Name"),
      ExecutablePath: text_("ExecutablePath"),
      CommandLine: text_("CommandLine"),
    });
  }
  return rows;
}

const SPAWN_OPTS: SpawnSyncOptionsWithStringEncoding = {
  encoding: "utf8",
  maxBuffer: 64 * 1024 * 1024,
  stdio: ["ignore", "pipe", "pipe"],
  timeout: 20_000,
  windowsHide: true,
};

/**
 * One Win32_Process snapshot. `wmic` answers in ~0.1 s on the measured host;
 * the PowerShell CIM fallback costs 5-8 s, and twenty concurrent ones overran
 * the CLIs' hook timeouts, so the fallback is reserved for the `I` cases.
 */
function processRows(interpreterCase: boolean): { rows: ProcessRow[]; source: string } | string {
  const wmic = spawnSync(
    "wmic",
    ["process", "get", "ProcessId,ParentProcessId,Name,ExecutablePath,CommandLine", "/format:list"],
    SPAWN_OPTS,
  );
  if (wmic.status === 0) return { rows: parseWmicList(wmic.stdout), source: "wmic" };
  if (!interpreterCase) return `wmic unavailable (${wmic.error?.message ?? String(wmic.status)})`;
  const query =
    "Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,ExecutablePath,CommandLine | ConvertTo-Json -Compress";
  const ps = spawnSync(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-Command", query],
    SPAWN_OPTS,
  );
  if (ps.status !== 0) {
    return `powershell ${ps.error?.message ?? `exit ${String(ps.status)}`}: ${ps.stderr}`;
  }
  return { rows: JSON.parse(ps.stdout) as ProcessRow[], source: "powershell-cim" };
}

/** Up to four ancestors of this process, from one Win32_Process snapshot. */
function parentChain(interpreterCase: boolean): { chain: Json[] | null; error?: string } {
  if (process.platform !== "win32") {
    return { chain: null, error: `not win32 (${process.platform})` };
  }
  const snapshot = processRows(interpreterCase);
  if (typeof snapshot === "string") return { chain: null, error: snapshot };
  const byId = new Map(snapshot.rows.map((row) => [row.ProcessId, row]));
  const chain: Json[] = [];
  let id = process.ppid;
  for (let depth = 0; depth < 4; depth += 1) {
    const row = byId.get(id);
    if (row === undefined) break;
    chain.push({
      pid: row.ProcessId,
      Name: row.Name,
      ExecutablePath: row.ExecutablePath,
      CommandLine: row.CommandLine,
      source: snapshot.source,
    });
    id = row.ParentProcessId;
  }
  return { chain };
}

function readStdin(timeoutMs: number): Promise<string> {
  return new Promise((resolve) => {
    if (process.stdin.isTTY === true) {
      resolve("");
      return;
    }
    const chunks: Buffer[] = [];
    const done = (): void => {
      clearTimeout(timer);
      process.stdin.destroy();
      resolve(Buffer.concat(chunks).toString("utf8"));
    };
    const timer = setTimeout(done, timeoutMs);
    process.stdin.on("data", (chunk: Buffer) => chunks.push(chunk));
    process.stdin.on("end", done);
    process.stdin.on("error", done);
  });
}

export async function record(self: string, argv: readonly string[]): Promise<number> {
  const t0 = Date.now();
  const root = findRoot(path.dirname(self));
  if (root === null) return 1;
  const cli = parseCli(argv[0]);
  const id = (argv[1] ?? "unnamed").replace(/[^A-Za-z0-9-]/g, "_");
  const rec: Json = {
    cli,
    case: id,
    args: argv.slice(2),
    argv: process.argv,
    scriptPath: self,
    execPath: process.execPath,
    cwd: process.cwd(),
    pid: process.pid,
    ppid: process.ppid,
    projectVar: { name: PROJECT_VAR[cli], value: process.env[PROJECT_VAR[cli]] ?? null },
    env: redactEnv(process.env),
    stdin: null,
    parentChain: null,
    parentChainError: "not yet collected",
    timingsMs: {},
  };
  const dir = path.join(root, "out", cli);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${id}-${Date.now()}-${process.pid}.json`);
  // Written first, so a CLI that kills a slow hook still leaves the argv,
  // cwd and environment evidence; the stdin summary and the process chain
  // are added by the two later rewrites.
  const write = (): void => fs.writeFileSync(file, `${JSON.stringify(rec, null, 2)}\n`);
  write();
  const t1 = Date.now();
  rec.stdin = summariseStdin(await readStdin(1500));
  const t2 = Date.now();
  write();
  const { chain, error } = parentChain(id.startsWith("I"));
  rec.parentChain = chain;
  rec.parentChainError = error ?? null;
  rec.timingsMs = { firstWrite: t1 - t0, stdin: t2 - t1, parentChain: Date.now() - t2 };
  write();
  return 0;
}

export function collect(root: string, cli: Cli, io: Io): number {
  const dir = path.join(root, "out", cli);
  const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith(".json")) : [];
  const byCase = new Map<string, Json[]>();
  for (const f of files.sort()) {
    const rec = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")) as Json;
    const id = String(rec.case);
    byCase.set(id, [...(byCase.get(id) ?? []), rec]);
  }
  const only = fs.existsSync(statePath(root)) ? (readState(root).clis[cli]?.only ?? null) : null;
  for (const c of selectCases(cli, root, only)) {
    const recs = byCase.get(c.id) ?? [];
    io.out(`[${c.id}] launched=${recs.length > 0 ? "yes" : "no"} records=${recs.length}`);
    io.out(`  hook command (${c.key ?? "command"}): ${c.command}`);
    const rec = recs[0];
    if (rec === undefined) continue;
    const pv = asObject(rec.projectVar);
    io.out(`  args: ${JSON.stringify(rec.args)}`);
    io.out(`  scriptPath: ${String(rec.scriptPath)}  cwd: ${String(rec.cwd)}`);
    io.out(`  ${String(pv.name)} in hook env: ${JSON.stringify(pv.value)}`);
    for (const p of asArray(rec.parentChain)) {
      const row = asObject(p);
      io.out(`  parent ${String(row.Name)}: ${String(row.CommandLine)}`);
    }
    if (rec.parentChainError !== null)
      io.out(`  parentChainError: ${String(rec.parentChainError)}`);
    io.out(`  stdin: ${JSON.stringify(rec.stdin)}`);
  }
  const others = fs.existsSync(path.join(root, "out"))
    ? fs.readdirSync(path.join(root, "out")).filter((d) => d !== cli)
    : [];
  for (const other of others) {
    const n = fs.readdirSync(path.join(root, "out", other)).length;
    io.out(`note: out/${other} holds ${n} record(s)`);
  }
  io.out(`collect: ${cli} ${files.length} record(s), ${byCase.size} case(s) fired`);
  return 0;
}

interface Parsed {
  command: string;
  positional: string[];
  root: string | null;
  home: string | null;
  only: string[] | null;
}

export function parseArgs(args: readonly string[]): Parsed {
  const [command, ...rest] = args;
  if (command === undefined) throw new UsageError("missing subcommand");
  if (command === "record") {
    return { command, positional: rest, root: null, home: null, only: null };
  }
  const positional: string[] = [];
  let root: string | null = null;
  let home: string | null = null;
  let only: string[] | null = null;
  for (let i = 0; i < rest.length; i += 1) {
    const arg = rest[i];
    if (arg === "--root" || arg === "--home" || arg === "--only") {
      const value = rest[i + 1];
      if (value === undefined) throw new UsageError(`${arg} needs a value`);
      if (arg === "--root") root = path.resolve(value);
      else if (arg === "--home") home = path.resolve(value);
      else only = value.split(",").filter((id) => id !== "");
      i += 1;
    } else if (arg !== undefined) {
      positional.push(arg);
    }
  }
  return { command, positional, root, home, only };
}

export async function main(args: readonly string[], self: string, io: Io = stdio): Promise<number> {
  try {
    const p = parseArgs(args);
    if (p.command === "record") {
      // Exit explicitly: on Windows a stdin pipe the CLI keeps open holds the
      // event loop, and the CLI would then wait for its own hook timeout.
      process.exit(await record(self, p.positional));
    }
    const here = path.dirname(self);
    if (p.command === "setup") {
      return setup(p.root ?? path.dirname(here), p.home ?? os.homedir(), self, io);
    }
    const root = p.root ?? findRoot(here);
    if (root === null) throw new UsageError("no probe root found; run 'setup' first");
    switch (p.command) {
      case "install":
        return install(root, parseCli(p.positional[0]), io, p.only);
      case "collect":
        return collect(root, parseCli(p.positional[0]), io);
      case "restore":
        return restore(root, parseCli(p.positional[0]), io);
      case "verify-clean":
        return verifyClean(root, io);
      default:
        throw new UsageError(`unknown subcommand '${p.command}'`);
    }
  } catch (error) {
    if (!(error instanceof UsageError)) throw error;
    io.err(`probe: ${error.message}`);
    return 2;
  }
}

const invokedPath = process.argv[1];
if (
  invokedPath !== undefined &&
  import.meta.url === pathToFileURL(fs.realpathSync(invokedPath)).href
) {
  process.exitCode = await main(process.argv.slice(2), fileURLToPath(import.meta.url));
}
