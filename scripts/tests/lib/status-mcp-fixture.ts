// status-mcp-fixture.ts — the process runner, the loopback stand-in and the isolated
// HOME shared by the status-mcp-lifecycle tests (spec 0252 requirements 15, 16, 22, 24).

import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { after } from "node:test";
import { freePort } from "./windows-service-fixture.ts";

export const REPO = path.resolve(import.meta.dirname, "..", "..", "..");
export const posix = process.platform !== "win32";
export const root = fs.mkdtempSync(path.join(os.tmpdir(), "crewrig-status-mcp-"));
after(() => fs.rmSync(root, { recursive: true, force: true }));

export interface Result {
  status: number | null;
  out: string;
  ms: number;
}

export type Entry = (name: string) => [string, string[]];
export const ENTRIES: Array<[string, Entry, string | false]> = [
  ["TypeScript entry", (n) => [process.execPath, [`scripts/${n}.ts`]], false],
  ["bash shim", (n) => ["bash", [`scripts/${n}.sh`]], !posix && "bash shims are POSIX-only"],
];

/** The environment of a run: the inherited one minus every MCP seam, plus an isolated HOME. */
export function envOf(home: string, extra: Record<string, string>): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const k of Object.keys(env)) if (k.startsWith("MEMPALACE_MCP_")) delete env[k];
  return { ...env, HOME: home, USERPROFILE: home, ...extra };
}

/** Async on purpose: the stand-in servers live in this process and must keep answering. */
export function runEntry(
  entry: Entry,
  name: string,
  home: string,
  extra: Record<string, string>,
): Promise<Result> {
  const [cmd, args] = entry(name);
  const t0 = Date.now();
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd: REPO, env: envOf(home, extra), windowsHide: true });
    let out = "";
    child.stdout.on("data", (d: Buffer) => (out += d.toString()));
    child.stderr.on("data", (d: Buffer) => (out += d.toString()));
    const timer = setTimeout(() => child.kill(), 60_000);
    child.on("close", (status) => {
      clearTimeout(timer);
      resolve({ status, out, ms: Date.now() - t0 });
    });
  });
}

export interface Stand {
  port: number;
  /** Authorization headers seen on POST /mcp. */
  authSeen: string[];
  close: () => Promise<void>;
}

/** A loopback stand-in: /healthz 200, POST /mcp answers `mcpCode`. */
export async function standIn(mcpCode: number, port?: number): Promise<Stand> {
  const authSeen: string[] = [];
  const srv = http.createServer((q, r) => {
    if (q.method === "POST" && q.url === "/mcp") {
      const h = q.headers["authorization"];
      if (h !== undefined) authSeen.push(String(h));
      q.resume();
      r.statusCode = mcpCode;
      r.end("{}");
      return;
    }
    r.statusCode = q.url === "/healthz" ? 200 : 404;
    r.end("ok");
  });
  const p = port ?? (await freePort());
  await new Promise<void>((res, rej) => {
    srv.once("error", rej);
    srv.listen(p, "127.0.0.1", () => res());
  });
  return {
    port: p,
    authSeen,
    close: () => new Promise<void>((r) => srv.close(() => r())),
  };
}

export const newHome = (tag: string): string => {
  const h = fs.mkdtempSync(path.join(root, `${tag}-`));
  return h;
};
