// with-stub-daemon.ts — runs a command while the loopback stub daemon of
// scripts/tests/fixtures/mempalace-transcript/stub-daemon.ts listens, for the
// `windows-mempalace-transcript` job's budget step (c) (spec 0247 R19(c),
// plan step 22) and for the suites that need a daemon to talk to.
//
// Run as a script:
//
//   node scripts/tests/lib/with-stub-daemon.ts [--mode <mode>] [--log <jsonl>]
//        [--expect-requests <N>] -- <cmd…>
//
// It starts the stub, runs <cmd…> with MEMPALACE_MCP_HOST and
// MEMPALACE_MCP_PORT naming it (standard streams inherited), stops the stub,
// and exits with the command's status, so the daemon lives exactly as long as
// the command. A command named `node` runs on the current Node.js binary.
// --mode is the stub's answer mode (default `ok`); --log keeps the stub's
// request log at that path (default: a temporary file, removed afterwards);
// --expect-requests fails a command that exited 0 when the stub did not log
// exactly N requests, so a budget step proves the records reached the stub.
//
// Exit codes: the command's own status (1 when it died on a signal), 1 on a
// request-count mismatch, 2 on a usage error or a stub that never listened.
//
// Imported, startStub() gives a running stub to a test. Standard library only.

import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
export const STUB_DAEMON = path.join(
  REPO,
  "scripts",
  "tests",
  "fixtures",
  "mempalace-transcript",
  "stub-daemon.ts",
);

const MODES = ["ok", "rpc-error", "is-error", "http-500-html", "hang"] as const;
export type StubMode = (typeof MODES)[number];

/** One request as the stub logged it. */
export interface StubRequest {
  readonly method: string;
  readonly url: string;
  readonly contentType: string | null;
  readonly authorization: string | null;
  readonly body: unknown;
}

export interface RunningStub {
  readonly host: string;
  readonly port: number;
  /** The JSON-lines request log. */
  readonly log: string;
  /** MEMPALACE_MCP_HOST and MEMPALACE_MCP_PORT naming this stub. */
  readonly env: Readonly<Record<string, string>>;
  /** Every request logged so far. */
  requests(): StubRequest[];
  /** Stop the stub and remove its temporary directory (the log too, unless given). */
  stop(): Promise<void>;
}

const READY_TIMEOUT_MS = 10_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Start the stub on an ephemeral loopback port and wait until it listens. */
export async function startStub(
  options: { mode?: StubMode; log?: string } = {},
): Promise<RunningStub> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "stub-daemon-"));
  const portFile = path.join(dir, "port");
  const log = options.log ?? path.join(dir, "requests.jsonl");
  const child = spawn(
    process.execPath,
    [
      "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON",
      STUB_DAEMON,
      "--port-file",
      portFile,
      "--log",
      log,
      "--mode",
      options.mode ?? "ok",
    ],
    { stdio: ["ignore", "ignore", "inherit"], windowsHide: true },
  );
  const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
  let alive = true;
  child.once("exit", () => {
    alive = false;
  });

  const stop = async (): Promise<void> => {
    if (alive) {
      child.kill();
      await exited;
    }
    fs.rmSync(dir, { recursive: true, force: true });
  };

  const deadline = Date.now() + READY_TIMEOUT_MS;
  let port = 0;
  while (port === 0) {
    if (fs.existsSync(portFile)) port = Number(fs.readFileSync(portFile, "utf8").trim());
    else if (!alive || Date.now() > deadline) {
      await stop();
      throw new Error(`stub daemon did not listen within ${READY_TIMEOUT_MS} ms`);
    } else await sleep(20);
  }

  const host = "127.0.0.1";
  return {
    host,
    port,
    log,
    env: { MEMPALACE_MCP_HOST: host, MEMPALACE_MCP_PORT: String(port) },
    requests: () =>
      fs.existsSync(log)
        ? fs
            .readFileSync(log, "utf8")
            .split("\n")
            .filter((line) => line !== "")
            .map((line) => JSON.parse(line) as StubRequest)
        : [],
    stop,
  };
}

class UsageError extends Error {}

interface CliOptions {
  mode: StubMode;
  log?: string;
  expectRequests?: number;
  command: string[];
}

function isMode(value: string): value is StubMode {
  return (MODES as readonly string[]).includes(value);
}

export function parseCli(args: readonly string[]): CliOptions {
  const sep = args.indexOf("--");
  if (sep === -1 || sep === args.length - 1) {
    throw new UsageError("missing '-- <cmd…>' naming the command to run");
  }
  const flags = args.slice(0, sep);
  const options: CliOptions = { mode: "ok", command: args.slice(sep + 1) };
  for (let i = 0; i < flags.length; i += 2) {
    const flag = flags[i];
    const value = flags[i + 1];
    if (value === undefined || value === "") throw new UsageError(`${flag ?? ""} needs a value`);
    if (flag === "--mode") {
      if (!isMode(value)) throw new UsageError(`unknown mode '${value}'`);
      options.mode = value;
    } else if (flag === "--log") options.log = value;
    else if (flag === "--expect-requests") {
      const n = Number(value);
      if (!Number.isInteger(n) || n < 0) {
        throw new UsageError(`--expect-requests needs a non-negative integer, got '${value}'`);
      }
      options.expectRequests = n;
    } else throw new UsageError(`unknown option '${flag ?? ""}'`);
  }
  return options;
}

/** Entry point: returns the process exit code. */
export async function main(args: readonly string[]): Promise<number> {
  let options: CliOptions;
  try {
    options = parseCli(args);
  } catch (error) {
    if (!(error instanceof UsageError)) throw error;
    process.stderr.write(
      `with-stub-daemon: ${error.message}\nusage: with-stub-daemon.ts [--mode <mode>] [--log <jsonl>] [--expect-requests <N>] -- <cmd…>\n`,
    );
    return 2;
  }
  let stub: RunningStub;
  try {
    stub = await startStub({
      mode: options.mode,
      ...(options.log === undefined ? {} : { log: options.log }),
    });
  } catch (error) {
    process.stderr.write(`with-stub-daemon: ${(error as Error).message}\n`);
    return 2;
  }
  try {
    const [file = "", ...rest] = options.command;
    const res = spawnSync(file === "node" ? process.execPath : file, rest, {
      stdio: "inherit",
      env: { ...process.env, ...stub.env },
    });
    if (res.error !== undefined) {
      process.stderr.write(`with-stub-daemon: cannot run '${file}': ${res.error.message}\n`);
      return 1;
    }
    const status = res.status ?? 1;
    if (status === 0 && options.expectRequests !== undefined) {
      const seen = stub.requests().length;
      if (seen !== options.expectRequests) {
        process.stderr.write(
          `with-stub-daemon: the stub logged ${seen} request(s), expected ${options.expectRequests}\n`,
        );
        return 1;
      }
    }
    return status;
  } finally {
    await stub.stop();
  }
}

const invoked = process.argv[1];
if (invoked !== undefined && import.meta.url === pathToFileURL(fs.realpathSync(invoked)).href) {
  void main(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
