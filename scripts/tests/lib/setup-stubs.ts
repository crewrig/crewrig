// setup-stubs.ts — POSIX-shell stub programs for the setup entry points
// (spec 0256, plan v2 step A3), generated at runtime into a sandbox `bin`
// directory; no tracked .sh file exists for them. They never shadow `jq`: the
// shell setups call the real one (`hasJq()` lets a test skip without it).
//
// PROBE DECISION (single owner, decided once, nothing later re-decides it):
// the daemon probe is driven by a PATH stub `curl`, NOT by the
// `with-stub-daemon.ts` stand-in. Evidence:
//  - `_mcp_daemon_probe_accepts` (scripts/lib/common.sh:1346-1396) decides on
//    `curl -K - -s -o /dev/null -w '%{http_code}'`: the bearer arrives on
//    STDIN as a curl config (`header = "Authorization: Bearer <token>"`), and
//    only a 2xx code counts. A stub reads that config and answers 200 or 000.
//  - The stand-in (stub-daemon.ts:136) only LOGS the authorization header; it
//    never refuses a bearer, so it cannot produce rc 1 (never accepts) nor rc 2
//    (accepted only on the placeholder bearer that a whitespace-only token file
//    forces: common.sh:1962-1967,2000+), and it needs a listening port plus a
//    supervisor that `launchctl`/`systemctl` stubs do not provide.
//  - The same stub answers the `/healthz` probe (common.sh:1307).
// Modes: probe 0 = accept the real (non-placeholder, non-empty) bearer;
// probe 1 = never accept (prints 000, exits 7); probe 2 = accept ONLY the
// placeholder bearer. Every call is recorded with its URL and bearer.
//
// Records: one JSON line per invocation in `<state>/<tool>.jsonl`, argv as an
// array (tabs, CR and newlines inside an argument are flattened to spaces).

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { stubScripts } from "./setup-stub-scripts.ts";

export const PLACEHOLDER_BEARER = "crewrig-setup-placeholder-not-a-credential";
export const CANCEL = "@@CANCEL@@";

export interface StubOptions {
  /** Directory holding the stub state and records (default: `<binDir>/../stub-state`). */
  readonly stateDir?: string;
  /** fzf answers: header (or prompt) substring -> option to print, or `CANCEL`. `|` separates several picks. */
  readonly fzf?: Readonly<Record<string, string>>;
  /** Servers already registered with `claude mcp`: name -> command. */
  readonly claudeServers?: Readonly<Record<string, string>>;
  /** The curl probe mode (see the file header). Default 0. */
  readonly probe?: 0 | 1 | 2;
  /** A directory of packages that `npm ci` copies into `./node_modules`. */
  readonly npmFixture?: string;
  /** `npm ci` exits 1 with this stderr diagnostic. */
  readonly npmFail?: string;
  /** The mempalace version the python3 stub reports (default `3.6.0`). */
  readonly mempalaceVersion?: string;
  /** python3 reports `ModuleNotFoundError` for `importlib.metadata`'s `mempalace` lookup. */
  readonly mempalaceMissing?: boolean;
  /** The python3 range check fails because `packaging` is not importable. */
  readonly noPackaging?: boolean;
}

export interface StubRecord {
  readonly argv: readonly string[];
  readonly [key: string]: unknown;
}

export interface FzfRecord {
  readonly header: string;
  readonly options: readonly string[];
  readonly answer: string;
  readonly unscripted: boolean;
  readonly cancelled: boolean;
}

export interface StubHandle {
  readonly binDir: string;
  readonly stateDir: string;
  /** Every recorded invocation of `tool`, oldest first. */
  records(tool: string): StubRecord[];
  fzfRecords(): FzfRecord[];
  /** The servers currently registered with the `claude` stub, name -> command. */
  claudeServers(): Record<string, string>;
}

/** True when a real `jq` is on the current PATH. */
export function hasJq(): boolean {
  return spawnSync("jq", ["--version"], { stdio: "ignore" }).status === 0;
}

function parseLines(file: string): unknown[] {
  if (!fs.existsSync(file)) return [];
  const out: unknown[] = [];
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    if (line.trim() !== "") out.push(JSON.parse(line) as unknown);
  }
  return out;
}

function narrow(value: unknown): StubRecord {
  if (typeof value !== "object" || value === null) throw new Error("bad stub record");
  const argv: unknown = Reflect.get(value, "argv");
  if (!Array.isArray(argv)) return { argv: [], ...value };
  return { ...value, argv: argv.map(String) };
}

function narrowFzf(value: unknown): FzfRecord {
  const r = narrow(value);
  const options: unknown = r["options"];
  return {
    header: String(r["header"] ?? ""),
    options: Array.isArray(options) ? options.map(String) : [],
    answer: String(r["answer"] ?? ""),
    unscripted: r["unscripted"] === true,
    cancelled: r["cancelled"] === true,
  };
}

/** Write the stubs into `binDir` and return the handle that reads their records. */
export function installStubs(binDir: string, options: StubOptions = {}): StubHandle {
  const stateDir = options.stateDir ?? path.join(path.dirname(binDir), "stub-state");
  fs.mkdirSync(binDir, { recursive: true });
  fs.mkdirSync(stateDir, { recursive: true });
  const table = Object.entries(options.fzf ?? {})
    .map(([key, answer]) => `${key}\t${answer}\n`)
    .join("");
  fs.writeFileSync(path.join(stateDir, "fzf-answers.tsv"), table);
  const servers = Object.entries(options.claudeServers ?? {})
    .map(([name, command]) => `${name}\t${command}\n`)
    .join("");
  fs.writeFileSync(path.join(stateDir, "claude-mcp.tsv"), servers);
  const config: Record<string, string> = {
    probe: String(options.probe ?? 0),
    npm_fixture: options.npmFixture ?? "",
    npm_fail: options.npmFail ?? "",
    mp_version: options.mempalaceVersion ?? "3.6.0",
    mp_missing: options.mempalaceMissing === true ? "1" : "0",
    no_packaging: options.noPackaging === true ? "1" : "0",
    placeholder: PLACEHOLDER_BEARER,
    cancel: CANCEL,
  };
  const conf = Object.entries(config)
    .map(([k, v]) => `${k}=${JSON.stringify(v)}\n`)
    .join("");
  fs.writeFileSync(path.join(stateDir, "stub.conf"), conf);
  for (const [name, body] of Object.entries(stubScripts(stateDir))) {
    const file = path.join(binDir, name);
    fs.writeFileSync(file, `#!/bin/sh\n${body}\n`);
    fs.chmodSync(file, 0o755);
  }
  return {
    binDir,
    stateDir,
    records: (tool) => parseLines(path.join(stateDir, `${tool}.jsonl`)).map(narrow),
    fzfRecords: () => parseLines(path.join(stateDir, "fzf.jsonl")).map(narrowFzf),
    claudeServers: () => {
      const out: Record<string, string> = {};
      const file = path.join(stateDir, "claude-mcp.tsv");
      if (!fs.existsSync(file)) return out;
      for (const line of fs.readFileSync(file, "utf8").split("\n")) {
        const [name, ...rest] = line.split("\t");
        if (name !== undefined && name !== "") out[name] = rest.join("\t");
      }
      return out;
    },
  };
}
