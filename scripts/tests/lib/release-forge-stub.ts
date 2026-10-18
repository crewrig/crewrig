// release-forge-stub.ts — start/stop `scripts/tests/fixtures/release/forge-stub.mjs`, the loopback
// stand-in for the GitLab package/release API and the GitHub release-PR calls (spec 0265 row J2).
//
// API:
//   startForgeStub({ failUpload?, openPr? }) -> Promise<ForgeStub>
//   ForgeStub { port, apiUrl, gitlabApiUrl, uploads, requests(), reset(), stop() }
// `requests()` re-reads the stub's JSON-lines log (one object per request). `uploads` is a directory
// the stub fills with `<pkg>-<version>-<label>` bodies. Every stub is stopped (SIGTERM, awaited) by an
// `after` hook registered on import, and its scratch directory is removed.

import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after } from "node:test";
import { setTimeout as sleep } from "node:timers/promises";

import { REPO } from "./build-fixture-tree.ts";
import { cleanPath } from "./release-engine-env.ts";

const STUB = path.join(REPO, "scripts", "tests", "fixtures", "release", "forge-stub.mjs");

export interface ForgeStubOptions {
  /** The package upload answers 403 (not retried by the engine). */
  readonly failUpload?: boolean;
  /** The GitHub pulls listing answers one open release PR (#5). */
  readonly openPr?: boolean;
}

export type StubRequest = Record<string, unknown> & { method?: string; path?: string };

export interface ForgeStub {
  readonly port: number;
  /** `http://127.0.0.1:<port>`: the GitHub API base. */
  readonly apiUrl: string;
  /** `http://127.0.0.1:<port>/api/v4`: the GitLab API base. */
  readonly gitlabApiUrl: string;
  readonly uploads: string;
  requests(): StubRequest[];
  /** Forget the requests so far. */
  reset(): void;
  stop(): Promise<void>;
}

const live = new Set<ForgeStub>();
after(async () => {
  for (const stub of [...live]) await stub.stop();
});

export async function startForgeStub(options: ForgeStubOptions = {}): Promise<ForgeStub> {
  const dir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "release-stub-")));
  const portFile = path.join(dir, "stub.port");
  const logFile = path.join(dir, "stub.jsonl");
  const uploads = path.join(dir, "uploads");
  const env: Record<string, string> = { PATH: cleanPath(), HOME: dir, LC_ALL: "C" };
  if (options.failUpload === true) env["FAIL_UPLOAD"] = "1";
  if (options.openPr === true) env["OPEN_PR"] = "1";
  const child: ChildProcess = spawn(process.execPath, [STUB, portFile, logFile, uploads], {
    env,
    stdio: "ignore",
  });
  const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
  let port = 0;
  for (let i = 0; i < 100 && port === 0; i++) {
    const text = fs.existsSync(portFile) ? fs.readFileSync(portFile, "utf8").trim() : "";
    if (text !== "") port = Number(text);
    else await sleep(50);
  }
  if (port === 0) {
    child.kill("SIGKILL");
    throw new Error("forge stub did not report a port");
  }
  const stub: ForgeStub = {
    port,
    apiUrl: `http://127.0.0.1:${port}`,
    gitlabApiUrl: `http://127.0.0.1:${port}/api/v4`,
    uploads,
    requests() {
      if (!fs.existsSync(logFile)) return [];
      return fs
        .readFileSync(logFile, "utf8")
        .split("\n")
        .filter((line) => line !== "")
        .map((line) => JSON.parse(line) as StubRequest);
    },
    reset() {
      fs.writeFileSync(logFile, "");
    },
    async stop() {
      if (!live.delete(stub)) return;
      child.kill("SIGTERM");
      await exited;
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
  live.add(stub);
  return stub;
}
