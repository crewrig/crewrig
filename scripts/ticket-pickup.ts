// ticket-pickup.ts — CLI entry of the spec 0244 ticket-pickup check.
//
// The logic lives in scripts/lib/ticket-pickup.ts (model:
// scripts/lib/ticket-ownership.ts; forge adapters:
// scripts/lib/forge-assignment.ts). Run it before any branch, spec id or
// worktree for a ticket, and stop on any non-zero exit:
//
//   node scripts/lib/node-floor-guard.js && \
//     node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/ticket-pickup.ts --issue <N>
//   task ticket-pickup -- --issue <N>
//
// The forge is the one behind the remote of `BASE_REF=<remote>/<branch>` when
// set, else the preferred remote (`crewrig|origin`, else the first).

import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { RunResult } from "./lib/forge-detect.ts";
import { main } from "./lib/ticket-pickup.ts";
import { WiringError, git, preferredRemote, repoRoot } from "./lib/ts-scope.ts";

function runCli(argv: readonly string[]): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const [cmd, ...args] = argv;
    if (cmd === undefined) return reject(new Error("empty command"));
    const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (d: string) => (stdout += d));
    child.stderr.setEncoding("utf8").on("data", (d: string) => (stderr += d));
    child.on("error", reject);
    child.on("close", (status) => resolve({ status: status ?? 1, stdout, stderr }));
  });
}

function remoteName(): string | null {
  try {
    return resolveRemoteName();
  } catch (e) {
    if (e instanceof WiringError) return null;
    throw e;
  }
}

function remoteUrl(): string | null {
  const remote = remoteName();
  if (remote === null) return null;
  const res = git(["remote", "get-url", remote]);
  return res.status === 0 ? res.stdout.trim() : null;
}

function resolveRemoteName(): string | null {
  const baseRef = process.env.BASE_REF ?? "";
  const remotes = git(["remote"])
    .stdout.split("\n")
    .map((r) => r.trim())
    .filter((r) => r !== "");
  const fromBase = baseRef.split("/")[0] ?? "";
  return remotes.includes(fromBase) ? fromBase : (preferredRemote() ?? null);
}

function readConfig(): string | null {
  try {
    return readFileSync(path.join(repoRoot(), "crewrig.config.toml"), "utf8");
  } catch (e) {
    if (e instanceof WiringError || (e as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw e;
  }
}

process.exitCode = await main(process.argv.slice(2), {
  run: runCli,
  env: process.env,
  remoteUrl,
  remoteName,
  readConfig,
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  out: (line) => process.stdout.write(`${line}\n`),
  err: (line) => process.stderr.write(`${line}\n`),
});
