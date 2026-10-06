// transcript-golden.ts — replay one golden row of the transcript hook against
// a command and record what it did (spec 0247 plan, verification duty 2).
//
// A row is an invocation (arguments, environment, standard input) over a fresh
// throwaway home and working directory, optionally with a transcript, token
// files and a trust file, against the stub daemon in one mode (or a closed
// port). The outcome is the exit status, both standard streams and every
// request the stub recorded, with what varies between runs replaced by
// placeholders. The same function recorded the shell hook (capture) and
// checks the TypeScript hook (scripts/tests/mempalace-transcript-golden.test.ts),
// so a divergence is a difference of two recordings of one procedure.
//
// Placeholders in a row's inputs: {HOME}, {TMP}, {PORT}, and {KEY:<path>}
// (the 24-hex-digit palace key of <path>, as mcp_token_path computes it).

import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import {
  closedPort,
  hookEnv,
  type Stub,
  type StubMode,
  type StubRequest,
} from "./transcript-runtime.ts";
import { realTmp } from "./worktree-fixtures.ts";

export interface GoldenInput {
  readonly id: string;
  readonly args: readonly string[];
  /** Environment on top of the defaults; `null` removes a default. */
  readonly env?: Readonly<Record<string, string | null>>;
  readonly stdin: string;
  readonly mode: StubMode | "closed";
  /** Files under {HOME}; replaces the default token file `t/token` when given. */
  readonly files?: Readonly<Record<string, string>>;
  /** Written at {TMP}/transcript.jsonl. */
  readonly transcript?: string;
  /** `plain`: {TMP}/workdir, in no repository; `repo`: {TMP}/repo-top/sub of a fresh repository. */
  readonly cwd?: "plain" | "repo";
}

export interface GoldenOutcome {
  readonly exit: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly requests: readonly StubRequest[];
}

export interface GoldenRow extends GoldenInput {
  readonly description: string;
  /** `R30/<clause>`: the TypeScript hook differs from the shell hook on purpose. */
  readonly deviation?: string;
  /** The shell hook's outcome. */
  readonly expect: GoldenOutcome;
  /** On a deviation row only: the TypeScript hook's outcome. */
  readonly ts?: GoldenOutcome;
}

/** How to start the hook under test: a program and the arguments before the row's own. */
export interface HookCommand {
  readonly program: string;
  readonly prefix: readonly string[];
  /** Variables added to every run (e.g. LC_ALL for the shell capture). */
  readonly env?: Readonly<Record<string, string>>;
}

export type Stubs = ReadonlyMap<StubMode, Stub>;

const DEFAULT_ENV: Readonly<Record<string, string>> = {
  MEMPALACE_TRANSCRIPT_ENABLED: "1",
  MEMPALACE_MCP_HOST: "127.0.0.1",
  MEMPALACE_MCP_PORT: "{PORT}",
  MEMPALACE_DAEMON_TOKEN_FILE: "{HOME}/t/token",
};
const DEFAULT_FILES: Readonly<Record<string, string>> = { "t/token": "tok-123\n" };

const palaceKey = (palace: string): string =>
  crypto.createHash("sha256").update(palace).digest("hex").slice(0, 24);

function expand(text: string, vars: { home: string; tmp: string; port: number }): string {
  return text
    .replace(/\{HOME\}/g, vars.home)
    .replace(/\{TMP\}/g, vars.tmp)
    .replace(/\{PORT\}/g, String(vars.port))
    .replace(/\{KEY:([^}]*)\}/g, (_, palace: string) => palaceKey(palace));
}

function localDate(): string {
  const now = new Date();
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** Replace what varies between runs. */
export function normalize(text: string, vars: { home: string; tmp: string; port: number }): string {
  return text
    .split(palaceKey(path.join(vars.home, ".mempalace", "palace")))
    .join("<DEFAULT_KEY>")
    .split(vars.home)
    .join("<HOME>")
    .split(vars.tmp)
    .join("<TMP>")
    .replace(new RegExp(`\\b${vars.port}\\b`, "g"), "<PORT>")
    .split(localDate())
    .join("<DATE>")
    .replace(/after \d+ (ms|milliseconds)/g, "after <N> $1");
}

/** Run one row with `command` against the stubs and return the normalized outcome. */
export async function replayRow(
  row: GoldenInput,
  command: HookCommand,
  stubs: Stubs,
): Promise<GoldenOutcome> {
  const tmp = realTmp("crewrig-mt-golden-");
  const home = path.join(tmp, "home");
  fs.mkdirSync(home);
  const stub = row.mode === "closed" ? undefined : stubs.get(row.mode);
  const port = stub?.port ?? (await closedPort());
  const vars = { home, tmp, port };

  for (const [relative, content] of Object.entries(row.files ?? DEFAULT_FILES)) {
    const target = path.join(home, expand(relative, vars));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, expand(content, vars));
  }
  if (row.transcript !== undefined)
    fs.writeFileSync(path.join(tmp, "transcript.jsonl"), row.transcript);

  let cwd = path.join(tmp, "workdir");
  if (row.cwd === "repo") {
    const top = path.join(tmp, "repo-top");
    fs.mkdirSync(path.join(top, "sub"), { recursive: true });
    spawnSync("git", ["init", "-q"], { cwd: top });
    cwd = path.join(top, "sub");
  } else {
    fs.mkdirSync(cwd);
  }

  const extra: Record<string, string | undefined> = {
    TMPDIR: tmp,
    GIT_CEILING_DIRECTORIES: tmp,
    ...command.env,
  };
  for (const [key, value] of Object.entries({ ...DEFAULT_ENV, ...row.env })) {
    extra[key] = value === null ? undefined : expand(value, vars);
  }
  const before = stub?.requests().length ?? 0;
  const res = spawnSync(command.program, [...command.prefix, ...row.args], {
    cwd,
    env: hookEnv(home, extra),
    input: expand(row.stdin, vars),
    encoding: "utf8",
    timeout: 30_000,
  });
  const requests = (stub?.requests().slice(before) ?? []).map(
    (request) => JSON.parse(normalize(JSON.stringify(request), vars)) as StubRequest,
  );
  fs.rmSync(tmp, { recursive: true, force: true });
  return {
    exit: res.status,
    stdout: normalize(res.stdout, vars),
    stderr: normalize(res.stderr, vars),
    requests,
  };
}
