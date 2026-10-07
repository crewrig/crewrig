// transcript-runtime.ts — shared fixtures for the black-box suites of the
// MemPalace transcript hook (spec 0247 R1-R18, plan step 23).
//
// The hook is observed from the outside only: its exit status and standard
// streams, and what the loopback stub daemon
// (scripts/tests/fixtures/mempalace-transcript/stub-daemon.ts) recorded. It
// never talks to the real daemon: every run names the stub's port and a token
// file under a throwaway home, and the environment of the test runner (which
// may itself be a CLI session exporting CLAUDE_*, GEMINI_*, MEMPALACE_* …) is
// scrubbed before each run.
//
// Standard library only.

import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";

import {
  cleanEnv,
  realTmp,
  REPO,
  runNode,
  type Result,
  type RunOptions,
} from "./worktree-fixtures.ts";

export const HOOK_TS = path.join(REPO, "hooks", "mempalace-transcript.ts");
export const HOOK_SH = path.join(REPO, "hooks", "mempalace-transcript.sh");
export const STUB = path.join(
  REPO,
  "scripts",
  "tests",
  "fixtures",
  "mempalace-transcript",
  "stub-daemon.ts",
);
export const SPAWN_SPY = path.join(REPO, "scripts", "tests", "lib", "spawn-spy.ts");

export type StubMode = "ok" | "rpc-error" | "is-error" | "http-500-html" | "hang";

/** One request as the stub recorded it. */
export interface StubRequest {
  readonly method: string;
  readonly url: string;
  readonly contentType: string | null;
  readonly authorization: string | null;
  readonly body: unknown;
}

export interface Stub {
  readonly port: number;
  /** Every request recorded since the stub started. */
  requests(): StubRequest[];
  stop(): Promise<void>;
}

/** Variables that steer the hook; none may leak in from the runner's own session. */
const STEERING =
  /^(MEMPALACE_|CLAUDE_|GEMINI_|COPILOT_|TOKEN_PATH_MOCK$|NODE_EXTRA_CA_CERTS$|SSL_CERT_FILE$|REQUESTS_CA_BUNDLE$|PIP_CERT$|GIT_SSL_CAINFO$|CURL_CA_BUNDLE$|UV_SYSTEM_CERTS$|SPAWN_SPY_LOG$|HTTPS?_PROXY$|https?_proxy$|ALL_PROXY$|all_proxy$)/;

/** A clean environment for one hook run under `home`; `extra` is applied last (`undefined` deletes). */
export function hookEnv(
  home: string,
  extra: Record<string, string | undefined> = {},
): NodeJS.ProcessEnv {
  const env = cleanEnv();
  for (const key of Object.keys(env)) if (STEERING.test(key)) delete env[key];
  env["HOME"] = home;
  env["USERPROFILE"] = home;
  env["NO_PROXY"] = "127.0.0.1,localhost";
  env["no_proxy"] = "127.0.0.1,localhost";
  for (const [key, value] of Object.entries(extra)) {
    if (value === undefined) delete env[key];
    else env[key] = value;
  }
  return env;
}

/** A throwaway home directory (physical path). */
export function makeHome(): string {
  return realTmp("crewrig-mt-home-");
}

/** Write a token file at `<dir>/token` (default content `tok-123`) and return its path. */
export function writeToken(dir: string, content = "tok-123\n"): string {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, "token");
  fs.writeFileSync(file, content);
  return file;
}

/** The environment of a run that reaches `port` with the token file `tokenFile`. */
export function daemonEnv(
  home: string,
  port: number,
  tokenFile: string,
  extra: Record<string, string | undefined> = {},
): NodeJS.ProcessEnv {
  return hookEnv(home, {
    MEMPALACE_MCP_HOST: "127.0.0.1",
    MEMPALACE_MCP_PORT: String(port),
    MEMPALACE_DAEMON_TOKEN_FILE: tokenFile,
    ...extra,
  });
}

/** Run the TypeScript entry the way a CLI does: `node hooks/mempalace-transcript.ts <args>`. */
export function runHook(
  args: readonly string[],
  input: string | null,
  options: RunOptions & { readonly entry?: string } = {},
): Result {
  // A preloaded test module (`--import <spawn-spy.ts>`) is loaded before the
  // entry silences warnings, so Node.js would print its
  // MODULE_TYPELESS_PACKAGE_JSON warning on the hook's standard error (review
  // i1-F3): the flag rides with every `--import`.
  const nodeArgs = options.nodeArgs?.includes("--import")
    ? ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", ...options.nodeArgs]
    : options.nodeArgs;
  return runNode(options.entry ?? HOOK_TS, args, { ...options, nodeArgs, input });
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Start the stub daemon in `mode` and wait for its port file (the readiness signal). */
export async function startStub(mode: StubMode = "ok"): Promise<Stub> {
  const dir = realTmp("crewrig-mt-stub-");
  const portFile = path.join(dir, "port");
  const log = path.join(dir, "requests.jsonl");
  fs.writeFileSync(log, "");
  const child: ChildProcess = spawn(
    process.execPath,
    [
      "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON",
      STUB,
      "--port-file",
      portFile,
      "--log",
      log,
      "--mode",
      mode,
    ],
    { stdio: ["ignore", "ignore", "pipe"], env: cleanEnv() },
  );
  let stderr = "";
  child.stderr?.on("data", (chunk: Buffer) => {
    stderr += chunk.toString("utf8");
  });
  for (let tries = 0; !fs.existsSync(portFile); tries += 1) {
    if (tries > 100 || child.exitCode !== null) {
      child.kill();
      throw new Error(`stub daemon did not start: ${stderr}`);
    }
    await sleep(50);
  }
  const port = Number(fs.readFileSync(portFile, "utf8").trim());
  return {
    port,
    requests: () =>
      fs
        .readFileSync(log, "utf8")
        .split("\n")
        .filter((line) => line !== "")
        .map((line) => JSON.parse(line) as StubRequest),
    stop: () =>
      new Promise<void>((resolve) => {
        if (child.exitCode !== null) {
          resolve();
          return;
        }
        child.once("exit", () => resolve());
        child.kill("SIGTERM");
      }),
  };
}

/** A loopback port nothing listens on: bound, then released. */
export function closedPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as net.AddressInfo;
      server.close(() => resolve(port));
    });
  });
}

/** The `arguments` object of a recorded `tools/call` request. */
export function drawerArgs(request: StubRequest): Record<string, unknown> {
  const body = request.body as { params?: { arguments?: Record<string, unknown> } };
  return body.params?.arguments ?? {};
}

/** `date +%Y-%m-%d`, local time, as the hook names the room. */
export function today(): string {
  const now = new Date();
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** Every file and directory under `dir`, relative, sorted: a snapshot to compare before and after. */
export function snapshotTree(dir: string): string[] {
  const out: string[] = [];
  const walk = (current: string): void => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      out.push(`${path.relative(dir, full)}${entry.isDirectory() ? "/" : ""}`);
      if (entry.isDirectory()) walk(full);
    }
  };
  walk(dir);
  return out.sort();
}

/** The lines of a stream, without the empty one after the last line feed. */
export const lines = (text: string): string[] => text.split("\n").filter((line) => line !== "");
